import { mkdir, rm, cp } from 'node:fs/promises';
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await cp(new URL('../public/', import.meta.url), new URL('../dist/', import.meta.url), { recursive: true });
await cp(new URL('../src/worker.js', import.meta.url), new URL('../dist/_worker.js', import.meta.url));
console.log('Built dist: static UI + Pages advanced-mode Worker');
