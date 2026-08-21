// ── nanoka 纯转换函数单测（node:test） ─────────────────────────────────────
// 直接喂构造样本给 provider/nanoka/utils.ts 的纯函数，断言输出与
// $lib/api/types 规范化契约逐字段一致。不依赖网络。
// 通过 scripts/test/preload.mjs 解析 $lib/$app 别名。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
    transformCharacterList,
    transformWeaponList,
    transformEchoList,
    transformEchoSetList,
    transformCharacterInfo,
    transformCharacterInfoRich,
    transformWeaponInfo,
    transformEchoInfo,
    transformEchoSetInfo,
    ueToCdn
} from './utils.ts'
import {
    characterList,
    weaponList,
    echoList,
    sonata,
    characterDetail,
    weaponDetail,
    echoDetail,
    sonataDetail
} from './__fixtures__.ts'

describe('ueToCdn', () => {
    it('strips UE prefix and extension, appends .webp to asset base', () => {
        assert.equal(
            ueToCdn('/Game/Aki/UI/UI_Avatar/T1_DianZhu.UIIcon'),
            'https://static.nanoka.cc/assets/ww/UI_Avatar/T1_DianZhu.webp'
        )
    })

    it('returns empty string for falsy path', () => {
        assert.equal(ueToCdn(''), '')
    })
})

describe('transformCharacterList', () => {
    it('maps to Character[] with element/weapon resolved via maps', () => {
        const out = transformCharacterList(characterList)
        assert.equal(out.length, 2)
        assert.deepEqual(out, [
            { name: '漂泊者', star: 5, element: '湮灭', weaponType: '长刃' },
            { name: '忌炎', star: 5, element: '导电', weaponType: '迅刀' }
        ])
    })

    it('dedupes by Chinese name and skips entries without zh', () => {
        const dup = {
            a: { icon: 'x', rank: 4, weapon: 1, element: 1, zh: '忌炎' },
            b: { icon: 'y', rank: 5, weapon: 1, element: 1, zh: '忌炎' },
            c: { icon: 'z', rank: 5, weapon: 1, element: 1, zh: '' }
        }
        const out = transformCharacterList(dup)
        assert.equal(out.length, 1)
        assert.equal(out[0].name, '忌炎')
    })
})

describe('transformWeaponList', () => {
    it('maps to Weapon[] with weapon type resolved', () => {
        assert.deepEqual(transformWeaponList(weaponList), [
            { name: '往岁锚', star: 5, weaponType: '长刃' },
            { name: '锋砺裁', star: 4, weaponType: '迅刀' }
        ])
    })
})

describe('transformEchoList', () => {
    it('maps sonata groups to set names and intensity to cost', () => {
        assert.deepEqual(transformEchoList(echoList, sonata), [
            { name: '燎照之骑', sets: ['沉日劫明'], cost: 3 },
            { name: '阿嗄', sets: ['隐世回光'], cost: 1 }
        ])
    })
})

describe('transformEchoSetList', () => {
    it('extracts sorted piece counts per set', () => {
        const out = transformEchoSetList(sonata)
        assert.equal(out.length, 2)
        assert.deepEqual(out, [
            { name: '沉日劫明', pieces: [2, 5] },
            { name: '隐世回光', pieces: [2, 5] }
        ])
    })
})

describe('transformCharacterInfo', () => {
    it('produces normalized CharacterInfo with stripped plain text', () => {
        const out = transformCharacterInfo(characterDetail)
        assert.equal(out.rarity, 5)
        assert.equal(out.element, '导电')
        assert.equal(out.weaponType, '迅刀')
        assert.deepEqual(out.lv90BaseStats, { hp: 10000, atk: 340, def: 440, tuneBreakBoost: 10 })
        assert.deepEqual(out.statNodes, [{ name: '共鸣回路·律', desc: '层数叠加。' }])
        assert.deepEqual(out.chains, [{ name: '止戈', desc: '共鸣技能伤害30%' }])
        assert.equal(out.skills.length, 3)
    })

    it('strips rich-text tags and builds skill values incl. energy', () => {
        const out = transformCharacterInfo(characterDetail)
        const normal = out.skills.find((s) => s.name === '轻云起')
        assert.equal(normal?.desc, '连续挥砍，造成120%伤害')
        assert.deepEqual(normal?.values, [['一段', '120.00%', '导电', '0.05', undefined]])
        const outro = out.skills.find((s) => s.name === '苍云覆海')
        // 延奏技能无 level 数据：从 desc 文本推断出伤害条目（热熔元素）
        assert.deepEqual(outro?.values, [['延奏技能伤害', '200%', '热熔', undefined, undefined]])
    })

    it('sums energy/tune across multi-component (a+b) rows and returns the final total', () => {
        const out = transformCharacterInfo(characterDetail)
        const skill = out.skills.find((s) => s.name === '多段轰击')
        // 60.00%*2 → rate 6000/energy 50/weakness 1000；40.00%*3 → rate 4000/energy 30/weakness 800
        // energy = 0.5×2 + 0.3×3 = 1.9；tune = 10×2 + 8×3 = 44
        assert.deepEqual(skill?.values, [['共鸣技能伤害', '60.00%*2+40.00%*3', '导电', '1.9', '44']])
    })
})

describe('transformCharacterInfoRich', () => {
    it('keeps rich desc and matches base stats', () => {
        const out = transformCharacterInfoRich(characterDetail)
        assert.deepEqual(out.lv90BaseStats, { hp: 10000, atk: 340, def: 440, tuneBreakBoost: 10 })
        assert.deepEqual(out.statNodes, [{ name: '共鸣回路·律', desc: '层数叠加。' }])
        assert.deepEqual(out.chains, [{ name: '止戈', desc: '共鸣技能伤害30%' }])
    })
})

describe('transformWeaponInfo', () => {
    it('maps stats to lv90 atk and formats percent substat', () => {
        const out = transformWeaponInfo(weaponDetail)
        assert.equal(out.rarity, 5)
        assert.equal(out.type, '长刃')
        assert.equal(out.lv90BaseAtk, 1000)
        assert.deepEqual(out.substat, { name: '暴击', value: '0.24%' })
        assert.deepEqual(out.effect, { name: '定海神针', desc: '攻击提升15' })
    })
})

describe('transformEchoInfo', () => {
    it('interpolates skill desc, derives damage values and groups', () => {
        const out = transformEchoInfo(echoDetail, 1)
        assert.equal(out.cost, 3)
        assert.equal(out.skill.desc, '召唤坐骑冲撞，造成250%伤害')
        assert.deepEqual(out.skill.values, [['伤害1', '250.00%', '热熔']])
        assert.deepEqual(out.groups, ['沉日劫明'])
    })
})

describe('transformEchoSetInfo', () => {
    it('interpolates set bonuses by pieces', () => {
        assert.deepEqual(transformEchoSetInfo(sonataDetail, '11'), {
            bonuses: { 2: '气动伤害提升10%', 5: '湮灭伤害提升10%' }
        })
    })

    it('returns null for unknown set id', () => {
        assert.equal(transformEchoSetInfo(sonataDetail, '999'), null)
    })
})
