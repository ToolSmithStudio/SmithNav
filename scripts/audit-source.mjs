// Text overlap is a review aid, not a determination of authorship or licensing.
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
const reference = process.argv[2];
if (!reference) throw new Error('Usage: node scripts/audit-source.mjs <reference-directory>');
const root = process.cwd(), width = 80;
const extensions = new Set(['.js', '.mjs', '.ts', '.vue', '.go', '.css', '.scss', '.sql', '.html', '.svg']);
async function files(directory) {
  const list = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'vendor'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) list.push(...await files(path));
    else if (extensions.has(extname(path))) list.push(path);
  }
  return list;
}
const tokens = text => text.match(/[\p{L}\p{N}_$]+|[^\s]/gu) || [];
const hash = text => createHash('sha256').update(text).digest('hex');
const current = (await Promise.all(['public', 'src', 'migrations'].map(dir => files(resolve(root, dir))))).flat();
const index = new Map(), manifest = [];
for (const path of current) {
  const text = await readFile(path, 'utf8'), parts = tokens(text);
  const name = relative(root, path); manifest.push({ path: name, sha256: hash(text) });
  for (let i = 0; i <= parts.length - width; i++) index.set(hash(parts.slice(i, i + width).join('\0')), name);
}
const matches = new Map(), sourceFiles = await files(resolve(reference));
for (const path of sourceFiles) {
  const parts = tokens(await readFile(path, 'utf8'));
  for (let i = 0; i <= parts.length - width; i++) {
    const local = index.get(hash(parts.slice(i, i + width).join('\0')));
    if (local) { const source = relative(resolve(reference), path); const key = `${local}:${source}`; matches.set(key, { local, reference: source }); }
  }
}
console.log(JSON.stringify({ method: 'Exact consecutive tokens, whitespace ignored; no identifier normalization', windowTokens: width, referenceFiles: sourceFiles.length, currentFiles: current.length, matchingPairs: [...matches.values()], manifest, limitation: 'No matches does not establish independent authorship; semantic, visual, short and renamed similarities require human review.' }, null, 2));
