import type { Handle } from '@sveltejs/kit'

const ALLOWED_ORIGINS: Array<string | RegExp> = [
    'https://wuwa-afyg-share.200503.xyz',
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/
]

export const handle: Handle = async ({ event, resolve }) => {
    const path = event.url.pathname
    if (!path.startsWith('/api/')) return resolve(event)

    const origin = event.request.headers.get('origin') ?? ''
    /**
     * @desc 公开只读的游戏数据接口对任意来源开放：fast-calc 会被浏览器 / 静态页 / 跨域 iframe
     *  直接打开，此时它不在工具箱同源下，仍需要能读到角色/武器/声骸基础数据。
     *  这些接口不含凭据，且本来就是公开数据；其余 /api/* 仍只允许白名单来源。
     */
    const publicData = /^\/api\/v[13]\/(info|list)\//.test(path) || path === '/api/v1/version/latest'
    const allowed = publicData || ALLOWED_ORIGINS.some((o) => (typeof o === 'string' ? o === origin : o.test(origin)))

    // 仅对 API 路由开放 CORS（允许椰果工坊站点、本地开发与 fast-calc 静态页直连）
    if (!allowed) return resolve(event)

    const headers = {
        'Access-Control-Allow-Origin': publicData ? '*' : origin,
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
