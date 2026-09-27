# 测试

`pnpm test` 使用 Miniflare 启动 workerd，并创建独立的本地 D1 / R2，不需要 Cloudflare 登录，也不会访问生产资源。

浏览器测试使用 Playwright（可选测试依赖）：

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

先复制 `.dev.vars.example` 为 `.dev.vars` 并设置随机的 `SETUP_TOKEN`，执行 `pnpm db:local` 和 `pnpm dev`。对**全新、空白的本地数据库**运行：

```bash
SMITHNAV_TEST_SETUP_TOKEN='与 .dev.vars 相同的密钥' node tests/browser-smoke.mjs
```

测试会创建专用本地账号，执行管理员初始化、登录、创建用户、导航和分组操作、上传图片、手机布局检查，截图写入 `test-results/`。只允许 localhost/127.0.0.1 测试地址；请勿对真实用户数据执行。

## 新版导航桌面预览

在全新本地数据库完成迁移并启动 `pnpm dev` 后，可运行 `node tests/preview-fixture.mjs` 创建专用示例导航。该脚本固定访问 localhost，不访问参考站，也不会连接云端。

预览账号记录在 `test-results/preview-account.json`。预览数据和浏览器冒烟测试使用不同的账号；请在独立的空白本地测试数据库运行冒烟测试，避免混用。所有测试数据都不参与 `dist` 构建。

1.1.0 的人工浏览器验证记录见 `test-results/REDESIGN-VERIFICATION.md`（仅本地保存）。

1.3.0：上传自动重编码为 WebP，浏览器选择器已更新。API 测试包含无 R2 绑定图片读写、旧图片迁移及受控图标响应；真实外网图标服务可能受本地网络限制。
