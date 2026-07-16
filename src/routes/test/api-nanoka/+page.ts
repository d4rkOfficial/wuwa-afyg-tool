export interface TestEndpoint {
    method: string
    path: string
    summary?: string
}

export interface PageData {
    endpointGroups: { name: string; label: string; endpoints: TestEndpoint[] }[]
    typeMap: Record<string, { name: string; code: string }>
}

const MANIFEST = '/manifest.json'
const CHAR = '/ww/{version}/character.json'
const WEAPON = '/ww/{version}/weapon.json'
const ECHO = '/ww/{version}/echo.json'
const SONATA = '/ww/{version}/sonata.json'

const CHAR_INFO = '/ww/{version}/zh/character/{id}.json'
const WEAPON_INFO = '/ww/{version}/zh/weapon/{id}.json'
const ECHO_INFO = '/ww/{version}/zh/echo/{id}.json'
const SET_INFO = '/ww/{version}/zh/sonata.json'

export function load(): PageData {
    return {
        endpointGroups: [
            {
                name: 'Manifest',
                label: '元数据',
                endpoints: [{ method: 'GET', path: MANIFEST, summary: '版本索引' }]
            },
            {
                name: 'Data',
                label: '原始数据',
                endpoints: [
                    { method: 'GET', path: CHAR, summary: '角色原始数据' },
                    { method: 'GET', path: WEAPON, summary: '武器原始数据' },
                    { method: 'GET', path: ECHO, summary: '声骸原始数据' },
                    { method: 'GET', path: SONATA, summary: '声骸套装原始数据' }
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
            [MANIFEST]: {
                name: 'Manifest',
                code: 'interface Manifest {\n    ww: {\n        latest: string;\n        available: string[];\n    }\n}'
            },
            [CHAR]: {
                name: 'CharacterEntry (raw)',
                code: 'interface CharacterEntry {\n    icon: string;\n    rank: number;\n    weapon: number;\n    element: number;\n    zh: string;\n    en: string;\n}'
            },
            [WEAPON]: {
                name: 'WeaponEntry (raw)',
                code: 'interface WeaponEntry {\n    icon: string;\n    rank: number;\n    type: number;\n    zh: string;\n    en: string;\n    atk: number;\n    sub: string;\n}'
            },
            [ECHO]: {
                name: 'EchoEntry (raw)',
                code: 'interface EchoEntry {\n    icon: string;\n    rank: number[];\n    group: number[];\n    intensity: number;\n    zh: string;\n    en: string;\n    phantom?: string;\n}'
            },
            [SONATA]: {
                name: 'SonataSet (raw)',
                code: 'interface SonataSet {\n    id: number;\n    icon: string;\n    name: { zh: string; en: string };\n    set: Record<string, unknown>;\n}'
            },
            [CHAR_INFO]: {
                name: 'CharacterDetail',
                code: "interface CharacterDetail {\n    id: number\n    rarity: 4 | 5\n    weapon: 1 | 2 | 3 | 4 | 5  // 长刃|迅刀|佩枪|臂铠|音感仪\n    element: 1 | 2 | 3 | 4 | 5 | 6  // 冷凝|热熔|导电|气动|衍射|湮灭\n    name: string\n    icon: string\n    tags: Record<string, { name: string; desc: string }>\n    stats: Record<ascension, Record<level, { life: number; atk: number; def: number }>>\n    skill_trees: Record<string, SkillTreeNode>\n}\n\ninterface SkillTreeNode {\n    node_type: 1 | 2 | 3 | 4  // 共鸣回路|技能|属性节点|共鸣链\n    skill: {\n        name: string\n        desc: string\n        type: '常态攻击' | '共鸣技能' | '共鸣解放' | '共鸣回路' | '变奏技能' | '延奏技能'\n        level?: Record<number, { name: string; param: string[][] }>\n    }\n    consume: { key: number; value: number }[]\n}"
            },
            [WEAPON_INFO]: {
                name: 'WeaponDetail',
                code: 'interface WeaponDetail {\n    id: number\n    rarity: 4 | 5\n    type: 1 | 2 | 3 | 4 | 5  // 长刃|迅刀|佩枪|臂铠|音感仪\n    name: string\n    icon: string\n    stats: Record<ascension, Record<level, { name: string; value: number; is_percent: boolean }[]>>\n    effect: string\n    effect_name: string\n    param: string[][]  // 精炼参数\n}'
            },
            [ECHO_INFO]: {
                name: 'EchoDetail',
                code: 'interface EchoDetail {\n    id: number\n    name: string\n    rarity: (4 | 5)[]\n    intensity: 0 | 1 | 2 | 3  // cost: 0→1 1→3 2→4 3→4\n    icon: string\n    skill: {\n        desc: string\n        simple_desc: string\n        param: string[][]\n    }\n    group: Record<group_id, SonataGroup>\n}\n\ninterface SonataGroup {\n    id: number\n    name: string\n    icon: string\n    set: Record<piece_count, { desc: string; param: string[] }>\n}'
            },
            [SET_INFO]: {
                name: 'SonataData',
                code: 'Record<set_id, {\n    id: number\n    name: string\n    icon: string\n    set: Record<piece_count, {\n        desc: string\n        param: string[]\n    }>\n}>'
            }
        }
    }
}
