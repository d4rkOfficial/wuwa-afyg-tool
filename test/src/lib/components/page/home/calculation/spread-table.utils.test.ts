// 平铺拉表表头列宽口径：文字按「最多 N 行」摊开后需要多宽，列就多宽（而不是固定 108px 里无限折行 + 省略号）。
// 这里只锁纯函数（`headTextWidthPx` / `headColumnWidthPx`），DOM 测量不参与。
// 重点回归：字距 `tracking-[0.1em]` 必须计入宽度，否则算少一截 → 长文案正好折出第 4 行（实测踩过）。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
    HEAD_BAND_LINES,
    HEAD_CELL_PAD_PX,
    HEAD_COL_MAX_PX,
    HEAD_COL_MIN_PX,
    HEAD_NAME_LINES,
    HEAD_WIDTH_SLACK_PX,
    headColumnWidthPx,
    headTextWidthPx
} from '$lib/components/page/home/calculation/spread-table.utils'

describe('headTextWidthPx', () => {
    it('CJK 按 10px/字、ASCII 按 5.5px/字符估算', () => {
        assert.equal(headTextWidthPx(''), 0)
        assert.equal(headTextWidthPx('仇远'), 20)
        assert.equal(headTextWidthPx('abcd'), 22)
        assert.equal(headTextWidthPx('仇远ab'), 31)
    })

    it('全角标点（，。％）算作 CJK 宽度', () => {
        assert.equal(headTextWidthPx('，。'), 20)
    })

    it('字距按每字叠加（文件夹横条的 tracking-[0.1em]）', () => {
        assert.equal(headTextWidthPx('仇远', 1), 22)
        assert.equal(headTextWidthPx('abcd', 1), 26)
    })
})

describe('headColumnWidthPx', () => {
    /** @desc 与实现同口径：单行文字宽 → 2% 折行损失补偿 → 内边距 + 余量 */
    const expected = (perLine: number) => Math.ceil(perLine * 1.02) + HEAD_CELL_PAD_PX + HEAD_WIDTH_SLACK_PX

    it('短标签落到下限：不比 108px 更窄', () => {
        assert.equal(headColumnWidthPx('攻击', HEAD_NAME_LINES), HEAD_COL_MIN_PX)
        assert.equal(headColumnWidthPx('', HEAD_BAND_LINES), HEAD_COL_MIN_PX)
    })

    it('字多就变宽：单行文字宽 ÷ 行数（再补折行损失与内边距）', () => {
        // 30 个 CJK = 300px；2 行 → 150 → 153 + 22
        const label = '敌'.repeat(30)
        assert.equal(headColumnWidthPx(label, 2), expected(150))
    })

    it('算上字距后更宽（横条口径），否则会多折一行', () => {
        const label = '敌'.repeat(30)
        // 带 1px 字距：330 / 3 行 = 110；不算字距只有 300/3 = 100
        assert.equal(headColumnWidthPx(label, HEAD_BAND_LINES, 1, 1), expected(110))
        assert.ok(headColumnWidthPx(label, HEAD_BAND_LINES, 1, 1) > headColumnWidthPx(label, HEAD_BAND_LINES))
    })

    it('行数上限越多，列越窄（同一段文字）', () => {
        const label = '敌'.repeat(30)
        assert.ok(headColumnWidthPx(label, HEAD_BAND_LINES) < headColumnWidthPx(label, HEAD_NAME_LINES))
    })

    it('超长文本封顶在 HEAD_COL_MAX_PX', () => {
        const label = '敌'.repeat(300)
        assert.equal(headColumnWidthPx(label, 2), HEAD_COL_MAX_PX)
    })

    it('按 colspan 分摊：跨 2 列的横条每列只要一半', () => {
        const label = '敌'.repeat(30)
        assert.equal(headColumnWidthPx(label, 2, 2), Math.ceil(expected(150) / 2))
    })

    it('span 非法时按 1 列处理', () => {
        const label = '敌'.repeat(30)
        assert.equal(headColumnWidthPx(label, 2, 0), headColumnWidthPx(label, 2, 1))
    })

    it('内边距与余量参与计算：宽度恒 ≥ 文字宽 ÷ 行数 + 22', () => {
        const label = '敌'.repeat(10)
        assert.ok(headColumnWidthPx(label, 2) >= Math.ceil(100 / 2) + HEAD_CELL_PAD_PX + HEAD_WIDTH_SLACK_PX)
    })

    it('实测回归：31~32 字的中文横条算出的宽度 ≥ 浏览器里 3 行放得下的最小宽度', () => {
        // 最小宽度来自无头 Edge 实测（.tmp/hdr-probe/fit.mjs）：122 / 134 / 130 px
        const cases: [string, number][] = [
            ['【挑灯问剑】达到400点时获得竹照，附近队伍中队友获得伤害加成', 122],
            ['下一个登场角色声骸技能伤害加深，持续14秒，若切换角色则效果消失', 134],
            ['仇远暴击高于50%时，每多出1%暴击，施放该技能获得额外一次伤害', 130]
        ]
        for (const [label, minPx] of cases) {
            const width = headColumnWidthPx(label, HEAD_BAND_LINES, 1, 1)
            assert.ok(width >= minPx, `「${label}」算出 ${width}px，实测至少要 ${minPx}px 才能 3 行放下`)
        }
    })
})
