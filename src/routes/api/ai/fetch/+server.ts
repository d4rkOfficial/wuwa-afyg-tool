// 网页抓取代理：`web_fetch` 工具（AI 独享）的出网入口。
//
// 为什么走服务端而不是浏览器直连：任意站点的 CORS 策略不可控，浏览器侧抓取对绝大多数站点会直接失败；
//  服务端取字节没有 CORS 限制，且能统一做 SSRF 校验。放行策略与 `/api/ai/stream` 完全一致：
//  开发环境（dev）放行任意 http/https（含本机，便于本地调试）；生产环境只放行 https 公网地址，
//  拦截内网/回环/保留地址与云元数据地址（`$lib/ai/proxy-guard`），重定向逐跳复查。
//
// 只取字节与元信息，正文提取一律走 `$lib/ai/tools/web-fetch.utils` 的纯函数（本文件不做解析）。
import { json } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { MAX_REDIRECTS, assertPublicHttps } from '$lib/ai/proxy-guard'
import type { WebFetchRequest } from '$lib/ai/tools/web-fetch.types'
import {
    DEFAULT_TIMEOUT_MS,
    MAX_RESPONSE_BYTES,
    buildFetchResult,
    normalizeWebFetchArgs
} from '$lib/ai/tools/web-fetch.utils'

/** @desc 一部分站点对无 UA 的请求直接 403；给一个诚实的工具标识，不伪装浏览器 */
const USER_AGENT = 'wuwa-afyg-tool/1.0 (+ai-assistant web_fetch)'
const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5'

/** @desc 从 Content-Type 里取字符集（缺省 utf-8；gbk/gb18030 这类老站点要靠它才不乱码） */
const charsetOf = (contentType: string): string => /charset=\s*"?([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8'

/** @desc 按字符集解码已读字节（字符集不被支持时回落 utf-8，不让整次抓取失败） */
const decodeBytes = (chunks: Uint8Array[], charset: string): string => {
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
    }
    try {
        return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(merged)
    } catch {
        return new TextDecoder('utf-8').decode(merged)
    }
}

/** @desc 带上限地读取响应体：超过 cap 字节立即停止并截断（不让超大页面吃满内存） */
const readCapped = async (
    res: Response,
    cap: number,
    charset: string
): Promise<{ text: string; overBytes: boolean }> => {
    const reader = res.body?.getReader()
    if (!reader) return { text: '', overBytes: false }
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        size += value.byteLength
        chunks.push(value)
        if (size >= cap) {
            await reader.cancel().catch(() => {})
            return { text: decodeBytes(chunks, charset), overBytes: true }
        }
    }
    return { text: decodeBytes(chunks, charset), overBytes: false }
}

export async function POST({ request }: { request: Request }) {
    let input: Record<string, unknown>
    try {
        input = (await request.json()) as Record<string, unknown>
    } catch {
        return json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 })
    }

    let params: Required<WebFetchRequest>
    try {
        params = normalizeWebFetchArgs(input)
    } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : '入参不合法' }, { status: 400 })
    }

    let current: URL
    try {
        current = new URL(params.url)
    } catch {
        return json({ ok: false, error: `url 不是合法链接：${params.url}` }, { status: 400 })
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!dev) {
            // 先自己给一句「面向抓取」的提示：proxy-guard 的文案是为 AI 端点写的（会提「服务地址」与 localhost 直连），
            // 直接透传给模型不好读。明文 http 一律不代理（与 /api/ai/stream 的 https-only 策略一致）。
            if (current.protocol !== 'https:') {
                return json(
                    { ok: false, error: '目标地址不可抓取：只支持 https 链接（明文 http 地址不由服务端代理）' },
                    { status: 400 }
                )
            }
            const blocked = await assertPublicHttps(current)
            if (blocked) return json({ ok: false, error: `目标地址不可抓取：${blocked}` }, { status: 400 })
        }

        let upstream: Response
        try {
            upstream = await fetch(current.href, {
                method: 'GET',
                headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
                redirect: 'manual',
                signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
            })
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e))
            const cause = err.cause instanceof Error ? err.cause : null
            const code = cause && 'code' in cause ? String((cause as { code?: unknown }).code ?? '') : ''
            // 错误文案要**短且可行动**：TLS/DNS 这类底层原因带一长串 boringSSL 描述，只留错误码
            const reason =
                err.name === 'TimeoutError'
                    ? `抓取超时（超过 ${DEFAULT_TIMEOUT_MS / 1000} 秒）`
                    : code
                      ? `抓取失败（${code}）`
                      : `抓取失败：${cause ? cause.message : err.message}`
            return json({ ok: false, error: reason, url: current.href }, { status: 502 })
        }

        // 逐跳复查重定向目标，防止被引到内网
        const location = upstream.headers.get('location')
        if (upstream.status >= 300 && upstream.status < 400 && location) {
            try {
                current = new URL(location, current.href)
            } catch {
                return json({ ok: false, error: '目标返回了非法重定向地址', url: current.href }, { status: 502 })
            }
            continue
        }

        if (!upstream.ok) {
            return json(
                {
                    ok: false,
                    error: `目标返回 HTTP ${upstream.status}${upstream.statusText ? ` ${upstream.statusText}` : ''}`,
                    url: current.href,
                    status: upstream.status
                },
                { status: 502 }
            )
        }

        const contentType = upstream.headers.get('content-type') ?? ''
        const declared = Number.parseInt(upstream.headers.get('content-length') ?? '', 10)
        if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
            return json(
                {
                    ok: false,
                    error: `目标页面过大（声明 ${declared} 字节，上限 ${MAX_RESPONSE_BYTES} 字节）`,
                    url: current.href
                },
                { status: 502 }
            )
        }

        const { text, overBytes } = await readCapped(upstream, MAX_RESPONSE_BYTES, charsetOf(contentType))
        const result = buildFetchResult({
            url: current.href,
            status: upstream.status,
            contentType,
            body: text,
            format: params.format,
            maxChars: params.maxChars,
            mainOnly: params.mainOnly
        })
        if (overBytes && !result.note) {
            result.note = `响应体超过 ${MAX_RESPONSE_BYTES} 字节，已截断读取（正文可能不完整）`
        }
        return json({ ok: true, result })
    }

    return json({ ok: false, error: '重定向次数过多（超过上限）', url: current.href }, { status: 502 })
}
