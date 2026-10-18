import type { AnalysisInputs, CharacterDamageContext } from './shared'
import type { CharSubstatAnalysis } from '../result.types'

export type AlgorithmId = 'single-loss' | 'shapley' | 'partial-derivative'

export interface AlgorithmInfo {
    id: AlgorithmId
    name: string
    description: string
}

/** @desc 单角色副词条贡献算法：入参是共用底座建好的角色上下文，返回该角色的完整分析结果 */
export type SubstatCharacterAnalyzer = (ctx: CharacterDamageContext) => CharSubstatAnalysis

/** @desc 全量副词条算法（逐角色跑同一个 analyzer）：供 AI/WS 与一次性同步计算使用 */
export type SubstatAlgorithm = (inputs: AnalysisInputs) => CharSubstatAnalysis[]

export const ALGORITHMS_INFO: AlgorithmInfo[] = [
    { id: 'single-loss', name: '单条损失', description: '移除该词条后损失的伤害值' },
    { id: 'shapley', name: 'Shapley值', description: '考虑词条间交互的公平贡献值' },
    { id: 'partial-derivative', name: '偏导数提升值', description: '当前属性点的边际提升近似' }
]
