import type { DamageEntry, BuffSet } from '../../calculation/calculation.types'
import type { ConfigState } from '../../config/config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/data/types'
import type { CharSubstatAnalysis } from '../result.types'

export type AlgorithmId = 'single-loss' | 'shapley' | 'partial-derivative'

export interface AlgorithmInfo {
    id: AlgorithmId
    name: string
    description: string
}

export type SubstatAlgorithm = (
    damageEntries: DamageEntry[],
    buffSets: BuffSet[],
    damageEntryBuffSetIds: Record<string, string[]>,
    damageEntryDamageTypes: Record<string, string[]>,
    configState: ConfigState,
    team: CharSlot[],
    charInfoMap: Record<string, CharacterInfo>,
    weaponInfoMap: Record<string, WeaponInfo>,
    rigCritEntryIds: Set<string>
) => CharSubstatAnalysis[]

export const ALGORITHMS_INFO: AlgorithmInfo[] = [
    { id: 'single-loss', name: '单条损失', description: '移除该词条后损失的伤害值' },
    { id: 'shapley', name: 'Shapley值', description: '考虑词条间交互的公平贡献值' },
    { id: 'partial-derivative', name: '偏导数提升值', description: '当前属性点的边际提升近似' }
]
