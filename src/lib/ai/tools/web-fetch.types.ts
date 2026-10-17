/**
 * @desc 「抓取网页」工具（`web_fetch`）的**契约类型**：AI 侧抓取请求 + 宿主侧抓取结果。
 *
 * 为什么单独成文件：`registry.ts` 需要 `WebFetchFn` 来声明 `ToolContext.webFetch`，
 *  而请求/结果结构又被工具实现、服务端代理与宿主（内置 AI 助手）三处引用。放这里可避免
 *  registry ↔ 工具 ↔ 宿主之间的循环 import（本文件**只有类型**，无运行时依赖）。
 *
 * 能力归属（**关键**）：`webFetch` 是**宿主提供的能力**，只有内置 AI 助手会注入它。
 *  WS 远程接管（`$lib/ws-remote`）刻意不注入 —— 于是 `web_fetch` 在 WS 上下文里
 *  ① 不出现在 hello 的工具清单里、② 即便被直接 exec 也会返回明确错误。见 `registry.availableTools`。
 *  为什么远程接管要禁：抓取是**由服务端代替模型发起出网请求**，远程通道不该借宿主的网络位置去探测/取回任意地址。
 */

/**
 * @desc 正文返回格式：
 * - `text` 去标签纯文本（默认，省 token）
 * - `markdown` 保留标题/链接/列表/代码的轻量 Markdown
 * - `raw` 原样返回响应体（调 API / 看 JSON / 对比原文时用，不做提取）
 */
export type WebFetchFormat = 'text' | 'markdown' | 'raw'

/** @desc 支持的 HTTP 方法（完整的 fetch 能力，不只 GET） */
export type WebFetchMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

/** @desc 一次抓取请求（工具层校验归一后交给宿主） */
export interface WebFetchRequest {
    /** 目标链接（http/https；缺协议时按 https 补全，已去掉 fragment） */
    url: string
    /** 正文格式（默认 `text`） */
    format?: WebFetchFormat
    /** 正文最大字符数（默认 8000，硬顶 40000） */
    maxChars?: number
    /** 只取正文区域（`<article>`/`<main>` 并去掉 nav/header/footer/aside；默认 true） */
    mainOnly?: boolean
    /** HTTP 方法（默认 GET） */
    method?: WebFetchMethod
    /** 自定义请求头（与宿主默认头合并，同名字段以这里为准；禁止改 Host / Content-Length） */
    headers?: Record<string, string>
    /** 请求体（POST/PUT/PATCH 等；GET/HEAD 会忽略） */
    body?: string
    /** 单次抓取超时（毫秒，默认 15000，钳制在 1000-60000） */
    timeoutMs?: number
}

/** @desc 抓取结果（宿主回传，工具原样交给模型） */
export interface WebFetchResult {
    /** 最终地址（跟随重定向后） */
    url: string
    /** 目标返回的 HTTP 状态码 */
    status: number
    /** 响应 Content-Type（未声明时为 `(未声明)`） */
    contentType: string
    /** 页面标题（`<title>`，缺失时回落首个 `<h1>`；非 HTML 时无此字段） */
    title?: string
    /** 提取后的正文（可能被 `maxChars` 截断；非文本类型时为空串） */
    content: string
    /** `content` 是否被截断（true = 只给到 maxChars 处，后续内容**没有**抓取） */
    truncated: boolean
    /** 非 HTML/文本内容（PDF / 图片 / 二进制）时的说明；此时 `content` 为空串 */
    note?: string
    /** 最终使用的 HTTP 方法（跟随 303 等重定向后可能由 POST 变成 GET） */
    method?: string
    /** 响应头（只保留常见的可读字段，避免把整份头塞进上下文） */
    headers?: Record<string, string>
}

/** @desc 宿主的抓取实现（内置 AI 助手：经同源代理 `/api/ai/fetch` 走服务端，带 SSRF 校验） */
export type WebFetchFn = (request: WebFetchRequest) => Promise<WebFetchResult>
