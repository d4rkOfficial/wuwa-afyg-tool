// 椰果工具箱 · 静态版零依赖本地预览服务器（只发文件，不提供任何 /api）
//
// 用法：
//   node serve.mjs            # 默认 http://localhost:8080
//   node serve.mjs 5173       # 指定端口
//   （Windows 也可以直接双击同目录的「启动本地预览.cmd」）
//
// 为什么需要有它：静态版必须由 **HTTP 服务器**托管，不能用 file:// 直接双击 index.html ——
// 浏览器对 file:// 页面禁止加载 ES module 脚本，直接双击只会白屏。
// 你要放到 nginx / Apache / 对象存储 / Cloudflare Pages 上时不需要这个文件。
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)))
const PORT = Number(process.argv[2] || process.env.PORT || 8080)

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm'
}

const isFile = (path) => {
    try {
        return statSync(path).isFile()
    } catch {
        return false
    }
}

const isDirectory = (path) => {
    try {
        return statSync(path).isDirectory()
    } catch {
        return false
    }
}

/** @desc 站点根内的绝对文件路径（越界返回 null，防目录穿越） */
const resolveInside = (urlPath) => {
    const abs = resolve(ROOT, `.${urlPath}`)
    return abs === ROOT || abs.startsWith(ROOT + sep) ? abs : null
}

const sendFile = (req, res, abs, status = 200) => {
    const type = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
    res.writeHead(status, {
        'Content-Type': type,
        // 预览用：HTML 不缓存，其它按普通静态资源处理（hash 文件名天然可长缓存）
        'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600'
    })
    if (req.method === 'HEAD') {
        res.end()
        return
    }
    createReadStream(abs)
        .on('error', () => {
            res.destroy()
        })
        .pipe(res)
}

const server = createServer((req, res) => {
    let urlPath
    try {
        urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
        res.writeHead(400).end('400 Bad Request')
        return
    }
    const abs = resolveInside(urlPath)
    if (!abs) {
        res.writeHead(403).end('403 Forbidden')
        return
    }

    // 1) 目录式 URL：/、/fast-calc/、/shell-page/ → 该目录下的 index.html
    if (urlPath.endsWith('/')) {
        const index = resolve(abs, 'index.html')
        if (isFile(index)) return sendFile(req, res, index)
    } else if (isDirectory(abs)) {
        // 2) 少了尾斜杠的目录 URL：像 nginx / python -m http.server 一样 301 补上（保留查询串）
        const search = (req.url ?? '').includes('?') ? `?${(req.url ?? '').split('?')[1]}` : ''
        res.writeHead(301, { Location: `${urlPath}/${search}` }).end()
        return
    } else if (isFile(abs)) {
        // 3) 具体文件：/_app/**、/icons/**、/shell-page.html …
        return sendFile(req, res, abs)
    }

    // 4) 兜底：无扩展名的未知路径交给 SPA 外壳（200.html），其余 404
    if (!extname(urlPath)) {
        const fallback = resolve(ROOT, '200.html')
        if (isFile(fallback)) return sendFile(req, res, fallback)
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found')
})

server.listen(PORT, () => {
    console.log(`椰果工具箱（静态版）已启动： http://localhost:${PORT}/`)
    console.log('按 Ctrl+C 停止。关闭这个窗口后网页就打不开了。')
})
