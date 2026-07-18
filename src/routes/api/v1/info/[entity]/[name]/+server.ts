import { CACHE_CONTROL, NANOKA_BASE } from '$lib/api/consts'
import { fetchData, fetchZhData, createJsonResponse } from '$lib/api/fetch'
import {
    transformCharacterInfo,
    transformWeaponInfo,
    transformEchoInfo,
    transformEchoSetInfo,
    findEntryByName,
    findSonataSetEntry
} from '$lib/api/utils'
import type {
    NanokaCharacter,
    NanokaWeapon,
    NanokaEcho,
    NanokaSonata,
    ZhCharacterDetail,
    ZhWeaponDetail,
    ZhEchoDetail,
    ZhSonataDetail
} from '$lib/api/types'

let sonataCache: NanokaSonata | null = null
let versionCache: string | null = null

async function getSonata(): Promise<NanokaSonata> {
    if (sonataCache) return sonataCache
    sonataCache = await fetchData<NanokaSonata>('/sonata.json')
    return sonataCache
}

async function getVersion(): Promise<string> {
    if (versionCache) return versionCache
    const manifest: { ww: { latest: string } } = await fetch(`${NANOKA_BASE}/manifest.json`).then((r) => r.json())
    versionCache = manifest.ww.latest
    return versionCache
}

export const GET = async ({ params }: { params: { entity: string; name: string } }) => {
    const { entity, name } = params
    if (!name) return createJsonResponse({ error: 'Missing name parameter' }, 400)

    try {
        switch (entity) {
            case 'character': {
                const list = await fetchData<Record<string, NanokaCharacter>>('/character.json')
                const found = findEntryByName(list, name)
                if (!found) return createJsonResponse({ error: 'Character not found' }, 404)
                const version = await getVersion()
                const data = await fetchZhData<ZhCharacterDetail>(`/character/${found[0]}.json`, version)
                return createJsonResponse(transformCharacterInfo(data), 200, { 'Cache-Control': CACHE_CONTROL })
            }
            case 'weapon': {
                const list = await fetchData<Record<string, NanokaWeapon>>('/weapon.json')
                const found = findEntryByName(list, name)
                if (!found) return createJsonResponse({ error: 'Weapon not found' }, 404)
                const version = await getVersion()
                const data = await fetchZhData<ZhWeaponDetail>(`/weapon/${found[0]}.json`, version)
                return createJsonResponse(transformWeaponInfo(data), 200, { 'Cache-Control': CACHE_CONTROL })
            }
            case 'echo': {
                const list = await fetchData<Record<string, NanokaEcho>>('/echo.json')
                const found = findEntryByName(list, name)
                if (!found) return createJsonResponse({ error: 'Echo not found' }, 404)
                const version = await getVersion()
                const data = await fetchZhData<ZhEchoDetail>(`/echo/${found[0]}.json`, version)
                return createJsonResponse(transformEchoInfo(data, found[1].intensity), 200, {
                    'Cache-Control': CACHE_CONTROL
                })
            }
            case 'echo-set': {
                const version = await getVersion()
                const data = await fetchZhData<ZhSonataDetail>('/sonata.json', version)
                const found = findSonataSetEntry(data, name)
                if (!found) return createJsonResponse({ error: 'Set not found' }, 404)
                const result = transformEchoSetInfo(data, found[0])
                return createJsonResponse(result, 200, { 'Cache-Control': CACHE_CONTROL })
            }
            default:
                return createJsonResponse({ error: 'Invalid entity' }, 400)
        }
    } catch (e) {
        return createJsonResponse({ error: 'Failed to fetch data: ' + String(e) }, 500)
    }
}
