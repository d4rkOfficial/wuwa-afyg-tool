// 背景图遮罩换算单测（纯函数，不联网）
// 运行：node --import ./test/preload.mjs test/src/lib/theme/bg-mask.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BG_MASK_MIN, BG_MASK_MAX, bgMaskOf, bgMaskCss, bgMaskLabel } from '$lib/theme/bg-mask'

describe('bg-mask', () => {
    it('0 = 原图（不铺遮罩）', () => {
        assert.equal(bgMaskCss(0), 'transparent')
        assert.equal(bgMaskOf(0).alpha, 0)
    })

    it('压暗段：-100 与旧口径一致（60% 黑），再往下一路加浓到 -200 全黑', () => {
        assert.equal(bgMaskCss(-50), 'rgba(0, 0, 0, 0.300)')
        assert.equal(bgMaskCss(-100), 'rgba(0, 0, 0, 0.600)')
        assert.equal(bgMaskCss(-150), 'rgba(0, 0, 0, 0.800)')
        assert.equal(bgMaskCss(-200), 'rgba(0, 0, 0, 1.000)')
        assert.deepEqual(bgMaskOf(-200), { rgb: '0, 0, 0', alpha: 1 })
    })

    it('提白段沿用旧口径：100 → 35% 白、200 → 70% 白', () => {
        assert.equal(bgMaskCss(100), 'rgba(255, 255, 255, 0.350)')
        assert.equal(bgMaskCss(200), 'rgba(255, 255, 255, 0.700)')
        assert.deepEqual(bgMaskOf(200), { rgb: '255, 255, 255', alpha: 0.7 })
    })

    it('越界与非法值：按边界 clamp，NaN 当原图', () => {
        assert.equal(bgMaskCss(-999), bgMaskCss(BG_MASK_MIN))
        assert.equal(bgMaskCss(999), bgMaskCss(BG_MASK_MAX))
        assert.equal(bgMaskCss(Number.NaN), 'transparent')
        assert.equal(bgMaskLabel(Number.NaN), '原图')
    })

    it('数值文案：全黑 / 压暗 / 原图 / 偏白 / 极白', () => {
        assert.equal(bgMaskLabel(-200), '全黑')
        assert.equal(bgMaskLabel(-120), '压暗 120%')
        assert.equal(bgMaskLabel(-1), '压暗 1%')
        assert.equal(bgMaskLabel(0), '原图')
        assert.equal(bgMaskLabel(60), '偏白 60%')
        assert.equal(bgMaskLabel(150), '极白 50%')
    })
})
