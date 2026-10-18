// AI 助手开关只由持久化偏好决定：B 站 Toy 不再有平台级强制隐藏。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { getGenPrefs, isAiEnabled, updateGenPrefs } from '$lib/data/ai-prefs.svelte'

describe('AI 助手开关：持久化偏好即实际状态', () => {
    it('默认关闭', () => {
        assert.equal(getGenPrefs().enabled, false)
        assert.equal(isAiEnabled(), false)
    })

    it('开启后实际状态为启用（Toy 与普通浏览器一致，无会话级抑制）', async () => {
        await updateGenPrefs({ enabled: true })
        assert.equal(getGenPrefs().enabled, true)
        assert.equal(isAiEnabled(), true)
    })

    it('关闭后实际状态为禁用', async () => {
        await updateGenPrefs({ enabled: false })
        assert.equal(getGenPrefs().enabled, false)
        assert.equal(isAiEnabled(), false)
    })
})
