// DeepSeek Responses API 流式客户端：原生服务端 web_search + 函数工具（仅 DeepSeek 官方 / deepseek-v4-flash 支持）
// 协议差异：POST /responses、items 消息结构、reasoning.effort、max_output_tokens、SSE 事件带 type 字段、无 [DONE]
import { DeepSeekError } from './client'

const TIMEOUT_MS = 240000
const MAX_OUTPUT_TOKENS = 65536

// ── Responses API item 类型 ──

export interface ResponseMessageItem {
    type: 'message'
    role: 'user' | 'assistant' | 'system'
    content: Array<{ type: string; text: string }>
}

export interface ResponseFunctionCallItem {
    type: 'function_call'
    id?: string
    call_id?: string
    name: string
    arguments: string
}

export interface ResponseFunctionCallOutputItem {
    type: 'function_call_output'
    call_id: string
    output: string
}

export interface ResponseWebSearchCallItem {
    type: 'web_search_call'
    id: string
}

export type ResponsesItem =
    ResponseMessageItem | ResponseFunctionCallItem | ResponseFunctionCallOutputItem | ResponseWebSearchCallItem

// ── 流式选项与结果 ──

export interface ResponsesStreamOptions {
    apiKey: string
    model: string
    baseUrl: string
    instructions?: string
    input: ResponsesItem[]
    // 现有函数工具（ChatCompletions 结构），内部转为 Responses 结构并追加 web_search
    tools?: unknown[]
    reasoningEffort?: 'low' | 'medium' | 'high'
    signal?: AbortSignal
    onDelta?: (delta: { content?: string; reasoning?: string }) => void
    onSearch?: (status: 'searching' | 'completed', query?: string) => void
}

export interface ResponsesStreamResult {
    content: string
    reasoning: string
    usage?: Record<string, unknown>
    finishReason?: string
    // 本轮新增的 output items（assistant message / function_call / web_search_call），下轮原样回传
    items: ResponsesItem[]
}

// Responses 工具结构：{type:'function', name, description, parameters}
function toResponsesTools(tools: unknown[] | undefined): unknown[] {
    const list: unknown[] = []
    for (const t of tools ?? []) {
        const fn = (t as { type?: string; function?: { name?: string; description?: string; parameters?: unknown } })
            ?.function
        if (!fn?.name) continue
        list.push({
            type: 'function',
            name: fn.name,
            description: fn.description ?? '',
            parameters: fn.parameters ?? { type: 'object', properties: {} }
        })
    }
    list.push({ type: 'web_search' })
    return list
}

function parseErrorPayload(payload: unknown): string {
    const p = payload as { error?: { message?: string } | string }
    if (!p) return ''
    if (typeof p.error === 'string') return p.error
    return p.error?.message ?? ''
}

export async function responsesStream(options: ResponsesStreamOptions): Promise<ResponsesStreamResult> {
    const { apiKey, model, baseUrl, input, signal } = options
    if (!apiKey.trim()) throw new DeepSeekError('未配置 AI API Key', 'no-key')

    const body: Record<string, unknown> = {
        model,
        input,
        stream: true,
        temperature: 0.3,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        tools: toResponsesTools(options.tools),
        tool_choice: 'auto'
    }
    if (options.instructions?.trim()) body.instructions = options.instructions.trim()
    if (options.reasoningEffort) body.reasoning = { effort: options.reasoningEffort }

    const base = baseUrl.trim().replace(/\/+$/, '')
    const abort = signal ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), signal]) : AbortSignal.timeout(TIMEOUT_MS)

    let res: Response
    try {
        res = await fetch(`${base}/responses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal: abort
        })
    } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        if (err.includes('AbortError') || err.includes('TimeoutError')) {
            if (signal?.aborted) throw new DeepSeekError('已停止生成', 'aborted')
            throw new DeepSeekError('AI 请求超时', '请求超时，请重试或换模型')
        }
        throw new DeepSeekError(`无法连接 AI 服务（${base}）：${err}`, err)
    }

    if (!res.ok) {
        let detail = ''
        try {
            const payload = (await res.json()) as { error?: { message?: string } | string }
            detail = parseErrorPayload(payload)
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
    let usage: Record<string, unknown> | undefined
    // item_id → 累积的函数调用
    const functionCalls = new Map<string, { id?: string; call_id?: string; name: string; args: string }>()
    const webSearchCalls = new Map<string, { id: string; query?: string }>()
    let completedPayload: Record<string, unknown> | null = null

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
                if (!payload) continue
                let chunk: Record<string, unknown>
                try {
                    chunk = JSON.parse(payload) as Record<string, unknown>
                } catch {
                    continue
                }
                const type = String(chunk.type ?? '')
                switch (type) {
                    case 'response.output_text.delta':
                        if (typeof chunk.delta === 'string') {
                            content += chunk.delta
                            options.onDelta?.({ content: chunk.delta })
                        }
                        break
                    case 'response.reasoning_text.delta':
                        if (typeof chunk.delta === 'string') {
                            reasoning += chunk.delta
                            options.onDelta?.({ reasoning: chunk.delta })
                        }
                        break
                    case 'response.function_call_arguments.delta': {
                        const itemId = String(chunk.item_id ?? '')
                        if (!itemId) break
                        const cur = functionCalls.get(itemId) ?? { name: '', args: '' }
                        if (typeof chunk.delta === 'string') cur.args += chunk.delta
                        functionCalls.set(itemId, cur)
                        break
                    }
                    case 'response.output_item.done': {
                        const item = chunk.item as Record<string, unknown> | undefined
                        if (!item) break
                        if (item.type === 'function_call') {
                            const itemId = String(item.id ?? '')
                            const cur = functionCalls.get(itemId) ?? { name: '', args: '' }
                            cur.id = itemId
                            if (typeof item.call_id === 'string') cur.call_id = item.call_id
                            if (typeof item.name === 'string' && !cur.name) cur.name = item.name
                            if (typeof item.arguments === 'string' && item.arguments) cur.args = item.arguments
                            functionCalls.set(itemId, cur)
                        } else if (item.type === 'web_search_call') {
                            const id = String(item.id ?? '')
                            const action = item.action as { query?: string } | undefined
                            webSearchCalls.set(id, { id, query: action?.query })
                            options.onSearch?.('completed', action?.query)
                        }
                        break
                    }
                    case 'response.web_search_call.in_progress':
                    case 'response.web_search_call.searching':
                        options.onSearch?.('searching')
                        break
                    case 'response.completed': {
                        completedPayload = chunk.response as Record<string, unknown> | null
                        if (chunk.usage) usage = chunk.usage as Record<string, unknown>
                        if (typeof (chunk.response as { status?: string })?.status === 'string') {
                            finishReason = (chunk.response as { status?: string }).status ?? ''
                        }
                        break
                    }
                    case 'response.failed': {
                        const errPayload = (chunk.response as { error?: unknown }) ?? chunk
                        throw new DeepSeekError(`AI 流错误：${parseErrorPayload(errPayload) || '生成失败'}`, payload)
                    }
                    default:
                        break
                }
            }
        }
    } catch (e) {
        if (e instanceof DeepSeekError) throw e
        const err = e instanceof Error ? e.message : String(e)
        throw new DeepSeekError(`读取流失败：${err}`, err)
    }

    // 以 response.completed 的 output 为准组装 items（兜底：用事件累积的数据）
    const items: ResponsesItem[] = []
    const completedOutput = (completedPayload?.output as unknown[]) ?? null
    if (Array.isArray(completedOutput)) {
        for (const raw of completedOutput) {
            const item = raw as Record<string, unknown>
            if (item.type === 'message') {
                items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content }] })
            } else if (item.type === 'function_call') {
                const itemId = String(item.id ?? '')
                const cur = functionCalls.get(itemId) ?? {
                    name: String(item.name ?? ''),
                    args: String(item.arguments ?? '')
                }
                items.push({
                    type: 'function_call',
                    id: itemId,
                    call_id: String(item.call_id ?? itemId),
                    name: cur.name || String(item.name ?? ''),
                    arguments: cur.args || String(item.arguments ?? '')
                })
            } else if (item.type === 'web_search_call') {
                items.push({ type: 'web_search_call', id: String(item.id ?? '') })
            }
        }
    } else {
        if (content)
            items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content }] })
        for (const [, fc] of functionCalls) {
            const id = fc.id ?? fc.call_id ?? `fc-${Math.random().toString(36).slice(2, 8)}`
            items.push({ type: 'function_call', id, call_id: fc.call_id ?? id, name: fc.name, arguments: fc.args })
        }
        for (const [, wc] of webSearchCalls) items.push({ type: 'web_search_call', id: wc.id })
    }

    return { content, reasoning, usage, finishReason: finishReason || undefined, items }
}

// 是否启用 Responses API（仅 DeepSeek 官方 + deepseek-v4-flash 支持原生 web_search）
export function supportsResponsesWebSearch(baseUrl: string, model: string): boolean {
    try {
        return new URL(baseUrl).host === 'api.deepseek.com' && model.trim() === 'deepseek-v4-flash'
    } catch {
        return false
    }
}
