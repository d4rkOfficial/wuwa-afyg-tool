// 回归：AI 助手开关的「Toy 会话级抑制」不得写坏持久化偏好。
//
// 历史 bug：B 站 Toy 的进入回调直接 `updateGenPrefs({ enabled: false })`（会 dbSet 落盘），
// 于是「在 Toy 里被自动关闭」会永久改掉用户存下的开关 —— 属于「设置重进丢失配置」。
// 现在改为会话级抑制：`isAiEnabled()` = 持久化偏好 ∧ 非抑制，偏好本身原样保留。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    getAiSessionDisabled,
    getGenPrefs,
    isAiEnabled,
    setAiSessionDisabled,
    updateGenPrefs
} from '$lib/data/ai-prefs.svelte'

describe('AI 助手开关：会话级抑制与持久化偏好的关系', () => {
    it('默认关闭且未被抑制', () => {
        assert.equal(getGenPrefs().enabled, false)
        assert.equal(getAiSessionDisabled(), false)
        assert.equal(isAiEnabled(), false)
    })

    it('开启后实际状态为启用', async () => {
        await updateGenPrefs({ enabled: true })
        assert.equal(getGenPrefs().enabled, true)
        assert.equal(isAiEnabled(), true)
    })

    it('会话级抑制只压住实际状态，不改动持久化偏好', () => {
        setAiSessionDisabled(true)
        assert.equal(isAiEnabled(), false)
        // 关键断言：偏好仍是用户存下的 true（旧实现这里会被写成 false 并落盘）
        assert.equal(getGenPrefs().enabled, true)
        setAiSessionDisabled(false)
        assert.equal(isAiEnabled(), true)
    })

    it('收尾：恢复默认，避免污染同进程内其他测试', async () => {
        setAiSessionDisabled(false)
        await updateGenPrefs({ enabled: false })
        assert.equal(isAiEnabled(), false)
        assert.equal(getGenPrefs().enabled, false)
    })
})
