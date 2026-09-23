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

## 完成检查（改动代码后）

```bash
pnpm run format        # Prettier
pnpm run lint:eslint   # ESLint（必须零错误）
pnpm run check         # svelte-kit sync + svelte-check + mdi 图标集校验
```

新增 mdi 图标后需要重跑 `node scripts/collect-mdi-icons.mjs` 生成本地图标集合，否则 `pnpm run check` 会失败。

## 相关服务

工具箱可对接任意实现了最小集接口的「工坊」用作工程分享与数据同步；接口契约见工坊仓库的 [docs/api.md](https://github.com/d4rkOfficial/wuwa-afyg-share/blob/master/docs/api.md)。
