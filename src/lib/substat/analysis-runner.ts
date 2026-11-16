import {
    prepareContributionAnalysis,
    runContributionSteps,
    type ContributionAnalysisOptions,
    type ContributionAnalysisRequest,
    type ContributionAnalysisResult,
    type ContributionProgress
} from './analysis'

/**
 * @desc 直伤贡献分析的**主线程回退路径**（不启 Worker）。
 *
 * 界面正常走 `analysis-runner.svelte.ts` 的 Worker 线程；只有「环境没有 Worker」「Worker 创建失败」
 * 「Worker 运行出错」时才落到这里。计算实现与 Worker 内完全同一份（`runContributionSteps`），
 * 差别只是每片之间让出真实帧 —— 否则一次性跑完会让弹窗白屏。
 */

/** @desc 让出一帧：先渲染「计算中…」，再开始下一片重算 */
const yieldFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

export const runContributionAnalysisAsync = async (
    req: ContributionAnalysisRequest,
    options: ContributionAnalysisOptions,
    onProgress?: ContributionProgress
): Promise<ContributionAnalysisResult> => {
    // 基线（`prepare`）本身也是几十毫秒的同步活，先让一帧再算，调用方刚渲染的「计算中…」才画得出来
    await yieldFrame()
    const session = prepareContributionAnalysis(req)
    return runContributionSteps(session, options, onProgress, yieldFrame)
}
