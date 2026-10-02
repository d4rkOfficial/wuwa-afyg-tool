// ── T12 抽出的速查纯函数：与「抽取前内联实现」逐例等价 ───────────────────────
// 这三个函数原本内联在 `quick-lookup-content.svelte`（该组件依赖 {@html} 与 DOM 滚动容器，
// 起不了 SSR 断言），故抽出后必须用**行为等价测试**补上原来的空缺。
import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'
import {
    mergeTriggerSets,
    compareStatAttrs,
    formatSubstatValue
} from '$lib/components/page/home/quick-lookup/quick-lookup.utils'

// ── 参照实现：逐字复刻抽取前的内联版本 ──
const oldMerge = (
    sets: readonly { name: string; pieces: number }[],
    bonusOf: (i: number) => Record<string, string>
) => {
    const merged = new Map<string, { name: string; pieces: number[]; bonuses: Record<string, string> }>()
    for (let i = 0; i < sets.length; i++) {
        const s = sets[i]
        const r = bonusOf(i)
        const bonuses = r
        const ex = merged.get(s.name)
        if (ex) {
            ex.pieces.push(s.pieces)
        } else {
            merged.set(s.name, { name: s.name, pieces: [s.pieces], bonuses })
        }
    }
    return [...merged.values()].filter((s) => Object.keys(s.bonuses).length > 0)
}

const oldCompare = (a: { name: string; desc?: string }, b: { name: string; desc?: string }) => {
    if (a.name < b.name) return -1
    if (a.name > b.name) return 1
    const numA = parseFloat(a.desc?.match(/[\d.]+/)?.[0] ?? '0')
    const numB = parseFloat(b.desc?.match(/[\d.]+/)?.[0] ?? '0')
    return numA - numB
}

const oldFmt = (v: string) => {
    const n = parseFloat(v)
    if (isNaN(n) || n >= 1) return v
    return (n * 100).toFixed(1) + '%'
}

describe('T12 quick-lookup 纯函数（抽取等价性）', () => {
    it('mergeTriggerSets：同名多件数合并，且丢弃无加成的套装', () => {
        // 真实场景：set-picker 选 5 件套会刻意写 {name,5} + {name,2}
        const sets = [
            { name: '沉日劫明', pieces: 5 },
            { name: '沉日劫明', pieces: 2 },
            { name: '隐世回光', pieces: 2 },
            { name: '无加成套装', pieces: 2 }
        ]
        const bonuses: Record<string, string>[] = [
            { 2: 'x', 5: 'y' },
            { 2: 'x', 5: 'y' }, // 同名的第二次查询结果一致
            { 2: 'z' },
            {} // 无加成 → 应被过滤
        ]
        const got = mergeTriggerSets(sets, (i) => bonuses[i])
        const want = oldMerge(sets, (i) => bonuses[i])
        assert.deepEqual(got, want)
        // 显式锁语义（避免「等价但都错」）：
        assert.equal(got.length, 2, '无加成的套装必须被丢弃')
        assert.deepEqual(got[0], { name: '沉日劫明', pieces: [5, 2], bonuses: { 2: 'x', 5: 'y' } })
        assert.deepEqual(got[1].pieces, [2])
    })

    it('mergeTriggerSets：空列表与全无加成列表都返回空数组', () => {
        assert.deepEqual(
            mergeTriggerSets([], () => ({})),
            []
        )
        assert.deepEqual(
            mergeTriggerSets([{ name: 'A', pieces: 2 }], () => ({})),
            []
        )
    })

    it('compareStatAttrs：先按名称，再按 desc 首个数字', () => {
        const list = [
            { name: '乙', desc: '提升 10 点' },
            { name: '甲', desc: '提升 2 点' },
            { name: '乙', desc: '提升 4 点' },
            { name: '丙' } // 无 desc → 视作 0
        ]
        const got = [...list].sort(compareStatAttrs)
        const want = [...list].sort(oldCompare)
        assert.deepEqual(got, want)
        // 名称用**默认字典序**（码点序）：丙 U+4E19 < 乙 U+4E59 < 甲 U+7532
        // 故顺序是「丙, 乙(4), 乙(10), 甲」；切勿按拼音/笔画直觉写期望值（本用例初版就写反了）
        assert.deepEqual(
            got.map((x) => x.name + ':' + (x.desc ?? '-')),
            ['丙:-', '乙:提升 4 点', '乙:提升 10 点', '甲:提升 2 点']
        )
    })

    it('compareStatAttrs：desc 无数字时按 0 处理（不会 NaN 乱序）', () => {
        const a = { name: '同', desc: '无数值' }
        const b = { name: '同', desc: '3' }
        assert.equal(compareStatAttrs(a, b), -3)
        assert.equal(Number.isNaN(compareStatAttrs(a, b)), false)
    })

    it('formatSubstatValue：与旧实现逐例一致（边界 1 / NaN / 负数 / 空串）', () => {
        for (const v of ['0.12', '0', '0.999', '1', '1.0', '12', 'abc', '', '-0.5', '2.5%']) {
            assert.equal(formatSubstatValue(v), oldFmt(v), `输入 ${JSON.stringify(v)}`)
        }
    })
})
