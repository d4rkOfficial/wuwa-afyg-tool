import type { ResultEntry } from './result.types'
import type { BuffCondition, BuffSet, DamageEntry } from './calculation.types'
import type { ConfigState } from './config.types'
import type { CharSlot } from '$lib/types/project'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import {
    getBoundBuffSets,
    getTargetSideSourceBuffs,
    resolveDamageTypes,
    resolveRefZoneValues,
    zoneConditionMet,
    type ConditionProfile,
    type ZoneCtx
} from './compute'
import { describeZoneConditionBadge } from './condition'
import { buildEchoDescByEntry } from './skill-infer'
import { getEchoSkillText } from '$lib/data/char-info.svelte'
import { ELEMENT_BONUS_MAP, TYPE_BONUS_MAP, WEAPON_SUBSTAT_NAME_MAP } from '$lib/consts/game-terms'

/** @desc 溯源所需上下文（结果页可直接提供的输入，与 computeAll 同源） */
export interface DamageTraceCtx {
    buffSets: BuffSet[]
    damageEntryBuffSetIds: Record<string, string[]>
    damageEntryDamageTypes: Record<string, string[]>
    configState: ConfigState
    team: CharSlot[]
    charInfoMap: Record<string, CharacterInfo>
    weaponInfoMap: Record<string, WeaponInfo>
    conditionProfile: ConditionProfile
}

/** @desc 单个来源条目：白值/武器/声骸/拉表Buff/敌人面板 */
export interface TracePart {
    sourceType: 'base' | 'weapon' | 'echo' | 'buff' | 'enemy' | 'panel'
    source: string
    label: string
    value: number
    unit: '%' | 'flat' | 'mult'
    /** @desc 对当前区数值的折算贡献（可选，%乘区为原值，flat 区为折算值） */
    contribution?: number
}

/** @desc 一个乘区段：数值 + 组成来源（溯源） */
export interface DamageSegment {
    id: string
    label: string
    value: number
    detail: string
    parts: TracePart[]
}

export interface DamageSegments {
    baseUnit: string
    baseLabel: string
    /** @desc 是否为系数基类（偏谐系数/效应系数等，非攻击/生命/防御）：基础来源是系数而非面板 */
    isCoeff: boolean
    baseWhite: number
    baseGreen: number
    totalStat: number
    ratioPct: number
    extraRatioPct: number
    /** @desc 倍率是否已含额外倍率（系数类 ratioNum 为有效倍率，含额外倍率与段数） */
    ratioIncludesExtra: boolean
    /** @desc 额外倍率（extraRatio）的拉表Buff 来源（含引用/覆盖说明），供倍率 chip 溯源展示 */
    extraRatioParts: TracePart[]
    hits: number
    baseValue: number
    baseParts: TracePart[]
    segments: DamageSegment[]
    canCrit: boolean
    /** @desc 不含暴击的总伤（= 基础 × 各区连乘；直伤即不暴击总伤） */
    preCrit: number
    crit: number
    nonCrit: number
    expected: number
    /** @desc 每段期望 = 总期望 / 段数 */
    perHit: number
}

type BaseKind = 'atk' | 'hp' | 'def'

function baseKindOf(baseUnit: string): BaseKind {
    if (baseUnit.startsWith('偏谐系数') || baseUnit === '攻击' || baseUnit === '效应系数') return 'atk'
    if (baseUnit === '生命') return 'hp'
    if (baseUnit === '防御') return 'def'
    return 'atk'
}

function baseLabelOf(baseUnit: string): string {
    if (baseUnit.startsWith('偏谐系数')) return '偏谐系数'
    if (baseUnit === '效应系数') return '效应系数'
    if (baseUnit === '生命') return '生命'
    if (baseUnit === '防御') return '防御'
    return '攻击'
}

/** @desc 是否为系数基类：非攻击/生命/防御（偏谐系数/效应系数等），基础值来自系数而非角色面板 */
function isCoeffBase(baseUnit: string): boolean {
    return baseUnit !== '攻击' && baseUnit !== '生命' && baseUnit !== '防御'
}

/** @desc 基础属性统一叫法（与 ZONE_REF_DEFS/拉表术语一致）：白值/百分比/固定 */
const STAT_LABEL: Record<BaseKind, { white: string; pct: string; flat: string }> = {
    atk: { white: '攻击白值', pct: '攻击%', flat: '攻击固定' },
    hp: { white: '生命白值', pct: '生命%', flat: '生命固定' },
    def: { white: '防御白值', pct: '防御%', flat: '防御固定' }
}

function fmtPercent(v: number): string {
    return `${v.toFixed(1)}%`
}

// ── 来源收集 ──

/**
 * @desc 溯源用的「乘区级条件」上下文：与引擎（`computeAll` / `computeOneEntry` 的 `zoneCtx`）同口径 ——
 * 属性取条目属性、伤害类型取**解析后**的类型（`ResultEntry.damageTypes` 对处决/响应为空，必须现解析，
 * 否则乘区条件的判定会与引擎不一致），链阶档位取条件配置。
 */
const zoneCtxOf = (entryLike: DamageEntry, ctx: DamageTraceCtx, echoDescByEntry: Record<string, string>): ZoneCtx => ({
    chains: ctx.conditionProfile.chains,
    refinements: ctx.conditionProfile.refinements,
    element: entryLike.damageElement,
    damageTypes: resolveDamageTypes(entryLike, ctx.damageEntryDamageTypes, ctx.charInfoMap, echoDescByEntry)
})

/**
 * @desc 乘区标签带上该乘区自己的条件前缀：`加成` → `冷凝加成` / `声骸加成` / `共技·热熔加成`。
 *
 * 口径与乘区徽标共用 `describeZoneConditionBadge`（伤害类型简称在前、属性在后，多选用 `/`，两类用 `·`），
 * 所以溯源里的标签与 Buff 编辑器里那枚徽标逐字一致，不会出现两套写法。
 */
const zoneLabelWithCondition = (label: string, condition: BuffCondition | undefined): string => {
    const badge = describeZoneConditionBadge(condition)
    return badge ? `${badge}${label}` : label
}

/** @desc 引用乘区的溯源键：与 `compute.resolveRefZoneValues` 的键口径一致 */
const refKeyOf = (buffId: string, zoneIndex: number): string => `${buffId}#${zoneIndex}`

/**
 * @desc 乘区来源的判定上下文：
 * - `zoneCtx`：乘区级条件判据（与引擎同一个 `zoneConditionMet`）
 * - `refValues`：引用（转模）的解算结果（`buffId#zoneIndex` → 数值）—— 溯源只展示结果，不展示转模过程
 */
interface ZoneTraceCtx {
    zoneCtx: ZoneCtx
    refValues: Map<string, number>
}

/**
 * @desc 拉表Buff 指定乘区的来源（普通加值 / 覆盖 / 引用）；存在生效覆盖时只列覆盖来源，加算值不再显示（与引擎一致）。
 *
 * **引用只给结果**：转模（`ZoneRef`）的解算值由 `resolveRefZoneValues` 按「本条目可见面板」算出，
 * 溯源直接展示该数值，不再展示规则过程（如「攻击白值 超出2000 每100→5 ≤30」）。
 */
function buffZoneParts(
    buffs: BuffSet[],
    zoneId: string,
    label: string,
    unit: '%' | 'flat',
    { zoneCtx, refValues }: ZoneTraceCtx
): TracePart[] {
    const adds: TracePart[] = []
    const overrides: TracePart[] = []
    const refs: TracePart[] = []
    for (const bs of buffs) {
        bs.zones.forEach((z, zi) => {
            if (z.zoneId !== zoneId) return
            // 乘区条件不满足 ⇒ 引擎没算它，来源也不得列出（判据与引擎同一个 `zoneConditionMet`）
            if (!zoneConditionMet(z, zoneCtx)) return
            const zoneLabel = zoneLabelWithCondition(label, z.condition)
            if (z.ref) {
                refs.push({
                    sourceType: 'buff',
                    source: bs.name,
                    label: `${zoneLabel}(引用)`,
                    value: refValues.get(refKeyOf(bs.id, zi)) ?? 0,
                    unit
                })
            } else if (z.override) {
                if (z.value === 0) return
                overrides.push({
                    sourceType: 'buff',
                    source: bs.name,
                    label: `${zoneLabel}(覆盖)`,
                    value: z.value,
                    unit
                })
            } else if (z.value !== 0) {
                adds.push({ sourceType: 'buff', source: bs.name, label: zoneLabel, value: z.value, unit })
            }
        })
    }
    return overrides.length > 0 ? overrides : [...adds, ...refs]
}

/**
 * @desc 该「元素/类型加成」词条是否真的计入**本条伤害**（与引擎同口径，不能只看 label 是否像加成词条）。
 *
 * 引擎口径（compute.ts）：
 * - 元素加成 `stats.elementBonus[entry.damageElement]` —— 只有词条属性 === 条目属性才计入
 * - 类型加成 `for (const dt of damageTypes) stats.typeBonus[dt.replace('伤害','')]` —— 只有词条类型在
 *   该条目的伤害类型集合里才计入
 *
 * 旧实现只按 label 正则判断「像不像加成」，于是「共鸣技能伤害加成」也被列进普攻条目的增伤区来源 ——
 * 引擎根本没算它，属于溯源弹窗「列了不参与结算的来源」的错误来源。
 * 这里顺带覆盖「引擎完全不认的词条」（两表都没有 → 引擎 applyEntryStatToAccum 落空 → 不计入）。
 */
const bonusLabelApplies = (label: string, entry: ResultEntry): boolean => {
    if (label in ELEMENT_BONUS_MAP) return ELEMENT_BONUS_MAP[label] === entry.element
    if (label in TYPE_BONUS_MAP) return entry.damageTypes.some((dt) => dt.replace('伤害', '') === TYPE_BONUS_MAP[label])
    return false
}

function isBaseStatLabel(kind: BaseKind, label: string): boolean {
    if (kind === 'atk') return label === '攻击' || label === '攻击%'
    if (kind === 'hp') return label === '生命' || label === '生命%'
    return label === '防御' || label === '防御%'
}

/** @desc 基础统计来源：白值 + 武器副词条 + 声骸主/副词条 + 拉表Buff 攻击/生命/防御 */
function collectBaseParts(
    kind: BaseKind,
    baseWhite: number,
    entry: ResultEntry,
    ctx: DamageTraceCtx,
    buffs: BuffSet[],
    { zoneCtx, refValues }: ZoneTraceCtx
): TracePart[] {
    const parts: TracePart[] = []
    const charName = entry.character || ''
    const charInfo = ctx.charInfoMap[charName]
    const charIdx = ctx.team.findIndex((s) => s.character === charName)
    const weaponName = charIdx >= 0 ? (ctx.team[charIdx]?.weapon ?? null) : null
    const weaponInfo = weaponName ? ctx.weaponInfoMap[weaponName] : null

    // 白值：角色基础 + 武器基础
    const statKey = kind === 'hp' ? 'hp' : kind === 'def' ? 'def' : 'atk'
    const charBase =
        statKey === 'hp'
            ? (charInfo?.lv90BaseStats.hp ?? 0)
            : statKey === 'def'
              ? (charInfo?.lv90BaseStats.def ?? 0)
              : (charInfo?.lv90BaseStats.atk ?? 0)
    const weaponBase = statKey === 'atk' ? (weaponInfo?.lv90BaseAtk ?? 0) : 0
    parts.push({
        sourceType: 'base',
        source: '角色',
        label: STAT_LABEL[kind].white,
        value: charBase,
        unit: 'flat',
        contribution: charBase
    })
    if (weaponBase > 0) {
        parts.push({
            sourceType: 'weapon',
            source: weaponName ?? '武器',
            label: STAT_LABEL[kind].white,
            value: weaponBase,
            unit: 'flat',
            contribution: weaponBase
        })
    }

    // 武器副词条
    const wSubName = weaponInfo?.substat?.name
    const wSubValueRaw = weaponInfo?.substat?.value ? parseFloat(weaponInfo.substat.value) : 0
    if (wSubName && wSubValueRaw !== 0) {
        const canon = WEAPON_SUBSTAT_NAME_MAP[wSubName] ?? wSubName
        const pct = canon === '攻击%' || canon === '生命%' || canon === '防御%'
        const value = pct && wSubValueRaw < 1 ? wSubValueRaw * 100 : wSubValueRaw
        if (isBaseStatLabel(kind, canon)) {
            const contrib = pct ? (value / 100) * baseWhite : value
            parts.push({
                sourceType: 'weapon',
                source: weaponName ?? '武器',
                label: '武器副词条',
                value,
                unit: pct ? '%' : 'flat',
                contribution: contrib
            })
        }
    }

    // 声骸主/副词条
    const echoes = charIdx >= 0 ? (ctx.configState.characters[charIdx]?.echoes ?? []) : []
    echoes.forEach((echo, ei) => {
        const src = `声骸${ei + 1}`
        const pushStat = (label: string, v: number) => {
            if (!isBaseStatLabel(kind, label)) return
            const pct = label.endsWith('%')
            const contrib = pct ? (v / 100) * baseWhite : v
            parts.push({
                sourceType: 'echo',
                source: src,
                label: label || '词条',
                value: v,
                unit: pct ? '%' : 'flat',
                contribution: contrib
            })
        }
        if (echo.mainStat) pushStat(echo.mainStat.type, echo.mainStat.value)
        if (echo.secondMainStat) pushStat(echo.secondMainStat.type, echo.secondMainStat.value)
        for (const sub of echo.substats) pushStat(sub.type, sub.value)
    })

    // 拉表Buff 攻击/生命/防御（引用按解算结果直接给数值，不再显示转模规则）
    const zoneFlat = kind === 'atk' ? 'atkFlat' : kind === 'hp' ? 'hpFlat' : 'defFlat'
    const zonePct = kind === 'atk' ? 'atkPct' : kind === 'hp' ? 'hpPct' : 'defPct'
    for (const bs of buffs) {
        bs.zones.forEach((z, zi) => {
            if (z.zoneId !== zoneFlat && z.zoneId !== zonePct) return
            if (!zoneConditionMet(z, zoneCtx)) return
            const value = z.ref ? (refValues.get(refKeyOf(bs.id, zi)) ?? 0) : z.value
            if (!z.ref && value === 0) return
            const pct = z.zoneId === zonePct
            const contrib = pct ? (value / 100) * baseWhite : value
            parts.push({
                sourceType: 'buff',
                source: bs.name,
                label: zoneLabelWithCondition(pct ? STAT_LABEL[kind].pct : STAT_LABEL[kind].flat, z.condition),
                value,
                unit: pct ? '%' : 'flat',
                contribution: contrib
            })
        })
    }

    // 若按来源贡献求和与面板总值仍有缺口（覆盖等无法逐条列出的写入），补一个「其它」占位
    // contribSum 含白值来源，故基准用面板总值 totalStat（而非已减白值的 green），避免多扣一个白值
    const contribSum = parts.reduce((s, p) => s + (p.contribution ?? 0), 0)
    const totalStat = kind === 'hp' ? entry.totalHp : kind === 'def' ? entry.totalDef : entry.totalAtk
    const gap = Math.round(totalStat) - Math.round(contribSum)
    if (Math.abs(gap) > 1) {
        parts.push({
            sourceType: 'panel',
            source: '其它',
            label: '覆盖等',
            value: gap,
            unit: 'flat',
            contribution: gap
        })
    }
    return parts
}

/** @desc 系数基类来源：偏谐系数 = 敌人类型系数；效应系数 = 效应基础值 */
function collectCoeffParts(baseUnit: string, coeff: number, ctx: DamageTraceCtx): TracePart[] {
    if (baseUnit.startsWith('偏谐系数')) {
        return [
            {
                sourceType: 'enemy',
                source: ctx.configState.enemy.type || '敌人',
                label: '偏谐系数',
                value: coeff,
                unit: 'flat',
                contribution: coeff
            }
        ]
    }
    if (baseUnit === '效应系数') {
        return [
            {
                sourceType: 'panel',
                source: '效应',
                label: '效应基础值',
                value: coeff,
                unit: 'flat',
                contribution: coeff
            }
        ]
    }
    return []
}

/** @desc 增伤区：拉表Buff 加成（含引用/覆盖）+ 声骸/武器 元素、类型加成（只列真正计入本条伤害的） */
function collectBonusParts(
    entry: ResultEntry,
    ctx: DamageTraceCtx,
    buffs: BuffSet[],
    zoneTrace: ZoneTraceCtx
): TracePart[] {
    const parts = buffZoneParts(buffs, 'bonusDmg', '加成', '%', zoneTrace)
    // 元素/类型加成只属于「面板基类（直伤）」的增伤区：系数基类（偏谐系数/效应系数）引擎不给增伤区
    // （computeTuneEntry / computeEffectEntry 的 dmgBonus 恒为 0），其词条一律不得出现在来源里
    if (isCoeffBase(entry.baseUnit)) return parts
    const charIdx = ctx.team.findIndex((s) => s.character === entry.character)
    const echoes = charIdx >= 0 ? (ctx.configState.characters[charIdx]?.echoes ?? []) : []
    const weaponName = charIdx >= 0 ? (ctx.team[charIdx]?.weapon ?? null) : null
    const weaponInfo = weaponName ? ctx.weaponInfoMap[weaponName] : null
    const pushElementType = (src: string, sourceType: TracePart['sourceType'], label: string, v: number) => {
        if (!bonusLabelApplies(label, entry)) return
        parts.push({ sourceType, source: src, label: `${label.replace('伤害加成', '')}加成`, value: v, unit: '%' })
    }
    if (weaponInfo?.substat) {
        const wv = parseFloat(String(weaponInfo.substat.value)) || 0
        const canon = WEAPON_SUBSTAT_NAME_MAP[weaponInfo.substat.name] ?? weaponInfo.substat.name
        if (wv !== 0) pushElementType(weaponName ?? '武器', 'weapon', canon, wv)
    }
    echoes.forEach((echo, ei) => {
        const src = `声骸${ei + 1}`
        const push = (label: string, v: number) => pushElementType(src, 'echo', label, v)
        if (echo.mainStat) push(echo.mainStat.type, echo.mainStat.value)
        if (echo.secondMainStat) push(echo.secondMainStat.type, echo.secondMainStat.value)
        for (const sub of echo.substats) push(sub.type, sub.value)
    })
    return parts
}

/** @desc 抗性/防御/免伤区：敌人面板输入 + 拉表Buff 穿透/降低（含引用/覆盖） */
function collectEnemyParts(
    entry: ResultEntry,
    ctx: DamageTraceCtx,
    buffs: BuffSet[],
    zone: string,
    zoneTrace: ZoneTraceCtx
): TracePart[] {
    const parts: TracePart[] = []
    const enemy = ctx.configState.enemy
    if (zone === 'res') {
        const base = (enemy.resistances[entry.element] ?? 0) / 100
        parts.push({
            sourceType: 'enemy',
            source: `敌人面板(${enemy.type})`,
            label: `基础抗性(${entry.element})`,
            value: base * 100,
            unit: '%'
        })
        parts.push(...buffZoneParts(buffs, 'resPen', '穿抗', '%', zoneTrace))
        parts.push(...buffZoneParts(buffs, 'resDown', '减抗', '%', zoneTrace))
    } else if (zone === 'def') {
        parts.push({
            sourceType: 'enemy',
            source: `敌人面板(${enemy.type})`,
            label: '敌人防御',
            value: enemy.defense,
            unit: 'flat'
        })
        parts.push(...buffZoneParts(buffs, 'defPen', '穿防', '%', zoneTrace))
        parts.push(...buffZoneParts(buffs, 'defDown', '减防', '%', zoneTrace))
    } else {
        parts.push({
            sourceType: 'enemy',
            source: `敌人面板(${enemy.type})`,
            label: '敌人免伤',
            value: enemy.dmgReduction,
            unit: '%'
        })
        parts.push(...buffZoneParts(buffs, 'dmgRedPen', '穿免', '%', zoneTrace))
    }
    return parts
}

/**
 * @desc 暴击区来源。
 *
 * - **面板基类（直伤）**：基础双暴 5% / 150%（角色面板）+ 声骸/武器词条双暴 + 拉表 Buff 双暴。
 * - **系数基类（`偏谐系数` / `效应系数`：处决/响应/效应/偏谐系数直伤）**：不吃角色面板双暴，
 *   基准 0% / 100%（「额外暴击伤害 +0%」），也不列声骸/武器词条 —— 只有绑定到本条的 Buff 参与。
 *   与 `compute.ts` 的 `critBase(fromPanel=false)` 必须保持一致，否则来源列表会与暴击区数值打架。
 */
function collectCritParts(
    entry: ResultEntry,
    ctx: DamageTraceCtx,
    buffs: BuffSet[],
    zoneTrace: ZoneTraceCtx
): TracePart[] {
    const parts: TracePart[] = []
    if (isCoeffBase(entry.baseUnit)) {
        parts.push({ sourceType: 'base', source: '系数基类', label: '暴击率基准', value: 0, unit: '%' })
        parts.push({ sourceType: 'base', source: '系数基类', label: '暴击伤害基准', value: 100, unit: '%' })
        parts.push(...buffZoneParts(buffs, 'critRate', '暴击率', '%', zoneTrace))
        parts.push(...buffZoneParts(buffs, 'critDmg', '暴击伤害', '%', zoneTrace))
        return parts
    }

    parts.push({ sourceType: 'base', source: '角色', label: '暴击率基础', value: 5, unit: '%' })
    parts.push({ sourceType: 'base', source: '角色', label: '暴击伤害基础', value: 150, unit: '%' })

    const charIdx = ctx.team.findIndex((s) => s.character === entry.character)
    const echoes = charIdx >= 0 ? (ctx.configState.characters[charIdx]?.echoes ?? []) : []
    const weaponName = charIdx >= 0 ? (ctx.team[charIdx]?.weapon ?? null) : null
    const weaponInfo = weaponName ? ctx.weaponInfoMap[weaponName] : null

    const pushStat = (sourceType: TracePart['sourceType'], source: string, label: string, v: number) => {
        if (label === '暴击率') parts.push({ sourceType, source, label: '暴击率', value: v, unit: '%' })
        else if (label === '暴击伤害') parts.push({ sourceType, source, label: '暴击伤害', value: v, unit: '%' })
    }
    if (weaponInfo?.substat) {
        const wv = parseFloat(String(weaponInfo.substat.value)) || 0
        const canon = WEAPON_SUBSTAT_NAME_MAP[weaponInfo.substat.name] ?? weaponInfo.substat.name
        if (wv !== 0) pushStat('weapon', weaponName ?? '武器', canon, wv)
    }
    echoes.forEach((echo, ei) => {
        const src = `声骸${ei + 1}`
        const push = (label: string, v: number) => pushStat('echo', src, label, v)
        if (echo.mainStat) push(echo.mainStat.type, echo.mainStat.value)
        if (echo.secondMainStat) push(echo.secondMainStat.type, echo.secondMainStat.value)
        for (const sub of echo.substats) push(sub.type, sub.value)
    })
    parts.push(...buffZoneParts(buffs, 'critRate', '暴击率', '%', zoneTrace))
    parts.push(...buffZoneParts(buffs, 'critDmg', '暴击伤害', '%', zoneTrace))
    return parts
}

/** @desc 特殊区：拉表Buff 特殊终伤（加算）与特殊终伤·乘算（连乘因子），含引用/覆盖来源（引用只给结果） */
function collectCustomParts(buffs: BuffSet[], { zoneCtx, refValues }: ZoneTraceCtx): TracePart[] {
    const adds: TracePart[] = []
    const overrides: TracePart[] = []
    const refs: TracePart[] = []
    for (const bs of buffs) {
        bs.zones.forEach((z, zi) => {
            const isMul = z.zoneId === 'specialFinal2'
            if (z.zoneId !== 'specialFinal1' && !isMul) return
            if (!zoneConditionMet(z, zoneCtx)) return
            const zoneLabel = zoneLabelWithCondition(isMul ? '特殊终伤(2)·乘算' : '特殊终伤(1)', z.condition)
            const extra = isMul ? { contribution: 1 + z.value / 100 } : {}
            if (z.ref) {
                const resolved = refValues.get(refKeyOf(bs.id, zi)) ?? 0
                refs.push({
                    sourceType: 'buff',
                    source: bs.name,
                    label: `${zoneLabel}(引用)`,
                    value: resolved,
                    unit: '%',
                    ...(isMul ? { contribution: 1 + resolved / 100 } : {})
                })
            } else if (z.override) {
                if (z.value === 0) return
                overrides.push({
                    sourceType: 'buff',
                    source: bs.name,
                    label: `${zoneLabel}(覆盖)`,
                    value: z.value,
                    unit: '%',
                    ...extra
                })
            } else if (z.value !== 0) {
                adds.push({
                    sourceType: 'buff',
                    source: bs.name,
                    label: zoneLabel,
                    value: z.value,
                    unit: '%',
                    ...extra
                })
            }
        })
    }
    return overrides.length > 0 ? overrides : [...adds, ...refs]
}

function seg(id: string, label: string, value: number, detail: string, parts: TracePart[]): DamageSegment {
    return { id, label, value, detail, parts }
}

/** @desc 把 ResultEntry 适配回 DamageEntry，复用 compute 的 getBoundBuffSets/conditionMet（同口径判定生效 Buff） */
function toDamageEntryLike(entry: ResultEntry): DamageEntry {
    return {
        id: entry.id,
        character: entry.character,
        skillType: entry.skillType,
        hitName: entry.hitName,
        displayName: entry.displayName,
        isEffect: entry.baseUnit === '效应系数',
        isTuneBreak: entry.baseUnit.startsWith('偏谐系数'),
        isTuneResponse: false,
        ratioValue: entry.ratioNum,
        ratioUnit: '%',
        damageBaseType: entry.baseUnit,
        damageElement: entry.element,
        sourceTimelineBlockId: entry.sourceTimelineBlockId,
        hits: entry.hits
    }
}

/** @desc 暴击展示口径：由调用方按「该条目是否被设为凹暴/不暴」传入（不要用数值反推——
 *  暴击率≥100% 时期望值天然等于全暴击值，反推会把「必暴」误判成「凹暴」模式） */
export type CritDisplayMode = 'expected' | 'rig' | 'noCrit'

/** @desc 将某伤害条目还原为分段：基础值拆分 + 各乘区段（含来源溯源），并给出 per-hit / 段数 汇总；
 *  missed 表示该条目被设为「未命中」（伤害归零）；critMode 表示该条目当前处于期望/凹暴/不暴哪一种口径 */
export function buildDamageSegments(
    entry: ResultEntry,
    ctx: DamageTraceCtx,
    missed = false,
    critMode: CritDisplayMode = 'expected'
): DamageSegments {
    const baseUnit = entry.baseUnit
    const kind = baseKindOf(baseUnit)
    const baseLabel = baseLabelOf(baseUnit)
    const isCoeff = isCoeffBase(baseUnit)

    // 系数基类：基础值来自系数（偏谐系数=敌人系数、效应系数=效应基础值）；面板基类：白值+绿值
    let baseWhite = 0
    let totalStat = 0
    let baseGreen = 0
    let baseParts: TracePart[] = []
    if (isCoeff) {
        const coeff = entry.baseAtk
        baseWhite = coeff
        totalStat = coeff
        baseParts = collectCoeffParts(baseUnit, coeff, ctx)
    } else {
        baseWhite = kind === 'hp' ? entry.baseHp : kind === 'def' ? entry.baseDef : entry.baseAtk
        totalStat = kind === 'hp' ? entry.totalHp : kind === 'def' ? entry.totalDef : entry.totalAtk
        baseGreen = totalStat - baseWhite
    }

    const charIdx = ctx.team.findIndex((s) => s.character === entry.character)
    const entryLike = toDamageEntryLike(entry)
    const echoDescByEntry = buildEchoDescByEntry([entryLike], ctx.team, getEchoSkillText())
    const buffs = getBoundBuffSets(
        entryLike,
        charIdx,
        ctx.buffSets,
        ctx.damageEntryBuffSetIds,
        ctx.damageEntryDamageTypes,
        ctx.conditionProfile,
        ctx.charInfoMap,
        echoDescByEntry
    )
    /** @desc 目标侧乘区的来源（集谐·干涉层数）：不做作用域过滤，来源可能挂在别的角色身上 */
    const targetSideBuffs = getTargetSideSourceBuffs(
        entryLike,
        ctx.buffSets,
        ctx.damageEntryBuffSetIds,
        ctx.damageEntryDamageTypes,
        ctx.conditionProfile,
        ctx.charInfoMap,
        echoDescByEntry
    )
    /**
     * @desc 乘区来源的判定上下文：条件判据（与引擎同口径）+ 引用的解算结果（`resolveRefZoneValues`）。
     * 引用一次算好、各区共用 —— 解算与「引擎写进乘区的数值」逐值一致，溯源因此可以直接展示结果值。
     * 没有引用乘区时跳过解算（解算要重建一次本条目可见面板，展开行时才做，能省则省）。
     */
    const hasRefZones = buffs.some((bs) => bs.zones.some((z) => z.ref))
    const zoneTrace: ZoneTraceCtx = {
        zoneCtx: zoneCtxOf(entryLike, ctx, echoDescByEntry),
        refValues: hasRefZones ? resolveRefZoneValues(entryLike, ctx) : new Map<string, number>()
    }

    const segments: DamageSegment[] = []

    // 加深
    segments.push(
        seg(
            'deepen',
            '加深区',
            1 + entry.deepen,
            `(1 + ${fmtPercent(entry.deepen * 100)})`,
            buffZoneParts(buffs, 'deepenDmg', '加深', '%', zoneTrace)
        )
    )
    // 增伤（面板/元素/类型）
    const bonusParts = collectBonusParts(entry, ctx, buffs, zoneTrace)
    segments.push(seg('bonus', '增伤区', 1 + entry.dmgBonus, `(1 + ${fmtPercent(entry.dmgBonus * 100)})`, bonusParts))
    // 易伤
    segments.push(
        seg(
            'vuln',
            '易伤区',
            1 + entry.vulnerability,
            `(1 + ${fmtPercent(entry.vulnerability * 100)})`,
            buffZoneParts(buffs, 'dmgTakenInc', '易伤', '%', zoneTrace)
        )
    )
    // 抗性（敌人 + 穿/减）
    segments.push(
        seg(
            'res',
            '抗性区',
            entry.resMulti,
            entry.resMulti.toFixed(4),
            collectEnemyParts(entry, ctx, buffs, 'res', zoneTrace)
        )
    )
    // 防御（敌人 + 穿/减）
    segments.push(
        seg(
            'def',
            '防御区',
            entry.defMulti,
            entry.defMulti.toFixed(4),
            collectEnemyParts(entry, ctx, buffs, 'def', zoneTrace)
        )
    )
    // 免伤
    segments.push(
        seg(
            'dmgRed',
            '免伤区',
            entry.dmgRedMulti,
            entry.dmgRedMulti.toFixed(4),
            collectEnemyParts(entry, ctx, buffs, 'dmgRed', zoneTrace)
        )
    )
    // 集谐（集谐直伤 = 1+干涉层数；偏谐系数 = 谐度破坏增幅；效应系数 = 1）
    const tuneDelta = entry.finalTuneStrainMulti + entry.finalTuneBreakZone
    // 集谐·干涉层数挂在目标身上、全队一份：来源可能指向别的角色，按目标侧口径取（不做作用域过滤）
    const tuneParts = buffZoneParts(targetSideBuffs, 'tuneStrainLayer', '集谐层数', 'flat', zoneTrace)
    tuneParts.push(...buffZoneParts(buffs, 'tuneBreakBoost', '谐度破坏增幅', 'flat', zoneTrace))
    segments.push(seg('tune', '集谐区', 1 + tuneDelta, `(1 + ${(tuneDelta * 100).toFixed(2)}%)`, tuneParts))
    // 同奏（同奏区 = 1 + 3%×同奏增益层数，直伤/效应/处决响应全生效）
    const unisonParts = buffZoneParts(buffs, 'unisonBoonLayer', '同奏层数', 'flat', zoneTrace)
    segments.push(
        seg(
            'unison',
            '同奏区',
            1 + entry.finalUnisonMulti,
            `(1 + ${(entry.finalUnisonMulti * 100).toFixed(1)}%)`,
            unisonParts
        )
    )
    // 终伤
    segments.push(
        seg(
            'finalDmg',
            '终伤区',
            1 + entry.finalDmg,
            `(1 + ${fmtPercent(entry.finalDmg * 100)})`,
            buffZoneParts(buffs, 'finalDmg', '终伤', '%', zoneTrace)
        )
    )
    // 特殊区
    segments.push(
        seg('custom', '特殊区', entry.customMult, entry.customMult.toFixed(4), collectCustomParts(buffs, zoneTrace))
    )
    // 暴击
    // 暴击段的有效乘子按展示模式取值，保证 基础×各区×暴击 = 条目期望：
    //   普通 = 1 + 暴击率×(暴击伤害-1)；凹暴 = 暴击伤害；不暴 = 1；未命中 = 常规公式（由「未命中」段归零）
    let critSegment: DamageSegment | null = null
    if (entry.canCrit) {
        const critAvg = 1 + entry.critRate * (entry.critDmg - 1)
        const preCrit = entry.nonCritPerHit
        // 模式来自调用方传入的勾选状态；暴击率≥100%（或≤0）时只是「数学上必暴/必不暴」，不等于选了凹暴/不暴模式
        const rigged = !missed && critMode === 'rig'
        const noCrit = !missed && critMode === 'noCrit'
        const critPct = (entry.critRate * 100).toFixed(1)
        const effective = missed || preCrit <= 0 ? critAvg : entry.expectedPerHit / preCrit
        const detail = rigged
            ? '全暴击（凹暴）'
            : noCrit
              ? '不暴击'
              : entry.critRate >= 1
                ? `暴击率 ${critPct}%（必暴）`
                : entry.critRate <= 0
                  ? `暴击率 ${critPct}%（必不暴击）`
                  : `(1 + ${critPct}% × ${((entry.critDmg - 1) * 100).toFixed(1)}%)`
        critSegment = seg('crit', '暴击区', effective, detail, collectCritParts(entry, ctx, buffs, zoneTrace))
    }

    const ratioPct = (entry.ratioNum / (entry.hits || 1)) * 100
    const extraRatioPct = entry.extraRatio
    // 系数类 ratioNum 即有效倍率（已含额外倍率与段数），直伤为纯基础倍率
    const ratioIncludesExtra = isCoeff
    // 额外倍率 buff 来源（引用型 buff 直接给解算结果）
    const extraRatioParts = buffZoneParts(buffs, 'extraRatio', '额外倍率', '%', zoneTrace)
    // 面板基类在此收集来源（需 buffs）；系数基类在顶部已填
    if (!isCoeff) baseParts = collectBaseParts(kind, baseWhite, entry, ctx, buffs, zoneTrace)

    const allSegments = [...segments]
    if (critSegment) allSegments.push(critSegment)
    // 未命中：末尾追加 ×0 段，使 基础×各区×未命中 = 0
    if (missed) allSegments.push(seg('miss', '未命中', 0, '未命中（该段伤害归零）', []))

    return {
        baseUnit,
        baseLabel,
        isCoeff,
        baseWhite,
        baseGreen,
        totalStat,
        ratioPct,
        extraRatioPct,
        ratioIncludesExtra,
        extraRatioParts,
        hits: entry.hits || 1,
        baseValue: entry.baseValue,
        baseParts,
        segments: allSegments,
        canCrit: entry.canCrit,
        preCrit: entry.nonCritPerHit,
        crit: entry.critPerHit,
        nonCrit: entry.nonCritPerHit,
        expected: entry.expectedPerHit,
        perHit: (entry.expectedPerHit || 0) / (entry.hits || 1)
    }
}
