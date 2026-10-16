// 视图会话记忆（`$lib/data/view-session`）回归。
//
// 需求：排轴 / 拉表 / 词条-环境配置 / 速查的「打开的页签 + 滚动位置」在本次会话内按工程记住
// （切走再切回来要回到原位），且**不落 localStorage**（刷新即销毁）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    attachSessionScroll,
    clearProjectSession,
    readSessionScroll,
    readSessionTab,
    writeSessionScroll,
    writeSessionTab
} from '$lib/data/view-session'

/** @desc 假滚动容器：只记监听器与两个滚动量，足够验证「恢复一次 + 滚动即记录」 */
const makeFakeEl = () => {
    const listeners = new Set<() => void>()
    return {
        scrollTop: 0,
        scrollLeft: 0,
        listeners,
        addEventListener: (_type: string, fn: () => void) => void listeners.add(fn),
        removeEventListener: (_type: string, fn: () => void) => void listeners.delete(fn),
        /** @desc 模拟一次滚动事件 */
        emitScroll() {
            for (const fn of listeners) fn()
        }
    }
}

describe('view-session：按「工程 + 视图」记住页签与滚动位置', () => {
    it('页签按工程、按视图分别记账，互不串位', () => {
        writeSessionTab('p1', 'calculation', 'slot-2')
        writeSessionTab('p1', 'config', 'enemy')
        writeSessionTab('p2', 'calculation', 'slot-0')

        assert.equal(readSessionTab('p1', 'calculation'), 'slot-2')
        assert.equal(readSessionTab('p1', 'config'), 'enemy')
        assert.equal(readSessionTab('p2', 'calculation'), 'slot-0')
        // 没记过的工程/视图返回 null，由调用方兜底默认页签
        assert.equal(readSessionTab('p2', 'config'), null)
        assert.equal(readSessionTab('p1', 'quick-lookup'), null)
    })

    it('滚动位置按 slot 分开记（同一视图的多个滚动区不互相覆盖）', () => {
        writeSessionScroll('p1', 'config', 'char1', { top: 120, left: 0 })
        writeSessionScroll('p1', 'config', 'enemy', { top: 40, left: 8 })

        assert.deepEqual(readSessionScroll('p1', 'config', 'char1'), { top: 120, left: 0 })
        assert.deepEqual(readSessionScroll('p1', 'config', 'enemy'), { top: 40, left: 8 })
        assert.equal(readSessionScroll('p1', 'config', 'char2'), null)
    })

    it('挂载时恢复位置，滚动时记录，解绑后不再记录', () => {
        // 恢复在下一帧写：测试里把 rAF 折成立即执行
        const originalRaf = globalThis.requestAnimationFrame
        globalThis.requestAnimationFrame = ((fn: FrameRequestCallback) => {
            fn(0)
            return 0
        }) as typeof globalThis.requestAnimationFrame
        try {
            writeSessionScroll('p1', 'timeline', 'timeline', { top: 0, left: 640 })
            const el = makeFakeEl()
            const detach = attachSessionScroll(el as unknown as HTMLElement, 'p1', 'timeline', 'timeline')

            assert.equal(el.scrollLeft, 640, '挂载即恢复上次的横向位置')

            el.scrollLeft = 900
            el.scrollTop = 12
            el.emitScroll()
            assert.deepEqual(readSessionScroll('p1', 'timeline', 'timeline'), { top: 12, left: 900 }, '滚动后写回记忆')

            detach()
            el.scrollLeft = 1
            el.emitScroll()
            assert.deepEqual(readSessionScroll('p1', 'timeline', 'timeline'), { top: 12, left: 900 }, '解绑后不再记录')
        } finally {
            globalThis.requestAnimationFrame = originalRaf
        }
    })

    it('restore: false 只在数据到位后由调用方恢复（异步内容不被夹到 0）', () => {
        writeSessionScroll('p1', 'quick-lookup', 'char:甲', { top: 300, left: 0 })
        const el = makeFakeEl()
        const detach = attachSessionScroll(el as unknown as HTMLElement, 'p1', 'quick-lookup', 'char:甲', {
            restore: false
        })
        assert.equal(el.scrollTop, 0, '不主动恢复')
        el.scrollTop = 512
        el.emitScroll()
        assert.equal(readSessionScroll('p1', 'quick-lookup', 'char:甲')?.top, 512)
        detach()
    })

    it('工程被删除时只清掉该工程的记忆', () => {
        writeSessionTab('gone', 'calculation', 'slot-1')
        writeSessionScroll('gone', 'calculation', 'spread', { top: 5, left: 5 })
        writeSessionTab('kept', 'calculation', 'slot-1')

        clearProjectSession('gone')

        assert.equal(readSessionTab('gone', 'calculation'), null)
        assert.equal(readSessionScroll('gone', 'calculation', 'spread'), null)
        assert.equal(readSessionTab('kept', 'calculation'), 'slot-1', '别的工程不受影响')
    })
})
