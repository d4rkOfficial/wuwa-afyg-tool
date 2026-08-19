import type { AlgorithmId, SubstatAlgorithm, AlgorithmInfo } from './types'
import { ALGORITHMS_INFO } from './types'
import { computeSubstatContributions as singleLoss } from './single-loss'
import { computeSubstatContributions as shapley } from './shapley'
import { computeSubstatContributions as partialDerivative } from './partial-derivative'

const algorithms: Record<AlgorithmId, SubstatAlgorithm> = {
    'single-loss': singleLoss,
    shapley: shapley,
    'partial-derivative': partialDerivative
}

function getAlgorithm(id: AlgorithmId): SubstatAlgorithm {
    return algorithms[id]
}

export { algorithms, getAlgorithm, ALGORITHMS_INFO }
export type { AlgorithmId, AlgorithmInfo }
