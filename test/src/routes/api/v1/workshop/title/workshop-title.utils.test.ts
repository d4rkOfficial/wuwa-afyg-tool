import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
    extractHtmlTitle,
    normalizeSiteTitle,
    parseTitleTarget
} from '$src/routes/api/v1/workshop/title/workshop-title.utils'

describe('工坊站点标题解析', () => {
    it('取 <title> 并压缩空白', () => {
        const html = '<html><head><title>\n  椰果工坊 · 鸣算屋转接器  \n</title></head></html>'
        assert.equal(extractHtmlTitle(html), '椰果工坊 · 鸣算屋转接器')
    })

    it('解码常见 HTML 实体', () => {
        assert.equal(normalizeSiteTitle('A &amp; B &#39;C&#39; &#x4E2D;'), "A & B 'C' 中")
    })

    it('标题里的标签被去掉，超长标题截断到 80 字', () => {
        assert.equal(normalizeSiteTitle('<b>椰果</b>工坊'), '椰果工坊')
        assert.equal(normalizeSiteTitle('x'.repeat(120)).length, 80)
    })

    it('没有 title 时返回空串', () => {
        assert.equal(extractHtmlTitle('<html><body>no title</body></html>'), '')
    })

    it('URL 归一：缺协议补 https，非法协议返回 null', () => {
        assert.equal(parseTitleTarget('wuwacalc-conv.200503.xyz')?.href, 'https://wuwacalc-conv.200503.xyz/')
        assert.equal(parseTitleTarget('http://wuwacalc-conv.200503.xyz')?.protocol, 'http:')
        assert.equal(parseTitleTarget('ftp://example.com'), null)
        assert.equal(parseTitleTarget(''), null)
    })
})
