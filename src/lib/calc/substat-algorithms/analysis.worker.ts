/**
 * @desc 直伤贡献分析的 Worker 入口：只做「收请求 → 跑共用实现 → 回进度 / 结果 / 错误」。
 *
 * 计算全在 `./analysis` 里（`prepareContributionAnalysis` + `runContributionSteps`），
 * 与主线程回退路径同一份实现，因此两条路径的结果逐字段一致。
 *
 * 这里刻意不引 `DedicatedWorkerGlobalScope` 等 webworker lib 类型（项目 tsconfig 未引入），
 * 改用最小本地类型。
 */
import {
    prepareContributionAnalysis,
    runContributionSteps,
    type ContributionAnalysisMessage,
    type ContributionAnalysisReply
} from './analysis'

interface WorkerScope {
    onmessage: ((e: MessageEvent<ContributionAnalysisMessage>) => void) | null
    postMessage: (msg: ContributionAnalysisReply) => void
}

const scope = self as unknown as WorkerScope

/** @desc Worker 内也让出微任务：长任务期间主线程发来的新请求能被及时接收（不占界面帧） */
const yieldMicrotask = (): Promise<void> => Promise.resolve()

scope.onmessage = (e) => {
    const { id, algorithm, parts, ...req } = e.data
    void (async () => {
        try {
            const session = prepareContributionAnalysis(req)
            const result = await runContributionSteps(
                session,
                { algorithm, parts },
                (partial) => scope.postMessage({ id, kind: 'progress', partial }),
                yieldMicrotask
            )
            scope.postMessage({ id, kind: 'done', result })
        } catch (err) {
            scope.postMessage({ id, kind: 'done', error: err instanceof Error ? err.message : String(err) })
        }
    })()
}
