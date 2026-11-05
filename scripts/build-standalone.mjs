/**
 * @desc 打「椰果工具箱 · 无服务端静态版」zip（`pnpm run package:standalone`）。
 *
 * 产物 = `build/` 的全部静态文件（index.html 在 zip 根）+ 一份使用说明 + 零依赖本地预览服务器。
 *
 * 做三件事（不改变常规构建）：
 *   1. 以 `STANDALONE=1` 跑 `vite build`：走 adapter-static、`trailingSlash: 'always'`，
 *      并把 `/api/**` 切成浏览器内就地解析（见 `src/lib/api/local-api.ts`）；
 *   2. 产物整形：
 *      - `shell-page.html` → `shell-page/index.html`。壳页是 `+server.ts` 返回的原生 HTML 文档，
 *        SvelteKit 的尾斜杠选项管不到端点，只会输出 `shell-page.html`；而 `app.html` 的手机重定向
 *        跳的是 `/shell-page`，于是补一份目录式副本，任何静态服务器都能进（/shell-page 会 301 到目录）；
 *   3. 放进 `使用说明.txt`、`本地预览.cmd`、`serve.mjs`，然后压成 `dist/椰果工具箱.zip`。
 *
 * 为什么必须先构建再打包、而不是把源码丢给用户：这是纯前端产物，用户拿到就能托管，
 * 不需要 Node / pnpm，也不需要任何 /api 后端。
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { zipDirectory } from './zip-dir.mjs'

const root = process.cwd()
const buildDir = resolve(root, 'build')
const assetsDir = resolve(root, 'scripts', 'standalone-assets')
const outDir = resolve(root, 'dist')
const zipPath = resolve(outDir, '椰果工具箱.zip')

const log = (msg) => console.log(`[standalone] ${msg}`)

// ── 1. 构建 ────────────────────────────────────────────────────────────────
log('build: STANDALONE=1 vite build')
rmSync(buildDir, { recursive: true, force: true })
execFileSync(process.execPath, [resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, STANDALONE: '1' }
})

for (const required of ['index.html', '_app', '200.html']) {
    if (!existsSync(resolve(buildDir, required))) throw new Error(`构建产物缺少 ${required}（build/ 不完整）`)
}

// ── 2. 产物整形 ────────────────────────────────────────────────────────────
const shellHtml = resolve(buildDir, 'shell-page.html')
if (existsSync(shellHtml)) {
    const shellDir = resolve(buildDir, 'shell-page')
    mkdirSync(shellDir, { recursive: true })
    copyFileSync(shellHtml, resolve(shellDir, 'index.html'))
    log('shell-page.html → shell-page/index.html（手机壳页在无重写能力的静态服务器上也能进）')
}

// 零依赖本地预览（可选：用户自己用 nginx / 对象存储托管时不需要）
mkdirSync(buildDir, { recursive: true })
copyFileSync(resolve(assetsDir, 'serve.mjs'), resolve(buildDir, 'serve.mjs'))
copyFileSync(resolve(assetsDir, 'start.cmd'), resolve(buildDir, '本地预览.cmd'))

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const readme = `椰果工具箱 · 静态版（无服务端）
================================

版本：${pkg.version}
构建时间：${new Date().toISOString()}

这是一个**纯前端**产物：没有后端、没有 /api 服务，游戏数据（角色 / 武器 / 声骸 / 套装 / 图标）
由浏览器直接向上游 static.nanoka.cc 读取（该站已开放跨域），工程、计算、排轴、分享等
全部功能都在本地完成。

【怎么跑起来】
  必须用 HTTP 服务器打开，双击 index.html 会白屏（浏览器禁止 file:// 页面加载 ES module）。
  任选一种：
    1. Windows：双击「本地预览.cmd」（需要先装 Node.js），会自动打开 http://localhost:8080/
    2. 有 Node.js：在本目录执行  node serve.mjs [端口]
    3. 任意静态网站服务器：把本目录里的文件放到网站根目录即可
       （nginx / Apache / Caddy / 对象存储 / Cloudflare Pages / Vercel 静态托管都行）
       站点根目录必须是本目录，即访问 <你的域名>/ 打开 index.html。

  注意：所有资源都用站点根绝对路径（/_app/...、/icons/...），
  所以**不能**把本目录塞进某个子路径（如 https://example.com/toolbox/）后直接访问。

【静态版能做 / 不能做】
  能做：数据查询、队伍与配置、计算、排轴、结果分析、工程保存与导入导出、
        工坊（分享 / 下载 / 同步）、快捷查表、fast-calc、手机横屏壳页、PWA 离线缓存。
  需要服务端、静态版不可用（会有明确提示，不会静默出错）：
    - 库街区（实验性）同步：token 必须留在服务端 httpOnly cookie 里，且上游不开放跨域；
    - AI 助手的「网页抓取」工具：需要服务端代理出网；
    - 工坊站点的标题抓取：跨域限制，工坊名称会显示为地址。
  AI 对话本身可用，但只能连**自身支持浏览器跨域**的 OpenAI 兼容端点
  （本地 Ollama / LM Studio 这类默认就允许；不支持跨域的服务商会提示连接失败）。

【想用完整版（含上面那些需要服务端的功能）】
  直接用在线站点，或自己部署仓库源码（见仓库 docs/deployment.md）。
`
writeFileSync(resolve(buildDir, '使用说明.txt'), readme, 'utf8')

// ── 3. 压缩 ────────────────────────────────────────────────────────────────
// 注意不要「先删 dist 再重建同路径」：本机（Windows + 文件沙箱/ACL）上删掉目录后重建同一路径
// 会被直接 EPERM 拒绝。同名 zip 直接覆盖即可（zipDirectory 会自己建缺失的父目录）。
mkdirSync(outDir, { recursive: true })
const result = zipDirectory(zipPath, buildDir)
log(
    `zip: ${zipPath}\n` +
        `      ${result.files} 个文件，原始 ${(result.rawBytes / 1024 / 1024).toFixed(1)} MB → ` +
        `${(result.zipBytes / 1024 / 1024).toFixed(1)} MB（${(statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB 落盘）`
)
