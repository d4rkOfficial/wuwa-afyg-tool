/**
 * @desc AI 工具层的**位置寻址**：排轴用「短索引」，拉表/配装仍用「序号」，摘要里都不出现内部 id。
 *
 * 为什么：id 是 `op-m3k9x1`、`db-...-共鸣技能|共鸣技能伤害#攻击` 这类机器码 ——
 * 模型抄写容易出错、白占 token。
 *
 * 但两种域对「稳定」的要求不同，所以寻址口径**分两类**：
 * 1. **排轴（操作块 / 参考线）→ 短索引**（`xlm8n`，见 `$lib/ai/short-key`）。
 *    「第几个」会随移动/删除漂移，而排轴工具经常被连续调用（move → bind → move），
 *    位置序号会让后续调用静默指错块。短索引是 id 的纯函数投影，永不改变。
 * 2. **拉表（伤害条目）/ 配装（工程 Buff 配置）→ 位置序号**。
 *    这两类清单的顺序是「工程配置顺序」，新增只会追加、不在中间移动，序号稳定；
 *    它们没有 id 漂移问题，保持数字更省 token。
 *
 * 三条约定：
 * 1. 排轴按时间（pos）先后**展示**，但**寻址只用短索引**；
 * 2. 入参兼容内部 id（WS / 脚本要精确寻址时用）—— 旧消息里的 id 不会失效；
 * 3. 报错要精准：给总数、可用取值与一份紧凑清单，模型可直接自我纠正。
 */
import { getOpBlocks, getRefLines, getTeam } from '$lib/calc/timeline.store.svelte'
import { getAllBuffConfs, getAllDamageEntries } from '$lib/calc/calculation.store.svelte'
import { shortKeyOf } from '$lib/ai/short-key'
import type { OpBlock, RefLine } from '$lib/calc/timeline.types'
import type { BuffConf, DamageEntry } from '$lib/calc/calculation.types'

/**
 * @desc 工具入参里的位置引用：排轴传**短索引**或内部 id；拉表/配装传**序号**（数字或纯数字字符串）或 id。
 * 类型上按 `unknown` 收 —— 模型传来的是 JSON，取值前一律先归一化，避免各工具各写一套判断。
 */
export type PositionRef = unknown

/** @desc 纯数字视为序号（**只用于拉表/配装**）；其余视为短索引或 id */
export const asIndex = (ref: PositionRef): number | null => {
    if (typeof ref === 'number') return Number.isInteger(ref) && ref > 0 ? ref : null
    const text = String(ref ?? '').trim()
    return /^\d+$/.test(text) ? Number(text) : null
}

/** @desc 定位失败时的紧凑可选清单（截断，避免错误信息本身太长） */
const roster = (entries: readonly string[]): string => {
    const shown = entries.slice(0, 12)
    return `可选：${shown.join('、')}${entries.length > 12 ? ` …（共 ${entries.length} 个，完整清单见摘要工具）` : ''}`
}

interface LocateSpec<T> {
    kind: string
    ref: PositionRef
    items: readonly T[]
    idOf: (item: T) => string
    labelOf: (item: T) => string
    /**
     * @desc 稳定短索引。提供 = 该域按短索引寻址（排轴）；不提供 = 按位置序号寻址（拉表/配装）。
     * 给出时会先做**碰撞检测**：两个条目映射到同一短索引（内部 id 碰撞）直接报错，不做「取第一个」。
     */
    keyOf?: (item: T) => string
    hint: string
}

/**
 * @desc 通用定位：先按短索引（或位置序号），再按内部 id；都不中则抛出带清单的错误。
 */
const locate = <T>(spec: LocateSpec<T>): T => {
    const { kind, ref, items, idOf, labelOf, keyOf, hint } = spec
    const raw = String(ref ?? '').trim()
    if (!raw) throw new Error(`缺少${kind}${keyOf ? '短索引' : '序号'}（${hint}）`)

    /** 清单条目：排轴显示 `xlm8n=轨1 今汐·E`，其它显示 `1=条目名` */
    const describe = (item: T, index: number): string => `${keyOf ? keyOf(item) : index + 1}=${labelOf(item)}`
    const rosterText = (): string => roster(items.map(describe))

    if (keyOf) {
        const byKey = new Map<string, T[]>()
        for (const item of items) {
            const key = keyOf(item)
            const list = byKey.get(key)
            if (list) list.push(item)
            else byKey.set(key, [item])
        }
        for (const [key, list] of byKey) {
            if (list.length > 1) {
                throw new Error(
                    `短索引冲突：${key} 命中 ${list.length} 个${kind}（内部 id 碰撞，排轴数据已重复）。请先删掉重复条目再操作。`
                )
            }
        }
        const hit = byKey.get(raw)?.[0]
        if (hit) return hit
    } else {
        const index = asIndex(ref)
        if (index !== null) {
            const hit = items[index - 1]
            if (hit) return hit
            throw new Error(
                `${kind}序号超出范围：${index}（共 ${items.length} 个，序号 1-${items.length}）。${rosterText()}`
            )
        }
    }

    const byId = items.find((item) => idOf(item) === raw)
    if (byId) return byId
    throw new Error(
        keyOf
            ? `未找到${kind}「${raw}」。请用**短索引**或内部 id 定位。${rosterText()}`
            : `未找到${kind}「${raw}」。请用序号定位（序号 1-${items.length}）。${rosterText()}`
    )
}

// ── 顺序真源（摘要与展示必须一致；寻址靠短索引，不依赖顺序）──

/** @desc 操作块按时间先后排序（同 pos 按轨道），用于**展示顺序** */
export const opBlocksInOrder = (): OpBlock[] =>
    [...getOpBlocks()].sort((a, b) => a.pos - b.pos || a.trackIndex - b.trackIndex)

/** @desc 参考线按时间先后排序，用于**展示顺序** */
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

/** @desc 操作块短索引（摘要 / 工具返回值 / 报错清单一律用它） */
export const opBlockKey = (op: OpBlock): string => shortKeyOf(op.id)

/** @desc 参考线短索引 */
export const refLineKey = (rl: RefLine): string => shortKeyOf(rl.id)

/** @desc 操作块标签（报错/清单用）：轨2 乙·共鸣技能（角色名取自当前队伍） */
export const opBlockLabel = (op: OpBlock): string => {
    const track = getTeam()[op.trackIndex]?.character
    return `轨${op.trackIndex + 1}${track ? ` ${track}` : ''}·${op.key}`
}

export const resolveOpBlock = (ref: PositionRef): OpBlock =>
    locate({
        kind: '操作块',
        ref,
        items: opBlocksInOrder(),
        idOf: (op) => op.id,
        labelOf: opBlockLabel,
        keyOf: opBlockKey,
        hint: '先用 get_timeline_summary 查看时间线'
    })

export const resolveRefLine = (ref: PositionRef): RefLine =>
    locate({
        kind: '参考线',
        ref,
        items: refLinesInOrder(),
        idOf: (rl) => rl.id,
        labelOf: (rl) => rl.name || '未命名',
        keyOf: refLineKey,
        hint: '先用 get_timeline_summary 查看时间线'
    })

export const resolveDamageEntry = (ref: PositionRef): DamageEntry =>
    locate({
        kind: '伤害条目',
        ref,
        items: damageEntriesInOrder(),
        idOf: (e) => e.id,
        labelOf: (e) => `${e.character || '无'}·${e.displayName}`,
        hint: '先用 get_damage_entries 查看拉表'
    })

export const resolveBuffConf = (ref: PositionRef): BuffConf =>
    locate({
        kind: '工程 Buff 配置',
        ref,
        items: buffConfsInOrder(),
        idOf: (b) => b.id,
        labelOf: (b) => b.name,
        hint: '先用 get_buff_confs 查看清单'
    })
