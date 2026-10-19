import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeDamageByCharacter } from '$lib/ai/result-summary'

const rows = [
    { character: '甲', totalDamage: 600 },
    { character: '乙', totalDamage: 300 },
    { character: '甲', totalDamage: 100 }
]

describe('get_result_summary 的角色聚合', () => {
    it('按角色汇总并按伤害降序，占比基于过滤后的总计', () => {
        const { total, characters } = summarizeDamageByCharacter(rows)
        assert.equal(total, 1000)
        assert.deepEqual(
            characters.map((c) => [c.character, c.totalDamage, c.entryCount, c.sharePct]),
            [
                ['甲', 700, 2, 70],
                ['乙', 300, 1, 30]
            ]
        )
        assert.equal(characters[0].share, 0.7)
    })

    it('character 过滤只统计目标角色，过滤不到时总伤害为 0 且不产生伪占比', () => {
        const hit = summarizeDamageByCharacter(rows, '乙')
        assert.equal(hit.total, 300)
        assert.equal(hit.filtered.length, 1)
        assert.deepEqual(
            hit.characters.map((c) => c.sharePct),
            [100]
        )

        const miss = summarizeDamageByCharacter(rows, '丙')
        assert.equal(miss.total, 0)
        assert.deepEqual(miss.filtered, [])
        assert.deepEqual(miss.characters, [])
    })
})
