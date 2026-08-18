// AI 流式转发代理：无 CORS 的端点（火山方舟/Kimi/GLM/MiniMax/任意 OpenAI 兼容服务）经此同源转发。
// 放行策略：开发环境（dev）完全放行；生产环境放行任意 https 公网地址，但拦截内网/回环/保留地址
// （防 SSRF，见 proxy-guard.ts），重定向逐跳复查后继续转发。
import { json } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { assertPublicHttps, MAX_REDIRECTS } from '$lib/ai/proxy-guard'

const BASE_HEADERS = {
    'Content-Type': 'application/json'
}

export async function POST({ request }: { request: Request }) {
    let input: { baseUrl?: string; apiKey?: string; body?: Record<string, unknown> }
    try {
        input = (await request.json()) as typeof input
    } catch {
        return json({ type: 'error', message: '请求体不是合法 JSON' }, { status: 400 })
    }

    const baseUrl = (input.baseUrl ?? '').trim().replace(/\/+$/, '')
    const apiKey = (input.apiKey ?? '').trim()
    const body = input.body

    if (!apiKey) return json({ type: 'error', message: '缺少 API Key' }, { status: 400 })
    if (!body || typeof body !== 'object') return json({ type: 'error', message: '缺少请求体' }, { status: 400 })

    let u: URL
    try {
        u = new URL(baseUrl)
    } catch {
        return json({ type: 'error', message: '服务地址不是合法 URL' }, { status: 400 })
    }

    const headers = { ...BASE_HEADERS, Authorization: `Bearer ${apiKey}` }

    let current = u
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!dev) {
            const err = await assertPublicHttps(current)
            if (err) return json({ type: 'error', message: err }, { status: 400 })
        }

        let upstream: Response
        try {
            // 以目录前缀拼接：baseUrl 末尾有无斜杠皆可（去掉尾斜杠避免 // 双斜杠）
            const target = `${current.href.replace(/\/+$/, '')}/chat/completions`
            upstream = await fetch(target, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                redirect: 'manual'
            })
        } catch (e) {
            // undici 会把 DNS/TLS/连接失败包装成 "fetch failed"，底层原因在 e.cause 上
            const err = e instanceof Error ? e : new Error(String(e))
            const cause = err.cause instanceof Error ? err.cause : null
            const code = cause && 'code' in cause ? ` (${(cause as { code?: unknown }).code ?? ''})` : ''
            return json(
                { type: 'error', message: `上游请求失败：${cause ? cause.message + code : err.message}` },
                { status: 502 }
            )
        }

        // 逐跳复查重定向目标，防止被引到内网
        const location = upstream.headers.get('location')
        if (upstream.status >= 300 && upstream.status < 400 && location) {
            let next: URL
            try {
                next = new URL(location, current.href)
            } catch {
                return json({ type: 'error', message: '上游返回了非法重定向地址' }, { status: 502 })
            }
            current = next
            continue
        }

        if (!upstream.ok) {
            const text = await upstream.text()
            return new Response(text, {
                status: upstream.status,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        return new Response(upstream.body, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-store'
            }
        })
    }

    return json({ type: 'error', message: '转发重定向次数过多' }, { status: 502 })
}
