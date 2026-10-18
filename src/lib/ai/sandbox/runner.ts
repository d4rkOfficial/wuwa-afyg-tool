/**
 * @desc `run_js` 的**沙箱路径**（内置 AI 助手专用）：把脚本丢进持久 Worker 执行。
 *
 * 这里只做四件事：复用/创建 Worker、把工具调用桥回宿主、管超时强杀、串行化多次调用。
 *
 * 为什么 Worker 要**跨调用复用**：脚本可以用 `globalThis.myFn = () => …` 定义可复用函数，
 * 下一次任务不必重复定义。每次调用都新建 Worker 会让 `globalThis` 每次归零，这正是旧实现的行为。
 * 复用的代价：Worker 内的全局状态会一直保留到页面刷新 / 超时强杀；超时或沙箱异常后旧 Worker 会被
 * `terminate()`，下一次调用自动重建（此时全局状态丢失是预期行为）。
 *
 * 工具调用必须由调用方（工具层）用**真正的 `executeTool`** 实现 `invoke` ——
 * 于是危险工具照样弹确认、`requires` 能力校验照样生效，脚本绕不过去。
 */
import {
    RUN_JS_TIMEOUT_MS,
    type HostToSandbox,
    type RunScriptFn,
    type RunScriptPayload,
    type SandboxToHost
} from './protocol'

interface ActiveRun {
    resolve: (payload: RunScriptPayload) => void
    invoke: (name: string, args: Record<string, unknown>) => Promise<string>
    timer: ReturnType<typeof setTimeout>
}

/** @desc 当前复用的沙箱 Worker（null = 尚未创建 / 已被超时强杀） */
let worker: Worker | null = null
/** @desc 当前正在执行的调用（同一时刻只有一个，队列串行化） */
let active: ActiveRun | null = null
/** @desc 调用队列：run_js 可能被并行调用，Worker 同一时刻只能跑一个脚本 */
let queue: Promise<unknown> = Promise.resolve()

const terminateWorker = (): void => {
    if (!worker) return
    worker.terminate()
    worker = null
}

/**
 * @desc 结束当前调用。
 * @param terminate `true` = 沙箱已不可信/已超时，销毁 Worker（下次调用重建，全局状态丢失）。
 */
const settle = (payload: RunScriptPayload, terminate = false): void => {
    const run = active
    if (!run) return
    active = null
    clearTimeout(run.timer)
    if (terminate) terminateWorker()
    run.resolve(payload)
}

/** @desc 惰性创建并复用 Worker；消息回调只认 active 这一次调用 */
const ensureWorker = (): Worker => {
    if (worker) return worker
    const created = new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module' })
    created.onmessage = (event: MessageEvent<SandboxToHost>) => {
        const message = event.data
        if (message.type === 'done') {
            settle(message.payload)
            return
        }
        if (message.type !== 'tool-call') return
        const run = active
        if (!run) return
        void (async () => {
            let raw: string
            try {
                raw = await run.invoke(message.name, message.args)
            } catch (e) {
                raw = JSON.stringify({ ok: false, error: e instanceof Error ? e.message : '工具执行失败' })
            }
            // 超时/异常后 active 已被清空：旧脚本的结果不能再投递给新调用
            if (active !== run || !worker) return
            worker.postMessage({ type: 'tool-result', callId: message.callId, raw } satisfies HostToSandbox)
        })()
    }
    created.onerror = (event: ErrorEvent) => {
        const payload: RunScriptPayload = { ok: false, error: `沙箱异常：${event.message || '未知错误'}`, logs: [] }
        if (active) settle(payload, true)
        // 空闲 Worker 自身报错时也要销毁，下一次调用重建，避免复用坏 Worker
        else terminateWorker()
    }
    worker = created
    return created
}

const runOnce = async (request: Parameters<RunScriptFn>[0]): Promise<RunScriptPayload> => {
    const { source, toolNames = [], invoke } = request
    if (typeof Worker === 'undefined') {
        return { ok: false, error: '当前环境不支持 Worker，无法执行脚本', logs: [] }
    }
    if (!invoke) {
        return { ok: false, error: '沙箱缺少工具调用桥，已拒绝执行', logs: [] }
    }

    let target: Worker
    try {
        target = ensureWorker()
    } catch (e) {
        return { ok: false, error: `无法创建沙箱 Worker：${e instanceof Error ? e.message : String(e)}`, logs: [] }
    }

    return await new Promise<RunScriptPayload>((resolve) => {
        const timer = setTimeout(
            () =>
                settle(
                    {
                        ok: false,
                        error: `脚本执行超时（${RUN_JS_TIMEOUT_MS / 1000}s），沙箱已终止（globalThis 已重置）`,
                        logs: []
                    },
                    true
                ),
            RUN_JS_TIMEOUT_MS
        )
        active = { resolve, invoke, timer }
        try {
            target.postMessage({ type: 'run', source, toolNames: [...toolNames] } satisfies HostToSandbox)
        } catch (e) {
            settle({ ok: false, error: `无法启动脚本：${e instanceof Error ? e.message : String(e)}`, logs: [] }, true)
        }
    })
}

export const runInSandbox: RunScriptFn = (request) => {
    // 串行化：一个持久 Worker 同一时刻只能跑一个脚本；前一个结束（成功/失败/超时）后再跑下一个
    const next = queue.then(() => runOnce(request))
    queue = next.then(
        () => undefined,
        () => undefined
    )
    return next
}
