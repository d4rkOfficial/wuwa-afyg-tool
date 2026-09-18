import type { EchoSlotConfig } from './config.types'
import { ELEMENT_BONUS_MAP } from '$lib/consts/game-terms'
import { MAIN_STAT_POOL, SECOND_MAIN_STAT, SUBSTAT_OPTIONS } from '$lib/consts/stat-data'
import type { SubstatLabel } from '$lib/consts/stat-data'

/** @desc 标准词条集：5 个声骸合计 14 条副词条（5 暴击 + 5 暴伤 + 2 百分比 + 2 固定值） */
export const STANDARD_SUBSTAT_TOTAL = 14

/** @desc 标准词条集方案名（工坊同步的唯一一种方案，也是本地不可删除的方案） */
export const STANDARD_PLAN_NAME = '标准14词条'

/** @desc 标准方案的默认 cost 排列（槽位 1=4cost，2/3=3cost，4/5=1cost）；
 *  仅用于「自动生成标准词条」与新建方案的初始值——编辑与校验都**不强制**该组合，只要求合计 ≤12 */
export const STANDARD_COST_LAYOUT = [4, 3, 3, 1, 1] as const

export type StatFamily = '攻击' | '生命' | '防御'

const STAT_FAMILIES: StatFamily[] = ['攻击', '生命', '防御']

/** @desc 中位档（偏低）：8 档取第 4 档、4 档取第 2 档（与「添加副词条」默认值同口径） */
export function midTierValue(label: SubstatLabel): number {
    const opt = SUBSTAT_OPTIONS.find((o) => o.label === label)
    if (!opt) return 0
    return opt.tiers[Math.floor((opt.tiers.length - 1) / 2)]
}

/** @desc 构造一条中位档副词条（value 取该词条档位池的中位档） */
function substat(label: SubstatLabel): { type: string; value: number; unit: string } {
    const opt = SUBSTAT_OPTIONS.find((o) => o.label === label)
    return { type: label, value: midTierValue(label), unit: opt?.unit ?? '' }
}

/** @desc 从主词条池取指定 cost 的满级主词条；池里没有该词条时返回 null */
function mainStat(cost: number, label: string): { type: string; value: number; unit: string } | null {
    const opt = (MAIN_STAT_POOL[cost] ?? []).find((o) => o.label === label)
    return opt ? { type: opt.label, value: opt.maxValue, unit: opt.unit } : null
}

/** @desc 副主词条（随 cost 固定：4cost=攻击150、3cost=攻击100、1cost=生命2280） */
function secondMainStat(cost: number): { type: string; value: number; unit: string } | null {
    const sec = SECOND_MAIN_STAT[cost as keyof typeof SECOND_MAIN_STAT]
    return sec ? { type: sec.label, value: sec.value, unit: sec.unit } : null
}

/** @desc 角色固有属性（statNodes）解析结果：是否含暴击率、以及主属性族（攻击/生命/防御） */
export interface InherentStats {
    hasCritRate: boolean
    family: StatFamily
}

/**
 * @desc 解析角色固有属性（突破加成）：
 * - 是否含「暴击率」→ 决定 4cost 主词条取暴击率还是暴击伤害；
 * - 主属性族优先取 statNodes 名称里出现的 攻击/生命/防御，名称都没有时再退回文案全文；
 * - 都取不到时按输出角色兜底为「攻击」。
 */
export function parseInherentStats(statNodes?: { name: string; desc: string }[]): InherentStats {
    const nodes = statNodes ?? []
    const text = nodes.map((n) => `${n.name} ${n.desc}`).join(' ')
    const hasCritRate = nodes.some((n) => n.name.includes('暴击率')) || text.includes('暴击率')
    const byName = STAT_FAMILIES.find((f) => nodes.some((n) => n.name.includes(f)))
    const family = byName ?? STAT_FAMILIES.find((f) => text.includes(f)) ?? '攻击'
    return { hasCritRate, family }
}

/** @desc 角色属性 → 主词条「XX伤害加成」标签（池里没有时回退攻击%） */
function elementMainStatLabel(element: string): string {
    const label = `${element}伤害加成`
    return label in ELEMENT_BONUS_MAP ? label : '攻击%'
}

export interface StandardPlanInput {
    element: string
    statNodes?: { name: string; desc: string }[]
}

/**
 * @desc 生成标准 14 词条方案（5 个声骸）：
 * - 主词条 43311：4cost 取暴击率（固有属性含暴击率时）否则暴击伤害；两个 3cost 取角色属性伤害加成；
 *   两个 1cost 取固有属性对应的攻击%/生命%/防御%；
 * - 副词条：每个声骸各 1 条暴击率 + 1 条暴击伤害；前两个声骸各再加 1 条百分比 + 1 条固定值（同固有属性族）；
 * - 数值一律取中位档（偏低）。
 */
export function buildStandardSlots(info: StandardPlanInput): EchoSlotConfig[] {
    const { hasCritRate, family } = parseInherentStats(info.statNodes)
    const elementLabel = elementMainStatLabel(info.element)
    const mainLabels = [hasCritRate ? '暴击率' : '暴击伤害', elementLabel, elementLabel, `${family}%`, `${family}%`]
    return STANDARD_COST_LAYOUT.map((cost, i) => {
        const substats = [substat('暴击率'), substat('暴击伤害')]
        if (i < 2) {
            substats.push(substat(`${family}%` as SubstatLabel), substat(family as SubstatLabel))
        }
        return {
            cost,
            mainStat: mainStat(cost, mainLabels[i]) ?? mainStat(cost, '攻击%'),
            secondMainStat: secondMainStat(cost),
            substats
        }
    })
}

/** @desc 方案副词条总数（标准方案恒为 14） */
export function planSubstatTotal(slots: EchoSlotConfig[]): number {
    return slots.reduce((sum, slot) => sum + slot.substats.length, 0)
}

/** @desc 把数值吸附到最近的合法档位（脏数据 / 手写 JSON 容错；UI 只能从档位里选） */
function snapToTiers(tiers: number[], value: number): number {
    const fallback = tiers[Math.floor((tiers.length - 1) / 2)] ?? 0
    if (!Number.isFinite(value)) return fallback
    return tiers.reduce((best, t) => (Math.abs(t - value) < Math.abs(best - value) ? t : best), tiers[0] ?? 0)
}

/** @desc 副词条：type 必须在白名单内，数值吸附到合法档位、单位按词条类型固定（不接受自由数值） */
function normalizeSubstat(value: unknown): { type: string; value: number; unit: string } | null {
    if (!value || typeof value !== 'object') return null
    const raw = value as Record<string, unknown>
    const type = typeof raw.type === 'string' ? raw.type : ''
    const opt = SUBSTAT_OPTIONS.find((o) => o.label === type)
    if (!opt) return null
    return { type, value: snapToTiers(opt.tiers, Number(raw.value)), unit: opt.unit }
}

/** @desc 主词条：type 必须属于该 cost 的池子，数值固定取满级上限（不接受自定义数值） */
function normalizeMainStat(value: unknown, cost: number): { type: string; value: number; unit: string } | null {
    if (!value || typeof value !== 'object') return null
    const raw = value as Record<string, unknown>
    const type = typeof raw.type === 'string' ? raw.type : ''
    const opt = (MAIN_STAT_POOL[cost] ?? []).find((o) => o.label === type)
    if (!opt) return null
    return { type: opt.label, value: opt.maxValue, unit: opt.unit }
}

/** @desc 副主词条：完全由槽位 cost 自动推导（4→攻击150 / 3→攻击100 / 1→生命2280） */
function normalizeSecondMainStat(cost: number): { type: string; value: number; unit: string } | null {
    const sec = SECOND_MAIN_STAT[cost as keyof typeof SECOND_MAIN_STAT]
    return sec ? { type: sec.label, value: sec.value, unit: sec.unit } : null
}

function normalizeSlot(value: unknown): EchoSlotConfig | null {
    if (!value || typeof value !== 'object') return null
    const raw = value as Record<string, unknown>
    const cost = Number(raw.cost)
    if (![1, 3, 4].includes(cost)) return null
    const substats: { type: string; value: number; unit: string }[] = []
    for (const item of Array.isArray(raw.substats) ? raw.substats : []) {
        const stat = normalizeSubstat(item)
        if (!stat || substats.length >= 5) continue
        if (substats.some((s) => s.type === stat.type)) continue
        substats.push(stat)
    }
    return {
        cost,
        mainStat: normalizeMainStat(raw.mainStat, cost),
        secondMainStat: normalizeSecondMainStat(cost),
        substats
    }
}

/**
 * @desc 宽松归一化：任意 5 槽位方案（cost 组合不限，只要合计 ≤12），每槽副词条 ≤5 且类型在白名单内；
 * 主词条数值固定为满级、副主词条按 cost 自动推导、副词条数值吸附到合法档位；不满足返回 null。
 */
export function normalizeAnyPlanSlots(value: unknown): EchoSlotConfig[] | null {
    const raw = (value ?? {}) as { slots?: unknown }
    if (!Array.isArray(raw.slots) || raw.slots.length !== 5) return null
    const slots: EchoSlotConfig[] = []
    for (const item of raw.slots) {
        const slot = normalizeSlot(item)
        if (!slot) return null
        slots.push(slot)
    }
    if (slots.reduce((sum, s) => sum + s.cost, 0) > 12) return null
    return slots
}

/**
 * @desc 归一化「标准14词条」方案（工坊同步 / 本地存储 / 导入的 JSON）：
 * 在宽松归一化基础上额外要求副词条合计恰为 14 条（**cost 组合不限**，只要合计 ≤12）；不满足返回 null（脏数据丢弃）。
 */
export function normalizePlanSlots(value: unknown): EchoSlotConfig[] | null {
    const slots = normalizeAnyPlanSlots(value)
    if (!slots) return null
    if (planSubstatTotal(slots) !== STANDARD_SUBSTAT_TOTAL) return null
    return slots
}

/** @desc 深拷贝方案（写入工程前隔离引用，避免本地库与工程互相串改） */
export function cloneSlots(slots: EchoSlotConfig[]): EchoSlotConfig[] {
    return slots.map((slot) => ({
        cost: slot.cost,
        mainStat: slot.mainStat ? { ...slot.mainStat } : null,
        secondMainStat: slot.secondMainStat ? { ...slot.secondMainStat } : null,
        substats: slot.substats.map((s) => ({ ...s }))
    }))
}
