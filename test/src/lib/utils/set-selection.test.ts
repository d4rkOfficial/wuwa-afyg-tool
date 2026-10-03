// 触发套装选择的件数预算回归。
//
// 症状（用户报告）：在套装里**先选 3 件套、再点 5 件套**，件数会变成 3 + 5 = 8（picker 底部显示 `8/5`）——
// 5 件套占满全部 5 个部位，本就必须替换掉先前选择，但旧实现只做 `[...selected, {5}, {2}]`。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    MAX_SET_PIECES,
    canPickPiece,
    fivePieceSelection,
    formatSetSelection,
    remainingPiecesOf,
    togglePieceSelection,
    totalPiecesOf
} from '$lib/utils/set-selection'
import type { SelectedSet } from '$lib/types/project'

const sel = (...pairs: [string, number][]): SelectedSet[] => pairs.map(([name, pieces]) => ({ name, pieces }))

describe('有效件数与剩余部位', () => {
    it('同名只取最大件数（5 件套附带的 2 件套不重复计）', () => {
        assert.equal(totalPiecesOf(fivePieceSelection('A')), 5)
        assert.equal(totalPiecesOf(sel(['A', 2], ['A', 5])), 5)
        assert.equal(totalPiecesOf(sel(['A', 2])), 2)
        assert.equal(totalPiecesOf([]), 0)
    })

    it('剩余部位 = 5 − 有效件数', () => {
        assert.equal(MAX_SET_PIECES, 5)
        assert.equal(remainingPiecesOf(sel(['A', 3])), 2)
        assert.equal(remainingPiecesOf(sel(['A', 3], ['B', 2])), 0)
    })
})

describe('件数切换不能超预算（回归：先 3 件套再 5 件套）', () => {
    it('先选 3 件套、再选 5 件套 → 5 件套替换掉它，总件数仍是 5', () => {
        const afterThree = togglePieceSelection([], 'A', 3)
        assert.deepEqual(afterThree, sel(['A', 3]))

        const afterFive = togglePieceSelection(afterThree, 'B', 5)
        assert.deepEqual(afterFive, fivePieceSelection('B'), '5 件套必须替换掉 A(3)')
        assert.equal(totalPiecesOf(afterFive), 5, '不得出现 3 + 5 = 8')
    })

    it('已有 3+2 时点第三套的 5 件套 → 全部替换', () => {
        const before = sel(['A', 3], ['B', 2])
        const after = togglePieceSelection(before, 'C', 5)
        assert.deepEqual(after, fivePieceSelection('C'))
        assert.equal(totalPiecesOf(after), 5)
    })

    it('已选套装内部换档：5 → 3 会释放部位（其它套装此前已被它替换掉）', () => {
        const five = fivePieceSelection('A')
        const three = togglePieceSelection(five, 'A', 3)
        assert.deepEqual(three, sel(['A', 3]))
        assert.equal(remainingPiecesOf(three), 2, '换档后应能再配一套 2 件套')
        assert.deepEqual(togglePieceSelection(three, 'B', 2), sel(['A', 3], ['B', 2]))
    })

    it('点已选中的同一档 → 取消该套装', () => {
        assert.deepEqual(togglePieceSelection(sel(['A', 3]), 'A', 3), [])
        assert.deepEqual(togglePieceSelection(fivePieceSelection('A'), 'A', 5), [], '5 件套同档也整体取消')
    })

    it('换档只动这一套，其它套装保持', () => {
        const before = sel(['A', 2], ['B', 3])
        assert.deepEqual(togglePieceSelection(before, 'A', 3), sel(['B', 3], ['A', 3]))
    })
})

describe('可点判定：5 件套恒定可点（它会替换），其余受剩余部位约束', () => {
    it('剩余 2 时：3/4 件套不可点，5 件套仍可点', () => {
        const sets = sel(['A', 3])
        assert.equal(canPickPiece(sets, 'B', 2), true)
        assert.equal(canPickPiece(sets, 'B', 3), false)
        assert.equal(canPickPiece(sets, 'B', 4), false)
        assert.equal(canPickPiece(sets, 'B', 5), true, '5 件套替换全部，故不受剩余部位限制')
    })

    it('已选中的套装各档恒可点（用于换档/取消）', () => {
        const sets = fivePieceSelection('A')
        assert.equal(canPickPiece(sets, 'A', 5), true)
        assert.equal(canPickPiece(sets, 'A', 2), true)
    })
})

describe('展示文案', () => {
    it('同名取最大件数，空选择为「无」', () => {
        assert.equal(formatSetSelection([]), '无')
        assert.equal(formatSetSelection(fivePieceSelection('A')), 'A(5)')
        assert.equal(formatSetSelection(sel(['A', 3], ['B', 2])), 'A(3) + B(2)')
    })
})
