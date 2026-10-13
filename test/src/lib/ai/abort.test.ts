// 可中止原语单测：这是「工具卡住 → 整轮永远执行中且暂停不掉」的修复核心
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ABORTED_TOOL_OUTPUT, raceWithAbort } from '$lib/ai/abort'

/** @desc 永不 resolve 的 promise：模拟「不接受取消的工具处理器」 */
const never = (): Promise<string> => new Promise<string>(() => {})

test('raceWithAbort：没有 signal 时原样等待结果', async () => {
    assert.equal(await raceWithAbort(Promise.resolve('ok'), undefined, () => 'aborted'), 'ok')
})

test('raceWithAbort：signal 触发后立刻返回中止值，**不等那个永不返回的任务**', async () => {
    const controller = new AbortController()
    const promise = raceWithAbort(never(), controller.signal, () => ABORTED_TOOL_OUTPUT)
    controller.abort()
    // 若这里挂住，说明修复无效（正是用户「暂停不掉」的症状）
    assert.equal(await promise, ABORTED_TOOL_OUTPUT)
})

test('raceWithAbort：进入时 signal 已 abort，不再启动等待', async () => {
    const controller = new AbortController()
    controller.abort()
    assert.equal(await raceWithAbort(Promise.resolve('too late'), controller.signal, () => 'aborted'), 'aborted')
})

test('raceWithAbort：任务正常结束时返回真实结果，不受未触发的 signal 影响', async () => {
    const controller = new AbortController()
    assert.equal(await raceWithAbort(Promise.resolve('real'), controller.signal, () => 'aborted'), 'real')
})

test('raceWithAbort：任务抛错时按中止值收尾（不让异常逃出去）', async () => {
    const controller = new AbortController()
    const failed = Promise.reject(new Error('boom'))
    assert.equal(await raceWithAbort(failed, controller.signal, () => 'fallback'), 'fallback')
})

test('raceWithAbort：先到先得，且不会二次 resolve', async () => {
    const controller = new AbortController()
    const promise = raceWithAbort(Promise.resolve('fast'), controller.signal, () => 'aborted')
    controller.abort()
    // `abort()` 是**同步**触发的，而 `Promise.resolve().then` 要等 microtask —— 所以 abort 先到是对的
    assert.equal(await promise, 'aborted')
})

test('raceWithAbort：任务已先 settle 后，再 abort 不改变结果（不会二次 resolve）', async () => {
    const controller = new AbortController()
    const promise = raceWithAbort(Promise.resolve('fast'), controller.signal, () => 'aborted')
    assert.equal(await promise, 'fast', '先让任务的 microtask 跑完')
    controller.abort()
    assert.equal(await promise, 'fast', 'settled 守卫必须挡住后来的 abort')
})
