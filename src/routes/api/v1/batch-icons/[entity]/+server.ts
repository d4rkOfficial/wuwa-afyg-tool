import { CACHE_CONTROL } from '$lib/api/consts'
import { createJsonResponse } from '$lib/api/fetch'
import { getProvider, providerIdFromUrl } from '$lib/api/provider'
import type { DataProvider } from '$lib/api/provider/types'

const HANDLERS: Record<
    string,
    keyof Pick<DataProvider, 'getCharacterIcons' | 'getWeaponIcons' | 'getEchoIcons' | 'getEchoSetIcons'>
> = {
    character: 'getCharacterIcons',
    weapon: 'getWeaponIcons',
    echo: 'getEchoIcons',
    'echo-set': 'getEchoSetIcons'
}

export const GET = async ({ params, url }: { params: { entity: string }; url: URL }) => {
    const { entity } = params
    const method = HANDLERS[entity]
    if (!method) return createJsonResponse({ error: 'Invalid entity' }, 400)
    try {
        const provider = getProvider(providerIdFromUrl(url))
        const data = await provider[method]()
        return createJsonResponse(data, 200, { 'Cache-Control': CACHE_CONTROL })
    } catch (e) {
        return createJsonResponse({ error: 'Failed to fetch data: ' + String(e) }, 500)
    }
}
