// AI 工具注册表（独立于各领域工具，避免循环依赖）：schema 定义 + 执行器
import type { ChatToolCall } from '../client'
import type { AskUserFn } from './ask-user.types'
import type { WebFetchFn } from './web-fetch.types'

export interface ToolDefinition {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: Record<string, unknown>
    }
}

export interface ToolContext {
    onConfirm?: (toolName: string, message: string) => Promise<boolean>
    /**
     * @desc 向用户交互式提问（问题组）。**只有内置 AI 助手注入它** ——
     *  WS 远程接管没有交互界面（其 `onConfirm` 也只是无条件放行），故不注入；
     *  于是声明了 `requires: 'askUser'` 的工具在 WS 上下文里既不上清单、也无法被执行。
     */
    askUser?: AskUserFn
    /**
     * @desc 抓取网页正文（`web_fetch`）。**同样只有内置 AI 助手注入** ——
     *  抓取是借用宿主的网络位置发起出网请求，WS 远程接管刻意不提供
     *  （见 `$lib/ws-remote` 的 `wsCtx()`）；于是声明了 `requires: 'webFetch'` 的工具在 WS 上下文里
     *  既不上清单、也无法被执行。
     */
    webFetch?: WebFetchFn
    // AI 请求切换视图（team/timeline/calculation/config/result），由宿主提供
    requestView?: (phase: string) => void
    // 修改计算态后通知宿主持久化
    notifyCalc?: () => void
    // 长时间生成任务的进度回调（如 Buff 生成）
    onGenerateProgress?: (text: string) => void
}

export interface ToolHandler {
    dangerous?: boolean
    /**
     * @desc 该工具**依赖的宿主能力**：`ToolContext` 的字段名。
     *  缺省（undefined）= 任何上下文都能跑。
     *  声明后：`availableTools()` 会把它从清单里滤掉（当能力缺失时），
     *  `executeTool()` 也会直接返回明确错误 —— 两道都做，避免「清单里没有却仍能被 exec 调用」。
     *  现有用例：`ask_user` → `requires: 'askUser'`（WS 无法调用）。
     */
    requires?: keyof ToolContext
    handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown> | unknown
}

const definitions: ToolDefinition[] = []
const handlers = new Map<string, ToolHandler>()

export function defineTool(
    name: string,
    spec: {
        description: string
        parameters?: Record<string, unknown>
        dangerous?: boolean
        requires?: keyof ToolContext
        handler: ToolHandler['handler']
    }
): void {
    // 幂等注册：同名工具已存在时原地替换而非追加。模块级数组会在开发模式
    // HMR 重跑副作用模块（或同一模块被多入口重复求值）时叠加同名定义，
    // 部分提供商（如 xAI/Grok）会以 400「Duplicate function definition」拒绝
    const existing = definitions.find((d) => d.function.name === name)
    if (existing) {
        existing.function.description = spec.description
        existing.function.parameters = spec.parameters ?? { type: 'object', properties: {} }
    } else {
        definitions.push({
            type: 'function',
            function: {
                name,
                description: spec.description,
                parameters: spec.parameters ?? { type: 'object', properties: {} }
            }
        })
    }
    handlers.set(name, { dangerous: spec.dangerous, requires: spec.requires, handler: spec.handler })
}

/** @desc 全部工具定义（**不按能力过滤**）。用于文档生成、注册表单测等「只看清单」的场景。 */
export function buildTools(): ToolDefinition[] {
    return definitions
}

/**
 * @desc 当前上下文**真正可用**的工具清单：滤掉宿主未提供所需能力的工具。
 *  发给模型（`runAiTurn`）与 WS hello 都用它，避免「清单里有、调用必失败」。
 *  注意这是**白名单式过滤**：能力缺失就消失，而不是留在清单里等运行时报错。
 */
export function availableTools(ctx: ToolContext): ToolDefinition[] {
    return definitions.filter((d) => {
        const need = handlers.get(d.function.name)?.requires
        return !need || Boolean(ctx[need])
    })
}

/** @desc 该工具在当前上下文是否可用（`availableTools` 的单项版本，供 UI/测试查询） */
export function isToolAvailable(ctx: ToolContext, name: string): boolean {
    const need = handlers.get(name)?.requires
    return !need || Boolean(ctx[need])
}

/** @desc 工具声明所需的能力（undefined = 无要求），供文档/UI 展示 */
export function toolRequires(name: string): keyof ToolContext | undefined {
    return handlers.get(name)?.requires
}

export async function executeTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<string> {
    const handler = handlers.get(name)
    if (!handler) return JSON.stringify({ ok: false, error: `未知工具：${name}` })
    if (handler.requires && !ctx[handler.requires]) {
        // 与 availableTools 的双保险：清单过滤之外，直接调用也给出可读原因
        return JSON.stringify({
            ok: false,
            error: `当前上下文不支持工具 ${name}：缺少宿主能力 ${handler.requires}（该工具需要交互界面，远程接管通道无法调用）`
        })
    }
    if (handler.dangerous) {
        if (ctx.onConfirm) {
            const summary = describeArgs(args)
            const approved = await ctx.onConfirm(name, summary)
            if (!approved) return JSON.stringify({ ok: false, error: '用户拒绝了该操作', cancelled: true })
        }
    }
    try {
        const data = await handler.handler(args, ctx)
        return JSON.stringify({ ok: true, data: data ?? null })
    } catch (e) {
        return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
}

/** @desc 从工具输出 JSON 里提取「成功 / 失败 + 一行梗概」，供实时运行情况面板展示 */
export const summarizeToolOutput = (output: string): { ok?: boolean; summary: string } => {
    try {
        const parsed = JSON.parse(output) as { ok?: boolean; error?: string; cancelled?: boolean; data?: unknown }
        const ok = typeof parsed?.ok === 'boolean' ? parsed.ok : undefined
        if (ok === false) {
            const reason = parsed.cancelled ? '用户已取消' : (parsed.error ?? '执行失败')
            return { ok: false, summary: String(reason) }
        }
        return { ok, summary: `${output.length} 字符` }
    } catch {
        return { ok: undefined, summary: `${output.length} 字符` }
    }
}

function describeArgs(args: Record<string, unknown>): string {
    const parts = Object.entries(args ?? {})
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    return parts.length > 0 ? parts.join('，') : '（无参数）'
}

export type { ChatToolCall }
export type {
    AskUserAnswer,
    AskUserFn,
    AskUserOption,
    AskUserQuestion,
    AskUserQuestionType,
    AskUserRequest,
    AskUserResult
} from './ask-user.types'
export type { WebFetchFn, WebFetchFormat, WebFetchRequest, WebFetchResult } from './web-fetch.types'
