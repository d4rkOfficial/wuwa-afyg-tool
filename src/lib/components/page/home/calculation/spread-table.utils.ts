/**
 * @desc 平铺拉表（`spread-table.svelte`：分类平铺 / 分段平铺）的**纯计算层**：列序/叠层分组、列分隔线、
 * 「条目 × Buff」整表结构（单元格状态、表头标签、行统计）、勾选统计、伤害源页签、
 * 分段平铺的记点切段与整表构建、渐进渲染切片。
 *
 * 范围界定：**只收「输入 → 输出」的纯计算**，交互状态机（框选、鼠标/键盘事件、滚动同步）
 * 仍留在组件里，也不含 DOM 测量（`getBoundingClientRect` 之类）。
 *
 * 依赖方向：本文件不 import 任何 store —— store 侧的能力（可用性判定、影响源查询、自然序比较、
 * 角色元素色）一律由调用方以**函数参数**注入，故这里可被独立测试、也避免「纯逻辑反向依赖 runes store」。
 */
import { LAYERED_BUFF_PATTERN, LAYERED_BUFF_VAR } from '$lib/calc/calculation.consts'
import type { BuffConf, DamageEntry } from '$lib/calc/calculation.types'
import type { PaneEffectSource } from '$lib/calc/pane-effects'
import type { CharSlot } from '$lib/types/project'
import { entryCharIdx, isNonDirectDamage, zoneLabelsOf } from './damage-table.utils'

/** @desc 叠层分组：同「前缀+后缀」≥2 条成组；仅用于表头分组展示与分隔线，列本身仍每层一列 */
export interface FolderGroup {
    key: string
    prefix: string
    suffix: string
    buffs: BuffConf[]
    /** @desc 手动文件夹的显示名（缺省时按叠层前缀+后缀渲染） */
    label?: string
}

/** @desc 叠层命名键（前缀+后缀）；不匹配叠层命名返回 null */
export const layeredKeyOf = (name: string): string | null => {
    const m = name.match(LAYERED_BUFF_PATTERN)
    return m ? m[1] + m[3] : null
}

// ── 表头列宽：字多就长宽，而不是无限折行 ─────────────────────────────────
/**
 * @desc 表头列宽口径（`spread-table.svelte` 的表头/表体列宽都从这里推导）。
 *
 * 为什么不用「固定 108px + 省略号」：工坊 Buff 名/文件夹名常是整句游戏文案，
 * 固定窄列下 3 行也放不完，截断后信息全丢。故**按文字量反推列宽**：
 * 先假定「最多 `lines` 行」，把文字摊到这几行上需要多宽，就把列加多宽（上限 `HEAD_COL_MAX_PX`）。
 *
 * 宽度是估算而非测量（不做 DOM 测量，见文件头「不搬 DOM 测量」）。估算必须与模板里的字体规格一致，
 * 否则「算出来刚好 3 行、实际溢到第 4 行」——实测就踩到过：文件夹横条带 `tracking-[0.1em]`
 * （10px 字号下每字多占 1px），漏算后长文案正好多折一行。故字距作为参数单独计入。
 */
export const HEAD_COL_MIN_PX = 108
/** @desc 上限：再长就由 `line-clamp` 收尾（完整文本仍在 `title` 里），避免单个病态长名把整表拉爆 */
export const HEAD_COL_MAX_PX = 420
/** @desc 表头单元格左右内边距合计（`px-1.5` × 2） */
export const HEAD_CELL_PAD_PX = 12
/**
 * @desc 估算余量（px）。实测（无头 Edge + 真产物 CSS，见 `.tmp/hdr-probe/fit.mjs`）：
 * 纯「字宽 ÷ 行数」算出来的宽度会比「3 行真实放得下」的最小宽度**少 1~2px** ——
 * 因为断行不能在「，」。】」前断开，实际每行比按字数均分的更短。留 10px 兜住这个损失。
 */
export const HEAD_WIDTH_SLACK_PX = 10
/** @desc 文件夹横条最多几行 */
export const HEAD_BAND_LINES = 3
/** @desc 列名行最多几行 */
export const HEAD_NAME_LINES = 2
/** @desc 文件夹横条的 `tracking-[0.1em]` 在 10px 字号下的额外字宽 */
export const HEAD_BAND_TRACKING_PX = 1

const CJK_RE = /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/

/** @desc 文本估算宽度（px）：CJK 10、其它 5.5（对齐 `text-[10px]`），另加 `trackingPx` 字距 */
export const headTextWidthPx = (text: string, trackingPx = 0): number => {
    let width = 0
    for (const ch of text) width += (CJK_RE.test(ch) ? 10 : 5.5) + trackingPx
    return width
}

/**
 * @desc 一段表头文字在 `span` 列内、最多 `lines` 行时，**每列**需要的宽度（px，含内边距）。
 * 结果夹在 `[HEAD_COL_MIN_PX, HEAD_COL_MAX_PX]`：低于下限没必要缩，高于上限就靠 `line-clamp` 收尾。
 */
export const headColumnWidthPx = (text: string, lines: number, span = 1, trackingPx = 0): number => {
    const perLine = Math.ceil(headTextWidthPx(text, trackingPx) / Math.max(1, lines))
    const total = Math.ceil(perLine * 1.02) + HEAD_CELL_PAD_PX + HEAD_WIDTH_SLACK_PX
    const clamped = Math.min(HEAD_COL_MAX_PX, Math.max(HEAD_COL_MIN_PX, total))
    return Math.ceil(clamped / Math.max(1, span))
}

/**
 * @desc 单元格**结构**数据：只含与勾选无关的判定 —— 勾选态在模板里直接读 `entryBuffSetIds`，
 * 「未达门槛」在渲染时现算（`spread-table.svelte` 的 `rulesMetOf`）。
 *
 * 分层为了性能：结构不依赖勾选 → 点一格不重建整张表（只有那一格的图标变）。
 */
export interface CellData {
    buffId: string
    /** @desc 可勾选（硬门槛 + 乘区属性/类型条件都满足）；false = 显示灰色禁止图标且点不动 */
    enabled: boolean
    /** @desc 硬门槛（作用域 + 该条目吃不吃这个乘区）是否通过：决定这一列在本表里要不要保留 */
    hardOk: boolean
    /** @desc 该格是「影响源」：作用域指向本条目引用的角色面板，勾上后参与该角色在这一段的面板计算 */
    pane: boolean
}

export interface RowData {
    entry: DamageEntry
    cells: CellData[]
    enabledBuffIds: string[]
    /** @desc 选中口径「连续行段」的段首：行上方画主题色分割线（两种平铺都用；口径见各建表函数） */
    runStart: boolean
    /** @desc 选中口径「连续行段」的段尾：行下方画主题色分割线 */
    runEnd: boolean
    /** @desc 该行是否可编辑（分段平铺：非选中来源的行只显示首列伤害信息，右侧绝对留白） */
    editable: boolean
}

/** @desc 表头单元格（列名行）：标签、分隔线、可用数都在结构派生里一次算好 */
export interface HeadCell {
    ci: number
    label: string
    title: string
    isLayer: boolean
    enabled: number
    sepClass: string
    /** @desc 单元格 tooltip 预算好，避免每次渲染为每格拼字符串 */
    titleOn: string
    titleOff: string
    /** @desc 该列是本组的「影响源」：作用域指向被本组某段伤害引用的角色面板 */
    paneSource?: { charName: string; zoneLabels: string[] }
}

export interface HeadGroupCell {
    span: number
    label?: string
    sepClass: string
}

/** @desc 渲染层统一的一张平铺表（分类平铺 = 每个「角色×直伤/非直伤」一张；分段平铺 = 每个时间段一张） */
export interface CalcTable {
    /** @desc 稳定 key（`{#each}` 用） */
    key: string
    /** @desc 表标题（分类平铺=角色名；分段平铺=参考线名） */
    title: string
    /** @desc 副标题（分类平铺=直伤/非直伤；分段平铺=时间范围） */
    subtitle: string
    /** @desc 标题配色用的元素名（分段/其它为空串 → 走默认文字色） */
    element: string
    rows: RowData[]
    /** @desc 与 columns 同索引：该表内「真正可用」的条目数（>0 的列才显示） */
    enabledCounts: number[]
    /** @desc 该表保留的 buff 列索引 */
    visibleColIdx: number[]
    /** @desc 是否存在叠层列（决定表头是否两级） */
    hasFolder: boolean
    headerGroups: HeadGroupCell[]
    headerCols: HeadCell[]
}

/** @desc 一个「伤害来源」的条目分组（分类平铺按它建表；页签也按它计数） */
export interface SourceEntryGroup {
    key: string
    /** @desc 角色名（「其它」为空串） */
    charName: string
    kind: 'direct' | 'nondirect' | 'other'
    entries: DamageEntry[]
}

/**
 * @desc 列序（普通 buff 列）：非文件夹在前、文件夹在后；文件夹按成员数升序（越多越靠后）、
 * 同级按「前缀+后缀」自然排序，使同文件夹列连续。
 * @param compare 自然序比较函数（由调用方注入，其家在 store，不在此处 import）
 */
export const orderColumns = (
    rawColumns: readonly BuffConf[],
    compare: (a: string, b: string) => number
): BuffConf[] => {
    const groupOf = new Map<string, BuffConf[]>()
    const order: string[] = []
    for (const b of rawColumns) {
        const k = layeredKeyOf(b.name)
        if (!k) continue
        if (!groupOf.has(k)) {
            groupOf.set(k, [])
            order.push(k)
        }
        groupOf.get(k)!.push(b)
    }
    const folderSet = new Set(order.filter((k) => groupOf.get(k)!.length >= 2))
    const items = rawColumns.filter((b) => {
        const k = layeredKeyOf(b.name)
        return !k || !folderSet.has(k)
    })
    const folders = order
        .filter((k) => folderSet.has(k))
        .sort((ka, kb) => {
            const ca = groupOf.get(ka)!.length
            const cb = groupOf.get(kb)!.length
            if (ca !== cb) return ca - cb
            return compare(ka, kb)
        })
    return [...items, ...folders.flatMap((k) => groupOf.get(k)!)]
}

/** @desc buffId → 叠层组（仅 ≥2 条的组登记） */
export const buildFolderGroups = (columns: readonly BuffConf[]): Map<string, FolderGroup> => {
    const map = new Map<string, FolderGroup>()
    const groups = new Map<string, FolderGroup>()
    for (const c of columns) {
        const m = c.name.match(LAYERED_BUFF_PATTERN)
        if (!m) continue
        const key = m[1] + m[3]
        const g = groups.get(key) ?? { key, prefix: m[1], suffix: m[3], buffs: [] }
        groups.set(key, g)
        g.buffs.push(c)
    }
    for (const g of groups.values()) {
        if (g.buffs.length < 2) continue
        for (const b of g.buffs) map.set(b.id, g)
    }
    return map
}

/**
 * @desc 列间分割线样式类：folder 组与 folder/普通 buff 接壤 → 主题色半透明实线加粗；
 * 其余 → 常规分隔线（border-right 单侧绘制避免重叠，最后一列不画）。
 */
export const columnSepClass = (
    folderGroupOf: ReadonlyMap<string, FolderGroup>,
    curId: string | undefined,
    nextId: string | undefined
): string => {
    if (nextId === undefined || curId === undefined) return ''
    const curGroup = folderGroupOf.get(curId)
    const nextGroup = folderGroupOf.get(nextId)
    const solid = (curGroup !== undefined || nextGroup !== undefined) && curGroup !== nextGroup
    return solid ? 'spread-sep-solid' : 'spread-sep'
}

/**
 * @desc 效应/处决/响应伤害实际读取的乘区、以及「该 buff 能不能勾到这个条目上」的判定，
 * 都搬到两表共用的 `damage-table.utils`（同一领域判定不重复维护）。
 */

/** @desc 单元格「与勾选无关」的状态判定结果（由组件注入的判定器给出） */
export interface CellState {
    /** @desc 不可勾（作用域/乘区不匹配，或乘区级伤害属性/类型条件不满足）→ 灰色禁止图标 */
    blocked: boolean
    /** @desc 硬门槛（作用域 + 乘区）通过：列是否保留看它，**不看**软条件 */
    hardOk: boolean
}

/** @desc 整表结构构建的依赖（store 侧能力一律注入，见文件头注释） */
export interface SpreadTableDeps {
    columns: readonly BuffConf[]
    charToIdx: Record<string, number>
    team: readonly CharSlot[]
    folderGroupOf: ReadonlyMap<string, FolderGroup>
    /** @desc 单元格结构判定（与勾选无关，组件侧带缓存） */
    stateFor: (bs: BuffConf, entry: DamageEntry, charIdx: number) => CellState
    /** @desc Buff 级门槛判定（**依赖勾选**：面板/生效集合随绑定变化）；只有隐藏不达门槛列时才会被调用 */
    rulesMetFor?: (bs: BuffConf, entry: DamageEntry) => boolean
    /** @desc 是否把「不达门槛」的列筛掉（全局偏好）；开启时结构会随勾选重建，关闭时结构稳定 */
    hideUnmetColumns?: boolean
    /** @desc 条目的「影响源」查询（scope 指向被引用角色、且改写其面板乘区的 Buff） */
    paneSourcesOf: (entryId: string) => Record<string, PaneEffectSource>
    /**
     * @desc 条目在**全量伤害序列**里的下标（分类平铺判定「不连续」用）：
     * 两个同源倍率在全量序列里不相邻 ⇒ 它们之间夹着别的来源的倍率 ⇒ 该行上方画分割线。
     */
    orderIndexOf?: (entryId: string) => number
}

/** @desc 某列是否算「真正可用」（决定列保留）：硬门槛必须过；开启「隐藏不达门槛列」时还要至少一行门槛达标 */
const columnCounted = (
    deps: Pick<SpreadTableDeps, 'rulesMetFor' | 'hideUnmetColumns'>,
    bs: BuffConf,
    entry: DamageEntry,
    state: CellState
): boolean => {
    if (!state.hardOk) return false
    if (!deps.hideUnmetColumns) return true
    return deps.rulesMetFor ? deps.rulesMetFor(bs, entry) : true
}

/**
 * @desc 把伤害条目按「伤害源」分组（分类平铺按它建表；页签计数也用它）。
 * 分组键与页签 key 同口径（`entrySourceKeyOf`）：角色在队伍里 → `slot-N:direct|nondirect`；否则「其它」。
 */
export const groupEntriesBySource = (
    entries: readonly DamageEntry[],
    charToIdx: Record<string, number>
): SourceEntryGroup[] => {
    const map = new Map<string, SourceEntryGroup>()
    for (const entry of entries) {
        const isDirect = !isNonDirectDamage(entry)
        const key = entrySourceKeyOf(charToIdx, entry)
        const charName = key === NONE_SOURCE_KEY ? '' : (entry.character ?? '')
        const group = map.get(key) ?? {
            key,
            charName,
            kind:
                key === NONE_SOURCE_KEY ? ('other' as const) : isDirect ? ('direct' as const) : ('nondirect' as const),
            entries: []
        }
        map.set(key, group)
        group.entries.push(entry)
    }
    return [...map.values()]
}

/**
 * @desc 分类平铺的一整张表（**只为选中来源构建**：分类平铺一次只显示一张子表，
 * 全量构建其它来源纯属浪费 —— 这是之前整表卡顿的主因之一）。
 *
 * 行间分割线：同源的两条倍率在全量伤害序列里**不相邻**，说明中间夹着别的来源的倍率（排轴上的一次
 * 不连续）→ 给后一条标 `runStart`，模板据此在它上方画一条主题色分割线（与分段平铺同一套类）。
 * 只标一侧：两行在表里相邻，若首尾都标会叠成 4px 的双线。
 */
export const buildCategorizedTable = (deps: SpreadTableDeps, group: SourceEntryGroup): CalcTable => {
    const { columns: cols, charToIdx, team, folderGroupOf, stateFor, paneSourcesOf, orderIndexOf } = deps
    const enabledCounts: number[] = cols.map(() => 0)
    const rows: RowData[] = []
    /** @desc 同源相邻两行是否「不连续」（全量序列里夹了别的来源）；未注入下标时一律按连续处理 */
    const discontinuous = (a: DamageEntry, b: DamageEntry): boolean =>
        orderIndexOf !== undefined && orderIndexOf(b.id) !== orderIndexOf(a.id) + 1
    for (let idx = 0; idx < group.entries.length; idx++) {
        const entry = group.entries[idx]
        const charIdx = entryCharIdx(entry, charToIdx)
        const cells: CellData[] = []
        const enabledBuffIds: string[] = []
        const paneSources = paneSourcesOf(entry.id)
        for (let ci = 0; ci < cols.length; ci++) {
            const bs = cols[ci]
            const pane = paneSources[bs.id] !== undefined
            const state = stateFor(bs, entry, charIdx)
            const enabled = !state.blocked || pane
            const hardOk = state.hardOk || pane
            cells.push({ buffId: bs.id, enabled, hardOk, pane })
            if (columnCounted(deps, bs, entry, state) || pane) enabledCounts[ci]++
            if (enabled) enabledBuffIds.push(bs.id)
        }
        const prev = idx > 0 ? group.entries[idx - 1] : undefined
        rows.push({
            entry,
            cells,
            enabledBuffIds,
            editable: true,
            // 只在**段首上方**画一条（两行在表里是相邻的，若首尾都标会叠成 4px 双线）；
            // 表首不加线（那里已有表头边框），表尾同理
            runStart: prev !== undefined && discontinuous(prev, entry),
            runEnd: false
        })
    }
    const visibleColIdx = cols.map((_, ci) => ci).filter((ci) => enabledCounts[ci] > 0)

    // 影响源：被本组任一条目引用的角色面板，其改写者在该组内的并集
    const groupPaneSources = new Map<string, { charIdx: number; zoneIds: string[] }>()
    for (const entry of group.entries) {
        for (const [id, src] of Object.entries(paneSourcesOf(entry.id))) {
            const existing = groupPaneSources.get(id)
            if (!existing) {
                groupPaneSources.set(id, { charIdx: src.charIdx, zoneIds: [...src.zoneIds] })
                continue
            }
            for (const z of src.zoneIds) if (!existing.zoneIds.includes(z)) existing.zoneIds.push(z)
        }
    }
    const { headerGroups, headerCols, hasFolder } = buildHeaderOf({
        columns: cols,
        visibleColIdx,
        enabledCounts,
        folderGroupOf,
        paneSourceOf: (buffId) => {
            const src = groupPaneSources.get(buffId)
            if (!src) return undefined
            return {
                charName: team[src.charIdx]?.character ?? `角色${src.charIdx + 1}`,
                zoneLabels: zoneLabelsOf(src.zoneIds)
            }
        }
    })

    return {
        key: group.key,
        title: group.charName || '无角色',
        subtitle: group.kind === 'direct' ? '直伤' : group.kind === 'nondirect' ? '非直伤' : '其它',
        element: group.charName,
        rows,
        enabledCounts,
        visibleColIdx,
        hasFolder,
        headerGroups,
        headerCols
    }
}

/**
 * @desc 表头（文件夹横条 + 列名行）一次性算好：分类平铺按「本组可见列」，分段平铺按「选中来源的可见列」。
 * 两处共用同一份实现，避免分隔线/叠层标签口径漂移。
 */
export const buildHeaderOf = (args: {
    columns: readonly BuffConf[]
    visibleColIdx: readonly number[]
    enabledCounts: readonly number[]
    folderGroupOf: ReadonlyMap<string, FolderGroup>
    /** @desc buffId → 影响源说明（分类平铺用；分段平铺不传） */
    paneSourceOf?: (buffId: string) => { charName: string; zoneLabels: string[] } | undefined
}): { headerGroups: HeadGroupCell[]; headerCols: HeadCell[]; hasFolder: boolean } => {
    const { columns: cols, visibleColIdx, enabledCounts, folderGroupOf } = args
    const headerGroups: HeadGroupCell[] = []
    const headerCols: HeadCell[] = []
    for (let p = 0; p < visibleColIdx.length; p++) {
        const ci = visibleColIdx[p]
        const bs = cols[ci]
        const nextId = p + 1 < visibleColIdx.length ? cols[visibleColIdx[p + 1]]?.id : undefined
        const sep = columnSepClass(folderGroupOf, bs.id, nextId)
        const grp = folderGroupOf.get(bs.id)
        const layerNum = grp ? (bs.name.match(LAYERED_BUFF_PATTERN)?.[2] ?? '') : ''
        const paneSource = args.paneSourceOf?.(bs.id)
        headerCols.push({
            ci,
            label: grp ? (grp.label ?? (grp.suffix.length <= 3 ? layerNum + grp.suffix : layerNum)) : bs.name,
            title: bs.name,
            isLayer: grp !== undefined,
            enabled: enabledCounts[ci] ?? 0,
            sepClass: sep,
            titleOn: `取消勾选：${bs.name}`,
            titleOff: `勾选：${bs.name}`,
            ...(paneSource ? { paneSource } : {})
        })
        if (!grp) {
            headerGroups.push({ span: 1, sepClass: sep })
            continue
        }
        const prevId = p > 0 ? cols[visibleColIdx[p - 1]]?.id : undefined
        if (p > 0 && folderGroupOf.get(prevId ?? '')?.key === grp.key) continue
        let run = 1
        for (let k = p + 1; k < visibleColIdx.length; k++) {
            if (folderGroupOf.get(cols[visibleColIdx[k]].id)?.key === grp.key) run++
            else break
        }
        const tailId = cols[visibleColIdx[p + run - 1]].id
        const afterTailId = p + run < visibleColIdx.length ? cols[visibleColIdx[p + run]]?.id : undefined
        headerGroups.push({
            span: run,
            label: grp.suffix.length <= 3 ? grp.prefix : grp.prefix + LAYERED_BUFF_VAR + grp.suffix,
            sepClass: columnSepClass(folderGroupOf, tailId, afterTailId)
        })
    }
    return { headerGroups, headerCols, hasFolder: headerCols.some((hc) => hc.isLayer) }
}

/**
 * @desc 勾选统计（已选数）：按「已绑定的 (条目, buff) 对」增量累加——成本 O(已绑定数)，而非 O(行×列)；
 * 仅供行头/列头 tooltip 展示，勾选变化不触发结构重建，只失效这两个标题表达式。
 */
export const buildSelectionStats = (
    tableData: readonly CalcTable[],
    entryBuffSetIdMap: Record<string, string[]>,
    colIndexById: ReadonlyMap<string, number>
): { colCounts: Map<number, number>[]; rowCounts: Map<string, number> } => {
    const colCounts = tableData.map(() => new Map<number, number>())
    const rowCounts = new Map<string, number>()
    const groupOfEntry = new Map<string, number>()
    const rowOfEntry = new Map<string, RowData>()
    for (let gi = 0; gi < tableData.length; gi++) {
        for (const row of tableData[gi].rows) {
            groupOfEntry.set(row.entry.id, gi)
            rowOfEntry.set(row.entry.id, row)
        }
    }
    for (const [entryId, ids] of Object.entries(entryBuffSetIdMap)) {
        if (ids.length === 0) continue
        const gi = groupOfEntry.get(entryId)
        const row = rowOfEntry.get(entryId)
        if (gi === undefined || !row) continue
        let n = 0
        for (const id of ids) {
            const ci = colIndexById.get(id)
            if (ci === undefined || !row.cells[ci]?.enabled) continue
            n++
            const m = colCounts[gi]
            m.set(ci, (m.get(ci) ?? 0) + 1)
        }
        if (n > 0) rowCounts.set(entryId, n)
    }
    return { colCounts, rowCounts }
}

/** @desc ── 伤害源切换（主内容区顶部）：页签 = 角色×(直伤/非直伤) + 其它；空页签不出现 ── */
export const NONE_SOURCE_KEY = '\u0000none'

/** @desc 来源维度：直伤 / 非直伤 / 其它（无角色或不属队伍的伤害） */
export type SourceKind = 'direct' | 'nondirect' | 'other'

export interface SourceTab {
    key: string
    label: string
    /** @desc 角色名（「其它」页签为 null，用于取头像与元素色） */
    char: string | null
    kind: SourceKind
    element: string
    /** @desc 该来源的伤害条目数（0 的页签不显示） */
    count: number
}

/** @desc 子表归属的页签键：命中队伍槽位 → `slot-N:direct|nondirect`；无角色/未命中 → 「其它」 */
export const sourceKeyOf = (
    charToIdx: Record<string, number>,
    charName: string,
    kind: 'direct' | 'nondirect' = 'direct'
): string => {
    if (!charName) return NONE_SOURCE_KEY
    const ci = charToIdx[charName]
    return ci === undefined ? NONE_SOURCE_KEY : `slot-${ci}:${kind}`
}

/**
 * @desc 页签 = 每个角色的「直伤」「非直伤」各一个 + 「其它」，**空表页签不显示**。
 * 计数直接来自条目分组（`groupEntriesBySource`），不需要先建整表 —— 切换页签才不会重算全量结构。
 */
export const buildSourceTabs = (args: {
    team: readonly CharSlot[]
    groups: readonly SourceEntryGroup[]
    elementColorOf: (charName: string) => string
}): SourceTab[] => {
    const counts = new Map<string, number>()
    for (const group of args.groups) counts.set(group.key, (counts.get(group.key) ?? 0) + group.entries.length)
    const tabs: SourceTab[] = []
    args.team.forEach((slot, i) => {
        if (!slot.character) return
        for (const [kind, suffix] of [
            ['direct', '直伤'],
            ['nondirect', '非直伤']
        ] as const) {
            const key = `slot-${i}:${kind}`
            const count = counts.get(key) ?? 0
            if (count === 0) continue
            tabs.push({
                key,
                label: `${slot.character}·${suffix}`,
                char: slot.character,
                kind,
                element: args.elementColorOf(slot.character),
                count
            })
        }
    })
    const otherCount = counts.get(NONE_SOURCE_KEY) ?? 0
    if (otherCount > 0) {
        tabs.push({
            key: NONE_SOURCE_KEY,
            label: '其它',
            char: null,
            kind: 'other',
            element: args.elementColorOf(''),
            count: otherCount
        })
    }
    return tabs
}

/** @desc 生效的页签：未手动选择（或所选页签已不存在/变空）时取第一个页签 */
export const resolveActiveSource = (sourceKey: string | null, sourceTabs: readonly SourceTab[]): string | null =>
    sourceKey !== null && sourceTabs.some((t) => t.key === sourceKey) ? sourceKey : (sourceTabs[0]?.key ?? null)

/** @desc 条目是否属于某页签（分段平铺：只有这些行可勾 Buff） */
export const entrySourceKeyOf = (charToIdx: Record<string, number>, entry: DamageEntry): string => {
    const isDirect = !isNonDirectDamage(entry)
    return sourceKeyOf(charToIdx, entry.character ?? '', isDirect ? 'direct' : 'nondirect')
}

/** @desc 结构指纹（条目集合 + 列集合）：切换工程/队伍后重置分帧进度，避免沿用上一个大表的值而失去分帧保护 */
export const rowFingerprintOf = (tables: readonly CalcTable[]): string =>
    tables.map((t) => `${t.key}:${t.rows.map((r) => r.entry.id).join(',')}|${t.visibleColIdx.join(',')}`).join(';')

/** @desc 已揭示的行（切片而非逐行 {#if} 判断：每帧只处理新增 chunk，且未揭示时复用原数组引用） */
export const visibleRowsOf = (rows: readonly RowData[], visibleRows: number): RowData[] =>
    visibleRows >= rows.length ? (rows as RowData[]) : rows.slice(0, visibleRows)

/** @desc 列头 tooltip（已选/可用 + 操作提示；影响源列附带其说明文案） */
export const columnHeadTitle = (hc: HeadCell, selCount: number, paneText: string): string =>
    `${hc.title}（${selCount}/${hc.enabled}）：单击高亮列，右键全选/全不选${hc.paneSource ? `\n${paneText}` : ''}`

/** @desc 行头 tooltip（已选/可用 + 操作提示） */
export const rowHeadTitle = (displayName: string, selCount: number, enabledCount: number): string =>
    `${displayName}：单击高亮行，右键全选/全不选（已选 ${selCount}/${enabledCount}）`

/* ────────────────────────── 分段平铺 ────────────────────────── */

/**
 * @desc 分段平铺的分割标记：**有记点的参考线**（`resultAnalysis.timings` 里 `seconds` 非空的那些）。
 * `pos` 用于把伤害条目切进不同的表；`seconds` 用于表名里的时间范围。
 */
export interface SegmentMarker {
    refLineId: string
    /** @desc 参考线名（表名用；空名回退「未命名参考线」） */
    name: string
    /** @desc 时间轴位置（px） */
    pos: number
    /** @desc 记点秒数 */
    seconds: number
}

/** @desc 记点 + 参考线 → 分割标记（按时间轴位置升序；无记点返回空数组） */
export const buildSegmentMarkers = (
    timings: readonly { refLineId: string; seconds: number | null }[],
    refLines: readonly { id: string; name: string; pos: number }[]
): SegmentMarker[] => {
    const byId = new Map(refLines.map((rl) => [rl.id, rl]))
    return timings
        .flatMap((timing) => {
            if (timing.seconds === null) return []
            const rl = byId.get(timing.refLineId)
            if (!rl) return []
            return [
                {
                    refLineId: rl.id,
                    name: rl.name.trim() || '未命名参考线',
                    pos: rl.pos,
                    seconds: timing.seconds
                }
            ]
        })
        .sort((a, b) => a.pos - b.pos)
}

/** @desc 一段时间段的切分规格（表名 + 时间范围 + 位置区间） */
export interface SegmentSpec {
    key: string
    /** @desc 表名（参考线名；第一条记点之前叫「开场」） */
    title: string
    /** @desc 时间范围文案（表副标题） */
    rangeText: string
    /** @desc 起始位置（含） */
    from: number
    /** @desc 结束位置（不含；null = 到最后） */
    to: number | null
}

/** @desc 秒数文案（一位小数，去尾 0） */
const secondsText = (seconds: number): string => `${Math.round(seconds * 10) / 10}s`

/**
 * @desc 分割标记 → 段规格：**每个标记开启一段**，直到下一个标记；第一个标记之前的一段叫「开场」。
 * 没有记点时退化成单张表（全部伤害），表名「全部伤害」。
 */
export const buildSegmentSpecs = (markers: readonly SegmentMarker[]): SegmentSpec[] => {
    if (markers.length === 0) {
        return [{ key: 'seg:all', title: '全部伤害', rangeText: '未配置时间记点', from: -Infinity, to: null }]
    }
    const specs: SegmentSpec[] = []
    const first = markers[0]
    if (first.pos > 0) {
        specs.push({
            key: 'seg:pre',
            title: '开场',
            rangeText: `0s ~ ${secondsText(first.seconds)}`,
            from: -Infinity,
            to: first.pos
        })
    }
    for (let i = 0; i < markers.length; i++) {
        const marker = markers[i]
        const next = markers[i + 1]
        specs.push({
            key: `seg:${marker.refLineId}`,
            title: marker.name,
            rangeText: `${secondsText(marker.seconds)} ~ ${next ? secondsText(next.seconds) : '结束'}`,
            from: marker.pos,
            to: next ? next.pos : null
        })
    }
    return specs
}

/**
 * @desc 标出「选中口径的连续行段」的段首 / 段尾：相邻行都属于选中来源才算连续，
 * 中间夹了别来源的行就断开 → 新段。模板据此在段首上方、段尾下方各画一条主题色分割线。
 * （就地写回 `rows`，因为行对象是同一次构建里刚 push 的临时对象。）
 */
const markSelectedRuns = (rows: RowData[]): void => {
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        row.runStart = row.editable && rows[i - 1]?.editable !== true
        row.runEnd = row.editable && rows[i + 1]?.editable !== true
    }
}

/**
 * @desc 分段平铺的整表构建：
 * - **行** = 全部伤害条目（按时间轴位置升序，位置相同保持原顺序），按段规格切进不同的表；
 * - **列** = 选中来源「能吃到的 Buff」的并集（`hardOk` 并集；列序与分类平铺同一份 columns 一致）；
 * - **可编辑** = 条目属于选中来源；其余行只显示首列伤害信息（模板里 `row.editable` 为 false → 首列灰化、右侧绝对留白）；
 * - **连续行段** = 相邻行都属于选中来源；段首 `runStart` / 段尾 `runEnd` 由模板画主题色分割线；
 * - **空段不建表** = 一条伤害都没有落进去的时段整张表丢掉（只剩表头的表是纯噪音）。
 */
export const buildSegmentedTables = (args: {
    specs: readonly SegmentSpec[]
    damageEntries: readonly DamageEntry[]
    /** @desc 条目 → 时间轴位置（px） */
    posOf: (entry: DamageEntry) => number
    charToIdx: Record<string, number>
    /** @desc 选中来源的页签 key（null = 还没得选 → 全部行不可编辑） */
    activeSource: string | null
    columns: readonly BuffConf[]
    folderGroupOf: ReadonlyMap<string, FolderGroup>
    stateFor: (bs: BuffConf, entry: DamageEntry, charIdx: number) => CellState
    /** @desc Buff 级门槛判定（隐藏不达门槛列时才需要，依赖勾选） */
    rulesMetFor?: (bs: BuffConf, entry: DamageEntry) => boolean
    /** @desc 是否隐藏「不达门槛」的列（全局偏好） */
    hideUnmetColumns?: boolean
}): CalcTable[] => {
    const { specs, damageEntries, posOf, charToIdx, activeSource, columns: cols } = args
    const ordered = damageEntries
        .map((entry, idx) => ({ entry, idx, pos: posOf(entry) }))
        .sort((a, b) => (a.pos === b.pos ? a.idx - b.idx : a.pos - b.pos))
    const editableOf = (entry: DamageEntry): boolean =>
        activeSource !== null && entrySourceKeyOf(charToIdx, entry) === activeSource

    /** @desc 选中来源「真正可用」的 Buff 列 = 该来源各行 `hardOk`（+ 门槛，若开启隐藏）的并集 */
    const enabledCounts: number[] = cols.map(() => 0)
    for (const { entry } of ordered) {
        if (!editableOf(entry)) continue
        const charIdx = entryCharIdx(entry, charToIdx)
        for (let ci = 0; ci < cols.length; ci++) {
            const state = args.stateFor(cols[ci], entry, charIdx)
            if (columnCounted(args, cols[ci], entry, state)) enabledCounts[ci]++
        }
    }
    const visibleColIdx = cols.map((_, ci) => ci).filter((ci) => enabledCounts[ci] > 0)
    const { headerGroups, headerCols, hasFolder } = buildHeaderOf({
        columns: cols,
        visibleColIdx,
        enabledCounts,
        folderGroupOf: args.folderGroupOf
    })

    const tables: CalcTable[] = specs.map((spec) => ({
        key: spec.key,
        title: spec.title,
        subtitle: spec.rangeText,
        element: '',
        rows: [],
        enabledCounts,
        visibleColIdx,
        hasFolder,
        headerGroups,
        headerCols
    }))
    const tableBySpec = new Map(tables.map((table, i) => [specs[i].key, table]))

    for (const { entry, pos } of ordered) {
        const spec = specs.find((s) => pos >= s.from && (s.to === null || pos < s.to)) ?? specs[specs.length - 1]
        const table = tableBySpec.get(spec.key)
        if (!table) continue
        const editable = editableOf(entry)
        const charIdx = entryCharIdx(entry, charToIdx)
        const cells: CellData[] = editable
            ? cols.map((bs) => {
                  const state = args.stateFor(bs, entry, charIdx)
                  return { buffId: bs.id, enabled: !state.blocked, hardOk: state.hardOk, pane: false }
              })
            : []
        table.rows.push({
            entry,
            cells,
            enabledBuffIds: cells.filter((cell) => cell.enabled).map((cell) => cell.buffId),
            runStart: false,
            runEnd: false,
            editable
        })
    }

    for (const table of tables) markSelectedRuns(table.rows)

    // 该时段一条伤害都没有 → 整张表不渲染（空表只剩表头，纯噪音）
    return tables.filter((table) => table.rows.length > 0)
}
