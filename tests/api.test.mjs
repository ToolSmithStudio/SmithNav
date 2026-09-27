import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import worker from '../src/worker.js';

const origin = 'https://smithnav.test';
const setupToken = 'integration-test-setup-token-at-least-24';
const pass = 'Test-password-2026!';
let mf, db, bucket;
let admin, alice, bob;
const stateDir = `test-results/api-state-${process.pid}`;
const options = { modules: true, scriptPath: 'src/worker.js', compatibilityDate: '2026-07-01', d1Databases: ['DB'], r2Buckets: ['IMAGES'], bindings: { SETUP_TOKEN: setupToken }, d1Persist: `${stateDir}/d1`, r2Persist: `${stateDir}/r2` };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBf8AAAAASUVORK5CYII=', 'base64');
async function request(path, { method = 'GET', data, cookie, headers = {}, raw } = {}) {
  const response = await mf.dispatchFetch(origin + '/api' + path, {
    method,
    headers: { ...(method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(data ?? {}) }),
  });
  const type = response.headers.get('content-type');
  const result = type?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, result, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function login(username, password = pass) { const r = await request('/login', { method: 'POST', data: { username, password } }); assert.equal(r.status, 200, JSON.stringify(r.result)); return { cookie: r.cookie, user: r.result.user }; }
async function createUser(username, role = 'user') { const r = await request('/users', { method: 'POST', cookie: admin.cookie, data: { username, display_name: username, password: pass, role } }); assert.equal(r.status, 201, JSON.stringify(r.result)); return r.result.id; }
async function board(account) { return (await request('/board', { cookie: account.cookie })).result; }
async function upload(account, filename = 'logo.png') { const r = await request('/images', { method: 'POST', cookie: account.cookie, headers: { 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent(filename) }, raw: png }); assert.equal(r.status, 201, JSON.stringify(r.result)); return r.result.image; }

async function legacyImage(account) {
  const id = crypto.randomUUID(); const key = `${account.user.id}/${id}`;
  await db.prepare('INSERT INTO images(id,user_id,object_key,filename,content_type,size,created_at,ready) VALUES(?,?,?,?,?,?,?,1)').bind(id,account.user.id,key,'legacy.png','image/png',png.length,Math.floor(Date.now()/1000)).run();
  await bucket.put(key,png); return { id };
}

before(async () => {
  mf = new Miniflare(options);
  db = await mf.getD1Database('DB'); bucket = await mf.getR2Bucket('IMAGES');
  for (const file of (await readdir('migrations')).filter(x => x.endsWith('.sql')).sort()) {
    let sql = '';
    for (const line of (await readFile(`migrations/${file}`, 'utf8')).split('\n')) {
      if (!line.trim() || line.trim().startsWith('--')) continue;
      sql += line + '\n';
      if (line.trim().endsWith(';') && (!sql.includes('CREATE TRIGGER') || line.trim().endsWith('END;'))) { await db.prepare(sql).run(); sql = ''; }
    }
    assert.equal(sql.trim(), '');
  }
});
after(async () => { await mf?.dispose(); await rm(stateDir, { recursive: true, force: true }); });

test('setup requires secret and same origin; initializes exactly once', async () => {
  assert.equal((await request('/status')).result.initialized, false);
  const data = { username: 'admin', display_name: '管理员', password: pass, setup_token: setupToken };
  assert.equal((await request('/setup', { method: 'POST', data, headers: { Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await request('/setup', { method: 'POST', data: { ...data, setup_token: 'bad' } })).status, 403);
  assert.equal((await request('/setup', { method: 'POST', data })).status, 201);
  assert.equal((await request('/setup', { method: 'POST', data })).status, 409);
  assert.equal((await request('/status')).result.initialized, true);
  const result = await request('/login', { method: 'POST', data });
  assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/); assert.match(result.headers.get('set-cookie'), /Secure/);
  admin = { cookie: result.cookie, user: result.result.user };
  const stored = await db.prepare('SELECT password_hash FROM users WHERE username=?').bind('admin').first();
  assert.notEqual(stored.password_hash, pass); assert.match(stored.password_hash, /^pbkdf2-sha256:100000:/);
  assert.equal((await request('/board')).status, 401);
});

test('administrator creates isolated accounts; role and duplicate checks', async () => {
  await createUser('alice'); await createUser('bob'); alice = await login('alice'); bob = await login('bob');
  assert.equal((await request('/users', { cookie: alice.cookie })).status, 403);
  assert.equal((await request('/users', { method: 'POST', cookie: bob.cookie, data: {} })).status, 403);
  assert.equal((await request('/users', { method: 'POST', cookie: admin.cookie, data: { username: 'ALICE', display_name: '重复', password: pass, role: 'user' } })).status, 409);
  const { users } = (await request('/users', { cookie: admin.cookie })).result;
  assert.equal(users.length, 3); assert.ok(users.every(user => !('password_hash' in user)));
  assert.notEqual((await board(alice)).groups[0].id, (await board(bob)).groups[0].id);
});

test('batch sorting persists exact order and rejects foreign, duplicate and stale IDs', async () => {
  const group = (await board(alice)).groups[0].id;
  const other = (await board(bob)).groups[0].id;
  const ids = [];
  for (const title of ['First', 'Second', 'Third']) ids.push((await request('/links', { method: 'POST', cookie: alice.cookie, data: { title, url: 'https://example.com', group_id: group } })).result.id);
  const reorder = (cookie, group_id, values) => request('/links/reorder', { method: 'PUT', cookie, data: { group_id, ids: values } });
  assert.equal((await reorder(bob.cookie, group, ids)).status, 404);
  assert.equal((await reorder(alice.cookie, other, ids)).status, 404);
  for (const invalid of [[ids[0],ids[0],ids[2]], ids.slice(1), [...ids, 'foreign'], [ids[0],ids[1],'foreign']]) assert.equal((await reorder(alice.cookie, group, invalid)).status, 409);
  assert.deepEqual((await board(alice)).links.map(l => l.id).sort(), [...ids].sort());
  const reversed = [...ids].reverse();
  assert.equal((await reorder(alice.cookie, group, reversed)).status, 200);
  assert.deepEqual((await board(alice)).links.map(l => l.id), reversed);
  assert.deepEqual((await board(alice)).links.map(l => l.sort_order), [0,1,2]);
  for (const id of ids) await request(`/links/${id}`, { method: 'DELETE', cookie: alice.cookie });
});

test('navigation CRUD, search data, ordering, tenant isolation and URL validation', async () => {
  const aliceGroup = (await board(alice)).groups[0].id; const bobGroup = (await board(bob)).groups[0].id;
  const data = { title: 'GitHub', url: 'https://github.com', group_id: aliceGroup, description: '代码', sort_order: 5, icon: 'G' };
  const created = await request('/links', { method: 'POST', cookie: alice.cookie, data }); assert.equal(created.status, 201);
  const id = created.result.id;
  assert.equal((await board(bob)).links.length, 0);
  assert.equal((await request(`/links/${id}`, { method: 'PUT', cookie: bob.cookie, data })).status, 404);
  assert.equal((await request(`/links/${id}`, { method: 'DELETE', cookie: bob.cookie })).status, 404);
  assert.equal((await request('/links', { method: 'POST', cookie: alice.cookie, data: { ...data, group_id: bobGroup } })).status, 400);
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'https://user:secret@example.com']) assert.equal((await request('/links', { method: 'POST', cookie: alice.cookie, data: { ...data, url } })).status, 400);
  assert.equal((await request(`/links/${id}`, { method: 'PUT', cookie: alice.cookie, data: { ...data, title: 'GitHub 更新', sort_order: -1 } })).status, 200);
  assert.equal((await board(alice)).links[0].title, 'GitHub 更新');
  assert.equal((await request(`/links/${id}`, { method: 'DELETE', cookie: alice.cookie })).status, 200);
  assert.equal((await board(alice)).links.length, 0);
});

test('new links append, edits preserve order and missing URL scheme is normalized', async () => {
  const group_id = (await board(alice)).groups[0].id;
  const first = (await request('/links', { method: 'POST', cookie: alice.cookie, data: { title: 'First', url: 'example.com/path', group_id } })).result.id;
  const second = (await request('/links', { method: 'POST', cookie: alice.cookie, data: { title: 'Second', url: 'http://example.org', group_id } })).result.id;
  let links = (await board(alice)).links;
  assert.deepEqual(links.map(l => l.id), [first,second]); assert.equal(links[0].url, 'https://example.com/path'); assert.equal(links[1].url, 'http://example.org/');
  await request(`/links/${first}`, { method: 'PUT', cookie: alice.cookie, data: { title: 'Changed', url: 'example.com:8080/a', group_id } });
  links = (await board(alice)).links;
  assert.deepEqual(links.map(l => l.id), [first,second]); assert.equal(links[0].url, 'https://example.com:8080/a');
  for (const id of [first,second]) await request(`/links/${id}`, { method: 'DELETE', cookie: alice.cookie });
});

test('group CRUD and cascading deletion stay within owner', async () => {
  const r = await request('/groups', { method: 'POST', cookie: alice.cookie, data: { title: '工具', sort_order: -10 } }); assert.equal(r.status, 201);
  const id = r.result.id;
  assert.equal((await request(`/groups/${id}`, { method: 'PUT', cookie: alice.cookie, data: { title: '开发工具', sort_order: -20 } })).status, 200);
  assert.equal((await request('/links', { method: 'POST', cookie: alice.cookie, data: { title: '测试', url: 'https://example.com', group_id: id } })).status, 201);
  assert.equal((await request(`/groups/${id}`, { method: 'DELETE', cookie: bob.cookie })).status, 404);
  assert.equal((await request(`/groups/${id}`, { method: 'DELETE', cookie: alice.cookie })).status, 200);
  assert.equal((await board(alice)).links.length, 0); assert.equal((await board(bob)).groups.length, 1);
});

test('D1 upload persists bytes; image read, attach and delete enforce ownership', async () => {
  const image = await upload(alice, '网站图片.png');
  const stored = await db.prepare('SELECT data,storage FROM images WHERE id=?').bind(image.id).first(); assert.deepEqual(Buffer.from(stored.data), png); assert.equal(stored.storage, 'd1');
  assert.equal((await request(`/images/${image.id}`)).status, 401);
  assert.equal((await request(`/images/${image.id}`, { cookie: bob.cookie })).status, 404);
  const r = await request(`/images/${image.id}`, { cookie: alice.cookie }); assert.equal(r.status, 200); assert.deepEqual(r.result, png); assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal((await request('/images', { cookie: bob.cookie })).result.images.length, 0);
  const data = { title: '图片导航', url: 'https://example.com', image_id: image.id, group_id: (await board(alice)).groups[0].id };
  assert.equal((await request('/links', { method: 'POST', cookie: bob.cookie, data: { ...data, group_id: (await board(bob)).groups[0].id } })).status, 400);
  const created = await request('/links', { method: 'POST', cookie: alice.cookie, data }); assert.equal(created.status, 201);
  assert.equal((await request('/images', { cookie: alice.cookie })).result.images[0].uses, 1);
  assert.equal((await request(`/images/${image.id}`, { method: 'DELETE', cookie: bob.cookie })).status, 404);
  assert.equal((await request(`/images/${image.id}`, { method: 'DELETE', cookie: alice.cookie })).status, 409);
  await request(`/links/${created.result.id}`, { method: 'DELETE', cookie: alice.cookie });
  assert.equal((await request(`/images/${image.id}`, { method: 'DELETE', cookie: alice.cookie })).status, 200);
  await request('/storage/cleanup', { method: 'POST', cookie: admin.cookie });
  assert.equal(await bucket.get(`${alice.user.id}/${image.id}`), null);
});

test('unused image cleanup protects referenced images and other users', async () => {
  const unused = await upload(alice); const foreign = await upload(bob);
  const usedResult = await request('/images', { method: 'POST', cookie: alice.cookie, headers: { 'Content-Type': 'image/png' }, raw: Buffer.concat([png,Buffer.from([1])]) });
  const used = usedResult.result.image;
  const link = (await request('/links', { method: 'POST', cookie: alice.cookie, data: { title: '引用保护', url: 'https://example.com', group_id: (await board(alice)).groups[0].id, image_id: used.id } })).result.id;
  const cleanup = await request('/images/cleanup', { method: 'POST', cookie: alice.cookie, data: { ids: [unused.id,used.id,foreign.id,unused.id] } });
  assert.equal(cleanup.status,200); assert.equal(cleanup.result.deleted,1);
  assert.equal((await request(`/images/${used.id}`, { cookie: alice.cookie })).status,200);
  assert.equal((await request(`/images/${foreign.id}`, { cookie: bob.cookie })).status,200);
  assert.equal((await request('/images/cleanup', { method: 'POST', cookie: alice.cookie, data: { ids: [] } })).result.deleted,0);
  await request(`/links/${link}`, { method: 'DELETE', cookie: alice.cookie });
  await request(`/images/${used.id}`, { method: 'DELETE', cookie: alice.cookie });
  await request(`/images/${foreign.id}`, { method: 'DELETE', cookie: bob.cookie });
});

test('duplicate image uploads reuse owner image, including concurrent requests', async () => {
  const beforeCount = (await request('/images', { cookie: alice.cookie })).result.images.length;
  const options = { method: 'POST', cookie: alice.cookie, headers: { 'Content-Type': 'image/png' }, raw: png };
  const responses = await Promise.all([request('/images', options), request('/images', options), request('/images', options)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200,200,201]);
  assert.equal(new Set(responses.map(r => r.result.image.id)).size, 1);
  assert.equal((await request('/images', { cookie: alice.cookie })).result.images.length, beforeCount + 1);
  const other = await request('/images', { ...options, cookie: bob.cookie });
  assert.equal(other.status, 201); assert.notEqual(other.result.image.id, responses[0].result.image.id);
  await request(`/images/${responses[0].result.image.id}`, { method: 'DELETE', cookie: alice.cookie });
  await request(`/images/${other.result.image.id}`, { method: 'DELETE', cookie: bob.cookie });
});

test('image limits, magic bytes, malformed input, CSRF and XSS protocols', async () => {
  for (const raw of ['<svg onload="alert(1)"></svg>', '<html>bad</html>', 'not-an-image']) assert.equal((await request('/images', { method: 'POST', cookie: alice.cookie, headers: { 'Content-Type': 'image/png' }, raw })).status, 400);
  assert.equal((await request('/images', { method: 'POST', cookie: alice.cookie, headers: { 'Content-Type': 'image/png' }, raw: new Uint8Array(200 * 1024 + 1) })).status, 413);
  assert.equal((await request('/groups', { method: 'POST', cookie: alice.cookie, raw: '{' })).status, 400);
  assert.equal((await request('/groups', { method: 'POST', cookie: alice.cookie, headers: { Origin: 'https://evil.test' }, data: { title: '伪造' } })).status, 403);
  assert.equal((await request('/groups', { method: 'POST', cookie: alice.cookie, data: { title: 'x'.repeat(20000) } })).status, 413);
});

test('legacy R2 deletion failure retains retry queue until storage recovers', async () => {
  const image = await legacyImage(alice);
  const tasks = [];
  const response = await worker.fetch(new Request(origin + `/api/images/${image.id}`, { method: 'DELETE', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: alice.cookie }, body: '{}' }), { DB: db, IMAGES: { delete: async () => { throw new Error('simulated R2 outage'); } } }, { waitUntil: task => tasks.push(task) });
  assert.equal(response.status, 200); await Promise.all(tasks);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM object_gc').first()).count, 1);
  assert.ok(await bucket.get(`${alice.user.id}/${image.id}`));
  await request('/storage/cleanup', { method: 'POST', cookie: admin.cookie });
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM object_gc').first()).count, 0);
  assert.equal(await bucket.get(`${alice.user.id}/${image.id}`), null);
});

test('images work without an R2 binding and legacy migration keeps link references', async () => {
  const tasks = [];
  const direct = (path, method = 'GET', raw, cookie = alice.cookie) => worker.fetch(new Request(origin + '/api' + path, { method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'image/png' }, ...(raw ? { body: raw } : {}) }), { DB: db }, { waitUntil: p => tasks.push(p) });
  const created = await direct('/images', 'POST', png); assert.equal(created.status, 201);
  const image = (await created.json()).image;
  assert.deepEqual(Buffer.from(await (await direct(`/images/${image.id}`)).arrayBuffer()), png);
  const legacy = await legacyImage(alice);
  const link = await request('/links', { method: 'POST', cookie: alice.cookie, data: { title: '旧图片引用', url: 'https://example.com', group_id: (await board(alice)).groups[0].id, image_id: legacy.id } });
  assert.equal((await direct(`/images/${legacy.id}`)).status, 503);
  assert.equal((await direct(`/images/${legacy.id}`, 'PUT', png, bob.cookie)).status, 404);
  assert.equal((await direct(`/images/${legacy.id}`, 'PUT', png)).status, 200);
  assert.equal((await board(alice)).links.find(l => l.id === link.result.id).image_id, legacy.id);
  assert.deepEqual(Buffer.from(await (await direct(`/images/${legacy.id}`)).arrayBuffer()), png);
  assert.equal((await direct(`/images/${legacy.id}`, 'PUT', png)).status, 409);
  await Promise.all(tasks);
  await request(`/links/${link.result.id}`, { method: 'DELETE', cookie: alice.cookie });
  for (const id of [legacy.id,image.id]) await request(`/images/${id}`, { method: 'DELETE', cookie: alice.cookie });
  await request('/storage/cleanup', { method: 'POST', cookie: admin.cookie });
});

test('site icon lookup sends only hostname and blocks unsafe redirects and invalid input', async () => {
  const originalFetch = globalThis.fetch; const visited = [];
  const lookup = value => worker.fetch(new Request(origin + '/api/site-icon', { method: 'POST', headers: { Origin: origin, Cookie: alice.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: value }) }), { DB: db }, { waitUntil() {} });
  try {
    globalThis.fetch = async target => { visited.push(target); if (target.startsWith('https://cloudflare-dns.com/')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }); return new Response(png, { headers: { 'Content-Type': 'image/png' } }); };
    const response = await lookup('https://example.com/private?token=secret');
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.equal(visited.length, 3); assert.equal(visited[2], 'https://example.com/favicon.ico'); assert.ok(visited.every(value => !value.includes('secret')));
    for (const value of ['http://localhost', 'http://127.0.0.1', 'http://[::1]', 'file:///tmp/a', 'https://name:password@example.com']) assert.equal((await lookup(value)).status, 400);
    const unsafeVisited = [];
    globalThis.fetch = async target => {
      unsafeVisited.push(target);
      if (target.startsWith('https://cloudflare-dns.com/')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '127.0.0.1' }] });
      return new Response(png, { headers: { 'Content-Type': 'image/png' } });
    };
    assert.equal((await lookup('https://example.com')).status, 200);
    assert.ok(!unsafeVisited.some(target => target.startsWith('https://example.com/')));
    assert.ok(unsafeVisited.some(target => target.startsWith('https://www.google.com/')));
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/a' } });
    assert.equal((await lookup('https://example.com')).status, 502);
    globalThis.fetch = async () => { throw new Error('network down'); };
    assert.equal((await lookup('https://example.com')).status, 502);
    globalThis.fetch = async () => new Response('<html>bad</html>');
    assert.equal((await lookup('https://example.com')).status, 400);
  } finally { globalThis.fetch = originalFetch; }
});

test('password change and admin reset invalidate all sessions; disabling blocks login', async () => {
  const extra = await login('alice');
  assert.equal((await request('/password', { method: 'PUT', cookie: alice.cookie, data: { current_password: 'wrong', new_password: 'New-password-2026!' } })).status, 400);
  assert.equal((await request('/password', { method: 'PUT', cookie: alice.cookie, data: { current_password: pass, new_password: 'New-password-2026!' } })).status, 200);
  assert.equal((await request('/me', { cookie: extra.cookie })).status, 401);
  alice = await login('alice', 'New-password-2026!');
  assert.equal((await request(`/users/${alice.user.id}`, { method: 'PUT', cookie: admin.cookie, data: { display_name: 'Alice', role: 'user', disabled: false, password: pass } })).status, 200);
  assert.equal((await request('/me', { cookie: alice.cookie })).status, 401); alice = await login('alice');
  assert.equal((await request(`/users/${bob.user.id}`, { method: 'PUT', cookie: admin.cookie, data: { display_name: 'Bob', role: 'user', disabled: true } })).status, 200);
  assert.equal((await request('/me', { cookie: bob.cookie })).status, 401);
  assert.equal((await request('/login', { method: 'POST', data: { username: 'bob', password: pass } })).status, 401);
});

test('deleting user cleans navigation, image metadata, R2 objects and sessions', async () => {
  const image = await upload(alice);
  await request('/links', { method: 'POST', cookie: alice.cookie, data: { title: '删除测试', url: 'https://example.com', group_id: (await board(alice)).groups[0].id, image_id: image.id } });
  assert.equal((await request(`/users/${alice.user.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 200);
  await request('/storage/cleanup', { method: 'POST', cookie: admin.cookie });
  assert.equal(await bucket.get(`${alice.user.id}/${image.id}`), null);
  for (const table of ['groups', 'links', 'images', 'sessions']) assert.equal((await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id=?`).bind(alice.user.id).first()).count, 0);
  assert.equal((await request('/me', { cookie: alice.cookie })).status, 401);
});

test('last administrator and self-delete protected; expired sessions rejected; logout works', async () => {
  assert.equal((await request(`/users/${admin.user.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 400);
  assert.equal((await request(`/users/${admin.user.id}`, { method: 'PUT', cookie: admin.cookie, data: { display_name: 'admin', role: 'user', disabled: false } })).status, 400);
  await assert.rejects(db.prepare("UPDATE users SET disabled=1 WHERE role='admin'").run(), /LAST_ADMIN/);
  const expired = await login('admin');
  await db.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').bind(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(expired.cookie.split('=')[1])).then(value => Buffer.from(value).toString('hex'))).run();
  assert.equal((await request('/me', { cookie: expired.cookie })).status, 401);
  assert.equal((await request('/logout', { method: 'POST', cookie: admin.cookie })).status, 200);
  assert.equal((await request('/me', { cookie: admin.cookie })).status, 401);
});

test('login attempts are throttled', async () => {
  let result;
  for (let i = 0; i < 11; i++) result = await request('/login', { method: 'POST', data: { username: 'unknown', password: pass } });
  assert.equal(result.status, 429);
});

test('D1 account, session and image BLOB survive a complete runtime restart', async () => {
  admin = await login('admin'); const image = await upload(admin);
  await mf.dispose(); mf = new Miniflare(options);
  db = await mf.getD1Database('DB'); bucket = await mf.getR2Bucket('IMAGES');
  assert.equal((await request('/me', { cookie: admin.cookie })).result.user.username, 'admin');
  assert.equal((await request('/status')).result.initialized, true);
  assert.deepEqual((await request(`/images/${image.id}`, { cookie: admin.cookie })).result, png);
  assert.equal((await request('/images', { cookie: admin.cookie })).result.images[0].filename, 'logo.png');
});

test('backup roundtrip supports append and atomic replace with user isolation', async () => {
  await createUser('backup_source'); await createUser('backup_target');
  const source = await login('backup_source'), target = await login('backup_target');
  const image = await upload(source);
  const initial = await board(source);
  await request('/links', { method: 'POST', cookie: source.cookie, data: { group_id: initial.groups[0].id, title: '导出图标', url: 'example.com', image_id: image.id, icon: '例' } });
  const exported = await request('/backup', { cookie: source.cookie });
  assert.equal(exported.status, 200); assert.equal(exported.result.images.length, 1);
  assert.equal(exported.result.images[0].data, png.toString('base64'));
  assert.equal(JSON.stringify(exported.result).includes('password'), false);
  assert.equal((await request('/backup')).status, 401);
  const backup = exported.result;
  for (let n = 0; n < 2; n++) {
    const r = await request('/backup', { method: 'POST', cookie: target.cookie, data: { mode: 'append', backup } });
    assert.equal(r.status, 201, JSON.stringify(r.result));
  }
  let current = await board(target);
  assert.equal(current.groups.length, 3); assert.equal(current.links.length, 2);
  assert.notEqual(current.links[0].image_id, image.id);
  assert.equal((await request('/images', { cookie: target.cookie })).result.images.length, 1);
  const invalid = structuredClone(backup); invalid.links[0].url = 'javascript:alert(1)';
  assert.equal((await request('/backup', { method: 'POST', cookie: target.cookie, data: { mode: 'replace', backup: invalid } })).status, 400);
  assert.deepEqual(await board(target), current);
  assert.equal((await request('/backup', { method: 'POST', cookie: target.cookie, data: { mode: 'replace', backup } })).status, 201);
  current = await board(target); assert.equal(current.groups.length, 1); assert.equal(current.links.length, 1);
  assert.equal((await board(source)).links.length, 1);
  const imported = await request('/images/' + current.links[0].image_id, { cookie: target.cookie });
  assert.deepEqual(imported.result, png);
  const missing = structuredClone(backup); missing.images = [];
  assert.equal((await request('/backup', { method: 'POST', cookie: target.cookie, data: { mode: 'replace', backup: missing } })).status, 400);
  assert.deepEqual(await board(target), current);
});

test('groups append, reorder persistently, preserve order on rename and reject invalid ownership', async () => {
  await createUser('group_order'); const account = await login('group_order');
  const original = (await board(account)).groups[0].id;
  const create = async title => (await request('/groups', { method: 'POST', cookie: account.cookie, data: { title, sort_order: -100 } })).result.id;
  const first = await create('First'), second = await create('Second');
  assert.deepEqual((await board(account)).groups.map(g => g.id), [original, first, second]);
  const order = [second, original, first];
  assert.equal((await request('/groups/reorder', { method: 'PUT', cookie: account.cookie, data: { ids: order } })).status, 200);
  await request(`/groups/${second}`, { method: 'PUT', cookie: account.cookie, data: { title: 'Renamed' } });
  assert.deepEqual((await board(account)).groups.map(g => g.id), order);
  const foreignAccount = await login('backup_source');
  const foreign = (await board(foreignAccount)).groups[0].id;
  for (const ids of [[first, first, second], [first, second], [first, second, foreign], null]) {
    assert.equal((await request('/groups/reorder', { method: 'PUT', cookie: account.cookie, data: { ids } })).status, 409);
    assert.deepEqual((await board(account)).groups.map(g => g.id), order);
  }
  const last = await create('Last');
  assert.deepEqual((await board(account)).groups.map(g => g.id), [...order, last]);
  assert.equal((await request('/groups/reorder', { method: 'PUT', data: { ids: [] } })).status, 401);
});
