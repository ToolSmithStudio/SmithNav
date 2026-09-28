import { spawn } from 'node:child_process';
import { writeFile, unlink, appendFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const configPath = 'wrangler.deploy.json';

export function deploymentSettings(env) {
  const accountId = (env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = (env.CLOUDFLARE_API_TOKEN || '').trim();
  const setupToken = (env.SETUP_TOKEN || '').trim();
  if (!/^[a-f\d]{32}$/i.test(accountId)) throw new Error('请在 GitHub Actions Secrets 中填写正确的 CLOUDFLARE_ACCOUNT_ID（32 位）。');
  if (!token) throw new Error('缺少 CLOUDFLARE_API_TOKEN，请在 GitHub Actions Secrets 中配置。');
  if (setupToken.length < 24 || setupToken === 'replace-with-a-random-secret-at-least-24-characters' || /[\r\n]/.test(setupToken)) throw new Error('SETUP_TOKEN 需使用自己生成的至少 24 位单行随机密钥，不能使用示例值。');
  const owner = (env.GITHUB_REPOSITORY_OWNER || 'personal').toLowerCase();
  const project = env.PAGES_PROJECT_NAME || `smithnav-${owner}`;
  if (!/^[a-z\d](?:[a-z\d-]{0,56}[a-z\d])?$/.test(project)) throw new Error('PAGES_PROJECT_NAME 需为 1–58 位小写字母、数字或短横线，首尾不能是短横线。');
  const databaseName = env.D1_DATABASE_NAME || `${project}-db`;
  if (!/^[a-zA-Z\d][a-zA-Z\d_-]{0,63}$/.test(databaseName)) throw new Error('D1_DATABASE_NAME 需为 1–64 位字母、数字、下划线或短横线。');
  const databaseId = env.D1_DATABASE_ID || '';
  if (databaseId && !uuid.test(databaseId)) throw new Error('D1_DATABASE_ID 不是有效的数据库 UUID。');
  const branch = env.DEPLOY_BRANCH || 'main';
  if (!/^[\w./-]{1,100}$/.test(branch) || branch.startsWith('-')) throw new Error('生产分支名称无效。');
  return { accountId, token, setupToken, project, databaseName, databaseId, branch };
}

export function cloudflareApi(settings, fetchImpl = fetch) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${settings.accountId}`;
  return async (path, { method = 'GET', body, missing = false } = {}) => {
    let response;
    try {
      response = await fetchImpl(base + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('连接 Cloudflare 失败或超时，请稍后重新运行工作流。'); }
    if (missing && response.status === 404) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true) {
      // Never log request bodies, credentials, or untrusted API error strings.
      const codes = (payload?.errors || []).map(error => Number(error.code)).filter(Number.isFinite).join(',');
      throw new Error(`Cloudflare API 请求失败（HTTP ${response.status}${codes ? `，错误码 ${codes}` : ''}）。请检查账号 ID、Pages/D1 编辑权限、资源名称和账号配额，再重试。`);
    }
    return payload.result;
  };
}

async function findDatabase(api, name) {
  for (let page = 1; page <= 100; page++) {
    const rows = await api(`/d1/database?name=${encodeURIComponent(name)}&per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw new Error('Cloudflare 返回的数据库列表无效。');
    const exact = rows.filter(row => row.name === name);
    if (exact.length > 1) throw new Error('存在多个同名数据库，请明确设置 D1_DATABASE_ID。');
    if (exact.length) return exact[0];
    if (rows.length < 100) return null;
  }
  throw new Error('数据库列表过长，请明确设置 D1_DATABASE_ID。');
}

async function verifyDatabase(api, id) {
  const result = await api(`/d1/database/${id}/query`, {
    method: 'POST', body: { sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'" },
  });
  if (!Array.isArray(result) || result.length !== 1 || result[0].success !== true || !Array.isArray(result[0].results)) throw new Error('无法验证数据库内容，部署已停止。');
  const tables = new Set(result[0].results.map(row => row.name));
  if (!tables.size || (tables.size === 1 && tables.has('d1_migrations'))) return;
  if (!['users', 'groups', 'links', 'sessions', 'app_state'].every(name => tables.has(name))) throw new Error('目标数据库已有其他应用的数据，请使用新的数据库名称；不会修改现有表。');
  if (!tables.has('d1_migrations')) throw new Error('该数据库未记录 Wrangler 迁移历史，可能曾手动执行 SQL。请先处理迁移历史，或使用新数据库并通过网站导入配置；脚本不会重建或清空它。');
}

export async function deployPages({ settings, api, run, writeConfig, log = console.log }) {
  const path = `/pages/projects/${settings.project}`;
  let project = await api(path, { missing: true });
  if (project?.source) throw new Error('该 Pages 项目已连接 Git。请改用新项目名称，避免两套自动部署同时发布。');
  if (project && project.production_branch !== settings.branch) throw new Error('现有 Pages 项目的生产分支不匹配，请调整项目配置或使用新名称。');
  const boundId = project?.deployment_configs?.production?.d1_databases?.DB?.id;
  if (project?.canonical_deployment && !boundId) throw new Error('同名 Pages 项目已发布其他内容且未绑定 DB，请使用新的 PAGES_PROJECT_NAME。');
  if (boundId && settings.databaseId && boundId !== settings.databaseId) throw new Error('D1_DATABASE_ID 与 Pages 已绑定数据库不同，已停止以避免切换现有数据。');
  const selectedId = boundId || settings.databaseId;
  let database;
  if (selectedId) {
    if (!uuid.test(selectedId)) throw new Error('Pages 已绑定的数据库 ID 无效。');
    database = await api(`/d1/database/${selectedId}`);
  } else {
    database = await findDatabase(api, settings.databaseName);
    if (!database) {
      log('创建 D1 数据库…');
      database = await api('/d1/database', { method: 'POST', body: { name: settings.databaseName } });
    }
  }
  if (!database || !uuid.test(database.uuid) || !database.name || (selectedId && database.uuid !== selectedId)) throw new Error('Cloudflare 返回的数据库信息无效。');
  await verifyDatabase(api, database.uuid);
  if (!project) {
    log('创建 Pages 项目…');
    project = await api('/pages/projects', { method: 'POST', body: { name: settings.project, production_branch: settings.branch } });
  }
  const config = {
    name: settings.project, compatibility_date: '2026-09-01', pages_build_output_dir: './dist',
    d1_databases: [{ binding: 'DB', database_name: database.name, database_id: database.uuid, migrations_dir: './migrations' }],
  };
  await writeConfig(config);
  log('执行尚未应用的数据库迁移…');
  await run(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath]);
  log('配置生产环境的 D1 绑定与初始化密钥…');
  await api(path, { method: 'PATCH', body: {
    deployment_configs: { production: {
      d1_databases: { DB: { id: database.uuid } },
      env_vars: { SETUP_TOKEN: { type: 'secret_text', value: settings.setupToken } },
      ...(project?.deployment_configs?.production?.wrangler_config_hash ? { wrangler_config_hash: project.deployment_configs.production.wrangler_config_hash } : {}),
    } },
  } });
  log('发布 Pages 网站…');
  // Pages rejects --config, and deploying from the project root would pick up
  // the local-only wrangler.toml with its placeholder database ID. Run from an
  // empty directory so Pages uses the bindings and secret configured above.
  const pagesCwd = await mkdtemp(join(tmpdir(), 'smithnav-pages-'));
  try {
    await run(['pages', 'deploy', resolve('dist'), '--project-name', settings.project, '--branch', settings.branch, '--commit-dirty=true'], { cwd: pagesCwd });
  } finally {
    await rm(pagesCwd, { recursive: true, force: true });
  }
  const deployed = await api(path);
  const domain = deployed?.subdomain;
  if (typeof domain !== 'string' || !/^[a-z\d-]+\.pages\.dev$/.test(domain)) throw new Error('发布命令已完成，但未能读取网站地址，请在 Cloudflare Pages 控制台查看。');
  return { url: `https://${domain}`, project: settings.project, databaseId: database.uuid };
}

export async function verifyDeployment(url, { fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 5 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(`${url}/api/status`, { redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store' });
      const status = await response.json();
      if (response.ok && typeof status.initialized === 'boolean') return;
    } catch {}
    if (attempt + 1 < attempts) await wait(3000);
  }
  throw new Error('网站已发布，但 /api/status 检查尚未通过。请打开 Pages 控制台检查部署、D1 绑定和访问限制，再重新运行；数据库不会被清空。');
}

function wrangler(args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), ...args], {
      shell: false, stdio: ['ignore', 'inherit', 'inherit'], ...options,
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    });
    child.on('error', () => reject(new Error('无法启动 Wrangler，请先安装项目依赖。')));
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error(`Wrangler 执行失败（退出码 ${code}），已停止后续部署，请查看上方日志。`)));
  });
}

async function main() {
  const settings = deploymentSettings(process.env);
  try {
    const result = await deployPages({ settings, api: cloudflareApi(settings), run: wrangler,
      writeConfig: config => writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 }),
    });
    await verifyDeployment(result.url);
    console.log(`部署完成：${result.url}`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## SmithNav 已部署\n\n网站：[${result.url}](${result.url})\n\n首次打开网站，使用你保存在 GitHub Secrets 的 SETUP_TOKEN 创建管理员。已有账号和导航保持不变。\n`);
  } finally { await unlink(configPath).catch(() => {}); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
