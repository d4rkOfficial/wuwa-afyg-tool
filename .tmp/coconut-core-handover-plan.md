# coconut-core 交接计划（计算正确性修复 + 注册层化 B 阶段）

> 交接对象：接手本分支的工程师
> 仓库：`E:\D4rK6\Projects\wuwa-afyg-tool`（椰果工具箱）
> 分支：待创建（建议 `refactor/coconut-core-config`）
> 本文件位于 `.tmp/`（**被 .gitignore 忽略**，不会随 commit 分发，请单独转交）

---

## 0. 一句话目标

1. **先修正确性**：应用侧现在走「编译 → 内核结算 → 物化」链路，用真实工坊工程（`nAHCyGRT`、`tUDATKuv`）对账时与旧引擎数值完全不符，必须先收敛到逐字段相等。
2. **再做 B 阶段**：把「注册层」与「核心层」彻底分离——`CoconutCore.init(CoconutCoreConfig)` 统一所有注册内容（作用表、词条表、倍率串协议、**乘子与公式**），内核零语料、零内置表。之后「更新引擎」= 只改注册配置。

---

## 1. 当前状态（已合并进 main 的重构）

内核 `src/coconut-core/` 只剩 9 个文件，全部无注释、无 `$lib` 依赖、无语料：

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 唯一出口：`CoconutCore` / `GeneralTable` / `BaseStats` / 结果类型 / `parseRatio` |
| `coconut-core.ts` | 类：`compute(table, bases, { trace })`（**无状态**） |
| `general-table.ts` | 输入结构：`Stat { key: 作用 id, value }`、`Damage { value, base?, element, formula, activated_buffs }`、`DamageEntry` |
| `compute.ts` | 表 → 每段结果（无条件；`activated_buffs` 一律生效） |
| `evaluate.ts` | 乘子链求值的唯一实现 `evaluateFormula` |
| `panel.ts` | 面板：`emptyPanel` / `applyZone` / `recomputeTotals` + 两侧面板类型 |
| `actions.ts` | 作用表（目前仍内置，含 label/group 等语料——B 阶段要移出） |
| `formulas.ts` | 12 个乘子 + 4 条公式（目前仍内置——B 阶段要移出） |
| `result.ts` | 结果类型：`CoreResult` / `DamageResult` / `BuffContribution` / `MultiplierZone` |

注册/编译层（工具箱侧）：

| 文件 | 职责 |
| --- | --- |
| `src/lib/calc/compile.ts` | `compileGeneralTable(request)`：工程状态 → `GeneralTable`（条件/规则/链阶/词条/转模/段数全在这里求值） |
| `src/lib/calc/compute-facade.ts` | `basesOfRequest` / `computeWithCore` / `computeAllViaCore` / `computeAllCore`（同位置参数，替换引擎 `computeAll` 用） |
| `src/lib/calc/stat-writes.ts` | 词条语料：`STAT_WRITES`（词条名 → 作用 id / 元素 / 类型）、`BASE_SUFFIXES`、`DEFAULT_PANEL_DIM`、`BONUS_DMG_ACTION` |
| `src/lib/calc/compute.ts` | 旧引擎（语义层）：条件、规则、面板构建、`ResultEntry` 物化、`TUNE_COEFF_MAP` |
| `src/lib/calc/panel-ops.ts` | `clonePanel` / `zoneOf` / `ZoneWrite`（从内核移出的工具箱操作） |

调用点已切到门面：

- `src/lib/components/page/home/result/result.svelte` → `computeAllCore as computeAllDamage`
- `src/lib/ai/tools/result.ts` → `computeAllCore as computeAll`

数值现状：`pnpm test` 1068 条全绿，但**只覆盖合成 fixture**（`test/src/lib/calc/compile.test.ts` 的 direct/fixed/tune/effect 四条 + `test/src/lib/calc/compute-golden.test.ts` 的 12 条目基线）。真实工程对不上，说明合成 fixture 漏了路径。

---

## 2. 复现：用真实工程对账

### 2.1 取工程

工坊工程 id：`nAHCyGRT`、`tUDATKuv`。两个来源二选一：

- 工坊服务端（share 仓库 `E:\D4rK6\Projects\wuwa-afyg-share`）：按 id 拉工程 JSON；
- 本机应用持久化：浏览器 IndexedDB / localStorage 里的工程快照（导出成 JSON 最省事）。

把两份 JSON 落到 `test/fixtures/workshop/<id>.json`（**测试夹具，不进产物**）。

### 2.2 把工程 JSON 变成 `ComputeRequest`

工程 JSON → `CalcState` / `ConfigState` / `TimelineData` / `BuffInstance[]` 的还原逻辑已经存在于 `src/lib/data/project-export-import.ts`、`src/lib/calc/calculation.store.svelte.ts`（`buildDamageEntriesFromTimeline`）与 `src/lib/migration/*`。**注意**：这些是 Svelte store 依赖，测试里不能直接用，需要抽一个**纯函数还原器**：

```
src/lib/calc/project-to-request.ts
    export const projectToComputeRequest = (project: ProjectSnapshot): ComputeRequest
```

它只做数据搬运（不碰 store、不碰 `$state`），测试与 AI 工具都能用。

### 2.3 对账测试

新增 `test/src/lib/calc/parity-workshop.test.ts`：

1. 读 `test/fixtures/workshop/*.json`；
2. 用 `projectToComputeRequest` 得到 `ComputeRequest`；
3. 同时跑：`computeAll(...)`（旧引擎，位置参数）与 `computeAllViaCore(request)`（门面）；
4. **逐条目逐字段**比对：`baseValue`、`nonCritPerHit`、`critPerHit`、`expectedPerHit`、`totalDamage`、`totalDamageRaw`、`multiplierZones`（id → value 全序列）；
5. 失败时输出差异表（条目 × 字段 × 引擎值 × 内核值），而不是一句断言失败：

```
[e1 共鸣解放] baseValue  引擎=37680 内核=24600  Δ=-13080
[e1 共鸣解放] bonus      引擎=1.400 内核=1.100  Δ=-0.300   ← 类型加成未折叠
[e4 谐度破坏] 段数        引擎=1     内核=0
```

> 建议：把差异表打印成 markdown 表格写入 `.tmp/parity-<id>.md`，方便逐轮对照。

---

## 3. 已定位的六个嫌疑（按可能性排序）

### 3.1 伤害类型推断缺失（最可能）

**现象**：全条目偏低，类型加成类 buff 完全失效。

**原因**：`compile.ts` 里

```ts
const damageTypes = request.damageTypes?.[entry.id] ?? []
```

只取**用户显式配置**的类型。真实工程多数条目不配，引擎侧靠 `resolveDamageTypes(entry, damageEntryDamageTypes, charInfoMap, echoDescByEntry)`（技能/声骸文案推断）。类型为本该参与的：类型加成词条折叠、乘区级条件（`zoneConditionMet` 的 `damageTypes`）、`buffRulesMet` 的伤害名规则。

**修法**：编译侧调用同一个 `resolveDamageTypes`，把结果用于

1. `zoneCtxOf(entry, profile, damageTypes)`；
2. `typeBonusBuffsOf`；
3. `entryActiveBuffs` 的 `damageTypes` 参数。

**验证**：差异表中「类型加成类 buff 缺失」的行消失。

### 3.2 Buff 级规则缺少依赖

**原因**：`entryActiveBuffs`（内核 `engine` 侧出口，位于 `src/lib/calc/compute.ts`）内部调用 `boundBuffs(...)` 时 `rulesDeps` 传的是 `undefined`；`computeAll` 里会构造完整 `ruleDeps = { charInfoMap, configState, team, ... }`（用于「面板比较」「敌人类型」这类规则）。

**修法**：把 `RuleEvalDeps` 一起作为参数传进 `entryActiveBuffs`，或在编译侧复用一个「与 `computeAll` 同源」的依赖构造器（建议抽 `buildRuleDeps(request)` 到 `compile.ts` 附近，供两边共用）。

### 3.3 效应条目拿不到 buff

**原因**：`compile.ts` 中

```ts
const active = charIndex >= 0 ? entryActiveBuffs({...}) : []
```

效应条目 `character` 为空 → `charIndex < 0` → `active = []`。引擎对效应条目是「无角色槽位，但仍按作用域聚合目标侧与特效专属 buff」。

**修法**：效应条目走 `ignoreScope` 口径（引擎 `activeBoundForChar(..., ignoreScope=true)` 的目标侧聚合语义），至少要把 `scope: 'all'` 与目标侧 buff 带上；把 `activeBoundForChar` 的 `ignoreScope` 暴露给编译侧。

### 3.4 声骸/武器词条边界

**原因**：`entryStatsOf`（在 `src/lib/calc/compute.ts`）与引擎 `accumulateEchoes` 需要逐行对齐：

- `secondMainStat == null` 时按 `SECOND_MAIN_STAT[cost]` 推导（cost 1/3/4 各自不同）；
- 武器副属性 `WEAPON_SUBSTAT_NAME_MAP` + `SUBSTAT_DECIMAL_TO_PCT` 归一化（`'攻击' + 0.3 → 攻击% 30`）；
- 同一槽位 `mainStat === null` 时不得写入。

**验证**：差异表中面板类（`atkPctSum` / `totalHp` / `critRate`）字段。

### 3.5 面板被就地修改（串味）

**原因**：门面把内核产出的 `first.panel` 交给 `computeFormulaEntry`，而它（`formulaCtxOf`）会**就地**把元素/类型加成写进 `panel.zones.bonusDmg`。同一 panel 若被多段/多条目复用 → 重复累加。

**修法（二选一）**：

- 短期：物化前 `clonePanel(first.panel)`；
- 正确：`computeFormulaEntry` 改成纯函数（加成作为入参，不写面板），或干脆按 3.7 让物化只搬字段。

### 3.6 链/精炼档位没传

**原因**：门面构造 `profile` 时用的是默认 `{ chains: [0,0,0], refinements: [1,1,1] }`；真实工程读的是 `team[i].chain` / `team[i].refinement`。

**修法**：`basesOfRequest`/`computeAllViaCore` 从 `request.team` 构造 `profile`（与 `buildDamageEntriesFromTimeline` 取同一份真源）。

### 3.7 结构性重复（修完 3.1–3.6 后必做）

门面现在是「内核算一遍 + 引擎再算一遍做物化」，两套口径必然漂移。修完对账后应改成：

- 数值字段（`baseValue` / `nonCritPerHit` / `critPerHit` / `expectedPerHit` / `totalDamage*` / `multiplierZones`）**直接取内核结果**；
- 引擎只保留展示派生（`ratioFactors`、`baseUnit`、`buffs` 溯源等）。

这一步做完，`src/lib/calc/compute.ts` 里的 `resolveBase` / `runChain` 可以整段删除（`src/lib/calc/compile.ts` 已有等价物）。

---

## 4. B 阶段：`CoconutCoreConfig`（注册层 / 核心层分离）

### 4.1 目标接口

```ts
// src/coconut-core/config.ts（新）
export interface CoconutCoreConfig {
    /** 作用表（含 label / group / unit / damageMatchable 等展示语料，由注册方给） */
    actions: readonly BuffActionDef[]
    /** 词条语料：词条名 → 作用 id / 元素加成 / 类型加成 */
    statWrites?: Readonly<Record<string, StatWrite>>
    /** 倍率串协议 */
    valueSuffixes?: readonly (readonly [string, PanelDim])[]
    defaultDim?: PanelDim
    /** 属性/类型加成折进哪个作用 */
    bonusAction?: string
    /** 只供界面展示、不参与公式的作用 */
    displayOnly?: readonly (readonly [string, string])[]
    /** 乘子（引擎数学，12 个） */
    multipliers: readonly MultiplierDef[]
    /** 公式（基值配方 + 有序乘子链 + 暴击口径，4 条） */
    formulas: Readonly<Record<FormulaId, FormulaDef>>
}

export class CoconutCore {
    init(config: CoconutCoreConfig): this      // 校验 + 建注册表；未 init 就 compute 直接抛错
    compute(table: GeneralTable, bases: BaseStats, options?: ComputeOptions): CoreResult
}
```

`MultiplierDef` / `FormulaDef` 的**结构保持不变**（`inputs` / `uses` / `display` / `compute` / `chain` / `base` / `critBase` / `canCrit`），只是从「模块常量」变成「注册项」：

```ts
export interface MultiplierDef {
    id: string
    label: string
    inputs: readonly string[]
    uses?: readonly MultiplierDef[]
    version: number
    compute: (resolved: Record<string, number | ((v: number | Record<string, number>) => number)>, ctx: FormulaCtx) => number
    display: (value: number, ctx: FormulaCtx) => MultiplierDisplay
}

export interface FormulaDef {
    id: FormulaId                                   // 'direct' | 'tune' | 'effect' | 'fixed'（或注册方自定义字符串）
    base: BaseRecipe                                // panelStat(auto|effectCoeff) | targetStat(coefficient) | fixed
    chain: readonly string[]                        // 乘子 id 有序链（必须是注册的 id）
    critBase: 'panel' | 'coefficient'
    canCrit: (panel: CharacterPanel, ctx: FormulaCtx) => boolean
    ratioBoosts?: readonly string[]
}
```

### 4.2 内核改造步骤

1. **`actions.ts` → 工厂**：`createActionRegistry(defs)` 返回 `{ list, map, panelWriters, dims, refSources, refMap, targetScalars, initOf }`；删掉模块级常量。`panel.ts` / `compute.ts` / `evaluate.ts` 全部改成**接收 registry 参数**（禁止模块级单例）。
2. **`formulas.ts` → 工厂**：`createFormulaRegistry({ multipliers, formulas })`；`readInput` 需要读注册来的 `const.*` 输入（如 `const.charLevel`），实现方式：`FormulaCtx` 增加 `consts: Record<string, number>`，由 `compute.ts` 从面板/注册表填入。
3. **`init` 校验**（错误必须在 init 就抛出，不要留到 compute）：
   - 乘子 id 唯一、公式链里的 id 都存在；
   - 每条公式链是 `MULTIPLIER_ORDER`（注册顺序）的子序列；
   - `actions` 里 `panel` 声明的维度都有唯一写入口；
   - `formulaActionClosure` 能覆盖所有 action（否则说明某作用既不被公式读、也不参与三维派生、也没登记 `displayOnly`）。
4. **内核零默认**：不提供内置表；`index.ts` 只导出 `CoconutCore` / `CoconutCoreConfig` / `GeneralTable` / `BaseStats` / 结果类型 / `parseRatio`。
5. **注册层实现**（工具箱）：`src/lib/calc/core-config.ts` → `buildCoconutCoreConfig(): CoconutCoreConfig`，把现有 `BUFF_ACTIONS`（**含 label/group/unit/damageMatchable**）、`STAT_WRITES`、`BASE_SUFFIXES`、`DEFAULT_PANEL_DIM`、`BONUS_DMG_ACTION`、`DISPLAY_ONLY_ACTIONS`、`MULTIPLIERS`、`FORMULAS` 全部搬过来。`src/coconut-core/actions.ts`、`formulas.ts` 退化为「类型 + 工厂」，语料清零。
6. **门面**：`new CoconutCore().init(buildCoconutCoreConfig()).compute(table, bases)`，在模块级建一个实例复用。
7. **文档与示例**：`docs/calc-core.md` 与 `examples/coconut-core.mjs` 一律改成「显式 init 一份最小注册表」——示例本身就是「外部自行注册」的证明。

### 4.3 闸门升级（`scripts/check-calc-core.mjs`）

新增两条硬断言：

1. **内核零语料**：`src/coconut-core/**` 不允许出现 CJK 标识符/字符串字面量（注释已全删，可直接按字符范围扫）；
2. **内核零内置表**：不允许出现 `id: 'xxx'` 这类表项形状（正则 `^\s*id:\s*'`），作用表/公式表只能来自 `init`。

现有两条闸门保留：目录内每个文件纯计算（无 `$lib` 依赖）、`check-no-hardcoded-ids` 192 处基线不再需要把 `src/coconut-core/*` 当注册域白名单（B 完成后应能把内核从 `REGISTRY` 名单里彻底移除）。

---

## 5. 施工顺序与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P1 | `projectToComputeRequest` 纯还原器 + `parity-workshop.test.ts`（差异表输出） | 能稳定复现两份工程的差异，输出可读差异表 |
| P2 | 修 3.1 → 3.6（每修一项跑一次 parity） | 两份工程逐条目逐字段 0 差异 |
| P3 | 3.7 结构收敛（物化只搬字段，删 `resolveBase`/`runChain`） | 0 差异保持；`compute-golden` 仍绿 |
| P4 | B 阶段 4.1–4.6（config + 工厂 + init + 注册层 + 门面 + 文档示例） | `pnpm test` 全绿；`examples` 用外部注册表跑通 |
| P5 | 闸门升级 + `release:core` 出包验证 | `pnpm run check` 全绿；空目录 `npm i ./coconut-core-<ver>.tgz` 后能跑示例 |

每阶段都必须跑：

```
pnpm run format
pnpm run lint:eslint      # 必须 0 error
pnpm run check            # svelte-check + 全部静态闸门
pnpm test                 # 1068+ 条
```

---

## 6. 风险与回滚

| 风险 | 处置 |
| --- | --- |
| 真实工程 JSON 里含引用/循环依赖 | 先只做「读取 + 对账」，不修数据；差异表里单列 |
| 修 3.1~3.6 后旧 golden 基线变化 | golden 是**行为基线**，若变化必须逐条解释（`test/src/lib/calc/compute-golden.test.ts` 头部写了更新流程：`UPDATE_GOLDEN=1` 生成 `.tmp/golden-snapshot.json`，核对 diff 后回填） |
| B 阶段把类型约束放松（运行期公式） | 保留 `init` 期校验（4.2 第 3 步），把「编译期保证」降级为「启动期保证」，并在 `docs/calc-core.md` 写明 |
| 应用侧回归 | 门面保持 `computeAllCore(...)` 同位置参数签名；P3 只改内部，调用点不动 |
| 回滚点 | P2 与 P4 各自单独 commit；B 阶段不要与 P2 混在一个 commit 里 |

---

## 7. 交接清单（接手人必读）

1. **不要**直接改 `src/coconut-core/` 里的 `actions.ts` / `formulas.ts` 来加新作用/新乘子——B 阶段之后这些必须走注册配置；
2. 任何数值改动都要先跑 `test/src/lib/calc/parity-workshop.test.ts`（P1 产出），再看 golden；
3. `eslint` 在这条链上曾出现「两个 `MultiplierZone` 定义不兼容」的问题（已通过复用内核类型解决），不要再在工具箱里新写一份类型；
4. `pnpm run build` 在仓库根**必然失败**（`.vercel` 的 ACL 限制），构建验收用 `.tmp/build-verify.ps1`；计算核出包用 `pnpm run release:core`；
5. 内核注释与语料是**故意的**：注释全删（代码即注释）、语料全在注册层。提交前请跑 `node scripts/check-calc-core.mjs`。

---

## 附录 A：当前调用形态（P1 之前的基线）

```ts
// app 侧（已切换）
import { computeAllCore as computeAll } from '$lib/calc/compute-facade'
const entries = computeAll(damageEntries, buffs, bindings, damageTypes, config, team, charInfo, weaponInfo, profile)

// 门面内部
const table = compileGeneralTable(request)
const result = new CoconutCore().compute(table, basesOfRequest(request))
const entry = computeFormulaEntry(engineEntry, result.damages[i].panel, result.damages[i].target, damageTypes)  // ← P3 要拆掉
```

## 附录 B：内核 4 条公式的现状（P4 之后应变成注册项）

| formula | base | chain（有序） | critBase |
| --- | --- | --- | --- |
| `direct` | `panelStat(auto)` | deepen → bonus → vuln → resist → defense → dmgRed → tuneStrain → unison → final → special → crit | panel |
| `tune` | `targetStat(coefficient)` | deepen → vuln → resist → defense → dmgRed → tuneStrain → tuneBreak → unison → final → special → crit | coefficient |
| `effect` | `panelStat(effectCoeff)` | 同 tune | coefficient |
| `fixed` | `fixed` | 空链 | panel |

口径：**处决 / 响应 / 效应只不吃增伤区**，其余乘区都吃；系数类双暴基准 0% / 100%（词条双暴不参与，buff 追加写入照常）。
