import { CACHE_CONTROL, ensureVersion, getWWVersion } from '$lib/api/consts'
import { fetchData, fetchZhData, createJsonResponse } from '$lib/api/fetch'
import { transformCharacterInfoRich, findEntryByName } from '$lib/api/utils'
import type { NanokaCharacter, ZhCharacterDetail } from '$lib/api/types'

export const GET = async ({ params }: { params: { name: string } }) => {
    const { name } = params
    if (!name) return createJsonResponse({ error: 'Missing name parameter' }, 400)

    try {
        const list = await fetchData<Record<string, NanokaCharacter>>('/character.json')
        const found = findEntryByName(list, name)
        if (!found) return createJsonResponse({ error: 'Character not found' }, 404)
        await ensureVersion()
        const data = await fetchZhData<ZhCharacterDetail>(`/character/${found[0]}.json`, getWWVersion())
        return createJsonResponse(transformCharacterInfoRich(data), 200, { 'Cache-Control': CACHE_CONTROL })
    } catch (e) {
        return createJsonResponse({ error: 'Failed to fetch data: ' + String(e) }, 500)
    }
}
