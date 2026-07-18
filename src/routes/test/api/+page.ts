const CHAR_INFO = '/api/v1/info/character/{name}'
const WEAPON_INFO = '/api/v1/info/weapon/{name}'
const ECHO_INFO = '/api/v1/info/echo/{name}'
const SET_INFO = '/api/v1/info/echo-set/{name}'

export function load() {
    return {
        endpointGroups: [
            {
                name: 'List',
                label: 'List',
                endpoints: [
                    { method: 'GET', path: '/api/v1/list/character', summary: '获取角色列表' },
                    { method: 'GET', path: '/api/v1/list/weapon', summary: '获取武器列表' },
                    { method: 'GET', path: '/api/v1/list/echo', summary: '获取声骸列表' },
                    {
                        method: 'GET',
                        path: '/api/v1/list/echo-set',
                        summary: '获取声骸套装列表（含所需部件数）'
                    }
                ]
            },
            {
                name: 'Icons',
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
                name: 'Info',
                label: '详情',
                endpoints: [
                    { method: 'GET', path: CHAR_INFO, summary: '角色详情（面板+技能+共鸣链）' },
                    { method: 'GET', path: WEAPON_INFO, summary: '武器详情（面板+特效）' },
                    { method: 'GET', path: ECHO_INFO, summary: '声骸详情（技能+套装）' },
                    { method: 'GET', path: SET_INFO, summary: '声骸套装详情（套装效果）' }
                ]
            }
        ],
        typeMap: {
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
            '/api/v1/icons/character': {
                name: 'CharacterIcons',
                code: 'type CharacterIcons = [name: string, iconUrl: string][];'
            },
            '/api/v1/icons/weapon': {
                name: 'WeaponIcons',
                code: 'type WeaponIcons = [name: string, iconUrl: string][];'
            },
            '/api/v1/icons/echo': {
                name: 'EchoIcons',
                code: 'type EchoIcons = [name: string, iconUrl: string][];'
            },
            '/api/v1/list/echo-set': {
                name: 'EchoSetItem',
                code: 'interface EchoSetItem {\n    name: string;\n    pieces: number[];\n}'
            },
            '/api/v1/icons/element': {
                name: 'ElementIcons',
                code: 'type ElementIcons = [elementName: string, iconUrl: string][];'
            },
            '/api/v1/icons/weapon-type': {
                name: 'WeaponTypeIcons',
                code: 'type WeaponTypeIcons = [typeName: string, iconUrl: string][];'
            },
            '/api/v1/icons/echo-set': {
                name: 'EchoSetIcons',
                code: 'type EchoSetIcons = [setName: string, iconUrl: string][];'
            },
            '/api/v1/icons/ui-btn': {
                name: 'UiBtnIcons',
                code: 'type UiBtnIcons = [keyName: string, iconUrl: string][];'
            },
            [CHAR_INFO]: {
                name: 'CharacterInfo',
                code: "interface CharacterInfo {\n    rarity: 4 | 5\n    element: '冷凝' | '热熔' | '导电' | '气动' | '衍射' | '湮灭'\n    weaponType: '长刃' | '迅刀' | '佩枪' | '臂铠' | '音感仪'\n    lv90BaseStats: {\n        hp: number\n        atk: number\n        def: number\n        tune: number\n    }\n    skills: SkillEntry[]\n    statNodes: StatNode[]\n    chains: ResonanceChain[]\n}\n\ninterface SkillEntry {\n    name: string\n    type: '常态攻击' | '共鸣技能' | '共鸣解放' | '共鸣回路' | '变奏技能' | '延奏技能' | '谐度破坏'\n    desc: string\n    values: [name: string, value: string, element: string][]\n}\n\ninterface StatNode {\n    name: string\n    desc: string\n}\n\ninterface ResonanceChain {\n    name: string\n    desc: string\n}"
            },
            [WEAPON_INFO]: {
                name: 'WeaponInfo',
                code: "interface WeaponInfo {\n    rarity: 1 | 2 | 3 | 4 | 5\n    type: '长刃' | '迅刀' | '佩枪' | '臂铠' | '音感仪'\n    lv90BaseAtk: number\n    substat: {\n        name: string\n        value: string\n    }\n    effect: {\n        name: string\n        desc: string\n    }\n}"
            },
            [ECHO_INFO]: {
                name: 'EchoInfo',
                code: 'interface EchoInfo {\n    cost: number\n    skill: { desc: string; values: [name: string, value: string, element: string][] }\n    groups: string[]\n}'
            },
            [SET_INFO]: {
                name: 'EchoSetInfo',
                code: 'interface EchoSetInfo {\n    bonuses: Record<string, string>\n}'
            }
        }
    }
}
