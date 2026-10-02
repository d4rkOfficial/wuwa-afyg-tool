/**
 * @desc /shell-page 壳页路由：直接返回原生 HTML 文档（不走 SvelteKit 布局与渲染管线）。
 *
 * 壳内只有一个指向主路由 `/` 的同源 iframe，配一层桌面视口适配（1280px 渲染 + 等比缩放）；
 * HTML 产物构造见 ./page-html.ts。
 *
 * ⚠️ SvelteKit 对 +server.ts 的导出有白名单（GET/POST/PATCH/PUT/DELETE/OPTIONS/HEAD/
 * fallback/prerender/trailingSlash/config/entries 或 `_` 前缀），多导出任何一个都会 500。
 * 因此这里只保留 GET 与 prerender，构造器放在 ./page-html.ts。
 */
import { SHELL_HTML } from './page-html'

/** @desc 壳页为纯静态文档，构建期预渲染为 HTML，不占用服务端运行时 */
export const prerender = true

/** @desc 响应体缓存策略：交给 CDN 短缓存 + 回源校验（内容随构建产物变化） */
const CACHE_CONTROL = 'public, max-age=0, must-revalidate'

/**
 * @desc 壳页路由：返回原生 HTML 文档。
 * @returns 壳页 HTML 响应
 */
export function GET() {
    return new Response(SHELL_HTML, {
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': CACHE_CONTROL
        }
    })
}
