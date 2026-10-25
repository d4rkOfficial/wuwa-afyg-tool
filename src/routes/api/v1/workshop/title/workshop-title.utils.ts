// ── 工坊站点标题解析 ─────────────────────────────────────────────────────
// 标题抓取由服务端路由完成（任意站点没有 CORS），这里只保留与网络无关的纯函数：
// URL 归一 + `<title>` 提取 + HTML 实体解码，方便单测且不把解析逻辑散进路由。

const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title>/i
const TAG_RE = /<[^>]+>/g
const MAX_TITLE_LENGTH = 80

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
}

const decodeEntities = (text: string): string =>
    text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
        if (body.startsWith('#x') || body.startsWith('#X')) {
            const code = Number.parseInt(body.slice(2), 16)
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole
        }
        if (body.startsWith('#')) {
            const code = Number.parseInt(body.slice(1), 10)
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? whole
    })

/** @desc 标题文本归一：去标签/实体、压缩空白、截断到 80 字（防止异常站点塞超长标题） */
export const normalizeSiteTitle = (raw: string): string =>
    decodeEntities(String(raw ?? '').replace(TAG_RE, ''))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TITLE_LENGTH)

/** @desc 从 HTML 里取 `<title>`；没有标题或标题为空时返回空串 */
export const extractHtmlTitle = (html: string): string => {
    const match = TITLE_RE.exec(String(html ?? ''))
    return match ? normalizeSiteTitle(match[1] ?? '') : ''
}

/** @desc 把用户填写的地址归一成可请求的 URL；缺协议按 https 补，非法地址返回 null */
export const parseTitleTarget = (input: string): URL | null => {
    const raw = String(input ?? '').trim()
    if (!raw) return null
    try {
        const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`
        const url = new URL(withScheme)
        return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
    } catch {
        return null
    }
}
