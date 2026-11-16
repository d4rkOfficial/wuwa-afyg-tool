/**
 * @desc 工具箱 → 计算核的**编译器**：把工程里那套复杂抽象压成一张 `GeneralTable`。
 *
 * 这里承担全部「业务语义」：
 * - Buff 的作用域 / 链阶 / 精炼 / 伤害名 / 面板 / 敌人类型 / 依赖闭包 → 求值成「哪些 buff 生效」；
 * - 乘区级条件（伤害属性 / 伤害类型）→ 求值成「哪些作用生效」；
 * - 转模（引用）→ 折算成字面数值（内核不知道「引用」怎么读面板）；
 * - 声骸 5 槽的主词条、cost 派生副主词条、副词条、武器副属性 → 压成词条数组；
 * - 类型 / 属性加成词条（内核没有「伤害类型」字段）→ 折叠成按段挂载的 `bonusDmg` buff。
 *
 * 逐条目的语义解析复用引擎的 `resolveEntry`（同一处实现），因此「编译器压表 → 内核结算」
 * 与引擎直接结算拿到的是同一份面板。
 */
import type { DamageEntry as EngineDamageEntry } from '$lib/calc/calculation.types'
import type { ComputeRequest } from '$lib/calc/request.types'
import { DEFAULT_CONDITION_PROFILE, entryStatsOf, resolveEntry } from '$lib/calc/compute'
import { ELEMENT_BONUS_MAP, NON_DIRECT_ELEMENT, TYPE_BONUS_MAP } from '$lib/consts/game-terms'
import { getEffectBurstMultiplier, getEffectMultiplier } from '$lib/consts/effect-data'
import { BONUS_DMG_ACTION, DEFAULT_PANEL_DIM, statActionOf } from '$lib/calc/stat-writes'
import type { PanelDim } from '$lib/calc/core-config'
import { PANEL_BASE_TYPES } from '$lib/calc/core-config'
import type { Buff, Damage, DamageEntry, GeneralTable, Stat } from '$coconut'

/** @desc 只读列表 Record → 可变列表 Record（引擎入参是可变形态） */
const toMutableList = (record: Readonly<Record<string, readonly string[]>> | undefined): Record<string, string[]> =>
    Object.fromEntries(Object.entries(record ?? {}).map(([key, value]) => [key, [...value]]))

/** @desc 词条键是否属于「伤害类型加成」（这类词条要按段挂成 `bonusDmg`） */
const isTypeBonusStat = (key: string): boolean => TYPE_BONUS_MAP[key] !== undefined

/** @desc 词条键是否属于「属性加成」（同样按段挂 `bonusDmg`，只挑属性匹配的伤害） */
const isElementBonusStat = (key: string): boolean => ELEMENT_BONUS_MAP[key] !== undefined

/** @desc 词条 label → 内核作用 id；没有单一落点的（元素/类型/治疗）返回 null */
const toActionStat = (stat: Stat): Stat | null => {
    const action = statActionOf(stat.key)
    return action === null ? null : { key: action, value: stat.value }
}

/** @desc 效应虚角色的 id 前缀：效应没有源角色，内核里用虚角色承载「效应系数」面板属性 */
export const VIRTUAL_EFFECT_PREFIX = '效应·'

/** @desc 效应的层数倍率（普通 + 爆发）× 段数，即该段送进内核的倍率 */
const effectFactorOf = (entry: EngineDamageEntry): number =>
    (getEffectMultiplier(entry.hitName, Math.round(entry.ratioValue)) +
        getEffectBurstMultiplier(entry.hitName, Math.round(entry.burstLayers ?? 0))) *
    Math.max(1, entry.hits || 1)

/** @desc 条目 → 内核的倍率串（纯倍数/百分比；基准维度另给，内核里没有语料） */
const valueOf = (entry: EngineDamageEntry): string => {
    if (entry.formula === 'fixed') return String(entry.ratioValue)
    if (entry.formula === 'effect') return String(effectFactorOf(entry))
    if (entry.formula === 'tune') return String(entry.ratioUnit === '%' ? entry.ratioValue / 100 : entry.ratioValue)
    if (entry.ratioUnit === '%') return `${entry.ratioValue}%`
    return String(entry.ratioValue)
}

/** @desc 条目 → 基值取自面板哪一维（语料映射只在这一层发生） */
const baseDimOf = (entry: EngineDamageEntry): PanelDim =>
    PANEL_BASE_TYPES[entry.damageBaseType]?.dim ?? DEFAULT_PANEL_DIM

/** @desc 条目 → 内核的公式（固定值由倍率单位标记） */
const formulaOf = (entry: EngineDamageEntry) => (entry.ratioUnit === 'fixed' ? 'fixed' : entry.formula)

/** @desc 条目实际生效的伤害属性（效应条目用效应自身的属性映射） */
const elementOf = (entry: EngineDamageEntry): string =>
    entry.formula === 'effect'
        ? ((NON_DIRECT_ELEMENT as Record<string, string>)[entry.hitName] ?? '')
        : entry.damageElement

/**
 * @desc 词条数组 → 内核可表达的形态：
 * - 普通词条留在 `sub_stats`；
 * - 类型 / 属性加成词条按段挂成 `bonusDmg`（内核没有伤害类型字段）。
 */
const splitStats = (stats: readonly Stat[]): { plain: Stat[]; typeBonus: Stat[]; elementBonus: Stat[] } => {
    const plain: Stat[] = []
    const typeBonus: Stat[] = []
    const elementBonus: Stat[] = []
    for (const stat of stats) {
        if (isTypeBonusStat(stat.key)) typeBonus.push(stat)
        else if (isElementBonusStat(stat.key)) elementBonus.push(stat)
        else {
            const action = toActionStat(stat)
            if (action) plain.push(action)
        }
    }
    return { plain, typeBonus, elementBonus }
}

/** @desc 类型加成词条 → 命中该伤害类型的段挂 `bonusDmg`（类型名去掉「伤害」后缀） */
const typeBonusBuffsOf = (stats: readonly Stat[], damageTypes: readonly string[]): Buff[] =>
    stats.flatMap((stat) => {
        const type = TYPE_BONUS_MAP[stat.key]
        const hit = damageTypes.some((damageType) => damageType.replace('伤害', '') === type)
        return hit ? [{ id: `statBonus:${stat.key}`, effect: { applyTo: BONUS_DMG_ACTION, value: stat.value } }] : []
    })

/** @desc 属性加成词条 → 命中该伤害属性的段挂 `bonusDmg` */
const elementBonusBuffsOf = (stats: readonly Stat[], element: string): Buff[] =>
    stats.flatMap((stat) =>
        ELEMENT_BONUS_MAP[stat.key] === element
            ? [{ id: `statElement:${stat.key}`, effect: { applyTo: BONUS_DMG_ACTION, value: stat.value } }]
            : []
    )

/** @desc 单条目的编译副产物：物化 `ResultEntry` 时需要的展示语义（不参与数值） */
export interface CompiledEntryMeta {
    source: string
    element: string
    damageTypes: string[]
    /** @desc 折进增伤区的属性加成（%） */
    elementBonus: number
    /** @desc 折进增伤区的类型加成（%） */
    typeBonus: number
    /** @desc 条目缺少角色或角色数据：引擎给占位结果 */
    stub: boolean
}

/** @desc 工程状态 → 一张 `GeneralTable` + 逐条目展示语义 */
export const compileProject = (request: ComputeRequest): { table: GeneralTable; meta: CompiledEntryMeta[] } => {
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
    const elementBonusStats: Stat[][] = []
    for (const stats of statsPerChar) {
        // 装备词条按引擎的累加顺序整串写进 `main_stats`（顺序会体现在面板落值的浮点末位）
        const parts = splitStats(stats.stats)
        mainStats.push(parts.plain)
        subStats.push([])
        typeBonusStats.push(parts.typeBonus)
        elementBonusStats.push(parts.elementBonus)
    }

    const ctx = {
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

    /** @desc 效应虚角色（无源角色）→ 承载「效应系数」面板属性 */
    const virtualChars = new Map<string, string>()
    const meta: CompiledEntryMeta[] = []
    const damageEntries: DamageEntry[] = request.entries.map((entry) => {
        const resolved = resolveEntry(entry, ctx)
        const charIndex = characters.indexOf(entry.character ?? '')
        const element = elementOf(entry)
        const isEffect = entry.formula === 'effect'
        const source = isEffect ? `${VIRTUAL_EFFECT_PREFIX}${entry.hitName}` : (entry.character ?? '')
        if (isEffect && !virtualChars.has(source)) virtualChars.set(source, element)

        const typeBuffs = typeBonusBuffsOf(typeBonusStats[charIndex] ?? [], resolved.damageTypes)
        const elementBuffs = elementBonusBuffsOf(elementBonusStats[charIndex] ?? [], element)
        const sumOf = (buffs: readonly Buff[]): number =>
            buffs.reduce((sum, buff) => sum + Number.parseFloat(buff.effect.value as string), 0)

        const writeBuff = (write: {
            buffId: string
            applyTo: string
            value: number
            write: 'add' | 'override'
        }): Buff => ({
            id: write.buffId,
            effect: {
                applyTo: write.applyTo,
                value: String(write.value),
                ...(write.write === 'override' ? { write: 'override' as const } : {})
            }
        })

        const activated_buffs: Buff[] = [
            ...resolved.writes.map(writeBuff),
            ...resolved.targetWrites.map(writeBuff),
            ...typeBuffs,
            ...elementBuffs
        ]

        const damage: Damage = {
            value: valueOf(entry),
            base: baseDimOf(entry),
            hits: Math.max(1, entry.hits || 1),
            activated_buffs,
            element,
            formula: formulaOf(entry)
        }
        meta.push({
            source,
            element,
            damageTypes: resolved.damageTypes,
            elementBonus: sumOf(elementBuffs),
            typeBonus: sumOf(typeBuffs),
            stub: resolved.stub
        })
        return { source, damages: [damage] }
    })

    for (const [id] of virtualChars) {
        characters.push(id)
        weapons.push('')
        mainStats.push([])
        subStats.push([])
        // 虚角色的「效应系数」由基础数值给出（见 `basesOfRequest`）
    }

    const table: GeneralTable = {
        characters,
        weapons,
        main_stats: mainStats,
        sub_stats: subStats,
        buffs: damageEntries.flatMap((entry) => entry.damages.flatMap((damage) => damage.activated_buffs)),
        damage_entries: damageEntries
    }
    return { table, meta }
}

/** @desc 工程状态 → 一张 `GeneralTable` */
export const compileGeneralTable = (request: ComputeRequest): GeneralTable => compileProject(request).table
