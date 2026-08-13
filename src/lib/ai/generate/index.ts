// Buff 集生成主循环（移植自 wuwa-afyg-share src/lib/ai/generate.ts）：工具轮询 → JSON 解析 → 清洗 → 自动修复
import { chatCompletionStream, type ChatMessage } from '../client'
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

export const MAX_TOOL_ROUNDS = 8
export const MAX_FIX_RETRY = 2

export interface GenerateBuffSetOptions {
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
    history?: ChatMessage[]
    newUserMessage?: string
    signal?: AbortSignal
    // 进度回调（每轮工具调用/解析结果）
    onProgress?: (text: string) => void
}

export interface GenerateBuffSetResult {
    buffs: GeneratedBuff[] | null
    rawContent: string
    parseError: string | null
}

export async function generateBuffSet(options: GenerateBuffSetOptions): Promise<GenerateBuffSetResult> {
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
    const progress = options.onProgress ?? (() => {})

    if (!apiKey) throw new Error('未配置 AI API Key')
    if (!ENTITY_TYPES.includes(entityType as GenerateEntityType)) throw new Error('无效的实体类型')
    if (!entityName) throw new Error('实体名不能为空')

    const toolContext = { entityType: entityType as GenerateEntityType, entityName, namingRule, slangDict, data }

    progress(`开始生成：${entityName}`)

    const systemContent = renderSystemPrompt(systemTemplate, { entityType, namingRule })
    const messages: ChatMessage[] = [{ role: 'system', content: systemContent }]
    const initialUser = renderInitialTaskPrompt(initialTaskTemplate, { entityType, entityName })
    messages.push({ role: 'user', content: initialUser })
    if (history.length > 0) messages.push(...history)
    if (newUserMessage) messages.push({ role: 'user', content: newUserMessage })

    let content = ''
    let fixCount = 0

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let result
        try {
            result = await chatCompletionStream(apiKey, messages, {
                tools: GENERATE_TOOLS,
                reasoningEffort,
                baseUrl: options.baseUrl,
                model: options.model,
                signal: options.signal,
                onDelta: () => {}
            })
        } catch (e) {
            throw e
        }

        // 有工具调用 → 执行并回喂
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
                let args: Record<string, unknown> = {}
                try {
                    args = tc.arguments ? JSON.parse(tc.arguments) : {}
                } catch {
                    args = {}
                }
                progress(`工具调用：${tc.name}`)
                let output: string
                try {
                    output = await executeGenerateTool(toolContext, tc.name, args)
                } catch (e) {
                    output = JSON.stringify({ error: e instanceof Error ? e.message : '工具执行失败' })
                }
                messages.push({ role: 'tool', tool_call_id: tc.id, content: output })
            }
            continue
        }

        // 无工具调用 → 尝试解析最终内容
        if (result.content?.trim()) {
            content = result.content
        }

        if (!content.trim()) {
            return { buffs: null, rawContent: content, parseError: 'AI 未返回内容' }
        }

        let buffs: GeneratedBuff[] | null = null
        let parseError: string | null = null
        try {
            const parsed = JSON.parse(content) as { buffs?: unknown[] }
            if (Array.isArray(parsed.buffs)) {
                buffs = sanitizeBuffs(parsed.buffs as GeneratedBuff[])
                if (buffs.length > 0) {
                    progress(`解析成功：${entityName} 得到 ${buffs.length} 条可用 Buff`)
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
            progress(`解析失败（${parseError}），自动修复第 ${fixCount}/${MAX_FIX_RETRY} 次`)
            content = ''
            continue
        }

        progress(`生成失败：${entityName}（${parseError}）`)
        return { buffs: null, rawContent: content, parseError }
    }

    progress(`超过最大工具轮数（${MAX_TOOL_ROUNDS}）`)
    return { buffs: null, rawContent: content, parseError: `超过最大工具轮数（${MAX_TOOL_ROUNDS}）` }
}
