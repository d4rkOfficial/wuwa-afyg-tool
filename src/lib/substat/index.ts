import type { AlgorithmId, SubstatCharacterAnalyzer, AlgorithmInfo } from './types'
import { ALGORITHMS_INFO } from './types'
import type { AnalysisInputs } from './shared'
import { prepareAnalysis } from './shared'
import { analyzeCharacterSubstats as singleLoss } from './single-loss'
import { analyzeCharacterSubstats as shapley } from './shapley'
import { analyzeCharacterSubstats as partialDerivative } from './partial-derivative'

/** @desc 算法表：单角色分析器（界面按角色分批算，AI/WS 用下面的全量包装） */
const analyzers: Record<AlgorithmId, SubstatCharacterAnalyzer> = {
    'single-loss': singleLoss,
    shapley,
    'partial-derivative': partialDerivative
}

const getAlgorithm = (id: AlgorithmId): SubstatCharacterAnalyzer => analyzers[id]

/** @desc 全量运行某个算法（逐角色） */
const computeSubstatContributions = (id: AlgorithmId, inputs: AnalysisInputs) =>
    prepareAnalysis(inputs).map((ctx) => analyzers[id](ctx))

export { analyzers, getAlgorithm, computeSubstatContributions, ALGORITHMS_INFO }
export type { AlgorithmId, AlgorithmInfo, SubstatCharacterAnalyzer }
