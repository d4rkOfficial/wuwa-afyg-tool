export interface Endpoint {
    method: string
    path: string
    summary?: string
}

export interface EndpointGroup {
    name: string
    label?: string
    endpoints: Endpoint[]
}

export const CHAR_INFO = '/api/v1/info/character/{name}'
export const WEAPON_INFO = '/api/v1/info/weapon/{name}'
export const ECHO_INFO = '/api/v1/info/echo/{name}'
export const SET_INFO = '/api/v1/info/echo-set/{name}'

const VERSION_LATEST = '/api/v1/version/latest'
const VERSION_AVAILABLE = '/api/v1/version/available'

export const endpointGroups: EndpointGroup[] = [
    {
        name: 'system',
        label: '游戏版本',
        endpoints: [
            { method: 'GET', path: VERSION_LATEST, summary: '获取最新游戏版本' },
            { method: 'GET', path: VERSION_AVAILABLE, summary: '获取所有可用游戏版本' }
        ]
    },
    {
        name: 'list',
        label: '列表',
        endpoints: [
            { method: 'GET', path: '/api/v1/list/character', summary: '获取角色列表' },
            { method: 'GET', path: '/api/v1/list/weapon', summary: '获取武器列表' },
            { method: 'GET', path: '/api/v1/list/echo', summary: '获取声骸列表' },
            { method: 'GET', path: '/api/v1/list/echo-set', summary: '获取声骸套装列表' }
        ]
    },
    {
        name: 'icons',
        label: '图标',
        endpoints: [
            { method: 'GET', path: '/api/v1/icons/character', summary: '角色名称和头像图标' },
            { method: 'GET', path: '/api/v1/icons/weapon', summary: '武器名称和图标' },
            { method: 'GET', path: '/api/v1/icons/echo', summary: '声骸名称和图标' },
            { method: 'GET', path: '/api/v1/icons/element', summary: '6 种属性图标' },
            { method: 'GET', path: '/api/v1/icons/weapon-type', summary: '5 种武器类型图标' },
            { method: 'GET', path: '/api/v1/icons/echo-set', summary: '声骸套装图标' },
            { method: 'GET', path: '/api/v1/icons/ui-btn', summary: '操作键鼠图标' }
        ]
    },
    {
        name: 'info',
        label: '详情',
        endpoints: [
            { method: 'GET', path: CHAR_INFO, summary: '角色详情（面板+技能+共鸣链）' },
            { method: 'GET', path: WEAPON_INFO, summary: '武器详情（面板+特效）' },
            { method: 'GET', path: ECHO_INFO, summary: '声骸详情（技能+套装）' },
            { method: 'GET', path: SET_INFO, summary: '声骸套装详情（套装效果）' }
        ]
    }
]

export const typeMap: Record<string, { name: string; code: string }> = {
    [VERSION_LATEST]: {
        name: 'version',
        code: 'type version = string'
    },
    [VERSION_AVAILABLE]: {
        name: 'versions',
        code: 'type versions = string[]'
    },
    '/api/v1/list/character': {
        name: 'Character',
        code: 'interface Character {\n    name: string;\n    star: number;\n    element: string;\n    weaponType: string;\n}'
    },
    '/api/v1/list/weapon': {
        name: 'Weapon',
        code: 'interface Weapon {\n    name: string;\n    star: number;\n    weaponType: string;\n}'
    },
    '/api/v1/list/echo': {
        name: 'Echo',
        code: 'interface Echo {\n    name: string;\n    sets: string[];\n    cost: number;\n}'
    },
    '/api/v1/list/echo-set': {
        name: 'EchoSetItem',
        code: 'interface EchoSetItem {\n    name: string;\n    pieces: number[];\n}'
    },
    '/api/v1/icons/character': {
        name: 'CharacterIcons',
        code: 'type CharacterIcons = Record<string, string>;'
    },
    '/api/v1/icons/weapon': {
        name: 'WeaponIcons',
        code: 'type WeaponIcons = Record<string, string>;'
    },
    '/api/v1/icons/echo': {
        name: 'EchoIcons',
        code: 'type EchoIcons = Record<string, string>;'
    },
    '/api/v1/icons/element': {
        name: 'ElementIcons',
        code: 'type ElementIcons = Record<string, string>;'
    },
    '/api/v1/icons/weapon-type': {
        name: 'WeaponTypeIcons',
        code: 'type WeaponTypeIcons = Record<string, string>;'
    },
    '/api/v1/icons/echo-set': {
        name: 'EchoSetIcons',
        code: 'type EchoSetIcons = Record<string, string>;'
    },
    '/api/v1/icons/ui-btn': {
        name: 'UiBtnIcons',
        code: 'type UiBtnIcons = Record<string, string>;'
    },
    [CHAR_INFO]: {
        name: 'CharacterInfo',
        code: "interface CharacterInfo {\n    rarity: 4 | 5\n    element: '冷凝' | '热熔' | '导电' | '气动' | '衍射' | '湮灭'\n    weaponType: '长刃' | '迅刀' | '佩枪' | '臂铠' | '音感仪'\n    lv90BaseStats: {\n        hp: number\n        atk: number\n        def: number\n        tune: number\n    }\n    skills: SkillEntry[]\n    statNodes: StatNode[]\n    chains: ResonanceChain[]\n}"
    },
    [WEAPON_INFO]: {
        name: 'WeaponInfo',
        code: "interface WeaponInfo {\n    rarity: 1 | 2 | 3 | 4 | 5\n    type: '长刃' | '迅刀' | '佩枪' | '臂铠' | '音感仪'\n    lv90BaseAtk: number\n    substat: {\n        name: string\n        value: string\n    }\n    effect: {\n        name: string\n        desc: string\n    }\n}"
    },
    [ECHO_INFO]: {
        name: 'EchoInfo',
        code: 'interface EchoInfo {\n    cost: number\n    skill: { desc: string; values: [string, string, string][] }\n    groups: string[]\n}'
    },
    [SET_INFO]: {
        name: 'EchoSetInfo',
        code: 'interface EchoSetInfo {\n    bonuses: Record<string, string>\n}'
    }
}

export const DEFAULTS: Record<string, string> = {
    [CHAR_INFO]: '散华',
    [WEAPON_INFO]: '裁竹',
    [ECHO_INFO]: '无常凶鹭',
    [SET_INFO]: '轻云出月'
}
