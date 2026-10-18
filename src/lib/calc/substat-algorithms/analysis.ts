import type { BuffConf, DamageEntry } from '../calculation.types'
import type { ConfigState } from '../config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { CharBuffAnalysis, CharContributionAnalysis, CharSubstatAnalysis } from '../result.types'
import { DEFAULT_CONDITION_PROFILE, type ConditionProfile } from '../compute'
import type { AlgorithmId } from './types'
import { getAlgorithm, ALGORITHMS_INFO } from './index'
import { prepareAnalysis, type AnalysisInputs, type CharacterDamageContext } from './shared'
import { analyzeCharacterBuffs } from './buff-contribution'
import { buildEchoDescByEntry } from '../skill-infer'
import { getEchoSkillText, setEchoSkillText } from '$lib/data/char-info.svelte'

/**
 * @desc 直伤贡献分析的入口（**纯函数 + 同步**，主线程直接算）。
 *
 * 曾经这套计算放在 Worker 里（`analysis.worker.ts` + runner 回退）；现在取消 Worker：
 * - 界面按角色分批让出主线程（见 `analysis-runner.ts`），不会一次性卡死；
 * - AI / WS 工具直接调用同一份同步实现，不再需要「开 worker / 序列化 / 回退」三条路径。
 */
export interface ContributionAnalysisRequest {
    damageEntries: DamageEntry[]
    buffSets: BuffConf[]
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

/** @desc 副词条分析请求：多一个算法 id */
export interface SubstatAnalysisRequest extends ContributionAnalysisRequest {
    algorithm: AlgorithmId
}

/** @desc 分析会话：基线只算一次，之后逐角色 / 逐算法复用 */
export interface ContributionAnalysisSession {
    characters: CharacterDamageContext[]
    /** @desc 该角色的副词条贡献（算法可切换，复用同一份基线） */
    analyzeSubstat: (index: number, algorithm: AlgorithmId) => CharSubstatAnalysis
    /** @desc 该角色的 Buff 贡献（算法无关） */
    analyzeBuff: (index: number) => CharBuffAnalysis
}

const toInputs = (req: ContributionAnalysisRequest): AnalysisInputs => ({
    damageEntries: req.damageEntries,
    buffSets: req.buffSets,
    damageEntryBuffSetIds: req.damageEntryBuffSetIds,
    damageEntryDamageTypes: req.damageEntryDamageTypes,
    configState: req.configState,
    team: req.team,
    charInfoMap: req.charInfoMap,
    weaponInfoMap: req.weaponInfoMap,
    rigCritEntryIds: new Set(req.rigCritEntryIds),
    noCritEntryIds: new Set(req.noCritEntryIds),
    missEntryIds: new Set(req.missEntryIds),
    conditionProfile: req.conditionProfile ?? DEFAULT_CONDITION_PROFILE
})

/**
 * @desc 准备分析会话：注入声骸技能文案（compute 内部通过 store 读取），并把基线算好。
 *
 * 引用一致时跳过注入，避免无谓触发 `$state` 重算。
 */
export const prepareContributionAnalysis = (req: ContributionAnalysisRequest): ContributionAnalysisSession => {
    if (getEchoSkillText() !== req.echoSkillText) setEchoSkillText(req.echoSkillText)
    const inputs = toInputs(req)
    const characters = prepareAnalysis(inputs)
    /** @desc 伤害类型推导所需的声骸文案索引：整批条目建一次，Buff 生效集合与引擎同口径 */
    const echoDescByEntry = buildEchoDescByEntry(req.damageEntries, req.team, req.echoSkillText)
    return {
        characters,
        analyzeSubstat: (index, algorithm) => getAlgorithm(algorithm)(characters[index]),
        analyzeBuff: (index) => analyzeCharacterBuffs(characters[index], inputs, echoDescByEntry)
    }
}

/** @desc 全量副词条分析（单算法，逐角色） */
export const runSubstatAnalysis = (req: SubstatAnalysisRequest): CharSubstatAnalysis[] => {
    const session = prepareContributionAnalysis(req)
    return session.characters.map((_, i) => session.analyzeSubstat(i, req.algorithm))
}

/** @desc 全量 Buff 贡献分析（算法无关，逐角色） */
export const runBuffAnalysis = (req: ContributionAnalysisRequest): CharBuffAnalysis[] => {
    const session = prepareContributionAnalysis(req)
    return session.characters.map((_, i) => session.analyzeBuff(i))
}

/** @desc 副词条 + Buff 一起算（每角色一次）：AI / WS 的「数据分析」一次性取全 */
export const runContributionAnalysis = (
    req: ContributionAnalysisRequest,
    algorithms: AlgorithmId[] = ALGORITHMS_INFO.map((a) => a.id)
): {
    substat: Record<string, CharSubstatAnalysis[]>
    buff: CharBuffAnalysis[]
    characters: CharContributionAnalysis[]
} => {
    const session = prepareContributionAnalysis(req)
    const indexes = session.characters.map((_, i) => i)
    const substat: Record<string, CharSubstatAnalysis[]> = {}
    for (const id of algorithms) substat[id] = indexes.map((i) => session.analyzeSubstat(i, id))
    const buff = indexes.map((i) => session.analyzeBuff(i))
    return {
        substat,
        buff,
        characters: session.characters.map((ctx, i) => ({
            character: ctx.character,
            substat: substat[algorithms[0] ?? 'single-loss'][i],
            buff: buff[i]
        }))
    }
}
