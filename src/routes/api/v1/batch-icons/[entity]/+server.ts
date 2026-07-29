import { CACHE_CONTROL } from '$lib/api/consts'
import { fetchData, createJsonResponse } from '$lib/api/fetch'
import { ueToCdn } from '$lib/api/utils'
import type { NanokaCharacter, NanokaWeapon, NanokaEcho, NanokaSonata } from '$lib/api/types'

let sonataCache: NanokaSonata | null = null

async function getSonata(): Promise<NanokaSonata> {
    if (sonataCache) return sonataCache
    sonataCache = await fetchData<NanokaSonata>('/sonata.json')
    return sonataCache
}

type HandlerFn = (url: URL) => Promise<Response>

const HANDLERS: Record<string, HandlerFn> = {
    character: async () => {
        const data = await fetchData<Record<string, NanokaCharacter>>('/character.json')
        const map: Record<string, string> = {}
        for (const c of Object.values(data)) {
            if (c.zh && c.icon) map[c.zh] = ueToCdn(c.icon)
        }
        return createJsonResponse(map, 200, { 'Cache-Control': CACHE_CONTROL })
    },
    weapon: async () => {
        const data = await fetchData<Record<string, NanokaWeapon>>('/weapon.json')
        const map: Record<string, string> = {}
        for (const w of Object.values(data)) {
            if (w.zh && w.icon) map[w.zh] = ueToCdn(w.icon)
        }
        return createJsonResponse(map, 200, { 'Cache-Control': CACHE_CONTROL })
    },
    echo: async () => {
        const data = await fetchData<Record<string, NanokaEcho>>('/echo.json')
        const map: Record<string, string> = {}
        for (const e of Object.values(data)) {
            if (e.zh && e.icon) map[e.zh] = ueToCdn(e.icon)
        }
        return createJsonResponse(map, 200, { 'Cache-Control': CACHE_CONTROL })
    },
    'echo-set': async () => {
        const sonata = await getSonata()
        const map: Record<string, string> = {}
        for (const s of Object.values(sonata)) {
            if (s.name?.zh && s.icon) map[s.name.zh] = ueToCdn(s.icon)
        }
        return createJsonResponse(map, 200, { 'Cache-Control': CACHE_CONTROL })
    }
}

export const GET = async ({ params }: { params: { entity: string } }) => {
    const { entity } = params
    const handler = HANDLERS[entity]
    if (!handler) return createJsonResponse({ error: 'Invalid entity' }, 400)
    try {
        return await handler(new URL('http://localhost'))
    } catch (e) {
        return createJsonResponse({ error: 'Failed to fetch data: ' + String(e) }, 500)
    }
}
