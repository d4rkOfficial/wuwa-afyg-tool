// ── nanoka 译文覆盖层单测 ────────────────────────────────────────────────
// 前置：utils 的中文转换负责全部数值/结构计算，本层只覆盖展示文本。
// 断言「中文结果 + 目标语言详情」→ 目标语言文本，且缺失字段回退中文。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
    localizeCharacterInfo,
    localizeEchoInfo,
    localizeEchoSetInfo,
    localizeWeaponInfo,
    translateSyntheticLabel
} from '$lib/api/provider/nanoka/i18n'
import {
    transformCharacterInfo,
    transformEchoInfo,
    transformEchoSetInfo,
    transformWeaponInfo
} from '$lib/api/provider/nanoka/utils'
import type { ZhCharacterDetail, ZhEchoDetail, ZhSonataDetail, ZhWeaponDetail } from '$lib/api/provider/nanoka/types'
import { characterDetail, echoDetail, sonataDetail, weaponDetail } from './__fixtures__.ts'

const localizedCharacter: ZhCharacterDetail = {
    ...characterDetail,
    tag: {
        ...characterDetail.tag,
        '33': {
            ...characterDetail.tag['33'],
            name: 'Tune Rupture Response',
            desc: 'Deals Tune Rupture DMG'
        }
    },
    skill_trees: {
        ...characterDetail.skill_trees,
        n1: {
            ...characterDetail.skill_trees.n1,
            skill: {
                ...characterDetail.skill_trees.n1.skill,
                name: 'Frosty Light',
                type: 'Normal Attack',
                desc: 'Slash for {0}% DMG',
                param: ['120'],
                level: { '1': { name: 'Stage One', param: [['120.00%']], format: null } },
                damage: { d1: { ...characterDetail.skill_trees.n1.skill.damage!.d1, related_property: 'ATK' } }
            }
        },
        n2: {
            ...characterDetail.skill_trees.n2,
            skill: { ...characterDetail.skill_trees.n2.skill, name: 'Forte Circuit Law', desc: 'Stacks up.' }
        },
        nb: {
            ...characterDetail.skill_trees.nb,
            skill: {
                ...characterDetail.skill_trees.nb.skill,
                name: 'Sea of Clouds',
                type: 'Outro Skill',
                desc: 'Deal {0}% Fusion DMG',
                param: ['200']
            }
        },
        n3: {
            ...characterDetail.skill_trees.n3,
            skill: {
                ...characterDetail.skill_trees.n3.skill,
                name: 'Multi Strike',
                type: 'Resonance Skill',
                desc: 'Deal {0}%+{1}% DMG',
                param: ['60', '40']
            }
        }
    },
    chains: {
        c1: { ...characterDetail.chains.c1, name: 'Cease Fire', desc: 'Resonance Skill DMG {0}%', param: ['30'] }
    }
}

describe('translateSyntheticLabel', () => {
    it('translates fixed skill value labels', () => {
        assert.equal(translateSyntheticLabel('共鸣技能伤害', 'en'), 'Resonance Skill DMG')
        assert.equal(translateSyntheticLabel('共鸣解放伤害', 'ja'), '共鳴解放ダメージ')
        assert.equal(translateSyntheticLabel('延奏技能伤害', 'ko'), '반주 스킬 피해')
    })

    it('translates parameterized labels', () => {
        assert.equal(translateSyntheticLabel('常态攻击第2段伤害', 'en'), 'Basic Attack Stage 2 DMG')
        assert.equal(translateSyntheticLabel('常态攻击第2段伤害', 'ja'), '通常攻撃第2段ダメージ')
        assert.equal(translateSyntheticLabel('伤害3', 'ko'), '피해 3')
    })

    it('returns the original text for Chinese / unknown languages / unmapped labels', () => {
        assert.equal(translateSyntheticLabel('共鸣技能伤害', 'zh'), '共鸣技能伤害')
        assert.equal(translateSyntheticLabel('共鸣技能伤害', 'fr'), '共鸣技能伤害')
        assert.equal(translateSyntheticLabel('未映射标签', 'en'), '未映射标签')
    })
})

describe('localizeCharacterInfo', () => {
    const zhInfo = transformCharacterInfo(characterDetail)

    it('keeps Chinese computation and overlays localized display text', () => {
        const out = localizeCharacterInfo(zhInfo, characterDetail, localizedCharacter, 'en', false)
        assert.equal(out.element, 'Electro')
        assert.equal(out.weaponType, 'Sword')
        assert.equal(out.lv90BaseStats.tuneBreakBoost, 10)
        assert.equal(out.tags.find((t) => t.id === '33')?.name, 'Tune Rupture Response')
        assert.equal(out.tags.find((t) => t.id === '33')?.desc, 'Deals Tune Rupture DMG')

        const normal = out.skills.find((s) => s.name === 'Frosty Light')
        assert.equal(normal?.type, 'Normal Attack')
        assert.equal(normal?.desc, 'Slash for 120% DMG')
        assert.equal(normal?.values[0][0], 'Stage One')
        assert.equal(normal?.values[0][2], 'Electro')
        assert.equal((normal?.damage as Record<string, { related_property: string }>).d1.related_property, 'ATK')

        const outro = out.skills.find((s) => s.name === 'Sea of Clouds')
        assert.equal(outro?.type, 'Outro Skill')
        assert.equal(outro?.desc, 'Deal 200% Fusion DMG')

        assert.equal(out.statNodes[0].name, 'Forte Circuit Law')
        assert.equal(out.chains[0].name, 'Cease Fire')
        assert.equal(out.chains[0].desc, 'Resonance Skill DMG 30%')
    })

    it('keeps rich-text desc when rich=true', () => {
        const out = localizeCharacterInfo(zhInfo, characterDetail, localizedCharacter, 'en', true)
        assert.equal(out.skills.find((s) => s.name === 'Frosty Light')?.desc, 'Slash for 120% DMG')
    })

    it('is a no-op for Chinese', () => {
        assert.deepEqual(localizeCharacterInfo(zhInfo, characterDetail, characterDetail, 'zh', false), zhInfo)
    })
})

describe('localizeWeaponInfo', () => {
    it('overlays substat / effect text, keeps computed numbers', () => {
        const localizedWeapon: ZhWeaponDetail = {
            ...weaponDetail,
            effect: 'ATK +{0}',
            effect_name: 'Sea Anchor',
            param: [['15']],
            stats: {
                '6': {
                    '90': [
                        { name: 'ATK', value: 1000, is_ratio: false, is_percent: false },
                        { name: 'Crit Rate', value: 24.2, is_ratio: true, is_percent: true }
                    ]
                }
            }
        }
        const out = localizeWeaponInfo(transformWeaponInfo(weaponDetail), localizedWeapon, 'en')
        assert.equal(out.type, 'Broadblade')
        assert.equal(out.lv90BaseAtk, 1000)
        assert.equal(out.substat.name, 'Crit Rate')
        assert.equal(out.substat.value, '0.24%')
        assert.deepEqual(out.effect, { name: 'Sea Anchor', desc: 'ATK +15' })
    })
})

describe('localizeEchoInfo', () => {
    const localizedEcho: ZhEchoDetail = {
        ...echoDetail,
        skill: {
            ...echoDetail.skill,
            desc: 'Summon a mount, dealing {0}% DMG',
            param: [['250']],
            damage: {
                d1: { ...echoDetail.skill.damage!.d1, related_property: 'ATK' }
            }
        },
        group: {
            g1: { ...echoDetail.group.g1, name: 'Sinking Sun' }
        }
    }

    it('overlays desc / group / damage label text', () => {
        const out = localizeEchoInfo(transformEchoInfo(echoDetail, 1), echoDetail, localizedEcho, 'en')
        assert.equal(out.cost, 3)
        assert.equal(out.skill.desc, 'Summon a mount, dealing 250% DMG')
        assert.deepEqual(out.groups, ['Sinking Sun'])
        assert.equal(out.skill.values[0][0], 'DMG 1')
        assert.equal(out.skill.values[0][1], '250.00%')
        assert.equal(out.skill.values[0][2], 'Fusion')
    })
})

describe('localizeEchoSetInfo', () => {
    it('overlays bonus desc by piece count', () => {
        const localizedSet: ZhSonataDetail = {
            '11': {
                ...sonataDetail['11'],
                set: {
                    '2': { desc: 'Aero DMG +{0}%', param: ['10'] },
                    '5': { desc: 'Havoc DMG +{0}%', param: ['10'] }
                }
            }
        }
        const out = localizeEchoSetInfo(
            transformEchoSetInfo(sonataDetail, '11')!,
            '11',
            sonataDetail,
            localizedSet,
            'en'
        )
        assert.deepEqual(out.bonuses, { 2: 'Aero DMG +10%', 5: 'Havoc DMG +10%' })
    })
})
