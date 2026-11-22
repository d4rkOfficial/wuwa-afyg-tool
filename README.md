<div align="center">

<img src="src/lib/assets/favicon.svg" alt="椰果工具箱" width="110" />

<h1>椰果工具箱</h1>

<p><i>基于“一切皆 Buff”架构的《鸣潮》拉表工具</i></p>

<p>
<img src="https://img.shields.io/badge/SvelteKit-FF3E00?logo=svelte&logoColor=white" alt="SvelteKit" />
<img src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white" alt="Vite" />
<img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
<img src="https://img.shields.io/badge/TailwindCSS-06B6D4?logo=tailwindcss&logoColor=white" alt="TailwindCSS" />
<img src="https://img.shields.io/badge/Iconify-3E7BFA?logo=iconify&logoColor=white" alt="Iconify" />
<img src="https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white" alt="Vercel" />
<img src="https://img.shields.io/badge/Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Pages" />
<img src="https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white" alt="GitHub Release" />
<a href="https://www.bilibili.com/toy/coconut-toolbox/index.html"><img src="https://img.shields.io/badge/Bilibili%20Toy-FB7299?logo=bilibili&logoColor=white" alt="Bilibili Toy" /></a>
</p>

</div>

---

### 网页版
在线访问椰果工具箱。
[前往主站(vercel)](https://wuwa-afyg-tool.200503.xyz/) | [前往副站(cfpages)](https://wuwa-hpyg-tool.200503.xyz/)

### 启动器
椰果工具箱的桌面启动器，支持插件拓展功能。
 [启动器仓库](https://github.com/d4rkOfficial/coconut-app) | [插件 SDK仓库](https://github.com/d4rkOfficial/coconut-app-plugin-sdk)

### 椰果工坊
工程分享平台，也维护着一套Buff集、拉表词条集。
[前往椰果工坊](https://github.com/d4rkOfficial/wuwa-afyg-share)
</div>


## 功能

把角色整场战斗拆成**五步**，逐段配置**伤害与 Buff**，算清每段伤害的**来源、DPS 与词条收益**；整套配置可**保存、分享、对比**。

| 阶段            | 内容                              |
| --------------- | --------------------------------- |
| **队伍**        | 角色 / 武器 / 声骸 / 套装         |
| **排轴**        | 三轨操作块 + 时间线               |
| **拉表**        | 每段伤害绑定倍率与 Buff           |
| **词条 / 环境** | 声骸词条、敌人属性与环境          |
| **结果**        | 逐段伤害、乘区溯源、DPS、贡献分析 |

## 一切皆 Buff

**一切的拉表 = 伤害 + 乘区**，而**具体 Buff 影响具体乘区**。所有影响伤害的东西（面板 / 武器 / 声骸 / 敌人配置 / 公式固有乘区）都编译成 **Buff 落值**，作用表与乘子链按版本登记在 [`src/coconut-config/`](src/coconut-config)。

顶层引擎的 **Buff 带条件**，带来**两点好处**：

| 场景                      | 效果                                    |
| ------------------------- | --------------------------------------- |
| **改共鸣链 / 武器精炼阶** | **Buff 副作用与伤害计算随条件自动改动** |
| **拉表配 Buff**           | **被条件门槛拦截，降低拉假表的可能**    |

## 底层计算引擎

椰果工具箱底层计算引擎为 [CoconutCore](docs/coconut-core.md) 。是**纯函数伤害计算引擎**，面板 / 乘区 / 公式均可**自行注册**，适合所有战斗二游的**伤害计算与 Buff 贡献溯源**。自愿放弃版权，随意使用、二次开发、发布，无需标注出处。

```sh
npm i https://github.com/d4rkOfficial/wuwa-afyg-tool/releases/download/core-v0.1.0/d4rkofficial-coconut-core-0.1.0.tgz
```

## 文档

| 文档                                                                                     | 内容                                                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [docs/deployment.md](docs/deployment.md)                                                 | 本地开发、构建预览、Vercel / Cloudflare Pages / GitHub Release、完成检查 |
| [docs/coconut-core.md](docs/coconut-core.md)                                             | 计算引擎 CoconutCore：安装、注册、输入输出与计算说明                     |
| [docs/adding-calculation-feature.md](docs/adding-calculation-feature.md)                 | 新增计算特性（作用 / 乘子 / 公式 / 系数）的步骤、测试与闸门清单          |
| [docs/buff-engine.md](docs/buff-engine.md)                                               | 一切皆 Buff、乘区算子、条件系统、引用转模                                |
| [docs/agent-harness.md](docs/agent-harness.md)                                           | AI 助手：回合结构、上下文装配、变化队列、自定义 Skill                    |
| [docs/upstream-integration.md](docs/upstream-integration.md)                             | 接入新数据上游（`DataProvider` 适配器、数据质量验收）                    |
| [docs/damage-type-inference.md](docs/damage-type-inference.md)                           | 伤害类型推导算法与 TDD 用例流程                                          |
| [docs/tools.md](docs/tools.md)                                                           | AI 助手与 WS 远程接管共用的工具清单（按源码自动生成）                    |
| [docs/fast-calc.md](docs/fast-calc.md)                                                   | 简表 fast-calc：导入工程、编辑词条/敌怪、乘区溯源与 postMessage 协议     |
| [docs/ws-remote.md](docs/ws-remote.md)                                                   | WS 远程接管：工具分类表与接入方式                                        |
| [工坊 API 文档](https://github.com/d4rkOfficial/wuwa-afyg-share/blob/master/docs/api.md) | 工坊对外接口（含「接入工具箱必须实现的最小集」）                         |

## 测试

测试**镜像源码路径**放在 `test/`（`src/lib/a.ts` → `test/src/lib/a.test.ts`，映射见 [test/paths.ts](test/paths.ts)）。[test/run-tests.ts](test/run-tests.ts) **自动发现** `test/**/*.test.ts` 并逐个隔离加载，加载失败显式报错、**退出码为 1**。

```bash
pnpm test         # 全部
pnpm test calc    # 只跑路径含 "calc" 的文件
pnpm test:list    # 列出文件
pnpm test:watch   # 监视重跑
pnpm test:infer   # 联网 TDD 夹具（默认不在 pnpm test 内）
```

单文件：`node --import ./test/preload-runes.mjs --import ./test/preload.mjs test/src/coconut-core/engine/coeff-crit.test.ts`

## API

**只读数据接口**，供 AI 助手、外部脚本与自建站点使用，随游戏版本自动更新；上游以 `DataProvider` 适配器接入（[`src/lib/api/provider/`](src/lib/api/provider)），见 [docs/upstream-integration.md](docs/upstream-integration.md)。

## 声明

[MIT 许可](LICENSE) + 原作者补充声明。
