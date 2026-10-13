// WS 连接目标解析回归：hash（`#websocket=`）与「设置-连接配置」的服务地址输入共用同一校验，
// 该函数是两者唯一的合法性判定，写错会让非法地址被当成 host:port 或反之。
//
// 只 import 纯函数模块 `$lib/ws-remote/ws-target`：`ws-remote.svelte.ts` 会连带拉进整个 AI 工具注册表
// （→ `$lib/theme` 的 `.svelte.ts` 内部 import），node:test 的解析器加载不起来。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { parseWsTarget } from '$lib/ws-remote/ws-target'

describe('parseWsTarget（WS 目标解析）', () => {
    it('空值/纯空白返回 null', () => {
        assert.equal(parseWsTarget(''), null)
        assert.equal(parseWsTarget('   '), null)
    })

    it('host:port 自动补协议（测试环境无 location ⇒ ws）', () => {
        assert.equal(parseWsTarget('127.0.0.1:8765'), 'ws://127.0.0.1:8765')
        assert.equal(parseWsTarget('  example.com:443  '), 'ws://example.com:443')
        assert.equal(parseWsTarget('my-host.local:1'), 'ws://my-host.local:1')
    })

    it('完整 ws/wss 地址原样保留（协议大小写不敏感）', () => {
        assert.equal(parseWsTarget('ws://127.0.0.1:8765'), 'ws://127.0.0.1:8765')
        assert.equal(parseWsTarget('wss://example.com/ws'), 'wss://example.com/ws')
        assert.equal(parseWsTarget('WSS://example.com/ws'), 'WSS://example.com/ws')
    })

    it('其它协议、缺端口、端口越界一律拒绝', () => {
        assert.equal(parseWsTarget('http://127.0.0.1:8765'), null)
        assert.equal(parseWsTarget('https://example.com'), null)
        assert.equal(parseWsTarget('localhost'), null)
        assert.equal(parseWsTarget('127.0.0.1'), null)
        assert.equal(parseWsTarget('127.0.0.1:999999'), null)
        assert.equal(parseWsTarget('ws://'), null)
    })
})
