import { CACHE_CONTROL } from '$lib/api/consts'
import { fetchData, createJsonResponse } from '$lib/api/fetch'
import { transformCharacterList, transformWeaponList, transformEchoList, transformEchoSetList } from '$lib/api/utils'
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
        return createJsonResponse(transformCharacterList(data), 200, { 'Cache-Control': CACHE_CONTROL })
    },
    weapon: async () => {
        const data = await fetchData<Record<string, NanokaWeapon>>('/weapon.json')
        return createJsonResponse(transformWeaponList(data), 200, { 'Cache-Control': CACHE_CONTROL })
    },
    echo: async () => {
        const [echoData, sonata] = await Promise.all([fetchData<Record<string, NanokaEcho>>('/echo.json'), getSonata()])
        return createJsonResponse(transformEchoList(echoData, sonata), 200, { 'Cache-Control': CACHE_CONTROL })
    },
    'echo-set': async () => {
        const sonata = await getSonata()
        return createJsonResponse(transformEchoSetList(sonata), 200, { 'Cache-Control': CACHE_CONTROL })
    }
}

export const GET = async ({ params, url }: { params: { entity: string }; url: URL }) => {
    const { entity } = params
    const handler = HANDLERS[entity]
    if (!handler) return createJsonResponse({ error: 'Invalid entity' }, 400)
    try {
        return await handler(url)
    } catch (e) {
        return createJsonResponse({ error: 'Failed to fetch data: ' + String(e) }, 500)
    }
}
