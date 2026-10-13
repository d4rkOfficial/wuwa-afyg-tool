// WS 连接偏好回归：默认关闭、地址可保存；测试以 server 端运行（`browser=false`），
// 因此 localStorage 分支不触发，只验证内存态与「无浏览器环境不崩」。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { getWsEnabled, getWsServerUrl, setWsEnabled, setWsServerUrl } from '$lib/data/ws-prefs.svelte'

describe('ws-prefs（WS 连接偏好）', () => {
    it('默认关闭且地址为空（带 hash 访问不写偏好）', () => {
        assert.equal(getWsEnabled(), false)
        assert.equal(getWsServerUrl(), '')
    })

    it('开关与地址可写可读，地址写入时去首尾空白', () => {
        setWsEnabled(true)
        assert.equal(getWsEnabled(), true)
        setWsServerUrl('  127.0.0.1:8765  ')
        assert.equal(getWsServerUrl(), '127.0.0.1:8765')
        setWsEnabled(false)
        assert.equal(getWsEnabled(), false)
    })
})
