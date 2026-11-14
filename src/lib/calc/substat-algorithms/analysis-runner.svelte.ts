import { runContributionAnalysisAsync } from './analysis-runner'
import type {
    ContributionAnalysisMessage,
    ContributionAnalysisOptions,
    ContributionAnalysisReply,
    ContributionAnalysisRequest,
    ContributionAnalysisResult,
    ContributionProgress
} from './analysis'

export type ContributionRunnerMode = 'worker' | 'main'

interface Pending {
    req: ContributionAnalysisRequest
    options: ContributionAnalysisOptions
    onProgress?: ContributionProgress
    resolve: (v: ContributionAnalysisResult) => void
    reject: (e: unknown) => void
}

/**
 * @desc 直伤贡献分析的执行器：**优先丢进 Worker 线程**（副词条 Shapley 与 Buff 逐条移除都是
 * 上千次引擎重算，放主线程必然卡界面），只有「环境不支持 Worker」「创建失败」「Worker 出错」
 * 才回退主线程分片（`analysis-runner.ts`），两条路径共用 `./analysis` 的实现，结果一致。
 *
 * 请求里可能有 `$state` 代理（store 里的 Buff / 配置），发往 Worker 前用 `$state.snapshot`
 * 快照成纯数据；主线程回退直接用原对象（不克隆，避免无谓开销）。
 */
export const createContributionAnalysisRunner = () => {
    let worker: Worker | null = null
    /** @desc Worker 不可用（不支持 / 创建失败 / 自毁）：后续请求直接走主线程，不再尝试创建 */
    let workerUnavailable = false
    let seq = 0
    const pending = new Map<number, Pending>()

    const runOnMain = (p: Pending): Promise<ContributionAnalysisResult> =>
        runContributionAnalysisAsync(p.req, p.options, p.onProgress)

    /** @desc Worker 挂掉：终止它，把在途请求全部改走主线程 */
    const handleWorkerFailure = (err: unknown) => {
        const inflight = [...pending.values()]
        pending.clear()
        workerUnavailable = true
        worker?.terminate()
        worker = null
        console.warn('[contribution-analysis] Worker 不可用，回退主线程计算', err)
        for (const p of inflight) runOnMain(p).then(p.resolve, p.reject)
    }

    const ensureWorker = (): Worker | null => {
        if (workerUnavailable) return null
        if (worker) return worker
        if (typeof Worker === 'undefined') {
            workerUnavailable = true
            console.warn('[contribution-analysis] 当前环境没有 Worker，回退主线程计算')
            return null
        }
        try {
            const created = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
            created.onmessage = (e: MessageEvent<ContributionAnalysisReply>) => {
                const reply = e.data
                const p = pending.get(reply.id)
                if (!p) return
                if (reply.kind === 'progress') {
                    p.onProgress?.(reply.partial)
                    return
                }
                pending.delete(reply.id)
                if (reply.error) p.reject(new Error(reply.error))
                else p.resolve(reply.result ?? { substat: [], buff: [] })
            }
            created.onerror = (e) => handleWorkerFailure(e)
            created.onmessageerror = (e) => handleWorkerFailure(e)
            worker = created
            return created
        } catch (err) {
            workerUnavailable = true
            console.warn('[contribution-analysis] 创建 Worker 失败，回退主线程计算', err)
            return null
        }
    }

    /** @desc 当前实际执行方式（Worker 尚未创建时按「将要使用 Worker」返回） */
    const getMode = (): ContributionRunnerMode => (workerUnavailable ? 'main' : 'worker')

    const run = (
        req: ContributionAnalysisRequest,
        options: ContributionAnalysisOptions,
        onProgress?: ContributionProgress
    ): Promise<ContributionAnalysisResult> => {
        const created = ensureWorker()
        if (!created) return runContributionAnalysisAsync(req, options, onProgress)
        const id = ++seq
        return new Promise<ContributionAnalysisResult>((resolve, reject) => {
            const entry: Pending = { req, options, ...(onProgress ? { onProgress } : {}), resolve, reject }
            pending.set(id, entry)
            const message: ContributionAnalysisMessage = {
                ...($state.snapshot(req) as ContributionAnalysisRequest),
                id,
                algorithm: options.algorithm,
                parts: options.parts ?? ['substat', 'buff']
            }
            try {
                created.postMessage(message)
            } catch (err) {
                // 结构化克隆失败等发送期错误：同样回退主线程
                pending.delete(id)
                console.warn('[contribution-analysis] Worker 消息发送失败，回退主线程计算', err)
                runOnMain(entry).then(resolve, reject)
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

export type ContributionAnalysisRunner = ReturnType<typeof createContributionAnalysisRunner>
