import { ASSET_BASE } from './consts'
import { ELEMENT_MAP, WEAPON_TYPE_MAP, COST_MAP } from '$lib/consts/game-terms'
import type {
    Character,
    Weapon,
    Echo,
    IconPair,
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
): [name: string, value: string, element: string][] {
    if (!skill.level) return []
    const keys = Object.keys(skill.level)
        .map(Number)
        .filter((k) => !isNaN(k))
    if (keys.length === 0) return []
    const sorted = keys.sort((a, b) => a - b)
    const result: [string, string, string][] = []

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
        if (skill.damage) {
            const pct = parseFloat(raw.replace('%', '').split('*')[0])
            if (!isNaN(pct)) {
                const target = Math.round(pct * 100)
                for (const dv of Object.values(skill.damage)) {
                    if (dv.rate_lv && dv.rate_lv[idx] === target) {
                        element = ELEMENT_MAP[dv.element] ?? ''
                        break
                    }
                }
            }
        }

        result.push([lvData.name, value, element])
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

export const transformEchoList = (data: Record<string, NanokaEcho>, sonata: NanokaSonata): Echo[] =>
    Object.values(data)
        .filter((e) => e.zh)
        .map((e) => ({
            name: e.zh,
            sets: e.group.map((gid) => sonata[String(gid)]?.name?.zh ?? '').filter(Boolean),
            cost: COST_MAP[e.intensity] ?? 1
        }))

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

// ── Icon transforms ──

export const transformCharacterIcons = (data: Record<string, NanokaCharacter>): IconPair[] =>
    Object.values(data)
        .filter((c) => c.zh && c.icon)
        .map((c) => [c.zh, ueToCdn(c.icon)])

export const transformWeaponIcons = (data: Record<string, NanokaWeapon>): IconPair[] =>
    Object.values(data)
        .filter((w) => w.zh && w.icon)
        .map((w) => [w.zh, ueToCdn(w.icon)])

export const transformEchoIcons = (data: Record<string, NanokaEcho>): IconPair[] =>
    Object.values(data)
        .filter((e) => e.zh && e.icon)
        .map((e) => [e.zh, ueToCdn(e.icon)])

export const transformEchoSetIcons = (sonata: NanokaSonata): IconPair[] =>
    Object.values(sonata)
        .filter((s) => s.name?.zh && s.icon)
        .map((s) => [s.name.zh, ueToCdn(s.icon)])

export const transformElementIcons = (sonata: NanokaSonata): IconPair[] => {
    const ELEMENT_SET_IDS = [1, 2, 3, 4, 5, 6]
    const names = ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭']
    return ELEMENT_SET_IDS.map((sid, i) => {
        const s = sonata[String(sid)]
        return [names[i], s?.icon ? ueToCdn(s.icon) : ''] as IconPair
    })
}

export const transformWeaponTypeIcons = (): IconPair[] => [
    ['长刃', `${ASSET_BASE}/Static/SP_IconNorSword.webp`],
    ['迅刀', `${ASSET_BASE}/Static/SP_IconNorKnife.webp`],
    ['佩枪', `${ASSET_BASE}/Static/SP_IconNorGun.webp`],
    ['臂铠', `${ASSET_BASE}/Static/SP_IconNorFist.webp`],
    ['音感仪', `${ASSET_BASE}/Static/SP_IconNorMagic.webp`]
]

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
