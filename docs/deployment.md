# 部署与构建

工程介绍见 [README](../README.md)。相关文档：[upstream-integration.md](upstream-integration.md)（接入数据上游）、[tools.md](tools.md)（工具清单，自动生成）、[ws-remote.md](ws-remote.md)（WS 远程接管）。

## 本地开发

```bash
pnpm install
pnpm run dev

pnpm run build      # 构建
pnpm run preview    # 预览
```

## 部署目标

构建时通过 `DEPLOY_TARGET` 环境变量切换适配器，同一份代码可部署到多个平台。

| 平台              | 适配器 / 方式                                    | 操作                                   |
| ----------------- | ------------------------------------------------ | -------------------------------------- |
| Vercel            | 默认，push 到 `main` 自动部署                    | 无需配置                               |
| Cloudflare Pages  | SvelteKit 预设                                   | 见下方设置表                           |
| GitHub Release    | adapter-static，供 Tauri 启动器消费              | push `main` 触发 `release-toolbox.yml` |
| 独立静态包（zip） | adapter-static（`STANDALONE=1`），纯前端无服务端 | `pnpm run package:standalone`          |

Cloudflare Pages 控制台设置：

| 设置         | 值                                        |
| ------------ | ----------------------------------------- |
| 框架预设     | SvelteKit                                 |
| 构建命令     | `DEPLOY_TARGET=cloudflare pnpm run build` |
| 构建输出目录 | `.svelte-kit/cloudflare`                  |
| 环境变量     | `DEPLOY_TARGET` = `cloudflare`            |

## GitHub Release 静态产物

启动器直接消费本仓库 Release，不依赖独立静态产物仓库。

```bash
DEPLOY_TARGET=static pnpm run build
node scripts/write-static-manifest.mjs
tar -czf toolbox.tar.gz -C build .
```

| 产物                                     | 内容                       |
| ---------------------------------------- | -------------------------- |
| `build/index.html` / `200.html` / `_app` | adapter-static 文件        |
| `build/manifest.json`                    | version / commit / builtAt |
| `toolbox.tar.gz`                         | 整个 `build/` 的归档       |

push `main` 后 workflow 创建 `toolbox-<sha>` Release，上传 `manifest.json` 与 `toolbox.tar.gz`。默认保留最近 3 个 Release，手动运行可用 `keep` 输入调整。

| 事项       | 说明                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| 权限       | 首次需在 `Settings → Actions → General → Workflow permissions` 选 `Read and write permissions`，否则 403 |
| 启动器读取 | `releases/latest/download/manifest.json`、`releases/latest/download/toolbox.tar.gz`                      |
| 本地验证   | `build/index.html` 起静态服务器即可打开，API 需启动器 Rust 服务提供                                      |

## 独立静态包（zip 分发）

纯前端产物，游戏数据由浏览器直接向上游（`static.nanoka.cc`，已开放 CORS）读取，工程 / 计算 / 排轴 / 分享全部本地完成。

```bash
pnpm run package:standalone     # 等价于 node scripts/build-standalone.mjs
```

产物 `dist/椰果工具箱.zip`：

| 约束     | 说明                                                                              |
| -------- | --------------------------------------------------------------------------------- |
| 部署位置 | zip 根即站点根，解压丢到任意静态服务器 / 对象存储，打开 `<域名>/`                 |
| 附带文件 | `使用说明.txt`、`本地预览.cmd` + `serve.mjs`（零依赖本地预览，可选）              |
| 打开方式 | **必须用 HTTP 服务器**；`file://` 加载 ES module 被浏览器禁止，双击会白屏         |
| 路径     | 资源走站点根绝对路径（`/_app/...`、`/icons/...`），只能部署在域名根，不能放子路径 |

与常规构建的差别（仅此构建生效，见 `scripts/build-standalone.mjs`）：

| 方面     | 有服务端的部署                 | 独立静态包（`STANDALONE=1`）                                                  |
| -------- | ------------------------------ | ----------------------------------------------------------------------------- |
| 适配器   | adapter-vercel / cloudflare    | adapter-static（`fallback: 200.html`）                                        |
| 路由     | `trailingSlash: 'never'`       | `trailingSlash: 'always'`（目录 + index.html）                                |
| 数据接口 | `/api/**` 由服务端转上游并缓存 | `src/lib/api/local-api.ts` 在浏览器内就地解析同一批路径，直调 provider 适配器 |

静态包不可用能力（调用时明确提示，不会静默算错）：

| 能力                 | 原因                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| 库街区（实验性）同步 | token 须留在服务端 httpOnly cookie，上游 `api.kurobbs.com` 不开放跨域 |
| AI 助手「网页抓取」  | 需服务端代理出网                                                      |
| 工坊站点标题抓取     | 跨域限制，工坊名称显示为地址                                          |

AI 对话可用，只能连**自身支持浏览器跨域**的 OpenAI 兼容端点（本地 Ollama / LM Studio 默认允许）。

## 完成检查

改动代码后：

```bash
pnpm run format        # Prettier
pnpm run lint:eslint   # ESLint，零错误
pnpm run check         # svelte-check + 图标集 / 静态闸门
```

新增 mdi 图标后重跑 `node scripts/collect-mdi-icons.mjs`，否则 `pnpm run check` 失败。

## 相关服务

工具箱可对接任意实现最小集接口的「工坊」做工程分享与数据同步；契约见工坊仓库 [docs/api.md](https://github.com/d4rkOfficial/wuwa-afyg-share/blob/master/docs/api.md)。
