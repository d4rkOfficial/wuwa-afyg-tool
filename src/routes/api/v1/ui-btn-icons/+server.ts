import { ASSET_BASE, CACHE_CONTROL } from '../[type]/consts'
import { createJsonResponse } from '../[type]/utils'

const BASE = `${ASSET_BASE}/UIResources/Common/Image/UiIconPcBtn`

const KEYS: [string, string][] = [
    ['SpaceBar', `${BASE}/T_IconPcBtn_KeySpaceBar_UI.webp`],
    ['MouseLeft', `${BASE}/T_IconPcBtn_MouseLeft_UI.webp`],
    ['MouseRight', `${BASE}/T_IconPcBtn_MouseRight_UI.webp`],
    ['MouseMiddle', `${BASE}/T_IconPcBtn_MouseMiddle_UI.webp`],
    ['Q', `${BASE}/T_IconPcBtn_KeyQ_UI.webp`],
    ['E', `${BASE}/T_IconPcBtn_KeyE_UI.webp`],
    ['R', `${BASE}/T_IconPcBtn_KeyR_UI.webp`],
    ['T', `${BASE}/T_IconPcBtn_KeyT_UI.webp`],
    ['F', `${BASE}/T_IconPcBtn_KeyF_UI.webp`]
]

export const GET = async () => createJsonResponse(KEYS, 200, { 'Cache-Control': CACHE_CONTROL })
