// 时间参考线解析与「自动配置时间记点」回归测试（纯函数，不联网）
// 运行：node --import ./scripts/test/preload.mjs src/lib/calc/ref-line-timing.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoConfigureTimings, parseRefLineSeconds, resolveRefLineSeconds, type RefLineLike } from './ref-line-timing'

const END = 'right'
const mk = (id: string, time: string, pos: number): RefLineLike => ({ id, time, pos })
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
