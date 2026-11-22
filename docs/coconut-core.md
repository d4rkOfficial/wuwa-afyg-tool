# CoconutCore —— 椰果工具箱的计算引擎

纯函数伤害计算引擎：注册一份配置，喂一张表，拿到每段伤害的数值、乘区明细与逐 Buff 贡献。

## 入口

| 入口     | 路径                                           |
| -------- | ---------------------------------------------- |
| 引擎内核 | [`src/coconut-core/`](../src/coconut-core)     |
| 鸣潮配置 | [`src/coconut-config/`](../src/coconut-config) |

## 功能介绍

[README.md](../src/coconut-core/README.md) 中有 CoconutCore 的功能模块详细介绍。

## 许可

CoconutCore 自愿放弃版权（[Unlicense](../src/coconut-core/LICENSE)，公有领域）：随意使用、二次开发、发布，无需标注出处。工具箱本体（其余 `src/`）按 [MIT](../LICENSE) 分发。

## 《鸣潮》伤害计算演化及 CoconutCore 配置版本链

当前计算核心对应的游戏版本：**3.7**

### 公式简介

| 公式                    | 基值 × 乘区                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| 直伤 `direct`           | 攻 / 生 / 防面板值 × 加深 × 增伤 × 易伤 × 抗性 × 防御 × 集谐 × 同奏 × 最终 × 特殊 × 暴击 |
| 效应结算 `effect`       | 90级效应系数 × 加深 × 易伤 × 抗性 × 防御 × 集谐 × 谐度 × 同奏 × 最终 × 特殊 × 暴击       |
| 处决 / 震谐·骇破 `tune` | 敌人偏谐系数 × 加深 × 易伤 × 抗性 × 防御 × 集谐 × 谐度 × 同奏 × 最终 × 特殊 × 暴击       |
| 固定值 `fixed`          | 条目自带固定伤害值                                                                       |

### 1.0：直伤基础公式

单段伤害 = 面板值 × 倍率 × 各乘区连乘。1.0 乘子序与计算规则：

| 顺序 | 乘区           | 计算规则                                                                                                               |
| ---- | -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1    | 加深 `deepen`  | `1 + 加深% / 100`                                                                                                      |
| 2    | 增伤 `bonus`   | `1 + 增伤% / 100`                                                                                                      |
| 3    | 易伤 `vuln`    | `max(0, 1 + (易伤 - 穿免 - 敌免伤) / 100)`                                                                             |
| 4    | 抗性 `resist`  | 分段函数，见「抗性区详解」                                                                                             |
| 5    | 防御 `defense` | 见「防御区详解」                                                                                                       |
| 6    | 最终 `final`   | `1 + 最终% / 100`                                                                                                      |
| 7    | 特殊 `special` | `(special1 ≠ 0 ? 1 + special1/100 : 1) × special2`；独立乘区，一般描述类最终伤害提升，如倍率的提升、倍率提升的效果提升 |
| 8    | 暴击 `crit`    | `1 + 等效暴击率 × (暴伤 - 1)`                                                                                          |

面板 / 白值 / 面板值，以及 `config` 的建模方式：

| 概念   | 含义                                                                                               | 配置建模                                               |
| ------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 白值   | 角色基础属性 + 武器攻击                                                                            | 作用 `atkBase` / `hpBase` / `defBase` → `panel.base.*` |
| 面板值 | 面板上显示的最终属性                                                                               | `panel.total.*`，由 `aggregate` 算出                   |
| 固定值 | 固定值也叫平值，一般来自声骸词条，偶尔来自角色拐力（如洛可可大招）；算完白值及其百分比加成后再加算 | 作用 `atkFlat` / `hpFlat` / `defFlat` → `panel.flat.*` |
| 百分比 | 攻击 / 生命 / 防御百分比                                                                           | 作用 `atkPct` / `hpPct` / `defPct` → `panel.pct.*`     |

面板公式（`PANEL_CONFIG`）：

```ts
export const PANEL_CONFIG = {
    dims: ['atk', 'hp', 'def'],
    rounding: 'round',
    aggregate: ({ base, flat, pct }) => base + Math.round(flat + (base * pct) / 100)
} as const
```

作用表按维度三件套登记（`data.ts`）：

```ts
{ id: 'atkBase', panel: { base: 'atk' } }              // 白值
{ id: 'atkFlat', panel: { flat: 'atk', total: 'atk' } } // 固定值
{ id: 'atkPct',  panel: { pct: 'atk' } }                // 百分比
```

#### 防御区详解

有效防御先结算减防与穿防，再与角色等级项比较；乘区封底 0.01。90 级时等级项为 1520。

```ts
// src/coconut-config/multipliers.ts
const computeDefMulti = (defense, defPen, defDown, charLevel) => {
    const defEff = Math.max(defense * (1 - defDown / 100) * (1 - defPen / 100), 0)
    const charTerm = 800 + 8 * charLevel
    return Math.max(charTerm / (defEff + charTerm), 0.01)
}
```

#### 抗性区详解

有效抗性 = 基础抗性 − 抗穿 − 减抗，按负值 / 0～0.8 / 大于 0.8 三段计算。

```ts
// src/coconut-config/multipliers.ts
const computeResMulti = (baseResist, resPen, resDown) => {
    const effResist = baseResist - resPen / 100 - resDown / 100
    if (effResist < 0) return 1 + Math.abs(effResist) / 2
    if (effResist < 0.8) return 1 - effResist
    return 1 / ((effResist + 0.2) * 5)
}
```

#### 暴击区详解

暴击乘子用**等效暴击率**计算期望：低于 0 视为必不暴，高于 100 视为必暴。

```ts
// src/coconut-config/multipliers.ts
export const effectiveCritRate = (critRate) => Math.min(Math.max(critRate, 0), 100)

({ critRate, critDmg }) => 1 + (effectiveCritRate(critRate) / 100) * (critDmg / 100 - 1)
```

裁剪只在暴击乘子内部，面板 `critRate` 保留原值，引用转模读原值。

| 场景                               | 原始 `critRate` | 等效值 | 说明                                             |
| ---------------------------------- | --------------- | ------ | ------------------------------------------------ |
| 奥古斯塔共鸣链：溢出暴击转爆伤     | >100%           | 100%   | 转化读原始暴击率；计算贡献前就框死会丢掉溢出部分 |
| 负暴击率（参考《原神》珊瑚宫心海） | <0              | 0%     | 暴击率不为负，按必不暴处理                       |

直伤 `critBase: 'panel'`：`critRate` 初值 5、`critDmg` 初值 150，暴击乘子起始 `1 + 5% × (150% − 1) = 1.025`。

### 2.0：效应公式

效应伤害以「效应系数」为基值，走系数基类公式。

| 项       | 内容                                                            |
| -------- | --------------------------------------------------------------- |
| 新增作用 | `effectCoeff`（效应系数，角色侧）                               |
| 基值     | 效应系数，先取整（`ZONE_EFFECT`）                               |
| 乘区     | 1.0 乘子序，去掉增伤区（`coeffChain`）                          |
| 暴击     | 双暴基准 0% / 100%，装备双暴不参与（`critBase: 'coefficient'`） |

#### 效应结算的数据建模

CoconutCore 把战斗抽象成「角色打敌人」：面板、装备、词条都挂在一名源角色上。效应结算没有源角色（无武器、无声骸），工具箱把它建模成一名**虚角色**——沿用同一套「角色打敌人」流程，只是这名角色的面板只带一个属性：效应系数。

| 项         | 直伤条目           | 效应条目                      |
| ---------- | ------------------ | ----------------------------- |
| `source`   | 源角色名           | `效应·` + 技能名（虚角色 id） |
| 面板       | 角色 / 武器 / 声骸 | 只有效应系数 `effectCoeff`    |
| 系数基准值 | —                  | 90 级效应系数 = 3674          |
| 基值       | 面板攻 / 生 / 防   | `zone: effectCoeff`（取整）   |
| 乘区       | 含增伤区           | 去掉增伤区（`coeffChain`）    |

```ts
// src/lib/calc/compile.ts —— 效应条目改挂虚角色 id
const VIRTUAL_EFFECT_PREFIX = '效应·'
const source = isEffect ? `${VIRTUAL_EFFECT_PREFIX}${entry.hitName}` : (entry.character ?? '')
// 效应系数最后写入面板落值（效应条目无装备）
registerBuff(`effect:${entry.hitName}`, [{ applyTo: 'effectCoeff', value: String(EFFECT_BASE_VALUE) }])

// src/lib/consts/effect-data.ts
export const EFFECT_BASE_VALUE = 3674 // 90 级
```

效应伤害本身不可暴击，暴击期望初始为 1。部分角色共鸣链让效应结算也能暴击，配置侧保留暴击区承载这类机制。按解包，爱弥斯 6 链本质是 80% 概率触发的 270% 特殊终伤，同类角色机制同理；为方便拉表分析，仍划入暴击区。

```ts
// src/coconut-core/panel.ts —— 系数基准下双暴取 initCoeff
zones[action.id] = critBase === 'coefficient' && action.initCoeff !== undefined ? action.initCoeff : action.init

// src/coconut-config/data.ts
{ id: 'critRate', init: 5, initCoeff: 0 }     // 系数基准下暴击率归零
{ id: 'critDmg', init: 150, initCoeff: 100 }  // 系数基准下暴伤归零（倍率 = 1）
```

```ts
// src/coconut-config/versions.ts
export const v2_0 = {
    ...v1_0,
    actions: [...ACTIONS_1_0, EFFECT_COEFF],
    formulas: [...v1_0.formulas, formula('effect', ZONE_EFFECT, coeffChain(ORDER_2_0), 'coefficient')]
} satisfies CoconutCoreConfig
```

### 3.0：谐度公式及集谐乘区

处决 / 偏谐响应以目标侧「偏谐系数」为基值；新增集谐区与谐度区。

| 新增项                         | 归属       | 说明                     |
| ------------------------------ | ---------- | ------------------------ |
| `tuneBreakBoost` 谐度破坏增幅  | 角色侧作用 | 谐度区与集谐区的输入     |
| `enemyCoeff` 偏谐系数          | 目标侧标量 | `tune` 公式的基值        |
| `tuneStrainLayer` 集谐干涉层数 | 目标侧作用 | 集谐区输入，全队共用一份 |
| `tuneStrain` 集谐区            | 乘区       | 紧随防御区               |
| `tuneBreak` 谐度区             | 乘区       | 在集谐区之后             |

集谐区：谐度破坏增幅 × 集谐干涉层数，紧随防御区。

```ts
// src/coconut-config/multipliers.ts
;({ tuneBreakBoost, layer }) => 1 + 0.0012 * tuneBreakBoost * layer
```

谐度区：谐度破坏增幅，排在集谐区之后。

```ts
// src/coconut-config/multipliers.ts
;(r) => 1 + r.tuneBreakBoost / 100
```

新公式 `tune`，基值取目标侧偏谐系数：

```ts
// src/coconut-config/versions.ts
formula('tune', TARGET_COEFF, coeffChain(ORDER_3_0), 'coefficient')
// TARGET_COEFF = { kind: 'targetStat', field: 'coefficient' }
```

直伤链不含谐度区，谐度区用于处决 / 震谐或骇破响应：

```ts
export const directChain = (order) => chainOf(order, 'tuneBreak')
```

### 3.7：同奏区

| 项       | 内容                                      |
| -------- | ----------------------------------------- |
| 新增作用 | `unisonBoonLayer`（同奏增益层数，角色侧） |
| 新增乘区 | `unison`，排在谐度区之后                  |

```ts
// src/coconut-config/multipliers.ts
;({ unisonBoonLayer }) => 1 + 0.03 * unisonBoonLayer

// src/coconut-config/versions.ts
export const config = v3_7
```
