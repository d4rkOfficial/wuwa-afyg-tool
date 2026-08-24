import type { ResultEntry } from './result.types'
import type { BuffSet, DamageEntry } from './calculation.types'
import type { ConfigState } from './config.types'
import type { CharSlot } from '$lib/types/project'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import { getBoundBuffSets, type ConditionProfile } from './compute'
import { WEAPON_SUBSTAT_NAME_MAP } from '$lib/consts/game-terms'

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
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

// ── 来源收集 ──

/** @desc 拉表Buff：指定 zoneId 的加值列表（普通值；ref/override 归入「引用/覆盖」由上层说明） */
function buffZoneParts(buffs: BuffSet[], zoneId: string, label: string): TracePart[] {
    const out: TracePart[] = []
    for (const bs of buffs) {
        for (const z of bs.zones) {
            if (z.zoneId !== zoneId || z.value === 0) continue
            out.push({ sourceType: 'buff', source: bs.name, label, value: z.value, unit: '%' })
        }
    }
    return out
}

/** @desc 某伤害类型的类型/元素加成标签命中（Echo 词条 label） */
function isElementBonusLabel(label: string): boolean {
    return /伤害加成$/.test(label) && !['普攻', '重击', '共鸣技能', '共鸣解放'].some((t) => label.startsWith(t))
}
function isTypeBonusLabel(label: string): boolean {
    return ['普攻', '重击', '共鸣技能', '共鸣解放'].some((t) => label.startsWith(t)) && label.endsWith('伤害加成')
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
    buffs: BuffSet[]
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

    // 拉表Buff 攻击/生命/防御
    const zoneFlat = kind === 'atk' ? 'atkFlat' : kind === 'hp' ? 'hpFlat' : 'defFlat'
    const zonePct = kind === 'atk' ? 'atkPct' : kind === 'hp' ? 'hpPct' : 'defPct'
    for (const bs of buffs) {
        for (const z of bs.zones) {
            if ((z.zoneId !== zoneFlat && z.zoneId !== zonePct) || z.value === 0) continue
            const pct = z.zoneId === zonePct
            const contrib = pct ? (z.value / 100) * baseWhite : z.value
            parts.push({
                sourceType: 'buff',
                source: bs.name,
                label: pct ? STAT_LABEL[kind].pct : STAT_LABEL[kind].flat,
                value: z.value,
                unit: pct ? '%' : 'flat',
                contribution: contrib
            })
        }
    }

    // 若按来源贡献求和与面板总值有缺口（引用/覆盖乘区等），补一个「其它」占位
    // contribSum 含白值来源，故基准用面板总值 totalStat（而非已减白值的 green），避免多扣一个白值
    const contribSum = parts.reduce((s, p) => s + (p.contribution ?? 0), 0)
    const totalStat = kind === 'hp' ? entry.totalHp : kind === 'def' ? entry.totalDef : entry.totalAtk
    const gap = Math.round(totalStat) - Math.round(contribSum)
    if (Math.abs(gap) > 1) {
        parts.push({
            sourceType: 'panel',
            source: '其它',
            label: '引用/覆盖等',
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

/** @desc 增伤区：拉表Buff 加成 + 声骸/武器 元素、类型加成 */
function collectBonusParts(entry: ResultEntry, ctx: DamageTraceCtx, buffs: BuffSet[]): TracePart[] {
    const parts: TracePart[] = []
    for (const bs of buffs) {
        for (const z of bs.zones) {
            if (z.zoneId !== 'bonusDmg' || z.value === 0) continue
            parts.push({ sourceType: 'buff', source: bs.name, label: '加成', value: z.value, unit: '%' })
        }
    }
    const charIdx = ctx.team.findIndex((s) => s.character === entry.character)
    const echoes = charIdx >= 0 ? (ctx.configState.characters[charIdx]?.echoes ?? []) : []
    const weaponName = charIdx >= 0 ? (ctx.team[charIdx]?.weapon ?? null) : null
    const weaponInfo = weaponName ? ctx.weaponInfoMap[weaponName] : null
    const pushElementType = (src: string, sourceType: TracePart['sourceType'], label: string, v: number) => {
        if (isElementBonusLabel(label)) {
            parts.push({ sourceType, source: src, label: `${label.replace('伤害加成', '')}加成`, value: v, unit: '%' })
        } else if (isTypeBonusLabel(label)) {
            parts.push({ sourceType, source: src, label: `${label.replace('伤害加成', '')}加成`, value: v, unit: '%' })
        }
    }
    if (weaponInfo?.substat) {
        const wv = parseFloat(String(weaponInfo.substat.value)) || 0
        const canon = WEAPON_SUBSTAT_NAME_MAP[weaponInfo.substat.name] ?? weaponInfo.substat.name
        if (wv !== 0) pushElementType(weaponName ?? '武器', 'weapon', canon, wv)
    }
    echoes.forEach((echo, ei) => {
        const src = `声骸${ei + 1}`
        const push = (label: string, v: number) => {
            if (isElementBonusLabel(label) || isTypeBonusLabel(label)) pushElementType(src, 'echo', label, v)
        }
        if (echo.mainStat) push(echo.mainStat.type, echo.mainStat.value)
        if (echo.secondMainStat) push(echo.secondMainStat.type, echo.secondMainStat.value)
        for (const sub of echo.substats) push(sub.type, sub.value)
    })
    return parts
}

/** @desc 抗性/防御/免伤区：敌人面板输入 + 拉表Buff 穿透/降低 */
function collectEnemyParts(entry: ResultEntry, ctx: DamageTraceCtx, buffs: BuffSet[], zone: string): TracePart[] {
    const parts: TracePart[] = []
    const enemy = ctx.configState.enemy
    const pushBuff = (zoneId: string, label: string) => {
        for (const bs of buffs) {
            for (const z of bs.zones) {
                if (z.zoneId !== zoneId || z.value === 0) continue
                parts.push({ sourceType: 'buff', source: bs.name, label, value: z.value, unit: '%' })
            }
        }
    }
    if (zone === 'res') {
        const base = (enemy.resistances[entry.element] ?? 0) / 100
        parts.push({
            sourceType: 'enemy',
            source: `敌人面板(${enemy.type})`,
            label: `基础抗性(${entry.element})`,
            value: base * 100,
            unit: '%'
        })
        pushBuff('resPen', '穿抗')
        pushBuff('resDown', '减抗')
    } else if (zone === 'def') {
        parts.push({
            sourceType: 'enemy',
            source: `敌人面板(${enemy.type})`,
            label: '敌人防御',
            value: enemy.defense,
            unit: 'flat'
        })
        pushBuff('defPen', '穿防')
        pushBuff('defDown', '减防')
    } else {
        parts.push({
            sourceType: 'enemy',
            source: `敌人面板(${enemy.type})`,
            label: '敌人免伤',
            value: enemy.dmgReduction,
            unit: '%'
        })
        pushBuff('dmgRedPen', '穿免')
    }
    return parts
}

/** @desc 暴击区：基础双暴 + 声骸/武器/拉表Buff 双暴 */
function collectCritParts(entry: ResultEntry, ctx: DamageTraceCtx, buffs: BuffSet[]): TracePart[] {
    const parts: TracePart[] = []
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
    for (const bs of buffs) {
        for (const z of bs.zones) {
            if (z.zoneId === 'critRate')
                parts.push({ sourceType: 'buff', source: bs.name, label: '暴击率', value: z.value, unit: '%' })
            else if (z.zoneId === 'critDmg')
                parts.push({ sourceType: 'buff', source: bs.name, label: '暴击伤害', value: z.value, unit: '%' })
        }
    }
    return parts
}

/** @desc 特殊区：拉表Buff 特殊终伤（加算）与特殊终伤·乘算（连乘因子） */
function collectCustomParts(buffs: BuffSet[]): TracePart[] {
    const parts: TracePart[] = []
    for (const bs of buffs) {
        for (const z of bs.zones) {
            if (z.value === 0) continue
            if (z.zoneId === 'customFinalDmg') {
                parts.push({ sourceType: 'buff', source: bs.name, label: '特殊终伤(加算)', value: z.value, unit: '%' })
            } else if (z.zoneId === 'customFinalDmgMul') {
                parts.push({
                    sourceType: 'buff',
                    source: bs.name,
                    label: '特殊终伤(乘算)',
                    value: z.value,
                    unit: '%',
                    contribution: 1 + z.value / 100
                })
            }
        }
    }
    return parts
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

/** @desc 将某伤害条目还原为分段：基础值拆分 + 各乘区段（含来源溯源），并给出 per-hit / 段数 汇总；missed 表示该条目被设为「未命中」（伤害归零） */
export function buildDamageSegments(entry: ResultEntry, ctx: DamageTraceCtx, missed = false): DamageSegments {
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
    const buffs = getBoundBuffSets(
        toDamageEntryLike(entry),
        charIdx,
        ctx.buffSets,
        ctx.damageEntryBuffSetIds,
        ctx.damageEntryDamageTypes,
        ctx.conditionProfile
    )

    const segments: DamageSegment[] = []

    // 加深
    segments.push(
        seg(
            'deepen',
            '加深区',
            1 + entry.deepen,
            `(1 + ${fmtPercent(entry.deepen * 100)})`,
            buffZoneParts(buffs, 'deepenDmg', '加深')
        )
    )
    // 增伤（面板/元素/类型）
    const bonusParts = collectBonusParts(entry, ctx, buffs)
    segments.push(seg('bonus', '增伤区', 1 + entry.dmgBonus, `(1 + ${fmtPercent(entry.dmgBonus * 100)})`, bonusParts))
    // 易伤
    segments.push(
        seg(
            'vuln',
            '易伤区',
            1 + entry.vulnerability,
            `(1 + ${fmtPercent(entry.vulnerability * 100)})`,
            buffZoneParts(buffs, 'dmgTakenInc', '易伤')
        )
    )
    // 抗性（敌人 + 穿/减）
    segments.push(
        seg('res', '抗性区', entry.resMulti, entry.resMulti.toFixed(4), collectEnemyParts(entry, ctx, buffs, 'res'))
    )
    // 防御（敌人 + 穿/减）
    segments.push(
        seg('def', '防御区', entry.defMulti, entry.defMulti.toFixed(4), collectEnemyParts(entry, ctx, buffs, 'def'))
    )
    // 免伤
    segments.push(
        seg(
            'dmgRed',
            '免伤区',
            entry.dmgRedMulti,
            entry.dmgRedMulti.toFixed(4),
            collectEnemyParts(entry, ctx, buffs, 'dmgRed')
        )
    )
    // 集谐（集谐直伤 = 1+干涉层数；偏谐系数 = 谐度破坏增幅；效应系数 = 1）
    const tuneDelta = entry.finalTuneStrainMulti + entry.finalTuneBreakZone
    const tuneParts = buffZoneParts(buffs, 'tuneStrainLayer', '集谐层数').map((p) => ({ ...p, unit: 'flat' as const }))
    tuneParts.push(
        ...buffZoneParts(buffs, 'tuneBreakBoost', '谐度破坏增幅').map((p) => ({ ...p, unit: 'flat' as const }))
    )
    segments.push(seg('tune', '集谐区', 1 + tuneDelta, `(1 + ${(tuneDelta * 100).toFixed(2)}%)`, tuneParts))
    // 终伤
    segments.push(
        seg(
            'finalDmg',
            '终伤区',
            1 + entry.finalDmg,
            `(1 + ${fmtPercent(entry.finalDmg * 100)})`,
            buffZoneParts(buffs, 'finalDmg', '终伤')
        )
    )
    // 特殊区
    segments.push(seg('custom', '特殊区', entry.customMult, entry.customMult.toFixed(4), collectCustomParts(buffs)))
    // 暴击
    // 暴击段的有效乘子按展示模式取值，保证 基础×各区×暴击 = 条目期望：
    //   普通 = 1 + 暴击率×(暴击伤害-1)；凹暴 = 暴击伤害；不暴 = 1；未命中 = 常规公式（由「未命中」段归零）
    let critSegment: DamageSegment | null = null
    if (entry.canCrit) {
        const critAvg = 1 + entry.critRate * (entry.critDmg - 1)
        const preCrit = entry.nonCritPerHit
        const rigged = !missed && Math.abs(entry.expectedPerHit - entry.critPerHit) < 0.5
        const noCrit = !missed && Math.abs(entry.expectedPerHit - entry.nonCritPerHit) < 0.5
        const effective = missed || preCrit <= 0 ? critAvg : entry.expectedPerHit / preCrit
        const detail = rigged
            ? '全暴击（凹暴）'
            : noCrit
              ? '不暴击'
              : `(1 + ${(entry.critRate * 100).toFixed(1)}% × ${((entry.critDmg - 1) * 100).toFixed(1)}%)`
        critSegment = seg('crit', '暴击区', effective, detail, collectCritParts(entry, ctx, buffs))
    }

    const ratioPct = (entry.ratioNum / (entry.hits || 1)) * 100
    const extraRatioPct = entry.extraRatio
    // 系数类 ratioNum 即有效倍率（已含额外倍率与段数），直伤为纯基础倍率
    const ratioIncludesExtra = isCoeff
    // 面板基类在此收集来源（需 buffs）；系数基类在顶部已填
    if (!isCoeff) baseParts = collectBaseParts(kind, baseWhite, entry, ctx, buffs)

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
