# CoconutCore —— 椰果工具箱的计算引擎

纯函数伤害计算引擎：注册一份配置，喂一张表，拿到每段伤害的数值、乘区明细与逐 Buff 贡献。

零运行时依赖、无框架依赖，单文件 ESM，Node 里 `import` 就能跑。引擎不认识任何游戏实体——作用表、
乘子、公式全部由调用方注册，所以它不止能算《鸣潮》。

- 源码：[`src/coconut-core/`](../src/coconut-core)
- 注册表范例：[`src/lib/calc/core-config.ts`](../src/lib/calc/core-config.ts)（35 条作用 / 19 个引用来源 /
  12 个乘子 / 4 条公式，可直接当模板改）

## 安装

```sh
npm i https://github.com/d4rkOfficial/wuwa-afyg-tool/releases/download/core-v0.1.0/d4rkofficial-coconut-core-0.1.0.tgz
```

也可以直接拿 `index.js`（单文件 ESM）放进项目，不需要构建。

## 现成配置（`@d4rkofficial/coconut-config`）

懒得自己写注册表，就用工具箱已经调好、与工具箱同口径的那一份（作用 / 引用来源 / 乘子 / 公式 / 面板维度 /
目标侧字段 / 常量）。它随工具箱发版更新，默认导出即配置对象：

```sh
npm i https://github.com/d4rkOfficial/wuwa-afyg-tool/releases/latest/download/d4rkofficial-coconut-config-0.0.1.tgz
```

```ts
import { CoconutCore } from '@d4rkofficial/coconut-core'
import config from '@d4rkofficial/coconut-config'

const core = new CoconutCore().init(config)
const result = core.compute(table)
```

## 快速开始

```ts
import { CoconutCore } from '@d4rkofficial/coconut-core'

const core = new CoconutCore().init({
    actions, // 作用表：id / 落点 / 聚合方式
    refSources, // 引用来源：转模要读的白值、面板、目标侧标量
    multipliers, // 乘子：注册顺序即合法链顺序
    formulas // 公式：基值配方 + 有序乘子链 + 暴击口径
})

const result = core.compute(table) // 每段伤害一条结果
const traced = core.compute(table, { trace: true }) // 附带逐 Buff 贡献
console.log(result.total)
```

`init` 当场校验配置（乘子 id 唯一、公式链里的乘子都已登记、链顺序与注册顺序一致），错误直接抛出；
没 `init` 就 `compute` 会报错。

## 配置（`CoconutCoreConfig`）

| 字段           | 说明                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `actions`      | 作用表：`side`（`character` / `target`）、`combine`（`sum` / `multiply`）、面板落点、初值、`targetField` |
| `refSources`   | 引用来源 `{ id, get(panel, target) }`：转模读的白值 / 面板 / 目标侧标量                                  |
| `multipliers`  | 乘子 `{ id, inputs, uses?, compute }`，数组顺序即合法链顺序                                              |
| `formulas`     | 公式数组：`{ id, base, chain, critBase }`（基值配方 + 有序乘子链 + 暴击口径）                            |
| `panel`        | 面板维度 / 白值取整 / 合计公式（`{ dims?, rounding?, aggregate? }`），省略则按作用声明推导               |
| `targetFields` | 目标侧字段及其形态：`scalar`（标量）/ `map`（按元素分组）/ `text`（字符串）                              |
| `constants`    | 公式里 `const.<id>` 的来源（`{ id, get(panel, target) }`）                                               |
| `ratioZone`    | 「倍率追加」作用的 id（省略 = 不追加）                                                                   |

内核只认 id 与形状：**展示名、单位、分组、展示形态都不进内核**，由调用方按 id 另存
（工具箱里是 [`src/lib/calc/display-meta.ts`](../src/lib/calc/display-meta.ts)）。

id 分三类：`ActionId` / `FormulaId` 是 `string | symbol`，表侧的 `BuffId` 恒为字符串（表可走 JSON，变体 id 靠字符串拼接）。

## 输入（`GeneralTable`）

表只有三个字段，没有隐藏的「基础数值」输入——白值、词条、敌人配置一律编译成 buff：

| 字段             | 含义                                                    |
| ---------------- | ------------------------------------------------------- |
| `global_buffs`   | 每条伤害都先应用的 Buff id（敌人配置、无条件全局 Buff） |
| `buffs`          | Buff 目录 `{ id, effects, role? }`，同一份落值只存一次  |
| `damage_entries` | 伤害条目 `{ source, damages }`                          |

`Damage` 是 `{ value, base?, hits?, activated_buffs, element, formula }`：

- `value`：倍率串，`'250%'` = 2.5 倍；`formula: 'fixed'` 时是固定伤害值
- `base`：基值取面板哪一维（维度名来自 `panel.dims` / 作用声明，缺省为注册的第一个维度）
- `hits`：段数，倍率串描述单段，额外倍率按段数放大
- `activated_buffs`：这一段生效的 Buff id，条件由调用方判定，引擎不做任何判断
- `formula`：你注册的公式 id

`BuffEffect` 是 `{ applyTo, value, write?, only?, element? }`：

- `write`：`'add'`（默认）/ `'override'`（覆盖该乘区合计）
- `only: 'panel'`：只在面板基准下生效，系数基准的条目跳过它（装备双暴即此）
- `value`：字面值，或引用 `{ refStat, baseLine, sourceUnit, targetUnit, lowerLimit, Upperlimit }` 做转模
- `role: 'stat'`：基础数值贡献（白值 / 词条 / 敌人配置），不参与贡献溯源

基值配方四种：`panelStat`（面板合计 / 可指定维度）、`zone`（某个作用的落值，可选取整）、
`targetStat`（注册的目标侧字段）、`fixed`（固定值）。

内核没有暴击模式开关：要「不暴击」就在表里给一条把 `critRate` 覆盖成 `0` 的 Buff（`write: 'override'`），
必暴则覆盖成 `100`。内核只按乘子链算一个期望值。

## 输出

```ts
interface CoreResult {
    damages: DamageResult[] // 每段一条
    total: number // 各段期望伤害之和
}

interface DamageResult {
    entryIndex: number
    damageIndex: number
    source: string
    element: string
    formula: string
    baseValue: number
    expectedRaw: number // 未取整的期望
    expected: number // 取整后的期望
    multipliers: MultiplierZone[] // 乘区明细（id / label / 数值 / 展示形态）
    panel: CharacterPanel
    target: TargetPanel
    contributions: BuffContribution[] // 仅 trace: true
}
```

「暴击 / 不暴击 / 必暴」这些列由调用方派生：把暴击乘子从乘区积里摘掉即得「不暴击」。

**逐 Buff 贡献**（`trace: true`）：把该 Buff 从 `activated_buffs` 摘掉重算，期望伤害的差值就是它的贡献
（`{ buffId, applyTo, deltaExpected, share }`，减伤这类会给负贡献；`role: 'stat'` 的目录项不计入）。

## 口径

- **面板**：`total = base + flat + base × pct%`，写入顺序是「白值 → 武器副属性 → 声骸主词条 →
  声骸副词条 → 生效 Buff → 转模 → 覆盖 → 重算合计」
- **基值**：`fixed` 固定值 / `targetStat` 目标侧标量 × 倍率 / `panelStat` 面板合计 × 倍率（`effectCoeff` 先取整）
- **暴击区**：`1 + 等效暴击率 × (暴伤 - 1)`；等效暴击率钳在 0–100（低于 0 按必不暴、高于 100 按必暴），
  但面板里的 `critRate` 原值不裁剪，「超过 100 转暴伤」这类引用读的就是原值
- **乘子链**：顺序即注册顺序；工具箱注册的是
  `deepen → bonus → vuln → resist → defense → dmgRed → tuneStrain → tuneBreak → unison → final → special → crit`
- **系数基类**（处决 / 偏谐响应 / 效应）：双暴基准改成 0% / 100%，装备双暴不参与，Buff 追加写入照常

## 许可

**CoconutCore 自愿放弃版权**：随意使用、二次开发、发布，无需标注出处（Unlicense / 公有领域）。
工具箱本体（`src/` 其余部分）仍按 [MIT](../LICENSE) 分发。
