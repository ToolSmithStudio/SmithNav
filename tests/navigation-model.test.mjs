import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectBoard, resolveIcon, navigationPayload, iconSelection } from '../public/navigation-model.js';

const groups = [{ id: 'work', title: '工作' }, { id: 'life', title: '生活' }, { id: 'empty', title: '空分组' }];
const links = [
  { id: 'a', group_id: 'work', title: 'Mail', description: '收件箱', url: 'https://mail.example.com/' },
  { id: 'b', group_id: 'life', title: 'Music', description: '', url: 'https://music.example.com/' },
  { id: 'c', group_id: 'work', title: 'Docs', description: '', url: 'https://docs.example.com/' },
];

test('board projection preserves empty groups and filters search and group together', () => {
  assert.deepEqual(projectBoard({ groups, links }).sections.map(g => g.links.length), [2, 1, 0]);
  const match = projectBoard({ groups, links, search: ' MAIL ', filter: 'work' });
  assert.equal(match.count, 1); assert.deepEqual(match.sections.map(g => g.id), ['work']);
  assert.equal(projectBoard({ groups, links, search: 'mail', filter: 'life' }).count, 0);
  assert.equal(projectBoard({ groups, links, search: '收件箱' }).count, 1);
});

test('draft order is group scoped, preserves unlisted links and never mutates stored data', () => {
  const before = structuredClone({ groups, links });
  const view = projectBoard({ groups, links, draft: { groupId: 'work', ids: ['b', 'c', 'c', 'unknown'] } });
  assert.deepEqual(view.sections[0].links.map(l => l.id), ['c', 'a']);
  assert.deepEqual(view.sections[1].links.map(l => l.id), ['b']);
  assert.deepEqual({ groups, links }, before);
  assert.deepEqual(projectBoard({ groups, links }).sections[0].links.map(l => l.id), ['a', 'c']);
});

test('icon mode switches discard inactive sources and validate online URLs', () => {
  const values = { icon_text: '📖', icon_url: 'https://example.com/logo.png' };
  assert.deepEqual(iconSelection('text', values, 'old'), { icon: '📖', image_id: null });
  assert.deepEqual(iconSelection('image', values, 'selected'), { icon: '', image_id: 'selected' });
  assert.deepEqual(iconSelection('online', values, 'old'), { icon: values.icon_url, image_id: null });
  for (const icon_url of ['javascript:alert(1)', 'https://user:pass@example.com/logo.png', 'https://']) {
    assert.throws(() => iconSelection('online', { icon_url }, null));
  }
});

test('navigation payload normalizes bare hosts and rejects unsafe schemes and credentials', () => {
  const base = { title: ' Example ', description: '', group_id: 'work', icon_text: '' };
  for (const [input, output] of [['example.com', 'https://example.com/'], ['http://example.com', 'http://example.com/'], ['localhost:8788', 'https://localhost:8788/'], ['//example.com/a', 'https://example.com/a']]) {
    const result = navigationPayload({ ...base, url: input }, 'text', null);
    assert.equal(result.url, output); assert.equal(result.title, 'Example');
  }
  for (const url of ['', 'javascript:alert(1)', 'https://u:p@example.com']) assert.throws(() => navigationPayload({ ...base, url }, 'text', null));
});

test('icon resolution prefers account image, encodes its ID and uses safe text fallback', () => {
  assert.equal(resolveIcon({ title: 'Example', image_id: 'a/b', icon: 'https://example.com/a.png' }).source, '/api/images/a%2Fb');
  const invalid = resolveIcon({ title: 'Example', icon: 'javascript:alert(1)' });
  assert.equal(invalid.source, null); assert.equal(invalid.text, 'E');
  assert.equal(resolveIcon({ title: 'Example', icon: '🧭' }).text, '🧭');
});
