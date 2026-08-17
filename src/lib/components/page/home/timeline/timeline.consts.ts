export { ELEMENT_ORDER, ELEMENT_COLORS } from '$lib/consts/game-terms'

export const PPS = 60
export const SIDE_PAD = 48
export const RIGHT_EXTRA = 500
export const ADD_OFFSET = 24
export const MIN_GAP = 60
export const SNAP_PX = 8
export const MIN_TIME = 0
export const MAX_TIME = 180
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

// 手柄键位（图标来自游戏原生 UI 素材，与键盘图标同源：static/icons/gamepad，nanoka UiIconPcBtn/XboxGamepad_* 系列）
export interface GamepadButton {
    id: string
    label: string
    icon: string | null
}

export const GAMEPAD_BUTTONS: GamepadButton[] = [
    { id: 'x', label: 'X', icon: '/icons/gamepad/x.webp' },
    { id: 'y', label: 'Y', icon: '/icons/gamepad/y.webp' },
    { id: 'b', label: 'B', icon: '/icons/gamepad/b.webp' },
    { id: 'a', label: 'A', icon: '/icons/gamepad/a.webp' },
    { id: 'lb', label: 'LB', icon: '/icons/gamepad/lb.webp' },
    { id: 'rb', label: 'RB', icon: '/icons/gamepad/rb.webp' },
    { id: 'lt', label: 'LT', icon: '/icons/gamepad/lt.webp' },
    { id: 'rt', label: 'RT', icon: '/icons/gamepad/rt.webp' },
    { id: 'leftstick', label: '左摇杆', icon: '/icons/gamepad/leftstick.webp' },
    { id: 'rightstick', label: '右摇杆', icon: '/icons/gamepad/rightstick.webp' },
    // 编号手柄图标（游戏原生资源，未一一对应键名，均可选用）
    { id: 'xbox10', label: 'Xbox10', icon: '/icons/gamepad/xbox/Xbox10.webp' },
    { id: 'xbox13', label: 'Xbox13', icon: '/icons/gamepad/xbox/Xbox13.webp' },
    { id: 'xbox14', label: 'Xbox14', icon: '/icons/gamepad/xbox/Xbox14.webp' },
    { id: 'xbox15', label: 'Xbox15', icon: '/icons/gamepad/xbox/Xbox15.webp' },
    { id: 'xbox16', label: 'Xbox16', icon: '/icons/gamepad/xbox/Xbox16.webp' },
    { id: 'xbox17', label: 'Xbox17', icon: '/icons/gamepad/xbox/Xbox17.webp' },
    { id: 'xbox18', label: 'Xbox18', icon: '/icons/gamepad/xbox/Xbox18.webp' },
    { id: 'xbox19', label: 'Xbox19', icon: '/icons/gamepad/xbox/Xbox19.webp' },
    { id: 'xbox20', label: 'Xbox20', icon: '/icons/gamepad/xbox/Xbox20.webp' },
    { id: 'xbox29', label: 'Xbox29', icon: '/icons/gamepad/xbox/Xbox29.webp' },
    { id: 'xboxl', label: 'XboxL', icon: '/icons/gamepad/xbox/XboxL.webp' },
    { id: 'xboxr', label: 'XboxR', icon: '/icons/gamepad/xbox/XboxR.webp' }
]

export { NON_DIRECT_CONFIGS, NON_DIRECT_ELEMENT } from '$lib/consts/game-terms'
