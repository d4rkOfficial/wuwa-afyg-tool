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
 * @desc 预渲染落盘时的 content-type。
 *
 * ⚠️ 必须是**不带参数的裸 `text/html`**，否则部署后手机访问 /shell-page 会变成下载文件。
 * SvelteKit 预渲染器判定「这条响应是不是 HTML」用的是**严格相等**
 * （`@sveltejs/kit/src/core/postbuild/prerender.js` 的 `save()`：
 * `const is_html = response_type === REDIRECT || type === 'text/html'`），
 * 而 `is_html` 决定产物文件名（`output_filename()`：`is_html` 为真才补 `.html`）。
 * 写成 `text/html; charset=utf-8` 时 `is_html` 为假，产物落盘为**无扩展名的 `shell-page`**；
 * Vercel 的 `{"handle":"filesystem"}` 只按扩展名推断 MIME，无扩展名 → `application/octet-stream`
 * → 浏览器下载。本地 `dev`/`preview` 由 SvelteKit 自己发响应头，看不出这个差异。
 *
 * 少掉的 `charset` 不影响编码：产物即 `.html`，HTML 文档的编码由文档内的
 * `<meta charset="utf-8">` 决定，静态主机也会对 `.html` 自带 `text/html`。
 */
const CONTENT_TYPE = 'text/html'

/**
 * @desc 壳页路由：返回原生 HTML 文档。
 * @returns 壳页 HTML 响应
 */
export function GET() {
    return new Response(SHELL_HTML, {
        headers: {
            'content-type': CONTENT_TYPE,
            'cache-control': CACHE_CONTROL
        }
    })
}
