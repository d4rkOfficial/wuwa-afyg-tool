export { ELEMENT_ORDER, ELEMENT_COLORS } from '$lib/consts/game-terms'

export const PPS = 60
export const SIDE_PAD = 48
export const RIGHT_EXTRA = 500
export const ADD_OFFSET = 24
export const MIN_GAP = 60
export const SNAP_PX = 8
export const MIN_TIME = 0
export const MAX_TIME = 150
export const MAX_POS = SIDE_PAD + MAX_TIME * PPS
export const BLOCK_H_PAD = 18.6

export const TRACK_COLORS = [
    'var(--theme-track-1, #3b82f6)',
    'var(--theme-track-2, #7c3aed)',
    'var(--theme-track-3, #db2777)',
    'var(--theme-track-4, #16a34a)'
] as const

export const BUTTON_KEY_ORDER = ['MouseLeft', 'MouseRight', 'Q', 'E', 'R', 'F', 'T', 'SpaceBar', 'MouseMiddle'] as const

export const QUICK_KEY_MAP: Record<string, string> = {
    q: 'Q',
    e: 'E',
    r: 'R',
    t: 'T',
    f: 'F',
    ' ': 'SpaceBar',
    a: 'MouseLeft',
    s: 'MouseRight',
    z: 'MouseLeft'
}

export const QUICK_DESC_MAP: Record<string, string> = {
    z: '重击'
}

export const QUICK_CHAR_MARKER = '__char__'

export { NON_DIRECT_CONFIGS, NON_DIRECT_ELEMENT } from '$lib/consts/game-terms'
