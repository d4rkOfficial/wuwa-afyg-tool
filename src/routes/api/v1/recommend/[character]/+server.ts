import { CACHE_CONTROL, ELEMENT_MAP, WEAPON_TYPE_MAP, COST_MAP, ensureVersion, getWWVersion } from '$lib/api/consts'
import { fetchData, fetchZhData, createJsonResponse } from '$lib/api/fetch'
import { findEntryByName } from '$lib/api/utils'
import type {
    NanokaCharacter,
    NanokaWeapon,
    NanokaEcho,
    NanokaSonata,
    ZhCharacterDetail,
    ZhEchoDetail,
    ZhSonataDetail
} from '$lib/api/types'

const EFFECT_NAMES = ['光噪效应', '风蚀效应', '聚爆效应', '霜渐效应', '虚湮效应', '电磁效应', '骇破', '震谐', '集谐']

interface CharProfile {
    element: string
    elementFreq: Record<string, number>
    propertyFreq: Record<string, number>
    tags: string[]
    statNames: string[]
}

function buildCharProfile(data: ZhCharacterDetail): CharProfile {
    const element = ELEMENT_MAP[data.element] ?? ''
    const elementFreq: Record<string, number> = {}
    const propertyFreq: Record<string, number> = {}
    const statNames: string[] = []
    const tags: string[] = Object.values(data.tag ?? {}).map((t) => t.name)

    for (const node of Object.values(data.skill_trees)) {
        const s = node.skill
        if (!s) continue

        if (s.damage) {
            for (const dmg of Object.values(s.damage)) {
                const el = ELEMENT_MAP[dmg.element] ?? ''
                if (el) elementFreq[el] = (elementFreq[el] ?? 0) + 1

                const prop = dmg.related_property ?? ''
                if (prop) propertyFreq[prop] = (propertyFreq[prop] ?? 0) + 1
            }
        }

        const name = s.name ?? ''
        if (name.endsWith('提升')) {
            const stat = name.replace('提升', '')
            if (['攻击', '生命', '防御'].includes(stat)) statNames.push(stat)
        }
    }

    return { element, elementFreq, propertyFreq, tags, statNames }
}

const STATS = ['攻击', '生命', '防御']

function descContainsAny(text: string, keywords: string[]): string | null {
    for (const kw of keywords) {
        if (text.includes(kw)) return kw
    }
    return null
}

function scoreEchoSet(desc: string, profile: CharProfile): number {
    let score = 0

    for (const [el, freq] of Object.entries(profile.elementFreq)) {
        if (desc.includes(el)) score += freq * 10
    }

    for (const [prop, freq] of Object.entries(profile.propertyFreq)) {
        if (desc.includes(prop)) score += freq * 5
    }

    for (const tag of profile.tags) {
        const effect = descContainsAny(tag, EFFECT_NAMES)
        if (effect && desc.includes(effect)) score += 8
    }

    if (profile.tags.some((t) => t.includes('治疗'))) {
        if (desc.includes('治疗')) score += 5
    }

    for (const stat of profile.statNames) {
        if (desc.includes(stat)) score += 3
    }

    return score
}

interface SetScore {
    name: string
    desc: string
    score: number
}

interface EchoSetBonus {
    name: string
    combinedDesc: string
}

function buildSetBonuses(sonata: ZhSonataDetail): EchoSetBonus[] {
    return Object.values(sonata)
        .filter((s) => s.name)
        .map((s) => ({
            name: s.name,
            combinedDesc: Object.values(s.set)
                .map((b) => b.desc)
                .join(' ')
        }))
}

interface EchoCostInfo {
    id: string
    name: string
    cost: number
    sets: string[]
    intensity: number
}

export const GET = async ({ params }: { params: { character: string } }) => {
    const { character } = params
    if (!character) return createJsonResponse({ error: 'Missing character name' }, 400)

    try {
        await ensureVersion()
        const version = getWWVersion()

        // ── 1. Fetch character raw data ──
        const charList = await fetchData<Record<string, NanokaCharacter>>('/character.json')
        const found = findEntryByName(charList, character)
        if (!found) return createJsonResponse({ error: 'Character not found' }, 404)
        const charData = await fetchZhData<ZhCharacterDetail>(`/character/${found[0]}.json`, version)

        // ── 2. Build weapon ID→name map ──
        const weaponData = await fetchData<Record<string, NanokaWeapon>>('/weapon.json')
        const weaponIdToName: Record<number, string> = {}
        for (const [id, w] of Object.entries(weaponData)) {
            if (w.zh) weaponIdToName[Number(id)] = w.zh
        }

        // ── 3. Recommend weapons ──
        const recommendedWeapons: string[] = []
        if (charData.recommend?.weapon) {
            for (const wid of charData.recommend.weapon) {
                const name = weaponIdToName[wid]
                if (name) recommendedWeapons.push(name)
            }
        }

        // ── 4. Build character profile ──
        const profile = buildCharProfile(charData)

        // ── 5. Fetch echo sets + score ──
        const sonataZh = await fetchZhData<ZhSonataDetail>('/sonata.json', version)
        const setBonuses = buildSetBonuses(sonataZh)

        const scoredSets: SetScore[] = setBonuses.map((s) => ({
            name: s.name,
            desc: s.combinedDesc,
            score: scoreEchoSet(s.combinedDesc, profile)
        }))
        scoredSets.sort((a, b) => b.score - a.score)
        const topSets = scoredSets.slice(0, 5)
        const recommendedSetNames = topSets.map((s) => s.name)

        // ── 6. Find 4-cost echoes belonging to recommended sets ──
        const echoList = await fetchData<Record<string, NanokaEcho>>('/echo.json')
        const sonataList = await fetchData<NanokaSonata>('/sonata.json')

        const fourCostEchoes: EchoCostInfo[] = []
        for (const [id, e] of Object.entries(echoList)) {
            if (!e.zh) continue
            const cost = COST_MAP[e.intensity] ?? 1
            if (cost === 4 || cost === 3) {
                const setNames = e.group.map((gid) => sonataList[String(gid)]?.name?.zh ?? '').filter(Boolean)
                fourCostEchoes.push({ id, name: e.zh, cost, sets: setNames, intensity: e.intensity })
            }
        }

        const candidateEchoes = fourCostEchoes.filter((e) => e.sets.some((s) => recommendedSetNames.includes(s)))

        // ── 7. Score 4-cost echoes ──
        type EchoScore = { name: string; score: number; sets: string[] }
        const echoScores: EchoScore[] = []

        for (const ce of candidateEchoes) {
            let score = 0
            try {
                const detail = await fetchZhData<ZhEchoDetail>(`/echo/${ce.id}.json`, version)
                if (detail.skill?.damage) {
                    for (const dmg of Object.values(detail.skill.damage)) {
                        const el = ELEMENT_MAP[dmg.element] ?? ''
                        if (el === profile.element) {
                            const lastRate = dmg.rate_lv?.[dmg.rate_lv.length - 1] ?? 0
                            score += lastRate
                        }
                    }
                }
            } catch {
                score = 0
            }
            echoScores.push({ name: ce.name, score, sets: ce.sets })
        }

        echoScores.sort((a, b) => b.score - a.score)
        const recommendedEchoes = echoScores.slice(0, 5).map((e) => e.name)

        return createJsonResponse(
            {
                weapons: recommendedWeapons,
                echoSets: recommendedSetNames,
                primaryEchoes: recommendedEchoes
            },
            200,
            { 'Cache-Control': CACHE_CONTROL }
        )
    } catch (e) {
        return createJsonResponse({ error: 'Failed to fetch data: ' + String(e) }, 500)
    }
}
