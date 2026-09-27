/** Pure navigation rules. No DOM, network, persistence or framework dependency. */
export function normalizeWebsite(input) {
  const value = String(input ?? '').trim();
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  const explicitScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  const hostWithPort = /^[^/]+:\d+(?:[/?#]|$)/.test(value);
  return explicitScheme && !hostWithPort ? value : `https://${value}`;
}

function webAddress(value) {
  try {
    const address = new URL(value);
    if (!['https:', 'http:'].includes(address.protocol) || address.username || address.password) return null;
    return address.href;
  } catch { return null; }
}

export function resolveIcon(link) {
  const title = String(link.title || 'S');
  const value = String(link.icon || '').trim();
  const remote = webAddress(value);
  const source = link.image_id ? `/api/images/${encodeURIComponent(link.image_id)}` : remote;
  const tone = Array.from(title).reduce((sum, letter) => sum + letter.codePointAt(0), 0) % 8;
  const text = !source && !remote && Array.from(value).length <= 8 ? value : '';
  return { source, text: text || Array.from(title)[0].toUpperCase(), tone };
}

export function iconSelection(mode, values, imageId) {
  if (!['text', 'online', 'image'].includes(mode)) throw new Error('请选择图标类型');
  if (mode === 'image') return { icon: '', image_id: imageId || null };
  const value = String(mode === 'text' ? values.icon_text ?? '' : values.icon_url ?? '').trim();
  if (mode === 'text') {
    if (Array.from(value).length > 8) throw new Error('图标文字最多 8 个字符');
    return { icon: value, image_id: null };
  }
  const address = value ? webAddress(value) : '';
  if (value && !address) throw new Error('请输入有效的 http:// 或 https:// 图片网址');
  return { icon: address, image_id: null };
}

export function navigationPayload(values, mode, imageId) {
  const address = webAddress(normalizeWebsite(values.url));
  if (!address) throw new Error('请输入有效的 http:// 或 https:// 网址');
  return {
    title: String(values.title ?? '').trim(),
    description: String(values.description ?? '').trim(),
    group_id: values.group_id,
    url: address,
    ...iconSelection(mode, values, imageId),
  };
}

/** Index links once, then reorder only the active group without mutating saved data. */
export function projectBoard({ groups, links, filter = 'all', search = '', draft = null }) {
  const query = search.trim().toLowerCase();
  const sections = new Map();
  for (const group of groups) {
    if (filter === 'all' || group.id === filter) sections.set(group.id, { ...group, links: [] });
  }
  let count = 0;
  for (const link of links) {
    const section = sections.get(link.group_id);
    if (!section) continue;
    if (query && ![link.title, link.description, link.url].join(' ').toLowerCase().includes(query)) continue;
    section.links.push(link); count++;
  }
  if (draft && sections.has(draft.groupId)) {
    const section = sections.get(draft.groupId);
    const remaining = new Map(section.links.map(link => [link.id, link]));
    const ordered = [];
    for (const id of draft.ids) {
      if (remaining.has(id)) { ordered.push(remaining.get(id)); remaining.delete(id); }
    }
    section.links = ordered.concat([...remaining.values()]);
  }
  return { count, query, sections: [...sections.values()].filter(section => !query || section.links.length) };
}
