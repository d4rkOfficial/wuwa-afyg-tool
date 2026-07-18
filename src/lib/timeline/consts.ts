export const ELEMENT_ORDER = ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭'] as const

export const ELEMENT_COLORS = {
    冷凝: '#38bdf8',
    热熔: '#fb923c',
    导电: '#a78bfa',
    气动: '#34d399',
    衍射: '#facc15',
    湮灭: '#f472b6'
} as const

export const NON_DIRECT_CONFIGS = [
    { name: '谐度破坏', category: '处决', max: 0 },
    { name: '震谐响应', category: '响应', max: 0 },
    { name: '骇破响应', category: '响应', max: 0 },
    { name: '光噪效应', category: '效应', max: 19 },
    { name: '风蚀效应', category: '效应', max: 12 },
    { name: '霜渐效应', category: '效应', max: 19 },
    { name: '聚爆效应', category: '效应', max: 19 },
    { name: '电磁效应', category: '效应', max: 19 },
    { name: '电磁爆发', category: '效应', max: 19 }
] as const

export const NON_DIRECT_ELEMENT = {
    光噪效应: '衍射',
    风蚀效应: '气动',
    霜渐效应: '冷凝',
    聚爆效应: '热熔',
    电磁效应: '导电',
    电磁爆发: '导电'
} as const

export const PPS = 60
export const SIDE_PAD = 48
export const RIGHT_EXTRA = 500
export const ADD_OFFSET = 24
export const MIN_GAP = 60
export const SNAP_PX = 8
export const MIN_TIME = 0
export const MAX_TIME = 150
export const TRACK_COLORS = ['#60a5fa', '#a78bfa', '#f472b6', '#22c55e'] as const
export const BUTTON_KEY_ORDER = ['MouseLeft', 'MouseRight', 'Q', 'E', 'R', 'F', 'T', 'SpaceBar', 'MouseMiddle'] as const
