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
  <img src="src/lib/assets/favicon.svg" alt="椰果工具箱">
</p>

主站：[凹分椰果](https://wuwa-afyg-tool.200503.xyz/) | 副站：[滑坡椰果](https://wuwa-hpyg-tool.200503.xyz/)

**业务一句话**：把一名角色的整场战斗拆成「队伍 → 排轴 → 拉表 → 词条/环境 → 结果」五步，逐段配置伤害与 Buff，算清楚每一段伤害是怎么来的、DPS 是多少、哪个词条更值，并把整套配置保存为可分享、可对比的工程。

## 文档

| 文档                                                           | 内容                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| [docs/deployment.md](docs/deployment.md)                       | 本地开发、构建预览、Vercel / Cloudflare Pages 部署、完成检查 |
| [docs/upstream-integration.md](docs/upstream-integration.md)   | 接入新数据上游（`DataProvider` 适配器、数据质量验收）        |
| [docs/damage-type-inference.md](docs/damage-type-inference.md) | 伤害类型推导算法（判定链与护栏）与 TDD 用例流程              |
| [docs/tools.md](docs/tools.md)                                 | AI 助手与 WS 远程接管共用的工具清单（按源码自动生成）        |
| [docs/ws-remote.md](docs/ws-remote.md)                         | WS 远程接管：工具分类表与接入方式                            |

### 另见：椰果工坊

工程分享与共享数据（Buff 集 / 标准词条集）的配套服务：

- 基于 Supabase：[d4rkOfficial/wuwa-afyg-share](https://github.com/d4rkOfficial/wuwa-afyg-share)
- 基于 GitHub Issues：[CoconutToolBox/wuwa-afyg-share-github](https://github.com/CoconutToolBox/wuwa-afyg-share-github)

工坊对外接口（含「接入工具箱必须实现的最小集」）见 [工坊 API 文档](https://github.com/d4rkOfficial/wuwa-afyg-share/blob/master/docs/api.md)。

## 业务功能

### 工作流五阶段

- **队伍配置** — 选择角色、武器、首位声骸、触发套装
- **排轴** — 三轨操作块 + 时间参考线；支持变奏入场/切回标记、自动格式化、快速排轴（纯键盘）、复制粘贴、撤销重做
- **拉表** — 给每一段伤害绑定倍率与 Buff；Buff 支持追加/覆盖、固定值/引用转模、生效条件（共鸣链 / 精炼阶数 / 属性 / 伤害类型）；Buff 全览与 Buff 差异两种视图；速查弹窗展示倍率的共鸣能量与偏谐值
- **词条/环境配置** — 声骸主副词条（含随机强化与词条方案）、敌人属性与环境
- **结果** — 逐段伤害、乘区溯源（每段展开可见完整计算链与来源）、DPS 与伤害占比、副词条贡献分析（三种算法）、凹暴击/未命中模式、链阶对比

### 计算引擎

- 完整伤害公式：攻击 × 增伤 × 加深 × 同奏 × 暴击 × 防御 × 抗性 × 免伤 等乘区
- 支持直伤、**效应伤害**、**谐度破坏 / 偏谐响应**三类输出；同名机制与 buff 按条目独立配置
- 伤害类型自动推导：按技能倍率名（「普攻·」「重击·」等前缀）与技能文案（「视为 XX 伤害」，含角色技能与声骸技能）自动判定，用户手动设置优先；算法判定链、护栏与 TDD 用例流程见 [docs/damage-type-inference.md](docs/damage-type-inference.md)

### 数据与共享

- **Buff 集（本地库 + 工坊同步）** — 按实体（角色/武器/声骸/套装）组织，可编辑、导出、一键导入工程；可从工坊同步，本地自定义不受覆盖
- **标准词条集** — 一键把角色 5 个声骸套成「标准 14 词条」（主词条：4cost 按固有属性取暴击率/暴击伤害、3cost 取属性伤害加成、1cost 取攻击%/生命%/防御%，**数值固定为满级上限**；副主词条**按 cost 自动推导**；副词条 5 暴击 + 5 暴伤 + 2 百分比 + 2 固定值，**数值从档位中选择**）。cost 组合不锁死 43311，5 部位合计 ≤ 12 即可自由调整；特殊角色方案由工坊记录并同步；用户可另存多套方案在工程间快速覆盖
- **工程** — 保存/克隆/归档/导出导入；经工坊生成分享链接，他人可一键导入
- **AI 助手** — 站内对话式操作：生成 Buff 集、查询计算结果与乘区溯源、数据分析、批量排轴/拉表配置；可接任意 OpenAI 兼容服务
- **WS 远程接管** — 通过 WebSocket 让外部程序/脚本调用同一套工具能力（见 [docs/ws-remote.md](docs/ws-remote.md)）

## 技术栈

| 层   | 技术                                                                              |
| ---- | --------------------------------------------------------------------------------- |
| 框架 | [SvelteKit](https://kit.svelte.dev/) (Svelte 5, Runes)                            |
| 构建 | [Vite](https://vitejs.dev/)                                                       |
| 部署 | [Vercel](https://vercel.com/) · [Cloudflare Pages](https://pages.cloudflare.com/) |
| 语言 | TypeScript                                                                        |
| 样式 | [TailwindCSS](https://tailwindcss.com)                                            |
| 图标 | [Iconify](https://iconify.design/) (`@iconify/svelte` + Material Design Icons)    |
| 数据 | 本地 IndexedDB + 上游数据缓存（[nanoka](https://ww.nanoka.cc) 等）                |

部署与构建见 [docs/deployment.md](docs/deployment.md)；上游数据接入见 [docs/upstream-integration.md](docs/upstream-integration.md)。

## API

工具箱自身提供只读数据接口（供 AI 助手、外部脚本与自建站点使用），基于上游数据精简提纯并随游戏版本自动更新；上游以 `DataProvider` 适配器模式接入（`src/lib/api/provider/`），新增上游的流程与验收标准见 [docs/upstream-integration.md](docs/upstream-integration.md)。

## 声明

本项目基于 [MIT 许可](LICENSE) 开源，并附有原作者的补充声明，详情请参阅 LICENSE 文件。
