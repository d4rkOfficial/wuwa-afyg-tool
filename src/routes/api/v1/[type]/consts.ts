export const NANOKA_BASE = 'https://static.nanoka.cc'
export const WW_VERSION = '3.5'
export const DATA_BASE = `${NANOKA_BASE}/ww/${WW_VERSION}`
export const ZH_DATA_BASE = `${NANOKA_BASE}/ww`
export const ASSET_BASE = `${NANOKA_BASE}/assets/ww`

export const CACHE_CONTROL = 'public, s-maxage=600, stale-while-revalidate=86400'

import { Element, WeaponType } from './types'

export const ELEMENT_MAP: Record<number, Element> = {
    1: Element.冷凝,
    2: Element.热熔,
    3: Element.导电,
    4: Element.气动,
    5: Element.衍射,
    6: Element.湮灭
}

export const WEAPON_TYPE_MAP: Record<number, WeaponType> = {
    1: WeaponType.长刃,
    2: WeaponType.迅刀,
    3: WeaponType.佩枪,
    4: WeaponType.臂铠,
    5: WeaponType.音感仪
}

export const COST_MAP: Record<number, number> = { 0: 1, 1: 3, 2: 4, 3: 4 }
