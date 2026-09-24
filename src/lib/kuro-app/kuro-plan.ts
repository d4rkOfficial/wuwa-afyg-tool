import type { EchoSlotConfig } from '$lib/calc/config.types'
import { MAIN_STAT_POOL, SECOND_MAIN_STAT, SUBSTAT_LABELS, SUBSTAT_OPTIONS } from '$lib/consts/stat-data'
import { ELEMENT_BONUS_MAP } from '$lib/consts/game-terms'
import { normalizeAnyPlanSlots } from '$lib/calc/standard-substats'
import type { KuroCharacterEchoes, KuroEcho } from '$lib/kuro-app/kuro.svelte'

/**
 * @desc 库街区声骸数据 → 工具箱词条方案：
 * 上游返回的是游戏内名称（可能与工具箱标签不同，如「暴击」「攻击力%」），此处统一做名称归一，
 * 数值不强求一致——最终都会交给 normalizeAnyPlanSlots 吸附到合法档位、主词条取满级值。
 */

const strip = (s: string) =>
    String(s ?? '')
        .replace(/[（(][^）)]*[）)]/g, '')
        .replace(/[\s·]/g, '')
        .trim()

const hasPct = (name: string) => name.includes('%') || name.includes('％')

/** @desc 主词条别名：上游写法 → 工具箱池子标签（池子里没有的生物不会出现在这里） */
const MAIN_STAT_ALIAS: Record<string, string> = {
    治疗效果加成: '治疗加成',
    治疗加成: '治疗加成',
    暴击: '暴击率',
    暴伤: '暴击伤害'
}

/** @desc 主词条名称归一：游戏名 → 工具箱 MAIN_STAT_POOL 标签（不在池子里返回 null） */
export function canonicalMainStat(name: string, cost: number): string | null {
    const raw = strip(name)
    if (!raw) return null
    const pool = MAIN_STAT_POOL[cost] ?? []
    const exact = pool.find((o) => strip(o.label) === raw)
    if (exact) return exact.label
    // 别名（治疗加成 / 暴击 / 暴伤 等简写与「效果」这类多字）
    const alias = MAIN_STAT_ALIAS[raw]
    if (alias) {
        const hit = pool.find((o) => o.label === alias)
        if (hit) return hit.label
    }
    // 去掉「属性/伤害/效果」等修饰后按包含关系再匹配一次（如「冷凝属性伤害加成」→「冷凝伤害加成」）
    const loose = raw.replace(/属性|效果/g, '').replace(/%|％/g, '')
    const hit = pool.find((o) => {
        const label = strip(o.label).replace(/%|％/g, '')
        return label === loose || loose.endsWith(label) || label.endsWith(loose)
    })
    if (hit) return hit.label
    // 3cost 属性伤害加成兜底：只给「XX伤害加成」，XX 能对上属性表
    if (cost === 3 && /伤害加成$/.test(loose)) {
        const element = loose.replace(/伤害加成$/, '')
        const key = Object.keys(ELEMENT_BONUS_MAP).find((k) => strip(k).startsWith(element))
        if (key) return key
    }
    return null
}

/** @desc 副词条名称归一：游戏名 → 工具箱 SUBSTAT_LABELS 之一（含固定值/百分比区分） */
export function canonicalSubstat(name: string): string | null {
    const raw = strip(name)
    if (!raw) return null
    const pct = hasPct(raw)
    const bare = raw.replace(/%|％/g, '')
    const pick = (flat: string, percent: string) => (pct ? percent : flat)
    const table: Record<string, string> = {
        暴击率: '暴击率',
        暴击: '暴击率',
        暴击伤害: '暴击伤害',
        暴伤: '暴击伤害',
        共鸣效率: '共鸣效率',
        共鸣效率加成: '共鸣效率',
        普攻伤害加成: '普攻伤害加成',
        重击伤害加成: '重击伤害加成',
        共鸣技能伤害加成: '共鸣技能伤害加成',
        共鸣解放伤害加成: '共鸣解放伤害加成'
    }
    if (table[bare]) return table[bare]
    if (bare === '攻击' || bare === '攻击力') return pick('攻击', '攻击%')
    if (bare === '生命' || bare === '生命值') return pick('生命', '生命%')
    if (bare === '防御' || bare === '防御力') return pick('防御', '防御%')
    // 伤害加成类允许「X伤害加成」别名（如「普攻伤害」）
    const hit = SUBSTAT_LABELS.find((label) => strip(label) === bare)
    return hit ?? null
}

/** @desc 单个声骸 → 槽位；名称对不上时返回 null（由调用方记入 skipped 原因） */
export function kuroEchoToSlot(echo: KuroEcho): { slot: EchoSlotConfig | null; unmatched: string[] } {
    const unmatched: string[] = []
    const cost = Number(echo.cost)
    if (![1, 3, 4].includes(cost)) return { slot: null, unmatched: [`cost=${echo.cost}`] }
    const mainLabel = canonicalMainStat(echo.mainStatName, cost)
    if (!mainLabel) unmatched.push(echo.mainStatName)
    const mainOpt = (MAIN_STAT_POOL[cost] ?? []).find((o) => o.label === mainLabel)
    const substats: { type: string; value: number; unit: string }[] = []
    for (const sub of echo.substats ?? []) {
        const label = canonicalSubstat(sub.name)
        if (!label) {
            unmatched.push(sub.name)
            continue
        }
        if (substats.some((s) => s.type === label) || substats.length >= 5) continue
        const opt = SUBSTAT_OPTIONS.find((o) => o.label === label)
        substats.push({ type: label, value: Number(sub.value) || 0, unit: opt?.unit ?? '' })
    }
    const second = SECOND_MAIN_STAT[cost as keyof typeof SECOND_MAIN_STAT]
    return {
        slot: {
            cost,
            mainStat: mainOpt ? { type: mainOpt.label, value: mainOpt.maxValue, unit: mainOpt.unit } : null,
            secondMainStat: second ? { type: second.label, value: second.value, unit: second.unit } : null,
            substats
        },
        unmatched
    }
}

export interface KuroPlanDraft {
    /** @desc 写入方案用的角色名（命中工具箱角色名录时用工具箱名，避免出现「同名不同写法」的角色） */
    character: string
    /** @desc 上游返回的角色名（便于 UI 提示改名情况） */
    upstreamName: string
    /** @desc 是否在工具箱角色名录里找到该角色 */
    matched: boolean
    slots: EchoSlotConfig[]
    /** @desc 上游给了几个声骸（< 5 表示声骸不齐，缺失槽位是空槽） */
    echoCount: number
    /** @desc 角色属性（上游 roleData 的 attributeName），用于属性分组 */
    element?: string
    /**
     * @desc 同名多形态候选（如上游只给「漂泊者」，工具箱名录里有各属性漂泊者）：
     *  非空时由用户指定要写入哪个形态，character 本身不含形态。
     */
    options?: string[]
}

/** @desc 被跳过的角色（也会以灰化卡片出现在列表里，只是不可选） */
export interface KuroPlanSkipped {
    character: string
    reason: string
    /** @desc 角色属性（有就按属性归组） */
    element?: string
}

export interface KuroPlanBuildResult {
    plans: KuroPlanDraft[]
    skipped: KuroPlanSkipped[]
    /** @desc 未能映射的原始名称（供 UI 提示「有词条名没认出来」） */
    unmatchedNames: string[]
}

/** @desc 角色名归一：去掉空白与常见分隔符，用于上游名 ↔ 工具箱名的宽松匹配 */
const normName = (s: string) => strip(s).replace(/[·・\-—_]/g, '')

/**
 * @desc 把上游角色名尽量对上工具箱角色名录；命中则用工具箱写法。
 *  上游只给「漂泊者」这类不带形态的名字时，返回同名多形态候选（options）交给用户指定。
 */
export function matchCharacterName(
    upstream: string,
    knownNames: string[]
): { name: string; matched: boolean; options: string[] } {
    const raw = strip(upstream)
    if (!raw) return { name: upstream, matched: false, options: [] }
    const exact = knownNames.find((n) => strip(n) === raw)
    if (exact) return { name: exact, matched: true, options: [] }
    const loose = knownNames.find((n) => normName(n) === normName(raw))
    if (loose) return { name: loose, matched: true, options: [] }
    // 没精确命中：看看是不是「同名的多个形态」（漂泊者·衍射/湮灭/…）
    const key = normName(raw)
    const options = knownNames.filter((n) => normName(n).length > key.length && normName(n).startsWith(key))
    if (options.length >= 2) return { name: '', matched: false, options }
    return { name: upstream, matched: false, options: [] }
}

/** @desc 标准 cost 布局，用于给「声骸不齐」的角色补空槽（补出来的槽没有主词条） */
const PAD_COST_LAYOUT = [4, 3, 3, 1, 1]

const blankSlot = (cost: number): EchoSlotConfig => {
    const second = SECOND_MAIN_STAT[cost as keyof typeof SECOND_MAIN_STAT]
    return {
        cost,
        mainStat: null,
        secondMainStat: second ? { type: second.label, value: second.value, unit: second.unit } : null,
        substats: []
    }
}

/**
 * @desc 声骸不齐（不足 5 个）时补空槽到 5 个：先吃掉标准布局里没用到的 cost，
 *  并保证总 cost ≤ 12（工具箱方案约束）；补不满返回 null。
 */
export function padSlots(slots: EchoSlotConfig[]): EchoSlotConfig[] | null {
    if (slots.length >= 5) return slots.slice(0, 5)
    const leftovers = [...PAD_COST_LAYOUT]
    for (const slot of slots) {
        const i = leftovers.indexOf(slot.cost)
        if (i >= 0) leftovers.splice(i, 1)
    }
    const padded = [...slots]
    let total = padded.reduce((sum, s) => sum + s.cost, 0)
    for (const cost of leftovers) {
        if (padded.length >= 5) break
        if (total + cost > 12) continue
        padded.push(blankSlot(cost))
        total += cost
    }
    return padded.length === 5 ? padded : null
}

/** @desc 把服务器返回的角色+声骸数据整批转成方案草稿
 *  - 完全没声骸（或详情拉取失败）的角色才跳过；声骸不齐的补空槽后照常导入
 *  - knownNames：工具箱角色名录（用于把上游角色名对到工具箱写法，可传空数组） */
export function buildKuroPlans(characters: KuroCharacterEchoes[], knownNames: string[] = []): KuroPlanBuildResult {
    const plans: KuroPlanDraft[] = []
    const skipped: KuroPlanSkipped[] = []
    const unmatched = new Set<string>()
    /** @desc 跳过项也带属性，UI 才能把灰化卡片放进对应属性分组 */
    const skip = (ch: KuroCharacterEchoes, reason: string) => {
        skipped.push({ character: ch.name, reason, ...(ch.element ? { element: ch.element } : {}) })
    }
    for (const ch of characters) {
        const echoes = ch.echoes ?? []
        if (echoes.length === 0) {
            // 服务端把「该角色详情拉取失败」的原因带在 error 上：优先展示它
            skip(ch, ch.error ? `拉取失败：${ch.error}` : '没有装配声骸')
            continue
        }
        const slots: EchoSlotConfig[] = []
        let bad = false
        for (const echo of echoes) {
            const { slot, unmatched: miss } = kuroEchoToSlot(echo)
            miss.forEach((m) => unmatched.add(m))
            if (!slot) {
                bad = true
                break
            }
            slots.push(slot)
        }
        if (bad) {
            skip(ch, '存在无法识别的声骸数据')
            continue
        }
        const padded = padSlots(slots)
        if (!padded) {
            skip(ch, '声骸 cost 组合不满足工具箱方案约束（合计 >12）')
            continue
        }
        const normalized = normalizeAnyPlanSlots(padded)
        if (!normalized) {
            skip(ch, '声骸数据不满足工具箱方案约束（cost 合计 >12 或词条非法）')
            continue
        }
        const { name, matched, options } = matchCharacterName(ch.name, knownNames)
        plans.push({
            character: name,
            upstreamName: ch.name,
            matched,
            slots: normalized,
            echoCount: echoes.length,
            ...(ch.element ? { element: ch.element } : {}),
            ...(options.length > 0 ? { options } : {})
        })
    }
    return { plans, skipped, unmatchedNames: [...unmatched] }
}
