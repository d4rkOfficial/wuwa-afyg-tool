/**
 * @desc 库街区 Token 的纯逻辑层：把用户粘贴进来的整段文本归一化成一个 token。
 *  支持的形式：裸 token、"token=xxx" / "token: xxx"、JSON `{"token":"xxx"}`（含被转义的引号）、
 *  "Bearer xxx"、带引号/换行/零宽字符/中文说明的复制片段。
 *  只在服务端路由与测试中使用（不含任何 I/O）。
 */

/** @desc token 合法字符集：库街区 token 为长串字母数字（可能含 . - _ = / +，如 JWT/base64） */
const TOKEN_RUN = /[A-Za-z0-9._~+/=-]+/g
/** @desc 带键名的形式：token" : "xxx" / token=xxx */
const KEYED_TOKEN = /token["'\]\s]*[:=]\s*["']?([^"'\s,}]+)/i
/** @desc 需要静默剔除的不可见字符（复制自网页/聊天时常见） */
const INVISIBLE = /[\u200b-\u200d\ufeff]/g

/**
 * @desc 归一化粘贴文本 → token；无法识别时返回空串（由调用方回「缺少 token」）。
 *  取「最长的一段 token 字符」而不是整段文本，避免把 "token" 这类键名或中文说明当成值。
 */
export const normalizeKuroToken = (raw: string): string => {
    const text = String(raw ?? '')
        .replace(INVISIBLE, '')
        .trim()
    if (!text) return ''
    const candidate = (KEYED_TOKEN.exec(text)?.[1] ?? text).replace(/^bearer\s+/i, '').trim()
    const runs = candidate.match(TOKEN_RUN) ?? []
    if (runs.length === 0) return ''
    return runs.reduce((longest, run) => (run.length > longest.length ? run : longest), '')
}
