# coconut-core API

纯函数伤害计算引擎。作用表、乘子、公式全部由调用方注册，内核不含任何游戏实体。

```ts
import { CoconutCore } from '@d4rkofficial/coconut-core'

const core = new CoconutCore().init(config)
const result = core.compute(table)
```

## `CoconutCore`

| 成员                                                 | 行为                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `init(config: CoconutCoreConfig): this`              | 建立作用表与公式表。乘子 id 重复、公式链引用了未登记的乘子、链顺序与注册顺序不一致都当场抛错 |
| `compute(table: GeneralTable, options?): CoreResult` | 逐条算伤害。未 `init` 调用会抛错                                                             |

`ComputeOptions`：`{ trace?: boolean }`。开启后每段伤害都会附带 `contributions`，代价是「每条伤害 ×
每个生效 Buff」各重算一次。

## 现成配置

不想自己写注册表，就装工具箱导出的那一份（`@d4rkofficial/coconut-config`：作用 / 引用来源 / 乘子 /
公式 / 面板维度 / 目标侧字段 / 常量，随工具箱发版更新），默认导出就是配置对象：

```sh
npm i https://github.com/d4rkOfficial/wuwa-afyg-tool/releases/latest/download/d4rkofficial-coconut-config-0.0.1.tgz
```

```ts
import { CoconutCore } from '@d4rkofficial/coconut-core'
import config from '@d4rkofficial/coconut-config'

const core = new CoconutCore().init(config)
```

## `CoconutCoreConfig`

| 字段            | 类型                        | 作用                                                 |
| --------------- | --------------------------- | ---------------------------------------------------- |
| `actions`       | `readonly BuffActionDef[]`  | 作用表：所有可被 Buff 写入的乘区与面板维度           |
| `refSources`    | `readonly RefSourceDef[]`   | 引用来源：转模与白值引用可读取的量                   |
| `multipliers`   | `readonly FormulaHandle[]`  | 乘子表，**数组顺序即合法链顺序**                     |
| `formulas`      | `readonly FormulaDef[]`     | 公式表：基值配方 + 有序乘子链 + 暴击口径             |
| `panel?`        | `PanelConfig`               | 面板维度、白值取整与合计公式（维度省略则按作用推导） |
| `targetFields?` | `readonly TargetFieldDef[]` | 目标侧字段及其存储形态（`scalar` / `map` / `text`）  |
| `constants?`    | `readonly ConstantDef[]`    | 公式里 `const.<id>` 的来源（内核不预设常量名）       |
| `ratioZone?`    | `ActionId`                  | 「倍率追加」作用的 id（可省略 = 不追加）             |

## id 类型

| 类型        | 定义               | 覆盖位置                                                                                    |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `ActionId`  | `string \| symbol` | `BuffActionDef.id` / `RefSourceDef.id` / `BuffEffect.applyTo` / `StatRef.refStat` / 乘子 id |
| `FormulaId` | `string \| symbol` | `FormulaDef.id` / `Damage.formula`                                                          |
| `BuffId`    | `string`           | `Buff.id` / `GeneralTable.global_buffs` / `Damage.activated_buffs`                          |

`inputs` 是取值选择器：作用 id（字符串或 symbol，直接读面板 `zones`）、`target.<字段或作用 id>`（读目标面板）、`const.<id>`（读注册的常量）。

## `BuffActionDef`

一个「作用」= Buff 的落点，同时也是面板的一个乘区。

| 字段           | 类型                             | 作用                                                                                                               |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`           | `ActionId`                       | 作用 id，即 `BuffEffect.applyTo` 与公式 `inputs` 里用的名字，也是 `panel.zones` 的键                               |
| `side`         | `'character' \| 'target'`        | 写入角色面板还是目标面板                                                                                           |
| `combine`      | `'sum' \| 'multiply'`            | 多次写入如何叠加：`sum` 相加，`multiply` 连乘（每项按 `1 + v/100`）                                                |
| `panel`        | `{ base?, flat?, pct?, total? }` | 该作用写入面板的哪一维：`base` 写白值，`flat` / `pct` 参与合计公式，`total` 直接覆盖合计                           |
| `overridable`  | `boolean`                        | 是否接受 `write: 'override'`；为 `false` 时覆盖请求退化为相加                                                      |
| `init`         | `number`                         | 面板初值                                                                                                           |
| `initCoeff`    | `number?`                        | 系数基准下的初值；缺省时用 `init`                                                                                  |
| `targetField?` | `ActionId`                       | 目标侧落点：指向注册的 `TargetFieldDef.field`，写到 `scalars` / `maps` / `text`；未登记的字段退回写 `target.zones` |

展示名、展示分组、单位、是否内部作用、是否允许条件匹配、引用展示名等**不属于内核**：这些字段由调用方按 id
另存（工具箱里是 `src/lib/calc/display-meta.ts`）。

## `RefSourceDef`

| 字段      | 类型                                                     | 作用                                               |
| --------- | -------------------------------------------------------- | -------------------------------------------------- |
| `id`      | `ActionId`                                               | 引用 id，即 `StatRef.refStat` 用的名字             |
| `get`     | `(panel: CharacterPanel, target: TargetPanel) => number` | 取值函数，按该段伤害当时的面板实时调用             |
| `writes?` | `PanelDim`                                               | 该引用描述的面板维度，用于推导「哪些作用会改写它」 |

## `FormulaHandle`（乘子）

`defineFormula(spec, compute)` 构造；`spec` 的 `inputs` 决定 `compute` 第一个参数里有哪些键。

| 字段      | 类型                                    | 作用                                                                 |
| --------- | --------------------------------------- | -------------------------------------------------------------------- |
| `id`      | `FormulaId`                             | 乘子 id，公式 `chain` 里引用                                         |
| `inputs`  | `readonly string[]`                     | 取值来源：`target.<字段>` / `const.<键>` / 其余按面板 `zones` 键读取 |
| `uses?`   | `readonly FormulaHandle[]`              | 把其它乘子当函数复用，注入为 `compute` 参数里的同名函数              |
| `compute` | `(resolved, ctx: FormulaCtx) => number` | 算乘子值                                                             |

乘子的展示名与展示形态同样不在内核里：调用方按 id 查自己的表（工具箱：`MULTIPLIER_META`）。

## `FormulaDef`（公式）

| 字段       | 类型                                 | 作用                                                                       |
| ---------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `id`       | `FormulaId`                          | 公式 id，即 `Damage.formula`                                               |
| `base`     | `BaseRecipe`                         | 基值怎么算，见下表                                                         |
| `chain`    | `readonly FormulaHandle[]`           | 有序乘子链，**必须按注册顺序排列**                                         |
| `critBase` | `'panel' \| 'coefficient' \| string` | 双暴取值基准；`coefficient` 下作用可用 `initCoeff` 与 `only: 'panel'` 分区 |

`BaseRecipe` 取值细节：

| kind                            | 基值                                                                      |
| ------------------------------- | ------------------------------------------------------------------------- |
| `{ kind: 'panelStat', dim? }`   | `panel.total[damage.base ?? dim ?? 第一个注册维度] × (倍率 + extraRatio)` |
| `{ kind: 'zone', id, round? }`  | `panel.zones[id] × (倍率 + extraRatio)`，`round` 时对结果取整             |
| `{ kind: 'targetStat', field }` | 目标侧字段值 × (倍率 + extraRatio)，倍率按纯数字解析                      |
| `{ kind: 'fixed' }`             | `Damage.value` 本身                                                       |

`extraRatio` = `panel.zones[ratioZone] / 100 × 段数`（未注册 `ratioZone` 时为 0）。

## `FormulaCtx`

| 字段          | 类型                               | 作用                                            |
| ------------- | ---------------------------------- | ----------------------------------------------- |
| `panel`       | `CharacterPanel`                   | 该段伤害的面板                                  |
| `target`      | `TargetPanel`                      | 该段伤害的目标面板                              |
| `element`     | `string`                           | 该段伤害的元素                                  |
| `damageTypes` | `string[]`                         | 已推导出的伤害类型                              |
| `consts`      | `Readonly<Record<string, number>>` | 公式内可读的常量，由注册的 `constants` 逐段算得 |

## `GeneralTable`

| 字段             | 类型                     | 作用                                   |
| ---------------- | ------------------------ | -------------------------------------- |
| `global_buffs`   | `readonly BuffId[]`      | 每条伤害都先应用的 Buff id，按顺序叠加 |
| `buffs`          | `readonly Buff[]`        | Buff 目录，落值只在这里存一次          |
| `damage_entries` | `readonly DamageEntry[]` | 伤害条目，按顺序逐条计算               |

## `Buff`

| 字段      | 类型                    | 作用                                             |
| --------- | ----------------------- | ------------------------------------------------ |
| `id`      | `BuffId`                | Buff id，`global_buffs` / `activated_buffs` 引用 |
| `effects` | `readonly BuffEffect[]` | 依次应用的落值                                   |
| `role?`   | `'stat'`                | 标记为基础数值贡献，不计入 `contributions`       |

## `BuffEffect`

| 字段       | 类型                  | 作用                                                           |
| ---------- | --------------------- | -------------------------------------------------------------- |
| `applyTo`  | `ActionId`            | 作用 id；未登记的作用被静默忽略                                |
| `value`    | `string \| StatRef`   | 字面数值，或转模引用（只支持 `write: 'add'`）                  |
| `write?`   | `'add' \| 'override'` | 默认 `add`；`override` 覆盖该乘区，受 `overridable` 约束       |
| `only?`    | `'panel'`             | 只在面板基准下生效，系数基准的公式跳过它                       |
| `element?` | `string`              | `map` 类目标侧字段的分组键，写入 `target.maps[field][element]` |

## `StatRef`

| 字段         | 类型       | 作用                                       |
| ------------ | ---------- | ------------------------------------------ |
| `refStat`    | `ActionId` | 引用来源 id                                |
| `baseLine`   | `number`   | 扣减的基线，常用于「超过某值的部分才转模」 |
| `sourceUnit` | `string`   | 来源单位，`'%'` 会先除以 100               |
| `targetUnit` | `string`   | 目标单位，`'%'` 会再乘 100                 |
| `lowerLimit` | `number`   | 转模结果下限                               |
| `Upperlimit` | `number`   | 转模结果上限（字段名大写 `U` 是历史拼写）  |

## `Damage` / `DamageEntry`

| 字段              | 类型                | 作用                                                           |
| ----------------- | ------------------- | -------------------------------------------------------------- |
| `value`           | `string`            | 倍率串，`'250%'` = 2.5；`fixed` 公式下是固定伤害值             |
| `base?`           | `string`            | 基值取面板哪一维（`atk` / `hp` / `def`），缺省为第一个面板维度 |
| `hits?`           | `number`            | 段数，缺省 1；倍率描述单段，`extraRatio` 按段数放大            |
| `activated_buffs` | `readonly BuffId[]` | 这一段生效的 Buff id，条件由调用方判定，内核不做判断           |
| `element`         | `string`            | 元素                                                           |
| `formula`         | `FormulaId`         | 公式 id                                                        |

`DamageEntry`：`{ source: string, damages: Damage[] }`，`source` 原样进结果。

## `CoreResult` / `DamageResult`

| 字段                      | 类型                 | 作用                             |
| ------------------------- | -------------------- | -------------------------------- |
| `total`                   | `number`             | 各段 `expected` 之和             |
| `damages`                 | `DamageResult[]`     | 每段伤害一条，顺序与表内条目一致 |
| `damages[].entryIndex`    | `number`             | 来源条目下标                     |
| `damages[].damageIndex`   | `number`             | 条目内下标                       |
| `damages[].source`        | `string`             | 条目 `source`                    |
| `damages[].element`       | `string`             | 元素                             |
| `damages[].formula`       | `FormulaId`          | 公式 id                          |
| `damages[].baseValue`     | `number`             | 基值                             |
| `damages[].expectedRaw`   | `number`             | 基值 × 乘子积，未取整            |
| `damages[].expected`      | `number`             | 取整后的期望伤害                 |
| `damages[].multipliers`   | `MultiplierZone[]`   | 乘区明细，顺序即乘子链顺序       |
| `damages[].panel`         | `CharacterPanel`     | 该段的面板                       |
| `damages[].target`        | `TargetPanel`        | 该段的目标面板                   |
| `damages[].contributions` | `BuffContribution[]` | 仅 `trace: true` 有值            |

## `MultiplierZone`

| 字段    | 类型       | 作用         |
| ------- | ---------- | ------------ |
| `id`    | `ActionId` | 乘子 id      |
| `value` | `number`   | 该乘子的数值 |

结果里**只有 id 与数值**：展示名与展示形态（`delta` / `factor` / `deltaWhenActive`）由调用方按 id 决定。

## `BuffContribution`

| 字段            | 类型         | 作用                             |
| --------------- | ------------ | -------------------------------- |
| `buffId`        | `string`     | 被摘掉的 Buff id                 |
| `applyTo`       | `ActionId[]` | 该 Buff 的全部作用 id            |
| `deltaExpected` | `number`     | 摘掉它后期望伤害的差值，可能为负 |
| `share`         | `number`     | `deltaExpected / expected`       |

## `CharacterPanel` / `TargetPanel`

| 类型             | 字段      | 作用                                                 |
| ---------------- | --------- | ---------------------------------------------------- |
| `CharacterPanel` | `zones`   | 各作用 id → 累计值（键可为 string 或 symbol）        |
|                  | `base`    | 各面板维度的白值（维度来自 `panel.dims` 或作用声明） |
|                  | `total`   | 各面板维度的合计                                     |
| `TargetPanel`    | `scalars` | `scalar` 类目标侧字段 → 数值                         |
|                  | `maps`    | `map` 类目标侧字段 → 分组键 → 数值                   |
|                  | `text`    | `text` 类目标侧字段 → 字符串                         |
|                  | `zones`   | 目标侧作用的累计值                                   |

面板由表内 Buff 逐段重算，顺序固定：字面值写入 → 白值取整（`panel.rounding`）→ 重算合计 → 转模引用（每项后重算）→
`override` 覆盖。合计怎么算由注册的 `panel.aggregate({ base, flat, pct })` 决定（工具箱注册的是
`base + round(flat + base × pct / 100)`）。

## 导出

值：`CoconutCore`。类型：`ActionId` `ActionRegistry` `ActionCombine` `ActionSide` `Buff`
`BuffActionDef` `BuffContribution` `BuffEffect` `BuffId` `BuffRole` `BuffScope` `BuffValue`
`BuffWrite` `CalculationFormula` `CharacterPanel` `ComputeOptions` `CoconutCoreConfig`
`ConstantDef` `CoreResult` `CritBase` `Damage` `DamageEntry` `DamageResult` `ElementEnum`
`FormulaCtx` `FormulaDef` `FormulaHandle` `FormulaId` `FormulaRegistry` `GeneralTable`
`MultiplierDef` `MultiplierZone` `PanelConfig` `PanelDim` `PanelRounding` `RefSourceDef` `Stat`
`StatRef` `TargetFieldDef` `TargetFieldKind` `TargetPanel`。
