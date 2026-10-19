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
import type { DamageBlock, OpBlock, RefLine } from '$lib/calc/timeline.types'
import type { DamageEntry } from '$lib/calc/calculation.types'
import { autoConfigureTimings } from '$lib/calc/ref-line-timing'

/** @desc 秒数显示：保留两位（只用于配置或名称推导的参考线时间） */
export const fmtSeconds = (seconds: number): string => `${seconds.toFixed(2)}s`

/** @desc 有效记点秒数；缺失、非有限值与负数都不能当作真实时间 */
const isValidSeconds = (seconds: number | null | undefined): seconds is number =>
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0

// ── 排轴 ──

export interface TimelineDigestInput {
    opBlocks: readonly OpBlock[]
    refLines: readonly RefLine[]
    damageBlocks: readonly DamageBlock[]
    /** @desc 各轨显示名（下标 = trackIndex） */
    trackLabels: readonly string[]
    locked: boolean
    /** @desc 已启用的时间记点（参考线 id → 秒数；null = 未填写） */
    timings?: readonly { refLineId: string; seconds: number | null }[]
}

/** @desc 结构化排轴的一条伤害绑定内容（供 format:json 直接解析） */
export interface TimelineDigestDamage {
    skillHits: { skillType: string; hitName: string; count: number }[]
    nonDirectEntries: { category: string; name: string; layers: number; hits: number; responders: string[] }[]
}

/** @desc 结构化排轴的一行（操作块或参考线），按 pos 排序 */
export type TimelineDigestItem =
    | {
          kind: 'opBlock'
          no: number
          pos: number
          trackIndex: number
          character: string
          key: string
          desc: string
          intro: boolean
          switchback: boolean
          damage: TimelineDigestDamage
      }
    | {
          kind: 'refLine'
          no: number
          pos: number
          name: string
          /** @desc 分析里是否配置了该线的记点（即使值为 null / 非法） */
          hasTiming: boolean
          /** @desc 分析记点秒数；未配置为 null */
          seconds: number | null
          /** @desc 无有效记点时按名称自动推导的秒数；不适用为 null */
          autoSeconds: number | null
          damage: TimelineDigestDamage
      }

export interface TimelineDigestData {
    items: TimelineDigestItem[]
    damageBlockCount: number
    locked: boolean
}

const renderSkillHit = (hit: { skillType: string; hitName: string }, count: number): string => {
    const name = hit.hitName.replace('伤害', '')
    return `${name}(${hit.skillType})${count > 1 ? ` ×${count}` : ''}`
}

const renderNonDirect = (nd: {
    category: string
    name: string
    layers: number
    hits: number
    responders: string[]
}): string => {
    const parts = [`${nd.category}·${nd.name}`]
    if (nd.category === '效应' && nd.layers > 0) parts.push(`${nd.layers}层`)
    if (nd.hits > 1) parts.push(`×${nd.hits}段`)
    if (nd.responders.length) parts.push(`响应者=${nd.responders.join('/')}`)
    return parts.join(' ')
}

/** @desc 一个伤害块绑定的结构化内容（命中按「技能类型+命中名」合并计数；非直伤逐条列） */
const damageDataOf = (block: DamageBlock): TimelineDigestDamage => {
    const merged = new Map<string, { skillType: string; hitName: string; count: number }>()
    for (const hit of block.skillHits) {
        const key = `${hit.skillType}|${hit.hitName}`
        const existing = merged.get(key)
        if (existing) existing.count++
        else merged.set(key, { skillType: hit.skillType, hitName: hit.hitName, count: 1 })
    }
    return {
        skillHits: [...merged.values()],
        nonDirectEntries: block.nonDirectEntries.map((nd) => ({
            category: nd.category,
            name: nd.name,
            layers: nd.layers,
            hits: nd.hits ?? 1,
            responders: nd.responders ?? []
        }))
    }
}

const damageChildrenOf = (damage: TimelineDigestDamage): string[] => [
    ...damage.skillHits.map((hit) => `        └ 伤害: ${renderSkillHit(hit, hit.count)}`),
    ...damage.nonDirectEntries.map((nd) => `        └ 非直伤: ${renderNonDirect(nd)}`)
]

/**
 * @desc 把排轴整理成结构化数据：按 pos 排序，操作块 / 参考线各自带序号与已绑定伤害。
 * 序号与 `$lib/ai/refs` 的定位器完全同源（操作块按 pos、轨道编号，参考线按 pos 编号）。
 * 文本渲染与 `format:json` 共用这一份数据，避免两种输出口径漂移。
 */
export const buildTimelineDigestData = (input: TimelineDigestInput): TimelineDigestData => {
    const damageBySource = new Map<string, DamageBlock[]>()
    for (const db of input.damageBlocks) {
        const list = damageBySource.get(db.sourceId)
        if (list) list.push(db)
        else damageBySource.set(db.sourceId, [db])
    }
    const timingOf = new Map((input.timings ?? []).map((t) => [t.refLineId, t.seconds]))
    // 优先采用有效的分析记点；全部不可用时，才按数据分析的自动配置规则推导。
    const hasConfiguredTime = input.refLines.some((rl) => rl.id !== 'left' && isValidSeconds(timingOf.get(rl.id)))
    const sourcePos = new Map([...input.opBlocks, ...input.refLines].map((source) => [source.id, source.pos]))
    const damagePositions = input.damageBlocks
        .filter((db) => db.skillHits.length > 0 || db.nonDirectEntries.length > 0)
        .map((db) => sourcePos.get(db.sourceId))
        .filter((pos): pos is number => pos !== undefined)
    const inferredTimingOf = new Map(
        (hasConfiguredTime
            ? []
            : autoConfigureTimings(
                  input.refLines.filter((rl) => rl.id !== 'left'),
                  (pos) => damagePositions.some((damagePos) => damagePos > pos)
              )
        ).map((t) => [t.refLineId, t.seconds])
    )
    // 序号按时间先后分配（不依赖调用方传入顺序，保证与定位器一致）
    const orderedOps = [...input.opBlocks].sort((a, b) => a.pos - b.pos || a.trackIndex - b.trackIndex)
    const orderedRefs = [...input.refLines].sort((a, b) => a.pos - b.pos)
    const opNo = new Map(orderedOps.map((op, i) => [op.id, i + 1]))

    const items: TimelineDigestItem[] = []
    for (const op of orderedOps) {
        items.push({
            kind: 'opBlock',
            no: opNo.get(op.id) ?? 0,
            pos: op.pos,
            trackIndex: op.trackIndex,
            character: input.trackLabels[op.trackIndex] ?? `轨${op.trackIndex + 1}`,
            key: op.key,
            desc: op.desc ?? '',
            intro: Boolean(op.intro),
            switchback: Boolean(op.switchback),
            damage: (damageBySource.get(op.id) ?? []).reduce(
                (acc, db) => {
                    const part = damageDataOf(db)
                    acc.skillHits.push(...part.skillHits)
                    acc.nonDirectEntries.push(...part.nonDirectEntries)
                    return acc
                },
                { skillHits: [], nonDirectEntries: [] } as TimelineDigestDamage
            )
        })
    }
    orderedRefs.forEach((rl, i) => {
        const seconds = timingOf.get(rl.id)
        const inferredSeconds = inferredTimingOf.get(rl.id)
        items.push({
            kind: 'refLine',
            no: i + 1,
            pos: rl.pos,
            name: rl.time || '未命名',
            hasTiming: timingOf.has(rl.id),
            seconds: isValidSeconds(seconds) ? seconds : null,
            autoSeconds: !isValidSeconds(seconds) && isValidSeconds(inferredSeconds) ? inferredSeconds : null,
            damage: (damageBySource.get(rl.id) ?? []).reduce(
                (acc, db) => {
                    const part = damageDataOf(db)
                    acc.skillHits.push(...part.skillHits)
                    acc.nonDirectEntries.push(...part.nonDirectEntries)
                    return acc
                },
                { skillHits: [], nonDirectEntries: [] } as TimelineDigestDamage
            )
        })
    })
    // 同 pos 时参考线排在操作块之前（参考线是分界标记）
    items.sort((a, b) => a.pos - b.pos || (a.kind === 'refLine' ? 0 : 1) - (b.kind === 'refLine' ? 0 : 1))
    return {
        items,
        damageBlockCount: input.damageBlocks.filter((d) => d.skillHits.length > 0 || d.nonDirectEntries.length > 0)
            .length,
        locked: input.locked
    }
}

/** @desc 渲染排轴文本：**按 pos 顺序**的一条时间线（不含倍率） */
export const renderTimelineDigest = (input: TimelineDigestInput): string => {
    const data = buildTimelineDigestData(input)
    const header =
        `时间线（${input.opBlocks.length} 操作块 / ${data.damageBlockCount} 伤害块 / ${input.refLines.length} 参考线；` +
        `${input.locked ? '已锁定' : '未锁定'}）；按排轴顺序，方括号里是**序号**（增删改就用它）；` +
        `排轴位置不代表秒数，参考线时间优先取分析记点，无有效记点时自动推导；` +
        `倍率用 get_timeline_damage_list 按需查`
    if (data.items.length === 0) return `${header}\n（时间线为空）`
    const lines = data.items.flatMap((item) => {
        if (item.kind === 'refLine') {
            const timing =
                item.seconds !== null ? `[记点 ${fmtSeconds(item.seconds)}]` : item.hasTiming ? '[记点 未填写]' : ''
            const inferred = item.autoSeconds !== null ? `[自动推导 ${fmtSeconds(item.autoSeconds)}]` : ''
            return [`[线${item.no}] ── 参考线「${item.name}」${timing}${inferred}`, ...damageChildrenOf(item.damage)]
        }
        const flags = [item.intro ? '变奏入场' : '', item.switchback ? '切回' : ''].filter(Boolean)
        const text =
            `[块${item.no}] 轨${item.trackIndex + 1} ${item.character} · ${item.key}` +
            (item.desc ? `「${item.desc}」` : '') +
            (flags.length ? `[${flags.join('·')}]` : '')
        return [text, ...damageChildrenOf(item.damage)]
    })
    return [header, ...lines].join('\n')
}

// ── 绑定倍率（按需查询）──

/** @desc `getDamageList()` 的一行（时间轴上的一个已折算倍率） */
export interface DamageRatioRow {
    character: string
    name: string
    value: string
    baseType: string
    /** @desc 该行所属块的像素位置（仅作排序用，与秒数无关） */
    pos: number
    element: string
}

/** @desc 渲染绑定的倍率明细：按排轴顺序编号，不把所属块的位置换算为秒数 */
export const renderDamageRatioList = (rows: readonly DamageRatioRow[]): string => {
    const header = `绑定倍率（${rows.length} 条；已按排轴顺序，含效应/处决/响应的折算结果；序号不代表秒数）`
    if (rows.length === 0) return `${header}\n（没有任何已绑定的伤害倍率）`
    const lines = [...rows]
        .sort((a, b) => a.pos - b.pos)
        .map((r, i) => {
            const parts = [`${r.character || '无'} · ${r.name} ${r.value}`]
            if (r.element) parts.push(r.element)
            if (r.baseType) parts.push(`${r.baseType}系数`)
            return `[${String(i + 1).padStart(2, '0')}] ${parts.join(' · ')}`
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
    /** @desc 是否在行尾附上稳定条目 id（与 get_result_summary 的 entryId 对齐；默认不附） */
    includeIds?: boolean
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
        `已附倍率；乘区明细与引用用 get_buff_conf_detail / get_damage_entry_buff_sources 按需查`
    if (rows.length === 0) return `${header}\n（还没有任何伤害条目：先到排轴绑定伤害）`
    const lines = rows.map(({ entry }, i) => {
        const kind = entryKind(entry)
        const buffs = input.buffNamesOf(entry.id)
        const damageTypes = input.damageTypesOf(entry.id)
        const ratio = entry.ratioUnit === 'fixed' ? `固定 ${entry.ratioValue}` : `${entry.ratioValue}%`
        const parts = [
            `${entry.character || '无'} · ${entry.displayName}`,
            `倍率 ${ratio}`,
            entry.damageElement || '无属性',
            damageTypes.length > 0 ? damageTypes.join('/') : '未定伤害类型',
            kind ? `[${kind}]` : '',
            buffs.length > 0 ? `Buff(${buffs.length}): ${buffs.join('、')}` : 'Buff: 无'
        ].filter(Boolean)
        const id = input.includeIds ? ` · id=${entry.id}` : ''
        return `[${String(i + 1).padStart(2, '0')}] ${parts.join(' · ')}${id}`
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
    /** @desc 按乘区过滤时附加的命中乘区摘要（未过滤时省略） */
    zoneSummary?: string
}

export const scopeLabel = (scope: 'all' | number[]): string => {
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
            (b.condition ? ` · 条件: ${b.condition}` : '') +
            (b.zoneSummary ? ` · 命中: ${b.zoneSummary}` : '')
        )
    })
    return [header, ...lines].join('\n')
}
