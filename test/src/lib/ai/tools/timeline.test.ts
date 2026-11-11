import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { shortKeyOf } from '$lib/ai/short-key'
import { executeTool } from '$lib/ai/tools/registry'
import '$lib/ai/tools/timeline'
import { MIN_GAP } from '$lib/calc/timeline.consts'
import { getTimelineState, init, setBlockWidth } from '$lib/calc/timeline.store.svelte'
import type { TimelineData } from '$lib/calc/timeline.types'
import { __seedProjectsForTest, createProjectData } from '$lib/data/project.svelte'

const setup = (t: TestContext, endPos: number) => {
    const project = createProjectData('追加排轴测试')
    const timeline: TimelineData = {
        refLines: [
            { id: 'left', name: '', pos: 0 },
            { id: 'right', name: '结束', pos: endPos }
        ],
        opBlocks: [],
        damageBlocks: []
    }
    __seedProjectsForTest([project], project.id)
    init(timeline, () => {}, project.team, false)
    t.after(() => {
        __seedProjectsForTest([], '')
        init(null, () => {}, project.team, false)
    })
    return project
}

const call = async <T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = JSON.parse(await executeTool({}, name, args))
    assert.equal(result.ok, true, result.error)
    return result.data
}

const addRef = () => call<{ line: string; lineId: string }>('add_ref_line')

test('连续追加参考线，返回独立短索引，间距充足时不移动结束线', async (t) => {
    setup(t, 300)
    const first = await addRef()
    const second = await addRef()
    const third = await addRef()
    const { refLines } = getTimelineState()

    assert.deepEqual(
        refLines.map((ref) => ref.id),
        ['left', first.lineId, second.lineId, third.lineId, 'right']
    )
    assert.deepEqual(
        refLines.map((ref) => ref.pos),
        [0, MIN_GAP, 2 * MIN_GAP, 3 * MIN_GAP, 300]
    )
    for (const ref of [first, second, third]) assert.equal(ref.line, shortKeyOf(ref.lineId))
})

test('混合追加保留调用顺序，操作块和参考线均可扩容且一次撤销', async (t) => {
    const project = setup(t, MIN_GAP)
    const first = await addRef()
    const beforeBlock = getTimelineState()
    const endAfterRef = beforeBlock.refLines.at(-1)!
    assert.equal(endAfterRef.id, 'right')
    assert.ok(endAfterRef.pos > 2 * MIN_GAP)

    const desc = '长操作备注'.repeat(20)
    const added = await call<{ blockId: string }>('add_op_block', { track: 2, key: 'E', desc })
    const afterBlock = getTimelineState()
    const block = afterBlock.opBlocks[0]
    const endAfterBlock = afterBlock.refLines.at(-1)!
    assert.equal(block.id, added.blockId)
    assert.ok(block.pos > beforeBlock.refLines[1].pos)
    assert.ok(endAfterBlock.pos > endAfterRef.pos)
    assert.ok(endAfterBlock.pos > block.pos)
    assert.deepEqual(project.encounter.timeline.data, afterBlock)

    // 模拟实际渲染宽度，让参考线位置必须避让块的右沿。
    setBlockWidth(block.id, 2400)
    const last = await addRef()
    const withLast = getTimelineState()
    assert.equal(withLast.refLines[1].id, first.lineId)
    assert.equal(withLast.refLines[2].id, last.lineId)
    assert.ok(withLast.refLines[2].pos >= block.pos + 1200)
    assert.ok(withLast.refLines[3].pos >= withLast.refLines[2].pos + MIN_GAP)

    await call('undo_timeline')
    assert.deepEqual(getTimelineState(), afterBlock)
    await call('undo_timeline')
    assert.deepEqual(getTimelineState(), beforeBlock)
    await call('undo_timeline')
    assert.deepEqual(
        getTimelineState().refLines.map((ref) => ref.pos),
        [0, MIN_GAP]
    )
})
