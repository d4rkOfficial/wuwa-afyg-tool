// AI 流式客户端（浏览器直连 DeepSeek；无 CORS 的端点自动走站点 /api/ai/stream 转发代理）

const DEEPSEEK_BASE = 'https://api.deepseek.com'
const MODEL = 'deepseek-v4-flash'
const TIMEOUT_MS = 240000
const MAX_TOKENS = 65536
// 支持浏览器直连（已配置 CORS）的 host；其余走站点代理
const DIRECT_BASE_HOSTS = ['api.deepseek.com']

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string
    name?: string
    tool_call_id?: string
    tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
    }>
    // Responses API 模式：本轮的服务端 web_search 调用（下轮原样回传）
    webSearchCalls?: Array<{ id: string }>
}

export interface ChatDelta {
    content?: string
    reasoning?: string
}

export interface ChatToolCall {
    id: string
    name: string
    arguments: string
}

export interface ChatResult {
    content: string
    reasoning: string
    usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
        [k: string]: unknown
    }
    finishReason?: string
    toolCalls?: ChatToolCall[]
}

interface StreamChunk {
    choices?: Array<{
        delta?: {
            content?: string | null
            reasoning_content?: string | null
            tool_calls?: Array<{
                index?: number
                id?: string
                type?: string
                function?: { name?: string | null; arguments?: string | null }
            }>
        }
        finish_reason?: string | null
    }>
    usage?: ChatResult['usage']
    error?: { message?: string }
}

export class DeepSeekError extends Error {
    debug: string

    constructor(message: string, debug: string) {
        super(message)
        this.name = 'DeepSeekError'
        this.debug = debug
    }
}

export interface StreamOptions {
    onDelta?: (delta: ChatDelta) => void
    maxTokens?: number
    tools?: unknown[]
    reasoningEffort?: 'low' | 'medium' | 'high'
    baseUrl?: string
    model?: string
    signal?: AbortSignal
}

function needsProxy(base: string): boolean {
    try {
        return !DIRECT_BASE_HOSTS.includes(new URL(base).host)
    } catch {
        return true
    }
}

export async function chatCompletionStream(
    apiKey: string,
    messages: ChatMessage[],
    options: StreamOptions = {}
): Promise<ChatResult> {
    if (!apiKey.trim()) throw new Error('未配置 AI API Key')

    const maxTokens = options.maxTokens ?? MAX_TOKENS
    const body: Record<string, unknown> = {
        model: options.model?.trim() || MODEL,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.3,
        max_tokens: maxTokens
    }
    if (options.reasoningEffort) {
        body.reasoning_effort = options.reasoningEffort
    }
    if (options.tools && options.tools.length > 0) {
        body.tools = options.tools
        body.tool_choice = 'auto'
    }

    const base = (options.baseUrl ?? DEEPSEEK_BASE).trim().replace(/\/+$/, '')
    const signal = options.signal
        ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), options.signal])
        : AbortSignal.timeout(TIMEOUT_MS)

    let res: Response
    try {
        if (needsProxy(base)) {
            // 无 CORS 的端点：经站点 /api/ai/stream 转发（同源，绕过浏览器预检）
            res = await fetch('/api/ai/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ baseUrl: base, apiKey, body }),
                signal
            })
        } else {
            res = await fetch(`${base}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`
                },
                body: JSON.stringify(body),
                signal
            })
        }
    } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        if (err.includes('AbortError') || err.includes('TimeoutError')) {
            if (options.signal?.aborted) {
                throw new DeepSeekError('已停止生成', 'aborted')
            }
            throw new DeepSeekError('AI 请求超时', '请求超时，请重试或换模型')
        }
        throw new DeepSeekError(`无法连接 AI 服务（${base}）：${err}`, err)
    }

    if (!res.ok) {
        let detail = ''
        try {
            const payload = (await res.json()) as { error?: { message?: string }; message?: string }
            detail = payload?.error?.message ?? payload?.message ?? ''
        } catch {
            /* ignore */
        }
        throw new DeepSeekError(`AI 接口错误（HTTP ${res.status}）：${detail || res.statusText}`, `HTTP ${res.status}`)
    }

    if (!res.body) throw new DeepSeekError('AI 响应无 body', '响应无 body')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let reasoning = ''
    let finishReason = ''
    let usage: ChatResult['usage'] | undefined
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()

    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed.startsWith('data:')) continue
                const payload = trimmed.slice(5).trim()
                if (payload === '[DONE]') continue
                let chunk: StreamChunk
                try {
                    chunk = JSON.parse(payload)
                } catch {
                    continue
                }
                if (chunk.error?.message) throw new DeepSeekError(`AI 流错误：${chunk.error.message}`, payload)
                const delta = chunk.choices?.[0]?.delta
                if (delta?.content) {
                    content += delta.content
                    options.onDelta?.({ content: delta.content })
                }
                if (delta?.reasoning_content) {
                    reasoning += delta.reasoning_content
                    options.onDelta?.({ reasoning: delta.reasoning_content })
                }
                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index ?? 0
                        const cur = toolCalls.get(idx) ?? { id: '', name: '', args: '' }
                        if (tc.id) cur.id += tc.id
                        if (tc.function?.name) cur.name += tc.function.name
                        if (tc.function?.arguments) cur.args += tc.function.arguments
                        toolCalls.set(idx, cur)
                    }
                }
                if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason
                if (chunk.usage) usage = chunk.usage
            }
        }
    } catch (e) {
        if (e instanceof DeepSeekError) throw e
        const err = e instanceof Error ? e.message : String(e)
        throw new DeepSeekError(`读取流失败：${err}`, err)
    }

    const calls: ChatToolCall[] = [...toolCalls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => ({ id: v.id, name: v.name, arguments: v.args }))

    return {
        content,
        reasoning,
        usage,
        finishReason: finishReason || undefined,
        toolCalls: calls.length ? calls : undefined
    }
}
