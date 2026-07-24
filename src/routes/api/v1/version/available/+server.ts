import { CACHE_CONTROL, NANOKA_BASE } from '$lib/api/consts'
import { createJsonResponse } from '$lib/api/fetch'

export const GET = async () => {
    try {
        const manifest: { ww?: { available?: string[] } } = await fetch(`${NANOKA_BASE}/manifest.json`).then((r) =>
            r.json()
        )
        return createJsonResponse(manifest.ww?.available ?? ['3.5'], 200, { 'Cache-Control': CACHE_CONTROL })
    } catch (e) {
        return createJsonResponse(['3.5'], 500)
    }
}
