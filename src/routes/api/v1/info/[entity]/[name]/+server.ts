import { CACHE_CONTROL } from '$lib/api/consts'
import { createJsonResponse } from '$lib/api/fetch'
import { getProvider, providerIdFromUrl } from '$lib/api/provider'
import type { DataProvider } from '$lib/api/provider/types'

const HANDLERS: Record<
    string,
    keyof Pick<DataProvider, 'getCharacterInfo' | 'getWeaponInfo' | 'getEchoInfo' | 'getEchoSetInfo'>
> = {
    character: 'getCharacterInfo',
    weapon: 'getWeaponInfo',
    echo: 'getEchoInfo',
    'echo-set': 'getEchoSetInfo'
}

export const GET = async ({ params, url }: { params: { entity: string; name: string }; url?: URL }) => {
    const { entity, name } = params
    if (!name) return createJsonResponse({ error: 'Missing name parameter' }, 400)

    const method = HANDLERS[entity]
    if (!method) return createJsonResponse({ error: 'Invalid entity' }, 400)
    try {
        const provider = getProvider(url ? providerIdFromUrl(url) : undefined)
        const data = await provider[method](name)
        return createJsonResponse(data, 200, { 'Cache-Control': CACHE_CONTROL })
    } catch (e) {
        const msg = String(e)
        const status = /not found/i.test(msg) ? 404 : 500
        return createJsonResponse({ error: status === 404 ? msg : 'Failed to fetch data: ' + msg }, status)
    }
}
