// ── nanoka 适配器测试样本 ────────────────────────────────────────────────
// 代表性原始数据样本，用于对 pure transform 与 provider 高层方法做断言。
// 字段结构对齐 provider/nanoka/types.ts，值来自真实 nanoka 结构的近似构造。

import type {
    NanokaCharacter,
    NanokaWeapon,
    NanokaEcho,
    NanokaSonata,
    ZhCharacterDetail,
    ZhWeaponDetail,
    ZhEchoDetail,
    ZhSonataDetail
} from '$lib/api/provider/nanoka/types'

export const characterList: Record<string, NanokaCharacter> = {
    '1001': { icon: '/Game/Aki/UI/UI_Avatar/T1_DianZhu.UIIcon', rank: 5, weapon: 1, element: 6, zh: '漂泊者' },
    '1105': { icon: '/Game/Aki/UI/UI_Avatar/T2_LiGe.UIIcon', rank: 5, weapon: 2, element: 3, zh: '忌炎' }
}

export const weaponList: Record<string, NanokaWeapon> = {
    '2101': { icon: '/Game/Aki/UI/UI_Avatar/Weapon/T_W1.UIIcon', rank: 5, type: 1, zh: '往岁锚' },
    '2102': { icon: '/Game/Aki/UI/UI_Avatar/Weapon/T_W2.UIIcon', rank: 4, type: 2, zh: '锋砺裁' }
}

export const echoList: Record<string, NanokaEcho> = {
    '3101': {
        icon: '/Game/Aki/UI/UI_Avatar/Echo/T_E1.UIIcon',
        rank: [5, 5],
        group: [11],
        intensity: 1,
        zh: '燎照之骑'
    },
    '3102': { icon: '/Game/Aki/UI/UI_Avatar/Echo/T_E2.UIIcon', rank: [4, 4], group: [12], intensity: 0, zh: '阿嗄' }
}

export const sonata: NanokaSonata = {
    '11': {
        id: 11,
        icon: '/Game/Aki/UI/UI_Avatar/Sonata/T_S11.UIIcon',
        name: { zh: '沉日劫明' },
        set: { 2: {}, 5: {} }
    },
    '12': {
        id: 12,
        icon: '/Game/Aki/UI/UI_Avatar/Sonata/T_S12.UIIcon',
        name: { zh: '隐世回光' },
        set: { 2: {}, 5: {} }
    }
}

// ── character detail ──

const skillTreeLeaf = (node: Partial<ZhCharacterDetail['skill_trees'][string]> = {}) =>
    ({
        parent_nodes: [],
        node_type: 1,
        coordinate: 0,
        un_lock_condition: 0,
        skill_branch_ids: [],
        consume: [],
        skill: { name: '', type: '' },
        ...node
    }) as ZhCharacterDetail['skill_trees'][string]

export const characterDetail: ZhCharacterDetail = {
    id: 1105,
    rarity: 5,
    weapon: 2,
    element: 3,
    name: '忌炎',
    desc: '',
    icon: '/Game/Aki/UI/UI_Avatar/T2_LiGe.UIIcon',
    stats: {
        '5': { '80': { life: 9000, atk: 300, def: 400 }, '90': { life: 9500, atk: 320, def: 420 } },
        '6': { '90': { life: 10000, atk: 340, def: 440 } }
    },
    tag: { tune: { name: '震谐响应', desc: '', icon: '', color: '' } },
    skill_trees: {
        n1: skillTreeLeaf({
            node_type: 1,
            skill: {
                name: '轻云起',
                type: '常态攻击',
                desc: '连续挥砍，造成{0}%伤害',
                param: ['120'],
                level: {
                    '1': {
                        name: '一段',
                        param: [['120.00%'], ['140.00%']],
                        format: '{0}'
                    }
                },
                damage: {
                    d1: {
                        element: 3,
                        related_property: '攻击',
                        type: 0,
                        rate_lv: [12000],
                        energy: 5,
                        element_power: 0,
                        hardness_lv: 0,
                        tough_lv: 0,
                        weakness_lvl: 0
                    }
                }
            }
        }),
        n2: skillTreeLeaf({
            node_type: 4,
            skill: { name: '共鸣回路·律', type: '共鸣回路', desc: '层数叠加。' }
        }),
        nb: skillTreeLeaf({
            node_type: 3,
            skill: {
                name: '苍云覆海',
                type: '延奏技能',
                desc: '造成{0}%热熔伤害',
                param: ['200'],
                damage: {
                    d1: {
                        element: 2,
                        related_property: '攻击',
                        type: 0,
                        rate_lv: [20000],
                        energy: 0,
                        element_power: 0,
                        hardness_lv: 0,
                        tough_lv: 0,
                        weakness_lvl: 10
                    }
                }
            }
        })
    },
    chains: {
        c1: { name: '止戈', desc: '共鸣技能伤害{0}%', param: ['30'], icon: '' }
    },
    recommend: { weapon: [2101] }
}

export const weaponDetail: ZhWeaponDetail = {
    id: 2101,
    rarity: 5,
    type: 1,
    name: '往岁锚',
    desc: '',
    icon: '/Game/Aki/UI/UI_Avatar/Weapon/T_W1.UIIcon',
    stats: {
        '6': {
            '90': [
                { name: '攻击', value: 1000, is_ratio: false, is_percent: false },
                { name: '暴击', value: 24.2, is_ratio: true, is_percent: true }
            ]
        }
    },
    effect: '攻击提升{0}',
    effect_name: '定海神针',
    param: [['15']]
}

export const echoDetail: ZhEchoDetail = {
    id: 3101,
    name: '燎照之骑',
    rarity: [5, 5],
    intensity: 1,
    icon: '/Game/Aki/UI/UI_Avatar/Echo/T_E1.UIIcon',
    skill: {
        desc: '召唤坐骑冲撞，造成{0}%伤害',
        simple_desc: '',
        param: [['250']],
        icon: '',
        damage: {
            d1: {
                element: 2,
                related_property: '攻击',
                type: 0,
                rate_lv: [25000],
                energy: 0,
                element_power: 0,
                hardness_lv: 0,
                tough_lv: 0,
                weakness_lvl: 0
            }
        }
    },
    group: {
        g1: { id: 11, name: '沉日劫明', icon: '', color: '', set: {} }
    }
}

export const sonataDetail: ZhSonataDetail = {
    '11': {
        id: 11,
        name: '沉日劫明',
        icon: '',
        color: '',
        set: {
            '2': { desc: '气动伤害提升{0}%', param: ['10'] },
            '5': { desc: '湮灭伤害提升{0}%', param: ['10'] }
        }
    }
}
