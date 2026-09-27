import { CACHE_CONTROL } from '$lib/api/consts'
import { createJsonResponse } from '$lib/api/fetch'
import { getProvider, providerIdFromUrl } from '$lib/api/provider'

export const GET = async ({ params, url }: { params: { name: string }; url?: URL }) => {
    const { name } = params
    if (!name) return createJsonResponse({ error: 'Missing name parameter' }, 400)

    try {
        const provider = getProvider(url ? providerIdFromUrl(url) : undefined)
        // v3 在 v2 的富文本描述之上补角色定位标签（tags）；目前仅角色详情有这两类富数据。
        const data = await provider.getCharacterInfo(name, { rich: true })
        return createJsonResponse(data, 200, { 'Cache-Control': CACHE_CONTROL })
    } catch (e) {
        const msg = String(e)
        const status = /not found/i.test(msg) ? 404 : 500
        return createJsonResponse({ error: status === 404 ? msg : 'Failed to fetch data: ' + msg }, status)
    }
}
