import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BLOCK_W, parsePositionArgs, type PositionResolveDeps } from '$lib/ai/timeline-position'

/**
 * @desc 排轴位置参数解析：排轴统一用 pos（像素坐标），不接受秒数定位。
 * 这些用例钉住三件事：① pos 绝对定位的合法区间与报错文案；
 * ② anchor 相对定位的贴靠基准（半个块宽 + offset，offset 是坐标不是秒）；
 * ③ 传 {time: 秒} 必须**报错**而不是被静默当成其它定位方式。
 */

const deps = (over: Partial<PositionResolveDeps> = {}): PositionResolveDeps => ({
    maxPos: 10848,
    blockWidth: BLOCK_W,
    anchorPos: (ref) => {
        if (ref === 1) return 1000
        throw new Error(`no anchor ${String(ref)}`)
    },
    ...over
})

describe('parsePositionArgs', () => {
    it('pos 绝对定位：原样返回（不换算秒数）', () => {
        assert.equal(parsePositionArgs({ pos: 798 }, deps()), 798)
        assert.equal(parsePositionArgs({ pos: 0 }, deps()), 0)
        assert.equal(parsePositionArgs({ pos: 10848 }, deps()), 10848)
        assert.equal(parsePositionArgs({ pos: '1200' }, deps()), 1200, '数字字符串也应接受')
    })

    it('pos 越界/非数字 → 报错并给出合法区间', () => {
        assert.throws(() => parsePositionArgs({ pos: -1 }, deps()), /pos 须为 0-10848/)
        assert.throws(() => parsePositionArgs({ pos: 10849 }, deps()), /pos 须为 0-10848/)
        assert.throws(() => parsePositionArgs({ pos: Number.NaN }, deps()), /pos 须为 0-10848/)
        assert.throws(() => parsePositionArgs({ pos: 'abc' }, deps()), /pos 须为 0-10848/)
    })

    it('pos 上界跟随 maxPos（结束线动态扩展）', () => {
        assert.equal(parsePositionArgs({ pos: 20000 }, deps({ maxPos: 30000 })), 20000)
        assert.throws(() => parsePositionArgs({ pos: 20000 }, deps({ maxPos: 19000 })), /pos 须为 0-19000/)
    })

    it('time（秒）不兼容：报错而不是静默接受', () => {
        assert.throws(() => parsePositionArgs({ time: 5 }, deps()), /position\.time 不是有效参数/)
        // 即使同时给了 pos，也不静默兼容（避免两种坐标语义并存）
        assert.throws(() => parsePositionArgs({ time: 5, pos: 798 }, deps()), /position\.time 不是有效参数/)
    })

    it('anchor 相对定位：默认 after，贴靠半个块宽', () => {
        assert.equal(parsePositionArgs({ anchor: 1 }, deps()), 1000 + BLOCK_W / 2)
    })

    it('anchor + side=before 贴靠左侧', () => {
        assert.equal(parsePositionArgs({ anchor: 1, side: 'before' }, deps()), 1000 - BLOCK_W / 2)
    })

    it('offset 是坐标偏移，不乘 PPS', () => {
        assert.equal(parsePositionArgs({ anchor: 1, offset: 100 }, deps()), 1000 + BLOCK_W / 2 + 100)
        assert.equal(parsePositionArgs({ anchor: 1, side: 'before', offset: 100 }, deps()), 1000 - BLOCK_W / 2 - 100)
        assert.throws(() => parsePositionArgs({ anchor: 1, offset: -1 }, deps()), /offset 须为非负数字/)
        assert.throws(() => parsePositionArgs({ anchor: 1, offset: Number.NaN }, deps()), /offset 须为非负数字/)
    })

    it('未知 side 归一为 after', () => {
        assert.equal(parsePositionArgs({ anchor: 1, side: 'middle' }, deps()), 1000 + BLOCK_W / 2)
    })

    it('缺 pos 与 anchor → 报错提示两种写法', () => {
        assert.throws(() => parsePositionArgs({}, deps()), /需要 pos（排轴坐标）或 anchor/)
        assert.throws(() => parsePositionArgs({ anchor: '  ' }, deps()), /需要 pos（排轴坐标）或 anchor/)
        assert.throws(() => parsePositionArgs({ anchor: null }, deps()), /需要 pos（排轴坐标）或 anchor/)
    })

    it('anchor 定位失败时把解析器的错误原样透出', () => {
        assert.throws(() => parsePositionArgs({ anchor: 9 }, deps()), /no anchor 9/)
    })

    it('blockWidth 可覆盖（默认 BLOCK_W=60）', () => {
        assert.equal(BLOCK_W, 60)
        assert.equal(parsePositionArgs({ anchor: 1 }, deps({ blockWidth: 100 })), 1050)
    })
})
