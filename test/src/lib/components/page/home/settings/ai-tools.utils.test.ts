// 工具时间线并入逻辑单测：**配对错位**是实测崩过/卡死的根因，必须钉住
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyToolEvent, applyToolProgress, type ToolCard } from '$lib/components/page/home/settings/ai-tools.utils'

test('调用事件：追加一张带 seq 的卡', () => {
    const cards = applyToolEvent([], { toolName: 'get_team', toolArgs: { a: 1 }, seq: 1 })
    assert.deepEqual(cards, [{ name: 'get_team', args: { a: 1 }, seq: 1 }])
})

test('结果事件：按 seq 配对，**即使它不是最后一张卡**', () => {
    // 关键回归：旧实现只看「最后一张卡」，中间插进任何东西就会把结果记错人
    let cards: ToolCard[] = []
    cards = applyToolEvent(cards, { toolName: 'a', seq: 1 })
    cards = applyToolEvent(cards, { toolName: 'b', seq: 2 })
    cards = applyToolEvent(cards, { toolName: 'a', resultLen: 42, seq: 1 })

    assert.equal(cards[0].resultLen, 42, 'a 的结果必须回到 a 那张卡上')
    assert.equal(cards[1].resultLen, undefined, 'b 不能被误标为已完成')
    assert.equal(cards.length, 2)
})

test('结果事件的 seq 找不到对应卡时：只追加一张已结束的卡，绝不动别的卡', () => {
    let cards = applyToolEvent([], { toolName: 'a', seq: 1 })
    cards = applyToolEvent(cards, { toolName: 'a', resultLen: 7, seq: 999 })

    assert.equal(cards.length, 2)
    assert.equal(cards[0].resultLen, undefined, '原有卡不能被顶掉（旧实现就是在这里全体错位）')
    assert.equal(cards[1].resultLen, 7)
})

test('done 事件：把卡标成「已完成」而不需要结果长度', () => {
    // 服务端 web_search 只有「检索完成」，没有结果体 —— 原来它只更新实时状态、不发事件，
    // 于是这张卡永远停在「执行中…」
    let cards = applyToolEvent([], { toolName: 'web_search', seq: 1 })
    assert.equal(cards[0].done, undefined)
    cards = applyToolEvent(cards, { toolName: 'web_search', seq: 1, done: true })
    assert.equal(cards[0].done, true)
    assert.equal(cards.length, 1, '结束事件不应再新增一张卡')
})

test('没有 seq 的结果事件不会污染已有卡（无法配对时不猜）', () => {
    const cards = applyToolEvent([{ name: 'a', args: {}, seq: 1 }], { toolName: 'a', resultLen: 5 })
    assert.equal(cards.length, 2)
    assert.equal(cards[0].resultLen, undefined)
    assert.equal(cards[1].resultLen, 5)
})

test('进度：优先挂到正在跑的 generate_* 卡上（改它的 status）', () => {
    const cards = applyToolProgress([{ name: 'generate_entity_buffs', args: {}, seq: 1 }], '解析中…')
    assert.equal(cards.length, 1)
    assert.equal(cards[0].args.status, '解析中…')
})

test('进度：没有可挂的卡时追加**无 seq 的伪卡**，因此永远不会抢走真实调用的结果', () => {
    const cards = applyToolProgress([{ name: 'get_team', args: {}, seq: 1 }], '生成中…')
    assert.equal(cards.length, 2)
    assert.equal(cards[1].name, 'buff生成')
    assert.equal(cards[1].seq, undefined, '伪卡不能有 seq，否则会与真实调用撞配对')

    // 紧接着真实调用的结果事件，仍应回到它自己的卡上
    const after = applyToolEvent(cards, { toolName: 'get_team', resultLen: 9, seq: 1 })
    assert.equal(after[0].resultLen, 9)
    assert.equal(after[1].resultLen, undefined)
})

test('进度：已结束的 generate_ 卡不再接收新进度（避免续写上一轮的卡）', () => {
    const cards = applyToolProgress([{ name: 'generate_entity_buffs', args: {}, seq: 1, resultLen: 10 }], '新的生成')
    assert.equal(cards.length, 2)
    assert.equal(cards[1].name, 'buff生成')
})
