/**
 * @desc `run_js` 的沙箱 ↔ 宿主消息契约与执行上限。
 *
 * 单独成文件的两个理由：
 * 1. Worker 与页面两侧共用同一份类型，避免消息形状漂移；
 * 2. 「哪些字段会跨进程」一眼可见 —— 跨进程的只有脚本文本、工具名、以及工具调用/结果，
 *    **没有任何密钥或宿主对象**。
 */

/** @desc 一次脚本执行的结果（结构化） */
export type RunScriptPayload =
    { ok: true; value: unknown; logs: string[]; truncated?: boolean } | { ok: false; error: string; logs: string[] }

/** @desc 宿主 → 沙箱 */
export type HostToSandbox =
    { type: 'run'; source: string; toolNames: string[] } | { type: 'tool-result'; callId: number; raw: string }

/** @desc 沙箱 → 宿主 */
export type SandboxToHost =
    | { type: 'tool-call'; callId: number; name: string; args: Record<string, unknown> }
    | { type: 'done'; payload: RunScriptPayload }

/**
 * @desc 工具调用桥：沙箱里调工具时由宿主实现。
 * 宿主侧必须是**真正的 `executeTool`** —— 于是危险工具照样弹确认、`requires` 能力校验照样生效。
 */
export type SandboxInvoke = (name: string, args: Record<string, unknown>) => Promise<string>

/** @desc 工具层看到的执行器签名（沙箱路径与真 window 路径同签名，由工具按上下文二选一） */
export interface RunScriptRequest {
    source: string
    /** @desc 仅沙箱路径：可注入到沙箱全局的工具名（宿主已按当前上下文能力过滤） */
    toolNames?: string[]
    /** @desc 仅沙箱路径：工具调用桥 */
    invoke?: SandboxInvoke
}

export type RunScriptResult = RunScriptPayload
export type RunScriptFn = (request: RunScriptRequest) => Promise<RunScriptResult>

/** @desc 单次脚本超时（到点由宿主 `worker.terminate()` 强杀） */
export const RUN_JS_TIMEOUT_MS = 20_000

/** @desc 单次脚本允许的工具调用次数上限（防脚本把确认弹窗刷爆 / 无限循环调工具） */
export const RUN_JS_MAX_TOOL_CALLS = 50

/** @desc `console` 日志条数上限 */
export const RUN_JS_MAX_LOGS = 200

/** @desc 返回值序列化后的字符上限（超出则退化成截断字符串，而不是把上下文撑爆） */
export const RUN_JS_MAX_OUTPUT_CHARS = 20_000
