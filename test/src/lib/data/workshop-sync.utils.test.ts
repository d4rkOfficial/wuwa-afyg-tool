// 工坊自动同步的纯逻辑回归：时机判定 / 上次同步相对文案 / 结果 toast 文案。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
    buildSyncToast,
    emptySyncStamp,
    formatSyncAge,
    isWorkshopSyncDue,
    WORKSHOP_SYNC_INTERVALS,
    WORKSHOP_SYNC_KINDS,
    WORKSHOP_SYNC_TIMINGS,
    type WorkshopSyncOutcome
} from '$lib/data/workshop-sync.utils'

const NOW = 1_700_000_000_000

const due = (patch: Partial<Parameters<typeof isWorkshopSyncDue>[0]> = {}) =>
    isWorkshopSyncDue({
        timing: 'enter',
        lastAt: NOW - 1000,
        lastVersion: '3.5',
        now: NOW,
        version: '3.5',
        ...patch
    })

describe('取值域与默认记录', () => {
    it('两类数据 / 四种时机', () => {
        assert.deepEqual([...WORKSHOP_SYNC_KINDS], ['buff', 'substat'])
        assert.deepEqual([...WORKSHOP_SYNC_TIMINGS], ['enter', 'daily', 'weekly', 'version'])
    })

    it('emptySyncStamp 表示「从未同步」，且每次返回新对象', () => {
        const a = emptySyncStamp()
        const b = emptySyncStamp()
        assert.equal(a.at, 0)
        assert.equal(a.version, '')
        assert.notEqual(a, b)
    })
})

describe('isWorkshopSyncDue', () => {
    it('从未同步时任何时机都该同步', () => {
        for (const timing of WORKSHOP_SYNC_TIMINGS) {
            assert.equal(due({ timing, lastAt: 0, lastVersion: '' }), true, `timing=${timing}`)
        }
    })

    it('每次进入：同步过也照样同步', () => {
        assert.equal(due({ timing: 'enter', lastAt: NOW - 1 }), true)
    })

    it('每天一次：不足 24 小时跳过，满 24 小时同步', () => {
        assert.equal(due({ timing: 'daily', lastAt: NOW - WORKSHOP_SYNC_INTERVALS.daily + 1 }), false)
        assert.equal(due({ timing: 'daily', lastAt: NOW - WORKSHOP_SYNC_INTERVALS.daily }), true)
    })

    it('每周一次：不足 7 天跳过，满 7 天同步', () => {
        assert.equal(due({ timing: 'weekly', lastAt: NOW - WORKSHOP_SYNC_INTERVALS.weekly + 1 }), false)
        assert.equal(due({ timing: 'weekly', lastAt: NOW - WORKSHOP_SYNC_INTERVALS.weekly }), true)
    })

    it('每周一次的时间窗比每天一次长', () => {
        const twoDaysAgo = NOW - 2 * WORKSHOP_SYNC_INTERVALS.daily
        assert.equal(due({ timing: 'daily', lastAt: twoDaysAgo }), true)
        assert.equal(due({ timing: 'weekly', lastAt: twoDaysAgo }), false)
    })

    it('上游新版本：只比版本号，不看时间', () => {
        assert.equal(due({ timing: 'version', lastVersion: '3.5', version: '3.5' }), false)
        assert.equal(due({ timing: 'version', lastVersion: '3.4', version: '3.5' }), true)
        // 昨天刚同步过、但版本没变 → 仍跳过（时间不是判据）
        assert.equal(due({ timing: 'version', lastAt: NOW - 1000, lastVersion: '3.5', version: '3.5' }), false)
    })

    it('系统时间倒退时按「还没到」处理，不反复重试', () => {
        assert.equal(due({ timing: 'daily', lastAt: NOW + 5 * WORKSHOP_SYNC_INTERVALS.daily }), false)
    })
})

describe('formatSyncAge', () => {
    it('从未同步', () => {
        assert.equal(formatSyncAge(0, NOW), '从未同步')
    })

    it('按分 / 时 / 天分档', () => {
        assert.equal(formatSyncAge(NOW - 30_000, NOW), '刚刚')
        assert.equal(formatSyncAge(NOW - 5 * 60_000, NOW), '5 分钟前')
        assert.equal(formatSyncAge(NOW - 3 * 3_600_000, NOW), '3 小时前')
        assert.equal(formatSyncAge(NOW - 2 * 86_400_000, NOW), '2 天前')
    })

    it('未来时间戳（时钟倒退）不出现负数文案', () => {
        assert.equal(formatSyncAge(NOW + 60_000, NOW), '刚刚')
    })
})

describe('buildSyncToast', () => {
    const ok = (kind: 'buff' | 'substat', added: number): WorkshopSyncOutcome => ({ kind, ok: true, added })
    const fail = (kind: 'buff' | 'substat', error?: string): WorkshopSyncOutcome => ({
        kind,
        ok: false,
        added: 0,
        ...(error ? { error } : {})
    })

    it('全部成功：success + 逐类计数', () => {
        const toast = buildSyncToast([ok('buff', 12), ok('substat', 130)])
        assert.equal(toast.type, 'success')
        assert.equal(toast.message, '工坊自动同步完成：Buff 集 +12 · 词条集 +130')
    })

    it('手动同步只换前缀', () => {
        assert.equal(buildSyncToast([ok('buff', 1)], true).message, '工坊同步完成：Buff 集 +1')
    })

    it('全部失败：error + 首个错误原因', () => {
        const toast = buildSyncToast([fail('buff', 'HTTP 500'), fail('substat', '连接失败')])
        assert.equal(toast.type, 'error')
        assert.equal(toast.message, '工坊自动同步失败：HTTP 500')
    })

    it('缺 error 时给出兜底原因', () => {
        assert.equal(buildSyncToast([fail('buff')]).message, '工坊自动同步失败：无法连接工坊')
    })

    it('部分成功：仍报 error，并带上已成功的部分', () => {
        const toast = buildSyncToast([ok('buff', 12), fail('substat', 'HTTP 404')])
        assert.equal(toast.type, 'error')
        assert.equal(toast.message, '工坊自动同步部分完成（Buff 集 +12），词条集失败：HTTP 404')
    })

    it('空结果不至于拼出半个冒号', () => {
        assert.deepEqual(buildSyncToast([]), { message: '工坊自动同步完成', type: 'success' })
    })
})
