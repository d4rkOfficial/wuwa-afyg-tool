// AI 流式转发代理：无 CORS 的端点（opencode 等）经此同源转发，Vercel serverless 无 CPU 时长限制
import { json } from '@sveltejs/kit'

// 允许转发的上游（与设置弹窗快捷端点保持一致，可扩展）
const ALLOWED_ORIGINS = ['https://api.deepseek.com', 'https://opencode.ai']

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

    let allowed = false
    try {
        const u = new URL(baseUrl)
        allowed = ALLOWED_ORIGINS.some(
            (o) =>
                u.origin === o ||
                (o === 'https://opencode.ai' && u.hostname === 'opencode.ai' && u.pathname.startsWith('/zen/'))
        )
    } catch {
        /* 非法 URL */
    }
    if (!allowed) return json({ type: 'error', message: '服务地址不在允许列表' }, { status: 400 })

    let upstream: Response
    try {
        upstream = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
        })
    } catch (e) {
        return json(
            { type: 'error', message: `上游请求失败：${e instanceof Error ? e.message : String(e)}` },
            { status: 502 }
        )
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
