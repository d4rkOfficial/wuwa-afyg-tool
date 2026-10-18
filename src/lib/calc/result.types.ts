export interface MultiplierZone {
    label: string
    value: number
    detail: string
}

export interface ResultEntry {
    id: string
    character: string
    hitName: string
    skillType: string
    displayName: string
    element: string
    ratioNum: number
    hits: number
    sourceTimelineBlockId: string

    // computed
    baseValue: number
    baseUnit: string
    totalMultiplier: number
    baseAtk: number
    totalAtk: number
    atkPctSum: number
    atkFlatSum: number
    baseHp: number
    totalHp: number
    hpPctSum: number
    hpFlatSum: number
    baseDef: number
    totalDef: number
    defPctSum: number
    defFlatSum: number
    totalTuneBreakBoost: number
    dmgBonus: number
    deepen: number
    critRate: number
    critDmg: number
    defMulti: number
    resMulti: number
    dmgRedMulti: number
    finalDmg: number
    finalTuneStrainMulti: number
    finalTuneBreakZone: number
    /** @desc 同奏区（delta，%）：同奏区乘子 = 1 + 3%×同奏增益层数，这里存 3%×层数 */
    finalUnisonMulti: number
    customMult: number
    extraRatio: number
    vulnerability: number

    // per hit and total
    rawPerHit: number
    expectedPerHit: number
    totalDamage: number
    totalDamageRaw: number

    // crit/non-crit columns
    nonCritPerHit: number
    critPerHit: number
    canCrit: boolean
    multiplierZones: MultiplierZone[]

    // resolved damage types (拉表配置优先，否则推断)；非直伤为空
    damageTypes: string[]

    // 溯源辅助（可选，低耦合）：增伤区的元素/类型拆分（%），仅直伤条目回填
    elBonus?: number
    typeBonus?: number

    /** @desc 复合倍率拆解（技能成分 + 额外倍率）：下拉可查每一因子的伤害 */
    ratioFactors?: RatioFactor[]
}

/**
 * @desc 倍率因子：一条伤害的「复合倍率」拆解成分（结果页下拉按因子看伤害）。
 *
 * 权重口径：`% ` 倍率条目为「倍率百分比 × 成分乘数 × 段数」（同一角色面板下各成分等比例放大，
 * 因此按权重分摊最终伤害是精确的）；固定值条目为固定值本身。同一条目内所有权重同一量纲，
 * 故 `weight / Σweight` 即该因子的伤害占比。
 */
export interface RatioFactor {
    /** 展示名（技能成分 N / 效应 N 层 / 额外倍率的来源 Buff 名） */
    label: string
    /** 参与分摊的权重（见上） */
    weight: number
    /**
     * 单段倍率：该因子自身的倍率，**不含成分乘数（*N）与条目段数**。
     * 例：倍率串里的 `47.22%*2` → 单段倍率 47.22%（乘数只体现在「×2」备注与权重里）。
     * 与 weight 同量纲（% 条目为百分数，固定值条目为固定值）。
     */
    segmentRatio: number
    /** 来源类别：技能成分 / 效应 / Buff（额外倍率） */
    kind: 'skill' | 'effect' | 'buff'
    /** 可选补充说明（如「×2」「+3 层」） */
    note?: string
}

/** @desc 单个 Buff 的**单个乘区**对该角色直伤的贡献（多乘区 Buff 才有细分，单乘区取总贡献） */
export interface BuffZoneContribution {
    zoneId: string
    label: string
    contributionNorm: number
    contributionRig: number
    contributionNoCrit: number
}

/** @desc 单条 Buff 对某角色直伤的贡献（口径：移除该 Buff 后该角色伤害的损失量） */
export interface BuffContribution {
    id: string
    name: string
    /** 该 Buff 绑定的伤害条目数（仅统计本角色条目） */
    entryCount: number
    /** 生效乘区（多乘区时逐乘区给出移除损失；顺序 = Buff.zones 顺序） */
    zones: BuffZoneContribution[]
    contributionNorm: number
    contributionRig: number
    contributionNoCrit: number
    contribPctNorm: number
    contribPctRig: number
    contribPctNoCrit: number
    /** 来源标注（角色 / 武器 / 声骸 / 套装 / 内置域），用于列表分组与图标 */
    origin?: { entity?: string; kind?: string }
    starred?: boolean
}

/** @desc 单角色 Buff 贡献分析：基线 + 全部 Buff 移除后的伤害 + 逐条 Buff 贡献 */
export interface CharBuffAnalysis {
    character: string
    totalDamageNorm: number
    totalDamageRig: number
    totalDamageNoCrit: number
    /** 移除该角色条目上**全部生效 Buff** 后的伤害 */
    noBuffDamageNorm: number
    noBuffDamageRig: number
    noBuffDamageNoCrit: number
    buffTotalNorm: number
    buffTotalRig: number
    buffTotalNoCrit: number
    buffTotalPctNorm: number
    buffTotalPctRig: number
    buffTotalPctNoCrit: number
    buffs: BuffContribution[]
}

export interface CharSummary {
    character: string
    totalDamage: number
    entryCount: number
}

export interface SubstatContribution {
    type: string
    value: number
    unit: string
    contributionNorm: number
    contributionRig: number
    contribPctNorm: number
    contribPctRig: number
    contributionNoCrit: number
    contribPctNoCrit: number
}

export interface EchoContribution {
    cost: number
    mainStat: string
    substats: SubstatContribution[]
    totalNorm: number
    totalRig: number
    totalPctNorm: number
    totalPctRig: number
    totalNoCrit: number
    totalPctNoCrit: number
}

/** @desc 单角色直伤贡献分析的完整结果：副词条（按算法）+ Buff（算法无关） */
export interface CharContributionAnalysis {
    character: string
    substat: CharSubstatAnalysis
    buff: CharBuffAnalysis
}

export interface CharSubstatAnalysis {
    character: string
    totalDamageNorm: number
    totalDamageRig: number
    totalDamageNoCrit: number
    substatTotalNorm: number
    substatTotalRig: number
    substatTotalPctNorm: number
    substatTotalPctRig: number
    substatTotalNoCrit: number
    substatTotalPctNoCrit: number
    echoes: EchoContribution[]
    aggregated: SubstatContribution[]
    /**
     * @desc **表级 14 词分**：把该角色换成「标准 14 词条」声骸方案（主词条 43311 满级、14 条副词条取中位档）
     * 后，用同一套分数公式（副词条贡献 / 角色总伤）算出的对照分。角色信息缺失时为 null。
     */
    standardSubstatPctNorm: number | null
    /** @desc 表级 14 词方案下的副词条总贡献（对照用原始值） */
    standardSubstatNorm: number
    /** @desc 表级 14 词方案下的角色总伤（对照用原始值） */
    standardTotalNorm: number
}
