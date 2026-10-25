// AI 对话会话：工具轮询循环 + 事件分发（ai/reasoning/tool/confirm/error/done）
// 双协议：DeepSeek 官方 profile（Responses API + 原生服务端 web_search）与其他提供商（Chat Completions）
import { chatCompletionStream, isOutputTruncated, type ChatMessage } from './client'
import {
    responsesStream,
    supportsResponsesWebSearch,
    type ResponseFunctionCallItem,
    type ResponseWebSearchCallItem,
    type ResponsesItem
} from './responses'
import { availableTools, executeTool, summarizeToolOutput, type ToolContext } from './tools'
import type { GenerateEvent } from './generate'
import { resolveAiConfig, type ResolvedAiConfig } from './session-overrides.svelte'
import { toReasoningEffort } from './thinking'
import { hasImageAttachments, toResponseContentParts } from './image-parts'
import { ABORTED_TOOL_OUTPUT, raceWithAbort } from './abort'
import { runInSandbox } from './sandbox/runner'
import { getGenPrefs, loadGenPrefs } from '$lib/data/ai-prefs.svelte'
import { drainChanges, renderChangesForPrompt } from './change-queue.svelte'
import { getSkills, loadSkills, renderActiveSkillListing, renderPassiveSkillsPrompt } from '$lib/data/ai-skills.svelte'
import { buildTurnSegments, segmentsToMessages, type TurnContextInput, type TurnSegmentId } from './turn-context'
import { buildLongTaskContinuation, canAutoContinue } from './long-task'
import { DEFAULT_SYSTEM_PROMPT } from './persona'
import { estimateMessagesTokens, estimateTokens, parseUsage } from './token-usage'
import {
    beginToolCall,
    beginTurn,
    endToolCall,
    finishTurn,
    getDisabledSegments,
    getLongTaskContinuations,
    getLongTaskNote,
    getWorkSummary,
    isLongTaskActive,
    markLongTaskContinuation,
    markStreaming,
    markToolWaiting,
    recordRequestUsage,
    setContextSnapshot,
    setLongTaskActive,
    setTurnPhase
} from './turn-state.svelte'

/** @desc 工具轮次的**兜底默认**（每份 AI 配置可用 `maxToolRounds` 覆盖；见 `config.svelte.ts`） */
export const MAX_TOOL_ROUNDS = 48

/**
 * @desc 回传历史时**保留**的分段：只有这两段属于「对话本身」。
 *
 * 其余分段（人设 / 被动技能正文 / 主动技能清单 / 当前状态 / 变化队列）每轮都由
 * `buildTurnSegments()` 按当前设置重新注入，因此**不能**随历史一起带走 ——
 * 否则它们会在历史上逐轮堆积、重复注入。这也正是 `onMessages` 契约里
 * 「回传本次完整消息序列（不含 system）」的要求（原实现只 `slice(1)` 丢掉 persona，
 * 留下另外四个 system 段，实测会造成 prompt token 逐轮虚涨）。
 */
const PERSISTED_SEGMENT_IDS: readonly TurnSegmentId[] = ['history', 'user']

export { DEFAULT_SYSTEM_PROMPT as SYSTEM_PROMPT }

export interface SessionEvent {
    type: 'ai' | 'reasoning' | 'tool' | 'confirm' | 'error' | 'done' | 'longTask'
    text?: string
    toolName?: string
    toolArgs?: Record<string, unknown>
    resultLen?: number
    /** @desc 工具返回的完整结果文本（JSON 字符串），供聊天卡片展开查看；服务端 web_search 无结果体时不带 */
    resultText?: string
    /**
     * @desc 本次工具调用的序号（进程内单调递增）。**「开始调用」与「出结果」两条事件共用它**，
     *  界面据此配对；不靠「最后一张卡 + 名称相同」——那套配对一旦漏一次就全体错位，
     *  表现为卡片永远停在「执行中…」（实测踩过：服务端 `web_search` 完成时不发结果事件）。
     */
    seq?: number
    /** @desc 「无结果体」的结束标记（服务端 `web_search` 只报检索完成，没有结果长度） */
    done?: boolean
    message?: string
}

/** @desc 工具调用序号发号器（只要同一轮内唯一即可，故用进程内单调递增，不必每轮归零） */
let toolCallSeq = 0
const nextToolSeq = (): number => {
    toolCallSeq += 1
    return toolCallSeq
}

export interface RunTurnOptions {
    history?: ChatMessage[]
    newUserMessage?: string
    /**
     * @desc 本轮用户消息附带的图片（data URL）。
     * 本地 token 估算**不含图片**（见 `token-usage.ts` 的局限说明），故附图的回合
     * prompt 估算会偏低，用量圈也只反映文本部分。
     */
    images?: string[]
    // 当前状态上下文（工程/视图等），作为一条 system 消息注入，让 AI 感知用户侧切换
    context?: string
    onEvent?: (evt: SessionEvent) => void
    onConfirm?: ToolContext['onConfirm']
    /**
     * @desc 向用户交互式提问（问题组）。**只有内置 AI 助手会传它**；
     *  WS 远程接管不传 → `ask_user` 既不上工具清单、直接调用也会被拒。
     */
    onAskUser?: ToolContext['askUser']
    /**
     * @desc 抓取网页正文（`web_fetch`）。**只有内置 AI 助手会传它**（经同源代理 `/api/ai/fetch`）；
     *  WS 远程接管不传 → `web_fetch` 既不上工具清单、直接调用也会被拒。
     */
    onWebFetch?: ToolContext['webFetch']
    // AI 请求切换视图（由宿主实现）
    requestView?: (phase: string) => void
    // 修改计算态后通知宿主持久化
    onCalcUpdate?: () => void
    // 长时间生成任务的进度回调（如 Buff 集生成；WS 远程接管只有这条一行文本通道）
    onGenerateProgress?: (text: string) => void
    /**
     * @desc 长时间生成任务的**实时事件**（轮次 / 工具 / 流式正文）。
     *  只有内置 AI 助手会传它：界面把「这一轮在查什么、模型正在写什么」实时画在生成任务行上。
     */
    onGenerateEvent?: (evt: GenerateEvent) => void
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
            // 图片附件与正文一起转成 Responses 的 input parts（形状见 image-parts.ts）
            input.push({
                type: 'message',
                role: 'user',
                content: toResponseContentParts(m.content || '', m.images ?? [])
            })
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

/**
 * @desc 执行一次工具调用并把结果记进实时运行情况（耗时 / 成败 / 梗概）。
 *
 * `signal` 是**必需的**：工具处理器不接受取消，没有它时一个不返回的工具会让整轮永远停在
 * 「正在调用工具「X」」、计时一直涨、而且停止按钮救不回来（abort 只打断 HTTP 流）。
 * 见 `$lib/ai/abort` 的文件头。
 */
async function runToolCall(
    toolContext: ToolContext,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined
): Promise<string> {
    const index = beginToolCall(name, args)
    let output: string
    try {
        output = await raceWithAbort(executeTool(toolContext, name, args), signal, () => ABORTED_TOOL_OUTPUT)
    } catch (e) {
        output = JSON.stringify({ ok: false, error: e instanceof Error ? e.message : '工具执行失败' })
    }
    // 无论工具是被中止 / 抛错还是正常返回，都要收尾——否则实时状态条会永远停在「正在调用工具」
    const info = summarizeToolOutput(output)
    endToolCall(index, info.ok, info.summary)
    return output
}

async function runResponsesRound(
    cfg: ResolvedAiConfig,
    messages: ChatMessage[],
    tools: unknown[],
    toolContext: ToolContext,
    emit: (evt: SessionEvent) => void,
    options: Pick<RunTurnOptions, 'signal' | 'onEvent'>,
    systemPrompt: string
): Promise<{ text: string; reasoning: string; done: boolean; usage: unknown; finishReason?: string }> {
    const { instructions, input } = toResponseItems(messages.slice(1), systemPrompt)
    let text = ''
    let reasoning = ''
    // 服务端 web_search 也是一次工具调用：记进实时运行情况（无本地结果体）
    let searchIndex = -1
    /** @desc 本次服务端检索的调用序号（与 `searchIndex` 同生命周期，用于配对结束事件） */
    let searchSeq = -1
    const result = await responsesStream({
        apiKey: cfg.apiKey,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        instructions,
        input,
        tools,
        reasoningEffort: toReasoningEffort(cfg.thinkingLevel),
        signal: options.signal,
        maxOutputTokens: cfg.maxOutputTokens,
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
                if (searchIndex < 0) {
                    searchIndex = beginToolCall('web_search', query ? { query } : {})
                    searchSeq = nextToolSeq()
                }
                emit({ type: 'tool', toolName: 'web_search', toolArgs: query ? { query } : {}, seq: searchSeq })
            } else if (searchIndex >= 0) {
                endToolCall(searchIndex, true, '服务端检索完成')
                // 必须发一条**同 seq 的结束事件**：原实现只更新实时状态、不发结果事件，
                // 于是这张卡永远停在「执行中…」，并把后续所有工具的结果配对顶偏
                emit({ type: 'tool', toolName: 'web_search', seq: searchSeq, done: true })
                searchIndex = -1
                searchSeq = -1
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
            const seq = nextToolSeq()
            emit({ type: 'tool', toolName: c.name, toolArgs: args, seq })
            const output = await runToolCall(toolContext, c.name, args, options.signal)
            emit({
                type: 'tool',
                toolName: c.name,
                toolArgs: args,
                resultLen: output.length,
                resultText: output,
                seq
            })
            messages.push({ role: 'tool', tool_call_id: callId, content: output })
        }
        return { text, reasoning, done: false, usage: result.usage, finishReason: result.finishReason }
    }

    if (result.content?.trim()) {
        text = result.content
    }
    return { text, reasoning, done: true, usage: result.usage, finishReason: result.finishReason }
}

export async function runAiTurn(options: RunTurnOptions): Promise<RunTurnResult> {
    const cfg = resolveAiConfig()
    const emit = options.onEvent ?? (() => {})
    const confirmHandler = options.onConfirm
    const askHandler = options.onAskUser
    const toolContext: ToolContext = {
        // 回合取消信号：需要长跑的生成工具靠它真正断开请求（见 registry 的 ToolContext.signal）
        signal: options.signal,
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
        // 交互式提问期间同样属于「等待工具结果」（面板会显示「等待用户回答」）
        askUser: askHandler
            ? async (request) => {
                  markToolWaiting('等待用户回答', 'ask_user')
                  try {
                      return await askHandler(request)
                  } finally {
                      setTurnPhase('tool', { toolName: 'ask_user' })
                  }
              }
            : undefined,
        requestView: options.requestView,
        notifyCalc: options.onCalcUpdate,
        // 抓取网页：宿主直连（同源代理内部已做 SSRF 校验），不需要额外的阶段包装
        webFetch: options.onWebFetch,
        // 长任务模式：只注入给内置助手；WS 远程接管没有「回合」，不提供该能力
        longTask: (active, note) => setLongTaskActive(active, note),
        // 长任务进度：仍是等待工具结果
        onGenerateProgress: (text) => {
            markToolWaiting(text || '生成中…')
            options.onGenerateProgress?.(text)
        },
        // 生成任务的实时事件：状态行进状态条，逐字/逐轮事件交界面画在任务行上。
        // 流式增量太密（一秒几十次），**不**逐条写实时状态条，只转发给界面。
        onGenerateEvent: (evt) => {
            if (evt.kind !== 'content' && evt.kind !== 'reasoning' && evt.text) {
                markToolWaiting(evt.text)
            }
            options.onGenerateEvent?.(evt)
        },
        // run_js 的沙箱运行器：**只有内置 AI 助手有它**（WS 走 windowRun，见 ws-remote 的 wsCtx）
        sandboxRun: runInSandbox
    }
    // 工具清单按**宿主能力**过滤：缺 askUser / webFetch 时对应工具不出现在清单里（WS 远程接管即此情形）
    const tools = availableTools(toolContext)

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
        workSummary: getWorkSummary(),
        changes,
        history: Array.isArray(options.history) ? options.history : [],
        userMessage: options.newUserMessage,
        userImages: options.images
    }

    // 上下文分段：装配与上下文面板共用同一份真源；被临时禁用的段不注入本轮
    const segments = buildTurnSegments(input)
    setContextSnapshot(segments)
    // 装配结果单独留一份：回合末尾要靠它切出「本轮新产生的消息」（见 onMessages 处的说明）
    const injected = segmentsToMessages(segments, getDisabledSegments())
    const messages = [...injected]

    let text = ''
    /*
     * 带图片附件的回合**强制走 Chat Completions**：
     * Responses 那条路本应用只用来拿 DeepSeek 的服务端 `web_search`，而 `/responses` 对
     * `input_image` 的支持面窄得多 —— 实测症状就是「界面里明明带着图，模型却说自己没收到附件」。
     * `image_url`（对象）是各家视觉模型都实现的通用形状，故带图时以「模型能看见图」优先，
     * 代价是这一轮没有服务端检索（可用本地 `web_fetch` 兜底）。
     */
    const useResponses = supportsResponsesWebSearch(cfg.baseUrl, cfg.model) && !hasImageAttachments(messages)
    /** @desc 是否因输出 token 触顶被截断（两种协议都会在这里收敛成 `true`） */
    let truncated = false
    /** @desc 是否正常收尾（工具轮次耗尽时仍为 `false`，需要向用户报告而不是假装完成） */
    let finished = false
    /** @desc 兜底：配置缺字段（老数据 / 手工构造）时不让循环次数变成 0 */
    const maxRounds = cfg.maxToolRounds || MAX_TOOL_ROUNDS
    /** @desc 长任务模式因轮次预算耗尽而停止（需要在收尾时明确告诉用户） */
    let longTaskHitLimit = false

    /**
     * @desc 模型输出停止时，若长任务模式开着就追加「继续推进」提示并让回合继续。
     * @returns `true` = 已安排继续（调用方应 `continue`）；`false` = 应当正常收尾。
     *
     * 续写提示用 `ephemeral` 标记：它会发给模型，但回传历史时被过滤掉，
     * 避免自动继续次数一多，历史里堆满「继续」。
     */
    const continueLongTask = (round: number, content: string): boolean => {
        const active = isLongTaskActive()
        const aborted = options.signal?.aborted === true
        if (!canAutoContinue({ active, aborted, nextRound: round + 1, maxRounds })) {
            if (active && !aborted) longTaskHitLimit = true
            return false
        }
        // 模型这一轮可能只有思考没有正文：仍要补一条 assistant 消息，保证续写有上下文
        messages.push({ role: 'assistant', content: content.trim() ? content : '（本轮没有正文输出）' })
        const count = getLongTaskContinuations() + 1
        const note = getLongTaskNote()
        messages.push({
            role: 'user',
            content: buildLongTaskContinuation(count, note),
            ephemeral: true
        })
        markLongTaskContinuation()
        emit({ type: 'longTask', message: `自动继续第 ${count} 次${note ? `：${note}` : ''}` })
        return true
    }

    beginTurn()
    try {
        for (let round = 0; round < maxRounds; round++) {
            if (useResponses) {
                const r = await runResponsesRound(cfg, messages, tools, toolContext, emit, options, systemPrompt)
                text = r.text
                if (isOutputTruncated(r.finishReason)) truncated = true
                // usage 优先取服务商上报；完全没有时用本地估算兜底
                recordRequestUsage(parseUsage(r.usage), {
                    promptTokens: estimateMessagesTokens(messages),
                    completionTokens: estimateTokens(r.text + r.reasoning)
                })
                if (r.done) {
                    if (continueLongTask(round, r.text)) continue
                    if (r.text.trim()) messages.push({ role: 'assistant', content: r.text })
                    finished = true
                    break
                }
                continue
            }

            const promptEstimate = estimateMessagesTokens(messages)
            const result = await chatCompletionStream(cfg.apiKey, messages, {
                tools,
                reasoningEffort: toReasoningEffort(cfg.thinkingLevel),
                baseUrl: cfg.baseUrl,
                model: cfg.model,
                signal: options.signal,
                maxOutputTokens: cfg.maxOutputTokens,
                direct: cfg.directRequest,
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

            if (isOutputTruncated(result.finishReason)) truncated = true
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
                    const seq = nextToolSeq()
                    emit({ type: 'tool', toolName: tc.name, toolArgs: args, seq })
                    const output = await runToolCall(toolContext, tc.name, args, options.signal)
                    emit({
                        type: 'tool',
                        toolName: tc.name,
                        toolArgs: args,
                        resultLen: output.length,
                        resultText: output,
                        seq
                    })
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: output })
                }
                continue
            }

            if (result.content?.trim()) {
                text = result.content
            }
            if (continueLongTask(round, result.content ?? '')) continue
            // 最终回复也写进历史：下一轮模型才知道自己上一轮回答了什么（原来只回传工具往返）
            if (result.content?.trim()) messages.push({ role: 'assistant', content: result.content })
            finished = true
            break
        }

        if (longTaskHitLimit) {
            emit({
                type: 'error',
                message: `长任务模式已达到轮次上限（${maxRounds}）并停止；可在 设置 → AI 配置 里调大「工具轮次上限」`
            })
        }
        if (!finished) {
            emit({
                type: 'error',
                message: `已达到轮次上限（${maxRounds}），本轮提前停止${isLongTaskActive() ? '（长任务模式已结束）' : ''}；可在 设置 → AI 配置 里调大「工具轮次上限」`
            })
        }
        if (truncated) {
            emit({
                type: 'error',
                message: `回复达到单次输出上限（${cfg.maxOutputTokens} token）被截断；可在 设置 → AI 配置 里调大「单次最大输出」`
            })
        }
        emit({ type: 'done', text })
        /*
         * 回传历史 = 「对话历史 + 本轮用户输入」两段的原文 + 本轮新产生的消息（assistant / tool 往返）。
         *
         * 刻意**不**按 `getDisabledSegments()` 过滤这两段：临时禁用分段是「这一轮不注入」的临时开关，
         * 不该因为它就把已积累的历史永久丢掉（否则用户勾一下「对话历史」，记忆就被清掉了）。
         */
        options.onMessages?.([
            ...segmentsToMessages(segments.filter((s) => PERSISTED_SEGMENT_IDS.includes(s.id))),
            // ephemeral = 长任务模式的「继续推进」提示：只在本回合发给模型，不进历史
            ...messages.slice(injected.length).filter((m) => !m.ephemeral)
        ])
        return { ok: true, text }
    } finally {
        // 无论成功 / 失败 / 中止都要收尾：停表并保留本轮汇总（下一轮开始时清空）
        finishTurn()
    }
}
