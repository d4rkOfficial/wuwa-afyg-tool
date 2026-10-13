/**
 * @desc `run_js` 的**沙箱路径**（内置 AI 助手专用）：把脚本丢进 Worker 执行。
 *
 * 这里只做三件事：开 Worker、把工具调用桥回宿主、管超时强杀。安全模型在 `sandbox.worker.ts` 里。
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

export const runInSandbox: RunScriptFn = async ({ source, toolNames = [], invoke }) => {
    if (typeof Worker === 'undefined') {
        return { ok: false, error: '当前环境不支持 Worker，无法执行脚本', logs: [] }
    }
    if (!invoke) {
        return { ok: false, error: '沙箱缺少工具调用桥，已拒绝执行', logs: [] }
    }

    let worker: Worker
    try {
        // Vite 的 worker 入口写法：必须是静态字符串字面量，构建期会拆成独立 chunk
        worker = new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module' })
    } catch (e) {
        return { ok: false, error: `无法创建沙箱 Worker：${e instanceof Error ? e.message : String(e)}`, logs: [] }
    }

    return await new Promise<RunScriptPayload>((resolve) => {
        let settled = false
        let timer: ReturnType<typeof setTimeout> | null = null
        const finish = (payload: RunScriptPayload): void => {
            if (settled) return
            settled = true
            if (timer !== null) clearTimeout(timer)
            // 无论成功失败都销毁 Worker：沙箱不留复用状态，下次执行必是全新 realm
            worker.terminate()
            resolve(payload)
        }

        timer = setTimeout(
            () => finish({ ok: false, error: `脚本执行超时（${RUN_JS_TIMEOUT_MS / 1000}s），沙箱已终止`, logs: [] }),
            RUN_JS_TIMEOUT_MS
        )

        worker.onmessage = (event: MessageEvent<SandboxToHost>) => {
            const message = event.data
            if (message.type === 'done') {
                finish(message.payload)
                return
            }
            if (message.type !== 'tool-call') return
            void (async () => {
                let raw: string
                try {
                    raw = await invoke(message.name, message.args)
                } catch (e) {
                    raw = JSON.stringify({ ok: false, error: e instanceof Error ? e.message : '工具执行失败' })
                }
                if (settled) return
                worker.postMessage({ type: 'tool-result', callId: message.callId, raw } satisfies HostToSandbox)
            })()
        }

        worker.onerror = (event: ErrorEvent) => {
            finish({ ok: false, error: `沙箱异常：${event.message || '未知错误'}`, logs: [] })
        }

        worker.postMessage({ type: 'run', source, toolNames: [...toolNames] } satisfies HostToSandbox)
    })
}
