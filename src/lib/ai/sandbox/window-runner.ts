/**
 * @desc `run_js` 的**真 window 路径**（WS 远程接管专用）。
 *
 * 与沙箱路径的根本差别：这里给的是**真 `window`**、**不注入任何工具**。
 * WS 远程接管按**无条件信任**的操作方处理（它本来就能 `exec` 全部工具），故不设沙箱 ——
 * 这是刻意的产品决定，不是遗漏。
 *
 * ⚠️ 代价（使用方需知）：页面 realm 里的死循环**无法中断** —— 不能像 Worker 那样 `terminate()`。
 * 超时只能让调用方拿到一条错误，脚本本身仍在跑。故 WS 侧调用时请自行避免长循环。
 */
import { buildScriptBody, toSerializable } from './format'
import type { RunScriptFn } from './protocol'

export const runInWindow: RunScriptFn = async ({ source }) => {
    try {
        const factory = new Function(buildScriptBody(source)) as () => unknown
        const value = await factory()
        return { ok: true, value: toSerializable(value), logs: [] }
    } catch (e) {
        return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), logs: [] }
    }
}
