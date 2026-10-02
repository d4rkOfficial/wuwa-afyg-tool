/**
 * @desc `web_fetch` 的**纯逻辑**成分：入参校验/归一 + HTML→正文提取（纯文本 / 轻量 Markdown）+ 结果组装。
 *
 * 为什么必须拆出来（AGENTS §1「复杂功能里的无副作用成分必须拆」）：
 *  这一段是「模型给的 URL 与网页给的 HTML 都不可信」的缓冲区 —— URL 归一、不可见块剥离、
 *  正文区域选择、实体解码、截断 —— 全部与网络 I/O 无关，却能单独回归（见 web-fetch.utils.test.ts）。
 *  服务端代理 `/api/ai/fetch` 只负责取字节，取到之后一律调这里的函数。
 *
 * 边界（**刻意不做**的事）：不做完整 HTML 解析（不引入依赖），也不还原复杂排版 ——
 *  表格、嵌套列表缩进、CSS 隐藏元素一律按「尽力而为」处理；markdown 模式只保留标题 / 链接 / 列表 / 行内代码 / 粗斜体 / 代码块。
 */
import type { WebFetchFormat, WebFetchRequest, WebFetchResult } from './web-fetch.types'

/** @desc 正文默认字符上限（模型不指定时用） */
export const DEFAULT_MAX_CHARS = 8000
/** @desc 正文字符硬顶（模型要再多也不会超过它，防一次抓取吃满上下文） */
export const HARD_MAX_CHARS = 40000
/** @desc 单次抓取超时（毫秒） */
export const DEFAULT_TIMEOUT_MS = 15000
/** @desc 响应体字节上限（超限即停止读取并截断，防超大页面打爆内存） */
export const MAX_RESPONSE_BYTES = 2_000_000
/** @desc 支持的正文格式（供工具入参 enum 与归一复用） */
export const WEB_FETCH_FORMATS: WebFetchFormat[] = ['text', 'markdown']

/** @desc 命名实体（只收常用集；数字实体走码点通用处理，不认识的实体原样保留） */
const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    copy: '©',
    reg: '®',
    trade: '™',
    hellip: '…',
    mdash: '—',
    ndash: '–',
    laquo: '«',
    raquo: '»',
    ldquo: '“',
    rdquo: '”',
    lsquo: '‘',
    rsquo: '’',
    middot: '·',
    bull: '•',
    times: '×',
    divide: '÷',
    deg: '°',
    sect: '§',
    para: '¶',
    dagger: '†',
    euro: '€',
    pound: '£',
    yen: '¥',
    rarr: '→',
    larr: '←',
    uarr: '↑',
    darr: '↓'
}

/** @desc 块级标签 → 换行（`<li>` 另有前缀处理） */
const BLOCK_TAG =
    /<\/?(?:p|div|section|article|header|footer|main|aside|nav|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|blockquote|pre|figure|figcaption|form|fieldset|hr|address|dl|dt|dd)\b[^>]*>/gi
/** @desc 整块丢弃的无正文价值内容（注释、脚本、样式、矢量图、内嵌对象、控件） */
const HIDDEN_BLOCK =
    /<(script|style|noscript|template|svg|canvas|iframe|object|embed|video|audio|map|select|textarea|button)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
/** @desc 页面外壳（正文提取时剥离） */
const CHROME_BLOCK = /<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi

/** @desc 折叠空白：统一换行、压缩行内空白、去掉多余空行与首尾空白 */
export const collapseWhitespace = (input: string): string =>
    input
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t\f\v\u00a0]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

/** @desc 解码 HTML 实体（命名 / 十进制 / 十六进制；不认识的整段原样保留，不猜） */
export const decodeEntities = (input: string): string =>
    input.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (raw, body: string) => {
        if (body.startsWith('#')) {
            const isHex = body[1] === 'x' || body[1] === 'X'
            const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10)
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? raw
    })

/** @desc 去掉整块不可见/无正文价值内容（含 HTML 注释） */
export const stripHiddenBlocks = (html: string): string =>
    html.replace(/<!--[\s\S]*?-->/g, ' ').replace(HIDDEN_BLOCK, ' ')

/** @desc 剥离页面外壳（导航 / 页眉 / 页脚 / 侧栏），只用于正文提取路径 */
export const stripChrome = (html: string): string => html.replace(CHROME_BLOCK, ' ')

/** @desc 选出正文区域：`<article>` 优先，其次 `<main>`，再退 `<body>`，都没有就用整篇 */
export const pickMainHtml = (html: string): string => {
    const patterns = [
        /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i,
        /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i,
        /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i
    ]
    for (const pattern of patterns) {
        const hit = pattern.exec(html)
        if (hit?.[1]?.trim()) return hit[1]
    }
    return html
}

/** @desc 取「正文 HTML」：`mainOnly` 时先选正文区域再剥外壳；否则只做不可见块剥离 */
export const extractContentHtml = (html: string, mainOnly: boolean): string =>
    mainOnly ? stripChrome(pickMainHtml(html)) : html

/** @desc 抽页面标题：`<title>` 优先，缺失时回落首个 `<h1>`；都没有则返回空串 */
export const extractTitle = (html: string): string => {
    const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)
    const fromTitle = title ? collapseWhitespace(decodeEntities(title[1].replace(/<[^>]+>/g, ' '))) : ''
    if (fromTitle) return fromTitle
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html)
    return h1 ? collapseWhitespace(decodeEntities(h1[1].replace(/<[^>]+>/g, ' '))) : ''
}

/** @desc 把链接变成对模型有用的绝对地址（相对地址按页面地址解析；锚点/脚本类协议返回空串表示「不保留链接」） */
export const resolveHref = (href: string, baseUrl: string): string => {
    const raw = decodeEntities(href).trim()
    if (!raw || raw.startsWith('#')) return ''
    if (/^(?:javascript|mailto|tel|data|blob):/i.test(raw)) return ''
    try {
        return new URL(raw, baseUrl).href
    } catch {
        return raw
    }
}

/** @desc 内联片段 → 纯文本（去标签 + 解码 + 折叠空白） */
export const inlineText = (html: string): string => collapseWhitespace(decodeEntities(html.replace(/<[^>]+>/g, ' ')))

/**
 * @desc HTML → 纯文本（块级标签转换行、列表项加 `· `、去掉脚本样式等整块）。
 *  列表项的「紧行」处理刻意排在 `collapseWhitespace` **之后**：源码里 `</li>` 与下一个 `<li>` 之间
 *  夹着换行与缩进空白，先折叠成空行、再消掉一个换行，才能得到「连续清单读起来是一块」的观感。
 */
export const htmlToText = (html: string): string => {
    const raw = decodeEntities(
        stripHiddenBlocks(html)
            .replace(/<li\b[^>]*>/gi, '\n· ')
            .replace(/<br\b[^>]*>/gi, '\n')
            .replace(BLOCK_TAG, '\n')
            .replace(/<[^>]+>/g, '')
    )
    return collapseWhitespace(raw).replace(/(?<=\n)\n(?=· )/g, '')
}

/** @desc HTML → 轻量 Markdown（标题 / 链接 / 列表 / 行内代码 / 粗斜体 / 代码块；其余标签只留文字） */
export const htmlToMarkdown = (html: string, baseUrl: string): string => {
    const withoutHidden = stripHiddenBlocks(html)
    // 代码块先抽出来占位，避免块内内容被后续内联规则改写（占位符用不可见标记，最后换回）
    const codeBlocks: string[] = []
    const withPlaceholders = withoutHidden.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_raw, inner: string) => {
        const code = decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/\s+$/, '')
        codeBlocks.push(code)
        return `\n\u0000CODE${codeBlocks.length - 1}\u0000\n`
    })
    const markdown = withPlaceholders
        .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_raw, level: string, inner: string) => {
            const text = inlineText(inner.replace(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi, '$1'))
            return text ? `\n${'#'.repeat(Number(level))} ${text}\n` : '\n'
        })
        .replace(
            /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi,
            (_raw, dq: string, sq: string, bare: string, inner: string) => {
                const text = inlineText(inner) || resolveHref(dq || sq || bare || '', baseUrl)
                const href = resolveHref(dq || sq || bare || '', baseUrl)
                if (!text) return href
                return href ? `[${text}](${href})` : text
            }
        )
        .replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, (_raw, inner: string) => {
            const text = inlineText(inner)
            return text ? `\`${text}\`` : ''
        })
        .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)\s*>/gi, (_raw, inner: string) => {
            const text = inlineText(inner)
            return text ? `**${text}**` : ''
        })
        .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)\s*>/gi, (_raw, inner: string) => {
            const text = inlineText(inner)
            return text ? `*${text}*` : ''
        })
        .replace(/<li\b[^>]*>/gi, '\n- ')
        .replace(/<br\b[^>]*>/gi, '\n')
        .replace(BLOCK_TAG, '\n')
        .replace(/<[^>]+>/g, '')
    const decoded = collapseWhitespace(decodeEntities(markdown))
    // 列表项同样收紧（`\n- ` 前的空行去掉）；此时代码块还是占位符，不会被误伤
    const tightened = decoded.replace(/(?<=\n)\n(?=- )/g, '')
    return tightened.replace(
        /\u0000CODE(\d+)\u0000/g,
        (_raw, index: string) => `\`\`\`\n${codeBlocks[Number(index)] ?? ''}\n\`\`\``
    )
}

/** @desc 按上限截断正文（返回是否真的截断过，供模型判断「后面还有内容」） */
export const truncateContent = (text: string, maxChars: number): { content: string; truncated: boolean } => {
    const cap = clampMaxChars(maxChars)
    return text.length > cap ? { content: text.slice(0, cap), truncated: true } : { content: text, truncated: false }
}

/** @desc 归一 `maxChars`：非法/缺省用默认值，超过硬顶按硬顶（永不返回 0 或负数） */
export const clampMaxChars = (raw: unknown): number => {
    const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_CHARS
    return Math.min(Math.floor(parsed), HARD_MAX_CHARS)
}

/**
 * @desc 归一正文格式（不认识的值回落 `text`，不报错 —— 格式选择不值得让整次抓取失败）。
 *  判定走 `WEB_FETCH_FORMATS`（运行时唯一真源）；`web-fetch.ts` 参数表里的 enum 是它的**展示镜像**
 *  （文档解析器要求内联字面量，两处要同步改）。
 */
export const readFormat = (raw: unknown): WebFetchFormat => WEB_FETCH_FORMATS.find((format) => format === raw) ?? 'text'

/** @desc 归一目标地址：必填、缺协议按 https 补全、只允许 http/https、去掉 fragment */
export const normalizeFetchUrl = (raw: unknown): string => {
    const text = String(raw ?? '').trim()
    if (!text) throw new Error('缺少 url：请给出要抓取的 http/https 链接（本工具只抓已知地址，不做搜索）')
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text) ? text : `https://${text}`
    let parsed: URL
    try {
        parsed = new URL(withScheme)
    } catch {
        throw new Error(`url 不是合法链接：${text}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`只支持 http/https 链接（收到 ${parsed.protocol}）`)
    }
    parsed.hash = ''
    return parsed.href
}

/** @desc 归一工具入参（非法 URL 抛可读错误；其余字段给默认值） */
export const normalizeWebFetchArgs = (args: Record<string, unknown>): Required<WebFetchRequest> => ({
    url: normalizeFetchUrl(args.url),
    format: readFormat(args.format),
    maxChars: clampMaxChars(args.maxChars),
    mainOnly: args.mainOnly !== false
})

/** @desc 响应类型归类：HTML / 纯文本 / JSON / 其它（未声明 Content-Type 时按 HTML 赌一把，网页居多） */
export const contentKindOf = (contentType: string): 'html' | 'text' | 'json' | 'other' => {
    const ct = (contentType || '').toLowerCase()
    if (!ct.trim()) return 'html'
    if (ct.includes('html') || ct.includes('xhtml')) return 'html'
    if (ct.includes('json')) return 'json'
    if (ct.startsWith('text/') || ct.includes('xml') || ct.includes('markdown')) return 'text'
    return 'other'
}

/** @desc 组装抓取结果（纯函数：服务端取到字节后一次成型，宿主与工具都不再加工） */
export const buildFetchResult = (input: {
    url: string
    status: number
    contentType: string
    body: string
    format: WebFetchFormat
    maxChars: number
    mainOnly: boolean
}): WebFetchResult => {
    const contentType = input.contentType || '(未声明)'
    const kind = contentKindOf(input.contentType)
    if (kind === 'other') {
        return {
            url: input.url,
            status: input.status,
            contentType,
            content: '',
            truncated: false,
            note: `Content-Type 为 ${contentType}，不是网页文本（可能是 PDF / 图片 / 二进制），未提取正文`
        }
    }
    const isHtml = kind === 'html'
    const text = isHtml
        ? input.format === 'markdown'
            ? htmlToMarkdown(extractContentHtml(input.body, input.mainOnly), input.url)
            : htmlToText(extractContentHtml(input.body, input.mainOnly))
        : collapseWhitespace(input.body)
    const clipped = truncateContent(text, input.maxChars)
    const title = isHtml ? extractTitle(input.body) : ''
    return {
        url: input.url,
        status: input.status,
        contentType,
        ...(title ? { title } : {}),
        content: clipped.content,
        truncated: clipped.truncated
    }
}
