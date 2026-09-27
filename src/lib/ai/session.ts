// AI 对话会话：工具轮询循环 + 事件分发（ai/reasoning/tool/confirm/error/done）
// 双协议：DeepSeek 官方 profile（Responses API + 原生服务端 web_search）与其他提供商（Chat Completions）
import { chatCompletionStream, type ChatMessage } from './client'
import {
    responsesStream,
    supportsResponsesWebSearch,
    type ResponseFunctionCallItem,
    type ResponseWebSearchCallItem,
    type ResponsesItem
} from './responses'
import { buildTools, executeTool, summarizeToolOutput, type ToolContext } from './tools'
import { getAiConfig } from './config.svelte'
import { getGenPrefs, loadGenPrefs } from '$lib/data/ai-prefs.svelte'
import { drainChanges, renderChangesForPrompt } from './change-queue.svelte'
import { getSkills, loadSkills, renderActiveSkillListing, renderPassiveSkillsPrompt } from '$lib/data/ai-skills.svelte'
import { buildTurnSegments, segmentsToMessages, type TurnContextInput } from './turn-context'
import { DEFAULT_SYSTEM_PROMPT } from './persona'
import { estimateMessagesTokens, estimateTokens, parseUsage } from './token-usage'
import {
    beginToolCall,
    beginTurn,
    endToolCall,
    finishTurn,
    getDisabledSegments,
    markStreaming,
    markToolWaiting,
    recordRequestUsage,
    setContextSnapshot,
    setTurnPhase
} from './turn-state.svelte'

export const MAX_TOOL_ROUNDS = 8

export { DEFAULT_SYSTEM_PROMPT as SYSTEM_PROMPT }

export interface SessionEvent {
    type: 'ai' | 'reasoning' | 'tool' | 'confirm' | 'error' | 'done'
    text?: string
    toolName?: string
    toolArgs?: Record<string, unknown>
    resultLen?: number
    message?: string
}

export interface RunTurnOptions {
    history?: ChatMessage[]
    newUserMessage?: string
    // 当前状态上下文（工程/视图等），作为一条 system 消息注入，让 AI 感知用户侧切换
    context?: string
    onEvent?: (evt: SessionEvent) => void
    onConfirm?: ToolContext['onConfirm']
    // AI 请求切换视图（由宿主实现）
    requestView?: (phase: string) => void
    // 修改计算态后通知宿主持久化
    onCalcUpdate?: () => void
    // 长时间生成任务的进度回调（如 Buff 集生成）
    onGenerateProgress?: (text: string) => void
    // 取消信号（停止生成）
    signal?: AbortSignal
    // 回传本次完整消息序列（不含 system），供下一轮继续上下文
    onMessages?: (messages: ChatMessage[]) => void
}

export interface RunTurnResult {
    ok: boolean
    text: string
    error?: string
}

// ChatMessage → Responses items（首条 system 作为 instructions，其余全部转为 input items）
function toResponseItems(
    messages: ChatMessage[],
    systemPrompt: string
): { instructions: string; input: ResponsesItem[] } {
    const input: ResponsesItem[] = []
    for (const m of messages) {
        if (m.role === 'system') {
            input.push({ type: 'message', role: 'system', content: [{ type: 'input_text', text: m.content || '' }] })
        } else if (m.role === 'user') {
            input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: m.content || '' }] })
        } else if (m.role === 'assistant') {
            input.push({
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: m.content || '' }]
            })
            for (const tc of m.tool_calls ?? []) {
                input.push({
                    type: 'function_call',
                    call_id: tc.id,
                    name: tc.function.name,
                    arguments: tc.function.arguments
                })
            }
            for (const w of m.webSearchCalls ?? []) {
                input.push({ type: 'web_search_call', id: w.id })
            }
        } else if (m.role === 'tool') {
            input.push({ type: 'function_call_output', call_id: m.tool_call_id ?? '', output: m.content ?? '' })
        }
    }
    return { instructions: systemPrompt, input }
}

// 解析工具参数 JSON（失败降级为空对象）
function parseToolArgs(raw: string): Record<string, unknown> {
    try {
        return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
        return {}
    }
}

/** @desc 执行一次工具调用并把结果记进实时运行情况（耗时 / 成败 / 梗概） */
async function runToolCall(toolContext: ToolContext, name: string, args: Record<string, unknown>): Promise<string> {
    const index = beginToolCall(name, args)
    let output: string
    try {
        output = await executeTool(toolContext, name, args)
    } catch (e) {
        output = JSON.stringify({ ok: false, error: e instanceof Error ? e.message : '工具执行失败' })
    }
    const info = summarizeToolOutput(output)
    endToolCall(index, info.ok, info.summary)
    return output
}

async function runResponsesRound(
    cfg: { apiKey: string; baseUrl: string; model: string; reasoningEffort: 'low' | 'medium' | 'high' },
    messages: ChatMessage[],
    tools: unknown[],
    toolContext: ToolContext,
    emit: (evt: SessionEvent) => void,
    options: Pick<RunTurnOptions, 'signal' | 'onEvent'>,
    systemPrompt: string
): Promise<{ text: string; reasoning: string; done: boolean; usage: unknown }> {
    const { instructions, input } = toResponseItems(messages.slice(1), systemPrompt)
    let text = ''
    let reasoning = ''
    // 服务端 web_search 也是一次工具调用：记进实时运行情况（无本地结果体）
    let searchIndex = -1
    const result = await responsesStream({
        apiKey: cfg.apiKey,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        instructions,
        input,
        tools,
        reasoningEffort: cfg.reasoningEffort,
        signal: options.signal,
        onDelta: (delta) => {
            if (delta.content) {
                text += delta.content
                markStreaming()
                emit({ type: 'ai', text: delta.content })
            }
            if (delta.reasoning) {
                reasoning += delta.reasoning
                markStreaming()
                emit({ type: 'reasoning', text: delta.reasoning })
            }
        },
        onSearch: (status, query) => {
            if (status === 'searching') {
                // 同一次检索会先后发 in_progress / searching，只记一次实时条目（UI 事件流维持原样）
                if (searchIndex < 0) searchIndex = beginToolCall('web_search', query ? { query } : {})
                emit({ type: 'tool', toolName: 'web_search', toolArgs: query ? { query } : {} })
            } else if (searchIndex >= 0) {
                endToolCall(searchIndex, true, '服务端检索完成')
                searchIndex = -1
            }
        }
    })

    const calls = result.items.filter((i): i is ResponseFunctionCallItem => i.type === 'function_call')
    const webSearchCalls = result.items.filter((i): i is ResponseWebSearchCallItem => i.type === 'web_search_call')

    if (calls.length > 0 || webSearchCalls.length > 0) {
        messages.push({
            role: 'assistant',
            content: result.content || '',
            tool_calls: calls.length
                ? calls.map((c) => ({
                      id: c.call_id ?? c.id ?? '',
                      type: 'function' as const,
                      function: { name: c.name, arguments: c.arguments }
                  }))
                : undefined,
            webSearchCalls: webSearchCalls.map((w) => ({ id: w.id }))
        })
        for (const c of calls) {
            const callId = c.call_id ?? c.id ?? ''
            const args = parseToolArgs(c.arguments)
            emit({ type: 'tool', toolName: c.name, toolArgs: args })
            const output = await runToolCall(toolContext, c.name, args)
            emit({ type: 'tool', toolName: c.name, toolArgs: args, resultLen: output.length })
            messages.push({ role: 'tool', tool_call_id: callId, content: output })
        }
        return { text, reasoning, done: false, usage: result.usage }
    }

    if (result.content?.trim()) {
        text = result.content
    }
    return { text, reasoning, done: true, usage: result.usage }
}

export async function runAiTurn(options: RunTurnOptions): Promise<RunTurnResult> {
    const cfg = getAiConfig()
    const emit = options.onEvent ?? (() => {})
    const tools = buildTools()
    const confirmHandler = options.onConfirm
    const toolContext: ToolContext = {
        // 危险操作确认期间属于「等待工具结果」
        onConfirm: confirmHandler
            ? async (toolName, summary) => {
                  markToolWaiting('等待用户确认', toolName)
                  try {
                      return await confirmHandler(toolName, summary)
                  } finally {
                      setTurnPhase('tool', { toolName })
                  }
              }
            : undefined,
        requestView: options.requestView,
        notifyCalc: options.onCalcUpdate,
        // 长任务进度：仍是等待工具结果
        onGenerateProgress: (text) => {
            markToolWaiting(text || '生成中…')
            options.onGenerateProgress?.(text)
        }
    }

    if (!cfg.apiKey.trim()) {
        emit({ type: 'error', message: '请先在 设置 → 助手设置 中填写 API Key' })
        return { ok: false, text: '', error: '未配置 API Key' }
    }

    // 人设提示词：用户自定义优先，未设置/清空用默认
    await loadGenPrefs()
    await loadSkills()
    const systemPrompt = getGenPrefs().systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT

    /** @desc 技能卡：被动技能正文常驻注入；主动技能只进「名称 + 描述」清单（正文由 use_skill 按需激活） */
    const skills = getSkills()

    /** @desc 变化队列：把用户在上轮之后的工程/环节改动作为系统消息上报，消费后清空（界面不可见） */
    const changes = renderChangesForPrompt(drainChanges())

    const input: TurnContextInput = {
        systemPrompt,
        passiveSkills: renderPassiveSkillsPrompt(skills),
        skillListing: renderActiveSkillListing(skills),
        context: options.context,
        changes,
        history: Array.isArray(options.history) ? options.history : [],
        userMessage: options.newUserMessage
    }

    // 上下文分段：装配与上下文面板共用同一份真源；被临时禁用的段不注入本轮
    const segments = buildTurnSegments(input)
    setContextSnapshot(segments)
    const messages = segmentsToMessages(segments, getDisabledSegments())

    let text = ''
    const useResponses = supportsResponsesWebSearch(cfg.baseUrl, cfg.model)

    beginTurn()
    try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            if (useResponses) {
                const r = await runResponsesRound(cfg, messages, tools, toolContext, emit, options, systemPrompt)
                text = r.text
                // usage 优先取服务商上报；完全没有时用本地估算兜底
                recordRequestUsage(parseUsage(r.usage), {
                    promptTokens: estimateMessagesTokens(messages),
                    completionTokens: estimateTokens(r.text + r.reasoning)
                })
                if (r.done) break
                continue
            }

            const promptEstimate = estimateMessagesTokens(messages)
            const result = await chatCompletionStream(cfg.apiKey, messages, {
                tools,
                reasoningEffort: cfg.reasoningEffort,
                baseUrl: cfg.baseUrl,
                model: cfg.model,
                signal: options.signal,
                onDelta: (delta) => {
                    if (delta.content) {
                        text += delta.content
                        markStreaming()
                        emit({ type: 'ai', text: delta.content })
                    }
                    if (delta.reasoning) {
                        markStreaming()
                        emit({ type: 'reasoning', text: delta.reasoning })
                    }
                }
            })

            recordRequestUsage(parseUsage(result.usage), {
                promptTokens: promptEstimate,
                completionTokens: estimateTokens(result.content + result.reasoning)
            })

            if (result.toolCalls && result.toolCalls.length > 0) {
                const assistantMsg: ChatMessage = {
                    role: 'assistant',
                    content: result.content || '',
                    tool_calls: result.toolCalls.map((tc) => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: { name: tc.name, arguments: tc.arguments }
                    }))
                }
                messages.push(assistantMsg)

                for (const tc of result.toolCalls) {
                    const args = parseToolArgs(tc.arguments)
                    emit({ type: 'tool', toolName: tc.name, toolArgs: args })
                    const output = await runToolCall(toolContext, tc.name, args)
                    emit({ type: 'tool', toolName: tc.name, toolArgs: args, resultLen: output.length })
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: output })
                }
                continue
            }

            if (result.content?.trim()) {
                text = result.content
            }
            break
        }

        emit({ type: 'done', text })
        options.onMessages?.(messages.slice(1))
        return { ok: true, text }
    } finally {
        // 无论成功 / 失败 / 中止都要收尾：停表并保留本轮汇总（下一轮开始时清空）
        finishTurn()
    }
}
