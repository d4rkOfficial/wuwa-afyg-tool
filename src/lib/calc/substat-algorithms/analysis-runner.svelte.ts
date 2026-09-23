import type { CharSubstatAnalysis } from '../result.types'
import {
    runSubstatAnalysis,
    type SubstatAnalysisMessage,
    type SubstatAnalysisRequest,
    type SubstatAnalysisResponse
} from './analysis'

export type SubstatAnalysisMode = 'worker' | 'main'

interface Pending {
    req: SubstatAnalysisRequest
    resolve: (v: CharSubstatAnalysis[]) => void
    reject: (e: unknown) => void
}

/**
 * @desc 声骸词条贡献分析执行器：优先丢到 Worker 线程算（Shapley / 偏导这类重算不再阻塞界面），
 *  只有在「环境不支持 Worker」「Worker 创建失败」「Worker 运行出错」时才回退主线程，
 *  且回退走的是同一份 runSubstatAnalysis 实现，结果与 worker 路径一致。
 */
export const createSubstatAnalysisRunner = () => {
    let worker: Worker | null = null
    /** @desc Worker 不可用（不支持/创建失败/自毁）：后续请求直接走主线程，不再尝试创建 */
    let workerUnavailable = false
    let seq = 0
    const pending = new Map<number, Pending>()

    /** @desc 主线程回退：让出一帧再算，避免和当前点击/滚动挤在同一帧；直接用原对象（不克隆） */
    const runOnMain = (req: SubstatAnalysisRequest) =>
        new Promise<CharSubstatAnalysis[]>((resolve, reject) => {
            setTimeout(() => {
                try {
                    resolve(runSubstatAnalysis(req))
                } catch (err) {
                    reject(err)
                }
            }, 0)
        })

    /** @desc Worker 挂掉：终止它、把在途请求全部改走主线程 */
    const handleWorkerFailure = (err: unknown) => {
        const inflight = [...pending.values()]
        pending.clear()
        workerUnavailable = true
        worker?.terminate()
        worker = null
        console.warn('[substat-analysis] Worker 不可用，回退主线程计算', err)
        for (const p of inflight) runOnMain(p.req).then(p.resolve, p.reject)
    }

    const ensureWorker = (): Worker | null => {
        if (workerUnavailable) return null
        if (worker) return worker
        if (typeof Worker === 'undefined') {
            workerUnavailable = true
            console.warn('[substat-analysis] 当前环境没有 Worker，回退主线程计算')
            return null
        }
        try {
            const w = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
            w.onmessage = (e: MessageEvent<SubstatAnalysisResponse>) => {
                const res = e.data
                const p = pending.get(res.id)
                if (!p) return
                pending.delete(res.id)
                if (res.error) p.reject(new Error(res.error))
                else p.resolve(res.analysis ?? [])
            }
            w.onerror = (e) => handleWorkerFailure(e)
            w.onmessageerror = (e) => handleWorkerFailure(e)
            worker = w
            console.info('[substat-analysis] 词条贡献分析使用 Worker 线程计算')
            return w
        } catch (err) {
            workerUnavailable = true
            console.warn('[substat-analysis] 创建 Worker 失败，回退主线程计算', err)
            return null
        }
    }

    /** @desc 当前实际执行方式（worker 尚未创建时按「将要使用 worker」返回） */
    const getMode = (): SubstatAnalysisMode => (workerUnavailable ? 'main' : 'worker')

    const run = (req: SubstatAnalysisRequest): Promise<CharSubstatAnalysis[]> => {
        const w = ensureWorker()
        if (!w) return runOnMain(req)
        const id = ++seq
        return new Promise<CharSubstatAnalysis[]>((resolve, reject) => {
            pending.set(id, { req, resolve, reject })
            // 发往 Worker 前快照成纯数据：store 里可能是 $state 代理，结构化克隆需要普通对象
            const msg: SubstatAnalysisMessage = { ...($state.snapshot(req) as SubstatAnalysisRequest), id }
            try {
                w.postMessage(msg)
            } catch (err) {
                pending.delete(id)
                // 结构化克隆失败等发送期错误：同样回退主线程
                console.warn('[substat-analysis] Worker 消息发送失败，回退主线程计算', err)
                runOnMain(req).then(resolve, reject)
            }
        })
    }

    const dispose = () => {
        worker?.terminate()
        worker = null
        pending.clear()
    }

    return { run, dispose, getMode }
}

export type SubstatAnalysisRunner = ReturnType<typeof createSubstatAnalysisRunner>
