// ── T12 抽出的时间轴纯样式函数：等价性 + 行为锁 ─────────────────────────────
// 这些函数原本内联在 `timeline.svelte` 里（无法单测）。抽出时必须证明**输出逐字不变**，
// 否则时间轴的拖拽/高亮定位会发生静默漂移。故此处把「旧内联实现」原样复刻为参照实现，
// 对全部标志组合做穷举比对 —— 这是「抽纯函数」这类重构唯一有意义的等价证据。
import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'
import {
    blockStyle,
    refLineLeft,
    damageStackStyle,
    nonDirectSortWeight
} from '$lib/components/page/home/timeline/timeline-styles.utils'

// ── 参照实现：逐字复刻抽取前的内联版本 ──
const oldBlockStyle = (
    blockPos: number,
    visualPos: number,
    highlighted: boolean,
    dimmed: boolean,
    isDragTarget: boolean,
    gpuAccel: boolean
): string => {
    const rest = `z-index: ${highlighted ? 20 : 5}; opacity: ${dimmed ? 0.4 : 1}; transition: opacity 150ms ease;`
    if (gpuAccel) {
        const dx = visualPos - blockPos
        return `left: ${blockPos}px; transform: translateX(${dx}px) translateX(-50%) ${
            highlighted ? 'translateY(-4px)' : ''
        }; ${rest}${isDragTarget ? ' will-change: transform;' : ''}`
    }
    return `left: ${visualPos}px; transform: translateX(-50%) ${highlighted ? 'translateY(-4px)' : ''}; ${rest}`
}

const oldRefLineLeft = (visualX: number, pos: number, gpuAccel: boolean): string => {
    if (gpuAccel) return `left: ${pos}px; transform: translateX(${visualX - pos}px);`
    return `left: ${visualX}px;`
}

const oldDamageStackStyle = (
    left: number,
    top: number,
    scale: number,
    dimmed: boolean,
    dragging: boolean,
    gpuAccel: boolean
): string => {
    const rest = `opacity: ${dimmed ? 0.4 : 1}; transform-origin: left center; transition: ${
        dragging ? 'opacity 150ms ease' : 'transform 150ms ease, opacity 150ms ease'
    };`
    if (gpuAccel) return `left:0;top:0;transform: translate(${left}px, ${top}px) scale(${scale}); ${rest}`
    return `left: ${left}px; top: ${top}px; transform: scale(${scale}); ${rest}`
}

const BOOLS = [false, true]

describe('T12 timeline 纯样式函数（抽取等价性）', () => {
    it('blockStyle 穷举 4 个布尔标志 × gpuAccel，输出与旧内联实现逐字相同', () => {
        let n = 0
        for (const pos of [0, 1, 80, 1234.5]) {
            for (const visual of [0, 80, 1400.25]) {
                for (const highlighted of BOOLS)
                    for (const dimmed of BOOLS)
                        for (const isDragTarget of BOOLS)
                            for (const gpuAccel of BOOLS) {
                                const a = blockStyle(pos, visual, highlighted, dimmed, isDragTarget, gpuAccel)
                                const b = oldBlockStyle(pos, visual, highlighted, dimmed, isDragTarget, gpuAccel)
                                assert.equal(a, b, `pos=${pos} visual=${visual}`)
                                n++
                            }
            }
        }
        assert.ok(n >= 192, `比对组合数应足够多，实为 ${n}`)
    })

    it('refLineLeft 穷举位置 × gpuAccel', () => {
        for (const visualX of [0, 80, 999.5])
            for (const pos of [0, 80, 1234.5])
                for (const gpuAccel of BOOLS) {
                    assert.equal(refLineLeft(visualX, pos, gpuAccel), oldRefLineLeft(visualX, pos, gpuAccel))
                }
    })

    it('damageStackStyle 穷举 dimmed × dragging × gpuAccel', () => {
        for (const left of [0, 80, 321.25])
            for (const top of [0, 14, 210])
                for (const scale of [1, 1.2])
                    for (const dimmed of BOOLS)
                        for (const dragging of BOOLS)
                            for (const gpuAccel of BOOLS) {
                                assert.equal(
                                    damageStackStyle(left, top, scale, dimmed, dragging, gpuAccel),
                                    oldDamageStackStyle(left, top, scale, dimmed, dragging, gpuAccel)
                                )
                            }
    })

    it('nonDirectSortWeight 保持「处决 → 响应 → 效应 → 其它」且未知类别排最后', () => {
        assert.equal(nonDirectSortWeight('处决'), 0)
        assert.equal(nonDirectSortWeight('响应'), 1)
        assert.equal(nonDirectSortWeight('效应'), 2)
        assert.equal(nonDirectSortWeight('未知'), 3)
        // 排序结果与内联比较器一致
        const list = ['效应', '未知', '处决', '响应']
        assert.deepEqual(
            [...list].sort((a, b) => nonDirectSortWeight(a) - nonDirectSortWeight(b)),
            ['处决', '响应', '效应', '未知']
        )
    })

    it('gpuAccel 两档产出的定位机制确实不同（防止两分支被误合并）', () => {
        const on = blockStyle(80, 200, false, false, false, true)
        const off = blockStyle(80, 200, false, false, false, false)
        assert.ok(on.includes('translateX(120px)'), `GPU 档应把位移放进 transform：${on}`)
        assert.ok(on.startsWith('left: 80px;'), `GPU 档 left 应锁在逻辑位置：${on}`)
        assert.ok(off.startsWith('left: 200px;'), `非 GPU 档应直接用视觉位置：${off}`)
    })
})
