import { NANOKA_BASE, CACHE_CONTROL } from '$lib/api/consts'
import { fetchData, fetchZhData, createJsonResponse } from '$lib/api/fetch'
import { findEntryByName } from '$lib/api/utils'
import type { NanokaCharacter, NanokaWeapon, ZhCharacterDetail } from '$lib/api/types'

let versionCache: string | null = null

async function getVersion(): Promise<string> {
    if (versionCache) return versionCache
    const manifest: { ww: { latest: string } } = await fetch(`${NANOKA_BASE}/manifest.json`).then((r) => r.json())
    versionCache = manifest.ww.latest
    return versionCache
}

export const GET = async ({ params }: { params: { character: string } }) => {
    const { character } = params
    if (!character) return createJsonResponse({ error: 'Missing character name' }, 400)

    try {
        const version = await getVersion()
        const charList = await fetchData<Record<string, NanokaCharacter>>('/character.json')
        const found = findEntryByName(charList, character)
        if (!found) return createJsonResponse({ error: 'Character not found' }, 404)
        const charData = await fetchZhData<ZhCharacterDetail>(`/character/${found[0]}.json`, version)

        const weaponData = await fetchData<Record<string, NanokaWeapon>>('/weapon.json')
        const weaponIdToName: Record<number, string> = {}
        for (const [id, w] of Object.entries(weaponData)) {
            if (w.zh) weaponIdToName[Number(id)] = w.zh
        }

        const recommendedWeapons: string[] = []
        if (charData.recommend?.weapon) {
            for (const wid of charData.recommend.weapon) {
                const name = weaponIdToName[wid]
                if (name) recommendedWeapons.push(name)
            }
        }

        return createJsonResponse(recommendedWeapons, 200, { 'Cache-Control': CACHE_CONTROL })
    } catch (e) {
        return createJsonResponse({ error: 'Failed to fetch data: ' + String(e) }, 500)
    }
}
