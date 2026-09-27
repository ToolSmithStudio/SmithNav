# SmithNav

SmithNav 是基于 **Cloudflare Pages + D1** 的轻量导航站，支持导航卡片、分组管理、多用户独立空间和图片存储。无需 VPS 或常驻服务器。

- **Pages**：静态前端 + advanced-mode Pages Functions（`dist/_worker.js`）。
- **D1 / DB**：用户、会话、分组、导航及图片二进制。无需开通 R2。
- 图片上传前在浏览器压缩，读取时校验当前登录用户。
- 管理员创建账号；用户分别管理自己的导航、分组和图片。

## 已实现

- 导航桌面：全屏渐变背景、居中标题与实时时钟、半透明圆角卡片、右上角悬浮工具栏。
- “系统应用”管理窗口承载分组、图片库、用户管理、账号设置，支持 Escape 关闭和窗口内表单编辑。
- 个性化设置：桌面标题、时钟显示、搜索栏默认展开、网站描述、详情卡片/极简图标。外观设置按账号保存在当前浏览器，导航数据仍保存在 D1。
- 首次初始化管理员，无预设账号或密码；关闭公开注册。
- 登录、退出、修改密码。管理员新增/编辑/禁用/删除用户及重置密码。
- 每个用户独立的导航和分组；新增、编辑、删除、拖动排序、关键词搜索。
- 网站名称、地址、描述、文字/Emoji/外链图标、本地上传图片。
- 图片库上传、重复选择、查看引用数量和删除；原图 ≤ 10 MB，压缩后单张 ≤ 200 KB、最长边 256 像素，每账号 ≤ 200 张。
- PNG、JPEG、GIF、WebP 文件头检测；不接受 SVG/HTML。
- 删除分组级联删除导航；图片留在图片库供复用。删除用户级联删除其导航和图片。
- 桌面与手机布局、空状态、错误提示、确认删除、提交中防重复操作。

支持旧 R2 图片迁移到 D1，以及 SmithNav 配置文件的导入导出。

## Pages 自动部署（推荐）

上传源码或 Fork 本仓库，在 GitHub Actions Secrets 填写 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`SETUP_TOKEN`，然后在 Actions 中运行“部署 SmithNav 到 Pages”。工作流自动创建/复用 D1 和 Pages、执行数据库迁移并部署。

**完整新手教程：[Pages 自动部署](DEPLOY-PAGES.md)。** 上传时请包含隐藏的 `.github` 文件夹。无需手动修改数据库 ID，不需要 R2。默认项目名称为 `smithnav-你的GitHub用户名`，可通过 Repository variables 自定义。

## 目录

```text
SmithNav/
  public/                  # 前端 HTML / CSS / JavaScript，静态安全头与路由规则
  src/worker.js            # API、鉴权、D1、R2，构建时复制为 _worker.js
  migrations/              # D1 SQL 迁移（按顺序执行）
  scripts/build.mjs        # 无需前端框架的静态构建
  tests/api.test.mjs       # workerd + 本地 D1 / R2 集成测试
  tests/browser-smoke.mjs  # 浏览器端到端测试
  wrangler.toml            # Pages、D1 绑定
  .dev.vars.example        # 本地初始化密钥模板
  pnpm-lock.yaml           # 固定开发工具版本
  dist/                    # 构建产物（自动生成）
```

## 本地运行

需要 **Node.js 22+**，推荐使用 pnpm（项目保留 pnpm 锁文件）。也可用 npm 安装及运行同名脚本。

```bash
cd SmithNav
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`，将 `SETUP_TOKEN` 改为随机的至少 24 位密钥。可通过 `openssl rand -hex 32` 生成；不要把真实密钥提交到 Git。

```bash
pnpm db:local
pnpm dev
```

打开终端给出的本地地址（默认 `http://localhost:8788`）。首次页面会要求初始化密钥、管理员用户名、显示名称和密码（至少 12 位）。创建后登录即可。

本地 D1 数据持久化在 `.wrangler/state`，重新启动不会清空；它们与云端数据相互独立。`wrangler.toml` 内的全零数据库 ID 只是本地占位符，**正式部署前必须换成真实 D1 ID**。

如果使用 npm，命令对应 `npm install`、`npm run db:local`、`npm run dev`。

## 手动部署到 Cloudflare Pages

如需全网页操作，优先使用上方的 GitHub Actions 自动部署教程。以下为终端手动部署方式。

以下步骤需要你自己的 Cloudflare 账号。先在该账号启用 D1 服务，然后在项目根目录执行。

### 1. 登录、创建数据库

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create smithnav-db
```

将创建 D1 返回的 `database_id` 填入 `wrangler.toml`：

```toml
name = "smithnav"
compatibility_date = "2026-09-01"
pages_build_output_dir = "./dist"

[[d1_databases]]
binding = "DB"
database_name = "smithnav-db"
database_id = "这里替换为真实的数据库 UUID"
migrations_dir = "migrations"

```

可以自定义数据库名称，但绑定变量名必须为 **`DB`**。新部署不需要 R2、外部图床账号或存储密钥。

### 2. 初始化云端 D1 表

```bash
pnpm db:remote
```

该命令将依次执行 `migrations/` 中尚未执行的迁移。后续更新新增迁移文件，再执行同一命令；不要删除生产数据库重建。

### 3. 创建 Pages 项目并配置初始化密钥

```bash
pnpm exec wrangler pages project create smithnav --production-branch main
pnpm exec wrangler pages secret put SETUP_TOKEN --project-name smithnav
```

第二条命令会提示输入密钥，粘贴自己生成的随机密钥（至少 24 位）。不要将它写在 `public/`、`wrangler.toml` 的公开变量或任何前端代码中。

### 4. 构建和部署

```bash
pnpm build
pnpm exec wrangler pages deploy dist --project-name smithnav --branch main
```

访问命令返回的 `https://smithnav.pages.dev`（实际域名以 Cloudflare 返回结果为准），用上一步密钥初始化管理员，然后登录。

初始化由 D1 的唯一标记保护，只能执行一次。完成后可以在 Pages 的设置中删除 `SETUP_TOKEN` secret；日常登录不依赖它。不要删除 D1 的 `app_state` 初始化标记。

### 使用 Git 自动部署（可选）

把 SmithNav 的项目文件推到自己的 GitHub 仓库，在 Cloudflare **Workers & Pages → Create → Pages → Connect to Git** 中连接：

| 设置 | 值 |
| --- | --- |
| 框架 | None |
| 根目录 | 仓库根目录；若仓库包含多个项目则填 `SmithNav` |
| 构建命令 | `pnpm install --frozen-lockfile && pnpm build` |
| 构建输出目录 | `dist` |
| Node.js | 22 或更高 |
| 生产分支 | `main`（与实际分支一致） |

提前创建 D1、应用远程迁移，修改并提交 `wrangler.toml` 中的真实数据库 ID。通过 Pages 设置配置 `SETUP_TOKEN` secret 并重新部署。采用 Wrangler 配置时，该文件是绑定的配置来源。

**使用 `wrangler pages deploy` 或 Pages Git 集成部署。不要将其当成普通静态站仅上传 `public/`，也不要使用普通 Workers 的 `wrangler deploy`。**

### 预览环境

默认配置中的绑定可能也用于预览部署。需要测试分支时，创建独立 D1，在 `wrangler.toml` 的 `[env.preview]` 下配置 `[[env.preview.d1_databases]]`，并单独初始化预览数据库和 secret。不要让不受信任的预览分支访问生产数据。

官方参考：[Pages 配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)、[D1 / R2 绑定](https://developers.cloudflare.com/pages/functions/bindings/)、[Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)。

## 日常使用

1. **管理员**：点击右上角九宫格“系统应用”→“用户管理”，创建用户名、显示名称、初始密码和角色。把账号交给对应用户。
2. **用户**：登录后只看到自己的导航；在“系统应用”→“分组管理”创建分类，再通过右上角加号添加网站。
3. **上传图片**：导航编辑弹窗中上传并选择，或先去“图片库”上传，再在导航编辑时选用。选择“无”会取消图片引用，回退到备用图标。
4. **编辑 / 删除导航**：点击右上角铅笔“管理导航”，卡片显示编辑、删除按钮。分组管理中拖动左侧手柄可排序，松开后自动保存；也可使用上移、下移按钮。新分组默认排在最后。
5. **删除图片**：只有未被导航引用的图片才能删除。删除或替换导航图片不会自动删除图片库文件，便于其他导航复用。
6. **账号禁用 / 重置密码**：立即撤销此用户已有会话。用户自行修改密码也会退出所有设备。
7. **搜索 / 外观**：点击右上角放大镜或按 `/` 展开搜索与分组筛选。在“系统应用”→“个性化设置”调整标题、时钟和卡片样式。默认折叠搜索，首页保持简洁。

管理员可以管理账号，但导航和图片接口仍按自己的用户 ID 查询，不能从后台浏览别人的私人导航。Cloudflare 账号拥有者仍然可以通过 D1 控制台访问存储内容。

## 数据与安全设计

- 密码以随机盐 + PBKDF2-SHA256（100,000 次迭代，适配 Workers Web Crypto）保存，不存明文。
- 随机会话令牌仅在 `HttpOnly; SameSite=Strict` Cookie 中，HTTPS 下附加 `Secure`；D1 只保存令牌摘要。会话 7 天到期，不使用 localStorage 存令牌。
- 所有写接口校验同源 Origin；登录、初始化、密码修改和上传有 D1 持久化限流。
- 所有分组、导航、图片操作校验用户归属。SQL 使用绑定参数，分组与图片还有数据库约束。
- URL 只允许 HTTP/HTTPS；用户输入在 UI 中进行 HTML 转义；图片不接受 SVG/HTML。
- 导航图片可选外链，浏览器会请求对应站点；希望图片完全由自己存储时使用上传功能。
- 至少保留一个启用管理员，数据库触发器覆盖并发删除或降权的情况。
- 新图片直接以 BLOB 写入 D1，图片元数据和内容一并保存；数据库级联删除时同时删除图片内容。
- 上传前缩放并重编码，保留透明度，GIF 等动图保存为静态图片；服务端再次检查文件头及 200 KB 大小上限。
- “获取图标”先解析公网域名并读取该网站 `/favicon.ico`，不发送 URL 路径、查询参数、登录凭据；支持 ICO、PNG 等格式，浏览器重编码后保存为 WebP。直接读取失败后，回退到 Google 域名图标服务。
- 直接图标请求校验公网 DNS 地址，不跟随跳转，拒绝内网 IP、非标准端口及非 HTTP(S) URL；图标请求限制响应大小、超时及访问频率。备用服务的重定向仅允许指定 HTTPS 域名。

## 验证

```bash
pnpm test
pnpm build
```

集成测试使用 Miniflare / workerd 的真实本地 D1、R2 实现，覆盖初始化、密码和 Cookie、角色权限、数据隔离、导航/分组 CRUD、文件字节持久化、图片引用约束、用户级联清理、输入校验和限流。

浏览器测试说明见 [tests/README.md](tests/README.md)。测试账号和图片仅用于本地测试，不会写入云端，也没有内置到生产代码。

## 备份与恢复

- 数据库导出：`pnpm exec wrangler d1 export DB --remote --output=backup.sql`。
- 新图片包含在 D1 数据库中。旧版尚未迁移的 R2 对象仍需单独备份，直到全部迁移完成。
- 忘记普通用户密码由管理员重置。管理员之间也可互相重置密码；没有公开密码找回接口。

## 常见问题

- **未绑定 D1 / 数据表不存在**：检查 `DB` 绑定、真实 `database_id`，执行 `pnpm db:remote` 后重新部署。
- **旧图片提示未迁移**：按下方升级说明临时保留旧 IMAGES 绑定，迁移完成后移除。
- **网站图标读取失败**：检查网络，或改用手动上传；内网网站不通过第三方服务读取。
- **初始化提示密钥未配置**：Pages 中添加 `SETUP_TOKEN` secret（至少 24 位），重新部署；本地使用 `.dev.vars`。
- **导航已删除，图片仍在**：这是复用设计。到图片库删除未使用的图片。
- **用户名或密码错误**：检查账号是否被管理员禁用。多次错误会触发 15 分钟限流。
- **构建成功但 API 404**：确认部署的是 `dist`，其中有 `_worker.js` 和 `_routes.json`。
- **pnpm 提示构建脚本未批准**：仓库中的 `pnpm-workspace.yaml` 已允许 esbuild/workerd。升级 pnpm 或按提示仅批准这两项。

## 许可

项目采用 [MIT 许可证](LICENSE)，许可说明见 [NOTICE.md](NOTICE.md)。

## 导航快捷操作（1.2）

右键点击网站卡片，或点击卡片右下角菜单按钮，可选择打开方式、复制网址、编辑及删除。删除仍需确认。

鼠标移至分组区域，分组名称旁显示添加和排序按钮。点击排序后拖动卡片，或使用前移/后移按钮，最后点击保存排序写入 D1；取消则恢复原顺序。手机端直接显示操作入口。当前仅支持每个导航一个网站地址，不包含参考站的内外网双地址切换。

## 从 1.2 升级到 1.3（旧 R2 图片）

1. 备份 D1 和旧 R2 对象。保留真实数据库 ID，运行 `pnpm db:remote`，应用 `0003_d1_images.sql`；不要重建数据库。
2. 如有旧 R2 图片，在部署配置中临时保留原绑定：

```toml
[[r2_buckets]]
binding = "IMAGES"
bucket_name = "smithnav-images"
```

3. 每位用户登录自己的“图片库”，点击“迁移旧图片到 D1”。图片会压缩写入 D1，保留原 ID 和导航引用。中断后可继续；已成功迁移的图片跳过。旧对象会在成功迁移后加入清理队列。
4. 全部用户迁移后，可通过 D1 查询 `SELECT COUNT(*) FROM images WHERE storage='r2';` 确认为 0。管理员重试待清理文件，确认 `SELECT COUNT(*) FROM object_gc;` 也为 0，再移除 IMAGES 绑定并重新部署。迁移时不自动删除整个存储桶。

仅用于本地迁移时，可暂时运行 `pnpm exec wrangler pages dev --r2 IMAGES=smithnav-images`；普通 `pnpm dev` 不使用 R2。

## 导航编辑窗口（1.4）

顶部同时展示卡片和图标两种实时预览，可切换画布透明。图标风格支持文字、图片和在线图片；图库弹窗显示已上传的图标，本地上传和获取网站图标成功后自动选中并更新预览。网站地址旁的“获取图标”优先读取网站自身 `/favicon.ico`，不再仅依赖 Google。某些网站没有该路径、禁止获取或使用 SVG 时可能仍需手动上传。原有分组、排序、描述和用户隔离保持不变。

## 图库弹窗（1.5）

编辑导航中的图库以独立弹窗显示，支持按文件名搜索、选择、确定、取消和不使用图片。点击确定后应用选择；取消保留原图标。不提供公共图库。已删除“当前页面弹窗打开”，导航保留新窗口及当前页面打开。

新增导航自动排在所属分组最后，编辑时保留现有顺序；移动到其他分组时追加到该组末尾。可用分组排序功能调整顺序。网站地址未写协议时自动补全 `https://`，已输入的 `http://` 保留。

图片保存时会按账号和文件内容去重，重复获取或上传相同图片复用已有记录；原有重复记录不自动删除。不同内容或不同压缩编码的图片仍作为新图片保存。


## 清理未使用图片（1.5.3）

图片管理和导航编辑的图库弹窗中均可点击“清理未使用图片”。系统显示待清理数量，确认后永久删除当前账号未被导航引用的图片。编辑中当前选中和图库中待确认的图片会保留；删除时再次检查引用，已经被导航使用的图片不会删除。历史多余图片可通过此功能清理，无需数据库迁移。


## 导入导出（1.6）

在“系统应用 → 导入导出”下载当前账号 JSON 配置，包含分组、导航名称/地址/描述/顺序、文字和在线图标配置、导航使用的 D1 图片。不包含闲置图库图片、密码或浏览器个性化设置。旧 R2 图片需先迁移到 D1。

导入默认追加：新分组追加到末尾，同名分组也会新建，重复导入会再次添加导航。也可选择覆盖：替换当前账号全部分组及导航，图库图片保留，可另行清理闲置图片。两种模式均复用内容相同的图片，导入前确认，事务失败会回滚。仅支持本系统导出的格式，每份文件最多 16 MB、1000 分组、10000 导航；图库仍受每账号 200 张上限约束。
