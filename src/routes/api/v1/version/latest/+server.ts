import { CACHE_CONTROL } from '$lib/api/consts'
import { createJsonResponse } from '$lib/api/fetch'
import { getProvider, providerIdFromUrl } from '$lib/api/provider'

export const GET = async ({ url }: { url?: URL }) => {
    try {
        const provider = getProvider(url ? providerIdFromUrl(url) : undefined)
        const latest = await provider.getLatestVersion()
        return createJsonResponse(latest, 200, { 'Cache-Control': CACHE_CONTROL })
    } catch {
        return createJsonResponse('3.5', 500)
    }
}
