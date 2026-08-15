import { CACHE_CONTROL } from '$lib/api/consts'
import { createJsonResponse } from '$lib/api/fetch'
import { getProvider, providerIdFromUrl } from '$lib/api/provider'

export const GET = async ({ params, url }: { params: { character: string }; url?: URL }) => {
    const { character } = params
    if (!character) return createJsonResponse({ error: 'Missing character name' }, 400)

    try {
        const provider = getProvider(url ? providerIdFromUrl(url) : undefined)
        const data = await provider.getRecommendedWeapons(character)
        return createJsonResponse(data, 200, { 'Cache-Control': CACHE_CONTROL })
    } catch (e) {
        const msg = String(e)
        const status = /not found/i.test(msg) ? 404 : 500
        return createJsonResponse({ error: status === 404 ? msg : 'Failed to fetch data: ' + msg }, status)
    }
}
