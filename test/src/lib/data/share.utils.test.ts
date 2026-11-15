// 分享快照：两条链接都由同一个工坊下载地址派生（工具箱走 hash 导入、fast-calc 走 import_project），
// 过期判定与倒计时文案同一口径。这里只锁纯函数，localStorage 与弹窗状态不参与。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
    SHARE_TTL_MS,
    buildShareSnapshot,
    formatShareCountdown,
    isShareSnapshotExpired,
    parseShareSnapshot,
    shareFastCalcLinkOf,
    shareToolLinkOf
} from '$lib/data/share.utils'

const ORIGIN = 'https://tool.example'
const DOWNLOAD = 'https://share.example/share/abc123/download'

describe('分享链接格式', () => {
    it('工具箱链接走 hash 的 import_project，下载地址整体转义', () => {
        assert.equal(
            shareToolLinkOf(ORIGIN, DOWNLOAD),
            'https://tool.example#import_project=https%3A%2F%2Fshare.example%2Fshare%2Fabc123%2Fdownload'
        )
    })

    it('简表链接走 fast-calc 的 import_project', () => {
        assert.equal(
            shareFastCalcLinkOf(ORIGIN, DOWNLOAD),
            'https://tool.example/fast-calc?import_project=https%3A%2F%2Fshare.example%2Fshare%2Fabc123%2Fdownload'
        )
    })
})

describe('分享快照', () => {
    it('过期时间为创建时间 + 有效期，两条链接同时就绪', () => {
        const snapshot = buildShareSnapshot({
            projectId: 'p1',
            downloadUrl: DOWNLOAD,
            origin: ORIGIN,
            createdAt: 1000
        })
        assert.equal(snapshot.createdAt, 1000)
        assert.equal(snapshot.expiresAt, 1000 + SHARE_TTL_MS)
        assert.equal(snapshot.toolLink, shareToolLinkOf(ORIGIN, DOWNLOAD))
        assert.equal(snapshot.fastCalcLink, shareFastCalcLinkOf(ORIGIN, DOWNLOAD))
    })

    it('到点即过期', () => {
        const snapshot = buildShareSnapshot({
            projectId: 'p1',
            downloadUrl: DOWNLOAD,
            origin: ORIGIN,
            createdAt: 0
        })
        assert.equal(isShareSnapshotExpired(snapshot, SHARE_TTL_MS - 1), false)
        assert.equal(isShareSnapshotExpired(snapshot, SHARE_TTL_MS), true)
    })
})

describe('分享倒计时文案', () => {
    it('向上取整到秒，满一分钟不进位成 60 秒', () => {
        assert.equal(formatShareCountdown(9 * 60 * 1000 + 45 * 1000), '09:45')
        assert.equal(formatShareCountdown(59_001), '01:00')
        assert.equal(formatShareCountdown(0), '00:00')
    })

    it('负值归零', () => {
        assert.equal(formatShareCountdown(-5), '00:00')
    })
})

describe('本地快照解析', () => {
    it('字段齐全时原样还原', () => {
        const snapshot = buildShareSnapshot({
            projectId: 'p1',
            downloadUrl: DOWNLOAD,
            origin: ORIGIN,
            createdAt: 42
        })
        assert.deepEqual(parseShareSnapshot(JSON.stringify(snapshot)), snapshot)
    })

    it('缺字段 / 非 JSON / 空值一律视为没有快照', () => {
        assert.equal(parseShareSnapshot(null), null)
        assert.equal(parseShareSnapshot(''), null)
        assert.equal(parseShareSnapshot('not json'), null)
        assert.equal(parseShareSnapshot('{"projectId":"p1"}'), null)
        const snapshot = buildShareSnapshot({
            projectId: 'p1',
            downloadUrl: DOWNLOAD,
            origin: ORIGIN,
            createdAt: 42
        })
        assert.equal(parseShareSnapshot(JSON.stringify({ ...snapshot, expiresAt: 'x' })), null)
        assert.equal(parseShareSnapshot(JSON.stringify({ ...snapshot, toolLink: '' })), null)
    })
})
