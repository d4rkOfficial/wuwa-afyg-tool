# 椰果工具箱 · WUWA-AFYG-TOOL

<p style="width:100%;text-align:center;">
  <img src="https://img.shields.io/badge/Framework-SvelteKit-FF3E00?logo=svelte&logoColor=white" alt="SvelteKit">
  <img src="https://img.shields.io/badge/Build-Vite-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white" alt="Vercel">
  <img src="https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Pages">
</p>

<p style="width:100%;text-align:center;">
  适合所有人的《鸣潮》拉表、排轴、配装对比计算工具。
</p>

<p style="width:100%;text-align:center;">
  <img src="src\lib\assets\favicon.svg" alt="SvelteKit">
</p>

主站：[https://wuwa-藕粉椰果-tool.200503.xyz/](https://wuwa-afyg-tool.200503.xyz/)

副站：[https://wuwa-活泼椰果-tool.200503.xyz/](https://wuwa-hpyg-tool.200503.xyz/)

## 功能

- **队伍配置** — 选择角色、武器、首位声骸、套装
- **排轴** — 序列编排操作块和时间参考线，准确的二合一排轴
- **拉表** — 支持 Buff-全览、Buff-差异 模式，给每一段伤害配置 Buff
- **词条/环境配置** — 声骸主副词条配置、敌怪环境设置
- **结果：数据分析** — 具体、分段、清晰的伤害计算过程及DPS、伤害占比

## 技术栈

| 层   | 技术                                                                              |
| ---- | --------------------------------------------------------------------------------- |
| 框架 | [SvelteKit](https://kit.svelte.dev/) (Svelte 5, Runes)                            |
| 构建 | [Vite](https://vitejs.dev/)                                                       |
| 部署 | [Vercel](https://vercel.com/) · [Cloudflare Pages](https://pages.cloudflare.com/) |
| 语言 | TypeScript                                                                        |
| 样式 | TailwindCSS                                                                       |
| 图标 | [Iconify](https://iconify.design/) (`@iconify/svelte` + Material Design Icons)    |

## 本地

### 开发

```bash
pnpm install
pnpm run dev
```

### 构建 & 预览

```bash
pnpm run build
pnpm run preview
```

## 部署

项目直接支持 **Vercel** 与 **Cloudflare Pages** 双平台部署。构建时通过 `DEPLOY_TARGET` 环境变量切换适配器。

### Vercel

默认适配器，push 到 `main` 分支后 Vercel 自动部署（无需额外配置）。

### Cloudflare Pages

在 CF Pages 控制台新建项目，连接同一仓库，配置如下：

| 设置         | 值                                        |
| ------------ | ----------------------------------------- |
| 框架预设     | SvelteKit                                 |
| 构建命令     | `DEPLOY_TARGET=cloudflare pnpm run build` |
| 构建输出目录 | `.svelte-kit/cloudflare`                  |
| 环境变量     | `DEPLOY_TARGET` = `cloudflare`            |

## API

API 基于 [nanoka](https://ww.nanoka.cc) 精简提纯，随版本自动更新。
详情见 [API测试页(afyg)](https://wuwa-afyg-tool.200503.xyz/api-test) 或者 [API测试页(hpyg)](https://wuwa-hpyg-tool.200503.xyz/api-test)。

### 列表

直接获取 Nanoka 的各种资源列表。

```
GET /api/v1/list/character
GET /api/v1/list/weapon
GET /api/v1/list/echo
GET /api/v1/list/echo-set
```

### 图标

直接获取 Nanoka 的各种图标资源列表。

```
GET /api/v1/icons/character
GET /api/v1/icons/weapon
GET /api/v1/icons/echo
GET /api/v1/icons/element
GET /api/v1/icons/weapon-type
GET /api/v1/icons/echo-set
GET /api/v1/icons/ui-btn
```

### 详情

传角色/武器/声骸/套装中文名，返回详情。

```
GET /api/v1/info/character/:name
GET /api/v1/info/weapon/:name
GET /api/v1/info/echo/:name
GET /api/v1/info/echo-set/:name
```

### 推荐

传角色中文名，返回声骸推荐。

```
GET /api/v1/recommend/:character
GET /api/v1/recommend-weapon/:character
```

## 声明

本项目基于 [MIT 许可](LICENSE) 开源，并附有原作者的补充声明，详情请参阅 LICENSE 文件。
