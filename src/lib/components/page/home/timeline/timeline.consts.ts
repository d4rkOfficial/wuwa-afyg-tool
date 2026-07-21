export const ELEMENT_ORDER = ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭'] as const

export const ELEMENT_COLORS: Record<string, string> = {
    冷凝: '#38bdf8',
    热熔: '#fb923c',
    导电: '#a78bfa',
    气动: '#34d399',
    衍射: '#facc15',
    湮灭: '#f472b6'
}

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

export const TRACK_COLORS = ['#60a5fa', '#a78bfa', '#f472b6', '#22c55e'] as const

export const BUTTON_KEY_ORDER = ['MouseLeft', 'MouseRight', 'Q', 'E', 'R', 'F', 'T', 'SpaceBar', 'MouseMiddle'] as const

export const NON_DIRECT_CONFIGS = [
    { name: '谐度破坏', category: '处决' as const, max: 0 },
    { name: '震谐响应', category: '响应' as const, max: 0 },
    { name: '骇破响应', category: '响应' as const, max: 0 },
    { name: '光噪效应', category: '效应' as const, max: 19 },
    { name: '风蚀效应', category: '效应' as const, max: 12 },
    { name: '霜渐效应', category: '效应' as const, max: 19 },
    { name: '聚爆效应', category: '效应' as const, max: 19 },
    { name: '电磁效应', category: '效应' as const, max: 19 },
    { name: '虚湮效应', category: '效应' as const, max: 6 }
] as const

export const NON_DIRECT_ELEMENT: Record<string, string> = {
    光噪效应: '衍射',
    风蚀效应: '气动',
    霜渐效应: '冷凝',
    聚爆效应: '热熔',
    电磁效应: '导电',
    电磁爆发: '导电',
    虚湮效应: '湮灭'
}
