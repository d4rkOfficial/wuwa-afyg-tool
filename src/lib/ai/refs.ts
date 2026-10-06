/**
 * @desc AI 工具层的**位置寻址**：对外只用「序号」，摘要里不再出现内部 id。
 *
 * 为什么：id 是 `op-m3k9x1`、`db-...-共鸣技能|共鸣技能伤害#攻击` 这类机器码 ——
 * 模型抄写容易出错、白占 token，而且看摘要时还得回头核对哪串码对应哪一行。
 * 阶段摘要本来就是按时间顺序渲染的，所以「第 N 个」既稳定又直观。
 *
 * 三条约定（工具与摘要共用，避免两处口径漂移）：
 * 1. **顺序即序号**：操作块/参考线/伤害条目一律**按时间（pos）先后**编号，工程 Buff 配置按工程配置顺序；
 * 2. **入参兼容 id**：解析器接受序号（数字或纯数字字符串）或原始 id —— 旧消息里的 id 不会突然失效，
 *    但摘要**只输出序号**；
 * 3. **报错要精准**：定位失败时给出总数、可用的序号区间与一份紧凑清单，模型可直接自我纠正。
 */
import { getOpBlocks, getRefLines, getTeam } from '$lib/calc/timeline.store.svelte'
import { getAllBuffConfs, getAllDamageEntries } from '$lib/calc/calculation.store.svelte'
import type { OpBlock, RefLine } from '$lib/calc/timeline.types'
import type { BuffConf, DamageEntry } from '$lib/calc/calculation.types'

/**
 * @desc 工具入参里的位置引用：**序号**（数字或纯数字字符串，1 起）或原始 id。
 * 类型上按 `unknown` 收 —— 模型传来的是 JSON，取值前一律先归一化，避免各工具各写一套判断。
 */
export type PositionRef = unknown

/** @desc 纯数字视为序号；其余视为 id */
export const asIndex = (ref: PositionRef): number | null => {
    if (typeof ref === 'number') return Number.isInteger(ref) && ref > 0 ? ref : null
    const text = String(ref ?? '').trim()
    return /^\d+$/.test(text) ? Number(text) : null
}

/** @desc 定位失败时的紧凑可选清单（截断，避免错误信息本身太长） */
const roster = (labels: readonly string[]): string => {
    const shown = labels.slice(0, 12).map((l, i) => `${i + 1}=${l}`)
    return `可选：${shown.join('、')}${labels.length > 12 ? ` …（共 ${labels.length} 个，完整清单见摘要工具）` : ''}`
}

/**
 * @desc 通用定位：先按序号取，再按 id 取；都不中则抛出带清单的错误。
 * `labels` 与 `items` 同序，用于拼错误提示。
 */
const locate = <T>(
    kind: string,
    ref: PositionRef,
    items: readonly T[],
    idOf: (item: T) => string,
    labelOf: (item: T) => string,
    hint: string
): T => {
    const raw = String(ref ?? '').trim()
    if (!raw) throw new Error(`缺少${kind}序号（${hint}）`)
    const index = asIndex(ref)
    if (index !== null) {
        const hit = items[index - 1]
        if (hit) return hit
        throw new Error(
            `${kind}序号超出范围：${index}（共 ${items.length} 个，序号 1-${items.length}）。${roster(items.map(labelOf))}`
        )
    }
    const byId = items.find((item) => idOf(item) === raw)
    if (byId) return byId
    throw new Error(`未找到${kind}「${raw}」。请用序号定位（序号 1-${items.length}）。${roster(items.map(labelOf))}`)
}

// ── 顺序真源（摘要与寻址必须一致）──

/** @desc 操作块按时间先后排序（同 pos 按轨道），序号即此顺序 */
export const opBlocksInOrder = (): OpBlock[] =>
    [...getOpBlocks()].sort((a, b) => a.pos - b.pos || a.trackIndex - b.trackIndex)

/** @desc 参考线按时间先后排序，序号即此顺序 */
export const refLinesInOrder = (): RefLine[] => [...getRefLines()].sort((a, b) => a.pos - b.pos)

/** @desc 伤害条目按时间轴先后排序（同位置保持 store 内的相对顺序），序号即此顺序 */
export const damageEntriesInOrder = (): DamageEntry[] => {
    const posOfSource = timelinePosMap()
    return getAllDamageEntries()
        .map((entry, order) => ({ entry, order, pos: posOfSource.get(entry.sourceTimelineBlockId) }))
        .sort((a, b) => (a.pos ?? Number.POSITIVE_INFINITY) - (b.pos ?? Number.POSITIVE_INFINITY) || a.order - b.order)
        .map((x) => x.entry)
}

/** @desc 工程 Buff 配置序号 = 工程配置顺序（与 buff 列表一致） */
export const buffConfsInOrder = (): BuffConf[] => getAllBuffConfs()

/** @desc 时间轴来源（操作块 / 参考线 id）→ 像素位置 */
export const timelinePosMap = (): Map<string, number> => {
    const map = new Map<string, number>()
    for (const op of getOpBlocks()) map.set(op.id, op.pos)
    for (const rl of getRefLines()) map.set(rl.id, rl.pos)
    return map
}

// ── 各域的定位器 ──

/** @desc 操作块标签（错误提示用）：轨2 乙·共鸣技能（角色名取自当前队伍） */
export const opBlockLabel = (op: OpBlock): string => {
    const track = getTeam()[op.trackIndex]?.character
    return `轨${op.trackIndex + 1}${track ? ` ${track}` : ''}·${op.key}`
}

export const resolveOpBlock = (ref: PositionRef): OpBlock =>
    locate('操作块', ref, opBlocksInOrder(), (op) => op.id, opBlockLabel, '先用 get_timeline_summary 查看时间线')

export const resolveRefLine = (ref: PositionRef): RefLine =>
    locate(
        '参考线',
        ref,
        refLinesInOrder(),
        (rl) => rl.id,
        (rl) => rl.time || '未命名',
        '先用 get_timeline_summary 查看时间线'
    )

export const resolveDamageEntry = (ref: PositionRef): DamageEntry =>
    locate(
        '伤害条目',
        ref,
        damageEntriesInOrder(),
        (e) => e.id,
        (e) => `${e.character || '无'}·${e.displayName}`,
        '先用 get_damage_entries 查看拉表'
    )

export const resolveBuffConf = (ref: PositionRef): BuffConf =>
    locate(
        '工程 Buff 配置',
        ref,
        buffConfsInOrder(),
        (b) => b.id,
        (b) => b.name,
        '先用 get_buff_confs 查看清单'
    )
