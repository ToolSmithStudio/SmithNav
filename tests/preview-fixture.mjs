// Optional local-only preview data. These accounts and links are never built into dist.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const origin = 'http://localhost:8788';
const setupToken = (await readFile('.dev.vars', 'utf8')).match(/^SETUP_TOKEN=(.+)$/m)?.[1];
const credentials = { username: 'preview_admin', password: 'Preview-only-SmithNav-2026!' };
let cookie;
async function request(path, method = 'GET', data) {
  const response = await fetch(origin + '/api' + path, { method, headers: { Origin: origin, ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, ...(method === 'GET' ? {} : { body: JSON.stringify(data || {}) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return result;
}
if (!(await request('/status')).initialized) await request('/setup', 'POST', { ...credentials, display_name: 'Smith', setup_token: setupToken });
await request('/login', 'POST', credentials);
let board = await request('/board');
if (!board.links.length) {
  const groups = [board.groups[0], await request('/groups', 'POST', { title: '设计与创作', sort_order: 10 }), await request('/groups', 'POST', { title: '开发与工具', sort_order: 20 })];
  const entries = [
    [0,'Google','https://www.google.com','G','探索你想知道的一切'],[0,'GitHub','https://github.com','⌘','代码与灵感的交汇处'],[0,'YouTube','https://www.youtube.com','▶','发现更多精彩内容'],[0,'Notion','https://www.notion.so','N','记录，整理，让想法发生'],[0,'Wikipedia','https://www.wikipedia.org','W','自由的知识百科'],[0,'Cloudflare','https://dash.cloudflare.com','☁','连接每一种可能'],[0,'Google 翻译','https://translate.google.com','译','让交流没有边界'],[0,'Gmail','https://mail.google.com','M','你的日常收件箱'],[0,'日历','https://calendar.google.com','31','安排每个重要时刻'],[0,'地图','https://maps.google.com','↗','探索身边与远方'],[0,'阅读清单','https://www.gutenberg.org','书','给阅读留一点时间'],[0,'MDN Web Docs','https://developer.mozilla.org','md','开放网络的开发指南'],
    [1,'Figma','https://www.figma.com','F','从想法到设计'],[1,'Dribbble','https://dribbble.com','◉','发现全球设计灵感'],[1,'Behance','https://www.behance.net','Bē','优秀作品与创意故事'],[1,'Unsplash','https://unsplash.com','U','发现影像之美'],[1,'Blender','https://www.blender.org','B','自由的三维创作'],[1,'Canva','https://www.canva.com','C','让创意轻松成形'],
    [2,'Visual Studio Code','https://code.visualstudio.com','⌁','轻量的代码编辑器'],[2,'Cloudflare Docs','https://developers.cloudflare.com','☁','边缘开发文档'],[2,'npm','https://www.npmjs.com','npm','JavaScript 软件包'],[2,'Stack Overflow','https://stackoverflow.com','≡','寻找开发问题的答案'],[2,'TypeScript','https://www.typescriptlang.org','TS','为 JavaScript 加上类型'],[2,'Vite','https://vite.dev','ϟ','轻快的前端构建工具']
  ];
  for (const [index,title,url,icon,description] of entries) await request('/links','POST',{group_id:groups[index].id,title,url,icon,description,sort_order:entries.findIndex(entry=>entry[1]===title)});
}
const users = (await request('/users')).users;
if (!users.some(user=>user.username==='preview_reader')) await request('/users','POST',{username:'preview_reader',password:credentials.password,display_name:'普通用户',role:'user'});
await mkdir('test-results',{recursive:true});
await writeFile('test-results/preview-account.json',JSON.stringify({...credentials,url:origin,note:'Local preview only'},null,2),{mode:0o600});
console.log('Local preview ready: 24 links, 3 groups, administrator and isolated reader.');
