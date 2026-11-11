// 短索引（shortKey）纯函数回归：稳定性与形状是全部下游（摘要、工具寻址、报错清单）的地基。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { SHORT_KEY_LEN, shortKeyOf } from '$lib/ai/short-key'

describe('shortKeyOf：稳定、定长、无状态', () => {
    it('同一个 id 永远得到同一个值（跨调用、与顺序无关）', () => {
        const first = shortKeyOf('b1731234567890')
        assert.equal(shortKeyOf('b1731234567890'), first)
        assert.equal(shortKeyOf('b1731234567890'), first)
        // 与顺序无关：先算谁后算谁都不影响
        shortKeyOf('left')
        shortKeyOf('right')
        assert.equal(shortKeyOf('b1731234567890'), first)
    })

    it('定长、base36 小写字母数字（可直接当 token 抄写）', () => {
        for (const id of ['b1731234567890', 'c1731234567890-7', 'left', 'right', 'x', '']) {
            const key = shortKeyOf(id)
            assert.equal(key.length, SHORT_KEY_LEN, `${id} → ${key}`)
            assert.match(key, /^[0-9a-z]{5}$/)
        }
    })

    it('近似 id 也要分散开（不因共享前缀而聚集）', () => {
        const keys = new Set(['b1731234567890', 'b1731234567891', 'b1731234567892'].map(shortKeyOf))
        assert.equal(keys.size, 3, '只差末位的 id 不能撞在一起')
        // 高位截断会把熵压成 4 位（32 位哈希 base36 的第 7 位恒为 0/1），这里确认首位不是全是 0/1
        const firsts = new Set(
            Array.from({ length: 200 }, (_, i) => shortKeyOf(`b${1731234567890 + i}`)[0]).filter(Boolean)
        )
        assert.ok(firsts.size > 4, `首位应有足够分散度，实际只有 ${firsts.size} 种`)
    })

    it('已知值固定在案（改算法会立刻暴露）', () => {
        assert.equal(shortKeyOf('left'), '2pxm8')
        assert.equal(shortKeyOf('right'), 'jidwl')
        assert.equal(shortKeyOf('b1731234567890'), 'xlm8n')
    })

    it('已知碰撞对在案（供解析侧碰撞检测用例引用）', () => {
        assert.equal(shortKeyOf('op-7447'), shortKeyOf('op-59200'))
    })
})
