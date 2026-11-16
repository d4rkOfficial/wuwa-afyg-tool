/**
 * @desc 计算门面：**工具箱只做「编译 + 结果物化」，数值全部由内核给**。
 *
 * 流程：工程状态 → `GeneralTable`（编译）+ 基础数值（角色/武器/敌人，调用时传入）
 * → `CoconutCore.compute`（内核算面板与数值）→ 用内核产出的面板/乘区物化 `ResultEntry`。
 *
 * 为什么物化还留在工具箱：`ResultEntry` 是界面契约（倍率拆解、溯源辅助、兼容列），
 * 属于 app 的展示需求，不进内核。物化**只搬字段**，不再自己算一遍数值。
 */
import type { BaseStats, CharacterBaseStats, DamageResult } from '$coconut'
import type { ComputeRequest } from '$lib/calc/request.types'
import type { DamageEntry } from '$lib/calc/calculation.types'
import type { ResultEntry } from '$lib/calc/result.types'
import { VIRTUAL_EFFECT_PREFIX, compileProject, type CompiledEntryMeta } from '$lib/calc/compile'
import { FORMULAS, createCoconutCore, formulaOf } from '$lib/calc/core-config'
import {
    TUNE_COEFF_MAP,
    effectRatioFactors,
    makeStubEntry,
    resolveBase,
    skillRatioFactors,
    withExtraRatioFactor
} from '$lib/calc/compute'
import { NON_DIRECT_ELEMENT } from '$lib/consts/game-terms'
import { EFFECT_BASE_VALUE } from '$lib/consts/effect-data'

/** @desc 工程状态 → 内核要的基础数值（角色 / 武器 / 敌人全部在这里给） */
export const basesOfRequest = (request: ComputeRequest): BaseStats => {
    const characters: Record<string, CharacterBaseStats> = {}
    for (const [name, info] of Object.entries(request.charInfo)) {
        characters[name] = { ...info.lv90BaseStats, element: info.element }
    }
    for (const entry of request.entries) {
        if (entry.formula !== 'effect' || !entry.hitName) continue
        // 效应虚角色：只有「效应系数」这一维度（= 效应基础值），不参与三维面板
        characters[`${VIRTUAL_EFFECT_PREFIX}${entry.hitName}`] = {
            atk: 0,
            hp: 0,
            def: 0,
            element: (NON_DIRECT_ELEMENT as Record<string, string>)[entry.hitName] ?? '',
            coefficient: EFFECT_BASE_VALUE
        }
    }
    const weapons: Record<string, { atk: number }> = {}
    for (const [name, info] of Object.entries(request.weaponInfo)) weapons[name] = { atk: info.lv90BaseAtk }

    const enemy = request.config.enemy
    return {
        characters,
        weapons,
        enemy: {
            type: enemy.type,
            level: enemy.level,
            defense: enemy.defense,
            dmgReduction: enemy.dmgReduction,
            resistances: enemy.resistances,
            coefficient: TUNE_COEFF_MAP[enemy.type] ?? 716.2
        }
    }
}

/** @desc 乘子数组 → `id → 数值`（物化时按乘子名取值） */
const multiplierValuesOf = (damage: DamageResult): Map<string, number> =>
    new Map(damage.multipliers.map((zone) => [zone.id, zone.value] as const))

/** @desc 乘积（内核已给 `expectedRaw`，这里只为展示列 `totalMultiplier` 复算一份乘区积） */
const productOf = (damage: DamageResult): number =>
    damage.multipliers.reduce((product, zone) => product * zone.value, 1)

/**
 * @desc 单条目物化：数值字段全部取内核结果，引擎只提供公式定义（`base` 配方）与倍率因子展示。
 *
 * `resolveBase` 只用来取展示量纲（`ratioNum` / `baseUnit` / `baseAtk`）与倍率因子拆分，
 * 它的 `baseValue` 不再参与伤害（伤害用内核的 `baseValue`）。
 */
const materialize = (entry: DamageEntry, damage: DamageResult, meta: CompiledEntryMeta): ResultEntry => {
    const def = FORMULAS[formulaOf(entry)]
    const hits = entry.hits || 1
    const panel = {
        base: { ...damage.panel.base },
        total: { ...damage.panel.total },
        zones: { ...damage.panel.zones },
        elementBonus: { ...damage.panel.elementBonus },
        typeBonus: { ...damage.panel.typeBonus }
    }
    const z = (id: string): number => panel.zones[id] ?? 0
    const values = multiplierValuesOf(damage)
    const base = resolveBase(def, entry, panel, {
        panel: damage.panel,
        target: damage.target,
        element: damage.element,
        damageTypes: meta.damageTypes,
        consts: { charLevel: damage.panel.zones.charLevel ?? 90 }
    })

    // ── 固定值条目：内核的乘子链为空，数值就是固定值本身 ──
    if (def.base.kind === 'fixed') {
        const stub = makeStubEntry(entry)
        stub.ratioNum = 1
        stub.baseValue = Math.round(damage.baseValue)
        stub.baseUnit = '固定'
        stub.expectedPerHit = Math.round(damage.expectedRaw)
        stub.rawPerHit = Math.round(damage.expectedRaw)
        stub.totalDamage = Math.round(damage.expectedRaw)
        stub.totalMultiplier = 1
        stub.damageTypes = meta.damageTypes
        stub.ratioFactors = skillRatioFactors(entry)
        return stub
    }

    const fromPanel = def.base.kind === 'panelStat'
    const critDmgDecimal = z('critDmg') / 100
    const unisonZone = values.get('unison')
    const tuneStrainZone = values.get('tuneStrain')
    const tuneBreakZone = values.get('tuneBreak')
    const customMult = values.get('special') ?? 1
    const ratioFactors =
        base.effect !== undefined
            ? withExtraRatioFactor(effectRatioFactors(base.effect, hits), z('extraRatio'), hits)
            : withExtraRatioFactor(skillRatioFactors(entry), z('extraRatio'), hits)

    return {
        id: entry.id,
        character: entry.character ?? '',
        hitName: entry.hitName,
        skillType: entry.skillType ?? '',
        displayName: entry.displayName,
        element: damage.element,
        formula: def.id as ResultEntry['formula'],
        panel,
        ratioNum: base.reportedRatio,
        hits: entry.hits,
        sourceTimelineBlockId: entry.sourceTimelineBlockId,
        baseValue: Math.round(damage.baseValue),
        baseUnit: base.baseUnit,
        totalMultiplier: base.effectiveRatio * productOf(damage),
        baseAtk: base.baseAtkField,
        totalAtk: fromPanel ? panel.total.atk : 0,
        atkPctSum: fromPanel ? z('atkPct') : 0,
        atkFlatSum: fromPanel ? z('atkFlat') : 0,
        baseHp: fromPanel ? panel.base.hp : 0,
        totalHp: fromPanel ? panel.total.hp : 0,
        hpPctSum: fromPanel ? z('hpPct') : 0,
        hpFlatSum: fromPanel ? z('hpFlat') : 0,
        baseDef: fromPanel ? panel.base.def : 0,
        totalDef: fromPanel ? panel.total.def : 0,
        defPctSum: fromPanel ? z('defPct') : 0,
        defFlatSum: fromPanel ? z('defFlat') : 0,
        totalTuneBreakBoost: z('tuneBreakBoost'),
        // 增伤区只属于面板基类（系数基类条目不吃增伤，其词条加成不得出现在结果里）
        dmgBonus: fromPanel ? z('bonusDmg') / 100 : 0,
        deepen: values.has('deepen') ? z('deepenDmg') / 100 : 0,
        critRate: Math.min(z('critRate'), 100) / 100,
        critDmg: critDmgDecimal,
        defMulti: values.get('defense') ?? 0,
        resMulti: values.get('resist') ?? 0,
        dmgRedMulti: values.get('dmgRed') ?? 0,
        finalDmg: z('finalDmg') / 100,
        finalTuneStrainMulti:
            tuneStrainZone !== undefined && (damage.target.zones.tuneStrainLayer ?? 0) > 0 ? tuneStrainZone - 1 : 0,
        finalTuneBreakZone: tuneBreakZone !== undefined ? tuneBreakZone - 1 : 0,
        finalUnisonMulti: unisonZone !== undefined && z('unisonBoonLayer') > 0 ? unisonZone - 1 : 0,
        customMult,
        extraRatio: z('extraRatio'),
        vulnerability: values.has('vuln') ? z('dmgTakenInc') / 100 : 0,
        rawPerHit: damage.nonCrit,
        expectedPerHit: damage.expected,
        totalDamage: damage.expected,
        totalDamageRaw: damage.expectedRaw,
        // 不可暴击时「暴击 / 不暴击」两列保持与期望同值，避免下游旧勾选把该段算成 0
        nonCritPerHit: damage.canCrit ? damage.nonCrit : damage.expected,
        critPerHit: damage.canCrit ? damage.crit : damage.expected,
        canCrit: damage.canCrit,
        multiplierZones: damage.multipliers,
        damageTypes: meta.damageTypes,
        ...(fromPanel ? { elBonus: meta.elementBonus, typeBonus: meta.typeBonus } : {}),
        ratioFactors
    }
}

/** @desc 门面复用的内核实例（注册表在模块加载时建一次） */
const core = createCoconutCore()

/** @desc 编译 + 内核结算，返回表与按条目分组的结算结果 */
export const computeWithCore = (request: ComputeRequest) => {
    const { table, meta } = compileProject(request)
    const result = core.compute(table, basesOfRequest(request))
    return { table, meta, result }
}

/** @desc 工程状态 → `ResultEntry[]`（与引擎 `computeAll` 同形状） */
export const computeAllViaCore = (request: ComputeRequest): ResultEntry[] => {
    const { meta, result } = computeWithCore(request)
    return request.entries.map((entry, entryIndex) => {
        if (meta[entryIndex]!.stub) return makeStubEntry(entry)
        return materialize(entry, result.damages[entryIndex]!, meta[entryIndex]!)
    })
}

/** @desc 与引擎 `computeAll` 同位置参数的入口（调用处只换 import，不改实参顺序） */
export const computeAllCore = (
    entries: ComputeRequest['entries'],
    buffs: ComputeRequest['buffs'],
    bindings: ComputeRequest['bindings'],
    damageTypes: ComputeRequest['damageTypes'],
    config: ComputeRequest['config'],
    team: ComputeRequest['team'],
    charInfo: ComputeRequest['charInfo'],
    weaponInfo: ComputeRequest['weaponInfo'],
    profile?: ComputeRequest['profile'],
    echoSkillText?: ComputeRequest['echoSkillText']
): ResultEntry[] =>
    computeAllViaCore({
        entries,
        buffs,
        bindings,
        damageTypes,
        config,
        team,
        charInfo,
        weaponInfo,
        profile,
        echoSkillText
    })
