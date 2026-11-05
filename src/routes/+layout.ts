/**
 * @desc 路由尾斜杠策略（全站继承）。
 *
 * `STANDALONE=1` 的「无服务端独立静态包」必须用 `always`：产物里 `/shell-page/`、`/fast-calc/`
 * 会落成「目录 + index.html」，nginx / `python -m http.server` / 对象存储这类**不认无扩展名路径**
 * 的静态服务器也能直接进子页（`/shell-page` 会先 301 到 `/shell-page/`）。
 *
 * 有服务端的部署（Vercel / Cloudflare Pages）保持 `never`（SvelteKit 默认），行为与之前一致。
 * 注：SvelteKit 2 已把尾斜杠从 `kit.trailingSlash` 挪到页面/布局选项，只能在这里声明。
 */
export const trailingSlash = __OFFLINE_BUILD__ ? 'always' : 'never'
