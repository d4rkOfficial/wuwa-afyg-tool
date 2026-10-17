// 工具时间线并入逻辑单测：**配对错位**是实测崩过/卡死的根因，必须钉住
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    appendActivityNotice,
    appendActivityText,
    applyToolEvent,
    applyToolEventToActivities,
    applyToolProgress,
    applyToolProgressToActivities,
    describeToolActivity,
    describeToolCard,
    type ToolCard
} from '$lib/components/page/home/settings/ai-tools.utils'

test('调用事件：追加一张带 seq 的卡', () => {
    const cards = applyToolEvent([], { toolName: 'get_team', toolArgs: { a: 1 }, seq: 1 })
    assert.deepEqual(cards, [{ name: 'get_team', args: { a: 1 }, seq: 1 }])
})

test('结果事件：完整结果文本按 seq 并入卡片（供展开查看响应体）', () => {
    let cards = applyToolEvent([], { toolName: 'web_fetch', toolArgs: { url: 'https://a.test' }, seq: 1 })
    cards = applyToolEvent(cards, { toolName: 'web_fetch', resultLen: 9, resultText: '{"ok":true}', seq: 1 })
    assert.equal(cards[0].result, '{"ok":true}')
    assert.equal(cards[0].resultLen, 9)
})

test('活动流：连续的思考/回复增量合并成一行，切换类型后新起一行', () => {
    let activities = appendActivityText([], 'reasoning', '先看')
    activities = appendActivityText(activities, 'reasoning', '一下')
    assert.equal(activities.length, 1)
    assert.equal(activities[0].text, '先看一下')

    activities = appendActivityText(activities, 'text', '结论')
    assert.equal(activities.length, 2)
    assert.equal(activities[1].kind, 'text')
    assert.equal(activities[1].text, '结论')

    // 空增量不制造空行
    assert.equal(appendActivityText(activities, 'text', '').length, 2)
})

test('活动流：工具调用与结果按 seq 配对到同一行；找不到 seq 时新起一行', () => {
    let activities = applyToolEventToActivities([], {
        toolName: 'web_fetch',
        toolArgs: { url: 'https://a.test' },
        seq: 1
    })
    assert.equal(activities.length, 1)
    assert.equal(activities[0].kind, 'tool')
    assert.equal(activities[0].tool?.name, 'web_fetch')

    activities = applyToolEventToActivities(activities, {
        toolName: 'web_fetch',
        resultLen: 10,
        resultText: '{"ok":true}',
        seq: 1
    })
    assert.equal(activities.length, 1, '结果事件不应新增行')
    assert.equal(activities[0].tool?.result, '{"ok":true}')

    const orphan = applyToolEventToActivities(activities, { toolName: 'a', resultLen: 3, seq: 999 })
    assert.equal(orphan.length, 2)
    assert.equal(orphan[1].tool?.resultLen, 3)
})

test('活动流：长任务提示与错误提示各起一行，且保留语气', () => {
    let activities = appendActivityNotice([], '自动继续第 1 次', 'info', 'longTask')
    activities = appendActivityNotice(activities, '请求失败', 'error')
    assert.equal(activities.length, 2)
    assert.equal(activities[0].kind, 'longTask')
    assert.equal(activities[1].tone, 'error')
})

test('describeToolActivity：代码 / 抓取 / 长任务给出可读的类别与一行摘要', () => {
    assert.deepEqual(describeToolActivity({ name: 'run_js', args: { code: 'const a = 1\nreturn a' } }), {
        label: '代码',
        icon: 'mdi:file-document-outline',
        summary: 'const a = 1'
    })
    assert.equal(describeToolActivity({ name: 'web_fetch', args: { url: 'https://a.test' } }).summary, 'https://a.test')
    assert.equal(describeToolActivity({ name: 'set_long_task', args: { enabled: true, note: '配装' } }).label, '长任务')
    assert.equal(describeToolActivity({ name: 'get_team', args: {} }).label, '读取')
    assert.equal(describeToolActivity({ name: 'set_team', args: {} }).label, '修改')
    assert.equal(describeToolActivity({ name: 'unknown_tool', args: {} }).label, '工具')
})

test('活动流：生成进度优先挂到最后一张未完成的工具行', () => {
    const activities = [{ kind: 'tool' as const, tool: { name: 'generate_buff', args: {}, seq: 1 } }]
    const updated = applyToolProgressToActivities(activities, '解析中…')
    assert.equal(updated.length, 1)
    assert.equal(updated[0].tool?.args.status, '解析中…')
})

test('describeToolCard：run_js 展示脚本源码与「返回值 + 日志」', () => {
    const view = describeToolCard({
        name: 'run_js',
        args: { code: 'return 1 + 1' },
        result: JSON.stringify({ ok: true, data: { value: 2, logs: ['hello'] } })
    })
    assert.equal(view.requestLabel, '脚本代码')
    assert.equal(view.request, 'return 1 + 1')
    assert.equal(view.responseLabel, '执行结果')
    assert.match(view.response ?? '', /2/)
    assert.match(view.response ?? '', /hello/)
})

test('describeToolCard：web_fetch 展示请求参数与响应 JSON；失败结果给出错误', () => {
    const view = describeToolCard({
        name: 'web_fetch',
        args: { url: 'https://a.test', method: 'POST', body: '{"x":1}' },
        result: JSON.stringify({ ok: true, data: { status: 200, content: '正文' } })
    })
    assert.equal(view.requestLabel, '请求参数')
    assert.match(view.request, /https:\/\/a\.test/)
    assert.match(view.request, /POST/)
    assert.deepEqual(JSON.parse(view.response ?? 'null'), { status: 200, content: '正文' })

    const failed = describeToolCard({ name: 'web_fetch', args: {}, result: '{"ok":false,"error":"超时"}' })
    assert.match(failed.response ?? '', /超时/)
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
