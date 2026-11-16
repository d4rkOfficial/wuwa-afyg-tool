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
import type { BuffInstance, BuffZoneValue, DamageEntry as EngineDamageEntry } from '$coconut/engine/calculation.types'
import type { ComputeRequest } from '$coconut/engine/core'
import {
    DEFAULT_CONDITION_PROFILE,
    entryActiveBuffs,
    entryStatsOf,
    zoneConditionMet,
    type ConditionProfile,
    type ZoneCtx
} from '$coconut/engine/compute'
import { ELEMENTS, TYPE_BONUS_MAP } from '$lib/consts/game-terms'
import type { Buff, Damage, DamageEntry, GeneralTable, Stat } from '$coconut'

/** @desc 词条键是否属于「伤害类型加成」（这类词条要按段挂成 `bonusDmg`） */
const isTypeBonusStat = (key: string): boolean => TYPE_BONUS_MAP[key] !== undefined

/** @desc 面板基值类型 → 倍率串的基准后缀（与内核 `BASE_SUFFIXES` 一致） */
const BASE_SUFFIX_OF: Record<string, string> = { 生命: '生命', 防御: '防御' }

/** @desc 条目 → 内核的倍率串 */
const valueOf = (entry: EngineDamageEntry): string => {
    if (entry.formula === 'fixed') return String(entry.ratioValue)
    const suffix = BASE_SUFFIX_OF[entry.damageBaseType] ?? ''
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
 * @desc 一条乘区作用 → 内核的 `Buff`。
 *
 * 数值型直接给字面值；引用型（转模）只在「线性 + 同一角色」时可表达（内核的 `StatRef`
 * 没有比例系数与跨角色），其余由调用方在编译期折算成字面值 —— 见 `foldRefs`。
 */
const buffOf = (zone: BuffZoneValue): Buff | null => {
    if (zone.ref) return null
    if (zone.value === 0) return null
    return { id: `${zone.zoneId}`, effect: { applyTo: zone.zoneId, value: String(zone.value) } }
}

/** @desc 生效 buff 的全部乘区作用（乘区级条件在此剔除） */
const effectsOf = (buffs: readonly BuffInstance[], ctx: ZoneCtx): Buff[] =>
    buffs
        .flatMap((buff) => buff.zones.map((zone) => ({ buff, zone })))
        .filter(({ zone }) => zoneConditionMet(zone, ctx))
        .flatMap(({ buff, zone }) => {
            const effect = buffOf(zone)
            return effect ? [{ ...effect, id: `${buff.id}:${zone.zoneId}` }] : []
        })

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
        return hit ? [{ id: `statBonus:${stat.key}`, effect: { applyTo: 'bonusDmg', value: stat.value } }] : []
    })

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

    const mainStats: Stat[][] = statsPerChar.map((stats) => [...stats.mainStats])
    const subStats: Stat[][] = []
    const typeBonusStats: Stat[][] = []
    for (const stats of statsPerChar) {
        const { plain, typeBonus } = splitStats([...stats.mainStats, ...stats.subStats])
        subStats.push(plain)
        typeBonusStats.push(typeBonus)
    }

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

        const buffs: Buff[] = [...effectsOf(active, ctx), ...typeBonusBuffsOf(typeBonusStats[charIndex] ?? [], ctx)]

        const damage: Damage = {
            value: valueOf(entry),
            activated_buffs: buffs,
            element: entry.damageElement,
            formula: formulaOf(entry)
        }
        return { source: entry.character ?? '', damages: [damage] }
    })

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
