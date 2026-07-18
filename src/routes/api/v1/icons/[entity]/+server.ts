import { ASSET_BASE, CACHE_CONTROL } from '$lib/api/consts'
import { fetchData, createJsonResponse } from '$lib/api/fetch'
import {
    transformCharacterIcons,
    transformWeaponIcons,
    transformEchoIcons,
    transformElementIcons,
    transformWeaponTypeIcons,
    transformEchoSetIcons
} from '$lib/api/utils'
import type { NanokaCharacter, NanokaWeapon, NanokaEcho, NanokaSonata } from '$lib/api/types'

let sonataCache: NanokaSonata | null = null

async function getSonata(): Promise<NanokaSonata> {
    if (sonataCache) return sonataCache
    sonataCache = await fetchData<NanokaSonata>('/sonata.json')
    return sonataCache
}

type HandlerFn = (url: URL) => Promise<Response>

const UI_BTN_BASE = `${ASSET_BASE}/UIResources/Common/Image/UiIconPcBtn`

const HANDLERS: Record<string, HandlerFn> = {
    character: async () => {
        const data = await fetchData<Record<string, NanokaCharacter>>('/character.json')
        return createJsonResponse(transformCharacterIcons(data), 200, { 'Cache-Control': CACHE_CONTROL })
    },
    weapon: async () => {
        const data = await fetchData<Record<string, NanokaWeapon>>('/weapon.json')
        return createJsonResponse(transformWeaponIcons(data), 200, { 'Cache-Control': CACHE_CONTROL })
    },
    echo: async () => {
        const data = await fetchData<Record<string, NanokaEcho>>('/echo.json')
        return createJsonResponse(transformEchoIcons(data), 200, { 'Cache-Control': CACHE_CONTROL })
    },
    element: async () => {
        const sonata = await getSonata()
        return createJsonResponse(transformElementIcons(sonata), 200, { 'Cache-Control': CACHE_CONTROL })
    },
    'weapon-type': async () => createJsonResponse(transformWeaponTypeIcons(), 200, { 'Cache-Control': CACHE_CONTROL }),
    'echo-set': async () => {
        const sonata = await getSonata()
        return createJsonResponse(transformEchoSetIcons(sonata), 200, { 'Cache-Control': CACHE_CONTROL })
    },
    'ui-btn': async () => {
        const keys: [string, string][] = [
            ['MouseLeft', `${UI_BTN_BASE}/T_IconPcBtn_MouseLeft_UI.webp`],
            ['MouseRight', `${UI_BTN_BASE}/T_IconPcBtn_MouseRight_UI.webp`],
            ['Q', `${UI_BTN_BASE}/T_IconPcBtn_KeyQ_UI.webp`],
            ['E', `${UI_BTN_BASE}/T_IconPcBtn_KeyE_UI.webp`],
            ['R', `${UI_BTN_BASE}/T_IconPcBtn_KeyR_UI.webp`],
            ['F', `${UI_BTN_BASE}/T_IconPcBtn_KeyF_UI.webp`],
            ['T', `${UI_BTN_BASE}/T_IconPcBtn_KeyT_UI.webp`],
            ['SpaceBar', `${UI_BTN_BASE}/T_IconPcBtn_KeySpaceBar_UI.webp`],
            ['MouseMiddle', `${UI_BTN_BASE}/T_IconPcBtn_MouseMiddle_UI.webp`]
        ]
        return createJsonResponse(keys, 200, { 'Cache-Control': CACHE_CONTROL })
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
