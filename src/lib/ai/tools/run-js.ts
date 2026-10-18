// run_js：让 AI 在**沙箱**里做计算与批量调工具；WS 远程接管则在真 window 里跑（无沙箱、不注入工具）。
// 两条路径的差别由**上下文能力**决定（`ctx.sandboxRun` / `ctx.windowRun`），而不是工具参数 ——
// 于是模型无法通过传参把自己提升到「真 window」那条路径上。
import { availableTools, defineTool, executeTool } from './registry'
import type { RunScriptFn, RunScriptResult } from '../sandbox/protocol'
import {
    RUN_JS_MAX_ERROR_CHARS,
    RUN_JS_MAX_OUTPUT_CHARS,
    RUN_JS_MAX_TOOL_CALLS,
    RUN_JS_TIMEOUT_MS
} from '../sandbox/protocol'
import { truncateText } from '../sandbox/format'

const str = (v: unknown): string => String(v ?? '').trim()

/**
 * @desc 可注入沙箱全局的工具名。
 * **排除 `run_js` 自身** —— 否则脚本能递归开新沙箱，绕过工具调用次数上限。
 * 用 `availableTools(ctx)` 而非全量清单：宿主缺能力（如 WS 无 `askUser`）的工具不该出现在沙箱里，
 * 那与本上下文发给模型的清单保持一致（避免「清单里没有、脚本里却能调」）。
 *
 * 注：这里的 `'run_js'` 与下面 `defineTool('run_js', …)` 是**同一名字的两处字面量**，
 * 刻意不抽成常量 —— `scripts/generate-tools-doc.mjs` 是**源码文本解析**，只认字符串字面量，
 * 抽成常量会让该工具被静默漏出文档（实测踩过）。两者的同步由
 * `test/src/lib/ai/tools/run-js.test.ts` 的「toolNames 不含 run_js」断言守住。
 */
const injectableNames = (ctx: Parameters<typeof availableTools>[0]): string[] =>
    availableTools(ctx)
        .map((d) => d.function.name)
        .filter((name) => name !== 'run_js')

/** @desc 把执行结果转成工具返回值；失败时 throw（registry 会转成 `ok:false`），并带上脚本日志 */
const toToolOutput = (result: RunScriptResult): { value: unknown; logs: string[]; truncated?: boolean } => {
    if (!result.ok) {
        const logText = result.logs.length > 0 ? `\n--- 脚本日志 ---\n${result.logs.join('\n')}` : ''
        // 报错 + 日志合并后再按报错预算截断：错误输出同样要有上限
        throw new Error(truncateText(`${result.error}${logText}`, RUN_JS_MAX_ERROR_CHARS).text)
    }
    return { value: result.value, logs: result.logs, ...(result.truncated ? { truncated: true } : {}) }
}

defineTool('run_js', {
    description: [
        '在沙箱里执行一段 JavaScript 并返回结果，用于**批量计算**与**一次脚本内连续调用多个工具**',
        '（比逐个工具往返省很多轮）。',
        '',
        '用法要点：',
        '- 直接写语句即可（不要自己包 async 函数），可以用**顶层 await** 调工具，例如 `const t = await get_team({})`。',
        '- 所有可用工具都注入为全局函数，也可写成 `tools.get_team(...)`；返回值就是该工具的 data（JSON 已解开），失败会 throw。',
        '- **globalThis 跨调用保留**：可以用 `globalThis.myHelper = (x) => …` 定义可复用函数/常量，下次 run_js 直接调用，不必重复定义；超时强杀或刷新页面后重置。',
        '- 用 `return` 交出结果；`console.log` 的输出会一并回传（适合看中间过程）。',
        '- 抓网页/调接口直接用**同名工具 `web_fetch`**：`await web_fetch({ url, method, headers, body, json })`，返回 url / status / headers / content / truncated。它走宿主抓取能力（SSRF 校验照常），不是浏览器的真 fetch；只有宿主提供该能力时才会出现在工具清单里。',
        '- 脚本跑在 Worker 沙箱里：没有 DOM、没有网络、没有存储，也拿不到密钥；',
        '  但**工具调用仍会经过正常的权限确认** —— 危险工具该问还是会问，绕不过去。',
        `- 上限：${RUN_JS_MAX_TOOL_CALLS} 次工具调用 / ${RUN_JS_TIMEOUT_MS / 1000}s 超时 / 输出 ${RUN_JS_MAX_OUTPUT_CHARS} 字符。`,
        '- 沙箱里没有 `run_js` 自己，不能递归调用。'
    ].join('\n'),
    parameters: {
        type: 'object',
        properties: {
            code: {
                type: 'string',
                description: '要执行的脚本体。例如：`const t = await get_team({}); return t.members.length`'
            }
        },
        required: ['code']
    },
    handler: async (args, ctx) => {
        const source = str(args.code)
        if (!source) throw new Error('缺少 code')

        // AI 路径：Worker 沙箱 + 注入工具；工具调用桥回真正的 executeTool（危险操作照样确认）
        const sandboxRun: RunScriptFn | undefined = ctx.sandboxRun
        if (sandboxRun) {
            return toToolOutput(
                await sandboxRun({
                    source,
                    toolNames: injectableNames(ctx),
                    invoke: (name, toolArgs) => executeTool(ctx, name, toolArgs)
                })
            )
        }

        // WS 路径：真 window、不注入工具（远程接管按无条件信任处理）
        const windowRun: RunScriptFn | undefined = ctx.windowRun
        if (windowRun) return toToolOutput(await windowRun({ source }))

        throw new Error('当前上下文不支持 run_js：既没有沙箱运行器，也没有窗口运行器')
    }
})
