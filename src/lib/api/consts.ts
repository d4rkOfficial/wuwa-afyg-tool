export const NANOKA_BASE = 'https://static.nanoka.cc'

let _wwVersion = '3.5'

export function getWWVersion() {
    return _wwVersion
}

export function getDataBase() {
    return `${NANOKA_BASE}/ww/${_wwVersion}`
}

let _versionPromise: Promise<void> | null = null

export async function ensureVersion() {
    if (!_versionPromise) {
        _versionPromise = (async () => {
            try {
                const res = await fetch('/api/v1/version/latest')
                const text = await res.text()
                if (text) _wwVersion = JSON.parse(text)
            } catch {
                // keep fallback
            }
        })()
    }
    return _versionPromise
}

export const ZH_DATA_BASE = `${NANOKA_BASE}/ww`
export const ASSET_BASE = `${NANOKA_BASE}/assets/ww`

export const CACHE_CONTROL = 'public, s-maxage=600, stale-while-revalidate=86400'

export { ELEMENT_MAP, WEAPON_TYPE_MAP, COST_MAP } from '$lib/consts/game-terms'
