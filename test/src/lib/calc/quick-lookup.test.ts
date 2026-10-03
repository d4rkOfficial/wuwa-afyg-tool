// ── T12 抽出的速查纯函数：与「抽取前内联实现」逐例等价 ───────────────────────
// 这三个函数原本内联在 `quick-lookup-content.svelte`（该组件依赖 {@html} 与 DOM 滚动容器，
// 起不了 SSR 断言），故抽出后必须用**行为等价测试**补上原来的空缺。
import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'
import {
    dedupeStatNodes,
    mergeTriggerSets,
    compareStatAttrs,
    formatSubstatValue,
    statNodeKey
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

// ── 固有属性节点的 each-key 唯一性（速查页卡在「加载中...」的真因，2026-xx 实测）──────────
// 上游真源采样（nanoka `ww/3.7`，全部 64 个角色）：每个角色的 `node_type=4` 固有属性节点都成对重复，
// 例如散华的 8 个节点 = 「攻击提升/冷凝伤害加成提升」×{1.80%, 4.20%}×各 2 份。
// 组件原以 `attr.name` 作 `{#each}` key → 一进详情就抛 `each_key_duplicate`，DOM 停在上一帧的「加载中...」。
// 下面用**真实节点的原始形态**锁死：去重后 name+desc 必然唯一（这正是它能作 key 的依据）。
describe('速查固有属性：去重后 each-key 唯一', () => {
    /** @desc 散华（1102）在 `ww/3.7` 的真实 8 个固有属性节点（逐字取自上游 param 插值结果） */
    const SANHUA = [
        { name: '冷凝伤害加成提升', desc: '冷凝伤害加成提升1.80%' },
        { name: '攻击提升', desc: '攻击提升1.80%' },
        { name: '攻击提升', desc: '攻击提升1.80%' },
        { name: '冷凝伤害加成提升', desc: '冷凝伤害加成提升1.80%' },
        { name: '冷凝伤害加成提升', desc: '冷凝伤害加成提升4.20%' },
        { name: '攻击提升', desc: '攻击提升4.20%' },
        { name: '攻击提升', desc: '攻击提升4.20%' },
        { name: '冷凝伤害加成提升', desc: '冷凝伤害加成提升4.20%' }
    ]

    it('未去重时 name 与 name+desc **都会**重复（固化为已知反例，防有人改回 name 作 key）', () => {
        const names = SANHUA.map((n) => n.name)
        const keys = SANHUA.map(statNodeKey)
        assert.notEqual(new Set(names).size, names.length, 'name 用真实数据就会重复')
        assert.notEqual(new Set(keys).size, keys.length, '未去重时 name+desc 也会重复')
    })

    it('去重：完全相同的节点只留一份，不同数值的同名节点全部保留', () => {
        const got = dedupeStatNodes(SANHUA)
        assert.equal(got.length, 4, '8 个节点里两对完全相同，应剩 4 个')
        assert.deepEqual(
            [...got].sort(compareStatAttrs).map((n) => `${n.name} ${n.desc.slice(-5)}`),
            ['冷凝伤害加成提升 1.80%', '冷凝伤害加成提升 4.20%', '攻击提升 1.80%', '攻击提升 4.20%']
        )
        // 去重后作 `{#each}` key 必然唯一（组件即如此使用）
        const keys = got.map(statNodeKey)
        assert.equal(new Set(keys).size, keys.length, '去重后 key 必须唯一')
        // 保留首次出现（顺序不变，排序交给 compareStatAttrs）
        assert.deepEqual(got[0], SANHUA[0])
        // 不改入参
        assert.equal(SANHUA.length, 8)
    })

    it('边界：空列表 / 无 desc 节点 / 不同名同 desc 都不误删', () => {
        assert.deepEqual(dedupeStatNodes([]), [])
        const nodes = [{ name: '甲', desc: '' }, { name: '甲' }, { name: '乙', desc: '' }]
        // 缺 desc 与 desc='' 视为同一个键（模板里都渲染成无描述卡片）
        assert.deepEqual(dedupeStatNodes(nodes), [
            { name: '甲', desc: '' },
            { name: '乙', desc: '' }
        ])
        assert.equal(statNodeKey({ name: '甲' }), statNodeKey({ name: '甲', desc: '' }))
        assert.notEqual(statNodeKey({ name: '甲' }), statNodeKey({ name: '乙' }))
    })
})
