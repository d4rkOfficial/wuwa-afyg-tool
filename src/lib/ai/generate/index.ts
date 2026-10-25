// Buff 生成主循环（移植自 wuwa-afyg-share src/lib/ai/generate.ts）：工具轮询 → JSON 解析 → 清洗 → 自动修复
//
// 两条硬要求（本文件的核心约定）：
// 1. **没有工具调用上限**：只要模型还在「查数据 / 再看一眼」，就一直循环下去；
//    唯一的刹车是用户按停止（`options.signal`）——需要中止时一律抛 AiClientError('aborted')。
// 2. **实时上报生成情况**：每一轮请求、每一次工具调用、每一段流式正文/思考都经 `onEvent` 抛出，
//    界面据此把「正在做什么」画在生成任务那一行上（不是等结束才一次性给结果）。
import { AiClientError, chatCompletionStream, type ChatMessage } from '../client'
import {
    executeGenerateTool,
    ENTITY_TYPES,
    GENERATE_TOOLS,
    type GenerateDataSource,
    type GeneratedBuff,
    type GenerateEntityType
} from './tools'
import {
    renderSystemPrompt,
    renderInitialTaskPrompt,
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_INITIAL_TASK_PROMPT
} from './prompts'
import { sanitizeBuffs } from './sanitize'

/** @desc 单次自动修复上限（解析失败后把错误喂回模型重来；与「工具轮次」无关，刻意保留上限） */
export const MAX_FIX_RETRY = 2

/**
 * @desc 生成过程的实时事件。
 *
 * - `status`：一句人话状态（第几轮、工具名、解析结果…），同时经 `onProgress(text)` 上报给老的文本通道；
 * - `content` / `reasoning`：模型正在流出的正文 / 思考增量（`delta` 是增量，`contentChars`/`reasoningChars` 是累计）；
 * - `tool` / `tool-result`：工具开始 / 结束（`toolName` + `toolArgs`）；
 * - `result` / `error`：收尾（成功条数 / 失败原因）。
 */
export interface GenerateEvent {
    kind: 'status' | 'content' | 'reasoning' | 'tool' | 'tool-result' | 'result' | 'error'
    /** @desc 给人看的一行状态（status / tool / tool-result / result / error 必有） */
    text?: string
    /** @desc 本轮序号（从 1 起；让界面能显示「第 N 轮」而不必自己数） */
    round?: number
    /** @desc 本轮之前已累计的工具调用次数 */
    toolCalls?: number
    toolName?: string
    toolArgs?: Record<string, unknown>
    /** @desc 增量文本（仅 content / reasoning） */
    delta?: string
    /** @desc 累计输出 / 思考字符数 */
    contentChars?: number
    reasoningChars?: number
    /** @desc 成功解析出的 Buff 条数（仅 result） */
    buffCount?: number
}

export interface GenerateBuffOptions {
    apiKey: string
    entityType: string
    entityName: string
    baseUrl?: string
    model?: string
    reasoningEffort?: 'low' | 'medium' | 'high'
    // 用户自定义命名规则（可能为空：用默认兜底）
    namingRule?: string
    // 用户自定义黑话词典（可能为空：用默认词典）
    slangDict?: string
    systemPrompt?: string
    initialTaskPrompt?: string
    data: GenerateDataSource
    /** @desc 单次请求最大输出 token（缺省用 client 内置默认值） */
    maxOutputTokens?: number
    /** @desc 浏览器直连（缺省走自动策略） */
    direct?: boolean
    history?: ChatMessage[]
    newUserMessage?: string
    /** @desc 用户停止（唯一能终止生成的手段） */
    signal?: AbortSignal
    /** @desc 兼容旧调用的一行文本进度通道（等价于 `onEvent` 里的 status.text） */
    onProgress?: (text: string) => void
    /** @desc 实时生成事件（界面按 kind 分流展示） */
    onEvent?: (evt: GenerateEvent) => void
}

export interface GenerateBuffResult {
    buffs: GeneratedBuff[] | null
    rawContent: string
    parseError: string | null
}

/** @desc 用户按下停止时的统一错误（界面据 `debug === 'aborted'` 静默收尾，不当作失败） */
const abortedError = (): AiClientError => new AiClientError('已停止生成', 'aborted')

export const generateBuffs = async (options: GenerateBuffOptions): Promise<GenerateBuffResult> => {
    const apiKey = options.apiKey.trim()
    const entityType = options.entityType
    const entityName = options.entityName.trim().slice(0, 60)
    const systemTemplate = options.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT
    const initialTaskTemplate = options.initialTaskPrompt?.trim() || DEFAULT_INITIAL_TASK_PROMPT
    const namingRule = options.namingRule?.trim() ?? ''
    const slangDict = options.slangDict?.trim() ?? ''
    const data = options.data
    const history = Array.isArray(options.history) ? options.history : []
    const newUserMessage = options.newUserMessage?.trim() || ''
    const reasoningEffort: 'low' | 'medium' | 'high' | undefined =
        options.reasoningEffort === 'low' || options.reasoningEffort === 'medium' || options.reasoningEffort === 'high'
            ? options.reasoningEffort
            : undefined
    const signal = options.signal

    if (!apiKey) throw new Error('未配置 AI API Key')
    if (!ENTITY_TYPES.includes(entityType as GenerateEntityType)) throw new Error('无效的实体类型')
    if (!entityName) throw new Error('实体名不能为空')

    const toolContext = { entityType: entityType as GenerateEntityType, entityName, namingRule, slangDict, data }

    /** @desc 统一出口：事件回调 + 老的一行文本通道（status 文本同时喂给 `onProgress`） */
    const emit = (evt: GenerateEvent): void => {
        options.onEvent?.(evt)
        if (evt.kind === 'status' && evt.text) options.onProgress?.(evt.text)
    }
    const emitStatus = (text: string, extra: Partial<GenerateEvent> = {}): void =>
        emit({ kind: 'status', text, ...extra })

    const targetLabel = data.target === 'project' ? '工程 Buff 配置' : '主页 Buff 集'
    const systemContent = `${renderSystemPrompt(systemTemplate, { entityType, namingRule })}\n当前生成目标：${targetLabel}。`
    const messages: ChatMessage[] = [{ role: 'system', content: systemContent }]
    const initialUser = renderInitialTaskPrompt(initialTaskTemplate, { entityType, entityName })
    messages.push({ role: 'user', content: initialUser })
    if (history.length > 0) messages.push(...history)
    if (newUserMessage) messages.push({ role: 'user', content: newUserMessage })

    /** @desc 最终输出（无工具调用那一轮的正文） */
    let content = ''
    /** @desc 自动修复已用次数 */
    let fixCount = 0
    /** @desc 本回合已执行的工具调用总数（跨轮累计，显示在状态行上） */
    let toolCallTotal = 0
    /** @desc 本轮已流出的正文（每轮归零；`result.content` 为空时用它兜底） */
    let roundText = ''
    /** @desc 本轮已流出的正文字符数（每轮归零；用于实时展示） */
    let roundChars = 0
    /** @desc 本轮已流出的思考字符数 */
    let roundReasoningChars = 0

    emitStatus(`开始生成：${entityName}`)

    // 无工具调用上限：只有「模型不再调工具」或「用户停止」才会离开循环
    for (let round = 1; ; round++) {
        if (signal?.aborted) throw abortedError()
        roundText = ''
        roundChars = 0
        roundReasoningChars = 0
        emitStatus(`第 ${round} 轮请求${toolCallTotal > 0 ? `（累计工具调用 ${toolCallTotal} 次）` : ''}…`, {
            round,
            toolCalls: toolCallTotal
        })

        const result = await chatCompletionStream(apiKey, messages, {
            tools: GENERATE_TOOLS,
            reasoningEffort,
            baseUrl: options.baseUrl,
            model: options.model,
            signal,
            maxOutputTokens: options.maxOutputTokens,
            direct: options.direct,
            onDelta: (delta) => {
                if (delta.content) {
                    roundText += delta.content
                    roundChars += delta.content.length
                    emit({
                        kind: 'content',
                        delta: delta.content,
                        round,
                        contentChars: roundChars,
                        reasoningChars: roundReasoningChars
                    })
                }
                if (delta.reasoning) {
                    roundReasoningChars += delta.reasoning.length
                    emit({
                        kind: 'reasoning',
                        delta: delta.reasoning,
                        round,
                        contentChars: roundChars,
                        reasoningChars: roundReasoningChars
                    })
                }
            }
        })

        if (signal?.aborted) throw abortedError()

        // 有工具调用 → 执行并回喂（继续下一轮，不设上限）
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
                if (signal?.aborted) throw abortedError()
                let args: Record<string, unknown> = {}
                try {
                    args = tc.arguments ? JSON.parse(tc.arguments) : {}
                } catch {
                    args = {}
                }
                toolCallTotal += 1
                emit({
                    kind: 'tool',
                    text: `工具调用（第 ${round} 轮）：${tc.name}`,
                    round,
                    toolCalls: toolCallTotal,
                    toolName: tc.name,
                    toolArgs: args
                })
                let output: string
                try {
                    output = await executeGenerateTool(toolContext, tc.name, args)
                } catch (e) {
                    output = JSON.stringify({ error: e instanceof Error ? e.message : '工具执行失败' })
                }
                emit({
                    kind: 'tool-result',
                    text: `工具返回：${tc.name}（${output.length} 字符）`,
                    round,
                    toolCalls: toolCallTotal,
                    toolName: tc.name,
                    toolArgs: args
                })
                messages.push({ role: 'tool', tool_call_id: tc.id, content: output })
            }
            emitStatus(`第 ${round} 轮工具处理完毕，继续生成…`, { round, toolCalls: toolCallTotal })
            continue
        }

        // 无工具调用 → 尝试解析最终内容
        // result.content 优先（服务商合并后的正文）；为空时用本轮流式累积的正文兜底
        //（极少数端点流里有正文但 finish 后 content 为空，不兜底就会误报「AI 未返回内容」）
        content = result.content?.trim() ? result.content : roundText

        if (!content.trim()) {
            emit({ kind: 'error', text: 'AI 未返回内容', round, toolCalls: toolCallTotal })
            return { buffs: null, rawContent: content, parseError: 'AI 未返回内容' }
        }

        let buffs: GeneratedBuff[] | null = null
        let parseError: string | null = null
        try {
            const parsed = JSON.parse(content) as { buffs?: unknown[] }
            if (Array.isArray(parsed.buffs)) {
                buffs = sanitizeBuffs(parsed.buffs as GeneratedBuff[])
                if (buffs.length > 0) {
                    emit({
                        kind: 'result',
                        text: `解析成功：${entityName} 得到 ${buffs.length} 条可用 Buff`,
                        round,
                        toolCalls: toolCallTotal,
                        buffCount: buffs.length
                    })
                    return { buffs, rawContent: content, parseError: null }
                }
                parseError = 'buffs 数组为空'
            } else {
                parseError = '返回结构缺少 buffs 数组'
            }
        } catch {
            parseError = '返回的不是合法 JSON'
        }

        // 解析失败 → 自动修复（把错误喂回 AI 再生成一轮）
        if (fixCount < MAX_FIX_RETRY) {
            fixCount++
            messages.push({ role: 'assistant', content })
            messages.push({
                role: 'user',
                content: `你上一条回复不是可用的 Buff JSON（错误：${parseError}）。请重新只输出符合输出格式的完整 buffs JSON：{"buffs":[{...}]}，不要包含任何其它内容、解释或代码块标记。`
            })
            emitStatus(`解析失败（${parseError}），自动修复第 ${fixCount}/${MAX_FIX_RETRY} 次`, {
                round,
                toolCalls: toolCallTotal
            })
            content = ''
            continue
        }

        emit({
            kind: 'error',
            text: `生成失败：${entityName}（${parseError}）`,
            round,
            toolCalls: toolCallTotal
        })
        return { buffs: null, rawContent: content, parseError }
    }
}
