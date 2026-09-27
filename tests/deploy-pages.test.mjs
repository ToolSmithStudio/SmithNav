import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentSettings, cloudflareApi, deployPages, verifyDeployment } from '../scripts/deploy-pages.mjs';

const databaseId = '11111111-2222-3333-4444-555555555555';
const otherId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const environment = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'test-api-token', SETUP_TOKEN: 'test-random-setup-token-over-24-characters', GITHUB_REPOSITORY_OWNER: 'ExampleUser' };
const settings = deploymentSettings(environment);
const tableNames = ['users', 'groups', 'links', 'sessions', 'app_state', 'd1_migrations'];

function harness({ existing = false, tables = [], failMigration = false, failDeploy = false, projectOverride = {} } = {}) {
  const state = {
    project: existing ? { name: settings.project, production_branch: 'main', subdomain: `${settings.project}.pages.dev`, deployment_configs: { production: { d1_databases: { DB: { id: databaseId } } } }, ...projectOverride } : null,
    database: existing ? { uuid: databaseId, name: 'existing-database' } : null,
    tables, calls: [], commands: [], configs: [], logs: [],
  };
  const api = async (path, options = {}) => {
    state.calls.push({ path, ...options });
    if (path === `/pages/projects/${settings.project}`) {
      if (options.method === 'PATCH') { state.project.deployment_configs = options.body.deployment_configs; return state.project; }
      return state.project;
    }
    if (path === '/pages/projects' && options.method === 'POST') {
      state.project = { ...options.body, subdomain: `${settings.project}.pages.dev`, deployment_configs: { production: {} } }; return state.project;
    }
    if (path.startsWith('/d1/database?')) return state.database ? [state.database] : [];
    if (path === '/d1/database' && options.method === 'POST') { state.database = { uuid: databaseId, name: options.body.name }; return state.database; }
    if (path === `/d1/database/${databaseId}`) return state.database;
    if (path === `/d1/database/${databaseId}/query`) return [{ success: true, results: state.tables.map(name => ({ name })) }];
    throw new Error('Unexpected request: ' + path);
  };
  const run = async args => {
    state.commands.push(args);
    if (args[0] === 'd1') {
      if (failMigration) throw new Error('migration failed');
      state.tables = tableNames;
    }
    if (args[0] === 'pages' && failDeploy) throw new Error('deployment failed');
  };
  const deploy = overrides => deployPages({ settings: { ...settings, ...overrides }, api, run, writeConfig: async config => state.configs.push(config), log: text => state.logs.push(text) });
  return { state, deploy };
}

test('deployment settings validate credentials and names before any network call', () => {
  assert.equal(settings.project, 'smithnav-exampleuser');
  assert.equal(settings.databaseName, 'smithnav-exampleuser-db');
  for (const patch of [{ CLOUDFLARE_ACCOUNT_ID: '' }, { CLOUDFLARE_API_TOKEN: '' }, { SETUP_TOKEN: 'short' }, { PAGES_PROJECT_NAME: '../bad' }, { PAGES_PROJECT_NAME: 'bad\nname' }, { D1_DATABASE_ID: 'wrong' }, { DEPLOY_BRANCH: '--help' }]) {
    assert.throws(() => deploymentSettings({ ...environment, ...patch }));
  }
});

test('first deploy provisions D1 and Pages, migrates before publishing, binds production only', async () => {
  const { state, deploy } = harness();
  const result = await deploy();
  assert.equal(result.url, `https://${settings.project}.pages.dev`);
  assert.equal(state.calls.filter(c => c.method === 'POST' && c.path === '/d1/database').length, 1);
  assert.equal(state.calls.filter(c => c.method === 'POST' && c.path === '/pages/projects').length, 1);
  assert.deepEqual(state.commands.map(c => c.slice(0, 3)), [['d1', 'migrations', 'apply'], ['pages', 'deploy', 'dist']]);
  assert.equal(state.configs[0].d1_databases[0].database_id, databaseId);
  assert.equal(JSON.stringify(state.configs).includes(settings.setupToken), false);
  assert.equal(JSON.stringify(state.configs).includes(settings.token), false);
  const patch = state.calls.find(c => c.method === 'PATCH').body;
  assert.deepEqual(Object.keys(patch.deployment_configs), ['production']);
  assert.equal(patch.deployment_configs.production.env_vars.SETUP_TOKEN.type, 'secret_text');
  assert.equal(patch.deployment_configs.production.d1_databases.DB.id, databaseId);
  assert.equal(state.logs.join('').includes(settings.setupToken), false);
});

test('repeat deployment reuses resources and never deletes data', async () => {
  const { state, deploy } = harness();
  await deploy(); await deploy();
  assert.equal(state.calls.filter(c => c.path === '/d1/database' && c.method === 'POST').length, 1);
  assert.equal(state.calls.filter(c => c.path === '/pages/projects' && c.method === 'POST').length, 1);
  assert.equal(state.calls.some(c => c.method === 'DELETE'), false);
  assert.equal(state.configs[1].d1_databases[0].database_id, databaseId);
});

test('existing Pages binding takes precedence over default database name', async () => {
  const { state, deploy } = harness({ existing: true, tables: tableNames });
  await deploy();
  assert.equal(state.configs[0].d1_databases[0].database_name, 'existing-database');
  assert.equal(state.calls.some(c => c.path.startsWith('/d1/database?')), false);
});

test('database binding conflict, unrelated project and git-managed project stop before mutations', async () => {
  for (const [projectOverride, overrides] of [
    [{}, { databaseId: otherId }],
    [{ source: { type: 'github' } }, {}],
    [{ production_branch: 'other' }, {}],
    [{ canonical_deployment: { id: 'old' }, deployment_configs: { production: {} } }, {}],
  ]) {
    const { state, deploy } = harness({ existing: true, projectOverride });
    await assert.rejects(deploy(overrides));
    assert.equal(state.commands.length, 0);
    assert.equal(state.calls.some(c => ['PATCH', 'POST'].includes(c.method)), false);
  }
});

test('unrelated databases and untracked manual schemas are not migrated', async () => {
  for (const tables of [['orders'], ['users', 'groups', 'links', 'sessions', 'app_state']]) {
    const { state, deploy } = harness({ existing: true, tables });
    await assert.rejects(deploy());
    assert.equal(state.commands.length, 0); assert.equal(state.configs.length, 0);
  }
});

test('migration failure prevents publishing and secret updates', async () => {
  const { state, deploy } = harness({ existing: true, tables: tableNames, failMigration: true });
  await assert.rejects(deploy(), /migration failed/);
  assert.equal(state.commands.length, 1);
  assert.equal(state.calls.some(c => c.method === 'PATCH'), false);
});

test('publishing failure propagates without deleting created resources', async () => {
  const { state, deploy } = harness({ failDeploy: true });
  await assert.rejects(deploy(), /deployment failed/);
  assert.equal(state.database.uuid, databaseId);
  assert.equal(state.calls.some(c => c.method === 'DELETE'), false);
});

test('API handles missing resources separately from permission failures and redacts error bodies', async () => {
  const missing = cloudflareApi(settings, async () => new Response('', { status: 404 }));
  assert.equal(await missing('/pages/projects/example', { missing: true }), null);
  const forbidden = cloudflareApi(settings, async () => Response.json({ success: false, errors: [{ code: 10000, message: settings.token + settings.setupToken }] }, { status: 403 }));
  await assert.rejects(forbidden('/pages/projects/example', { missing: true }), error => {
    assert.match(error.message, /403/); assert.match(error.message, /10000/);
    assert.equal(error.message.includes(settings.token), false); assert.equal(error.message.includes(settings.setupToken), false); return true;
  });
});

test('API requests use account-scoped endpoint and authorization header over HTTPS', async () => {
  const api = cloudflareApi(settings, async (url, options) => {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${settings.accountId}/pages/projects`);
    assert.equal(options.headers.Authorization, `Bearer ${settings.token}`);
    assert.equal(options.redirect, 'error');
    return Response.json({ success: true, result: { name: 'example' } });
  });
  assert.deepEqual(await api('/pages/projects'), { name: 'example' });
});


test('deployment health check accepts initialized and fresh installations, retries temporary errors', async () => {
  let calls = 0, waits = 0;
  await verifyDeployment('https://example.pages.dev', {
    fetchImpl: async () => ++calls === 1 ? new Response('temporary', { status: 503 }) : Response.json({ initialized: false }),
    wait: async () => { waits++; },
  });
  assert.equal(calls, 2); assert.equal(waits, 1);
  await verifyDeployment('https://example.pages.dev', { fetchImpl: async () => Response.json({ initialized: true }) });
});

test('deployment health check fails on missing API or login pages', async () => {
  await assert.rejects(verifyDeployment('https://example.pages.dev', {
    fetchImpl: async () => new Response('<html>Not the API</html>'), attempts: 2, wait: async () => {},
  }), /检查尚未通过/);
});
