const DAY = 86400;
const encoder = new TextEncoder();
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
function equal(a, b) { let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return diff === 0; }
async function hashPassword(password, salt = random()) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `pbkdf2-sha256:100000:${salt}:${hex(bits)}`;
}
async function verifyPassword(password, stored) { return equal(await hashPassword(password, stored.split(':')[2]), stored); }
function str(value, name, max, min = 1) { if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400, `${name}长度应为 ${min}–${max} 个字符`); return value.trim(); }
function password(value) { if (typeof value !== 'string' || value.length < 12 || value.length > 128 || !value.trim()) fail(400, '密码长度应为 12–128 个字符，且不能全为空格'); return value; }
function username(value) { const name = str(value, '用户名', 40, 3).toLowerCase(); if (!/^[a-z0-9_.-]+$/.test(name)) fail(400, '用户名仅支持字母、数字、点、下划线和短横线'); return name; }
function sort(value = 0) { if (!Number.isSafeInteger(value) || Math.abs(value) > 1000000) fail(400, '排序应为 -1000000 至 1000000 之间的整数'); return value; }
function url(value) { let v = str(value, '网址', 2048); if (v.startsWith('//')) v = 'https:' + v; else if (!/^[a-z][a-z0-9+.-]*:/i.test(v) || /^[^/]+:\d+(?:[/?#]|$)/.test(v)) v = 'https://' + v; try { const parsed = new URL(v); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); return parsed.href; } catch { fail(400, '请输入有效的 http:// 或 https:// 网址'); } }
function navigationFields(input) {
  const title = str(input.title, '名称', 80);
  const href = url(input.url);
  const description = str(input.description ?? '', '描述', 300, 0);
  const candidate = str(input.icon ?? '', '图标', 2048, 0);
  const remoteIcon = /^https?:\/\//i.test(candidate);
  if (!remoteIcon && Array.from(candidate).length > 8) fail(400, '图标文字最多 8 个字符');
  return { title, href, description, icon: remoteIcon ? url(candidate) : candidate };
}
function publicUser(user) { return { id: user.id, username: user.username, display_name: user.display_name, role: user.role, disabled: user.disabled, created_at: user.created_at }; }
async function body(request, limit = 16384) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, '请使用 JSON 请求');
  const bytes = await readBytes(request, limit);
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; } catch { fail(400, 'JSON 格式错误'); }
}
async function readBytes(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) fail(413, '请求过大');
  const reader = request.body?.getReader(); if (!reader) fail(400, '请求不能为空');
  const chunks = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > limit) { await reader.cancel(); fail(413, '请求过大'); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function imageType(bytes) {
  const starts = signature => signature.every((value, i) => bytes[i] === value);
  if (bytes.length > 24 && starts([137,80,78,71,13,10,26,10])) return 'image/png';
  if (bytes.length > 12 && starts([255,216,255])) return 'image/jpeg';
  const text = new TextDecoder().decode(bytes.slice(0, 12));
  if (bytes.length > 12 && /^GIF8[79]a/.test(text)) return 'image/gif';
  if (bytes.length > 20 && text.startsWith('RIFF') && text.slice(8) === 'WEBP') return 'image/webp';
  fail(400, '仅支持 PNG、JPEG、GIF、WebP 图片，不支持 SVG');
}
function publicHostname(host) {
  return host.includes('.') && !host.includes(':') && !/^[\d.]+$/.test(host) && !/(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host);
}
function publicAddress(address) {
  if (address.includes(':')) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:0:|db8:)/i.test(address);
  const p = address.split('.').map(Number);
  return p.length === 4 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && ![0,10,127].includes(p[0]) && p[0] < 224 && !(p[0] === 169 && p[1] === 254) && !(p[0] === 172 && p[1] >= 16 && p[1] <= 31) && !(p[0] === 192 && [0,168].includes(p[1])) && !(p[0] === 100 && p[1] >= 64 && p[1] <= 127) && !(p[0] === 198 && [18,19,51].includes(p[1])) && !(p[0] === 203 && p[1] === 0 && p[2] === 113);
}
async function directSiteIcon(site) {
  if (!publicHostname(site.hostname) || site.port) throw new Error('public domain required');
  const answers = await Promise.all(['A','AAAA'].map(async type => {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(site.hostname)}&type=${type}`, { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!r.ok) throw new Error('DNS lookup failed');
    const result = await r.json(); if (result.Status !== 0) throw new Error('DNS lookup failed');
    return (result.Answer || []).filter(a => [1,28].includes(a.type)).map(a => a.data);
  }));
  const addresses = answers.flat();
  if (!addresses.length || addresses.some(a => !publicAddress(a))) throw new Error('non-public address');
  // Fetch only the site's conventional icon path; do not follow redirects or
  // forward user cookies, URL paths, queries, or authentication headers.
  const r = await fetch(`${site.origin}/favicon.ico`, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { Accept: 'image/*' } });
  if (!r.ok) { await r.body?.cancel(); throw new Error('icon unavailable'); }
  const bytes = await readBytes(r, 1024 * 1024);
  const type = bytes.length > 22 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0 ? 'image/x-icon' : imageType(bytes);
  return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
async function collectObjects(env) {
  if (!env.IMAGES) return;
  await statement(env.DB, 'DELETE FROM images WHERE ready=0 AND created_at<?', now() - 3600).run();
  const { results } = await env.DB.prepare('SELECT object_key FROM object_gc LIMIT 100').all();
  if (!results.length) return;
  await env.IMAGES.delete(results.map(row => row.object_key));
  await env.DB.batch(results.map(row => statement(env.DB, 'DELETE FROM object_gc WHERE object_key=?', row.object_key)));
}
function cleanupLater(env, ctx) {
  ctx.waitUntil(collectObjects(env).catch(error => console.error('R2 cleanup pending:', error)));
}
function cookie(request, value, age = 7 * DAY) { return `smithnav_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`; }
const now = () => Math.floor(Date.now() / 1000);
const statement = (db, sql, ...values) => db.prepare(sql).bind(...values);
async function throttle(db, key, max, seconds) {
  const t = now();
  const row = await statement(db, `INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING count`, key, t + seconds, t, t, t + seconds).first();
  if (row.count > max) fail(429, '尝试过于频繁，请稍后再试');
}
async function session(db, request) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)smithnav_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) fail(401, '请先登录');
  const tokenHash = await digest(token);
  const user = await statement(db, `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`, tokenHash, now()).first();
  if (!user) fail(401, '登录已过期，请重新登录');
  return { user, tokenHash };
}
async function api(request, env, ctx) {
  const db = env.DB; if (!db) fail(503, '未绑定 D1 数据库，请按 README 配置 DB');
  const path = new URL(request.url).pathname.replace(/\/$/, ''); const method = request.method;
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) fail(405, '不支持此请求方式');
  if (method !== 'GET') {
    if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') fail(403, '请求来源不合法');
    if (!((path === '/api/images' && method === 'POST') || (/^\/api\/images\/[\w-]+$/.test(path) && method === 'PUT')) && !request.headers.get('content-type')?.startsWith('application/json')) fail(415, '请使用 JSON 请求');
  }
  if (path === '/api/status' && method === 'GET') {
    return json({ initialized: !!await statement(db, "SELECT key FROM app_state WHERE key='initialized'").first() });
  }
  if (path === '/api/setup' && method === 'POST') {
    await throttle(db, `setup:${request.headers.get('cf-connecting-ip') || 'local'}`, 10, 900);
    if (await statement(db, "SELECT key FROM app_state WHERE key='initialized'").first()) fail(409, '系统已初始化');
    if (!env.SETUP_TOKEN || env.SETUP_TOKEN.length < 24) fail(503, '请先配置至少 24 位的 SETUP_TOKEN');
    const data = await body(request);
    if (typeof data.setup_token !== 'string' || !equal(await digest(data.setup_token), await digest(env.SETUP_TOKEN))) fail(403, '初始化密钥错误');
    const name = username(data.username); const display = str(data.display_name, '显示名称', 50); const hashed = await hashPassword(password(data.password)); const id = crypto.randomUUID();
    await db.batch([
      statement(db, "INSERT INTO app_state(key,value) VALUES('initialized','1')"),
      statement(db, "INSERT INTO users(id,username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,'admin',?)", id, name, display, hashed, now()),
      statement(db, 'INSERT INTO groups(id,user_id,title) VALUES(?,?,?)', crypto.randomUUID(), id, '常用网站'),
    ]);
    return json({ ok: true }, 201);
  }
  if (path === '/api/login' && method === 'POST') {
    const data = await body(request); const name = username(data.username); str(data.password, '密码', 128);
    await throttle(db, `login-ip:${request.headers.get('cf-connecting-ip') || 'local'}`, 40, 900);
    await throttle(db, `login-user:${name}`, 10, 900);
    const user = await statement(db, 'SELECT * FROM users WHERE username=?', name).first();
    const valid = await verifyPassword(data.password, user?.password_hash || 'pbkdf2-sha256:100000:dummy:0000000000000000000000000000000000000000000000000000000000000000');
    if (!user || !valid || user.disabled) fail(401, '用户名或密码错误');
    const token = random();
    await db.batch([
      statement(db, 'DELETE FROM sessions WHERE expires_at<=?', now()),
      statement(db, 'DELETE FROM rate_limits WHERE reset_at<=?', now()),
      statement(db, 'DELETE FROM rate_limits WHERE key=?', `login-user:${name}`),
      statement(db, 'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', await digest(token), user.id, now() + 7 * DAY),
    ]);
    return json({ user: publicUser(user) }, 200, { 'Set-Cookie': cookie(request, token) });
  }
  const { user, tokenHash } = await session(db, request);
  if (path === '/api/me' && method === 'GET') return json({ user: publicUser(user) });
  if (path === '/api/logout' && method === 'POST') { await statement(db, 'DELETE FROM sessions WHERE token_hash=?', tokenHash).run(); return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) }); }
  if (path === '/api/password' && method === 'PUT') {
    await throttle(db, `password:${user.id}`, 10, 900);
    const data = await body(request); password(data.new_password);
    if (typeof data.current_password !== 'string' || data.current_password.length > 128 || !await verifyPassword(data.current_password, user.password_hash)) fail(400, '当前密码错误');
    await db.batch([statement(db, 'UPDATE users SET password_hash=? WHERE id=?', await hashPassword(data.new_password), user.id), statement(db, 'DELETE FROM sessions WHERE user_id=?', user.id)]);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
  }
  if (path === '/api/board' && method === 'GET') {
    const results = await db.batch([statement(db, 'SELECT id,title,sort_order FROM groups WHERE user_id=? ORDER BY sort_order,title,id', user.id), statement(db, 'SELECT id,group_id,title,url,description,icon,image_id,sort_order FROM links WHERE user_id=? ORDER BY sort_order,created_at,id', user.id)]);
    return json({ groups: results[0].results, links: results[1].results });
  }
  if (path === '/api/backup' && method === 'GET') {
    const rows = await db.batch([
      statement(db, 'SELECT id,title,sort_order FROM groups WHERE user_id=? ORDER BY sort_order,title,id', user.id),
      statement(db, 'SELECT id,group_id,title,url,description,icon,image_id,sort_order FROM links WHERE user_id=? ORDER BY sort_order,created_at,id', user.id),
      statement(db, "SELECT id,filename,data,storage FROM images WHERE user_id=? AND ready=1 AND id IN (SELECT image_id FROM links WHERE user_id=?)", user.id, user.id),
    ]);
    if (rows[2].results.some(i => i.storage !== 'd1')) fail(400, '请先在图片库将使用中的旧图片迁移到 D1');
    const images = rows[2].results.map(i => { let binary = ''; for (const byte of new Uint8Array(i.data)) binary += String.fromCharCode(byte); return { id: i.id, filename: i.filename, data: btoa(binary) }; });
    const data = { format: 'SmithNav', version: 1, groups: rows[0].results, links: rows[1].results, images };
    if (data.groups.length > 1000 || data.links.length > 10000 || encoder.encode(JSON.stringify(data)).length > 16 * 1024 * 1024) fail(400, '配置超过单次备份限制（16 MB、1000 分组、10000 导航）');
    return json(data);
  }
  if (path === '/api/backup' && method === 'POST') {
    const payload = await body(request, 16 * 1024 * 1024 + 1024);
    const { mode, backup: data } = payload;
    if (!['append', 'replace'].includes(mode) || !data || typeof data !== 'object') fail(400, '请选择追加或覆盖导入');
    if (data.format !== 'SmithNav' || data.version !== 1 || !Array.isArray(data.groups) || !Array.isArray(data.links) || !Array.isArray(data.images) || data.groups.length > 1000 || data.links.length > 10000 || data.images.length > 200) fail(400, '不支持的 SmithNav 配置文件');
    const groupIds = new Map(), imageIds = new Map(), contents = new Map(), queries = [];
    if (mode === 'replace') queries.push(statement(db, 'DELETE FROM groups WHERE user_id=?', user.id));
    const key = (value, map) => { const id = str(value, '配置 ID', 64); if (map.has(id)) fail(400, '配置包含重复 ID'); return id; };
    for (const item of data.images) {
      if (!item || typeof item !== 'object') fail(400, '图片配置无效');
      const old = key(item.id, imageIds), filename = str(item.filename, '图片名称', 180);
      if (typeof item.data !== 'string' || item.data.length > 273068) fail(400, '图片超过 200 KB');
      let bytes; try { bytes = Uint8Array.from(atob(item.data), c => c.charCodeAt(0)); } catch { fail(400, '图片编码无效'); }
      if (bytes.length > 200 * 1024) fail(400, '图片超过 200 KB');
      const type = imageType(bytes);
      const existing = await statement(db, "SELECT id FROM images WHERE user_id=? AND storage='d1' AND ready=1 AND size=? AND data=? LIMIT 1", user.id, bytes.length, bytes.buffer).first();
      let id = existing?.id || contents.get(item.data);
      if (!id) { id = crypto.randomUUID(); queries.push(statement(db, "INSERT INTO images(id,user_id,object_key,filename,content_type,size,created_at,ready,data,storage) VALUES(?,?,?,?,?,?,?,1,?,'d1')", id, user.id, `d1/${id}`, filename, type, bytes.length, now(), bytes.buffer)); }
      imageIds.set(old, id); contents.set(item.data, id);
    }
    for (const item of data.groups) {
      if (!item || typeof item !== 'object') fail(400, '分组配置无效');
      const old = key(item.id, groupIds), id = crypto.randomUUID(); groupIds.set(old, id);
      queries.push(statement(db, 'INSERT INTO groups(id,user_id,title,sort_order) VALUES(?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM groups WHERE user_id=?))', id, user.id, str(item.title, '分组名称', 80), user.id));
    }
    for (const item of data.links) {
      if (!item || typeof item !== 'object' || !groupIds.has(item.group_id) || (item.image_id && !imageIds.has(item.image_id))) fail(400, '导航引用的分组或图片缺失');
      const fields = navigationFields(item);
      const group = groupIds.get(item.group_id);
      queries.push(statement(db, 'INSERT INTO links(id,user_id,group_id,title,url,description,icon,image_id,sort_order,created_at) VALUES(?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM links WHERE group_id=?),?)', crypto.randomUUID(), user.id, group, fields.title, fields.href, fields.description, fields.icon, imageIds.get(item.image_id) || null, group, now()));
    }
    // D1 batch is transactional: validation or quota failures leave existing data intact.
    if (queries.length) await db.batch(queries);
    return json({ groups: data.groups.length, links: data.links.length, images: contents.size }, 201);
  }
  if (path === '/api/groups/reorder' && method === 'PUT') {
    const { ids } = await body(request);
    const owned = new Set((await statement(db, 'SELECT id FROM groups WHERE user_id=?', user.id).all()).results.map(group => group.id));
    if (!Array.isArray(ids) || ids.length !== owned.size || new Set(ids).size !== owned.size || ids.some(id => typeof id !== 'string' || !owned.has(id))) fail(409, '分组列表已变化，请刷新后重新排序');
    if (ids.length) await db.batch(ids.map((id, order) => statement(db, 'UPDATE groups SET sort_order=? WHERE id=? AND user_id=?', order, id, user.id)));
    return json({ ok: true });
  }
  if (path === '/api/links/reorder' && method === 'PUT') {
    const data = await body(request);
    const group = await statement(db, 'SELECT id FROM groups WHERE id=? AND user_id=?', typeof data.group_id === 'string' ? data.group_id : '', user.id).first();
    if (!group) fail(404, '分组不存在');
    const current = (await statement(db, 'SELECT id FROM links WHERE group_id=? AND user_id=?', group.id, user.id).all()).results.map(row => row.id);
    const owned = new Set(current);
    if (!Array.isArray(data.ids) || data.ids.length !== owned.size || new Set(data.ids).size !== owned.size || data.ids.some(id => typeof id !== 'string' || !owned.has(id))) fail(409, '导航列表已变化，请刷新后重新排序');
    if (data.ids.length) await db.batch(data.ids.map((id, index) => statement(db, 'UPDATE links SET sort_order=? WHERE id=? AND group_id=? AND user_id=?', index, id, group.id, user.id)));
    return json({ ok: true });
  }
  if (path === '/api/site-icon' && method === 'POST') {
    await throttle(db, `site-icon:${user.id}`, 60, 3600);
    const site = new URL(url((await body(request)).url));
    const host = site.hostname;
    if (!host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host) || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host)) fail(400, '请填写公网网站域名；内网网站请手动上传图标');
    try { return await directSiteIcon(site); } catch {}
    // Only the hostname is sent to a fixed icon service, never the URL path,
    // query, credentials or an arbitrary user-controlled fetch destination.
    let target = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
    for (let i = 0; i < 4; i++) {
      let response;
      try { response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { Accept: 'image/*' } }); }
      catch { fail(502, '图标服务暂不可用，请重试或手动上传'); }
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location) break;
        const next = new URL(location, target);
        if (next.protocol !== 'https:' || next.username || next.password || next.port || !['google.com','gstatic.com','googleusercontent.com'].some(domain => next.hostname === domain || next.hostname.endsWith('.' + domain))) break;
        target = next.href; continue;
      }
      if (!response.ok) { await response.body?.cancel(); break; }
      const bytes = await readBytes(response, 1024 * 1024);
      const type = imageType(bytes);
      return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    fail(502, '未能读取网站图标，请手动上传');
  }
  if (path === '/api/images' && method === 'GET') {
    cleanupLater(env, ctx);
    return json({ images: (await statement(db, 'SELECT i.id,i.filename,i.content_type,i.size,i.created_at,i.storage,(SELECT COUNT(*) FROM links l WHERE l.image_id=i.id) AS uses FROM images i WHERE i.user_id=? AND i.ready=1 ORDER BY i.created_at DESC,i.id', user.id).all()).results, available: true, legacyAvailable: !!env.IMAGES });
  }
  if (path === '/api/images' && method === 'POST') {
    await throttle(db, `upload:${user.id}`, 60, 3600);
    const bytes = await readBytes(request, 200 * 1024); const contentType = imageType(bytes);
    let filename; try { filename = str(decodeURIComponent(request.headers.get('x-file-name') || 'image.webp'), '文件名', 180); } catch { fail(400, '文件名无效或超过 180 个字符'); }
    const id = crypto.randomUUID();
    // D1 serializes the insert-and-check statement, including concurrent uploads.
    // Compare within the owner only, also covering images saved by older versions.
    await statement(db, "INSERT INTO images(id,user_id,object_key,filename,content_type,size,created_at,ready,data,storage) SELECT ?,?,?,?,?,?,?,1,?,'d1' WHERE NOT EXISTS (SELECT 1 FROM images WHERE user_id=? AND storage='d1' AND ready=1 AND size=? AND data=?)", id, user.id, `d1/${id}`, filename, contentType, bytes.length, now(), bytes.buffer, user.id, bytes.length, bytes.buffer).run();
    const image = await statement(db, "SELECT i.id,i.filename,i.content_type,i.size,i.storage,(SELECT COUNT(*) FROM links WHERE image_id=i.id) AS uses FROM images i WHERE i.user_id=? AND i.storage='d1' AND i.ready=1 AND i.size=? AND i.data=? ORDER BY i.created_at,i.id LIMIT 1", user.id, bytes.length, bytes.buffer).first();
    if (!image) fail(409, '图片记录已变化，请重试');
    return json({ image, reused: image.id !== id }, image.id === id ? 201 : 200);
  }

  if (path === '/api/images/cleanup' && method === 'POST') {
    const { ids } = await body(request);
    if (!Array.isArray(ids) || ids.length > 200 || ids.some(id => typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id))) fail(400, '图片列表无效');
    const unique = [...new Set(ids)]; const queries = [];
    for (let offset = 0; offset < unique.length; offset += 80) {
      const chunk = unique.slice(offset, offset + 80);
      queries.push(statement(db, `DELETE FROM images WHERE user_id=? AND id IN (${chunk.map(() => '?').join(',')}) AND NOT EXISTS(SELECT 1 FROM links WHERE links.image_id=images.id)`, user.id, ...chunk));
    }
    const results = queries.length ? await db.batch(queries) : [];
    cleanupLater(env, ctx);
    return json({ deleted: results.reduce((sum, result) => sum + result.meta.changes, 0) });
  }
  const imageMatch = path.match(/^\/api\/images\/([\w-]+)$/);
  if (imageMatch) {
    const row = await statement(db, 'SELECT * FROM images WHERE id=? AND user_id=? AND ready=1', imageMatch[1], user.id).first();
    if (!row) fail(404, '图片不存在');
    if (method === 'GET') {
      let content;
      if (row.storage === 'd1') content = new Uint8Array(row.data);
      else {
        if (!env.IMAGES) fail(503, '此图片尚未迁移，请临时恢复旧 IMAGES 绑定后迁移');
        const object = await env.IMAGES.get(row.object_key); if (!object) fail(404, '旧图片文件不存在');
        content = object.body;
      }
      return new Response(content, { headers: { 'Content-Type': row.content_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin' } });
    }
    if (method === 'PUT') {
      if (row.storage !== 'r2') fail(409, '图片已迁移');
      const bytes = await readBytes(request, 200 * 1024); const contentType = imageType(bytes);
      await db.batch([
        statement(db, "UPDATE images SET data=?,storage='d1',content_type=?,size=?,filename=? WHERE id=? AND user_id=? AND storage='r2'", bytes.buffer, contentType, bytes.length, row.filename.replace(/\.[^.]+$/, '') + '.' + contentType.split('/')[1], row.id, user.id),
        statement(db, 'INSERT OR IGNORE INTO object_gc(object_key) VALUES(?)', row.object_key),
      ]);
      cleanupLater(env, ctx);
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      if (await statement(db, 'SELECT id FROM links WHERE image_id=? LIMIT 1', row.id).first()) fail(409, '图片正在被导航使用，请先修改或删除对应导航');
      await statement(db, 'DELETE FROM images WHERE id=? AND user_id=?', row.id, user.id).run(); cleanupLater(env, ctx);
      return json({ ok: true });
    }
    fail(405, '不支持此请求方式');
  }
  if (path === '/api/storage/cleanup' && method === 'POST') {
    if (user.role !== 'admin') fail(403, '仅管理员可清理存储');
    if (!env.IMAGES) fail(503, '未绑定 R2 存储桶');
    await collectObjects(env);
    return json({ pending: (await db.prepare('SELECT COUNT(*) AS total FROM object_gc').first()).total });
  }
  const match = path.match(/^\/api\/(groups|links)(?:\/([\w-]+))?$/);
  if (match) {
    const [, table, id] = match;
    if (id && !await statement(db, `SELECT id FROM ${table} WHERE id=? AND user_id=?`, id, user.id).first()) fail(404, '记录不存在');
    if (method === 'DELETE' && id) { await statement(db, `DELETE FROM ${table} WHERE id=? AND user_id=?`, id, user.id).run(); return json({ ok: true }); }
    if ((method === 'POST' && !id) || (method === 'PUT' && id)) {
      const data = await body(request); const title = str(data.title, '名称', 80); let order = sort(data.sort_order); const newId = id || crypto.randomUUID();
      if (table === 'groups') {
        if (id) await statement(db, 'UPDATE groups SET title=?,sort_order=COALESCE(?,sort_order) WHERE id=? AND user_id=?', title, data.sort_order === undefined ? null : order, id, user.id).run();
        else await statement(db, 'INSERT INTO groups(id,user_id,title,sort_order) VALUES(?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM groups WHERE user_id=?))', newId, user.id, title, user.id).run();
      } else {
        const group = str(data.group_id, '分组', 64);
        if (id && data.sort_order === undefined) { const previous = await statement(db, 'SELECT group_id,sort_order FROM links WHERE id=? AND user_id=?', id, user.id).first(); order = previous.group_id === group ? previous.sort_order : (await statement(db, 'SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM links WHERE group_id=? AND user_id=?', group, user.id).first()).next; }
        const { href, description, icon } = navigationFields(data);
        const imageId = data.image_id ? str(data.image_id, '图片', 64) : null;
        if (imageId && !await statement(db, 'SELECT id FROM images WHERE id=? AND user_id=? AND ready=1', imageId, user.id).first()) fail(400, '图片不存在或不属于当前用户');
        if (!await statement(db, 'SELECT id FROM groups WHERE id=? AND user_id=?', group, user.id).first()) fail(400, '分组不存在');
        if (id) await statement(db, 'UPDATE links SET group_id=?,title=?,url=?,description=?,icon=?,image_id=?,sort_order=? WHERE id=? AND user_id=?', group, title, href, description, icon, imageId, order, id, user.id).run();
        else await statement(db, 'INSERT INTO links(id,user_id,group_id,title,url,description,icon,image_id,sort_order,created_at) VALUES(?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM links WHERE group_id=? AND user_id=?),?)', newId, user.id, group, title, href, description, icon, imageId, group, user.id, now()).run();
      }
      return json({ id: newId }, id ? 200 : 201);
    }
    fail(405, '不支持此请求方式');
  }
  if (path === '/api/users' || path.startsWith('/api/users/')) {
    if (user.role !== 'admin') fail(403, '仅管理员可管理用户');
    const id = path.split('/')[3];
    if (!id && method === 'GET') return json({ users: (await db.prepare('SELECT id,username,display_name,role,disabled,created_at FROM users ORDER BY created_at,id').all()).results });
    if (!id && method === 'POST') {
      const data = await body(request); const uid = crypto.randomUUID(); const name = username(data.username); const display = str(data.display_name, '显示名称', 50); const hashed = await hashPassword(password(data.password));
      if (!['admin', 'user'].includes(data.role)) fail(400, '角色无效');
      await db.batch([statement(db, 'INSERT INTO users(id,username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', uid, name, display, hashed, data.role, now()), statement(db, 'INSERT INTO groups(id,user_id,title) VALUES(?,?,?)', crypto.randomUUID(), uid, '常用网站')]);
      return json({ id: uid }, 201);
    }
    if (id) {
      const target = await statement(db, 'SELECT * FROM users WHERE id=?', id).first(); if (!target) fail(404, '用户不存在');
      if (method === 'DELETE') { if (id === user.id) fail(400, '不能删除当前登录账号'); await statement(db, 'DELETE FROM users WHERE id=?', id).run(); cleanupLater(env, ctx); return json({ ok: true }); }
      if (method === 'PUT') {
        const data = await body(request); const display = str(data.display_name, '显示名称', 50);
        if (!['admin', 'user'].includes(data.role) || typeof data.disabled !== 'boolean') fail(400, '角色或状态无效');
        if (id === user.id && (data.disabled || data.role !== 'admin')) fail(400, '不能禁用自己或取消自己的管理员权限');
        const hashed = data.password ? await hashPassword(password(data.password)) : target.password_hash;
        await db.batch([statement(db, 'UPDATE users SET display_name=?,role=?,disabled=?,password_hash=? WHERE id=?', display, data.role, data.disabled ? 1 : 0, hashed, id), statement(db, 'DELETE FROM sessions WHERE user_id=?', id)]);
        return json({ ok: true, reauthenticate: id === user.id });
      }
    }
    fail(405, '不支持此请求方式');
  }
  fail(404, '接口不存在');
}
export default {
  async fetch(request, env, ctx) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return await api(request, env, ctx); }
    catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      const message = `${error.message} ${error.cause?.message || ''}`;
      if (message.includes('LAST_ADMIN')) return json({ error: '至少保留一个启用的管理员' }, 400);
      if (message.includes('IMAGE_OWNER')) return json({ error: '图片不存在或不属于当前用户' }, 400);
      if (message.includes('IMAGE_QUOTA')) return json({ error: '最多保存 200 张图片，请先删除不需要的图片' }, 400);
      if (message.includes('UNIQUE constraint failed: users.username')) return json({ error: '用户名已存在' }, 409);
      if (message.includes('UNIQUE constraint failed: app_state.key')) return json({ error: '系统已初始化' }, 409);
      if (message.includes('FOREIGN KEY constraint')) return json({ error: '关联记录已变更，请刷新后重试' }, 409);
      console.error('API error:', error);
      return json({ error: '服务暂不可用，请检查 D1 绑定与数据库迁移' }, 500);
    }
  }
};
