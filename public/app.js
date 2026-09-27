import { normalizeWebsite, resolveIcon, navigationPayload, projectBoard } from './navigation-model.js';
const $ = selector => document.querySelector(selector);
const app = $('#app');
const modal = $('#modal');
const management = $('#management');
const gallery = $('#gallery');
const defaultAppearance = { title: 'SmithNav', clock: true, search: false, descriptions: false, layout: 'cards' };
const state = { user: null, groups: [], links: [], images: [], users: [], page: 'board', filter: 'all', search: '', editing: false, initialized: true, searchOpen: false, appearance: { ...defaultAppearance } };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const symbols = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  edit: '<path d="m15 5 4 4M4 20l5-1L21 7l-4-4L5 15Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  arrow: '<path d="M6 18 18 6M7 6h11v11"/>',
  users: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-7 5 8"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  logout: '<path d="M9 4H4v16h5M9 12h12m-5-5 5 5-5 5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 4 2 3 1 4 4 3 3-2 4-1 3-4-2-3-1-4-4-3Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${symbols[name] || symbols.grid}</svg>`;
const action = (name, label, attrs = '', cls = 'secondary', symbol = '') => `<button type="button" class="${cls}" data-action="${name}" ${attrs}>${symbol ? icon(symbol) : ''}${esc(label)}</button>`;
const iconAction = (name, label, id, symbol, danger = false) => `<button type="button" class="icon-button${danger ? ' danger' : ''}" data-action="${name}" data-id="${esc(id)}" aria-label="${esc(label)}" title="${esc(label)}">${icon(symbol)}</button>`;
const brand = '<div class="brand"><span class="brand-symbol">S</span>SmithNav<span class="muted">.</span></div>';
function toast(message) { const el = $('#toast'); el.textContent = message; el.showPopover?.(); el.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.classList.remove('visible'); el.hidePopover?.(); }, 4000); }
async function api(path, method = 'GET', data) {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(data ?? {}) }) });
  const result = await response.json().catch(() => ({ error: '服务响应异常，请刷新重试' }));
  if (!response.ok) {
    if (response.status === 401 && state.user) { state.user = null; modal.close(); management.close(); renderAuth(); }
    throw new Error(result.error || '请求失败');
  }
  return result;
}
async function compressImage(file) {
  if (!file) throw new Error('请选择图片');
  if (file.size > 10 * 1024 * 1024) throw new Error('原始图片不能超过 10 MB');
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(file.type)) throw new Error('请选择 PNG、JPEG、GIF 或 WebP 图片');
  const src = URL.createObjectURL(file); const image = new Image();
  try {
    image.src = src; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40000000) throw new Error('图片尺寸过大或无法读取');
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .82));
    if (!blob || blob.size > 200 * 1024) throw new Error('图片压缩失败，请换一张较小的图片');
    return new File([blob], (file.name || 'site-icon').replace(/\.[^.]+$/, '').slice(0, 140) + (blob.type === 'image/webp' ? '.webp' : '.png'), { type: blob.type });
  } finally { URL.revokeObjectURL(src); }
}
async function upload(file) {
  const compressed = await compressImage(file);
  const response = await fetch('/api/images', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': compressed.type, 'X-File-Name': encodeURIComponent(compressed.name) }, body: compressed });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '上传失败');
  return result.image;
}
async function cleanUnusedImages(protectedIds = []) {
  const latest = (await api('/images')).images;
  const unused = latest.filter(image => !image.uses && !protectedIds.includes(image.id));
  if (!unused.length) { toast('没有可清理的图片'); return false; }
  if (!window.confirm(`确认永久删除 ${unused.length} 张未被导航使用的图片？此操作不可恢复。当前编辑中选择的图片会保留。`)) return false;
  const result = await api('/images/cleanup', 'POST', { ids: unused.map(image => image.id) });
  state.images = (await api('/images')).images;
  toast(`已清理 ${result.deleted} 张未使用图片`);
  return true;
}
async function migrateImages() {
  const images = (await api('/images')).images.filter(image => image.storage === 'r2');
  let count = 0;
  for (const image of images) {
    const response = await fetch(imageSrc(image.id));
    if (!response.ok) throw new Error(`已迁移 ${count} 张；${image.filename} 读取失败，请检查旧 R2 绑定后重试`);
    const file = await compressImage(new File([await response.blob()], image.filename, { type: image.content_type }));
    const saved = await fetch(imageSrc(image.id), { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!saved.ok) throw new Error(`已迁移 ${count} 张；${(await saved.json()).error || '保存失败'}`);
    count++; toast(`已迁移 ${count} / ${images.length} 张图片`);
  }
  await loadPage('images'); toast(`已迁移 ${count} 张图片到 D1`);
}
const imageSrc = id => `/api/images/${encodeURIComponent(id)}`;
function siteIcon(link) {
  const appearance = resolveIcon(link);
  const content = appearance.source
    ? `<img src="${esc(appearance.source)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : esc(appearance.text);
  return `<span class="site-icon tile-tone-${appearance.tone}">${content}</span>`;
}
function field(label, name, value = '', options = {}) {
  return `<label class="field">${esc(label)}<input name="${name}" aria-label="${esc(label)}" type="${options.type || 'text'}" value="${esc(value)}" ${options.required === false ? '' : 'required'} ${options.attrs || ''} placeholder="${esc(options.placeholder || '')}">${options.hint ? `<small>${esc(options.hint)}</small>` : ''}</label>`;
}
function errorBox() { return '<div class="error" role="alert"></div>'; }
function setError(form, error) { const box = form.querySelector('.error'); if (box) box.textContent = error.message; else toast(error.message); }
function bindForm(form, handler) {
  form.addEventListener('submit', async event => {
    event.preventDefault(); const button = form.querySelector('[type="submit"]'); if (button.disabled) return;
    button.disabled = true; const box = form.querySelector('.error'); if (box) box.textContent = '';
    try { await handler(Object.fromEntries(new FormData(form))); } catch (error) { setError(form, error); } finally { button.disabled = false; }
  });
}
function renderAuth() {
  management.close();
  document.body.classList.add('auth-view');
  const setup = !state.initialized;
  app.innerHTML = `<main class="auth-page"><form class="auth-form"><div class="auth-brand">SmithNav</div><h1>${setup ? '创建你的导航空间' : '欢迎回来'}</h1><p>${setup ? '首次使用，请设置管理员账号。' : '登录，打开属于你的导航桌面。'}</p>${setup ? field('初始化密钥', 'setup_token', '', { type: 'password', attrs: 'autocomplete="off" minlength="24"', hint: '填写部署时配置的 SETUP_TOKEN。' }) : ''}${field('用户名', 'username', '', { attrs: 'autocomplete="username" minlength="3" maxlength="40"', placeholder: '账号' })}${setup ? field('显示名称', 'display_name', '', { attrs: 'maxlength="50"', placeholder: '如何称呼你' }) : ''}${field('密码', 'password', '', { type: 'password', attrs: `autocomplete="${setup ? 'new-password' : 'current-password'}" maxlength="128" ${setup ? 'minlength="12"' : ''}`, placeholder: setup ? '至少 12 个字符' : '密码' })}${errorBox()}<button type="submit" class="primary">${setup ? '创建管理员账号' : '登录导航空间'}</button><div class="auth-foot">${setup ? '仅初始化一次 · 无默认账号或密码' : '账号由管理员创建 · 导航按用户独立保存'}</div><div class="auth-credit">Powered by SmithNav</div></form></main>`;
  bindForm($('.auth-form'), async data => {
    if (setup) { await api('/setup', 'POST', data); state.initialized = true; renderAuth(); toast('管理员已创建，请登录'); }
    else { const { user } = await api('/login', 'POST', data); state.user = user; resetBoard(); await loadPage(); }
  });
}
function readAppearance() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(`smithnav:appearance:${state.user.id}`)) || {}; } catch {}
  return { title: typeof saved.title === 'string' && saved.title.trim() ? saved.title.trim().slice(0, 40) : 'SmithNav', clock: saved.clock !== false, search: saved.search === true, descriptions: saved.descriptions === true, layout: saved.layout === 'icons' ? 'icons' : 'cards' };
}
function resetBoard() {
  sortDraft = null; closeLinkMenu();
  state.groups = []; state.links = []; state.images = []; state.users = [];
  state.filter = 'all'; state.search = ''; state.editing = false; state.page = 'board';
  state.appearance = state.user ? readAppearance() : { ...defaultAppearance };
  state.searchOpen = state.appearance.search;
}
const pageNames = { board: '我的导航', appearance: '个性化设置', groups: '分组管理', images: '图片库', users: '用户管理', backup: '导入导出', settings: '账号设置' };
function navButton(page, symbol) { return `<button type="button" data-action="page" data-page="${page}" class="${state.page === page ? 'active' : ''}" ${state.page === page ? 'aria-current="page"' : ''}>${icon(symbol)}${pageNames[page]}</button>`; }
function closeManagement() {
  management.close(); state.page = 'board';
}
function shell() {
  closeLinkMenu();
  document.body.classList.remove('auth-view');
  app.innerHTML = `<div class="desktop"><nav class="floating-tools" aria-label="导航工具">${iconAction('toggle-search', '搜索导航', '', 'search')}${iconAction('toggle-edit', state.editing ? '完成编辑' : '管理导航', '', state.editing ? 'check' : 'edit')}${iconAction('new-link', '添加导航', '', 'plus')}${iconAction('manager', '系统应用', '', 'grid')}</nav><header class="desktop-heading"><h1>${esc(state.appearance.title)}</h1>${state.appearance.clock ? '<span class="title-divider" aria-hidden="true"></span><div class="clock"><time id="clock-time"></time><span id="clock-date"></span></div>' : ''}</header><main class="main" id="main"></main></div>`;
  renderHome();
  if (state.page === 'board') { management.close(); return; }
  management.innerHTML = `<header class="management-header"><h2 id="management-title">${icon('grid')}系统应用</h2>${iconAction('close-management', '关闭系统应用', '', 'close')}</header><div class="management-layout"><aside class="management-sidebar"><nav class="side-nav" aria-label="系统应用">${navButton('board', 'grid')}${navButton('appearance', 'sun')}${navButton('groups', 'folder')}${navButton('images', 'image')}${state.user.role === 'admin' ? navButton('users', 'users') : ''}${navButton('backup', 'folder')}${navButton('settings', 'settings')}</nav><div class="profile"><span class="avatar">${esc([...state.user.display_name][0])}</span><div class="profile-copy"><strong>${esc(state.user.display_name)}</strong><span>${state.user.role === 'admin' ? '管理员' : '普通用户'}</span></div>${iconAction('logout', '退出登录', '', 'logout')}</div></aside><section id="manager-content" aria-label="管理内容"></section></div>`;
  renderPage();
  if (!management.open) management.showModal();
}
function updateClock() {
  const time = $('#clock-time'); if (!time) return;
  const date = new Date();
  time.textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  time.dateTime = date.toISOString();
  $('#clock-date').textContent = `${date.getMonth() + 1}-${date.getDate()} ${new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(date)}`;
}
function renderHome() {
  const main = $('#main');
  main.innerHTML = `<section class="search-panel" ${state.searchOpen ? '' : 'hidden'} aria-label="查找导航"><div class="search-box">${icon('search')}<label class="sr-only" for="search">搜索导航</label><input id="search" type="search" placeholder="搜索网站、描述或网址…" value="${esc(state.search)}" autocomplete="off">${iconAction('toggle-search', '收起搜索', '', 'close')}</div></section>${state.editing ? `<div class="edit-toolbar"><span>${icon('edit')}正在编辑导航</span><div>${action('new-group', '新建分组', '', 'secondary', 'folder')}${action('new-link', '添加导航', '', 'secondary', 'plus')}${action('toggle-edit', '完成编辑', '', 'primary', 'check')}</div></div>` : ''}<div id="board-content" class="${state.appearance.layout === 'icons' ? 'icon-layout' : ''} ${state.appearance.descriptions ? 'with-descriptions' : ''}"></div>${footer()}`;
  $('#search').addEventListener('input', event => { state.search = event.target.value; renderBoard(); });
  renderBoard(); updateClock();
}

async function loadPage(page = state.page) {
  if (page === 'users' && state.user.role !== 'admin') page = 'board';
  const board = await api('/board'); Object.assign(state, board);
  if (page === 'users') state.users = (await api('/users')).users;
  if (page === 'images') { const data = await api('/images'); state.images = data.images; state.storageAvailable = data.available; state.legacyAvailable = data.legacyAvailable; }
  state.page = page;
  if (!state.groups.some(g => g.id === state.filter)) state.filter = 'all';
  shell();
}
function footer() { return '<footer class="footer">Powered by SmithNav</footer>'; }
function heading(eyebrow, title, description, actions = '') { return `<div class="heading"><div><div class="eyebrow">${eyebrow}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="heading-actions">${actions}</div></div>`; }
function renderPage() {
  if (state.page === 'board') { renderHome(); return; }
  const main = $('#manager-content');
  if (state.page === 'appearance') {
    const prefs = state.appearance;
    main.innerHTML = `${heading('', '个性化设置', '调整导航桌面的显示方式。设置按账号保存在当前浏览器。')}<form id="appearance-form"><section class="settings-panel"><h2>标题与时钟</h2>${field('桌面标题', 'title', prefs.title, { attrs: 'maxlength="40"' })}<label class="check"><input type="checkbox" name="clock" ${prefs.clock ? 'checked' : ''}>显示时钟与日期</label></section><section class="settings-panel"><h2>导航卡片</h2><label class="field">卡片风格<select name="layout"><option value="cards" ${prefs.layout === 'cards' ? 'selected' : ''}>详情图标</option><option value="icons" ${prefs.layout === 'icons' ? 'selected' : ''}>极简图标</option></select></label><label class="check"><input type="checkbox" name="descriptions" ${prefs.descriptions ? 'checked' : ''}>显示网站描述</label><label class="check"><input type="checkbox" name="search" ${prefs.search ? 'checked' : ''}>默认展开搜索栏</label></section>${errorBox()}<div class="modal-actions">${action('reset-appearance', '恢复默认')}<button type="submit" class="primary">保存外观</button></div></form>`;
    bindForm($('#appearance-form'), async data => {
      const prefs = { title: data.title.trim(), layout: data.layout, clock: data.clock === 'on', descriptions: data.descriptions === 'on', search: data.search === 'on' };
      if (!prefs.title) throw new Error('请输入桌面标题');
      try { localStorage.setItem(`smithnav:appearance:${state.user.id}`, JSON.stringify(prefs)); } catch { throw new Error('浏览器不允许保存设置，请检查存储权限'); }
      state.appearance = prefs; state.searchOpen = prefs.search; state.search = ''; state.filter = 'all';
      shell(); toast('外观已保存');
    });
  } else if (state.page === 'groups') {
    main.innerHTML = `${heading('A PLACE FOR EVERYTHING', '分组管理', '拖动左侧手柄调整分组顺序，松开后自动保存。新分组默认排在最后。', action('new-group', '新建分组', '', 'primary', 'plus'))}<div class="table-wrap"><table><thead><tr><th aria-label="拖动排序"></th><th>分组名称</th><th>导航数量</th><th>操作</th></tr></thead><tbody>${state.groups.map(group => `<tr data-group-row="${esc(group.id)}"><td><button type="button" class="icon-button group-drag-handle" data-group-drag="${esc(group.id)}" aria-label="拖动排序 ${esc(group.title)}" title="拖动排序；也可使用右侧上移、下移按钮">${icon('menu')}</button></td><td>${esc(group.title)}</td><td>${state.links.filter(link => link.group_id === group.id).length}</td><td><div class="table-actions">${iconAction('group-up', '上移 ' + group.title, group.id, 'arrow')}${iconAction('group-down', '下移 ' + group.title, group.id, 'arrow')}${iconAction('edit-group', '编辑分组', group.id, 'edit')}${iconAction('delete-group', '删除分组', group.id, 'trash', true)}</div></td></tr>`).join('')}</tbody></table></div>${state.groups.length ? '' : '<div class="empty"><p>还没有分组，点击右上角新建一个吧。</p></div>'}${footer()}`;
  } else if (state.page === 'images') {
    const bytes = state.images.reduce((sum, image) => sum + image.size, 0);
    main.innerHTML = `${heading('MAKE IT RECOGNIZABLE', '图片库', '给每个网站一个熟悉的面孔。上传的图片可在导航编辑时重复使用。', `${action('clean-unused-images', '清理未使用图片', '', 'secondary', 'trash')}<label class="primary upload-label">${icon('upload')}上传图片<input type="file" id="library-upload" accept="image/png,image/jpeg,image/gif,image/webp"></label>`)}<div class="storage-info">${state.storageAvailable ? `${state.images.length} / 200 张图片 · 已使用 ${(bytes / 1024 / 1024).toFixed(2)} MB · 保存后单张 ≤ 200 KB · 自动缩小至 256 像素 · D1 存储` : '图片保存在 D1 数据库。'}</div>${state.images.length ? `<div class="image-grid">${state.images.map(image => `<article class="image-tile"><div class="image-preview"><img src="${imageSrc(image.id)}" alt="${esc(image.filename)}" loading="lazy"></div><div class="image-info"><div><strong title="${esc(image.filename)}">${esc(image.filename)}</strong><small>${(image.size / 1024).toFixed(1)} KB · ${image.uses ? `${image.uses} 个导航使用中` : '尚未使用'}</small></div>${iconAction('delete-image', '删除图片', image.id, 'trash', true)}</div></article>`).join('')}</div>` : `<div class="empty">${icon('image')}<h3>让收藏更有辨识度</h3><p>上传网站 Logo 或图片。图片压缩后保存在 D1，只有登录你的账号后才能访问。</p></div>`}${state.images.some(image => image.storage === 'r2') ? `<div class="summary">${action('migrate-images', '迁移旧图片到 D1')}<span>需临时保留旧 R2 绑定；已迁移图片不会重复处理。</span></div>` : ''}${state.user.role === 'admin' && state.legacyAvailable ? `<div class="summary">${action('cleanup', '重试待清理文件', '', 'secondary', 'trash')}<span>用于重试之前未完成的 R2 文件删除</span></div>` : ''}${footer()}`;
    $('#library-upload').addEventListener('change', async event => {
      const input = event.target; const file = input.files[0]; if (!file) return; input.disabled = true; toast('正在上传图片…');
      try { await upload(file); await loadPage('images'); toast('图片已压缩并保存到 D1'); } catch (error) { toast(error.message); } finally { input.disabled = false; input.value = ''; }
    });
  } else if (state.page === 'backup') {
    main.innerHTML = `${heading('', '导入导出', '备份当前账号的分组、导航、文字图标、在线图标地址和导航使用的图片。')}<section class="settings-panel"><h2>导出配置</h2><p>下载 JSON 文件，不包含账号密码和其他用户的数据。</p>${action('export-config', '导出配置', '', 'primary')}</section><section class="settings-panel"><h2>导入配置</h2><p>仅支持 SmithNav 导出的 JSON 文件（最大 16 MB）。追加会保留现有导航，同名分组也会新建；覆盖会替换当前账号的全部分组和导航。两种方式均保留图库图片，相同图片会复用。重复追加会再次添加导航。</p><label class="field">导入方式<select id="import-mode"><option value="append">追加（保留现有导航）</option><option value="replace">覆盖（替换全部导航）</option></select></label><label class="primary upload-label">${icon('upload')}选择配置文件<input id="config-import" type="file" accept=".json,application/json"></label></section>`;
    $('#config-import').onchange = async event => {
      const input = event.target, file = input.files[0]; if (!file) return; input.disabled = true;
      try {
        if (file.size > 16 * 1024 * 1024) throw new Error('配置文件不能超过 16 MB');
        let data; try { data = JSON.parse(await file.text()); } catch { throw new Error('配置文件不是有效的 JSON'); }
        if (data?.format !== 'SmithNav' || !Array.isArray(data.groups) || !Array.isArray(data.links)) throw new Error('请选择 SmithNav 导出的配置文件');
        const mode = $('#import-mode').value;
        if (!window.confirm(`${mode === 'replace' ? '覆盖将永久替换当前账号全部分组和导航。' : '现有内容会保留。'}确认${mode === 'replace' ? '覆盖' : '追加'}导入 ${data.groups.length} 个分组、${data.links.length} 个导航？`)) return;
        toast('正在导入…'); const result = await api('/backup', 'POST', { mode, backup: data }); await loadPage('backup'); toast(`已导入 ${result.groups} 个分组、${result.links} 个导航`);
      } catch (error) { toast(error.message); } finally { input.disabled = false; input.value = ''; }
    };
  } else if (state.page === 'users') {
    main.innerHTML = `${heading('A SPACE FOR EVERYONE', '用户管理', '创建账号，分配角色。每位用户拥有独立的导航、分组和图片库。', action('new-user', '添加用户', '', 'primary', 'plus'))}<div class="table-wrap"><table><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>创建日期</th><th>操作</th></tr></thead><tbody>${state.users.map(user => `<tr><td>${esc(user.display_name)}${user.id === state.user.id ? '（我）' : ''}<small>@${esc(user.username)}</small></td><td>${user.role === 'admin' ? '管理员' : '普通用户'}</td><td><span class="badge ${user.disabled ? 'off' : ''}">${user.disabled ? '已禁用' : '正常'}</span></td><td>${new Date(user.created_at * 1000).toLocaleDateString('zh-CN')}</td><td><div class="table-actions">${iconAction('edit-user', '编辑用户', user.id, 'edit')}${user.id !== state.user.id ? iconAction('delete-user', '删除用户', user.id, 'trash', true) : ''}</div></td></tr>`).join('')}</tbody></table></div>${footer()}`;
  } else {
    main.innerHTML = `${heading('KEEP YOUR SPACE SAFE', '账号设置', `当前账号：${state.user.username}`)}<form class="settings-panel" id="password-form"><h2>修改密码</h2><p>修改后，所有设备的登录状态都会失效，需要使用新密码重新登录。</p>${field('当前密码', 'current_password', '', { type: 'password', attrs: 'autocomplete="current-password" maxlength="128"' })}${field('新密码', 'new_password', '', { type: 'password', attrs: 'autocomplete="new-password" minlength="12" maxlength="128"', hint: '至少 12 个字符，建议使用独特的长密码。' })}${field('确认新密码', 'confirm_password', '', { type: 'password', attrs: 'autocomplete="new-password" minlength="12" maxlength="128"' })}${errorBox()}<button type="submit" class="primary">保存新密码</button></form>${footer()}`;
    bindForm($('#password-form'), async data => { if (data.new_password !== data.confirm_password) throw new Error('两次输入的新密码不一致'); await api('/password', 'PUT', data); state.user = null; resetBoard(); renderAuth(); toast('密码已修改，请重新登录'); });
  }
}
let sortDraft = null;
function renderBoard() {
  const { query, count, sections: groups } = projectBoard({ ...state, draft: sortDraft });
  $('#board-content').innerHTML = `<div class="filter-row" ${state.searchOpen || state.editing ? '' : 'hidden'}><div class="filter-tabs" aria-label="筛选分组"><button data-action="filter" data-id="all" class="${state.filter === 'all' ? 'active' : ''}">全部导航</button>${state.groups.map(group => `<button data-action="filter" data-id="${esc(group.id)}" class="${state.filter === group.id ? 'active' : ''}">${esc(group.title)}</button>`).join('')}</div><span class="muted">${count} 个导航 · ${state.groups.length} 个分组</span></div>${groups.map(group => `<section class="section ${sortDraft?.groupId === group.id ? 'sorting-section' : ''}"><div class="section-heading"><h2>${esc(group.title)}</h2><span class="number">${group.links.length.toString().padStart(2, '0')}</span><span class="rule"></span>${state.editing ? iconAction('edit-group', '编辑分组', group.id, 'edit') : ''}<div class="group-actions">${iconAction('new-link', '向此分组添加导航', group.id, 'plus')}${iconAction('sort-links', '排序此分组导航', group.id, 'menu')}</div></div>${sortDraft?.groupId === group.id ? `<div class="sort-toolbar"><span>拖动卡片排序，也可使用前移、后移按钮</span>${action('save-sort', '保存排序', '', 'primary')}${action('cancel-sort', '取消排序')}</div>` : ''}<div class="cards ${state.editing ? 'editing' : ''}">${group.links.map(link => `<article class="link-card" data-link-id="${esc(link.id)}" draggable="${sortDraft?.groupId === group.id ? 'true' : 'false'}"><a class="card-anchor" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" title="${esc(link.description || link.url)}">${siteIcon(link)}<div class="card-copy"><h3>${esc(link.title)}</h3><p>${esc(link.description || new URL(link.url).hostname)}</p></div>${icon('arrow').replace('<svg ', '<svg class="card-arrow" ')}</a>${sortDraft?.groupId === group.id ? `<div class="card-tools sort-controls">${iconAction('sort-prev', '前移 ' + link.title, link.id, 'arrow')}${iconAction('sort-next', '后移 ' + link.title, link.id, 'arrow')}</div>` : !state.editing ? `<div class="card-more">${iconAction('link-menu', '更多操作 ' + link.title, link.id, 'menu')}</div>` : ''}${state.editing ? `<div class="card-tools">${iconAction('edit-link', '编辑 ' + link.title, link.id, 'edit')}${iconAction('delete-link', '删除 ' + link.title, link.id, 'trash', true)}</div>` : ''}</article>`).join('')}${state.editing || !group.links.length ? action('new-link', '添加一个导航', `data-id="${esc(group.id)}"`, 'add-card', 'plus') : ''}</div></section>`).join('')}${!groups.length ? `<div class="empty">${icon(query ? 'search' : 'grid')}<h3>${query ? '没有找到相关导航' : '从一个喜欢的网站开始'}</h3><p>${query ? '试试其他关键词，或者切换到全部导航。' : '先创建分组，再添加网站。把常用的工具、灵感和生活收藏在这里。'}</p>${query ? '' : action('new-group', '创建第一个分组', '', 'primary', 'plus')}</div>` : ''}`;
}
function showModal(title, content, handler, submitLabel = '保存') {
  modal.innerHTML = `<div class="modal-header"><h2 id="modal-title">${esc(title)}</h2>${iconAction('close-modal', '关闭', '', 'close')}</div><form class="modal-body">${content}${errorBox()}<div class="modal-actions">${action('close-modal', '取消')}<button type="submit" class="primary">${esc(submitLabel)}</button></div></form>`;
  if (!modal.open) modal.showModal();
  bindForm(modal.querySelector('form'), handler);
}

async function linkDialog(id, groupId) {
  if (!state.groups.length) { toast('请先创建一个分组'); groupDialog(); return; }
  const link = state.links.find(item => item.id === id) || { title: '', url: '', description: '', icon: '', image_id: null, group_id: groupId || (state.filter !== 'all' ? state.filter : state.groups[0].id), sort_order: 0 };
  state.images = (await api('/images')).images;
  let selectedImage = link.image_id;
  let mode = selectedImage ? 'image' : /^https?:\/\//i.test(link.icon || '') ? 'online' : 'text';
  let busy = false;
  showModal(id ? '编辑导航' : '添加导航', `
    <div class="preview-options"><label><input id="show-link-preview" type="checkbox" checked> 效果预览（仅供参考）</label><label><input id="transparent-preview" type="checkbox"> 画布透明</label></div>
    <div id="link-live-preview" class="link-live-preview"></div>
    <div class="field"><span>图标风格</span><div class="icon-style-tabs" role="tablist" aria-label="图标风格"><button type="button" role="tab" data-mode="text">文字</button><button type="button" role="tab" data-mode="image">图片</button><button type="button" role="tab" data-mode="online">在线图片</button></div></div>
    <div id="icon-text-panel">${field('图标文字', 'icon_text', mode === 'text' ? link.icon : '', { required: false, placeholder: '文字或 Emoji，最多 8 个字符' })}</div>
    <div id="icon-image-panel"><label class="field">已选图片<div class="image-source-row"><input id="selected-image-name" readonly placeholder="尚未选择图片"><button type="button" class="secondary" id="open-image-library">${icon('image')}图库</button><label class="secondary upload-label">${icon('upload')}本地上传<input id="link-upload" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/x-icon,.ico"></label></div></label></div>
    <div id="icon-online-panel">${field('在线图片地址', 'icon_url', mode === 'online' ? link.icon : '', { required: false, type: 'url', placeholder: 'https://example.com/logo.png' })}</div>
    <div class="field-row">${field('网站名称', 'title', link.title, { attrs: 'maxlength="80"' })}${field('描述（选填）', 'description', link.description, { required: false, attrs: 'maxlength="300"' })}</div>
    <label class="field">网站地址<span class="website-address-row"><input name="url" aria-label="网站地址" type="text" inputmode="url" required maxlength="2048" value="${esc(link.url)}" placeholder="https://example.com"><button type="button" class="secondary" id="fetch-site-icon">获取图标</button></span></label>
    <small class="icon-help">优先读取网站图标，失败时使用 Google 图标服务（仅发送域名）。获取后自动保存到图库。上传图片自动压缩，动图保存为静态图。</small>
    <div class="field-row"><label class="field">所属分组<select name="group_id">${state.groups.map(group => `<option value="${group.id}" ${group.id === link.group_id ? 'selected' : ''}>${esc(group.title)}</option>`).join('')}</select></label></div>`, async values => {
      if (busy) return;
      const payload = navigationPayload(values, mode, selectedImage);
      await api(`/links${id ? '/' + id : ''}`, id ? 'PUT' : 'POST', payload);
      modal.close(); await loadPage(); toast(id ? '导航已更新' : '导航已添加');
    });
  modal.classList.add('link-editor');
  const form = modal.querySelector('form');
  form.elements.url.addEventListener('blur', () => { form.elements.url.value = normalizeWebsite(form.elements.url.value); });
  const preview = form.querySelector('#link-live-preview');
  const buttons = [form.querySelector('[type="submit"]'), form.querySelector('#link-upload'), form.querySelector('#fetch-site-icon')];
  function refresh() {
    if (!form.isConnected) return;
    for (const type of ['text','image','online']) form.querySelector(`#icon-${type}-panel`).hidden = mode !== type;
    form.querySelectorAll('[data-mode]').forEach(button => { button.setAttribute('aria-selected', String(button.dataset.mode === mode)); });
    form.elements.icon_url.disabled = mode !== 'online';
    form.querySelector('#selected-image-name').value = state.images.find(image => image.id === selectedImage)?.filename || '';
    const draft = { title: form.elements.title.value || '网站名称', image_id: mode === 'image' ? selectedImage : null, icon: mode === 'text' ? form.elements.icon_text.value : mode === 'online' ? form.elements.icon_url.value : '' };
    if (mode === 'online' && !/^https?:\/\//i.test(draft.icon)) draft.icon = '';
    preview.innerHTML = `<div class="preview-card">${siteIcon(draft)}<div><strong>${esc(draft.title)}</strong><small>${esc(form.elements.description.value)}</small></div></div><div class="preview-tile">${siteIcon(draft)}<strong>${esc(draft.title)}</strong></div>`;
    preview.hidden = !form.querySelector('#show-link-preview').checked;
    preview.classList.toggle('transparent', form.querySelector('#transparent-preview').checked);
  }
  form.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { mode = button.dataset.mode; refresh(); }));
  form.addEventListener('input', refresh);
  form.querySelector('#open-image-library').addEventListener('click', () => {
    let pending = selectedImage;
    gallery.innerHTML = `<header class="gallery-header"><h2 id="gallery-title">图库</h2><input type="search" id="gallery-search" aria-label="搜索图库" placeholder="搜索图标名称"><button type="button" class="icon-button" id="gallery-close" aria-label="关闭图库">${icon('close')}</button></header><div id="gallery-grid" class="gallery-grid"></div><footer class="gallery-footer"><span id="gallery-selection"></span><button type="button" class="secondary" id="gallery-clean-unused">清理未使用图片</button><button type="button" class="secondary" id="gallery-clear">不使用图片</button><button type="button" class="secondary" id="gallery-cancel">取消</button><button type="button" class="primary" id="gallery-confirm">确定</button></footer>`;
    function renderGallery() {
      const query = gallery.querySelector('#gallery-search').value.trim().toLowerCase();
      const images = state.images.filter(image => image.filename.toLowerCase().includes(query));
      gallery.querySelector('#gallery-grid').innerHTML = images.length ? images.map(image => `<article class="gallery-item ${pending === image.id ? 'selected' : ''}"><div class="gallery-thumbnail"><img src="${imageSrc(image.id)}" alt="${esc(image.filename)}" loading="lazy"></div><strong title="${esc(image.filename)}">${esc(image.filename)}</strong><button type="button" class="secondary" data-gallery-pick="${image.id}" aria-label="选择 ${esc(image.filename)}" aria-pressed="${pending === image.id}">${pending === image.id ? '已选择' : '选择'}</button></article>`).join('') : '<p class="gallery-empty">没有找到图标，可返回编辑窗口本地上传。</p>';
      gallery.querySelector('#gallery-selection').textContent = pending ? `已选：${state.images.find(image => image.id === pending)?.filename || ''}` : '未选择图片';
    }
    gallery.querySelector('#gallery-search').addEventListener('input', renderGallery);
    gallery.querySelector('#gallery-grid').addEventListener('click', event => { const button = event.target.closest('[data-gallery-pick]'); if (!button) return; pending = button.dataset.galleryPick; renderGallery(); });
    gallery.querySelector('#gallery-clear').onclick = () => { pending = null; renderGallery(); };
    for (const selector of ['#gallery-close','#gallery-cancel']) gallery.querySelector(selector).onclick = () => gallery.close();
    gallery.querySelector('#gallery-clean-unused').onclick = async event => {
      const button = event.currentTarget; button.disabled = true;
      try { if (await cleanUnusedImages([selectedImage, pending].filter(Boolean))) { renderGallery(); refresh(); } }
      catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    };
    gallery.querySelector('#gallery-confirm').onclick = () => { selectedImage = pending; refresh(); gallery.close(); };
    renderGallery(); gallery.showModal();
  });
  async function saveImage(file) {
    const image = await upload(file); state.images = [image, ...state.images.filter(item => item.id !== image.id)];
    if (!form.isConnected) return;
    selectedImage = image.id; mode = 'image'; refresh(); toast('图标已保存');
  }
  async function imageTask(task) {
    if (busy) return;
    busy = true; buttons.forEach(button => button.disabled = true); form.querySelector('.error').textContent = '';
    try { await task(); } catch (error) { setError(form, error); }
    finally { busy = false; buttons.forEach(button => button.disabled = false); }
  }
  form.querySelector('#link-upload').addEventListener('change', event => { const file = event.target.files[0]; if (file) imageTask(() => saveImage(file)); event.target.value = ''; });
  form.querySelector('#fetch-site-icon').addEventListener('click', () => imageTask(async () => {
    form.elements.url.value = normalizeWebsite(form.elements.url.value);
    if (!form.elements.url.value || !form.elements.url.checkValidity()) throw new Error('请先填写有效的网站地址');
    toast('正在获取网站图标…');
    const response = await fetch('/api/site-icon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: form.elements.url.value }) });
    if (!response.ok) throw new Error((await response.json()).error || '图标获取失败，请本地上传');
    const blob = await response.blob(); if (!form.isConnected) return;
    await saveImage(new File([blob], 'site-icon', { type: blob.type }));
  }));
  refresh();
}
function groupDialog(id) {
  const group = state.groups.find(item => item.id === id) || { title: '', sort_order: 0 };
  showModal(id ? '编辑分组' : '新建分组', field('分组名称', 'title', group.title, { attrs: 'maxlength="80"', placeholder: '例如：设计灵感' }), async values => {
    await api(`/groups${id ? '/' + id : ''}`, id ? 'PUT' : 'POST', { title: values.title });
    modal.close(); await loadPage(); toast('分组已保存');
  });
}
function userDialog(id) {
  const user = state.users.find(item => item.id === id) || { username: '', display_name: '', role: 'user', disabled: 0 };
  showModal(id ? '编辑用户' : '添加用户', `${id ? `<p>账号：${esc(user.username)}。保存后，此用户需要重新登录。</p>` : field('用户名', 'username', '', { attrs: 'minlength="3" maxlength="40" pattern="[a-zA-Z0-9_.\\-]+"', hint: '3–40 个字母、数字、点、下划线或短横线。' })}${field('显示名称', 'display_name', user.display_name, { attrs: 'maxlength="50"' })}${field(id ? '重置密码（留空不修改）' : '初始密码', 'password', '', { type: 'password', required: !id, attrs: 'minlength="12" maxlength="128" autocomplete="new-password"', hint: '至少 12 个字符。' })}<label class="field">角色<select name="role"><option value="user" ${user.role === 'user' ? 'selected' : ''}>普通用户</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>管理员</option></select></label>${id ? `<label class="check"><input type="checkbox" name="disabled" ${user.disabled ? 'checked' : ''}>禁用账号（保留数据，禁止登录）</label>` : ''}`, async values => {
    const result = await api(`/users${id ? '/' + id : ''}`, id ? 'PUT' : 'POST', { ...values, disabled: values.disabled === 'on' });
    modal.close(); if (result.reauthenticate) { state.user = null; resetBoard(); renderAuth(); toast('账号已更新，请重新登录'); } else { await loadPage('users'); toast(id ? '用户已更新' : '用户已创建'); }
  });
}
function confirmDelete(title, description, path) {
  showModal(title, `<p>${esc(description)}</p>`, async () => { await api(path, 'DELETE'); modal.close(); await loadPage(); toast('已删除'); }, '确认删除');
}
async function handleAction(button) {
  const { action: name, id, page } = button.dataset;
  if (name !== 'link-menu') closeLinkMenu();
  if (sortDraft && !['sort-prev', 'sort-next', 'save-sort', 'cancel-sort'].includes(name)) { toast('请先保存或取消当前排序'); return; }
  switch (name) {
    case 'link-menu': { const rect = button.getBoundingClientRect(); openLinkMenu(id, rect.right, rect.bottom); break; }
    case 'open-new': window.open(state.links.find(l => l.id === id).url, '_blank', 'noopener,noreferrer'); break;
    case 'open-current': location.assign(state.links.find(l => l.id === id).url); break;
    case 'copy-link': await navigator.clipboard.writeText(state.links.find(l => l.id === id).url); toast('网址已复制'); break;
    case 'sort-links':
      if (sortDraft) { toast('请先保存或取消当前排序'); break; }
      state.search = ''; state.filter = 'all';
      sortDraft = { groupId: id, ids: state.links.filter(l => l.group_id === id).map(l => l.id) }; renderHome(); break;
    case 'sort-prev': case 'sort-next': {
      const from = sortDraft.ids.indexOf(id); const to = from + (name === 'sort-prev' ? -1 : 1);
      if (to >= 0 && to < sortDraft.ids.length) { sortDraft.ids.splice(to, 0, sortDraft.ids.splice(from, 1)[0]); renderBoard(); document.querySelector(`[data-action="${name}"][data-id="${id}"]`)?.focus(); } break;
    }
    case 'cancel-sort': sortDraft = null; renderBoard(); break;
    case 'group-up':
    case 'group-down': {
      const index = state.groups.findIndex(group => group.id === id);
      const target = state.groups[index + (name === 'group-up' ? -1 : 1)];
      if (target) await moveGroup(id, target.id); break;
    }
    case 'save-sort': await api('/links/reorder', 'PUT', { group_id: sortDraft.groupId, ids: sortDraft.ids }); sortDraft = null; await loadPage(); toast('排序已保存'); break;
    case 'export-config': {
      const data = await api('/backup');
      const href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = href; anchor.download = `SmithNav-${state.user.username}-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(href), 1000); toast('配置已导出'); break;
    }
    case 'manager': await loadPage('settings'); break;
    case 'close-management': closeManagement(); break;
    case 'toggle-search': state.searchOpen = !state.searchOpen; if (!state.searchOpen) { state.search = ''; state.filter = 'all'; } renderHome(); if (state.searchOpen) $('#search').focus(); break;
    case 'reset-appearance': {
      try { localStorage.removeItem(`smithnav:appearance:${state.user.id}`); } catch { throw new Error('浏览器不允许保存设置'); }
      state.appearance = { ...defaultAppearance }; state.searchOpen = false; state.search = ''; state.filter = 'all'; shell(); toast('已恢复默认外观'); break;
    }
    case 'page': await loadPage(page); break;
    case 'filter': state.filter = id; renderBoard(); break;
    case 'toggle-edit': state.editing = !state.editing; shell(); break;
    case 'close-modal': modal.close(); break;
    case 'new-link': await linkDialog(null, id); break;
    case 'edit-link': await linkDialog(id); break;
    case 'new-group': groupDialog(); break;
    case 'edit-group': groupDialog(id); break;
    case 'new-user': userDialog(); break;
    case 'edit-user': userDialog(id); break;
    case 'delete-link': confirmDelete('删除导航', `确认删除“${state.links.find(item => item.id === id).title}”？已上传的图片仍保留在图片库中。`, `/links/${id}`); break;
    case 'delete-group': confirmDelete('删除分组', `确认删除“${state.groups.find(item => item.id === id).title}”？其中的 ${state.links.filter(item => item.group_id === id).length} 个导航也会被删除，此操作不可恢复。`, `/groups/${id}`); break;
    case 'delete-user': confirmDelete('删除用户', `确认删除用户“${state.users.find(item => item.id === id).display_name}”？其所有导航、分组和上传图片将一起删除，此操作不可恢复。`, `/users/${id}`); break;
    case 'delete-image': confirmDelete('删除图片', '确认永久删除这张图片？正在被导航使用的图片需要先解除引用。', `/images/${id}`); break;
    case 'logout': await api('/logout', 'POST'); state.user = null; resetBoard(); renderAuth(); break;
    case 'migrate-images': await migrateImages(); break;
    case 'clean-unused-images': if (await cleanUnusedImages()) await loadPage('images'); break;
    case 'cleanup': { const result = await api('/storage/cleanup', 'POST'); toast(result.pending ? `还有 ${result.pending} 个待清理文件，可再次重试` : '待清理文件已处理完毕'); break; }
    case 'retry': await boot(); break;
  }
}
const linkMenu = document.createElement('div');
linkMenu.id = 'link-menu'; linkMenu.setAttribute('popover', 'manual'); linkMenu.setAttribute('role', 'menu');
linkMenu.setAttribute('aria-label', '导航操作'); document.body.append(linkMenu);
function closeLinkMenu() { linkMenu.hidePopover(); }
function openLinkMenu(id, x, y) {
  if (sortDraft) return;
  const link = state.links.find(l => l.id === id); if (!link) return;
  linkMenu.innerHTML = `<div class="menu-title">${esc(link.title)}</div>${[['open-new','新窗口打开'],['open-current','当前页面打开'],['copy-link','复制网址'],['edit-link','编辑导航'],['delete-link','删除导航']].map(([name,label]) => `<button type="button" role="menuitem" data-action="${name}" data-id="${esc(id)}" class="${name === 'delete-link' ? 'danger' : ''}">${label}</button>`).join('')}`;
  linkMenu.showPopover();
  const rect = linkMenu.getBoundingClientRect();
  linkMenu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
  linkMenu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
  linkMenu.querySelector('button').focus({ preventScroll: true });
}
modal.addEventListener('close', () => { gallery.close(); modal.classList.remove('link-editor'); modal.innerHTML = ''; });
document.addEventListener('contextmenu', event => {
  const card = event.target.closest('[data-link-id]'); if (!card || sortDraft) return;
  event.preventDefault(); openLinkMenu(card.dataset.linkId, event.clientX, event.clientY);
});
document.addEventListener('pointerdown', event => { if (!linkMenu.contains(event.target)) closeLinkMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeLinkMenu(); });
linkMenu.addEventListener('keydown', event => {
  const items = [...linkMenu.querySelectorAll('button')]; const index = items.indexOf(document.activeElement);
  if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
    event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
});
let draggingGroup = null;
let savingGroupOrder = false;
async function moveGroup(id, targetId) {
  if (savingGroupOrder || id === targetId) return;
  const ids = state.groups.map(group => group.id);
  const from = ids.indexOf(id), to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  savingGroupOrder = true;
  try {
    await api('/groups/reorder', 'PUT', { ids });
    await loadPage(state.page); toast('分组顺序已保存');
  } finally { savingGroupOrder = false; }
}
let groupPointer = null;
management.addEventListener('pointerdown', event => {
  const handle = event.target.closest('[data-group-drag]');
  if (!handle || savingGroupOrder || event.button !== 0) return;
  event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId);
  draggingGroup = handle.dataset.groupDrag;
  groupPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
});
management.addEventListener('pointermove', event => {
  if (!groupPointer || event.pointerId !== groupPointer.id) return;
  if (Math.hypot(event.clientX - groupPointer.x, event.clientY - groupPointer.y) < 5 && !groupPointer.moved) return;
  groupPointer.moved = true;
  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-group-row]');
  management.querySelectorAll('[data-group-row]').forEach(item => {
    item.classList.toggle('group-dragging', item.dataset.groupRow === draggingGroup);
    item.classList.toggle('group-drop-target', item === row && item.dataset.groupRow !== draggingGroup);
  });
});
function clearGroupDrag() {
  draggingGroup = null; groupPointer = null;
  management.querySelectorAll('.group-drop-target,.group-dragging').forEach(row => row.classList.remove('group-drop-target', 'group-dragging'));
}
management.addEventListener('pointerup', async event => {
  if (!groupPointer || event.pointerId !== groupPointer.id) return;
  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-group-row]');
  const id = draggingGroup, targetId = groupPointer.moved && row && management.contains(row) ? row.dataset.groupRow : null;
  clearGroupDrag();
  if (targetId) try { await moveGroup(id, targetId); } catch (error) { toast(error.message); }
});
management.addEventListener('pointercancel', clearGroupDrag);
management.addEventListener('lostpointercapture', clearGroupDrag);
let draggedId = null;
document.addEventListener('dragstart', event => {
  const card = event.target.closest('[data-link-id]');
  if (!sortDraft || !card || !sortDraft.ids.includes(card.dataset.linkId)) return;
  draggedId = card.dataset.linkId; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', draggedId); card.classList.add('dragging');
});
document.addEventListener('dragover', event => {
  const card = event.target.closest('[data-link-id]');
  if (draggedId && card && sortDraft?.ids.includes(card.dataset.linkId)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
});
document.addEventListener('drop', event => {
  const card = event.target.closest('[data-link-id]');
  if (!draggedId || !card || !sortDraft?.ids.includes(card.dataset.linkId)) return;
  event.preventDefault(); const from = sortDraft.ids.indexOf(draggedId); const to = sortDraft.ids.indexOf(card.dataset.linkId);
  sortDraft.ids.splice(to, 0, sortDraft.ids.splice(from, 1)[0]); draggedId = null; renderBoard();
});
document.addEventListener('dragend', () => { draggedId = null; document.querySelector('.dragging')?.classList.remove('dragging'); });
document.addEventListener('click', event => { if (sortDraft && event.target.closest('.card-anchor')) event.preventDefault(); }, true);
window.addEventListener('resize', closeLinkMenu);

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  button.disabled = true; try { await handleAction(button); } catch (error) { toast(error.message); } finally { button.disabled = false; }
});
document.addEventListener('keydown', event => { if (event.key === '/' && !modal.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { if (state.user && !management.open) { event.preventDefault(); state.searchOpen = true; renderHome(); $('#search').focus(); } } });
document.addEventListener('error', event => { if (event.target.tagName === 'IMG' && event.target.parentElement.classList.contains('site-icon')) event.target.parentElement.textContent = '↗'; }, true);
management.addEventListener('close', () => { state.page = 'board'; });
modal.addEventListener('click', event => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) modal.close(); } });
async function boot() {
  try {
    const { initialized } = await api('/status'); state.initialized = initialized;
    if (!initialized) { renderAuth(); return; }
    try { state.user = (await api('/me')).user; } catch { state.user = null; }
    if (state.user) { resetBoard(); await loadPage(); } else renderAuth();
  } catch (error) { app.innerHTML = `<div class="boot">${brand}<p>${esc(error.message)}</p>${action('retry', '重新连接', '', 'primary')}</div>`; }
}
setInterval(updateClock, 1000);
boot();
