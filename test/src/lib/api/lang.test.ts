// ── API 语言参数解析单测 ─────────────────────────────────────────────────
// ?lang= 不做归一化：原样返回给 provider，缺失/空白回退默认中文。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LANG, langFromUrl } from '$lib/api/lang'

const urlOf = (query: string) => new URL(`http://localhost/api/v1/list/character${query}`)

describe('langFromUrl', () => {
    it('returns the raw lang value without normalization', () => {
        assert.equal(langFromUrl(urlOf('?lang=en')), 'en')
        assert.equal(langFromUrl(urlOf('?lang=ja')), 'ja')
        assert.equal(langFromUrl(urlOf('?lang=zh-Hant')), 'zh-Hant')
    })

    it('falls back to the default language when missing or blank', () => {
        assert.equal(DEFAULT_LANG, 'zh')
        assert.equal(langFromUrl(urlOf('')), 'zh')
        assert.equal(langFromUrl(urlOf('?lang=')), 'zh')
        assert.equal(langFromUrl(urlOf('?lang=%20%20')), 'zh')
        assert.equal(langFromUrl(undefined), 'zh')
    })

    it('keeps unknown languages (provider decides how to fall back)', () => {
        assert.equal(langFromUrl(urlOf('?lang=fr')), 'fr')
    })
})
