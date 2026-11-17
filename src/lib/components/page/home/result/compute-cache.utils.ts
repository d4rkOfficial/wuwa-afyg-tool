import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { ConfigState } from '$lib/calc/config.types'
import type { DamageEntry } from '$lib/calc/calculation.types'
import type { ResultEntry } from '$lib/calc/result.types'
import type { CharSlot } from '$lib/types/project'
import { makeStubEntry, withEntryIdentity } from '$lib/calc/compute'

/**
 * @desc **条目结果的跨轮复用**（纯函数）：结果页里「内容完全相同的条目」是常态，
 * 而多数刷新只动了**条目集合**（排轴加删一个伤害块 / 改名），没动 Buff、配置与队伍。
 *
 * 所以缓存按「条目内容」存（键由 `entryResultKeyOf` 给），再用一份**输入签名**整体作废：
 * - 签名覆盖条目之外的一切（表格版本 / 链阶 / 配置 / 队伍 / 角色与武器数据 / 声骸文案）；
 * - 签名不变 ⇒ 同内容条目直接复用，连重复条目都只算一次；
 * - 签名一变 ⇒ 整份缓存作废（Buff 数值改了，所有条目都得重算）。
 *
 * 缓存里存的是**未套展示口径**的结果（凹暴 / 不暴 / 未命中在 `applyModes` 里改），
 * 因此改这三种勾选不需要重算，与重算缓存互不干扰。
 */

/** @desc 影响条目结果、但不属于「条目内容」的输入（全部廉价可比） */
export interface ComputeInputs {
    /** @desc 拉表表格数据版本（Buff / 绑定 / 伤害类型 / 显示名 / 文件夹树） */
    table: number
    /** @desc 链 / 阶档位 */
    profile: string
    /** @desc 手动刷新计数（刷新按钮要求强制重算） */
    refresh: number
    team: readonly CharSlot[]
    config: ConfigState | null
    charInfo: Record<string, CharacterInfo>
    weaponInfo: Record<string, WeaponInfo>
    echoSkillText: Record<string, string>
}

/** @desc 条目内容的缓存：`byKey` 与 `signature` 必须同属一轮输入 */
export interface EntryResultCache {
    signature: string
    byKey: ReadonlyMap<string, ResultEntry>
}

export const emptyEntryResultCache = (): EntryResultCache => ({ signature: '', byKey: new Map() })

/** @desc 对象内容的短指纹（FNV-1a，够用且不占内存） */
const hashOf = (text: string): string => {
    let hash = 0x811c9dc5
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(36)
}

/**
 * @desc 角色 / 武器数据的内容指纹：**按对象身份**缓存一次（`data-cache` 对同一实体返回同一对象）。
 *
 * 只能用在「对象内容不会原地改」的数据上；`team` / `config` 是 `$state` 代理、会原地改，
 * 必须每次现算（它们都很小）。
 */
const identityDigest = new WeakMap<object, string>()

const digestOf = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return hashOf(JSON.stringify(value) ?? '')
    const known = identityDigest.get(value)
    if (known !== undefined) return known
    const digest = hashOf(JSON.stringify(value) ?? '')
    identityDigest.set(value, digest)
    return digest
}

/** @desc 角色 / 武器映射：逐实体取内容指纹（映射本身每轮都换对象，靠值指纹比较） */
const mapDigestOf = (map: Record<string, unknown>): string =>
    Object.keys(map)
        .sort()
        .map((key) => `${key}:${digestOf(map[key])}`)
        .join(',')

/** @desc 输入签名：覆盖「条目之外」的全部计算输入 */
export const computeInputsSignatureOf = (inputs: ComputeInputs): string =>
    [
        `t${inputs.table}`,
        `r${inputs.refresh}`,
        `p${inputs.profile}`,
        `team${hashOf(JSON.stringify(inputs.team))}`,
        `cfg${hashOf(JSON.stringify(inputs.config))}`,
        `char${hashOf(mapDigestOf(inputs.charInfo))}`,
        `weapon${hashOf(mapDigestOf(inputs.weaponInfo))}`,
        `echo${hashOf(JSON.stringify(inputs.echoSkillText))}`
    ].join('|')

export interface ComputePlan {
    /** @desc 可直接复用的结果（内容键 → 结果） */
    reusable: ReadonlyMap<string, ResultEntry>
    /** @desc 需要真正计算的条目：每种内容只留**首次出现**的那一条 */
    missing: { index: number; entry: DamageEntry }[]
}

/** @desc 本轮要复用哪些、要算哪些（同内容的多条只留一条去算，其余靠 `assembleEntryResults` 同步） */
export const computePlanOf = (args: {
    previous: EntryResultCache
    signature: string
    entries: readonly DamageEntry[]
    keys: readonly string[]
}): ComputePlan => {
    const reusable = args.previous.signature === args.signature ? args.previous.byKey : new Map<string, ResultEntry>()
    const missing: { index: number; entry: DamageEntry }[] = []
    const planned = new Set<string>()
    args.entries.forEach((entry, index) => {
        const key = args.keys[index]!
        if (reusable.has(key) || planned.has(key)) return
        planned.add(key)
        missing.push({ index, entry })
    })
    return { reusable, missing }
}

/**
 * @desc 按缓存组装每一条目的结果：内容键命中缓存即复用，重复条目只换身份字段。
 *
 * `computed` 是本轮针对 `plan.missing` 算出来的结果（与 `missing` 同序）。
 */
export const assembleEntryResults = (args: {
    entries: readonly DamageEntry[]
    keys: readonly string[]
    reusable: ReadonlyMap<string, ResultEntry>
    missing: readonly { index: number; entry: DamageEntry }[]
    computed: readonly ResultEntry[]
}): ResultEntry[] => {
    const byKey = new Map(args.reusable)
    args.missing.forEach((slot, i) => {
        const result = args.computed[i]
        if (result) byKey.set(args.keys[slot.index]!, result)
    })
    return args.entries.map((entry, index) => {
        // 缓存与计划不一致时退回「占位结果」：形状正确、不给 NaN，也不会返回 undefined
        const source = byKey.get(args.keys[index]!) ?? makeStubEntry(entry)
        return withEntryIdentity(source, entry)
    })
}

/** @desc 本轮算出来的结果并回缓存；签名变了就整份重建（旧值一定与新输入不符） */
export const nextEntryResultCache = (args: {
    previous: EntryResultCache
    signature: string
    computed: ReadonlyMap<string, ResultEntry>
}): EntryResultCache => {
    const keep = args.previous.signature === args.signature ? args.previous.byKey : new Map<string, ResultEntry>()
    const byKey = new Map(keep)
    for (const [key, result] of args.computed) byKey.set(key, result)
    return { signature: args.signature, byKey }
}

/** @desc 组装的兜底值（正常路径不会用到；只保证形状正确、不给 NaN） */
