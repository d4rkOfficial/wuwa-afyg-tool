// 区域质感「毛玻璃」的运行时兼容：探测结果 → 实际发射的 backdrop 声明与不透明度。
//
// 钉住三件事：
// 1. 支持毛玻璃时口径完全不变（用户配置的 opacity / blur / depth 原样生效）；
// 2. 不支持时 backdrop 一律 `none`（`brightness()` 也属 backdrop-filter，留着只会误导排查）；
// 3. 不支持时**只有原本要求毛玻璃的表面**抬到可读下限（表头 / 首列这类 sticky 层压得住内容），
//    没要求毛玻璃的表面不动（否则等于擅自改用户配置）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    BLUR_FALLBACK_OPACITY,
    computeSurfaceBackdrop,
    supportsBackdropFilter,
    surfaceBackdrop,
    surfaceOpacity
} from '$lib/theme/blur-support'

const style = (patch: Partial<{ opacity: number; blur: number; depth: number }> = {}) => ({
    opacity: 20,
    blur: 8,
    depth: 30,
    ...patch
})

describe('surfaceOpacity：无毛玻璃时按需抬高不透明度', () => {
    it('支持毛玻璃：原样返回配置值', () => {
        assert.equal(surfaceOpacity(style({ opacity: 15 }), true), 15)
        assert.equal(surfaceOpacity(style({ opacity: 100 }), true), 100)
    })

    it('不支持且要求毛玻璃：抬到可读下限', () => {
        assert.equal(surfaceOpacity(style({ opacity: 15, blur: 8 }), false), BLUR_FALLBACK_OPACITY)
        assert.equal(surfaceOpacity(style({ opacity: 0, blur: 32 }), false), BLUR_FALLBACK_OPACITY)
    })

    it('不支持但没要求毛玻璃：不动（不改用户配置）', () => {
        assert.equal(surfaceOpacity(style({ opacity: 15, blur: 0 }), false), 15)
        assert.equal(surfaceOpacity(style({ opacity: 0, blur: 0 }), false), 0)
    })

    it('配置已高于下限时不被压低', () => {
        assert.equal(surfaceOpacity(style({ opacity: 96, blur: 8 }), false), 96)
    })

    it('越界值夹到 0–100', () => {
        assert.equal(surfaceOpacity(style({ opacity: 140, blur: 0 }), true), 100)
        assert.equal(surfaceOpacity(style({ opacity: -20, blur: 0 }), true), 0)
    })
})

describe('surfaceBackdrop：不支持时退回 none', () => {
    it('不支持毛玻璃：无论配置如何都是 none', () => {
        assert.equal(surfaceBackdrop(style({ blur: 32, depth: 100 }), false, false), 'none')
        assert.equal(surfaceBackdrop(style({ blur: 0, depth: 0 }), true, false), 'none')
    })

    it('支持毛玻璃：blur 与 depth 都照旧生效', () => {
        const css = surfaceBackdrop(style({ blur: 12, depth: 0 }), false, true)
        assert.ok(css.includes('blur(12px)'), css)
        assert.ok(css.includes('saturate(1.08)'), css)
        assert.ok(!css.includes('brightness'), css)
    })

    it('blur 与 depth 全为 0 时不产生合成开销（none）', () => {
        assert.equal(surfaceBackdrop(style({ blur: 0, depth: 0 }), false, true), 'none')
    })
})

describe('computeSurfaceBackdrop：深度方向的昼夜差异', () => {
    it('昼主题提亮、夜主题压暗（同 depth 符号相反）', () => {
        const light = computeSurfaceBackdrop(style({ blur: 0, depth: 50 }), true)
        const dark = computeSurfaceBackdrop(style({ blur: 0, depth: 50 }), false)
        const num = (css: string) => Number(/brightness\(([\d.]+)\)/.exec(css)?.[1] ?? NaN)
        assert.ok(num(light) > 1, light)
        assert.ok(num(dark) < 1, dark)
    })

    it('blur 上限夹到 32px', () => {
        assert.ok(computeSurfaceBackdrop(style({ blur: 99, depth: 0 }), false).includes('blur(32px)'))
    })
})

describe('supportsBackdropFilter：探测本身不能抛错', () => {
    it('node 里没有 CSS.supports → false，不抛错', () => {
        assert.equal(typeof CSS, 'undefined')
        assert.equal(supportsBackdropFilter(), false)
    })
})
