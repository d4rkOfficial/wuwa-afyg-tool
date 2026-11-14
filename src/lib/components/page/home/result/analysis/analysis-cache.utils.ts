import type { CharSlot } from '$lib/types/project'
import type { ConfigState } from '$lib/calc/config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { AlgorithmId } from '$lib/calc/substat-algorithms/types'

/**
 * @desc 「数据分析 → 贡献」结果的**有效性判定与缓存登记**（纯函数）。
 *
 * 为什么需要：整套贡献分析（`prepare` + 逐角色副词条 + Buff）实测约 130ms，且分 4 片占主线程；
 * 而结果本来就在 `substatAnalysis` / `buffAnalysis` 里，无条件重算只会白卡一下。
 * 这里用一份**全廉价**的输入指纹决定「要不要重算」：
 * 版本号 / 字符串 / 对象引用，不做任何深拷贝（请求体里有角色技能树，深拷贝贵得离谱）。
 *
 * 口径约定：
 * - `parts` 记录「按这份 inputs 算过」的部分；Buff 与算法无关，副词条要连算法一起比；
 * - 输入变了 → 旧 parts 作废（只保留本次重算出来的那几部分），避免另一半拿旧结果冒充新结果。
 */

export type AnalysisPart = 'substat' | 'buff'

/** @desc 影响贡献分析结果的全部输入（全部廉价可比项） */
export interface AnalysisInputs {
    /** @desc 拉表表格数据版本（Buff / 绑定 / 伤害类型 / 显示名 / 文件夹树，内容变化才自增） */
    table: number
    /** @desc 伤害条目指纹（数量 + 倍率合计；条目由时间线派生） */
    entries: string
    /** @desc 链 / 阶档位 */
    profile: string
    teamRef: readonly CharSlot[]
    configRef: ConfigState | null
    charInfoRef: Record<string, CharacterInfo>
    weaponInfoRef: Record<string, WeaponInfo>
    echoTextRef: Record<string, string>
    /** @desc 凹暴 / 不暴 / 未命中三种展示口径 */
    crit: string
    /** @desc 手动刷新计数（刷新按钮要求强制重算） */
    refresh: number
}

/** @desc 已有结果的有效性记录：哪几部分是按 `inputs` 算的、副词条用的是什么算法 */
export interface AnalysisCache {
    inputs: AnalysisInputs
    parts: AnalysisPart[]
    algorithm: AlgorithmId
}

/** @desc 两份输入是否完全一致（引用项按 `===` 比，其余逐值比） */
export const sameAnalysisInputs = (a: AnalysisInputs, b: AnalysisInputs): boolean =>
    a.table === b.table &&
    a.entries === b.entries &&
    a.profile === b.profile &&
    a.teamRef === b.teamRef &&
    a.configRef === b.configRef &&
    a.charInfoRef === b.charInfoRef &&
    a.weaponInfoRef === b.weaponInfoRef &&
    a.echoTextRef === b.echoTextRef &&
    a.crit === b.crit &&
    a.refresh === b.refresh

/** @desc 某部分的现有结果是否还对应当前输入（对应则无需重算） */
export const analysisFresh = (
    cache: AnalysisCache | null,
    part: AnalysisPart,
    inputs: AnalysisInputs,
    algorithm: AlgorithmId
): boolean => {
    if (!cache || !cache.parts.includes(part)) return false
    if (!sameAnalysisInputs(cache.inputs, inputs)) return false
    // Buff 贡献与算法无关，换算法不必重算它
    return part === 'buff' || cache.algorithm === algorithm
}

/** @desc 本次真正需要算的部分（已是最新的部分直接跳过；返回空数组 = 秒开） */
export const analysisNeeded = (
    cache: AnalysisCache | null,
    parts: readonly AnalysisPart[],
    inputs: AnalysisInputs,
    algorithm: AlgorithmId
): AnalysisPart[] => parts.filter((part) => !analysisFresh(cache, part, inputs, algorithm))

/** @desc 一次重算成功后登记新缓存：输入没变则保留已算过的部分，变了就只留本次算出来的 */
export const nextAnalysisCache = (
    prev: AnalysisCache | null,
    inputs: AnalysisInputs,
    computed: readonly AnalysisPart[],
    algorithm: AlgorithmId
): AnalysisCache => {
    const kept = prev && sameAnalysisInputs(prev.inputs, inputs) ? prev.parts : []
    return {
        inputs,
        parts: [...new Set([...kept, ...computed])],
        // 副词条结果由「算它时用的算法」标记；本次没重算副词条就沿用上一次的标记
        algorithm: computed.includes('substat') ? algorithm : (prev?.algorithm ?? algorithm)
    }
}
