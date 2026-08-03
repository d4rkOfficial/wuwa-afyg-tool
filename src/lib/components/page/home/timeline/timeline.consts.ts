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

export const BUTTON_KEY_ORDER = [
    'MouseLeft',
    'MouseRight',
    'MouseMiddle',
    'SpaceBar',
    'Q',
    'W',
    'E',
    'R',
    'T',
    'Y',
    'U',
    'I',
    'O',
    'P',
    'A',
    'S',
    'D',
    'F',
    'G',
    'H',
    'J',
    'K',
    'L',
    'Z',
    'X',
    'C',
    'V',
    'B',
    'N',
    'M',
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    'Esc',
    'Tab',
    'CapsLock',
    'LeftShift',
    'RightShift',
    'LeftCtrl',
    'RightCtrl',
    'LeftAlt',
    'RightAlt',
    'Enter',
    'Backspace',
    'Delete',
    'Up',
    'Down',
    'Left',
    'Right'
] as const

export const ORIGINAL_BUTTON_KEYS = [
    'MouseLeft',
    'MouseRight',
    'Q',
    'E',
    'R',
    'F',
    'T',
    'SpaceBar',
    'MouseMiddle'
] as const

export const QUICK_CHAR_MARKER = '__char__'

export { NON_DIRECT_CONFIGS, NON_DIRECT_ELEMENT } from '$lib/consts/game-terms'
