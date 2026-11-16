/**
 * @desc 工具箱 → 计算核的**编译器**：把工程里那套复杂抽象压成一张 `GeneralTable`。
 *
 * 这里承担全部「业务语义」：
 * - Buff 的作用域 / 链阶 / 精炼 / 伤害名 / 面板 / 敌人类型 / 依赖闭包 → 求值成「哪些 buff 生效」；
 * - 乘区级条件（伤害属性 / 伤害类型）→ 求值成「哪些作用生效」；
 * - 转模（引用）→ 折算成字面数值（内核不知道「引用」怎么读面板）；
 * - 角色白值 / 武器白值与副属性 / 声骸词条 / 敌人配置 → 全部编译成 buff（表里没有「基础数值」）；
 * - 类型 / 属性加成词条（内核没有「伤害类型」字段）→ 折叠成按段挂载的 `bonusDmg` buff。
 *
 * 逐条目的语义解析复用引擎的 `resolveEntry`（同一处实现），因此「编译器压表 → 内核结算」
 * 与引擎直接结算拿到的是同一份面板。
 */
import type { DamageEntry as EngineDamageEntry } from '$lib/calc/calculation.types'
import type { ComputeRequest } from '$lib/calc/request.types'
import { DEFAULT_CONDITION_PROFILE, TUNE_COEFF_MAP, entryStatsOf, resolveEntry, weaponStatsOf } from '$lib/calc/compute'
import { ELEMENT_BONUS_MAP, ELEMENTS, NON_DIRECT_ELEMENT, TYPE_BONUS_MAP } from '$lib/consts/game-terms'
import { EFFECT_BASE_VALUE, getEffectBurstMultiplier, getEffectMultiplier } from '$lib/consts/effect-data'
import { BONUS_DMG_ACTION, DEFAULT_PANEL_DIM, statActionOf } from '$lib/calc/stat-writes'
import type { PanelDim } from '$lib/calc/core-config'
import { CHAR_LEVEL_ACTION, CRIT_ACTION_IDS, PANEL_BASE_TYPES, TUNE_BREAK_BOOST_ACTION } from '$lib/calc/core-config'
import type { ActionId, Buff, BuffEffect, Damage, DamageEntry, GeneralTable, Stat } from '$coconut'

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
 * - 普通词条压成作用写入；
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

/** @desc 折进增伤区的词条加成（`bonusDmg` 落值 + 归属 buff id） */
interface BonusEffect {
    id: string
    effect: BuffEffect
}

const numOfEffect = (effect: BuffEffect): number =>
    typeof effect.value === 'string' ? Number.parseFloat(effect.value) || 0 : 0

/** @desc 类型加成词条 → 命中该伤害类型的段挂 `bonusDmg`（类型名去掉「伤害」后缀） */
const typeBonusBuffsOf = (stats: readonly Stat[], damageTypes: readonly string[]): BonusEffect[] =>
    stats.flatMap((stat) => {
        const type = TYPE_BONUS_MAP[stat.key]
        const hit = damageTypes.some((damageType) => damageType.replace('伤害', '') === type)
        return hit ? [{ id: `statBonus:${stat.key}`, effect: { applyTo: BONUS_DMG_ACTION, value: stat.value } }] : []
    })

/** @desc 属性加成词条 → 命中该伤害属性的段挂 `bonusDmg` */
const elementBonusBuffsOf = (stats: readonly Stat[], element: string): BonusEffect[] =>
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

/** @desc 词条 → 内核作用写入（双暴词条标记「只在面板基准生效」，与引擎在系数基准下跳过它们同口径） */
const statEffectsOf = (plain: readonly Stat[]): BuffEffect[] =>
    plain.map((stat) => ({
        applyTo: stat.key,
        value: stat.value,
        ...(CRIT_ACTION_IDS.includes(stat.key) ? { only: 'panel' as const } : {})
    }))

/**
 * @desc 一位角色的「装备词条」拆分结果（武器副属性 → 声骸主词条 → 声骸副词条，顺序固定）。
 *
 * 顺序与引擎 `accumulateEchoes` 逐项一致（浮点累加顺序一致 → 面板落值逐位相等）。
 */
interface EquipParts {
    /** @desc 面板写入（已转成作用 id） */
    plain: Stat[]
    /** @desc 折进增伤区的类型加成词条 */
    typeBonus: Stat[]
    /** @desc 折进增伤区的属性加成词条 */
    elementBonus: Stat[]
}

const equipPartsOf = (request: ComputeRequest, charIndex: number): EquipParts => {
    const slot = request.team[charIndex]
    const weaponInfo = slot?.weapon ? request.weaponInfo[slot.weapon] : null
    const echoes = request.config.characters[charIndex]?.echoes ?? []
    const weapon = splitStats(weaponStatsOf(weaponInfo))
    const echoStats = entryStatsOf({ echoes })
    const mains = splitStats(echoStats.mainStats)
    const subs = splitStats(echoStats.subStats)
    return {
        plain: [...weapon.plain, ...mains.plain, ...subs.plain],
        typeBonus: [...weapon.typeBonus, ...mains.typeBonus, ...subs.typeBonus],
        elementBonus: [...weapon.elementBonus, ...mains.elementBonus, ...subs.elementBonus]
    }
}

/**
 * @desc 一位角色的「基础数值 + 装备」→ 一条 buff 的落值序列。
 *
 * 顺序与引擎 `computeCharacterStats` 逐项一致：白值 → 谐度破坏增幅 → 等级 → 系数 →
 * 武器副属性 → 声骸主词条 → 声骸副词条。
 */
const equipEffectsOf = (request: ComputeRequest, charIndex: number, parts: EquipParts): BuffEffect[] => {
    const slot = request.team[charIndex]
    const charInfo = slot?.character ? request.charInfo[slot.character] : undefined
    const weaponInfo = slot?.weapon ? request.weaponInfo[slot.weapon] : null
    const effects: BuffEffect[] = []

    if (charInfo) {
        const base = charInfo.lv90BaseStats
        effects.push({ applyTo: 'atkBase', value: String(base.atk) })
        effects.push({ applyTo: 'hpBase', value: String(base.hp) })
        effects.push({ applyTo: 'defBase', value: String(base.def) })
        if (weaponInfo) effects.push({ applyTo: 'atkBase', value: String(weaponInfo.lv90BaseAtk) })
        effects.push({ applyTo: TUNE_BREAK_BOOST_ACTION, value: String(Math.round(base.tuneBreakBoost)) })
        effects.push({ applyTo: CHAR_LEVEL_ACTION, value: '90' })
    }

    effects.push(...statEffectsOf(parts.plain))
    return effects
}

/** @desc 敌人配置 → 一条 buff 的落值序列（目标侧） */
const enemyEffectsOf = (request: ComputeRequest): BuffEffect[] => {
    const enemy = request.config.enemy
    const effects: BuffEffect[] = [
        { applyTo: 'enemyType', value: enemy.type },
        { applyTo: 'enemyDefense', value: String(enemy.defense) },
        { applyTo: 'enemyDmgReduction', value: String(enemy.dmgReduction) },
        { applyTo: 'enemyCoeff', value: String(TUNE_COEFF_MAP[enemy.type] ?? 716.2) }
    ]
    for (const element of ELEMENTS) {
        effects.push({ applyTo: 'resistance', element, value: String(enemy.resistances[element] ?? 0) })
    }
    return effects
}

/** @desc 工程状态 → 一张 `GeneralTable` + 逐条目展示语义 */
export const compileProject = (request: ComputeRequest): { table: GeneralTable; meta: CompiledEntryMeta[] } => {
    const profile = request.profile ?? DEFAULT_CONDITION_PROFILE

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

    /**
     * @desc 表内 Buff 目录：`activated_buffs` 只放 id，落值明细集中在这里。
     *
     * 同一个 buff 在不同条目上生效的落值可能不同（乘区条件、转模数值随条目面板变化），
     * 所以按「id + 落值内容」去重：首个用原 id，内容不同的变体加 `#2` / `#3`。
     */
    const directory = new Map<string, Buff>()
    const idOfContent = new Map<string, string>()
    /** @desc 作用 id → 落值签名里的稳定文本（symbol 的 `String()` 可能重名，按首次出现编号） */
    const symbolText = new Map<symbol, string>()
    const idText = (id: ActionId): string => {
        if (typeof id === 'string') return id
        const known = symbolText.get(id)
        if (known) return known
        const text = `#${symbolText.size + 1}`
        symbolText.set(id, text)
        return text
    }
    const effectSignature = (effects: readonly BuffEffect[]): string =>
        effects
            .map((effect) => {
                const value = typeof effect.value === 'string' ? effect.value : JSON.stringify(effect.value)
                return `${idText(effect.applyTo)}|${effect.element ?? ''}|${value}|${effect.write ?? 'add'}|${effect.only ?? ''}`
            })
            .join(';')
    const registerBuff = (buffId: string, effects: readonly BuffEffect[], role?: 'stat'): string => {
        const signature = `${buffId}\u0000${effectSignature(effects)}`
        const known = idOfContent.get(signature)
        if (known) return known
        let id = buffId
        let n = 1
        while (directory.has(id)) {
            n += 1
            id = `${buffId}#${n}`
        }
        directory.set(id, { id, effects: [...effects], ...(role ? { role } : {}) })
        idOfContent.set(signature, id)
        return id
    }

    /** @desc 敌人配置对所有伤害一致 → 只登记一次，作为每条伤害的第一个 buff（`role: 'stat'` 不进贡献溯源） */
    const enemyBuffId = registerBuff('enemy:setup', enemyEffectsOf(request), 'stat')
    const equipParts = request.team.map((_, index) => equipPartsOf(request, index))
    const equipIds = request.team.map((_, index) =>
        registerBuff(`equip:${index}`, equipEffectsOf(request, index, equipParts[index]!), 'stat')
    )

    const meta: CompiledEntryMeta[] = []
    const damageEntries: DamageEntry[] = request.entries.map((entry) => {
        const resolved = resolveEntry(entry, ctx)
        const charIndex = request.team.findIndex((slot) => (slot.character ?? '') === (entry.character ?? ''))
        const element = elementOf(entry)
        const isEffect = entry.formula === 'effect'
        const source = isEffect ? `${VIRTUAL_EFFECT_PREFIX}${entry.hitName}` : (entry.character ?? '')
        const parts = charIndex >= 0 ? equipParts[charIndex]! : { plain: [], typeBonus: [], elementBonus: [] }

        const typeBuffs = typeBonusBuffsOf(parts.typeBonus, resolved.damageTypes)
        const elementBuffs = elementBonusBuffsOf(parts.elementBonus, element)
        const sumOf = (bonuses: readonly { effect: BuffEffect }[]): number =>
            bonuses.reduce((sum, bonus) => sum + numOfEffect(bonus.effect), 0)

        /** 同一 buff 的多个落点收拢成一条目录项 */
        const effectsByBuff = new Map<string, BuffEffect[]>()
        const pushEffect = (buffId: string, effect: BuffEffect): void => {
            const list = effectsByBuff.get(buffId)
            if (list) list.push(effect)
            else effectsByBuff.set(buffId, [effect])
        }
        const toEffect = (write: { applyTo: string; value: number; write: 'add' | 'override' }): BuffEffect => ({
            applyTo: write.applyTo,
            value: String(write.value),
            ...(write.write === 'override' ? { write: 'override' as const } : {})
        })

        for (const write of resolved.writes) pushEffect(write.buffId, toEffect(write))
        for (const write of resolved.targetWrites) pushEffect(write.buffId, toEffect(write))
        for (const bonus of typeBuffs) pushEffect(bonus.id, bonus.effect)
        for (const bonus of elementBuffs) pushEffect(bonus.id, bonus.effect)

        // 顺序：敌人配置 → 本角色装备 → 本段生效 buff → 效应系数（效应条目无装备，系数最后写）
        const activated_buffs = [
            enemyBuffId,
            ...(charIndex >= 0 ? [equipIds[charIndex]!] : []),
            ...[...effectsByBuff.entries()].map(([buffId, effects]) => registerBuff(buffId, effects)),
            ...(isEffect
                ? [
                      registerBuff(`effect:${entry.hitName}`, [
                          { applyTo: 'effectCoeff', value: String(EFFECT_BASE_VALUE) }
                      ])
                  ]
                : [])
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

    /**
     * @desc 全局 Buff：所有伤害的 `activated_buffs` 的**公共前缀**。
     *
     * 只有「在每条伤害里都排在最前且完全一致」的 id 才能提到全局（顺序不变 →
     * 浮点累加顺序与原来完全一致）。敌人配置天然满足；同队多角色时装备 per-角色，前缀会停在装备处。
     */
    const allLists = damageEntries.flatMap((entry) => entry.damages.map((damage) => damage.activated_buffs))
    const globalBuffIds: string[] = []
    if (allLists.length > 0) {
        for (let i = 0; ; i++) {
            const candidate = allLists[0]![i]
            if (candidate === undefined) break
            if (!allLists.every((list) => list[i] === candidate)) break
            globalBuffIds.push(candidate)
        }
    }
    if (globalBuffIds.length > 0) {
        for (const entry of damageEntries) {
            for (const damage of entry.damages) {
                damage.activated_buffs = damage.activated_buffs.slice(globalBuffIds.length)
            }
        }
    }

    const table: GeneralTable = {
        global_buffs: globalBuffIds,
        buffs: [...directory.values()],
        damage_entries: damageEntries
    }
    return { table, meta }
}

/** @desc 工程状态 → 一张 `GeneralTable` */
export const compileGeneralTable = (request: ComputeRequest): GeneralTable => compileProject(request).table
