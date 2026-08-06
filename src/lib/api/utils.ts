import { ASSET_BASE } from './consts'
import { ELEMENT_MAP, WEAPON_TYPE_MAP, COST_MAP } from '$lib/consts/game-terms'
import type {
    Character,
    Weapon,
    Echo,
    EchoSetItem,
    CharacterInfo,
    SkillEntry,
    StatNode,
    ResonanceChain,
    WeaponInfo,
    EchoInfo,
    EchoSetInfo,
    ZhCharacterDetail,
    ZhWeaponDetail,
    ZhEchoDetail,
    ZhSonataDetail,
    NanokaCharacter,
    NanokaWeapon,
    NanokaEcho,
    NanokaSonata
} from './types'

// ── Helpers ──

export function ueToCdn(path: string): string {
    if (!path) return ''
    const stripped = path.replace('/Game/Aki/UI', '')
    const name = stripped.split('.')[0]
    return `${ASSET_BASE}${name}.webp`
}

export function findEntryByName<T extends { zh: string }>(data: Record<string, T>, name: string): [string, T] | null {
    for (const [key, entry] of Object.entries(data)) {
        if (entry.zh === name) return [key, entry]
    }
    return null
}

export function findSonataSetEntry(data: ZhSonataDetail, name: string): [string, ZhSonataDetail[string]] | null {
    for (const [key, entry] of Object.entries(data)) {
        if (entry.name === name) return [key, entry]
    }
    return null
}

function strip(html: string): string {
    return html
        .replace(/<color=\w+>/gi, '')
        .replace(/<\/color>/gi, '')
        .replace(/<size=\d+>/gi, '')
        .replace(/<\/size>/gi, '')
        .replace(/<te href=\d+>/gi, '')
        .replace(/<\/te>/gi, '')
        .replace(/<highlight>/gi, '')
        .replace(/<\/highlight>/gi, '')
}

function interpolate(text: string, params: string[]): string {
    if (!text || !params.length) return text
    return text.replace(/\{(\d+)\}/g, (_, i) => params[Number(i)] ?? `{${i}}`)
}

function makeSkillValues(
    skill: ZhCharacterDetail['skill_trees'][string]['skill']
): [name: string, value: string, element: string, energy?: string, tune?: string][] {
    if (!skill.level) return []
    const keys = Object.keys(skill.level)
        .map(Number)
        .filter((k) => !isNaN(k))
    if (keys.length === 0) return []
    const sorted = keys.sort((a, b) => a - b)
    const result: [string, string, string, string?, string?][] = []

    for (const lvKey of sorted) {
        const lvData = skill.level[String(lvKey)]
        if (!lvData) continue
        const row = lvData.param[0]
        if (!row || row.length === 0) continue
        const idx = Math.min(row.length - 1, 9)
        const raw = row[idx]
        const fmt = lvData.format as string | null | undefined
        const value = fmt ? fmt.replace('{0}', raw) : raw

        let element = ''
        let energy: string | undefined
        let tune: string | undefined
        const damage = skill.damage
        if (damage) {
            const mRaw = raw.match(/^([\d.]+)%(?:\*(\d+))?/)
            const pct = mRaw ? parseFloat(mRaw[1]) : NaN
            const mult = mRaw && mRaw[2] ? parseInt(mRaw[2], 10) : 1
            if (!isNaN(pct)) {
                const target = Math.round(pct * 100)
                // 命中一段：同段 = damage key 去掉末 2 位后前缀相同的全部条目（段内多 hit）
                let matchedKey: string | null = null
                let extraHits = 1
                for (const dk of Object.keys(damage)) {
                    const dv = damage[dk]
                    if (dv.rate_lv && dv.rate_lv[idx] === target) {
                        matchedKey = dk
                        break
                    }
                }
                // 兼容聚合倍率（如共鸣回路 100.00% = 4×25.00%）：行参数是聚合值而 rate_lv 是单段值，
                // 精确匹配不到时按倍数回退（k = target / rate_lv[idx] ∈ [2,10]，取倍数最小的单段值），
                // 允许 ±0.10% 容差以吸收上游聚合值的四舍五入（如 198.81% ≈ 49.71%×4）
                if (!matchedKey) {
                    for (const dk of Object.keys(damage)) {
                        const dv = damage[dk]
                        const rate = dv.rate_lv?.[idx] ?? 0
                        if (rate <= 0) continue
                        const kf = target / rate
                        const k = Math.round(kf)
                        if (k < 2 || k > 10) continue
                        const diff = Math.abs(target - rate * k)
                        if (diff <= 10 && (!matchedKey || k < extraHits)) {
                            matchedKey = dk
                            extraHits = k
                        }
                    }
                }
                // 不可靠估算：聚合值还含无法拆分的成分（如「每点焰光」加成）时，
                // 取倍率最接近的单段值，按实际倍率比（可为小数）比例估算能量/偏谐
                let isEstimate = false
                if (!matchedKey) {
                    let bestKey: string | null = null
                    let bestDiff = Infinity
                    for (const dk of Object.keys(damage)) {
                        const dv = damage[dk]
                        const rate = dv.rate_lv?.[idx] ?? 0
                        if (rate <= 0) continue
                        const kf = target / rate
                        const k = Math.round(kf)
                        if (k < 1 || k > 10) continue
                        const diff = Math.abs(target - rate * k)
                        if (diff < bestDiff) {
                            bestDiff = diff
                            bestKey = dk
                        }
                    }
                    if (bestKey && bestDiff <= target * 0.15) {
                        matchedKey = bestKey
                        extraHits = target / (damage[bestKey].rate_lv?.[idx] ?? 1)
                        isEstimate = true
                    }
                }
                if (matchedKey) {
                    const prefix = matchedKey.slice(0, -2)
                    const group = Object.values(damage).filter((_, i) => Object.keys(damage)[i].slice(0, -2) === prefix)
                    // 精确命中取组内首个（同段多 hit）；聚合/估算路径直接取命中 key 自身的数据
                    const first = isEstimate || extraHits > 1 ? damage[matchedKey] : (group[0] ?? damage[matchedKey])
                    element = ELEMENT_MAP[first.element] ?? ''
                    const hitFactor = mult * extraHits
                    if (isEstimate) {
                        // 估算值：单段能量/偏谐 × 实际倍率比，四舍五入到两位
                        if (typeof first.energy === 'number') {
                            energy = ((first.energy / 100) * hitFactor).toFixed(2)
                        }
                        if (typeof first.weakness_lvl === 'number') {
                            tune = ((first.weakness_lvl / 100) * hitFactor).toFixed(2)
                        }
                    } else {
                        // 倍率多段（如 48.17%*4）或聚合倍率（如 100.00% = 4hit）时能量/偏谐同样按 hit 数乘，与倍率语义一致
                        if (typeof first.energy === 'number') {
                            const e = first.energy / 100
                            energy = hitFactor > 1 ? `${e}*${hitFactor}` : String(e)
                        }
                        if (typeof first.weakness_lvl === 'number') {
                            const t = first.weakness_lvl / 100
                            tune = hitFactor > 1 ? `${t}*${hitFactor}` : String(t)
                        }
                    }
                } else {
                    // 兜底：仍匹配不到时取技能内首个伤害条目的元素（同技能内伤害属性一致），能量/偏谐留空
                    const first = Object.values(damage)[0]
                    if (first) element = ELEMENT_MAP[first.element] ?? ''
                }
            }
        }

        result.push([lvData.name, value, element, energy, tune])
    }
    return result
}

// ── List transforms ──

export const transformCharacterList = (data: Record<string, NanokaCharacter>): Character[] => {
    const seen = new Set<string>()
    return Object.values(data)
        .filter((c) => c.zh && !seen.has(c.zh) && seen.add(c.zh))
        .map((c) => ({
            name: c.zh,
            star: c.rank,
            element: ELEMENT_MAP[c.element] ?? '',
            weaponType: WEAPON_TYPE_MAP[c.weapon] ?? ''
        }))
}

export const transformWeaponList = (data: Record<string, NanokaWeapon>): Weapon[] =>
    Object.values(data)
        .filter((w) => w.zh)
        .map((w) => ({
            name: w.zh,
            star: w.rank,
            weaponType: WEAPON_TYPE_MAP[w.type] ?? ''
        }))

export const transformEchoList = (data: Record<string, NanokaEcho>, sonata: NanokaSonata): Echo[] => {
    const seen = new Set<string>()
    return Object.values(data)
        .filter((e) => e.zh && !seen.has(e.zh) && seen.add(e.zh))
        .map((e) => ({
            name: e.zh,
            sets: e.group.map((gid) => sonata[String(gid)]?.name?.zh ?? '').filter(Boolean),
            cost: COST_MAP[e.intensity] ?? 1
        }))
}

export const transformEchoSetList = (sonata: NanokaSonata): EchoSetItem[] =>
    Object.values(sonata)
        .filter((s) => s.name?.zh)
        .map((s) => ({
            name: s.name.zh,
            pieces: Object.keys(s.set)
                .map(Number)
                .sort((a, b) => a - b)
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

// ── Preprocess skill entries (shared between transforms) ──

function preprocessSkills(skills: SkillEntry[], elementName: string) {
    for (const skill of skills) {
        for (const v of skill.values) {
            const [name] = v
            if (skill.type === '共鸣技能' && name === '技能伤害') v[0] = '共鸣技能伤害'
            else if (skill.type === '变奏技能' && name === '技能伤害') v[0] = '变奏技能伤害'
            else if (skill.type === '共鸣解放' && name === '技能伤害') v[0] = '共鸣解放伤害'
            else if (skill.type === '延奏技能' && name === '技能伤害') v[0] = '延奏技能伤害'
            else if (skill.type === '常态攻击') {
                const m = name.match(/^第(\d+)段(伤害)?$/)
                if (m) v[0] = `常态攻击第${m[1]}段伤害`
            }
            if (skill.type === '延奏技能' && !v[2] && elementName) v[2] = elementName
        }
        if (skill.type === '延奏技能' && elementName) {
            const hasElement = skill.values.some(([, , el]) => el)
            if (!hasElement) {
                const causeIdx = skill.desc.indexOf('造成')
                const dmgIdx = skill.desc.indexOf('伤害', causeIdx + 1)
                if (causeIdx >= 0 && dmgIdx > causeIdx) {
                    const between = skill.desc.slice(causeIdx + 2, dmgIdx)
                    const ratioMatch = between.match(/[\d+%.]+/)
                    if (ratioMatch) {
                        const ratioPart = ratioMatch[0]
                        const after = between.slice(ratioMatch.index! + ratioPart.length)
                        const unitMatch = after.match(/^(攻击|生命|防御|偏谐系数)/)
                        const unit = unitMatch ? unitMatch[1] : ''
                        const finalValue = ratioPart + (unit === '攻击' ? '' : unit)
                        const foundElement = between.match(/物理|冷凝|热熔|导电|气动|衍射|湮灭/)
                        const el = foundElement ? foundElement[0] : elementName
                        skill.values.push(['延奏技能伤害', finalValue, el, undefined, undefined])
                    }
                }
            }
        }
    }
}

// ── Info transforms ──

export function transformCharacterInfo(data: ZhCharacterDetail): CharacterInfo {
    let baseStats: { hp: number; atk: number; def: number; tuneBreakBoost: number } = {
        hp: 0,
        atk: 0,
        def: 0,
        tuneBreakBoost: 0
    }
    for (const ascStr of Object.keys(data.stats)) {
        const asc = Number(ascStr)
        const levelMap = data.stats[ascStr]
        for (const lvStr of Object.keys(levelMap)) {
            const lv = Number(lvStr)
            if (lv === 90 && asc === 6) {
                baseStats = {
                    hp: levelMap[lvStr].life,
                    atk: levelMap[lvStr].atk,
                    def: levelMap[lvStr].def,
                    tuneBreakBoost: 0
                }
            }
        }
    }

    const skills: SkillEntry[] = []
    const statNodes: StatNode[] = []
    const elementName = (ELEMENT_MAP[data.element] ?? '') as '冷凝' | '热熔' | '导电' | '气动' | '衍射' | '湮灭'
    const hasTune = Object.values(data.tag ?? {}).some(
        (t) => t.name === '震谐响应' || t.name === '集谐响应' || t.name === '骇破响应'
    )
    baseStats.tuneBreakBoost = hasTune ? 10 : 0

    for (const node of Object.values(data.skill_trees)) {
        const s = node.skill
        const nt = node.node_type
        const st = s.type ?? ''

        if (nt === 1 || nt === 2) {
            skills.push({
                name: s.name ?? '',
                type: st as SkillEntry['type'],
                desc: strip(interpolate(s.desc ?? '', s.param ?? [])),
                values: makeSkillValues(s)
            })
        } else if (nt === 3 && (st === '延奏技能' || st === '谐度破坏')) {
            skills.push({
                name: s.name ?? '',
                type: st as SkillEntry['type'],
                desc: strip(interpolate(s.desc ?? '', s.param ?? [])),
                values: makeSkillValues(s)
            })
        } else {
            const sd = s.desc ?? ''
            statNodes.push({
                name: s.name ?? '',
                desc: sd ? strip(interpolate(sd, s.param ?? [])) : ''
            })
        }
    }

    preprocessSkills(skills, elementName)

    const chains: ResonanceChain[] = Object.entries(data.chains ?? {}).map(([, c]) => ({
        name: c.name,
        desc: strip(interpolate(c.desc, c.param ?? []))
    }))

    return {
        rarity: data.rarity as 4 | 5,
        element: elementName,
        weaponType: (WEAPON_TYPE_MAP[data.weapon] ?? '') as '长刃' | '迅刀' | '佩枪' | '臂铠' | '音感仪',
        lv90BaseStats: baseStats,
        skills,
        statNodes,
        chains
    }
}

export function transformCharacterInfoRich(data: ZhCharacterDetail): CharacterInfo {
    let baseStats: { hp: number; atk: number; def: number; tuneBreakBoost: number } = {
        hp: 0,
        atk: 0,
        def: 0,
        tuneBreakBoost: 0
    }
    for (const ascStr of Object.keys(data.stats)) {
        const asc = Number(ascStr)
        const levelMap = data.stats[ascStr]
        for (const lvStr of Object.keys(levelMap)) {
            const lv = Number(lvStr)
            if (lv === 90 && asc === 6) {
                baseStats = {
                    hp: levelMap[lvStr].life,
                    atk: levelMap[lvStr].atk,
                    def: levelMap[lvStr].def,
                    tuneBreakBoost: 0
                }
            }
        }
    }

    const skills: SkillEntry[] = []
    const statNodes: StatNode[] = []
    const elementName = (ELEMENT_MAP[data.element] ?? '') as '冷凝' | '热熔' | '导电' | '气动' | '衍射' | '湮灭'
    const hasTune = Object.values(data.tag ?? {}).some(
        (t) => t.name === '震谐响应' || t.name === '集谐响应' || t.name === '骇破响应'
    )
    baseStats.tuneBreakBoost = hasTune ? 10 : 0

    for (const node of Object.values(data.skill_trees)) {
        const s = node.skill
        const nt = node.node_type
        const st = s.type ?? ''

        if (nt === 1 || nt === 2) {
            skills.push({
                name: s.name ?? '',
                type: st as SkillEntry['type'],
                desc: interpolate(s.desc ?? '', s.param ?? []),
                values: makeSkillValues(s)
            })
        } else if (nt === 3 && (st === '延奏技能' || st === '谐度破坏')) {
            skills.push({
                name: s.name ?? '',
                type: st as SkillEntry['type'],
                desc: interpolate(s.desc ?? '', s.param ?? []),
                values: makeSkillValues(s)
            })
        } else {
            const sd = s.desc ?? ''
            statNodes.push({
                name: s.name ?? '',
                desc: sd ? interpolate(sd, s.param ?? []) : ''
            })
        }
    }

    preprocessSkills(skills, elementName)

    const chains: ResonanceChain[] = Object.entries(data.chains ?? {}).map(([, c]) => ({
        name: c.name,
        desc: interpolate(c.desc, c.param ?? [])
    }))

    return {
        rarity: data.rarity as 4 | 5,
        element: elementName,
        weaponType: (WEAPON_TYPE_MAP[data.weapon] ?? '') as '长刃' | '迅刀' | '佩枪' | '臂铠' | '音感仪',
        lv90BaseStats: baseStats,
        skills,
        statNodes,
        chains
    }
}

export function transformWeaponInfo(data: ZhWeaponDetail): WeaponInfo {
    const arr = data.stats?.['6']?.['90'] ?? data.stats?.['5']?.['90'] ?? data.stats?.['6']?.['80']
    const atkStat = arr?.[0] ?? { value: 0 }
    const subStat = arr?.[1] ?? { name: '', value: 0, is_percent: false }

    const subValue = subStat.is_percent ? (subStat.value / 100).toFixed(2) + '%' : String(subStat.value)

    let desc = data.effect ?? ''
    if (data.param) {
        desc = desc.replace(/\{(\d+)\}/g, (_, idx) => {
            const p = data.param[Number(idx)]
            if (!p) return `{${idx}}`
            return p.join('/')
        })
    }

    return {
        rarity: data.rarity as 1 | 2 | 3 | 4 | 5,
        type: (WEAPON_TYPE_MAP[data.type] ?? '长刃') as '长刃' | '迅刀' | '佩枪' | '臂铠' | '音感仪',
        lv90BaseAtk: atkStat.value,
        substat: {
            name: subStat.name ?? '',
            value: subValue
        },
        effect: {
            name: data.effect_name ?? '',
            desc
        }
    }
}

function makeEchoSkillValues(skill: ZhEchoDetail['skill']): [name: string, value: string, element: string][] {
    if (!skill.damage) return []
    const result: [string, string, string][] = []
    let i = 0
    for (const [, dmg] of Object.entries(skill.damage)) {
        const lastIdx = dmg.rate_lv ? dmg.rate_lv.length - 1 : 0
        const rateVal = dmg.rate_lv?.[lastIdx] ?? 0
        const pct = (rateVal / 100).toFixed(2) + '%'
        const suffix = dmg.related_property === '攻击' ? '' : dmg.related_property
        const value = suffix ? pct + suffix : pct
        const element = ELEMENT_MAP[dmg.element] ?? ''
        i++
        result.push([`伤害${i}`, value, element])
    }
    return result
}

export function transformEchoInfo(data: ZhEchoDetail, intensity?: number): EchoInfo {
    let desc = data.skill?.desc ?? ''
    const params = data.skill?.param ?? []
    if (params.length > 0) {
        const lastRow = params[params.length - 1]
        desc = desc.replace(/\{(\d+)\}/g, (_, i) => lastRow[Number(i)] ?? `{${i}}`)
    }
    return {
        cost: intensity !== undefined ? (COST_MAP[intensity] ?? 1) : (COST_MAP[data.intensity] ?? 1),
        skill: {
            desc,
            values: makeEchoSkillValues(data.skill)
        },
        groups: Object.values(data.group ?? {}).map((g) => g.name)
    }
}

export function transformEchoSetInfo(data: ZhSonataDetail, setId: string): EchoSetInfo | null {
    const entry = data[setId]
    if (!entry) return null
    const bonuses: Record<string, string> = {}
    for (const [pieces, info] of Object.entries(entry.set)) {
        bonuses[pieces] = interpolate(info.desc, info.param ?? [])
    }
    return { bonuses }
}
