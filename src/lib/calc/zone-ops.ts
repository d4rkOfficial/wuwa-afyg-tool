/**
 * @desc 一切皆 buff 引擎的「乘区算子唯一维护点」。
 *
 * 每个乘区（ZoneId）在这里只声明一次它的累加/覆盖语义，`compute.ts` 的贡献聚合、
 * 引用转模回写、覆盖回写三条路径全部复用本表，避免同一乘区在多处 switch 里重复维护而漂移。
 */

export interface CharacterComputed {
    baseAtk: number
    baseHp: number
    baseDef: number
    totalAtk: number
    totalHp: number
    totalDef: number
    totalTuneBreakBoost: number
    offTuneBuildupRate: number
    recharge: number
    atkPctSum: number
    atkFlatSum: number
    hpPctSum: number
    hpFlatSum: number
    defPctSum: number
    defFlatSum: number
    critRate: number
    critDmg: number
    // buff multipliers (as percentages, divide by 100 in formula)
    bonusDmg: number
    deepenDmg: number
    resPen: number
    defPen: number
    defDown: number
    resDown: number
    /**
     * @desc 集谐·干涉层数（`tuneStrainLayer`）**故意不在这里**：它挂在目标/怪物身上、全队一份，
     * 不是角色面板属性。引擎用 `compute.ts` 的 `targetSideZonesOf()` 直接从绑定的 Buff 聚合，
     * 不会按角色累加，因此也不存在「某某角色的集谐干涉层数」。
     */
    /** @desc 同奏增益层数（flat 层数）：同奏区 = 1 + 3% × 层数 */
    unisonBoonLayer: number
    finalDmg: number
    dmgTakenInc: number
    /** @desc 特殊终伤(1)：加算语义（%），与特殊终伤(2) 组合为统一特殊区 */
    specialFinal1: number
    /** @desc 特殊终伤(2)（连乘）：每个来源独立乘算 (1 + value/100)，最终与特殊终伤(1) 组合为统一特殊区 **/
    specialFinal2Mul: number
    dmgRedPen: number
    extraRatio: number
    elementBonus: Record<string, number>
    typeBonus: Record<string, number>
}

/** @desc 单条乘区写入的形态 */
export type ZoneWrite = 'add' | 'override'

/** @desc 乘区算子：add=追加累加（特殊区为连乘），override=直接覆盖当前合计值 */
export interface ZoneOp {
    /** @desc 追加/引用回写 */
    add: (acc: CharacterComputed, value: number) => void
    /** @desc 覆盖回写（override 标记的乘区专用） */
    override: (acc: CharacterComputed, value: number) => void
}

const addOp = (
    add: (acc: CharacterComputed, value: number) => void,
    override: (acc: CharacterComputed, value: number) => void
): ZoneOp => ({ add, override })

const addOnly = (add: (acc: CharacterComputed, value: number) => void): ZoneOp => ({
    add,
    override: add
})

export const ZONE_OPS: Record<string, ZoneOp> = {
    bonusDmg: addOp(
        (a, v) => (a.bonusDmg += v),
        (a, v) => (a.bonusDmg = v)
    ),
    deepenDmg: addOp(
        (a, v) => (a.deepenDmg += v),
        (a, v) => (a.deepenDmg = v)
    ),
    resPen: addOp(
        (a, v) => (a.resPen += v),
        (a, v) => (a.resPen = v)
    ),
    defPen: addOp(
        (a, v) => (a.defPen += v),
        (a, v) => (a.defPen = v)
    ),
    defDown: addOp(
        (a, v) => (a.defDown += v),
        (a, v) => (a.defDown = v)
    ),
    resDown: addOp(
        (a, v) => (a.resDown += v),
        (a, v) => (a.resDown = v)
    ),
    // 集谐·干涉层数（tuneStrainLayer）不在此表：它是**目标侧**乘区，由 targetSideZonesOf 聚合，
    // 不做角色累加（见 CharacterComputed 上的说明）。
    unisonBoonLayer: addOp(
        (a, v) => (a.unisonBoonLayer += v),
        (a, v) => (a.unisonBoonLayer = v)
    ),
    finalDmg: addOp(
        (a, v) => (a.finalDmg += v),
        (a, v) => (a.finalDmg = v)
    ),
    dmgTakenInc: addOp(
        (a, v) => (a.dmgTakenInc += v),
        (a, v) => (a.dmgTakenInc = v)
    ),
    specialFinal1: addOp(
        (a, v) => (a.specialFinal1 += v),
        (a, v) => (a.specialFinal1 = v)
    ),
    specialFinal2: addOp(
        (a, v) => (a.specialFinal2Mul *= 1 + v / 100),
        (a, v) => (a.specialFinal2Mul = 1 + v / 100)
    ),
    dmgRedPen: addOp(
        (a, v) => (a.dmgRedPen += v),
        (a, v) => (a.dmgRedPen = v)
    ),
    // extraRatio 恒为追加（覆盖语义无意义）
    extraRatio: addOnly((a, v) => (a.extraRatio += v)),
    // 面板类：覆盖写 totalX（详情面板展示用），百分比项恒为追加
    atkFlat: addOp(
        (a, v) => (a.atkFlatSum += v),
        (a, v) => (a.totalAtk = v)
    ),
    atkPct: addOnly((a, v) => (a.atkPctSum += v)),
    hpFlat: addOp(
        (a, v) => (a.hpFlatSum += v),
        (a, v) => (a.totalHp = v)
    ),
    hpPct: addOnly((a, v) => (a.hpPctSum += v)),
    defFlat: addOp(
        (a, v) => (a.defFlatSum += v),
        (a, v) => (a.totalDef = v)
    ),
    defPct: addOnly((a, v) => (a.defPctSum += v)),
    critRate: addOp(
        (a, v) => (a.critRate += v),
        (a, v) => (a.critRate = v)
    ),
    critDmg: addOp(
        (a, v) => (a.critDmg += v),
        (a, v) => (a.critDmg = v)
    ),
    recharge: addOp(
        (a, v) => (a.recharge += v),
        (a, v) => (a.recharge = v)
    ),
    tuneBreakBoost: addOp(
        (a, v) => (a.totalTuneBreakBoost += v),
        (a, v) => (a.totalTuneBreakBoost = v)
    ),
    offTuneBuildupRate: addOp(
        (a, v) => (a.offTuneBuildupRate += v),
        (a, v) => (a.offTuneBuildupRate = v)
    )
}

/** @desc 按乘区键写入贡献；未知乘区键静默忽略（迁移/导入容错） */
export const applyZone = (acc: CharacterComputed, zoneId: string, value: number, write: ZoneWrite = 'add'): void => {
    const op = ZONE_OPS[zoneId]
    if (!op) return
    op[write](acc, value)
}

/** @desc 由 flat/pct 合计重算三维面板（追加或覆盖乘区后调用，保证转模引用读到最新面板） */
export const recomputeTotals = (acc: CharacterComputed): void => {
    acc.totalAtk = acc.baseAtk + Math.round(acc.atkFlatSum + (acc.baseAtk * acc.atkPctSum) / 100)
    acc.totalHp = acc.baseHp + Math.round(acc.hpFlatSum + (acc.baseHp * acc.hpPctSum) / 100)
    acc.totalDef = acc.baseDef + Math.round(acc.defFlatSum + (acc.baseDef * acc.defPctSum) / 100)
}
