// ── 壳页 content-type 契约单测（node:test） ───────────────────────────────
// 这条断言守的是一个**只在部署后才暴露**的坑：content-type 里多写一个
// `; charset=utf-8` 会让手机访问 /shell-page 变成下载文件。
//
// 机制（SvelteKit 2.69.2，`src/core/postbuild/prerender.js`）：
//   - `save()` 用**严格相等**判定响应是不是 HTML：
//       `const is_html = response_type === REDIRECT || type === 'text/html'`
//     带参数的 `text/html; charset=utf-8` ≠ `'text/html'` ⇒ `is_html = false`；
//   - `output_filename(path, is_html)` 只在 `is_html` 为真时才补 `.html`；
//   - 于是产物落盘成**无扩展名的 `shell-page`**，被 adapter 原样搬进
//     `.vercel/output/static/`（adapter-vercel 只做 `writePrerendered(dirs.static)`，
//     不补扩展名）；
//   - 静态主机的 `{"handle":"filesystem"}` 只按扩展名推断 MIME，无扩展名 ⇒
//     `application/octet-stream` ⇒ 浏览器不渲染、直接下载。
//
// 本地 `dev` / `preview` 看不出这个差异（由 SvelteKit 自己发响应头），
// 所以必须靠这条契约把端点里的字面量钉住。编码不受影响：产物是 `.html`，
// 编码由文档内的 `<meta charset="utf-8">` 决定（见下第二个用例）。
//
// 通过 test/preload.mjs 解析 TS 与相对导入。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { GET } from '$src/routes/shell-page/+server'
import { SHELL_HTML } from '$src/routes/shell-page/page-html'

describe('壳页 content-type 契约（防部署后退化成下载）', () => {
    it('GET 的 content-type 必须是无参数 text/html（严格等于）', () => {
        const contentType = GET().headers.get('content-type')
        assert.equal(
            contentType,
            'text/html',
            `content-type 必须严格等于 'text/html'：SvelteKit 预渲染器用严格相等判定 is_html，` +
                `带参数的 'text/html; charset=utf-8' 会让产物落盘成无扩展名的 shell-page，` +
                `部署后浏览器会下载而不是渲染。实际值：${JSON.stringify(contentType)}`
        )
        // 反向锁死：任何 `;` 参数（charset / boundary / …）都会踩同一个坑
        assert.ok(!(contentType ?? '').includes(';'), `content-type 不允许携带任何参数：${JSON.stringify(contentType)}`)
    })

    it('charset 由文档内的 meta 声明（不靠响应头）', () => {
        assert.ok(
            /<meta charset=["']?utf-8["']?/i.test(SHELL_HTML),
            '壳页 HTML 必须自带 <meta charset="utf-8">，因为响应头已不带 charset 参数'
        )
    })

    it('响应体就是 SHELL_HTML（预渲染落盘内容与运行时一致）', async () => {
        assert.equal(await GET().text(), SHELL_HTML)
    })
})
