// 时间参考线解析与「自动配置时间记点」回归测试（纯函数，不联网）
// 运行：node --import ./test/preload.mjs test/src/lib/calc/ref-line-timing.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    autoConfigureTimings,
    parseRefLineSeconds,
    resolveRefLineSeconds,
    syncRefLineTiming,
    timingRefLineIds,
    type RefLineLike,
    type TimingEntry
} from '$lib/calc/ref-line-timing'

const END = 'right'
const mk = (id: string, name: string, pos: number): RefLineLike => ({ id, name, pos })
const end = (pos = 9999) => mk(END, '结束', pos)

/** @desc 便捷断言：自动配置结果 → [[refLineId, seconds], ...] */
const run = (lines: RefLineLike[], damagePos: number[] = []) =>
    autoConfigureTimings(lines, (pos) => damagePos.some((p) => p > pos)).map((t) => [t.refLineId, t.seconds])

test('命名解析：相对加号（含全角 ＋）按追加处理', () => {
    assert.deepEqual(parseRefLineSeconds('+25s'), { relative: true, seconds: 25 })
    assert.deepEqual(parseRefLineSeconds('＋25s'), { relative: true, seconds: 25 })
    assert.deepEqual(parseRefLineSeconds('起手 +30s'), { relative: true, seconds: 30 })
    assert.deepEqual(parseRefLineSeconds('25s'), { relative: false, seconds: 25 })
    assert.equal(parseRefLineSeconds('起手'), null)
})

test('自动配置：两个 +25s 依次解析为 25 / 50，尾部无伤害时结束取同一时刻（+0 帧）', () => {
    const lines = [mk('a', '+25s', 100), mk('b', '+25s', 200), end()]
    // 伤害都在第一条参考线之前 → 最后一条 +25s 之后没有伤害
    assert.deepEqual(run(lines, [50]), [
        ['a', 25],
        ['b', 50],
        [END, 50]
    ])
})

test('自动配置：最后一条可解析参考线之后还有伤害 → 结束按 120s（不足 +30s）', () => {
    const lines = [mk('a', '+25s', 100), mk('b', '+25s', 200), end()]
    assert.deepEqual(run(lines, [50, 300]), [
        ['a', 25],
        ['b', 50],
        [END, 120]
    ])
})

test('自动配置：解析不出的参考线直接跳过，不影响后续参考线', () => {
    const lines = [mk('x', '', 50), mk('a', '+25s', 100), mk('y', '起手', 150), mk('b', '+25s', 200), end()]
    assert.deepEqual(run(lines, [80]), [
        ['a', 25],
        ['b', 50],
        [END, 50]
    ])
})

test('自动配置：全部参考线都解析不出 → 结束回退 25s', () => {
    const lines = [mk('x', '', 50), mk('y', '起手', 150), end()]
    assert.deepEqual(run(lines, [80]), [[END, 25]])
})

test('自动配置：绝对时间重复时按单调追加，仍能给出两段', () => {
    const lines = [mk('a', '25s', 100), mk('b', '25s', 200), end()]
    // 第二条绝对 25s 不早于上一条 → 保持 25；末条之后有伤害 → 结束 120
    assert.deepEqual(run(lines, [50, 300]), [
        ['a', 25],
        ['b', 25],
        [END, 120]
    ])
})

test('自动配置：只有结束线时按 120s 收尾', () => {
    assert.deepEqual(run([end()], [50, 300]), [[END, 120]])
})

test('resolveRefLineSeconds：结束线不足上一条记点时 +30s 直到大于', () => {
    const lines = [mk('a', '200s', 100), end()]
    assert.equal(resolveRefLineSeconds(END, lines, [{ refLineId: 'a', seconds: 200 }]), 210)
    assert.equal(resolveRefLineSeconds(END, lines, [{ refLineId: 'a', seconds: 30 }]), 120)
})

// ────────────────────────── 改名同步时间记点 ──────────────────────────

test('改名同步记点：新名字能解析出时间 → 自动新增一条记点', () => {
    const before = [mk('a', '起手', 100), mk('b', '爆发', 200), end()]
    const timings: TimingEntry[] = []
    // 没改名 → 无变化，返回入参本身（调用方据此跳过工程写入）
    assert.equal(syncRefLineTiming('a', before, timings), timings)

    const after = [mk('a', '25s', 100), mk('b', '爆发', 200), end()]
    const next = syncRefLineTiming('a', after, timings)
    assert.deepEqual(next, [{ refLineId: 'a', seconds: 25 }])
    assert.notEqual(next, timings)
})

test('改名同步记点：已有记点按新名字重算（重算基准不含自己上一次的秒数）', () => {
    const lines = [mk('a', '25s', 100), mk('b', '+30s', 200), end()]
    const timings: TimingEntry[] = [
        { refLineId: 'a', seconds: 25 },
        { refLineId: 'b', seconds: 55 }
    ]
    // b 重命名为「+30s」→ 25 + 30 = 55
    assert.equal(syncRefLineTiming('b', lines, timings), timings, '算出来没变 → 同一引用')
    // 再重命名为「1m」→ 绝对 60s
    const renamed = [mk('a', '25s', 100), mk('b', '1m', 200), end()]
    assert.deepEqual(syncRefLineTiming('b', renamed, timings), [
        { refLineId: 'a', seconds: 25 },
        { refLineId: 'b', seconds: 60 }
    ])
})

test('改名同步记点：新名字解析不出时间 → 删掉该参考线的记点，其余保留', () => {
    const lines = [mk('a', '25s', 100), mk('b', '起手', 200), end()]
    const timings: TimingEntry[] = [
        { refLineId: 'a', seconds: 25 },
        { refLineId: 'b', seconds: 55 }
    ]
    assert.deepEqual(syncRefLineTiming('b', lines, timings), [{ refLineId: 'a', seconds: 25 }])
    // 本来就没有记点 → 同一引用
    const only = [{ refLineId: 'a', seconds: 25 }]
    assert.equal(syncRefLineTiming('b', lines, only), only)
    // 参考线不存在（已删除）→ 不动
    assert.equal(syncRefLineTiming('zz', lines, only), only)
})

test('timingRefLineIds：秒数为 null 的「未填写」记点也算已配置', () => {
    const ids = timingRefLineIds([
        { refLineId: 'a', seconds: 25 },
        { refLineId: 'b', seconds: null }
    ])
    assert.deepEqual([...ids], ['a', 'b'])
    assert.equal(timingRefLineIds([]).size, 0)
})
