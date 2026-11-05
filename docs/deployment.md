# 部署与构建

本页是椰果工具箱的部署与构建说明。工程介绍与功能见 [README](../README.md)，其它文档：

- [upstream-integration.md](upstream-integration.md) — 接入新数据上游（`DataProvider`）
- [tools.md](tools.md) — AI 助手 / WS 远程接管共用的工具清单（自动生成）
- [ws-remote.md](ws-remote.md) — WS 远程接管的分类表与接入方式

## 本地开发

```bash
pnpm install
pnpm run dev
```

## 构建与预览

```bash
pnpm run build
pnpm run preview
```

## Vercel

默认适配器：push 到 `main` 分支后 Vercel 自动部署，无需额外配置。

## Cloudflare Pages

在 Cloudflare Pages 控制台新建工程并连接同一仓库：

| 设置         | 值                                        |
| ------------ | ----------------------------------------- |
| 框架预设     | SvelteKit                                 |
| 构建命令     | `DEPLOY_TARGET=cloudflare pnpm run build` |
| 构建输出目录 | `.svelte-kit/cloudflare`                  |
| 环境变量     | `DEPLOY_TARGET` = `cloudflare`            |

构建时通过 `DEPLOY_TARGET` 环境变量切换适配器，因此同一份代码可同时部署到 Vercel 与 Cloudflare Pages。

## GitHub Release 静态产物（Tauri 启动器）

启动器不依赖独立的静态产物仓库，直接消费本仓库的 Release：

```bash
DEPLOY_TARGET=static pnpm run build
node scripts/write-static-manifest.mjs
tar -czf toolbox.tar.gz -C build .
```

产物：

- `build/index.html` / `build/200.html` / `build/_app` 等 adapter-static 文件
- `build/manifest.json`：version / commit / builtAt
- `toolbox.tar.gz`：整个 `build/` 的归档

push 到 `main` 后，`.github/workflows/release-toolbox.yml` 自动完成构建并创建 `toolbox-<sha>` Release，上传 `manifest.json` 与 `toolbox.tar.gz`。

默认保留最近 3 个 `toolbox-*` Release，更旧的 Release 连同 git tag 自动删除。手动运行 workflow 时可通过 `keep` 输入调整保留数量（设为 1 表示只保留当前版本）。

> 首次使用需在仓库 `Settings → Actions → General → Workflow permissions` 选择 `Read and write permissions`，否则创建 Release 会 403。

启动器读取：

```text
https://github.com/d4rkOfficial/wuwa-afyg-tool/releases/latest/download/manifest.json
https://github.com/d4rkOfficial/wuwa-afyg-tool/releases/latest/download/toolbox.tar.gz
```

本地手动验证时，也可以直接打开 `build/index.html` 所在目录起静态服务器，但 API 需要由启动器的 Rust 服务提供。

## 无服务端独立静态包（zip 分发）

给「下载一个 zip、自己找地方托管」这种分发方式用：产物是**纯前端**，没有任何后端，游戏数据由
浏览器直接向上游（`static.nanoka.cc`，已开放 CORS）读取，工程/计算/排轴/分享等全部在本地完成。

```bash
pnpm run package:standalone     # 等价于 node scripts/build-standalone.mjs
```

产物：`dist/椰果工具箱.zip`

- zip 根就是站点根（`index.html` 在根），解压后丢到任意静态服务器/对象存储即可，
  打开 `<域名>/` 就是工具箱；
- 附带 `使用说明.txt`、`本地预览.cmd` + `serve.mjs`（零依赖本地预览服务器，可选）；
- **必须用 HTTP 服务器打开**：浏览器禁止 `file://` 页面加载 ES module，双击 `index.html` 只会白屏；
- 所有资源都走站点根绝对路径（`/_app/...`、`/icons/...`），所以只能部署在**域名根**，
  不能塞进 `https://example.com/toolbox/` 这样的子路径。

与常规构建的差别（只在这个构建里生效，见 `scripts/build-standalone.mjs`）：

| 方面     | 有服务端的部署                   | 独立静态包（`STANDALONE=1`）                                                         |
| -------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| 适配器   | adapter-vercel / cloudflare      | adapter-static（`fallback: 200.html`）                                               |
| 路由     | `trailingSlash: 'never'`         | `trailingSlash: 'always'`（目录 + index.html，nginx / `http.server` 也能直接进子页） |
| 数据接口 | `/api/**` 由服务端转上游并做缓存 | `src/lib/api/local-api.ts` 在浏览器内就地解析同一批路径，直接调 provider 适配器      |

静态版**不可用**（调用时会给出明确提示，不会静默算错）：

- 库街区（实验性）同步 —— token 必须留在服务端 httpOnly cookie，且上游 `api.kurobbs.com` 不开放跨域；
- AI 助手的「网页抓取」工具 —— 需要服务端代理出网；
- 工坊站点标题抓取 —— 跨域限制，工坊名称显示为地址。

AI 对话本身可用，但只能连**自身支持浏览器跨域**的 OpenAI 兼容端点（本地 Ollama / LM Studio 默认允许）。

## 完成检查（改动代码后）

```bash
pnpm run format        # Prettier
pnpm run lint:eslint   # ESLint（必须零错误）
pnpm run check         # svelte-kit sync + svelte-check + mdi 图标集校验
```

新增 mdi 图标后需要重跑 `node scripts/collect-mdi-icons.mjs` 生成本地图标集合，否则 `pnpm run check` 会失败。

## 相关服务

工具箱可对接任意实现了最小集接口的「工坊」用作工程分享与数据同步；接口契约见工坊仓库的 [docs/api.md](https://github.com/d4rkOfficial/wuwa-afyg-share/blob/master/docs/api.md)。
