// 「弹窗关闭按钮位置」重进丢失配置的回归：
// 该设置此前只有写入口（setModalClosePosition → localStorage），模块初始化时**没有读回**，
// 于是刷新 / 重进后一律回到默认右上角（B 站 Toy 首次进入写入的 top-left 同样丢失）。
// 这里锁住「读回时的取值口径」：只认两个合法值，其余（含 null / 空串 / 历史脏值）回落默认。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_MODAL_CLOSE_POSITION, parseModalClosePosition } from '$lib/data/interaction-prefs.svelte'

describe('parseModalClosePosition', () => {
    it('回读合法持久化值', () => {
        assert.equal(parseModalClosePosition('top-left'), 'top-left')
        assert.equal(parseModalClosePosition('top-right'), 'top-right')
    })

    it('未持久化（null）回落默认右上角', () => {
        assert.equal(parseModalClosePosition(null), DEFAULT_MODAL_CLOSE_POSITION)
        assert.equal(DEFAULT_MODAL_CLOSE_POSITION, 'top-right')
    })

    it('非法 / 历史脏值回落默认，不抛错', () => {
        for (const raw of ['', 'left', 'TOP-LEFT', '{"position":"top-left"}', 'undefined']) {
            assert.equal(parseModalClosePosition(raw), DEFAULT_MODAL_CLOSE_POSITION, `raw=${raw}`)
        }
    })
})
