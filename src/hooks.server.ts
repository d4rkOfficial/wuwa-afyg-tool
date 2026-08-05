import type { Handle } from '@sveltejs/kit'

const ALLOWED_ORIGINS: Array<string | RegExp> = [
    'https://wuwa-afyg-share.200503.xyz',
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/
]

export const handle: Handle = async ({ event, resolve }) => {
    const origin = event.request.headers.get('origin') ?? ''
    const allowed = ALLOWED_ORIGINS.some((o) => (typeof o === 'string' ? o === origin : o.test(origin)))

    // 仅对 API 路由开放 CORS（允许椰果工坊站点与本地开发直连）
    if (!allowed || !event.url.pathname.startsWith('/api/')) return resolve(event)

    const headers = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
        Vary: 'Origin'
    }

    if (event.request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers })
    }

    const response = await resolve(event)
    const merged = new Headers(response.headers)
    for (const [key, value] of Object.entries(headers)) merged.set(key, value)
    return new Response(response.body, { status: response.status, headers: merged })
}
