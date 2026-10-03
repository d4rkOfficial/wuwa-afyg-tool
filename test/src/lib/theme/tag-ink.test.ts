// 角色标签「墨水色」口径护栏（纯函数，不联网）
// 运行：node --import ./test/preload.mjs test/src/lib/theme/tag-ink.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
    TAG_INK_LIGHT_L,
    LIGHT_SURFACES,
    DARK_SURFACE,
    UPSTREAM_TAG_COLORS,
    tagInkLight,
    contrastRatio,
    hueDistance,
    oklchToHex
} from '$lib/theme/tag-ink'

describe('tag-ink', () => {
    it('白天：全部上游标签色压到 42% 明度后，在白天各表面上都 ≥4.5:1', () => {
        for (const raw of UPSTREAM_TAG_COLORS) {
            const ink = tagInkLight(raw)
            for (const surface of LIGHT_SURFACES) {
                const ratio = contrastRatio(ink, surface)
                assert.ok(ratio >= 4.5, `${raw} → ${ink} on ${surface} = ${ratio.toFixed(2)}:1（低于 AA 4.5）`)
            }
        }
    })

    it('色相法：只挪明度，色相基本不变（≤10°，余量给 8bit 量化与色域映射）', () => {
        for (const raw of UPSTREAM_TAG_COLORS) {
            const drift = hueDistance(raw, tagInkLight(raw))
            assert.ok(drift <= 10, `${raw} → ${tagInkLight(raw)} 色相偏移 ${drift.toFixed(1)}° 过大`)
        }
    })

    it('白天压深确实比原色可读（原色全部不达标）', () => {
        for (const raw of UPSTREAM_TAG_COLORS) {
            const before = contrastRatio(raw, '#ffffff')
            const after = contrastRatio(tagInkLight(raw), '#ffffff')
            assert.ok(after > before, `${raw} 压深后反而更差`)
            assert.ok(after >= 4.5)
        }
    })

    it('黑夜不压色：上游原色在黑底上本来就全部 ≥4.5:1', () => {
        for (const raw of UPSTREAM_TAG_COLORS) {
            assert.ok(contrastRatio(raw, DARK_SURFACE) >= 4.5, `${raw} 在黑底上不达标，黑夜需要另行处理`)
        }
    })

    it('TAG_INK_LIGHT_L 是合法百分比且落在可读区间', () => {
        const l = Number.parseFloat(TAG_INK_LIGHT_L)
        assert.ok(TAG_INK_LIGHT_L.endsWith('%'))
        assert.ok(l >= 38 && l <= 45, `明度 ${l}% 不在护栏区间 38~45%`)
    })

    it('工具函数：hex ⇄ oklch 往返不炸、对比度对称', () => {
        assert.equal(oklchToHex({ l: 1, c: 0, h: 0 }), '#ffffff')
        assert.equal(oklchToHex({ l: 0, c: 0, h: 0 }), '#000000')
        assert.equal(contrastRatio('#ffffff', '#000000').toFixed(1), '21.0')
        assert.equal(contrastRatio('#000000', '#ffffff').toFixed(1), '21.0')
    })
})
