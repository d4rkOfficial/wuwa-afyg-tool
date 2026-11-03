// ── 库街区 Token 归一化单测（node:test） ───────────────────────────────────
// 覆盖：裸 token、token= / token: 形式、Bearer 前缀、JSON 片段、整段中文说明、
// 引号与不可见字符、空输入。不依赖网络与上游。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeKuroToken } from '$lib/kuro-app/kuro-token'

describe('normalizeKuroToken', () => {
    it('裸 token 原样返回', () => {
        assert.equal(normalizeKuroToken('abcDEF123456'), 'abcDEF123456')
    })

    it('识别 token= 形式', () => {
        assert.equal(normalizeKuroToken('token=abcDEF123456'), 'abcDEF123456')
    })

    it('识别 token: "..." 形式', () => {
        assert.equal(normalizeKuroToken('token: "abcDEF123456"'), 'abcDEF123456')
    })

    it('去掉 Bearer 前缀', () => {
        assert.equal(normalizeKuroToken('Bearer abcDEF123456'), 'abcDEF123456')
    })

    it('从 JSON 片段里取 token', () => {
        assert.equal(normalizeKuroToken('{"code":200,"data":{"token":"abc.DEF_123-456"}}'), 'abc.DEF_123-456')
    })

    it('整段中文说明里取最长 token 片段', () => {
        assert.equal(normalizeKuroToken('我的 token 是 abcDEF123456 请查收'), 'abcDEF123456')
    })

    it('剔除引号、换行与零宽字符', () => {
        assert.equal(normalizeKuroToken('\u200b"abcDEF123456"\n'), 'abcDEF123456')
    })

    it('空输入与纯中文返回空串', () => {
        assert.equal(normalizeKuroToken(''), '')
        assert.equal(normalizeKuroToken('   '), '')
        assert.equal(normalizeKuroToken('没有凭据'), '')
    })
})
