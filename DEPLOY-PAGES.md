# GitHub Actions 自动部署到 Cloudflare Pages

本项目使用 Pages + D1，图片也保存在 D1，不需要 R2。自动化由仓库内的 GitHub Actions 工作流完成，用户配置一次后即可在网页上部署，无需安装 Node.js 或运行终端命令。

## 1. 上传或 Fork 仓库

首次发布者把项目源码上传到自己的 GitHub 仓库。其他用户点击 Fork，复制到自己的账号。

源码应位于仓库根目录，首页直接能看到 `package.json`、`wrangler.toml`、`public` 等文件。必须包含 `.github/workflows/deploy-pages.yml`；Mac 中按 Command + Shift + . 显示隐藏文件，再上传 `.github` 文件夹。不要只上传 ZIP 压缩包。

现有 `wrangler.toml` 中的全零数据库 ID 可以保留。自动部署会生成临时配置，不需要用户修改源文件，也不会提交真实密钥到仓库。

## 2. 创建 Cloudflare API Token

登录 Cloudflare，进入账号的 API Tokens 页面，创建 Custom Token（自定义令牌）。仅对准备部署的那个 Cloudflare 账号授予：

| 权限范围 | 服务 | 权限 |
| --- | --- | --- |
| Account | Cloudflare Pages | Edit |
| Account | D1 | Edit |

复制生成的 API Token。不要将它发到 Issue、README 或源码中。在 Cloudflare 账号概览复制 Account ID（账号 ID，32 位），注意不是 Zone ID（域名区域 ID）。

## 3. 在 GitHub 填写三个 Secrets

进入自己的仓库 → Settings → Secrets and variables → Actions → Secrets → New repository secret。分别添加：

| Name | Secret |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 上一步创建的令牌 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |
| `SETUP_TOKEN` | 自己生成并保存的至少 24 位随机密钥，不能使用项目示例值 |

初始化密钥只用于首次创建管理员，与管理员登录密码不同。可以用密码管理器生成一段 32 位以上随机字符；之后在网站初始化页面填写相同内容。密钥只能填入 Secrets，不要填在普通 Variables 或工作流文件里。

### 可选：自定义名称

同一页面切换到 Variables，按需添加以下 Repository variables。新用户通常可以不填。

| Name | 默认行为 |
| --- | --- |
| `PAGES_PROJECT_NAME` | 默认 `smithnav-你的GitHub用户名`（小写）；自定义值为 1–58 位小写字母、数字或短横线，首尾不能是短横线 |
| `D1_DATABASE_NAME` | 默认 `Pages项目名称-db`；仅在没有已绑定数据库或指定 ID 时用于查找/创建 |
| `D1_DATABASE_ID` | 留空自动创建/复用；已有 SmithNav 数据库且使用 Wrangler 迁移时可填写其 UUID |

后续部署会优先使用 Pages 已绑定的 DB。不要为了更新版本随意修改项目名称；改项目名称会指向另一个网站。已有绑定与手动指定的数据库 ID 冲突时，工作流会停止，不会切换数据库。

## 4. 点击部署

进入仓库顶部 Actions：

1. 如果 Fork 后提示工作流已禁用，先点击启用工作流。
2. 左侧选择“部署 SmithNav 到 Pages”。
3. 点击 Run workflow，选择仓库默认分支（通常是 main），再点击绿色 Run workflow。
4. 等待运行完成，打开该次运行的 Summary，点击显示的网站地址。

第一次上传仓库可能在 Secrets 尚未填写时触发失败，属于配置尚未完成。填好后手动重新运行即可。无需提前在 Cloudflare 手动创建 Pages 项目或连接 GitHub。

流程会安装锁定依赖、运行测试、构建网站，随后创建/复用 D1、检查数据库、创建/复用 Pages、执行迁移、配置生产环境的 DB 和 SETUP_TOKEN、发布网页及 API，最后检查 `/api/status`。

## 5. 初始化管理员

打开 `https://项目实际子域名.pages.dev`，以部署摘要返回的地址为准。输入刚才的 SETUP_TOKEN，自行创建管理员账号和密码。已有数据库已初始化时，直接用原账号登录。

本地账号和导航不会自动上传。需要迁移时，在本地网站导出配置，再登录线上网站导入。未被导航使用的图库图片不包含在配置导出中。

## 更新版本

自己的仓库默认分支为 main 或 master 时，推送代码（包括通过 Sync fork 同步新版）会触发自动部署。其他默认分支可以手动 Run workflow，或修改工作流的 `push.branches`。

工作流只从默认分支部署，不部署 Pull Request 或测试分支。生产任务串行执行，正在执行的数据库迁移不会因下一次提交而被取消。部署执行尚未应用的迁移，不清空数据库，不重新初始化管理员。

现有管理员账号仍可登录；初始化密钥保存在 GitHub Secrets 中，工作流每次同步到 Pages 生产环境。更改此密钥不会修改管理员密码。不要额外启用另一套 Pages Git 自动构建，否则会产生两个发布入口；已经连接 Git 的 Pages 项目会被此脚本拒绝，建议使用一个新项目名。

## 常见问题

- **找不到工作流**：检查 `.github/workflows/deploy-pages.yml` 是否位于仓库根目录下，不能是 `SmithNav/.github/...`。检查是否启用了 Actions，以及文件是否在默认分支。
- **账号 ID 或 Token 无效 / HTTP 403**：检查三个 Secrets 的名字、账号范围、Token 有效期，以及 Pages/D1 编辑权限。
- **Pages 项目名称冲突**：设置不同的 `PAGES_PROJECT_NAME`。脚本不会接管已连接 Git 的项目，也不会覆盖未绑定 DB 的已有网站。
- **数据库已有其他应用的数据**：使用新的 `D1_DATABASE_NAME`；不要指定其他应用的数据库。
- **曾在 D1 控制台手动执行 SQL**：这种数据库可能没有 Wrangler 迁移历史。脚本会停止，不能直接补建迁移表来跳过检查。最简单的迁移方式是使用新数据库部署，再通过 SmithNav 导入配置；原数据库保留。
- **迁移失败**：本次不会继续发布网站。查看失败日志并修复后重新运行，已成功应用的迁移由 Wrangler 记录。不要删除生产数据库重试。
- **发布失败**：资源可能已经创建，重跑会复用同名资源。不会自动回滚删除数据库或 Pages 项目。
- **健康检查失败**：Pages 已收到部署，但网站接口尚未可用；查看 Cloudflare 部署状态、D1 绑定或访问限制，然后重试。
- **配额不足**：检查自己 Cloudflare 账号的 Pages/D1 配额。自动化不会绕过平台限制或自动购买套餐。

## 实现和验证范围

- 工作流：`.github/workflows/deploy-pages.yml`
- 部署逻辑：`scripts/deploy-pages.mjs`
- 模拟测试：`tests/deploy-pages.test.mjs`
- 工作流使用 Node.js 24，由 pnpm 自动安装锁定版本依赖；用户电脑无需安装。
- 自动生成的 `wrangler.deploy.json` 不包含密钥，被 Git 忽略，并在脚本退出时清理。
- 目前已完成本地安装、构建、测试和 Cloudflare API 请求模拟验证。真实 GitHub Actions 与 Cloudflare 联调需要上传仓库并配置账号后执行第一次部署。

参考：[Pages 持续集成部署](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)、[Pages 项目 API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/create/)、[D1 数据库 API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/)、[D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)。
