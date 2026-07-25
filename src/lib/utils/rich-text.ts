export interface ExtractedKeyword {
    id: string | null
    text: string
}

const SIZE_CLASS: Record<string, string> = {
    '40': 'rich-size-xl',
    '10': 'rich-size-xs'
}

export function richTextToHtml(text: string): string {
    const re = /<(\/?)(\w+)([^>]*)>/g
    const parts: string[] = []
    let last = 0
    let match: RegExpExecArray | null

    while ((match = re.exec(text)) !== null) {
        if (match.index > last) {
            parts.push(escapeHtml(text.slice(last, match.index)).replace(/\n/g, '<br/>'))
        }

        const [, slash, name, attrs] = match
        const isClose = slash === '/'

        if (isClose) {
            if (name === 'color' || name === 'size' || name === 'highlight' || name === 'te') {
                parts.push('</span>')
            }
        } else {
            const val = tagAttrValue(attrs)
            let cls = ''
            switch (name) {
                case 'color':
                    cls = `rich-color-${val?.toLowerCase() ?? ''}`
                    break
                case 'size':
                    cls = SIZE_CLASS[val ?? ''] ?? `rich-size-${val}`
                    break
                case 'highlight':
                    cls = 'rich-highlight'
                    break
                case 'te':
                    parts.push(`<span class="rich-te" data-id="${escapeHtml(val ?? '')}">`)
                    break
            }
            if (cls) parts.push(`<span class="${cls}">`)
        }

        last = match.index + match[0].length
    }

    if (last < text.length) {
        parts.push(escapeHtml(text.slice(last)).replace(/\n/g, '<br/>'))
    }

    return parts.join('')
}

export function extractKeywords(text: string): ExtractedKeyword[] {
    const result: ExtractedKeyword[] = []
    const seen = new Set<string>()

    const teRe = /<te\s+href=(\d+)>([^<]*)<\/te>/gi
    let m: RegExpExecArray | null
    while ((m = teRe.exec(text)) !== null) {
        const term = m[2].trim()
        if (term && !seen.has(term)) {
            seen.add(term)
            result.push({ id: m[1], text: term })
        }
    }

    const noTe = text.replace(/<te\s+href=\d+>[^<]*<\/te>/gi, '')
    const hlRe = /<color=Highlight>([^<]+)<\/color>/gi
    while ((m = hlRe.exec(noTe)) !== null) {
        const term = m[1].trim()
        if (term && !seen.has(term)) {
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
