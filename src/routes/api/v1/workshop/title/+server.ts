// 工坊站点标题抓取：浏览器直接 fetch 任意工坊会被 CORS 拦住，所以统一走本路由。
// 只取 `<title>`，不把页面内容回传；http 公网地址先升级到 https（工坊站点通常两者都开，
// 而应用部署在 https 上，避免明文混合内容）。
import { createJsonResponse } from '$lib/api/fetch'
import { MAX_REDIRECTS, assertFetchTarget, isLoopbackHost } from '$lib/ai/proxy-guard'
import { extractHtmlTitle, parseTitleTarget } from './workshop-title.utils'

const TIMEOUT_MS = 8_000
const MAX_BYTES = 512 * 1024
const USER_AGENT = 'wuwa-afyg-tool/1.0 (+workshop-title)'
const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

const titleResponse = (title: string, status = 200) =>
    createJsonResponse({ title }, status, { 'Cache-Control': 'no-store' })

/** @desc 有上限地读取响应体：标题在 `<head>` 里，读满上限即停，避免被超大页面拖住 */
const readCapped = async (res: Response): Promise<string> => {
    const reader = res.body?.getReader()
    if (!reader) return ''
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done || !value) break
        chunks.push(value)
        size += value.byteLength
        if (size >= MAX_BYTES) {
            await reader.cancel().catch(() => {})
            break
        }
    }
    const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0))
    let offset = 0
    for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(merged)
}

export const GET = async ({ url }: { url: URL }) => {
    const target = parseTitleTarget(url.searchParams.get('url') ?? '')
    if (!target) return titleResponse('', 400)
    // 明文 http 只允许本机回环；公网站点用 https 取标题
    if (target.protocol === 'http:' && !isLoopbackHost(target.hostname)) target.protocol = 'https:'

    try {
        let current = target
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            const hopBlocked = await assertFetchTarget(current)
            if (hopBlocked) return titleResponse('', 400)
            const res = await fetch(current.href, {
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: ACCEPT,
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
                },
                redirect: 'manual',
                signal: AbortSignal.timeout(TIMEOUT_MS)
            })
            if (res.status >= 300 && res.status < 400) {
                const location = res.headers.get('location')
                if (!location) return titleResponse('')
                current = new URL(location, current)
                if (current.protocol === 'http:' && !isLoopbackHost(current.hostname)) current.protocol = 'https:'
                continue
            }
            if (!res.ok) return titleResponse('')
            return titleResponse(extractHtmlTitle(await readCapped(res)))
        }
        return titleResponse('')
    } catch {
        return titleResponse('')
    }
}
