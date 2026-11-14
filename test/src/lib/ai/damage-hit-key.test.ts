// 直伤命中「稳定标识」回归：hitKey 由命中身份派生，其它命中增删或自身改倍率/属性/段数都不变。
//
// 用 hitIndex（数组下标）会失效：读完之后另一条命中被解绑 → 下标整体前移 → update_damage_hit 改错条目。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { damageHitKeys, resolveDamageHitKey } from '$lib/ai/damage-hit-key'
import type { SkillHit } from '$lib/calc/timeline.types'

const hit = (hitName: string, over: Partial<SkillHit> = {}): SkillHit => ({
    character: '甲',
    skillType: '共鸣技能',
    hitName,
    ratio: '100%',
    element: '冷凝',
    ...over
})

describe('damageHitKeys：按身份派生', () => {
    it('同一批命中两次调用得到同一组标识（纯函数）', () => {
        const hits = [hit('共鸣技能伤害'), hit('延奏技能伤害')]
        assert.deepEqual(damageHitKeys(hits), damageHitKeys(hits))
        assert.equal(damageHitKeys(hits).length, hits.length, '与 skillHits 同序且等长')
    })

    it('改倍率 / 属性 / 段数不改变标识（update_damage_hit 后可复用同一个 hitKey）', () => {
        const before = damageHitKeys([hit('共鸣技能伤害')])[0]
        const after = damageHitKeys([{ ...hit('共鸣技能伤害'), ratio: '250%攻击', element: '热熔', hits: 3 }])[0]
        assert.equal(after, before)
    })

    it('前面的**其它**命中被删除后，后面的标识不变（hitIndex 会错位，这里不会）', () => {
        const hits = [hit('共鸣技能伤害'), hit('延奏技能伤害'), hit('声骸技能伤害')]
        const keys = damageHitKeys(hits)
        const withoutFirst = damageHitKeys(hits.slice(1))
        assert.deepEqual(withoutFirst, keys.slice(1), '剩余命中的标识原样保留')
        // 用标识仍能定位到同一个命中（下标从 1 变成 0，但标识不变）
        assert.equal(resolveDamageHitKey(hits, keys[1]), 1)
        assert.equal(resolveDamageHitKey(hits.slice(1), keys[1]), 0)
    })

    it('同名同技能的重复绑定用序号区分，删掉其中一条不影响另一条', () => {
        const hits = [hit('共鸣技能伤害'), hit('共鸣技能伤害')]
        const keys = damageHitKeys(hits)
        assert.notEqual(keys[0], keys[1], '两条相同身份不能共用标识')
        assert.equal(resolveDamageHitKey(hits, keys[0]), 0)
        assert.equal(resolveDamageHitKey(hits, keys[1]), 1)
        // 删掉第一条后，剩下那条的标识变成「同名第 1 条」——这是同名重复绑定的固有边界，可接受
        assert.deepEqual(damageHitKeys([hits[1]]), [keys[0]])
    })

    it('身份含角色与技能类型：不同角色/类型的同名命中不共用标识', () => {
        const keys = damageHitKeys([
            hit('共鸣技能伤害'),
            hit('共鸣技能伤害', { character: '乙' }),
            hit('共鸣技能伤害', { skillType: '共鸣解放' })
        ])
        assert.equal(new Set(keys).size, 3)
    })
})

describe('resolveDamageHitKey：定位与报错', () => {
    it('按标识取下标（0 起）', () => {
        const hits = [hit('共鸣技能伤害'), hit('延奏技能伤害')]
        const keys = damageHitKeys(hits)
        assert.equal(resolveDamageHitKey(hits, keys[0]), 0)
        assert.equal(resolveDamageHitKey(hits, keys[1]), 1)
    })

    it('未知标识报错并给出可选清单', () => {
        const hits = [hit('共鸣技能伤害')]
        assert.throws(
            () => resolveDamageHitKey(hits, 'zzzzz'),
            (e: Error) => {
                assert.match(e.message, /未找到命中「zzzzz」/)
                assert.match(e.message, /甲·共鸣技能伤害/, '清单里给出角色·命中名')
                return true
            }
        )
    })

    it('空标识给出用法提示', () => {
        assert.throws(() => resolveDamageHitKey([hit('共鸣技能伤害')], undefined), /缺少命中标识/)
        assert.throws(() => resolveDamageHitKey([hit('共鸣技能伤害')], '   '), /缺少命中标识/)
    })
})
