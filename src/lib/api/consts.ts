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
                const res = await fetch(`${NANOKA_BASE}/manifest.json`)
                const json: Record<string, unknown> = await res.json()
                const ww = json.ww as { latest?: string } | undefined
                if (ww?.latest) _wwVersion = ww.latest
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

export const ELEMENT_MAP = {
    1: '冷凝',
    2: '热熔',
    3: '导电',
    4: '气动',
    5: '衍射',
    6: '湮灭'
} as const

export const WEAPON_TYPE_MAP = {
    1: '长刃',
    2: '迅刀',
    3: '佩枪',
    4: '臂铠',
    5: '音感仪'
} as const

export const COST_MAP = { 0: 1, 1: 3, 2: 4, 3: 4 } as const
