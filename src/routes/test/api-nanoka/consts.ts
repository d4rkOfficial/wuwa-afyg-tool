export const NANOKA_BASE = 'https://static.nanoka.cc'

export const ELEMENT_MAP: Record<number, string> = {
    1: '冷凝',
    2: '热熔',
    3: '导电',
    4: '气动',
    5: '衍射',
    6: '湮灭'
}

export const WEAPON_TYPE_MAP: Record<number, string> = {
    1: '长刃',
    2: '迅刀',
    3: '佩枪',
    4: '臂铠',
    5: '音感仪'
}

export const INTENSITY_LABEL: Record<number, string> = {
    0: '普通',
    1: '精英',
    2: '领主',
    3: '全息'
}

export const TAB_ORDER = ['manifest', 'character', 'weapon', 'echo', 'sonata'] as const
export const TAB_LABEL: Record<string, string> = {
    manifest: 'Manifest',
    character: '角色',
    weapon: '武器',
    echo: '声骸',
    sonata: '套装'
}
