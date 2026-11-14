/**
 * @desc 复合倍率的一个成分（来源：时间线上该段技能的倍率串，如 `20%攻击*2+15%生命` 拆成两个成分）。
 * 结果页下拉靠它把「这一条伤害」拆成「每一因子的伤害」。
 */
export interface DamageRatioPart {
    /** 成分倍率数值（%）；固定值成分为 0 */
    ratioNum: number
    /** 每成分乘数（`*N`），无则省略 */
    mult?: number
    /** 固定值成分的数值（与 ratioNum 二选一） */
    flatValue?: number
    /** 成分的基础类型（攻击/生命/防御/固定） */
    baseType: string
}

/** @desc 拉表页的伤害条目：由排轴时间线中的伤害块/非直伤条目派生而来，是「给谁配 Buff」的最小粒度 */
export interface DamageEntry {
    id: string
    character?: string
    skillType?: string
    hitName: string
    displayName: string
    isEffect: boolean
    isTuneBreak: boolean
    isTuneResponse: boolean
    ratioValue: number
    ratioUnit: '%' | 'fixed'
    damageBaseType: string
    damageElement: string
    sourceTimelineBlockId: string
    burstLayers?: number
    hits: number
    /** @desc 该条目的倍率成分（复合倍率拆解；单成分条目也保留 1 项，缺省表示无法拆解） */
    ratioParts?: DamageRatioPart[]
}

/** @desc 乘区定义：id 对应计算引擎乘区键，label 为界面显示名，unit 表示数值单位（百分比/固定值） */
import type { ZoneId } from './calculation.consts'

export interface ZoneDef {
    id: string
    label: string
    unit: '%' | 'flat'
}

/** @desc 乘区引用：把某个角色属性（白值/面板等）按「超过阈值后的部分 ÷divisor×multiplier」折算进当前乘区（可带上下限 clamp、离散取整） */
export interface ZoneRef {
    characterIdx: number
    zoneId: string
    threshold: number
    /** @desc 线性转模百分比；离散转模（discrete）用 divisor/multiplier，此值仅作参考（可缺省，缺省按 0） */
    pct: number
    lower?: number
    upper?: number
    discrete?: boolean
    divisor?: number
    multiplier?: number
}

/** @desc Buff 乘区值：普通数值或引用（引用时 value 不使用，实际值由 ref 计算） */
export type BuffValue = number | ZoneRef

/** @desc 一个 Buff 块内多个乘区的集合（key 为 ZoneId） */
export type Buff = Partial<Record<ZoneId, BuffValue>>

export interface BuffZoneValue {
    zoneId: ZoneId
    value: number
    ref?: ZoneRef
    override?: boolean
    /**
     * @desc ── 乘区级生效条件（条件挂在具体乘区上）──
     * 可挂：伤害类型条件、伤害属性条件。
     * 链/阶/伤害名/敌人类型/角色面板/Buff 依赖等**Buff 级规则**不在这里，见 `BuffInstance.rules`。
     * 不满足时仅该乘区不计入，同一条目的其它乘区照常生效。
     */
    condition?: BuffCondition
}

// ── 乘区级生效条件（伤害属性 / 伤害类型）──

/**
 * @desc 乘区级生效条件：**只挂伤害属性 / 伤害类型**。
 *
 * 组合口径固定为：**类内「或」、类间「与」**——
 * 伤害类型多选内部为或、伤害属性多选内部为或，而类型条件与属性条件之间必须同时满足。
 *
 * Buff 级的条件（链/阶/伤害名/角色面板/敌人类型/Buff 依赖）统一由 `BuffInstance.rules` 承载；
 * 本类型只表达乘区级条件，不承载链/阶字段（`chain` / `refinement` / `chains` / `refinements` 一律不认）。
 */
export interface BuffCondition {
    /** @desc 伤害属性条件（多选，任一匹配即满足） */
    elements?: string[]
    /** @desc 伤害类型条件（多选，任一匹配即满足） */
    damageTypes?: string[]
}

// ── Buff 级规则（discriminated union，全部 AND）──

/** @desc 敌人类型档位（与工程敌人配置 `EnemyConfig.type` 逐字一致，避免再引入一层映射） */
export type EnemyTypeKind = 'BOSS' | '精英怪' | '小怪'

/** @desc 角色面板比较运算符 */
export type ZoneCompareOp = 'gt' | 'ge' | 'lt' | 'le' | 'eq'

/** @desc 可参与「面板数值」条件的属性（单位与面板显示一致：攻/生/防/谐度/同奏层数为整数，其余为百分比） */
export type ZoneCompareId =
    | 'atk'
    | 'hp'
    | 'def'
    | 'recharge'
    | 'offTuneBuildupRate'
    | 'tuneBreakBoost'
    | 'unisonBoonLayer'
    | 'critRate'
    | 'critDmg'

/**
 * @desc Buff 级规则（一条 Buff 可挂多条，**规则之间全部 AND**）。
 *
 * - `chain` / `refinement`：某角色共鸣链 ≥ min / 武器精炼 ≥ min（实例级 `condition.chains/refinements` 由迁移换算成这类规则）
 * - `damageNameRegex`：本次伤害条目的 `displayName` **正则包含匹配**（需要全等时自行加 `^…$`；
 *   v7 及更早的 `damageNameEquals` 由迁移 v8 换算成锚定正则）
 * - `zoneCompare`：某角色「无条件部分」面板数值比较（`charIdx = -1` 表示伤害条目的角色）
 * - `enemyType`：当前工程敌人类型命中 `types` 中任意一项（多选，`type` 单值写法在归一化里并入）
 * - `buffActive`：被引用的 Buff 在**本次伤害**是否生效（all=全部 / any=至少一个）
 *
 * **同类条件只允许一条**（`normalizeRules` 按 kind 去重，保留第一条）：同一 Buff 不需要两条
 * 「敌人类型」「伤害名」「面板数值」，需要多处取值时写进同一条规则的多选/多值字段。
 *
 * 规则只在 Buff 级生效；乘区级条件继续走 `BuffZoneValue.condition`。
 */
export type BuffRule =
    | { kind: 'chain'; charIdx: number; min: number }
    | { kind: 'refinement'; charIdx: number; min: number }
    | { kind: 'damageNameRegex'; pattern: string }
    | { kind: 'zoneCompare'; charIdx: number; zone: ZoneCompareId; op: ZoneCompareOp; value: number }
    | { kind: 'enemyType'; types: EnemyTypeKind[] }
    | { kind: 'buffActive'; mode: 'all' | 'any'; buffIds: string[] }

/** @desc Buff 实例来源：user=用户创建/迁移，builtin=引擎内置源（角色/武器/声骸/敌人/公式域） */
export type BuffSource = 'user' | 'builtin'

/**
 * @desc Buff 类实例（一切皆 buff 的统一载体）。
 *
 * 乘区语义（核心口径）：`zones` 是**贡献条目列表**，不是「乘区种类的集合」——
 * 同一个乘区可以出现多次，每次是一个独立贡献单元（各带数值 / 引用 / 覆盖 / **自己的生效条件**）。
 * 判定：`if (Buff 级规则全满足) { 同乘区各条目各自 add if 自身条件满足 }`，满足的全部相加；
 * 标了覆盖的条目在最后**替换**该乘区合计（覆盖优先于一切；同一 Buff 内每个乘区只允许一个覆盖条目，
 * 跨 Buff 出现多个覆盖时按 Buff 进入计算的顺序，后进入者最终生效）。
 * `scope` 决定作用范围：'all'=通用（三名角色 + 效应伤害都吃）/ 角色槽位数组
 * （`[0,1,2]` = 全队：只有三名角色，不含效应）/ 空数组=仅效应伤害。
 */
export interface BuffInstance {
    id: string
    /** @desc 全名：`文件夹A\文件夹B\buff短名`；根 Buff 直接是短名（反斜杠是层级分隔符） */
    name: string
    /** @desc 乘区贡献条目列表（同一乘区可多条，每条各自带生效条件） */
    zones: BuffZoneValue[]
    scope: 'all' | number[]
    global?: boolean
    /** @desc Buff 级规则（全部 AND；旧实例级 chain/refinement 条件已迁到这里） */
    rules?: BuffRule[]
    source?: BuffSource
    /** @desc 来源标注（角色 / 武器 / 声骸 / 套装 / 内置域），用于界面溯源与分组 */
    origin?: { entity?: string; kind?: string }
}

/** @desc Buff 文件夹树的节点：文件夹或 Buff 叶。
 * 文件夹最多两级；Buff 可以挂在根、一级文件夹或二级文件夹下。
 */
export type BuffTreeNode =
    | { kind: 'folder'; id: string; name: string; children: BuffTreeNode[] }
    | { kind: 'buff'; id: string; buffId: string }

/** @desc 显式 Buff 文件夹树：全局 / 非全局两个根（视图上就是两个受保护的根文件夹） */
export interface BuffTreeState {
    global: BuffTreeNode[]
    nonGlobal: BuffTreeNode[]
}

/** @desc 拉表页「某段伤害」的配置：伤害类型（条件判定写在 Buff 乘区上，不在此） */
export interface DamageEntryConfig {
    damageTypes?: string[]
}

/** @desc 拉表页计算状态的持久化快照（工程保存/导出用）：Buff 实例列表、条目↔Buff 绑定、条目配置 */
export interface CalcState {
    buffSets: BuffInstance[]
    damageEntryBuffSetIds: Record<string, string[]>
    damageEntryDamageTypes: Record<string, string[]>
    /** @desc 伤害条目显示名覆盖（只改界面/AI 看到的 displayName，不改底层命中 id 与绑定关系） */
    damageEntryDisplayNames?: Record<string, string>
    /** @desc 显式 Buff 文件夹树（全局 / 非全局两个根；随工程导入导出） */
    buffTree?: BuffTreeState
    /** @desc 树迁移版本（旧无版本/0 的树会重跑一次数字前后缀迁移） */
    buffTreeVersion?: number
}

/** @desc 工程 Buff 配置：使用统一 Buff 实例结构，与主页 Buff 集区分命名 */
export type BuffConf = BuffInstance
