# CoconutCore —— 椰果工具箱的计算引擎

纯函数伤害计算引擎：**注册一份配置 → 喂一张表 + 基础数值 → 拿到每一段伤害的数值、乘区明细与逐 Buff 贡献**。

- 零运行时依赖、无框架依赖，Node 里 `import` 就能跑（单文件 ESM，约 15 KB）
- 引擎不认识任何游戏实体：角色/武器/敌人白值调用时传入，作用表、乘子、公式全部由你注册
- 因此同一份内核可以算**任何战斗二游**的面板、乘区与 Buff 贡献溯源，不限于《鸣潮》

| 位置                 | 链接                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------- |
| 源码                 | [`src/coconut-core/`](../src/coconut-core)                                              |
| 工具箱里的注册表范例 | [`src/lib/calc/core-config.ts`](../src/lib/calc/core-config.ts)                         |
| 版本与依赖清单       | [`src/coconut-core/package.json`](../src/coconut-core/package.json)                     |
| 发行包               | [GitHub Releases](https://github.com/d4rkOfficial/wuwa-afyg-tool/releases)（`core-v*`） |

## 安装

```sh
npm i https://github.com/d4rkOfficial/wuwa-afyg-tool/releases/download/core-v0.1.0/d4rkofficial-coconut-core-0.1.0.tgz
```

也可以直接拿 `index.js`（单文件 ESM）放进自己的项目，不需要构建。

## 快速开始

```ts
import { CoconutCore } from '@d4rkofficial/coconut-core'

const core = new CoconutCore().init({
    actions, // 作用表：id / 落点 / 聚合方式 / 展示语料，全是你的数据
    refSources, // 引用来源（白值、当前面板、目标侧标量）
    multipliers, // 乘子：注册顺序即合法链顺序
    formulas, // 公式：基值配方 + 有序乘子链 + 暴击口径
    critMultiplier: 'crit',
    critActions: ['critRate', 'critDmg']
})

const result = core.compute(table, bases) // 每段伤害一条结果
const traced = core.compute(table, bases, { trace: true }) // 附带逐 Buff 贡献
console.log(result.total.expected)
```

`init` 期就会校验配置（乘子 id 唯一、公式链里的乘子都已登记、链顺序与注册顺序一致），错误当场抛出；
没 `init` 就 `compute` 直接报错。

完整的注册表写法看工具箱里的 [`core-config.ts`](../src/lib/calc/core-config.ts)：它注册了
22 条作用、12 个乘子、4 条公式，可以直接当模板改。

## 配置项（`CoconutCoreConfig`）

| 字段             | 说明                                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actions`        | 作用表。每个作用声明 `side`（`character` / `target`）、`combine`（`sum` / `multiply`）、面板落点（`panel.flat/pct/total` 或 `targetField`）、初值 `init`（系数基准下用 `initCoeff`）、可选 `ref`（可供其它作用引用） |
| `refSources`     | 引用（转模）来源：`{ id, label, unit, side, get(panel, target) }`；白值、当前面板、目标侧标量都在这里                                                                                                                |
| `multipliers`    | 乘子定义：`{ id, label, inputs, uses?, version, compute, display }`。`inputs` 里写作用 id，`target.x` 读目标侧，`const.x` 读常量输入                                                                                 |
| `formulas`       | 公式：`{ id, base, chain, critBase, canCrit, ratioBoosts }`。`base` 是基值配方（`panelStat` / `targetStat` / `fixed`），`chain` 是有序乘子链                                                                         |
| `critMultiplier` | 暴击乘子的 id（「不暴击」链路会排除它）                                                                                                                                                                              |
| `critActions`    | 双暴作用的 id（系数基准下不参与面板与引用）                                                                                                                                                                          |

## 输入

`GeneralTable`：

| 字段             | 含义                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------ |
| `characters`     | 角色 id 列表（与 `weapons` / `main_stats` / `sub_stats` 下标对齐）                   |
| `weapons`        | 每个角色的武器 id                                                                    |
| `main_stats`     | 装备词条：`{ key, value }`，**`key` 直接是作用 id**（引擎不认识「攻击%」这类词条名） |
| `sub_stats`      | 同上，与 `main_stats` 同构，分成两组只为调用方方便                                   |
| `buffs`          | Buff 目录（可选，供引用与展示）                                                      |
| `damage_entries` | 伤害条目：`{ source, damages: Damage[] }`                                            |

`BaseStats`：`{ characters, weapons?, enemy }` —— 角色三维白值 / 武器白值 / 敌人的类型、等级、
防御、免伤、各属性抗性、系数。**全部调用时传入**，引擎没有内置表。

`Damage`：`{ value, base?, hits?, activated_buffs, element, formula }`

- `value`：倍率串。`'250%'` 是 2.5 倍，纯数字按倍数；`formula: 'fixed'` 时就是固定伤害值；
  效应类公式里是「层数倍率 × 段数」
- `base`：基值取面板哪一维（`atk` / `hp` / `def`，缺省 = 注册的第一个面板维度）
- `hits`：段数。倍率串描述单段，额外倍率按段数放大
- `activated_buffs`：**这一段生效的 Buff**（调用方已经判定完毕，引擎不做任何条件判断）
- `formula`：你注册的公式 id

`BuffEffect` 是 `{ applyTo, value, write? }`：`applyTo` 是作用 id；`value` 是字面值或引用
（`{ refStat, baseLine, sourceUnit, targetUnit, lowerLimit, Upperlimit }` 做转模）；
`write` 可选 `'add'`（默认）/ `'override'`（覆盖该乘区合计）。

## 输出

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
    formula: string
    baseValue: number
    nonCritRaw: number // 未取整的「不暴击」
    expectedRaw: number // 未取整的「期望」
    nonCrit: number
    crit: number // 不吃暴击的公式回填期望值
    expected: number
    canCrit: boolean
    multipliers: MultiplierZone[] // 乘区明细（id / label / 数值 / 展示形态）
    panel: CharacterPanel // 该段的面板落值与合计
    target: TargetPanel
    contributions: BuffContribution[]
}
```

**逐 Buff 贡献**（`trace: true`）：把该 Buff 从 `activated_buffs` 摘掉重算，期望伤害的差值就是它的贡献
（`{ buffId, applyTo, deltaExpected, share }`；免伤这类会给负贡献）。因为只依赖表本身，
外部项目算出来的贡献数字与工具箱完全一致。

## 计算口径

- **面板**：`zones`（作用落值）+ `base`（白值），合计 `total = base + flat + base × pct%`；
  顺序是「基础数值 → 装备词条 → 生效 Buff → 转模 → 覆盖 → 重算合计」
- **基值**：`fixed` = 固定值；`targetStat` = 目标侧标量 × 倍率；`panelStat` = 面板合计 × 倍率
  （`effectCoeff` 维度先取整）
- **乘子链**：只有一个实现，顺序 = 注册顺序；工具箱的注册顺序是
  `deepen → bonus → vuln → resist → defense → dmgRed → tuneStrain → tuneBreak → unison → final → special → crit`
- **系数基类**（处决 / 偏谐响应 / 效应）：双暴基准改成 0% / 100%，装备双暴不参与，Buff 追加写入照常

## 维护

```sh
pnpm run check:core    # 纯度闸门：纯计算 / 零语料 / 零内置表 / 单一出口
pnpm run release:core  # 出 dist/d4rkofficial-coconut-core-<version>.tgz（含 index.js 与全部 d.ts）
```

版本真源是 [`src/coconut-core/package.json`](../src/coconut-core/package.json)；
包内容与发布命令由 [`scripts/release-calc-core.mjs`](../scripts/release-calc-core.mjs) 打印。

## 许可

**CoconutCore 自愿放弃版权**：可随意使用、二次开发、发布，**无需标注出处**（Unlicense / 公有领域）。
工具箱本体（`src/` 其余部分）仍按 [MIT](../LICENSE) 分发。
