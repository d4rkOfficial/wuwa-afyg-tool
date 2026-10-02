// web_fetch 纯逻辑回归：入参归一 + HTML→正文提取（text / 轻量 Markdown）+ 结果组装。
//
// 为什么这些用例值得存在：模型给的 URL 与网页给的 HTML **都不可信** ——
// 归一决定「会不会去抓错地址」，提取决定「模型看到的是正文还是满屏脚本与导航」。
// 两者都与网络无关，必须能在没有网络、没有浏览器的情况下逐条钉住。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    DEFAULT_MAX_CHARS,
    HARD_MAX_CHARS,
    buildFetchResult,
    clampMaxChars,
    collapseWhitespace,
    contentKindOf,
    decodeEntities,
    extractContentHtml,
    extractTitle,
    htmlToMarkdown,
    htmlToText,
    normalizeFetchUrl,
    normalizeWebFetchArgs,
    pickMainHtml,
    readFormat,
    resolveHref,
    stripChrome,
    stripHiddenBlocks,
    truncateContent
} from './web-fetch.utils'

/** @desc 一份「像真网页」的夹具：外壳 + 脚本/样式 + 正文 + 相对链接 + 实体 */
const PAGE = `<!doctype html>
<html lang="zh-CN">
  <head>
    <title>伤害计算 &amp; 词条说明</title>
    <style>.hidden { display: none }</style>
    <script>window.__DATA__ = { secret: '不应出现在正文里' }</script>
  </head>
  <body>
    <nav><a href="/">首页</a><a href="/guide">攻略</a></nav>
    <header>站点头部：也不该出现</header>
    <main>
      <article>
        <h1>伤害计算说明</h1>
        <p>第一段：暴击<strong>期望</strong>与<em>抗性</em>的关系。</p>
        <ul>
          <li>词条一：攻&amp;击力</li>
          <li>词条二：暴击伤害 &#215; 2</li>
        </ul>
        <p>详见 <a href="../terms/calc">计算术语</a>、<a href="#top">回到顶部</a> 与 <a href="javascript:void(0)">无效链接</a>。</p>
        <pre><code>const dps = atk * rate;</code></pre>
        <p>行内 <code>rate</code> 说明。</p>
        <svg><text>矢量图文字</text></svg>
        <!-- 注释也要丢掉 -->
      </article>
    </main>
    <aside>侧栏广告</aside>
    <footer>页脚版权</footer>
  </body>
</html>`

const BASE = 'https://docs.example.com/guide/damage'

describe('入参归一：URL / 格式 / 上限 / 正文区域', () => {
    it('缺协议按 https 补全、去掉 fragment、trim；scheme 原样保留', () => {
        assert.equal(normalizeFetchUrl('  example.com/a/b  '), 'https://example.com/a/b')
        assert.equal(normalizeFetchUrl('http://a.test/x?q=1#frag'), 'http://a.test/x?q=1')
        assert.equal(normalizeFetchUrl('https://a.test/x'), 'https://a.test/x')
    })

    it('空值 / 非法值 / 非 http(s) 协议抛可读错误（不让抓取悄悄失败）', () => {
        assert.throws(() => normalizeFetchUrl(''), /url/)
        assert.throws(() => normalizeFetchUrl(undefined), /url/)
        assert.throws(() => normalizeFetchUrl('ftp://a.test/x'), /http/)
        assert.throws(() => normalizeFetchUrl('javascript:alert(1)'), /http/)
    })

    it('缺省值：format=text、maxChars=8000、mainOnly=true', () => {
        assert.deepEqual(normalizeWebFetchArgs({ url: 'a.test' }), {
            url: 'https://a.test/',
            format: 'text',
            maxChars: DEFAULT_MAX_CHARS,
            mainOnly: true
        })
        assert.equal(normalizeWebFetchArgs({ url: 'a.test', mainOnly: false }).mainOnly, false)
        // 显式 mainOnly=true 保持 true（只有 === false 才算关）
        assert.equal(normalizeWebFetchArgs({ url: 'a.test', mainOnly: true }).mainOnly, true)
    })

    it('maxChars 钳制：非法/非正数回落默认值，超限压到硬顶，字符串数字也认', () => {
        assert.equal(clampMaxChars(2500), 2500)
        assert.equal(clampMaxChars('2500'), 2500)
        assert.equal(clampMaxChars(0), DEFAULT_MAX_CHARS)
        assert.equal(clampMaxChars(-100), DEFAULT_MAX_CHARS)
        assert.equal(clampMaxChars('abc'), DEFAULT_MAX_CHARS)
        assert.equal(clampMaxChars(Number.NaN), DEFAULT_MAX_CHARS)
        assert.equal(clampMaxChars(999999), HARD_MAX_CHARS)
        assert.equal(clampMaxChars(12.7), 12)
    })

    it('format 只认 text/markdown，其它值回落 text（格式选择不值得让整次抓取失败）', () => {
        assert.equal(readFormat('markdown'), 'markdown')
        assert.equal(readFormat('text'), 'text')
        assert.equal(readFormat('html'), 'text')
        assert.equal(readFormat(undefined), 'text')
    })
})

describe('HTML 清洗：实体 / 空白 / 不可见块 / 外壳', () => {
    it('实体解码：命名、十进制、十六进制；不认识的整段原样保留', () => {
        assert.equal(
            decodeEntities('&amp; &lt; &gt; &quot; &#65; &#x42; &nbsp; &unknown; &copy;'),
            '& < > " A B   &unknown; ©'
        )
        assert.equal(decodeEntities('&#x1F600;'), '😀')
        assert.equal(decodeEntities('&'), '&')
    })

    it('空白折叠：统一换行、压缩行内空白、去掉多余空行', () => {
        assert.equal(collapseWhitespace('a\r\n\r\n\r\n b\t\tc  \n\n\n\n d '), 'a\n\nb c\n\nd')
    })

    it('不可见块整块丢弃：script/style/svg/注释/iframe 都不进正文', () => {
        const cleaned = stripHiddenBlocks(PAGE)
        assert.doesNotMatch(cleaned, /secret/)
        assert.doesNotMatch(cleaned, /display: none/)
        assert.doesNotMatch(cleaned, /矢量图文字/)
        assert.doesNotMatch(cleaned, /注释也要丢掉/)
        assert.match(cleaned, /伤害计算说明/)
    })

    it('外壳剥离：nav / header / footer / aside 都不是正文', () => {
        const cleaned = stripChrome(PAGE)
        assert.doesNotMatch(cleaned, /站点头部/)
        assert.doesNotMatch(cleaned, /侧栏广告/)
        assert.doesNotMatch(cleaned, /页脚版权/)
        assert.match(cleaned, /伤害计算说明/)
    })

    it('正文区域选择：article 优先 → main → body → 整篇（返回的是区域内**内容**，不含外壳标签）', () => {
        assert.match(pickMainHtml(PAGE), /<h1>伤害计算说明<\/h1>/)
        assert.doesNotMatch(pickMainHtml(PAGE), /站点头部/)
        assert.equal(pickMainHtml('<html><body><main>M</main></body></html>'), 'M')
        assert.equal(pickMainHtml('<html><body>B</body></html>'), 'B')
        assert.equal(pickMainHtml('<p>裸片段</p>'), '<p>裸片段</p>')
        // mainOnly=false 时不做区域选择与外壳剥离，只由后续清洗去不可见块
        assert.match(extractContentHtml(PAGE, false), /站点头部/)
        assert.doesNotMatch(extractContentHtml(PAGE, true), /站点头部/)
    })

    it('标题：title 优先（含实体与内联标签），缺失回落首个 h1，都没有则空串', () => {
        assert.equal(extractTitle(PAGE), '伤害计算 & 词条说明')
        assert.equal(extractTitle('<h1>只有 H1</h1>'), '只有 H1')
        assert.equal(extractTitle('<title>带 <b>标签</b> 的题</title>'), '带 标签 的题')
        assert.equal(extractTitle('<p>没有标题</p>'), '')
    })
})

describe('HTML → 纯文本', () => {
    it('块级转换行、列表项加前缀、相邻列表项不留空行、标签与隐藏块全部清掉', () => {
        const text = htmlToText(extractContentHtml(PAGE, true))
        assert.match(text, /^伤害计算说明/)
        assert.match(text, /· 词条一：攻&击力/)
        assert.match(text, /· 词条二：暴击伤害 × 2/)
        // 相邻列表项之间只有一个换行（连续清单不该被拆成散行）
        assert.match(text, /· 词条一：攻&击力\n· 词条二/)
        assert.doesNotMatch(text, /<[a-z]/i)
        assert.doesNotMatch(text, /secret|站点头部|侧栏广告|页脚版权/)
        assert.match(text, /const dps = atk \* rate;/)
    })
})

describe('HTML → 轻量 Markdown', () => {
    it('标题 / 列表 / 行内代码 / 粗斜体 / 代码块', () => {
        const md = htmlToMarkdown(extractContentHtml(PAGE, true), BASE)
        assert.match(md, /^# 伤害计算说明/)
        assert.match(md, /- 词条一：攻&击力/)
        assert.match(md, /\*\*期望\*\*/)
        assert.match(md, /\*抗性\*/)
        assert.match(md, /```\nconst dps = atk \* rate;\n```/)
        assert.match(md, /行内 `rate` 说明/)
    })

    it('链接：相对地址按页面地址补成绝对地址；锚点与脚本协议只留文字', () => {
        const md = htmlToMarkdown(extractContentHtml(PAGE, true), BASE)
        assert.match(md, /\[计算术语\]\(https:\/\/docs\.example\.com\/terms\/calc\)/)
        assert.match(md, /回到顶部/)
        assert.doesNotMatch(md, /javascript:/)
        assert.equal(resolveHref('a/b', 'https://x.test/dir/page'), 'https://x.test/dir/a/b')
        assert.equal(resolveHref('#top', 'https://x.test/'), '')
        assert.equal(resolveHref('mailto:a@b.c', 'https://x.test/'), '')
    })

    it('无 baseUrl 可用时（非法地址）不抛错，退化为原样保留 href', () => {
        assert.equal(resolveHref('a/b', 'not-a-url'), 'a/b')
        assert.doesNotThrow(() => htmlToMarkdown('<a href="/x">t</a>', 'not-a-url'))
    })

    it('未闭合/畸形标签不崩：只留文字（不猜闭合位置、不臆造标记）', () => {
        assert.equal(htmlToText('<div><p>半截'), '半截')
        assert.equal(htmlToMarkdown('<b>粗', BASE), '粗')
        assert.equal(htmlToMarkdown('<a href="/x">只有开标签', BASE), '只有开标签')
    })
})

describe('响应类型与结果组装', () => {
    it('Content-Type 归类：未声明按 HTML 赌一把；xml 归文本；pdf 归其它', () => {
        assert.equal(contentKindOf('text/html; charset=utf-8'), 'html')
        assert.equal(contentKindOf('application/xhtml+xml'), 'html')
        assert.equal(contentKindOf(''), 'html')
        assert.equal(contentKindOf('text/plain'), 'text')
        assert.equal(contentKindOf('application/rss+xml'), 'text')
        assert.equal(contentKindOf('application/json'), 'json')
        assert.equal(contentKindOf('application/pdf'), 'other')
        assert.equal(contentKindOf('image/png'), 'other')
    })

    it('截断：边界（长度恰好等于上限）不算截断', () => {
        assert.deepEqual(truncateContent('abcde', 5), { content: 'abcde', truncated: false })
        assert.deepEqual(truncateContent('abcdef', 5), { content: 'abcde', truncated: true })
    })

    it('HTML 结果：带标题、正文、truncated 标记；markdown 模式走 markdown 提取', () => {
        const text = buildFetchResult({
            url: BASE,
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: PAGE,
            format: 'text',
            maxChars: DEFAULT_MAX_CHARS,
            mainOnly: true
        })
        assert.equal(text.title, '伤害计算 & 词条说明')
        assert.equal(text.status, 200)
        assert.equal(text.url, BASE)
        assert.equal(text.truncated, false)
        assert.match(text.content, /· 词条一/)
        assert.equal(text.note, undefined)

        const md = buildFetchResult({
            url: BASE,
            status: 200,
            contentType: 'text/html',
            body: PAGE,
            format: 'markdown',
            maxChars: DEFAULT_MAX_CHARS,
            mainOnly: true
        })
        assert.match(md.content, /\[计算术语\]\(https:/)

        const clipped = buildFetchResult({
            url: BASE,
            status: 200,
            contentType: 'text/html',
            body: PAGE,
            format: 'text',
            maxChars: 40,
            mainOnly: true
        })
        assert.equal(clipped.truncated, true)
        assert.equal(clipped.content.length, 40)
    })

    it('JSON / 纯文本原样收成正文；非文本类型只给说明不给正文', () => {
        const json = buildFetchResult({
            url: 'https://api.test/x',
            status: 200,
            contentType: 'application/json',
            body: '{"a":1}',
            format: 'text',
            maxChars: DEFAULT_MAX_CHARS,
            mainOnly: true
        })
        assert.equal(json.content, '{"a":1}')
        assert.equal(json.title, undefined)

        const pdf = buildFetchResult({
            url: 'https://x.test/a.pdf',
            status: 200,
            contentType: 'application/pdf',
            body: '%PDF-1.7 乱码',
            format: 'text',
            maxChars: DEFAULT_MAX_CHARS,
            mainOnly: true
        })
        assert.equal(pdf.content, '')
        assert.match(pdf.note ?? '', /application\/pdf/)
    })

    it('未声明 Content-Type 时 contentType 记为「(未声明)」且仍按 HTML 提取', () => {
        const res = buildFetchResult({
            url: 'https://x.test/',
            status: 200,
            contentType: '',
            body: '<html><body><p>正文</p></body></html>',
            format: 'text',
            maxChars: DEFAULT_MAX_CHARS,
            mainOnly: true
        })
        assert.equal(res.contentType, '(未声明)')
        assert.equal(res.content, '正文')
    })
})
