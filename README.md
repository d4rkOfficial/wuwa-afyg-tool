# 椰果工具箱 · WUWA-AFYG-TOOL

<p>
  <img src="https://img.shields.io/badge/Framework-SvelteKit-FF3E00?logo=svelte&logoColor=white" alt="SvelteKit">
  <img src="https://img.shields.io/badge/Build-Vite-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white" alt="Vercel">
  <img src="https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Pages">
  <a href="https://wuwa-afyg-tool.200503.xyz/"><img src="https://img.shields.io/badge/Live-Demo-22c55e?logo=internetexplorer&logoColor=white" alt="Live Demo"></a>
</p>

《鸣潮》（Wuthering Waves）声骸配装 & 伤害计算工具。声骸 Cost 管理、词条筛选、Buff 配置、排轴伤害模拟一站式完成。

## 功能

- **队伍配置** — 选择角色、武器，自动推荐配装
- **声骸配装** — Cost 分配、主词条/副词条配置、随机强化模拟
- **排轴** — 技能序列编排，直观的伤害时间轴
- **拉表计算** — Buff 叠加、伤害乘区计算、伤害期望分析
- **词条/环境配置** — 声骸副词条管理、怪物属性与抗性设置
- **数据分析** — 多维度伤害构成分析

## 技术栈

| 层   | 技术                                                                              |
| ---- | --------------------------------------------------------------------------------- |
| 框架 | [SvelteKit](https://kit.svelte.dev/) (Svelte 5, Runes)                            |
| 构建 | [Vite](https://vitejs.dev/)                                                       |
| 部署 | [Vercel](https://vercel.com/) · [Cloudflare Pages](https://pages.cloudflare.com/) |
| 语言 | TypeScript                                                                        |
| 样式 | TailwindCSS                                                                       |
| 图标 | [Iconify](https://iconify.design/) (`@iconify/svelte` + Material Design Icons)    |

## 本地开发

```bash
pnpm install
pnpm run dev
```

## 构建 & 预览

```bash
pnpm run build
pnpm run preview
```

## 部署

项目支持 **Vercel** 与 **Cloudflare Pages** 双平台部署。构建时通过 `DEPLOY_TARGET` 环境变量切换适配器。

### Vercel

默认适配器，push 到 `main` 分支后 Vercel 自动部署（无需额外配置）。

在线地址：[https://wuwa-afyg-tool.200503.xyz/](https://wuwa-afyg-tool.200503.xyz/)

### Cloudflare Pages

在 CF Pages 控制台新建项目，连接同一仓库，配置如下：

| 设置         | 值                                        |
| ------------ | ----------------------------------------- |
| 框架预设     | SvelteKit                                 |
| 构建命令     | `DEPLOY_TARGET=cloudflare pnpm run build` |
| 构建输出目录 | `.svelte-kit/cloudflare`                  |
| 环境变量     | `DEPLOY_TARGET` = `cloudflare`            |

## 声明

本项目基于 [MIT 许可](LICENSE) 开源，并附有原作者的补充声明，详情请参阅 LICENSE 文件。
