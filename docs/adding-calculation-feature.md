# 新增游戏计算特性

版本更新带来的计算变化集中在同一批文件。类型系统会替你把「漏登记」报成编译错误，实际做法是**跟着报错填**。

配套阅读：[coconut-core.md](coconut-core.md)（版本链与内核契约）、[buff-engine.md](buff-engine.md)（一切皆 Buff、条件系统）。

## 改动分类

| 类型                           | 仓库实例                    | 落点                                                              |
| ------------------------------ | --------------------------- | ----------------------------------------------------------------- |
| 新作用（面板 / 目标侧落点）    | 集谐干涉层数、同奏增益层数  | `data.ts` → `versions.ts` → `display-meta.ts`                     |
| 新乘子（乘区数学）             | 谐度区、集谐区、同奏区      | `multipliers.ts` + `formulas.ts` 的 `ORDER_x` + `damage-trace.ts` |
| 新公式（基值 + 链 + 暴击基准） | 效应、处决                  | `formulas.ts` / `versions.ts` + `display-meta.ts`                 |
| 系数 / 常数调整                | 偏谐系数、效应基础值        | `calc/compute.ts` 的 `TUNE_COEFF_MAP`、`consts/effect-data.ts`    |
| 新词条 / 元素 / 伤害类型       | 新元素、新副词条            | `consts/game-terms.ts`、`stat-data.ts`、`calc/stat-writes.ts`     |
| 新效应                         | 六种效应（光噪 / 霜渐 / …） | `consts/effect-data.ts`（层数表 + 基础值）                        |
| 内核能力                       | 面板字段、暴击基准契约      | `src/coconut-core/**`（见「动内核」）                             |

## 版本块

[`src/coconut-config/versions.ts`](../src/coconut-config/versions.ts)：复制最后一版，改 `actions` / `multipliers` / `formulas`。只有最后一版进 `config`，历史版本继续受 `satisfies CoconutCoreConfig` 校验。

内核 `createFormulaRegistry` 在 `init` 时校验两条硬约束：

| #   | 约束                                             |
| --- | ------------------------------------------------ |
| 1   | 公式链里的乘子顺序必须与 `ORDER_x`（注册序）一致 |
| 2   | 链里引用的乘子必须在同一版的 `multipliers` 里    |

## 新作用

| 步  | 文件 / 位置                                                       | 内容                                                                                           |
| --- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | `coconut-config/data.ts`                                          | 新增 `as const satisfies BuffActionDef` 导出；id 加进 `CalcActionId` 联合                      |
| 2   | 同上 `REF_ACTIONS`                                                | 可作引用来源则加入（展示名在 `display-meta.ts` 的 `refName`）                                  |
| 3   | `versions.ts`                                                     | 对应版本块的 `actions` 末尾追加                                                                |
| 4   | [`src/lib/calc/display-meta.ts`](../src/lib/calc/display-meta.ts) | `ACTION_META` 补 `label` / `unit` / `group`（按需 `internal` / `damageMatchable` / `refName`） |
| 5   | AI 工具手写说明串                                                 | `ai/tools/calculation.ts` 的 `zoneId 可选：…` 手工补一项（唯一例外）                           |

界面与 AI 清单不用手改：`calc/calculation.consts.ts` 的 `ZONE_DEFS` / `ZONE_SECTIONS` 由作用表 + `ACTION_META` 派生，`ai/generate/prompts.ts` 乘区文本同源。

## 新乘子

| 步  | 文件 / 位置                                                       | 内容                                                                                      |
| --- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | `coconut-config/multipliers.ts`                                   | `defineFormula({ id, inputs, uses? }, compute)`                                           |
| 2   | `coconut-config/formulas.ts`                                      | 在 `ORDER_x` 排位（注册序 = 链序），必要时新增 `ORDER`                                    |
| 3   | [`src/lib/calc/display-meta.ts`](../src/lib/calc/display-meta.ts) | `MULTIPLIER_META` 补 `label` 与 `display`                                                 |
| 4   | [`src/lib/calc/damage-trace.ts`](../src/lib/calc/damage-trace.ts) | `SEGMENT_BUILDERS` 补一段（`Record<MultiplierId, …>`，决定结果页展示与来源）              |
| 5   | `calc/result.types.ts` 等                                         | 需新 `ResultEntry` 字段：加字段 → `compute.ts` 赋值 → `compute-facade.ts` 同步 → 界面组件 |
| 6   | 结果页独立列                                                      | `result.types.ts` → `compute.ts` → `compute-facade.ts` 列映射 → 表格组件                  |
| 7   | 仅调数值                                                          | 直接改 `multipliers.ts` 系数，无需新版本块                                                |

## 新公式

| 步  | 文件 / 位置                  | 内容                                                                        |
| --- | ---------------------------- | --------------------------------------------------------------------------- |
| 1   | `coconut-config/formulas.ts` | `formula(id, base, chain, critBase)`；`id` 即界面与表里的公式名             |
| 2   | `versions.ts`                | 该版本 `formulas` 列表加上它（整表替换，别漏已有条目）                      |
| 3   | `display-meta.ts`            | `FORMULA_META` 补项，`FormulaKey` 联合同步                                  |
| 4   | 新基值配方                   | 非 `panelStat` / `zone` / `targetStat` / `fixed` 时属内核算术，见「动内核」 |
| 5   | 公式可选                     | 补 `ai/**` 枚举                                                             |

## 系数与效应表

| 内容                   | 文件 / 位置                                                                                                 | 要求                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 偏谐系数（按敌人类型） | [`src/lib/calc/compute.ts`](../src/lib/calc/compute.ts) 的 `TUNE_COEFF_MAP`                                 | 写游戏原值**不取整**（先取整会把放大后的误差带进结果）；兜底 `TUNE_COEFF_FALLBACK` |
| 效应层数倍率与基础值   | [`src/lib/consts/effect-data.ts`](../src/lib/consts/effect-data.ts) 的 `EFFECT_BASE_VALUE` / `EFFECT_TABLE` | —                                                                                  |

## 词条 / 元素 / 伤害类型

| 内容                             | 文件                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| 元素、伤害类型、技能类型、抗性键 | [`src/lib/consts/game-terms.ts`](../src/lib/consts/game-terms.ts)                                   |
| 副词条 label 与档位              | [`src/lib/consts/stat-data.ts`](../src/lib/consts/stat-data.ts)                                     |
| 词条 label → 面板落点            | [`src/lib/calc/stat-writes.ts`](../src/lib/calc/stat-writes.ts)（`ACTION_STATS` / `BASE_SUFFIXES`） |

## 动内核

判据：「纯计算 + 零语料 + 零内置表」。改 `src/coconut-core/**` 必须同时做到：

| 步  | 要求                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `node scripts/check-calc-core.mjs` 通过：每个文件作入口做 import 闭包检查，不得触达 `$app/*` / `$lib/*` / `$coconut-config`                   |
| 2   | `pnpm run build:core` / `release:core` 重新生成内核包与 `.d.ts`；版本号在 [`src/coconut-core/package.json`](../src/coconut-core/package.json) |
| 3   | 上层只从 `$lib/calc/core-config.ts` 取用；[`src/coconut-config`](../src/coconut-config) 只用 `$coconut-core` 公开入口与 `defineFormula`       |

## 测试与闸门

| 命令                   | 拦住什么                                       |
| ---------------------- | ---------------------------------------------- |
| `pnpm run format`      | 格式（src / test / docs / scripts）            |
| `pnpm run lint:eslint` | 纯逻辑函数式规则、Svelte `require-each-key`    |
| `pnpm run check`       | `svelte-check` + 静态闸门                      |
| `pnpm test`            | 全部单测；改计算时先 `pnpm test calc` 缩小范围 |

`pnpm run check` 中与新增计算特性相关的闸门：

| 闸门                                                             | 作用                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| `check-calc-core`                                                | 内核 import 闭包纯净、零语料、零内置表、单一出口         |
| `check-no-hardcoded-ids`                                         | app 层实体名棘轮（基线只许降）；新乘区写 id 字面量会顶破 |
| `generate-components-doc --check` / `generate-tools-doc --check` | 改 `ui/` 组件或 AI 工具后要重新生成                      |

改动后更新数值快照：

```sh
$env:UPDATE_GOLDEN=1; pnpm test compute-golden
# 核对 .tmp/golden-snapshot.json 的 diff，再贴回测试里的 GOLDEN
```

主要测试文件（改哪块先跑哪块）：

| 文件                                                                                      | 钉住什么                                  |
| ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| [`test/src/coconut-core/kernel.test.ts`](../test/src/coconut-core/kernel.test.ts)         | 内核契约：配置校验、trace、系数基准       |
| [`test/src/lib/calc/compile.test.ts`](../test/src/lib/calc/compile.test.ts)               | 编译器压表 vs 引擎逐条目数值对账          |
| [`test/src/lib/calc/compute-golden.test.ts`](../test/src/lib/calc/compute-golden.test.ts) | 数值基线（全部数值字段 + 乘区段 id 序列） |
| `test/src/lib/calc/{core-config,formula-registry,coeff-crit,resolve-memo}.test.ts`        | 注册表 / 公式链 / 系数基准 / 解析去重     |

新增特性至少覆盖三件事：一段真实倍率的数值、乘区明细里出现该段、溯源段出现该段与来源。

## 文档同步

| 文件                                              | 改什么                                                    |
| ------------------------------------------------- | --------------------------------------------------------- |
| [`docs/coconut-core.md`](../docs/coconut-core.md) | 版本链小节（顶部计数已移除）                              |
| [`docs/buff-engine.md`](../docs/buff-engine.md)   | 乘区 / 公式说明与展示名                                   |
| [`docs/tools.md`](../docs/tools.md)               | AI 工具清单变了跑 `pnpm run generate-tools-doc`（生成物） |
| `README.md`                                       | 「计算引擎」小节（仅对外能力变化时）                      |

## 收尾核对

| #   | 核对项                                                                        |
| --- | ----------------------------------------------------------------------------- |
| 1   | 版本块开好，只有最后一版进 `config`                                           |
| 2   | 新作用：`data.ts` + `CalcActionId` + `ACTION_META`（必要时 `REF_ACTIONS`）    |
| 3   | 新乘子：`multipliers.ts` + `ORDER_x` + `MULTIPLIER_META` + `SEGMENT_BUILDERS` |
| 4   | 新公式：`formulas.ts` / `versions.ts` + `FORMULA_META` + `FormulaKey`         |
| 5   | 系数与效应表按游戏原值写入                                                    |
| 6   | `pnpm test` 通过；计算变化时更新 `GOLDEN` 并核对 diff                         |
| 7   | `pnpm run format` / `lint:eslint` / `check` 全绿                              |
| 8   | 文档同步；对外发布的配置包已重新生成（`pnpm run release:config`）             |
| 9   | 未删除或改名既有 id（否则在 [`src/migration/`](../src/migration) 写迁移）     |

## 常见坑

| 坑                         | 后果 / 处理                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 链序 = 注册序              | 新乘子插进 `multipliers` 中间时，`ORDER_x` 与所有引用它的公式链调到同一相对位置，否则 `init` 抛「multiplier order must follow registration order」 |
| `satisfies` 不接受额外字段 | 版本块加 `version: '3.8'` 之类字段会编译失败                                                                                                       |
| 改乘子数学 ≠ 加一版        | 公式链存的是 handle，改数学要在版本块里重建所有引用它的公式                                                                                        |
| 展示元数据是并集           | `ACTION_META` / `MULTIPLIER_META` / `FORMULA_META` 覆盖所有版本出现过的 id                                                                         |
| 缓存指纹                   | 结果页跨轮缓存以多因子为键，新增影响数值的输入必须并进 `computeInputsSignatureOf`，否则页面拿旧结果                                                |
| 溯源与列映射不自动         | config 加乘子后，结果页独立列与溯源分区各要一处登记（见「新乘子」5、6）                                                                            |
