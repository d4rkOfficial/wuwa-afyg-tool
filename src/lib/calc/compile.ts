/**
 * @desc 工具箱 → 计算核的**编译器**：把工程里那套复杂抽象压成一张 `GeneralTable`。
 *
 * 这里承担全部「业务语义」：
 * - Buff 的作用域 / 链阶 / 精炼 / 伤害名 / 面板 / 敌人类型 / 依赖闭包 → 求值成「哪些 buff 生效」；
 * - 乘区级条件（伤害属性 / 伤害类型）→ 求值成「哪些作用生效」；
 * - 声骸 5 槽的主词条、cost 派生副主词条、副词条、武器副属性 → 压成词条数组；
 * - 类型加成词条（内核没有「伤害类型」字段）→ 折叠成按段挂载的 `bonusDmg` buff。
 *
 * 内核侧因此完全无条件：拿到什么就加什么。
 */
import type { BuffInstance, DamageEntry as EngineDamageEntry } from '$lib/calc/calculation.types'
import type { ComputeRequest } from '$lib/calc/core'
import {
    DEFAULT_CONDITION_PROFILE,
    entryActiveBuffs,
    entryStatsOf,
    resolveRefZoneValues,
    zoneConditionMet,
    type ConditionProfile,
    type ZoneCtx
} from '$lib/calc/compute'
import { ELEMENTS, NON_DIRECT_ELEMENT, TYPE_BONUS_MAP } from '$lib/consts/game-terms'
import { getEffectBurstMultiplier, getEffectMultiplier } from '$lib/consts/effect-data'
import { BASE_SUFFIXES, BONUS_DMG_ACTION, DEFAULT_PANEL_DIM } from '$coconut/stats'
import { PANEL_BASE_TYPES } from '$coconut/formulas'
import type { Buff, Damage, DamageEntry, GeneralTable, Stat } from '$coconut'

/** @desc 只读列表 Record → 可变列表 Record（引擎入参是可变形态） */
const toMutableList = (record: Readonly<Record<string, readonly string[]>> | undefined): Record<string, string[]> =>
    Object.fromEntries(Object.entries(record ?? {}).map(([key, value]) => [key, [...value]]))

/** @desc 词条键是否属于「伤害类型加成」（这类词条要按段挂成 `bonusDmg`） */
const isTypeBonusStat = (key: string): boolean => TYPE_BONUS_MAP[key] !== undefined

/** @desc 效应虚角色的 id 前缀：效应没有源角色，内核里用虚角色承载「效应系数」面板属性 */
export const VIRTUAL_EFFECT_PREFIX = '效应·'

/** @desc 效应的层数倍率（普通 + 爆发），即该段送进内核的倍率 */
const effectFactorOf = (entry: EngineDamageEntry): number =>
    getEffectMultiplier(entry.hitName, Math.round(entry.ratioValue)) +
    getEffectBurstMultiplier(entry.hitName, Math.round(entry.burstLayers ?? 0))

/** @desc 面板基值维度 → 倍率串的基准后缀（由内核注册表派生，不自己列实体名） */
const BASE_SUFFIX_OF: Record<string, string> = Object.fromEntries(BASE_SUFFIXES.map(([suffix, dim]) => [dim, suffix]))

/** @desc 条目 → 内核的倍率串 */
const valueOf = (entry: EngineDamageEntry): string => {
    if (entry.formula === 'fixed') return String(entry.ratioValue)
    // 系数类基值（处决/响应）读的是面板系数，倍率是**纯倍数**，不带「%」也不带基准后缀
    if (entry.formula === 'tune') return String(entry.ratioUnit === '%' ? entry.ratioValue / 100 : entry.ratioValue)
    const suffix = BASE_SUFFIX_OF[PANEL_BASE_TYPES[entry.damageBaseType]?.dim ?? DEFAULT_PANEL_DIM] ?? ''
    if (entry.ratioUnit === '%') return `${entry.ratioValue}%${suffix}`
    return `${entry.ratioValue}${suffix}`
}

/** @desc 条目 → 内核的公式（固定值由倍率单位标记） */
const formulaOf = (entry: EngineDamageEntry) => (entry.ratioUnit === 'fixed' ? 'fixed' : entry.formula)

/** @desc 条目级条件求值上下文（乘区条件的唯一判据） */
const zoneCtxOf = (entry: EngineDamageEntry, profile: ConditionProfile, damageTypes: readonly string[]): ZoneCtx => ({
    chains: profile.chains,
    refinements: profile.refinements,
    element: entry.damageElement,
    damageTypes: [...damageTypes],
    isEffect: entry.formula === 'effect',
    damageName: entry.displayName
})

/**
 * @desc 生效 buff 的全部乘区作用（乘区级条件在此剔除）。
 *
 * 引用（转模）作用在编译期折算成**字面数值**：`refValues` 由引擎同一条链路算出
 * （`resolveRefZoneValues`，口径与结算完全一致），这样内核不需要知道「引用」怎么读面板，
 * 又能保住 buff id —— 溯源时贡献照样算在原来那条 buff 名下。
 */
const effectsOf = (buffs: readonly BuffInstance[], ctx: ZoneCtx, refValues: ReadonlyMap<string, number>): Buff[] =>
    buffs.flatMap((buff) =>
        buff.zones.flatMap((zone, zoneIndex) => {
            if (!zoneConditionMet(zone, ctx)) return []
            const value = zone.ref ? refValues.get(`${buff.id}#${zoneIndex}`) : zone.value
            if (value === undefined || value === 0) return []
            return [{ id: buff.id, effect: { applyTo: zone.zoneId, value: String(value) } }]
        })
    )

/**
 * @desc 词条数组 → 内核可表达的形态：
 * - 普通词条留在 `sub_stats`；
 * - 类型加成词条按段挂成 `bonusDmg`（内核没有伤害类型字段）。
 */
const splitStats = (stats: readonly Stat[]): { plain: Stat[]; typeBonus: Stat[] } => {
    const plain: Stat[] = []
    const typeBonus: Stat[] = []
    for (const stat of stats) (isTypeBonusStat(stat.key) ? typeBonus : plain).push(stat)
    return { plain, typeBonus }
}

/** @desc 类型加成词条 → 命中该伤害类型的段挂 `bonusDmg`（类型名去掉「伤害」后缀） */
const typeBonusBuffsOf = (stats: readonly Stat[], ctx: ZoneCtx): Buff[] =>
    stats.flatMap((stat) => {
        const type = TYPE_BONUS_MAP[stat.key]
        const hit = (ctx.damageTypes ?? []).some((damageType) => damageType.replace('伤害', '') === type)
        return hit ? [{ id: `statBonus:${stat.key}`, effect: { applyTo: BONUS_DMG_ACTION, value: stat.value } }] : []
    })

/** @desc 敌人配置里「不属于表元组」的部分：免伤（内核用目标侧作用表达，故按段挂一条 buff） */
const enemyBuffsOf = (enemy: ComputeRequest['config']['enemy']): Buff[] =>
    enemy.dmgReduction === 0
        ? []
        : [{ id: 'enemy:dmgReduction', effect: { applyTo: 'enemyDmgReduction', value: String(enemy.dmgReduction) } }]

/** @desc 工程状态 → 一张 `GeneralTable` */
export const compileGeneralTable = (request: ComputeRequest): GeneralTable => {
    const profile = request.profile ?? DEFAULT_CONDITION_PROFILE
    const characters = request.team.map((slot) => slot.character ?? '')
    const weapons = request.team.map((slot) => slot.weapon ?? '')

    const statsPerChar = request.team.map((slot, index) =>
        entryStatsOf({
            weaponInfo: request.weaponInfo[slot.weapon ?? ''] ?? null,
            echoes: request.config.characters[index]?.echoes ?? []
        })
    )

    const mainStats: Stat[][] = []
    const subStats: Stat[][] = []
    const typeBonusStats: Stat[][] = []
    for (const stats of statsPerChar) {
        const mains = splitStats([...stats.mainStats])
        const subs = splitStats([...stats.subStats])
        mainStats.push(mains.plain)
        subStats.push(subs.plain)
        typeBonusStats.push([...mains.typeBonus, ...subs.typeBonus])
    }

    const refContext = {
        buffSets: [...request.buffs],
        damageEntryBuffSetIds: toMutableList(request.bindings),
        damageEntryDamageTypes: toMutableList(request.damageTypes),
        configState: request.config,
        team: [...request.team],
        charInfoMap: { ...request.charInfo },
        weaponInfoMap: { ...request.weaponInfo },
        conditionProfile: profile,
        ...(request.echoSkillText ? { echoSkillText: { ...request.echoSkillText } } : {})
    }

    const virtualIds = new Set<string>()
    const damageEntries: DamageEntry[] = request.entries.map((entry) => {
        const charIndex = characters.indexOf(entry.character ?? '')
        const damageTypes = request.damageTypes?.[entry.id] ?? []
        const ctx = zoneCtxOf(entry, profile, damageTypes)

        const active =
            charIndex >= 0
                ? entryActiveBuffs({
                      entry,
                      charIndex,
                      buffSets: request.buffs,
                      bindings: request.bindings,
                      damageTypes: request.damageTypes ?? {},
                      profile
                  })
                : []

        const refValues = charIndex >= 0 ? resolveRefZoneValues(entry, refContext) : new Map<string, number>()
        const buffs: Buff[] = [
            ...enemyBuffsOf(request.config.enemy),
            ...effectsOf(active, ctx, refValues),
            ...typeBonusBuffsOf(typeBonusStats[charIndex] ?? [], ctx)
        ]

        const isEffect = entry.formula === 'effect'
        const damage: Damage = {
            value: isEffect ? String(effectFactorOf(entry)) : valueOf(entry),
            activated_buffs: buffs,
            element: isEffect
                ? ((NON_DIRECT_ELEMENT as Record<string, string>)[entry.hitName] ?? entry.damageElement)
                : entry.damageElement,
            formula: formulaOf(entry)
        }
        // 段数由编译器展开：内核一段一条，合计即引擎的「每段 × 段数」
        const hits = Math.max(1, Math.trunc(entry.hits || 1))
        const source = isEffect ? `${VIRTUAL_EFFECT_PREFIX}${entry.hitName}` : (entry.character ?? '')
        if (isEffect) virtualIds.add(source)
        return { source, damages: Array.from({ length: hits }, () => ({ ...damage })) }
    })

    for (const id of virtualIds) {
        characters.push(id)
        weapons.push('')
        mainStats.push([])
        subStats.push([])
    }

    return {
        characters,
        weapons,
        main_stats: mainStats,
        sub_stats: subStats,
        buffs: damageEntries.flatMap((entry) => entry.damages.flatMap((damage) => damage.activated_buffs)),
        damage_entries: damageEntries,
        enemy: [
            request.config.enemy.type,
            request.config.enemy.level,
            request.config.enemy.defense,
            enemyResistancesOf(request.config.enemy)
        ]
    }
}

/** @desc 敌人各属性抗性（顺序 = `ELEMENTS`；配置里缺的属性按 0） */
const enemyResistancesOf = (enemy: ComputeRequest['config']['enemy']): number[] =>
    ELEMENTS.map((element) => Number(enemy.resistances[element] ?? 0))
