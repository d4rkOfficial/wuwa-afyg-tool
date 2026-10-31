# 椰果工具箱 · WUWA-AFYG-TOOL

<p style="width:100%;text-align:center;">
  <img src="https://img.shields.io/badge/Framework-SvelteKit-FF3E00?logo=svelte&logoColor=white" alt="SvelteKit">
  <img src="https://img.shields.io/badge/Build-Vite-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white" alt="Vercel">
  <img src="https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Pages">
  <img src="https://img.shields.io/badge/Release-GitHub-181717?logo=github&logoColor=white" alt="GitHub Release">
</p>

<p style="width:100%;text-align:center;">
  适合所有人的《鸣潮》拉表、排轴、配装对比计算工具。
</p>

<p style="width:100%;text-align:center;">
  <img src="src/lib/assets/favicon.svg" alt="椰果工具箱">
</p>

主站：[凹分椰果](https://wuwa-afyg-tool.200503.xyz/) | 副站：[滑坡椰果](https://wuwa-hpyg-tool.200503.xyz/)

配套仓库：[启动器](https://github.com/d4rkOfficial/coconut-app)（桌面端 / 插件宿主）·
[工坊](https://github.com/d4rkOfficial/wuwa-afyg-share)


如果你需要比网页端更强大的椰果工具箱，另见椰果工具箱启动器：
[启动器下载](https://wuwa-afyg-share.200503.xyz/launcher) | [启动器插件 SDK](https://github.com/d4rkOfficial/coconut-app-plugin-sdk)

**椰果工具箱的功能**：把一名角色的整场战斗拆成「队伍 → 排轴 → 拉表 → 词条/环境配置 → 结果」五步，逐段配置伤害与 Buff，算清楚每一段伤害是怎么来的、DPS 是多少、哪个词条更值，并把整套配置保存为可分享、可对比的工程。

## 文档

| 文档                                                           | 内容                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [docs/deployment.md](docs/deployment.md)                       | 本地开发、构建预览、Vercel / Cloudflare Pages / GitHub Release、完成检查 |
| [docs/buff-engine.md](docs/buff-engine.md)                     | 计算引擎：一切皆 Buff、乘区算子、条件系统、引用转模                      |
| [docs/agent-harness.md](docs/agent-harness.md)                 | AI 助手：回合结构、上下文装配、变化队列、自定义 Skill                    |
| [docs/upstream-integration.md](docs/upstream-integration.md)   | 接入新数据上游（`DataProvider` 适配器、数据质量验收）                    |
| [docs/damage-type-inference.md](docs/damage-type-inference.md) | 伤害类型推导算法（判定链与护栏）与 TDD 用例流程                          |
| [docs/tools.md](docs/tools.md)                                 | AI 助手与 WS 远程接管共用的工具清单（按源码自动生成）                    |
| [docs/ws-remote.md](docs/ws-remote.md)                         | WS 远程接管：工具分类表与接入方式                                        |
| [工坊 API 文档](https://github.com/d4rkOfficial/wuwa-afyg-share/blob/master/docs/api.md) | 工坊对外接口（含「接入工具箱必须实现的最小集」） |

## 业务功能

### 工作流五阶段

- **队伍配置** — 选择角色、武器、首位声骸、触发套装；链阶档位随工程保存（底部「角色详情配置」按钮实时显示 `链阶` 串）
- **排轴** — 三轨操作块 + 时间参考线；支持变奏入场/切回标记、自动格式化、快速排轴（纯键盘）、复制粘贴、撤销重做
- **拉表** — 给每一段伤害绑定倍率与 Buff；Buff 支持追加/覆盖、固定值/引用转模；**生效条件挂在具体乘区条目上**（伤害类型 / 伤害属性），链条件与阶条件作为整个 Buff 的硬性条件且互相排斥；同一 Buff 内同名乘区可添加多条、各自带条件并按条件满足情况**相加**，覆盖条目优先于一切且同 Buff 内唯一；左侧 Buff 列表三级归类（全局 / 角色名X链 / 角色名的武器名，按角色+武器划分而非阶数 / 数字前后缀自动排序）；右栏「添加乘区」按九类分区、可拖拽调宽；Buff 全览与 Buff 差异两种视图；底部撤销/重做只回退表格
- **词条/环境配置** — 声骸主副词条（含随机强化与词条方案）、敌人属性与环境
- **结果** — 逐段伤害、乘区溯源（每段展开可见完整计算链与来源，复合倍率/额外倍率可查每一因子的伤害）、DPS 与伤害占比、直伤贡献分析（副词条三种算法 + 每条 Buff 的移除损失）、凹暴击/未命中模式、链阶对比

### 计算引擎（一切皆 Buff）

- 所有影响伤害计算的东西都是 **Buff 类实例**：角色面板 / 武器 / 声骸 / 敌人配置 / 公式固有乘区全部通过
  **统一贡献聚合**（单一 `ZONE_OPS` 乘区算子表）进入公式，不再有多处 switch 重复维护
- 完整伤害公式：攻击 × 增伤 × 加深 × 同奏 × 暴击 × 防御 × 抗性 × 免伤 等乘区
- 支持直伤、**效应伤害**、**谐度破坏 / 偏谐响应**三类输出
- **条件系统**：乘区级伤害类型与伤害属性条件；Buff 实例级链条件 / 阶条件（硬性，且二选一）
- **链阶档位**：真源是角色槽位（`chain` / `refinement`），随工程保存，底部「角色详情配置」按钮实时显示 `链阶` 串
- **跨角色引用影响源**：本段伤害引用了别的角色面板时，会改写该面板的 Buff 会作为可勾选条目出现在拉表里（平铺=该角色组内的列，下拉=该条目的 chip），勾上即参与被引用角色在这一段的面板计算；未被本段勾选的其它条目绑定不参与（伤害是当下的）
- 伤害类型自动推导：按技能倍率名（「普攻·」「重击·」等前缀）与技能文案（「视为 XX 伤害」）自动判定，用户手动设置优先；详见 [docs/damage-type-inference.md](docs/damage-type-inference.md)

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

## 测试

测试**全部放仓库根目录 `test/` 下，并镜像源码路径** —— `src/lib/a.ts` 的测试就放 `test/src/lib/a.test.ts`
（映射口径的唯一实现在 [test/paths.ts](test/paths.ts)：`testPathOf` / `sourcePathOf` / `discoverTestFiles`）。

聚合入口 [test/run-tests.ts](test/run-tests.ts) **自动发现** `test/**/*.test.ts` 并逐个隔离加载，**不需要维护 import 清单**：
过去手写清单漏登记过 3 个文件、41 条用例（`pnpm test` 毫无提示），且有文件在 import 期抛错时整批静默消失；
现在加载失败会显式报错并让退出码变 1。

```bash
pnpm test                 # 跑全部（同进程内逐个 import；本环境禁止子进程，故不用 node --test）
pnpm test:one calc        # 只跑路径含 "calc" 的测试文件
pnpm test:list            # 列出会被跑到的文件
pnpm test:watch           # 监视重跑
pnpm test:infer           # 联网的伤害类型推导 TDD 夹具（默认不在 pnpm test 内）
```

单个文件也可以直接跑：`node --import ./test/preload-runes.mjs --import ./test/preload.mjs test/src/lib/calc/coeff-crit.test.ts`。

## API

工具箱自身提供只读数据接口（供 AI 助手、外部脚本与自建站点使用），基于上游数据精简提纯并随游戏版本自动更新；上游以 `DataProvider` 适配器模式接入（`src/lib/api/provider/`），新增上游的流程与验收标准见 [docs/upstream-integration.md](docs/upstream-integration.md)。

## 声明

本项目基于 [MIT 许可](LICENSE) 开源，并附有原作者的补充声明，详情请参阅 LICENSE 文件。
