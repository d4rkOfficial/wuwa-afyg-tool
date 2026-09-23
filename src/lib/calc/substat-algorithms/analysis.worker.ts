/**
 * @desc 声骸词条贡献分析的 Worker 入口：只做「收请求 → 跑共用实现 → 回结果/错误」，
 *  计算逻辑全在 ./analysis 的 runSubstatAnalysis 里，与主线程回退路径共用，保证结果一致。
 *  这里刻意不使用 DedicatedWorkerGlobalScope 等 webworker lib 类型（项目 tsconfig 未引入），改用最小本地类型。
 */
import { runSubstatAnalysis, type SubstatAnalysisMessage, type SubstatAnalysisResponse } from './analysis'

interface WorkerScope {
    onmessage: ((e: MessageEvent<SubstatAnalysisMessage>) => void) | null
    postMessage: (msg: SubstatAnalysisResponse) => void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (e) => {
    const { id, ...req } = e.data
    try {
        scope.postMessage({ id, analysis: runSubstatAnalysis(req) })
    } catch (err) {
        scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
    }
}
