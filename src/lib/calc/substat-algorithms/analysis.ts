import type { BuffConf, DamageEntry } from '../calculation.types'
import type { ConfigState } from '../config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { CharBuffAnalysis, CharContributionAnalysis, CharSubstatAnalysis, ResultEntry } from '../result.types'
import { DEFAULT_CONDITION_PROFILE, type ConditionProfile } from '../compute'
import type { AlgorithmId } from './types'
import { getAlgorithm, ALGORITHMS_INFO } from './index'
import { prepareAnalysis, type AnalysisInputs, type CharacterDamageContext } from './shared'
import { analyzeCharacterBuffs } from './buff-contribution'
import { buildEchoDescByEntry } from '../skill-infer'
import { getEchoSkillText, setEchoSkillText } from '$lib/data/char-info.svelte'

/**
 * @desc 直伤贡献分析的入口（**纯函数 + 同步**，主线程与 Worker 共用同一份实现）。
 *
 * 执行方式由调用方决定，计算口径只有这一处：
 * - 界面走 `analysis-runner.svelte.ts`（优先 Worker 线程，不可用时退回主线程分片）；
 * - AI / WS 工具直接调用下面的同步实现。
 *
 * 所有入参都是**可结构化克隆的纯数据**（三个 id 集合用数组传，内部再转 Set），这是 Worker 路径的前提。
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
    /**
     * @desc 调用方已经算好的全量引擎结果（结果页的 `computeAll` 输出）。
     *
     * 给了就不在 `prepareAnalysis` 里再跑一次 `computeAll` —— 基线本来就只有这一份口径，
     * 同参数重算一遍纯属重复劳动。不给（AI / WS / 单独跑分析）时照常内部算。
     */
    baselineEntries?: ResultEntry[]
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

/** @desc 需要计算的部分：切换副词条算法时只重算副词条（Buff 与算法无关） */
export type ContributionPart = 'substat' | 'buff'

export interface ContributionAnalysisOptions {
    algorithm: AlgorithmId
    /** @desc 需要计算的部分（默认两者） */
    parts?: ContributionPart[]
}

export interface ContributionAnalysisResult {
    substat: CharSubstatAnalysis[]
    buff: CharBuffAnalysis[]
}

/** @desc 进度回调：每算完一个角色的一半就回一次，界面据此逐角色填充 */
export type ContributionProgress = (partial: ContributionAnalysisResult) => void

/** @desc 让出一帧的方式：主线程用定时器，Worker 内不需要（Worker 线程不占界面帧） */
export type YieldFrame = () => Promise<void>

/** @desc 发往 Worker 的请求：多一个 id 用于回包对号，外加算法与部分 */
export interface ContributionAnalysisMessage extends ContributionAnalysisRequest {
    id: number
    algorithm: AlgorithmId
    parts: ContributionPart[]
}

/** @desc Worker 回包：`progress` 为分片进度，`done` 为最终结果或错误（二选一） */
export type ContributionAnalysisReply =
    | { id: number; kind: 'progress'; partial: ContributionAnalysisResult }
    | { id: number; kind: 'done'; result?: ContributionAnalysisResult; error?: string }

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
    conditionProfile: req.conditionProfile ?? DEFAULT_CONDITION_PROFILE,
    ...(req.baselineEntries ? { baselineEntries: req.baselineEntries } : {})
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

/**
 * @desc 按「角色 → 副词条 / Buff」的顺序逐片算完，每片之间调用 `yieldFrame`。
 *
 * 主线程与 Worker 两条路径都用这一份，唯一差别是传进来的 `yieldFrame`：
 * 主线程让出真实帧（界面可刷新），Worker 内为空实现。于是两条路径的结果与顺序**必然一致**。
 */
export const runContributionSteps = async (
    session: ContributionAnalysisSession,
    options: ContributionAnalysisOptions,
    onProgress?: ContributionProgress,
    yieldFrame: YieldFrame = () => Promise.resolve()
): Promise<ContributionAnalysisResult> => {
    const parts = options.parts ?? ['substat', 'buff']
    const wantsSubstat = parts.includes('substat')
    const wantsBuff = parts.includes('buff')
    const result: ContributionAnalysisResult = { substat: [], buff: [] }

    for (let i = 0; i < session.characters.length; i++) {
        await yieldFrame()
        if (wantsSubstat) {
            result.substat.push(session.analyzeSubstat(i, options.algorithm))
            onProgress?.({ substat: [...result.substat], buff: [...result.buff] })
        }
        // 副词条与 Buff 之间空一拍：两半各算一次同步块减半，界面在中间就能刷出一批结果
        if (wantsSubstat && wantsBuff) await yieldFrame()
        if (wantsBuff) {
            result.buff.push(session.analyzeBuff(i))
            onProgress?.({ substat: [...result.substat], buff: [...result.buff] })
        }
    }
    return result
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
