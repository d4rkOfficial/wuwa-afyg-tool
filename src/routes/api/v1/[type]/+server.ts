import { CACHE_CONTROL, NANOKA_BASE } from './consts'
import {
    fetchData,
    createJsonResponse,
    transformCharacterList,
    transformWeaponList,
    transformEchoList,
    transformEchoSetList,
    transformCharacterIcons,
    transformWeaponIcons,
    transformEchoIcons,
    transformElementIcons,
    transformWeaponTypeIcons,
    transformEchoSetIcons
} from './utils'
import type { NanokaCharacter, NanokaWeapon, NanokaEcho, NanokaSonata } from './types'

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

type HandlerFn = (url: URL) => Promise<Response>

const HANDLERS: Record<string, HandlerFn> = {
    'character-list': async () => {
        const data = await fetchData<Record<string, NanokaCharacter>>('/character.json')
        return createJsonResponse(transformCharacterList(data), 200, {
            'Cache-Control': CACHE_CONTROL
        })
    },
    'weapon-list': async () => {
        const data = await fetchData<Record<string, NanokaWeapon>>('/weapon.json')
        return createJsonResponse(transformWeaponList(data), 200, {
            'Cache-Control': CACHE_CONTROL
        })
    },
    'echo-list': async () => {
        const [echoData, sonata] = await Promise.all([fetchData<Record<string, NanokaEcho>>('/echo.json'), getSonata()])
        return createJsonResponse(transformEchoList(echoData, sonata), 200, {
            'Cache-Control': CACHE_CONTROL
        })
    },
    'echo-set-list': async () => {
        const sonata = await getSonata()
        return createJsonResponse(transformEchoSetList(sonata), 200, {
            'Cache-Control': CACHE_CONTROL
        })
    },
    'character-icons': async () => {
        const data = await fetchData<Record<string, NanokaCharacter>>('/character.json')
        return createJsonResponse(transformCharacterIcons(data), 200, {
            'Cache-Control': CACHE_CONTROL
        })
    },
    'weapon-icons': async () => {
        const data = await fetchData<Record<string, NanokaWeapon>>('/weapon.json')
        return createJsonResponse(transformWeaponIcons(data), 200, {
            'Cache-Control': CACHE_CONTROL
        })
    },
    'echo-icons': async () => {
        const data = await fetchData<Record<string, NanokaEcho>>('/echo.json')
        return createJsonResponse(transformEchoIcons(data), 200, { 'Cache-Control': CACHE_CONTROL })
    },
    'element-icons': async () => {
        const sonata = await getSonata()
        return createJsonResponse(transformElementIcons(sonata), 200, {
            'Cache-Control': CACHE_CONTROL
        })
    },
    'weapon-type-icons': async () =>
        createJsonResponse(transformWeaponTypeIcons(), 200, { 'Cache-Control': CACHE_CONTROL }),
    'echo-set-icons': async () => {
        const sonata = await getSonata()
        return createJsonResponse(transformEchoSetIcons(sonata), 200, {
            'Cache-Control': CACHE_CONTROL
        })
    }
}

export const GET = async ({ params, url }: { params: { type: string }; url: URL }) => {
    const { type } = params
    const handler = HANDLERS[type]
    if (!handler) return createJsonResponse({ error: 'Invalid type' }, 400)
    try {
        return await handler(url)
    } catch (e) {
        return createJsonResponse({ error: 'Failed to fetch data: ' + String(e) }, 500)
    }
}
