// AI 工具注册表（独立于各领域工具，避免循环依赖）：schema 定义 + 执行器
import type { ChatToolCall } from '../client'

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
    // AI 请求切换视图（team/timeline/calculation/config/result），由宿主提供
    requestView?: (phase: string) => void
    // 修改计算态后通知宿主持久化
    notifyCalc?: () => void
    // 长时间生成任务的进度回调（如 Buff 集生成）
    onGenerateProgress?: (text: string) => void
}

export interface ToolHandler {
    dangerous?: boolean
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
        handler: ToolHandler['handler']
    }
): void {
    definitions.push({
        type: 'function',
        function: {
            name,
            description: spec.description,
            parameters: spec.parameters ?? { type: 'object', properties: {} }
        }
    })
    handlers.set(name, { dangerous: spec.dangerous, handler: spec.handler })
}

export function buildTools(): ToolDefinition[] {
    return definitions
}

export async function executeTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<string> {
    const handler = handlers.get(name)
    if (!handler) return JSON.stringify({ ok: false, error: `未知工具：${name}` })
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

function describeArgs(args: Record<string, unknown>): string {
    const parts = Object.entries(args ?? {})
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    return parts.length > 0 ? parts.join('，') : '（无参数）'
}

export type { ChatToolCall }
