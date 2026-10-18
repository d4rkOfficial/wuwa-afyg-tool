import type { CharBuffAnalysis, CharSubstatAnalysis } from '../result.types'
import type { AlgorithmId } from './types'
import {
    prepareContributionAnalysis,
    type ContributionAnalysisRequest,
    type ContributionAnalysisSession
} from './analysis'

/**
 * @desc 直伤贡献分析的**主线程分片执行器**（不再使用 Worker）。
 *
 * 重算本身是同步 CPU 活（Shapley 要枚举 2ᵏ 个子集），一次性跑完会让弹窗白屏；
 * 这里按「角色」切片，每片之间让出一帧，于是：
 * - 打开弹窗时先显示「计算中…」，再逐角色填充结果；
 * - AI / WS 直接调用 `analysis.ts` 的同步实现，不需要这条路径。
 */

export type ContributionPart = 'substat' | 'buff'

export interface ContributionAnalysisOptions {
    algorithm: AlgorithmId
    /** @desc 需要计算的部分（默认两者）；切换算法时只重算副词条 */
    parts?: ContributionPart[]
}

export interface ContributionAnalysisResult {
    substat: CharSubstatAnalysis[]
    buff: CharBuffAnalysis[]
}

export type ContributionProgress = (partial: ContributionAnalysisResult) => void

/** @desc 让出一帧：先渲染「计算中…」，再开始下一片重算 */
const yieldFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

export const runContributionAnalysisAsync = async (
    req: ContributionAnalysisRequest,
    options: ContributionAnalysisOptions,
    onProgress?: ContributionProgress
): Promise<ContributionAnalysisResult> => {
    const parts = options.parts ?? ['substat', 'buff']
    const wantsSubstat = parts.includes('substat')
    const wantsBuff = parts.includes('buff')
    const session: ContributionAnalysisSession = prepareContributionAnalysis(req)
    const result: ContributionAnalysisResult = { substat: [], buff: [] }

    for (let i = 0; i < session.characters.length; i++) {
        await yieldFrame()
        if (wantsSubstat) result.substat.push(session.analyzeSubstat(i, options.algorithm))
        if (wantsBuff) result.buff.push(session.analyzeBuff(i))
        onProgress?.({ substat: [...result.substat], buff: [...result.buff] })
    }
    return result
}
