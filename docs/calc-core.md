# 计算核（`src/coconut-core`）

纯伤害计算：**注册基础数据 → 喂一张 `GeneralTable` → 直接出结果**。

内核不认识「某个角色/武器叫什么」，也不知道某个 buff 什么时候生效 —— 前者靠注册，后者靠调用方
在表里写明。所有业务语义（buff 条件、共鸣链、声骸词条方案、伤害类型推断）都在工具箱侧求值，
内核拿到的永远是**已经确定的事实**。

目录只有 10 个文件：`index` / `coconut-core` / `general-table` / `compute` / `evaluate` /
`panel` / `actions` / `formulas` / `stats` / `result`。

## 1. 用法

```ts
import { CoconutCore, type GeneralTable } from '$coconut'

const core = new CoconutCore()
    .registerCharacterBaseStats((id) => ({ atk: 400, hp: 10000, def: 500, element: '属性名' }))
    .registerWeaponBaseStats((id) => ({ atk: 587 }))
    .registerEnemyCoefficients({ BOSS: 10027 })

const result = core.compute(table) // 每段伤害一条结果
const traced = core.compute(table, { trace: true }) // 再带每条 buff 的贡献
```

三个注册方法都同时接受「函数」与「id → 值表」两种形式。

## 2. 输入结构（`GeneralTable`）

| 字段             | 含义                                                              |
| ---------------- | ----------------------------------------------------------------- |
| `characters`     | 队伍角色 id（与 `weapons` / `main_stats` / `sub_stats` 下标对齐） |
| `weapons`        | 每个角色的武器 id                                                 |
| `main_stats`     | 每个角色 1–3 条等效主词条（`Stat { key, value }`，值一律字符串）  |
| `sub_stats`      | 每个角色 5 条副词条                                               |
| `buffs`          | Buff 目录（`Buff { id, effect: { applyTo, value } }`）            |
| `damage_entries` | 伤害条目：`{ source, damages: Damage[] }`                         |
| `enemy`          | `[类型, 等级, 防御, 各属性抗性]`，抗性顺序 = `ELEMENTS`           |

`Damage` = `{ value, activated_buffs, element, formula }`：

- `value`：倍率串，`'2.5'` / `'250%'` / `'2.5生命'` / `'250%生命'`；`formula: 'fixed'` 时是固定伤害值；
- `activated_buffs`：这一段生效的 buff（调用方已经判定完毕，内核不做二次判断）；
- `formula`：`direct` / `tune` / `effect` / `fixed`。

`BuffEffect.value` 可以是字面值，也可以是引用（转模）：

```ts
{ refStat: 'totalHp', baseLine: 0, sourceUnit: '', targetUnit: '', lowerLimit: 0, Upperlimit: 1000 }
```

## 3. 结果形状

```ts
interface CoreResult {
    damages: DamageResult[] // 每段一条
    total: { nonCrit: number; crit: number; expected: number }
}

interface DamageResult {
    entryIndex: number
    damageIndex: number
    source: string
    element: string
    formula: CalculationFormula
    baseValue: number
    nonCrit: number
    crit: number // 不吃暴击的公式回填期望值
    expected: number
    multipliers: MultiplierZone[]
    panel: CharacterPanel
    target: TargetPanel
    contributions: BuffContribution[]
}
```

**逐 buff 贡献**（`trace: true` 时）：把这条 buff 从 `activated_buffs` 摘掉重算，期望伤害的差值
即它的贡献（`{ buffId, applyTo, deltaExpected, share }`；免伤这类会给出负贡献）。溯源只依赖表
本身，所以外部项目拿到的贡献数字与工具箱一致。

## 4. 计算口径

- **面板**：角色白值 + 武器白值 → 词条（`stats.ts` 的落点表）→ 生效 buff 逐条写入 → 三维合计
  `total = base + flat + base × pct%`；
- **增伤**：元素加成按 `Damage.element` 取用；伤害**类型**加成没有对应字段，由调用方编译成
  `bonusDmg` buff（表里没有「伤害类型」）；
- **系数基类**（`tune` / `effect`）：双暴基准改成 0% / 100%，词条双暴不参与，buff 追加写入照常；
- **敌人**：防御 / 各属性抗性 / 免伤（`enemyDmgReduction` 目标侧作用）/ 偏谐系数按类型注册；
- **乘子链**：`evaluate.ts` 是唯一实现，顺序固定 `deepen → bonus → vuln → resist → defense →
dmgRed → tuneStrain → tuneBreak → unison → final → special → crit`。

## 5. 纯度规则（机器强制）

`node scripts/check-calc-core.mjs`：`src/coconut-core/**` 的**每个文件**都必须是纯计算依赖
（含没人 import 的新文件）。禁止 `$app/*`、`$lib/data/*`、`*.svelte.ts`、`$lib/components/*`、
`$lib/theme/*`、`$lib/substat`；外部别名只允许 `$lib/consts` / `$lib/utils` / `$lib/types` / `$lib/api`
这些纯常量与纯类型。

`node scripts/check-no-hardcoded-ids.mjs`：内核里不允许出现游戏实体名字面量（`'critRate'`、
`'BOSS'` …）。词条落点、乘子、作用、倍率串基准后缀都放在注册域（`actions` / `formulas` /
`stats`）里。

## 6. 构建

`node scripts/build-calc-lib.mjs` → `dist/calc-core/index.js`（单文件 ESM，零外部依赖）。
TS 消费方直接引用 `src/coconut-core/index.ts`（源码即类型）。

## 7. 不在计算核里的东西

| 能力                             | 归属                                           |
| -------------------------------- | ---------------------------------------------- |
| Buff 条件 / 规则 / 共鸣链 / 精炼 | 工具箱（编译期求值成「哪些 buff 生效」）       |
| 声骸 5 槽 / cost 派生 / 词条方案 | 工具箱（编译成 `main_stats` / `sub_stats`）    |
| 伤害类型推断（技能文案）         | 工具箱（编译成 `bonusDmg` / `Damage.element`） |
| 敌人配置的免伤与抗性字典         | 工具箱（免伤 → 目标侧 buff；抗性 → 表元组）    |
| 界面列、溯源树、贡献分析报告     | 工具箱（用内核结果派生）                       |
