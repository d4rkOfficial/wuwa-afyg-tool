# 新增游戏计算特性的机械步骤

游戏版本更新带来的「口径」变化，绝大多数都落在同一批文件上。这份文档把步骤固定下来，按顺序做即可；
类型系统会替你把「漏登记」直接报成编译错误，所以真正的顺序是**跟着报错填**。

配套阅读：[`coconut-core.md`](coconut-core.md)（注册配置的版本链与内核契约）、
[`buff-engine.md`](buff-engine.md)（一切皆 Buff、乘区算子、条件系统）。

## 0. 先定位：这次改动属于哪一类

| 类型                            | 仓库里的实例                                | 主要落点                                                             |
| ------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| 新作用（一个面板 / 目标侧落点） | 集谐干涉层数、同奏增益层数                  | `coconut-config/data.ts` → `versions.ts` → `display-meta.ts`         |
| 新乘子（乘区数学）              | 谐度区（2.0）、集谐区（3.0）、同奏区（3.7） | `multipliers.ts` + `formulas.ts` 的 `ORDER_x` + `damage-trace.ts`    |
| 新公式（基值 + 链 + 暴击口径）  | 处决（2.0）、效应（3.0）                    | `formulas.ts` / `versions.ts` + `display-meta.ts`                    |
| 系数 / 常数调整                 | 偏谐系数、效应基础值                        | `calc/compute.ts` 的 `TUNE_COEFF_MAP`、`consts/effect-data.ts`       |
| 新词条 / 元素 / 伤害类型        | 新元素、新副词条                            | `consts/game-terms.ts`、`consts/stat-data.ts`、`calc/stat-writes.ts` |
| 新效应                          | 六种效应（光噪 / 霜渐 / …）                 | `consts/effect-data.ts`（层数表 + 基础值）                           |
| 内核能力                        | 面板字段、暴击口径契约                      | `src/coconut-core/**`（见 §7）                                       |

## 1. 一律先开一个版本块

`src/coconut-config/versions.ts`：复制最后一版，改 `actions` / `multipliers` / `formulas`，注释写清这一版加了什么
（范例：`v3_7` 加入同奏区）。只有最后一版被 `config` 使用；历史版本继续受 `satisfies CoconutCoreConfig` 校验。

内核 `createFormulaRegistry` 会在 `init` 时当场抛错，两条硬约束：

1. 公式链里的乘子顺序必须与 `ORDER_x`（乘子注册序）一致；
2. 链里引用的乘子必须在同一版的 `multipliers` 里。

## 2. 新作用

1. `src/coconut-config/data.ts`：新增一条 `as const satisfies BuffActionDef` 单条导出
   （`id` / `side` / `combine` / `panel` / `overridable` / `init`，目标侧再给 `targetField`），
   并把该 id 加进 `CalcActionId` 联合。
2. 该作用能否作为引用来源？能 → 加进同一个文件的 `REF_ACTIONS`（展示名在 `display-meta.ts` 的 `refName`）。
3. `versions.ts`：在对应版本块的 `actions` 末尾追加。
4. `src/lib/calc/display-meta.ts`：`ACTION_META` 补一项（`label` / `unit` / `group`，按需 `internal` /
   `damageMatchable` / `refName`）。三张表都是 `Record<id 联合, …>`，少一项就是类型错误。
5. 界面与 AI 的清单不用手改：`calc/calculation.consts.ts` 的 `ZONE_DEFS` / `ZONE_SECTIONS` 由作用表 +
   `ACTION_META` 派生；`ai/generate/prompts.ts` 的乘区文本同源。**例外**是 AI 工具里手写的说明串
   （`ai/tools/calculation.ts` 的 `zoneId 可选：…`），需要手工补一项。

## 3. 新乘子（乘区数学）

1. `src/coconut-config/multipliers.ts`：`defineFormula({ id, inputs, uses? }, compute)`。
2. `src/coconut-config/formulas.ts`：在 `ORDER_x` 里排好位置（注册序 = 链序），必要时新增一条 `ORDER`。
3. `src/lib/calc/display-meta.ts`：`MULTIPLIER_META` 补 `label` 与 `display`。
4. `src/lib/calc/damage-trace.ts`：`SEGMENT_BUILDERS` 补一段——`Record<MultiplierId, …>`，漏了就是类型错误。
   它决定「这一段在结果页怎么展示、来源从哪来」；membership 与顺序由公式链决定，不需要改 `buildDamageSegments`。
5. 需要新的 `ResultEntry` 字段（如 `finalUnisonMulti`）时：`calc/result.types.ts` 加字段 →
   `calc/compute.ts` 赋值 → `calc/compute-facade.ts` 的非内核路径同步 → 用到它的界面组件。
6. 需要在结果页出现**独立列**：`result.types.ts` → `compute.ts` → `compute-facade.ts` 的列映射
   （那里的 `z('…')` 按作用 id 取数）→ 表格组件。
7. 只调数值、不改数学：直接改 `multipliers.ts` 里的系数，不需要新版本块。

## 4. 新公式

1. `src/coconut-config/formulas.ts`：`formula(id, base, chain, critBase)`；`id` 同时是界面上与表里的公式名。
2. `versions.ts`：该版本块的 `formulas` 列表加上它。**整表重建时不要把已有条目漏掉**（列表会整体替换）。
3. `display-meta.ts`：`FORMULA_META` 补一项（`label` / `canCrit` / `critFallback` / `reportsDamageTypes` /
   `ratioBoosts`），`FormulaKey` 联合同步。
4. 需要新的**基值配方**（既不是 `panelStat` / `zone` / `targetStat` / `fixed`）→ 这是内核算术，见 §7。
5. 公式要出现在表里可选 → 补 `ai/**` 的枚举与 `buff-engine.md` 的口径表。

## 5. 系数与效应表

- 偏谐系数（按敌人类型）：`src/lib/calc/compute.ts` 的 `TUNE_COEFF_MAP`。**写游戏原值，不要取整**
  （处决倍率动辄十几倍，先取整会把误差放大到个位数）；兜底用 `TUNE_COEFF_FALLBACK`。
- 效应层数倍率与基础值：`src/lib/consts/effect-data.ts` 的 `EFFECT_BASE_VALUE` / `EFFECT_TABLE`。

## 6. 词条 / 元素 / 伤害类型

| 内容                             | 文件                                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| 元素、伤害类型、技能类型、抗性键 | `src/lib/consts/game-terms.ts`                                    |
| 副词条 label 与档位              | `src/lib/consts/stat-data.ts`                                     |
| 词条 label → 面板落点            | `src/lib/calc/stat-writes.ts`（`ACTION_STATS` / `BASE_SUFFIXES`） |

## 7. 真要动内核时

`src/coconut-core/**` 的判据是「纯计算 + 零语料 + 零内置表」，改了内核必须同时做到：

1. `node scripts/check-calc-core.mjs` 通过：核心目录**每个**文件都作为入口做 import 闭包检查，
   新增文件也要干净（不得触达 `$app/*` / `$lib/*` / `$coconut-config`）。
2. `pnpm run build:core` / `pnpm run release:core`：内核包与 `.d.ts` 重新生成；
   内核自己的版本号在 `src/coconut-core/package.json`。
3. 上层只从 `$lib/calc/core-config.ts` 取用；`src/coconut-config` 只能用 `$coconut-core` 的公开入口与
   `$coconut-core/formulas` 的 `defineFormula`（单一出口闸门会拦）。

## 8. 测试与闸门（按报错顺序填）

| 命令                   | 拦住什么                                           |
| ---------------------- | -------------------------------------------------- |
| `pnpm run format`      | 格式（src / test / docs / scripts）                |
| `pnpm run lint:eslint` | 纯逻辑层的函数式规则、Svelte 的 `require-each-key` |
| `pnpm run check`       | `svelte-check` + 9 个静态闸门（见下）              |
| `pnpm test`            | 全部单测；改口径时先 `pnpm test calc` 缩小范围     |

`pnpm run check` 里与「新增计算特性」直接相关的闸门：

- `check-calc-core`：内核 import 闭包纯净、零语料、零内置表、单一出口。
- `check-no-hardcoded-ids`：app 层实体名字面量棘轮（基线只许降）。新乘区如果在 `compute.ts` /
  `damage-trace.ts` / `compute-facade.ts` 里写 id 字面量会顶破基线——能走注册表就走注册表。
- `check-components` / `check-surfaces` / `check-motion` / `check-scrollbar`：只在动界面时相关。
- `generate-components-doc --check` / `generate-tools-doc --check`：改了 `ui/` 组件或 AI 工具后要重新生成。

主要测试文件（改哪块就先跑哪块）：

| 文件                                                                               | 钉住什么                                      |
| ---------------------------------------------------------------------------------- | --------------------------------------------- |
| `test/src/coconut-core/kernel.test.ts`                                             | 内核契约：配置校验、trace、系数基类口径       |
| `test/src/lib/calc/compile.test.ts`                                                | 编译器压表 vs 引擎**逐条目数值对账**          |
| `test/src/lib/calc/compute-golden.test.ts`                                         | 数值基线快照（全部数值字段 + 乘区段 id 序列） |
| `test/src/lib/calc/{core-config,formula-registry,coeff-crit,resolve-memo}.test.ts` | 注册表 / 公式链 / 系数基类 / 解析与去重       |

口径变化后更新快照：

```sh
$env:UPDATE_GOLDEN=1; pnpm test compute-golden
# 先核对 .tmp/golden-snapshot.json 的 diff，再贴回测试里的 GOLDEN
```

新增特性至少覆盖三件事：一段真实倍率的数值、乘区明细里出现该段、溯源段出现该段与来源。

## 9. 文档同步

| 文件                   | 改什么                                                    |
| ---------------------- | --------------------------------------------------------- |
| `docs/coconut-core.md` | 顶部计数（作用 / 引用来源 / 乘子 / 公式条数）与版本链小节 |
| `docs/buff-engine.md`  | 乘区 / 公式口径与展示名                                   |
| `docs/tools.md`        | AI 工具清单变了跑 `pnpm run generate-tools-doc`（生成物） |
| `README.md`            | 「计算引擎」小节的功能清单（仅对外能力变化时）            |

## 10. 收尾核对（可直接贴进 PR 描述）

- [ ] 版本块开好了，只有最后一版进 `config`
- [ ] 新作用：`data.ts` + `CalcActionId` + `ACTION_META`（必要时 `REF_ACTIONS`）
- [ ] 新乘子：`multipliers.ts` + `ORDER_x` + `MULTIPLIER_META` + `SEGMENT_BUILDERS`
- [ ] 新公式：`formulas.ts` / `versions.ts` + `FORMULA_META` + `FormulaKey`
- [ ] 系数与效应表按游戏原值写入
- [ ] `pnpm test` 通过；口径变化时更新了 `GOLDEN` 并核对过 diff
- [ ] `pnpm run format` / `pnpm run lint:eslint` / `pnpm run check` 全绿
- [ ] 相关文档同步；对外发布的配置包已重新生成（`pnpm run release:config`）
- [ ] 工程数据兼容：没有删除或改名既有 id（要删改则在 `src/migration/` 写迁移）

## 11. 常见坑

- **链序 = 注册序**：把新乘子插进 `multipliers` 中间时，`ORDER_x` 与所有引用它的公式链要一起调到同一相对位置，
  否则 `init` 直接抛「multiplier order must follow registration order」。
- **`satisfies` 不接受额外字段**：版本块里加 `version: '3.8'` 之类的字段会编译失败（内核接口没有它）。
- **改已有乘子的数学不等于加一版**：公式链里存的是 handle 对象，改数学要在版本块里重建所有引用它的公式。
- **展示元数据是并集**：`ACTION_META` / `MULTIPLIER_META` / `FORMULA_META` 覆盖所有版本出现过的 id，不按版本切分。
- **缓存指纹**：结果页的跨轮缓存（`lib/components/page/home/result/compute-cache.utils.ts`）以「表格版本 + 链阶 +
  配置 + 队伍 + 角色/武器数据 + 声骸文案 + 条目内容」为键；新增任何影响数值的输入都必须并进
  `computeInputsSignatureOf`，否则页面会拿旧结果。
- **溯源与列映射不会自动成立**：config 里加了乘子，结果页的独立列与溯源分区仍各要一处登记（见 §3 第 5、6 条）。
