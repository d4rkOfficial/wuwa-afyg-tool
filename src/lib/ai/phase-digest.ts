/**
 * @desc 阶段详情的「给 AI 看」渲染（纯函数，便于单测）。
 *
 * 为什么不用原始 JSON：阶段数据里大量字段对模型没用（像素坐标、内部标记、逐层嵌套的重复键名），
 * 整份丢过去既浪费 token，顺序还看不出来（操作块按轨道分开存、伤害块与操作块的绑定在另一张表里）。
 * 这里按**人读时间轴的方式**渲染成紧凑文本：
 *
 * - 排轴：按 `pos` 把操作块 / 参考线 / 绑定的伤害串成**一条时间线**；倍率**默认不展开**
 *   （属于「按需查询」的大头，用 `get_timeline_damage_list` 单独查）。
 * - 拉表：按条目在时间轴上的顺序逐条列出（归属 / 属性 / 类型 / 已绑 Buff 名）；
 *   乘区数值与引用明细按需另查（`get_buff_conf_detail` / `get_damage_entry_buff_sources`）。
 *
 * 工具侧只负责取数，措辞与排版集中在这里，避免同一阶段在不同工具里两种口径。
 */
import type { DamageBlock, NonDirectEntry, OpBlock, RefLine } from '$lib/calc/timeline.types'
import type { DamageEntry } from '$lib/calc/calculation.types'

/** @desc 像素位置 → 秒（时间轴左侧有 SIDE_PAD 的空白） */
export const posToSeconds = (pos: number, sidePad: number, pps: number): number => Math.max(0, (pos - sidePad) / pps)

/** @desc 秒数显示：保留两位，去掉多余的 0（0.00s / 0.42s / 12.30s） */
export const fmtSeconds = (seconds: number): string => `${seconds.toFixed(2)}s`

/** @desc 时间前缀（无有效位置时给个占位，避免模型把 0.00s 当成真实时间） */
const timePrefix = (pos: number | undefined, sidePad: number, pps: number): string =>
    pos === undefined ? '  --  ' : fmtSeconds(posToSeconds(pos, sidePad, pps)).padStart(7)

// ── 排轴 ──

export interface TimelineDigestInput {
    opBlocks: readonly OpBlock[]
    refLines: readonly RefLine[]
    damageBlocks: readonly DamageBlock[]
    /** @desc 各轨显示名（下标 = trackIndex） */
    trackLabels: readonly string[]
    locked: boolean
    sidePad: number
    pps: number
    /** @desc 已启用的时间记点（参考线 id → 秒数；null = 未填写） */
    timings?: readonly { refLineId: string; seconds: number | null }[]
}

/** @desc 一个待渲染的时间轴行（操作块或参考线），按 pos 排序后输出 */
interface TimelineRow {
    pos: number
    /** @desc 同 pos 时参考线排在操作块之前（参考线是分界标记） */
    rank: number
    text: string
    /** @desc 该行绑定的伤害子行（已渲染） */
    children: string[]
}

const renderSkillHit = (hit: { skillType: string; hitName: string }, count: number): string => {
    const name = hit.hitName.replace('伤害', '')
    return `${name}(${hit.skillType})${count > 1 ? ` ×${count}` : ''}`
}

const renderNonDirect = (nd: NonDirectEntry): string => {
    const parts = [`${nd.category}·${nd.name}`]
    if (nd.category === '效应' && nd.layers > 0) parts.push(`${nd.layers}层`)
    if ((nd.hits ?? 1) > 1) parts.push(`×${nd.hits}段`)
    if (nd.responders?.length) parts.push(`响应者=${nd.responders.join('/')}`)
    return parts.join(' ')
}

/** @desc 一个伤害块绑定的内容（命中按「技能类型+命中名」合并计数；非直伤逐条列） */
const damageChildrenOf = (block: DamageBlock): string[] => {
    const out: string[] = []
    const merged = new Map<string, { skillType: string; hitName: string; count: number }>()
    for (const hit of block.skillHits) {
        const key = `${hit.skillType}|${hit.hitName}`
        const existing = merged.get(key)
        if (existing) existing.count++
        else merged.set(key, { skillType: hit.skillType, hitName: hit.hitName, count: 1 })
    }
    for (const m of merged.values()) out.push(`        └ 伤害: ${renderSkillHit(m, m.count)}`)
    for (const nd of block.nonDirectEntries) out.push(`        └ 非直伤: ${renderNonDirect(nd)}`)
    return out
}

/**
 * @desc 渲染排轴：**按 pos 顺序**的一条时间线。
 * 每行给出秒数、**序号**、轨道与角色、操作内容；紧跟其绑定的伤害（只列命中名，不列倍率）。
 *
 * 序号与 `$lib/ai/refs` 的定位器完全同源：操作块按 (pos, 轨道) 编号、参考线按 pos 编号，
 * 因此「块3」「线2」可以直接喂给增删改工具（摘要里不出现内部 id）。
 */
export const renderTimelineDigest = (input: TimelineDigestInput): string => {
    const { sidePad, pps } = input
    const damageBySource = new Map<string, DamageBlock[]>()
    for (const db of input.damageBlocks) {
        const list = damageBySource.get(db.sourceId)
        if (list) list.push(db)
        else damageBySource.set(db.sourceId, [db])
    }
    const timingOf = new Map((input.timings ?? []).map((t) => [t.refLineId, t.seconds]))
    // 序号按时间先后分配（不依赖调用方传入顺序，保证与定位器一致）
    const orderedOps = [...input.opBlocks].sort((a, b) => a.pos - b.pos || a.trackIndex - b.trackIndex)
    const orderedRefs = [...input.refLines].sort((a, b) => a.pos - b.pos)
    const opNo = new Map(orderedOps.map((op, i) => [op.id, i + 1]))

    const rows: TimelineRow[] = []
    for (const op of orderedOps) {
        const track = input.trackLabels[op.trackIndex] ?? `轨${op.trackIndex + 1}`
        const flags = [op.intro ? '变奏入场' : '', op.switchback ? '切回' : ''].filter(Boolean)
        const text =
            `[块${opNo.get(op.id)}] 轨${op.trackIndex + 1} ${track} · ${op.key}` +
            (op.desc ? `「${op.desc}」` : '') +
            (flags.length ? `[${flags.join('·')}]` : '')
        rows.push({
            pos: op.pos,
            rank: 1,
            text,
            children: (damageBySource.get(op.id) ?? []).flatMap(damageChildrenOf)
        })
    }
    orderedRefs.forEach((rl, i) => {
        const seconds = timingOf.get(rl.id)
        const isTiming = timingOf.has(rl.id)
        const timing = isTiming
            ? `[记点 ${seconds === null || seconds === undefined ? '未填写' : fmtSeconds(seconds)}]`
            : ''
        rows.push({
            pos: rl.pos,
            rank: 0,
            text: `[线${i + 1}] ── 参考线「${rl.time || '未命名'}」${timing}`,
            children: (damageBySource.get(rl.id) ?? []).flatMap(damageChildrenOf)
        })
    })
    rows.sort((a, b) => a.pos - b.pos || a.rank - b.rank)

    const damageCount = input.damageBlocks.filter((d) => d.skillHits.length > 0 || d.nonDirectEntries.length > 0).length
    const header =
        `时间线（${input.opBlocks.length} 操作块 / ${damageCount} 伤害块 / ${input.refLines.length} 参考线；` +
        `${input.locked ? '已锁定' : '未锁定'}）；按时间顺序，方括号里是**序号**（增删改就用它），` +
        `倍率用 get_timeline_damage_list 按需查`
    if (rows.length === 0) return `${header}\n（时间线为空）`
    return [header, ...rows.flatMap((r) => [`${timePrefix(r.pos, sidePad, pps)} ${r.text}`, ...r.children])].join('\n')
}

// ── 绑定倍率（按需查询）──

/** @desc `getDamageList()` 的一行（时间轴上的一个已折算倍率） */
export interface DamageRatioRow {
    character: string
    name: string
    value: string
    baseType: string
    /** @desc 该行所属块的像素位置（store 里字段名是 time） */
    time: number
    element: string
}

/** @desc 渲染绑定的倍率明细：一行一个已折算倍率，按时间顺序 */
export const renderDamageRatioList = (rows: readonly DamageRatioRow[], sidePad: number, pps: number): string => {
    const header = `绑定倍率（${rows.length} 条；已按时间顺序，含效应/处决/响应的折算结果）`
    if (rows.length === 0) return `${header}\n（没有任何已绑定的伤害倍率）`
    const lines = rows.map((r) => {
        const parts = [`${r.character || '无'} · ${r.name} ${r.value}`]
        if (r.element) parts.push(r.element)
        if (r.baseType) parts.push(`${r.baseType}系数`)
        return `${timePrefix(r.time, sidePad, pps)} ${parts.join(' · ')}`
    })
    return [header, ...lines].join('\n')
}

// ── 拉表 ──

export interface CalculationDigestInput {
    entries: readonly DamageEntry[]
    /** @desc 条目 id → 已绑 Buff 名（顺序即库内顺序） */
    buffNamesOf: (entryId: string) => readonly string[]
    /** @desc 条目 id → 该条目的伤害类型（拉表里单独存，不在 DamageEntry 上） */
    damageTypesOf: (entryId: string) => readonly string[]
    /** @desc 条目 id → 该条目在时间轴上的像素位置（无位置传 undefined） */
    posOf: (entry: DamageEntry) => number | undefined
    sidePad: number
    pps: number
}

/** @desc 条目类型标记（效应 / 处决 / 响应 / 直伤） */
const entryKind = (e: DamageEntry): string => {
    if (e.isEffect) return '效应'
    if (e.isTuneBreak) return '处决'
    if (e.isTuneResponse) return '响应'
    return ''
}

/**
 * @desc 渲染拉表：按条目在时间轴上的顺序逐条给出「**序号** / 归属 / 名称 / 属性 / 伤害类型 / 已绑 Buff 名」。
 * 不列倍率、不列乘区数值 —— 前者用 `get_timeline_damage_list`，后者用 `get_buff_conf_detail`
 * 与 `get_damage_entry_buff_sources` 按需查；序号与 `$lib/ai/refs` 的 `resolveDamageEntry` 同源。
 */
export const renderCalculationDigest = (input: CalculationDigestInput): string => {
    const rows = input.entries.map((entry, order) => ({ entry, order, pos: input.posOf(entry) }))
    // 按时间轴顺序；无位置的条目排在最后（保持原始相对顺序）
    rows.sort((a, b) => (a.pos ?? Number.POSITIVE_INFINITY) - (b.pos ?? Number.POSITIVE_INFINITY) || a.order - b.order)
    const header =
        `拉表（${rows.length} 条伤害条目，按时间轴顺序，行首就是**序号**，工具参数填这个数字）；` +
        `乘区明细与引用用 get_buff_conf_detail / get_damage_entry_buff_sources 按需查`
    if (rows.length === 0) return `${header}\n（还没有任何伤害条目：先到排轴绑定伤害）`
    const lines = rows.map(({ entry, pos }, i) => {
        const kind = entryKind(entry)
        const buffs = input.buffNamesOf(entry.id)
        const damageTypes = input.damageTypesOf(entry.id)
        const parts = [
            `${entry.character || '无'} · ${entry.displayName}`,
            entry.damageElement || '无属性',
            damageTypes.length > 0 ? damageTypes.join('/') : '未定伤害类型',
            kind ? `[${kind}]` : '',
            buffs.length > 0 ? `Buff(${buffs.length}): ${buffs.join('、')}` : 'Buff: 无'
        ].filter(Boolean)
        return `${timePrefix(pos, input.sidePad, input.pps)} [${String(i + 1).padStart(2, '0')}] ${parts.join(' · ')}`
    })
    return [header, ...lines].join('\n')
}

// ── 工程 Buff 配置清单 ──

export interface BuffConfDigestItem {
    name: string
    scope: 'all' | number[]
    global: boolean
    starred: boolean
    condition?: string
    zoneCount: number
}

const scopeLabel = (scope: 'all' | number[]): string => {
    if (scope === 'all') return '全队'
    if (scope.length === 0) return '效应专属'
    return `角色${scope.map((i) => i + 1).join('/')}`
}

/** @desc 渲染 工程 Buff 配置清单：一行一条，行首是**序号**（不展开乘区，乘区明细用 get_buff_conf_detail） */
export const renderBuffConfList = (items: readonly BuffConfDigestItem[]): string => {
    const header =
        `工程 Buff 配置清单（${items.length} 条，行首就是**序号**，工具参数填这个数字）；` +
        `乘区明细用 get_buff_conf_detail，绑定关系见 get_damage_entries`
    if (items.length === 0) return `${header}\n（还没有任何 工程 Buff 配置）`
    const lines = items.map((b, i) => {
        const tags = [b.global ? '全局' : '', b.starred ? '★' : ''].filter(Boolean)
        return (
            `[${String(i + 1).padStart(2, '0')}] ${b.name}${tags.length ? `[${tags.join('')}]` : ''} · ${scopeLabel(b.scope)} · ${b.zoneCount} 乘区` +
            (b.condition ? ` · 条件: ${b.condition}` : '')
        )
    })
    return [header, ...lines].join('\n')
}
