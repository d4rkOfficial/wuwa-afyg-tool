export interface ExtractedKeyword {
    id: string | null
    text: string
}

const SIZE_CLASS: Record<string, string> = {
    '40': 'rich-size-xl',
    '10': 'rich-size-xs'
}

/** @desc 需要落一个 `</span>` 的关闭标签名（与下面 `openTagHtml` 一一对应） */
const SPAN_TAGS = new Set(['color', 'size', 'highlight', 'te'])

/**
 * @desc 富文本标签词法：`<` + 可选 `/` + **字母开头**的标签名 + 属性 + `>`，每次调用新建实例
 * （带 `g` 的正则自带 `lastIndex` 状态，共享会互相串味）。
 *
 * 名字必须以字母开头是硬要求：上游会把 `<` 当数学符号写进正文
 * （琳奈「普攻·灵感碰撞」：`当前【流光】<50%`）。若按「`<` 一路吃到下一个 `>`」匹配，
 * `<50%\n普攻·灵感碰撞·2级：50% ≤当前<color=Highlight>` 会被当成一个名为 `50` 的标签整段吃掉，
 * 后面的 `</color>` 随之错位——正文丢一行、高亮串到下一节标题上（见 `rich-text.test.ts`）。
 */
export const richTagRe = (): RegExp => /<(\/?)([a-zA-Z][\w-]*)([^<>]*)>/g

/** @desc 打开标签 → 包裹 span；未知标签返回空串（等于只丢弃标签本身、保留正文） */
const openTagHtml = (name: string, attrs: string): string => {
    if (name === 'te') return `<span class="rich-te" data-id="${escapeHtml(tagAttrValue(attrs) ?? '')}">`
    if (name === 'color') return `<span class="rich-color-${tagAttrValue(attrs)?.toLowerCase() ?? ''}">`
    if (name === 'size') {
        const val = tagAttrValue(attrs)
        return `<span class="${SIZE_CLASS[val ?? ''] ?? `rich-size-${val}`}">`
    }
    return name === 'highlight' ? '<span class="rich-highlight">' : ''
}

export function richTextToHtml(text: string): string {
    const re = richTagRe()
    const parts: string[] = []
    let last = 0
    let match: RegExpExecArray | null

    while ((match = re.exec(text)) !== null) {
        if (match.index > last) {
            parts.push(escapeHtml(text.slice(last, match.index)).replace(/\n/g, '<br/>'))
        }

        const [whole = '', slash = '', name = '', attrs = ''] = match
        if (slash === '/') {
            if (SPAN_TAGS.has(name)) parts.push('</span>')
        } else {
            parts.push(openTagHtml(name, attrs))
        }

        last = match.index + whole.length
    }

    if (last < text.length) {
        parts.push(escapeHtml(text.slice(last)).replace(/\n/g, '<br/>'))
    }

    return parts.join('')
}

/** @desc 有效词条必须含字母/数字：`【<te href=150905>溢彩</te>】` 剥掉 `te` 后只剩 `【】`，是空壳不是词条 */
const isTermText = (text: string): boolean => /[\p{L}\p{N}]/u.test(text)

export function extractKeywords(text: string): ExtractedKeyword[] {
    const result: ExtractedKeyword[] = []
    const seen = new Set<string>()

    const teRe = /<te\s+href=(\d+)>([^<]*)<\/te>/gi
    let m: RegExpExecArray | null
    while ((m = teRe.exec(text)) !== null) {
        const term = m[2].trim()
        if (isTermText(term) && !seen.has(term)) {
            seen.add(term)
            result.push({ id: m[1], text: term })
        }
    }

    const noTe = text.replace(/<te\s+href=\d+>[^<]*<\/te>/gi, '')
    const hlRe = /<color=Highlight>([^<]+)<\/color>/gi
    while ((m = hlRe.exec(noTe)) !== null) {
        const term = m[1].trim()
        if (isTermText(term) && !seen.has(term)) {
            seen.add(term)
            result.push({ id: null, text: term })
        }
    }

    return result
}

function tagAttrValue(attrs: string): string | undefined {
    if (!attrs) return undefined
    const eq = attrs.indexOf('=')
    return eq === -1 ? undefined : attrs.slice(eq + 1)
}

export function colorizeNumbers(html: string): string {
    const result: string[] = []
    let buf = ''
    let depth = 0

    function flush() {
        if (!buf) return
        result.push(
            buf.replace(/(\d+(?:\.\d+)?)(%)?/g, (_, n, pct) =>
                pct ? `<span class="rich-num">${n}%</span>` : `<span class="rich-num">${n}</span>`
            )
        )
        buf = ''
    }

    for (let i = 0; i < html.length; i++) {
        if (html[i] === '<') {
            if (depth === 0) flush()
            const close = html.indexOf('>', i)
            if (close === -1) {
                result.push(html.slice(i + 1))
                break
            }
            const tag = html.slice(i, close + 1)
            result.push(tag)
            if (tag.startsWith('</')) depth--
            else if (!tag.endsWith('/>') && !tag.startsWith('<!--')) depth++
            i = close
        } else if (depth > 0) {
            result.push(html[i])
        } else {
            buf += html[i]
        }
    }
    flush()
    return result.join('')
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}
