import type { DamageEntry, BuffSet } from '../calculation.types'
import type { ConfigState } from '../config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { CharSubstatAnalysis } from '../result.types'
import type { ConditionProfile } from '../compute'
import type { AlgorithmId } from './types'
import { getAlgorithm } from './index'
import { getEchoSkillText, setEchoSkillText } from '$lib/data/char-info.svelte'

/** @desc 声骸词条贡献分析的入参：全部是可结构化克隆的纯数据（三个 id 集合用数组传，worker 内再转回 Set） */
export interface SubstatAnalysisRequest {
    algorithm: AlgorithmId
    damageEntries: DamageEntry[]
    buffSets: BuffSet[]
    damageEntryBuffSetIds: Record<string, string[]>
    damageEntryDamageTypes: Record<string, string[]>
    configState: ConfigState
    team: CharSlot[]
    charInfoMap: Record<string, CharacterInfo>
    weaponInfoMap: Record<string, WeaponInfo>
    rigCritEntryIds: string[]
    noCritEntryIds: string[]
    missEntryIds: string[]
    conditionProfile?: ConditionProfile
    /** @desc 主线程已解析好的声骸技能文案：compute 内部会读它做伤害类型推导，必须与主线程一致 */
    echoSkillText: Record<string, string>
}

/** @desc 发往 Worker 的请求（多一个 id 用于回包对号） */
export interface SubstatAnalysisMessage extends SubstatAnalysisRequest {
    id: number
}

/** @desc Worker 回包：analysis 与 error 二选一 */
export interface SubstatAnalysisResponse {
    id: number
    analysis?: CharSubstatAnalysis[]
    error?: string
}

/** @desc 真正执行词条贡献分析：Worker 线程与主线程回退共用这一份实现，保证两条路径结果完全一致 */
export function runSubstatAnalysis(req: SubstatAnalysisRequest): CharSubstatAnalysis[] {
    // compute 内部通过 store 读声骸技能文案：worker 里先注入主线程送来的映射；
    // 主线程回退时传进来的就是同一个对象，引用一致则跳过写入，避免无谓触发 $state 重算
    if (getEchoSkillText() !== req.echoSkillText) setEchoSkillText(req.echoSkillText)
    return getAlgorithm(req.algorithm)(
        req.damageEntries,
        req.buffSets,
        req.damageEntryBuffSetIds,
        req.damageEntryDamageTypes,
        req.configState,
        req.team,
        req.charInfoMap,
        req.weaponInfoMap,
        new Set(req.rigCritEntryIds),
        new Set(req.noCritEntryIds),
        new Set(req.missEntryIds),
        req.conditionProfile
    )
}
