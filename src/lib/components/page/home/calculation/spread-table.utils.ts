/**
 * @desc 铺开表（`spread-table.svelte`）的**纯计算层**：列序/叠层分组、列分隔线、
 * 「条目 × Buff」整表结构（可用性、表头标签、行统计）、勾选统计、伤害源页签与渐进渲染切片。
 *
 * 原先这些派生块全部内联在组件的 `<script>` 里（该文件曾 1400+ 行）。抽出的原则：
 * **只搬「输入 → 输出」的纯计算**，不搬交互状态机（框选、鼠标/键盘事件、滚动同步仍留在组件里），
 * 也不搬 DOM 测量（`getBoundingClientRect` 之类）。
 *
 * 依赖方向：本文件不 import 任何 store —— store 侧的能力（可用性判定、影响源查询、自然序比较、
 * 角色元素色）一律由调用方以**函数参数**注入，故这里可被独立测试、也避免「纯逻辑反向依赖 runes store」。
 */
import { LAYERED_BUFF_PATTERN, LAYERED_BUFF_VAR } from '$lib/calc/calculation.consts'
import type { BuffSet, DamageEntry } from '$lib/calc/calculation.types'
import type { PaneEffectSource } from '$lib/calc/pane-effects'
import type { CharSlot } from '$lib/types/project'
import { buffRelevantForNonDirect, entryCharIdx, isNonDirectDamage, zoneLabelsOf } from './damage-table.utils'

/** @desc 叠层分组：同「前缀+后缀」≥2 条成组；仅用于表头分组展示与分隔线，列本身仍每层一列 */
export interface FolderGroup {
    key: string
    prefix: string
    suffix: string
    buffs: BuffSet[]
}

/** @desc 叠层命名键（前缀+后缀）；不匹配叠层命名返回 null */
export const layeredKeyOf = (name: string): string | null => {
    const m = name.match(LAYERED_BUFF_PATTERN)
    return m ? m[1] + m[3] : null
}

/** @desc 单元格结构数据：只含「该格是否可用」——勾选态在模板里直接读 entryBuffSetIdMap，避免勾选触发整表结构重建 */
export interface CellData {
    buffId: string
    enabled: boolean
    /** @desc 该格是「影响源」：作用域指向本条目引用的角色面板，勾上后参与该角色在这一段的面板计算 */
    pane: boolean
}

export interface RowData {
    entry: DamageEntry
    cells: CellData[]
    enabledBuffIds: string[]
    splitBefore: boolean
}

/** @desc 表头单元格（第二行=列名行）：标签、分隔线、高亮时单元格内名称的宽度上限都在结构派生里一次算好 */
export interface HeadCell {
    ci: number
    label: string
    title: string
    isLayer: boolean
    enabled: number
    sepClass: string
    /** @desc 高亮时单元格内显示 buff 名的宽度上限：与表头一致，避免名称出现/消失改变列的 max-content 触发整表重排 */
    nameMaxClass: string
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

export interface GroupData {
    key: string
    charName: string
    kind: 'direct' | 'nondirect'
    rows: RowData[]
    /** @desc 与 columns 同索引：该组内每个 buff 列的可用条目数 */
    enabledCounts: number[]
    /** @desc 该组角色吃不到的 buff 列索引（组内无任何启用行）——表头直接筛掉 */
    visibleColIdx: number[]
    /** @desc 是否存在叠层列（决定表头是否两级） */
    hasFolder: boolean
    headerGroups: HeadGroupCell[]
    headerCols: HeadCell[]
    /** @desc 该组实际能用的全局 buff（scope/条件/乘区判定）——吃不到的全局 buff 不显示 */
    visibleGlobalBuffs: BuffSet[]
}

/**
 * @desc 列序（普通 buff 列）：非文件夹在前、文件夹在后；文件夹按成员数升序（越多越靠后）、
 * 同级按「前缀+后缀」自然排序，使同文件夹列连续。
 * @param compare 自然序比较函数（由调用方注入，其家在 store，不在此处 import）
 */
export const orderColumns = (rawColumns: readonly BuffSet[], compare: (a: string, b: string) => number): BuffSet[] => {
    const groupOf = new Map<string, BuffSet[]>()
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
export const buildFolderGroups = (columns: readonly BuffSet[]): Map<string, FolderGroup> => {
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

/** @desc 伤害源标识：直伤/处决/响应取引起它的角色；效应类非直伤条目不带 character（视为非角色引起） */
export const entrySourceOf = (e: DamageEntry): string => e.character ?? ''

/**
 * @desc 效应/处决/响应伤害实际读取的乘区、以及「该 buff 能不能勾到这个条目上」的判定，
 * 都搬到两表共用的 `damage-table.utils`（同一领域判定不重复维护）。
 */

/** @desc 整表结构构建的依赖（store 侧能力一律注入，见文件头注释） */
export interface SpreadTableDeps {
    columns: readonly BuffSet[]
    damageEntries: readonly DamageEntry[]
    charToIdx: Record<string, number>
    globalBuffs: readonly BuffSet[]
    team: readonly CharSlot[]
    folderGroupOf: ReadonlyMap<string, FolderGroup>
    /** @desc 单元格可用性判定（组件侧带模块级缓存的那一个） */
    enabledFor: (bs: BuffSet, entry: DamageEntry, charIdx: number) => boolean
    /** @desc 条目的「影响源」查询（scope 指向被引用角色、且改写其面板乘区的 Buff） */
    paneSourcesOf: (entryId: string) => Record<string, PaneEffectSource>
}

/** @desc 预计算整表「结构」数据：单元格可用性、表头标签/分隔线、行统计一次算好；勾选态不参与，故点单元格不重建整表 */
export const buildSpreadTable = (deps: SpreadTableDeps): GroupData[] => {
    const { columns: cols, charToIdx, globalBuffs, team, folderGroupOf, enabledFor, paneSourcesOf } = deps
    const groupMap = new Map<
        string,
        { charName: string; kind: 'direct' | 'nondirect'; items: { entry: DamageEntry; idx: number }[] }
    >()
    for (let i = 0; i < deps.damageEntries.length; i++) {
        const entry = deps.damageEntries[i]
        const isDirect = !isNonDirectDamage(entry)
        const key = `${entry.character ?? ''}|${isDirect ? 'direct' : 'nondirect'}`
        const g = groupMap.get(key) ?? {
            charName: entry.character ?? '',
            kind: isDirect ? ('direct' as const) : ('nondirect' as const),
            items: []
        }
        groupMap.set(key, g)
        g.items.push({ entry, idx: i })
    }

    const result: GroupData[] = []
    for (const [groupKey, g] of groupMap) {
        const enabledCounts: number[] = cols.map(() => 0)
        const rows: RowData[] = []
        for (const { entry, idx } of g.items) {
            const charIdx = entryCharIdx(entry, charToIdx)
            const cells: CellData[] = []
            const enabledBuffIds: string[] = []
            // 影响源：本条目引用的他角色面板会被哪些（作用域指向该角色的）Buff 改写
            const paneSources = paneSourcesOf(entry.id)
            for (let ci = 0; ci < cols.length; ci++) {
                const bs = cols[ci]
                const pane = paneSources[bs.id] !== undefined
                const enabled = enabledFor(bs, entry, charIdx) || pane
                cells.push({ buffId: bs.id, enabled, pane })
                if (enabled) {
                    enabledCounts[ci]++
                    enabledBuffIds.push(bs.id)
                }
            }
            rows.push({
                entry,
                cells,
                enabledBuffIds,
                // 不连续判定：排轴上紧邻的上一个伤害倍率不是由「当前伤害源」引起 → 视为一次不连续（同角色跨界直伤/非直伤不算断开）
                splitBefore: idx > 0 && entrySourceOf(deps.damageEntries[idx - 1]) !== entrySourceOf(entry)
            })
        }
        const visibleGlobalBuffs = globalBuffs.filter((gb) =>
            g.items.some(({ entry }) => {
                const charIdx = entryCharIdx(entry, charToIdx)
                return (
                    enabledFor(gb, entry, charIdx) && (!isNonDirectDamage(entry) || buffRelevantForNonDirect(gb, entry))
                )
            })
        )
        const visibleColIdx = cols.map((_, ci) => ci).filter((ci) => enabledCounts[ci] > 0)

        // 表头两行一次算好：第一行仅叠层组（组起点列输出 colspan 组名，普通列输出占位），第二行列名（叠层子列显示层号/层号+后缀）
        /** @desc 本组「影响源」列：被本组任一条目引用的角色面板，其改写者在该组内的并集 */
        const groupPaneSources = new Map<string, { charIdx: number; zoneIds: string[] }>()
        for (const { entry } of g.items) {
            for (const [id, src] of Object.entries(paneSourcesOf(entry.id))) {
                const existing = groupPaneSources.get(id)
                if (!existing) {
                    groupPaneSources.set(id, { charIdx: src.charIdx, zoneIds: [...src.zoneIds] })
                    continue
                }
                for (const z of src.zoneIds) if (!existing.zoneIds.includes(z)) existing.zoneIds.push(z)
            }
        }
        const headerGroups: HeadGroupCell[] = []
        const headerCols: HeadCell[] = []
        for (let p = 0; p < visibleColIdx.length; p++) {
            const ci = visibleColIdx[p]
            const bs = cols[ci]
            const nextId = p + 1 < visibleColIdx.length ? cols[visibleColIdx[p + 1]]?.id : undefined
            const sep = columnSepClass(folderGroupOf, bs.id, nextId)
            const grp = folderGroupOf.get(bs.id)
            const layerNum = grp ? (bs.name.match(LAYERED_BUFF_PATTERN)?.[2] ?? '') : ''
            // 影响源列：该 Buff 作用于被本组引用的角色，会改写那个角色的面板乘区
            const paneSrc = groupPaneSources.get(bs.id)
            const paneSource = paneSrc
                ? {
                      charName: team[paneSrc.charIdx]?.character ?? `角色${paneSrc.charIdx + 1}`,
                      zoneLabels: zoneLabelsOf(paneSrc.zoneIds)
                  }
                : undefined
            headerCols.push({
                ci,
                label: grp ? (grp.suffix.length <= 3 ? layerNum + grp.suffix : layerNum) : bs.name,
                title: bs.name,
                isLayer: grp !== undefined,
                enabled: enabledCounts[ci],
                sepClass: sep,
                // 与表头列宽上限对齐（叠层子列 43px、普通列 max-w-24 同宽 96px→106px）
                nameMaxClass: grp ? 'max-w-[43px]' : 'max-w-[106px]',
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

        result.push({
            key: groupKey,
            charName: g.charName,
            kind: g.kind,
            rows,
            enabledCounts,
            visibleColIdx,
            hasFolder: headerCols.some((hc) => hc.isLayer),
            headerGroups,
            headerCols,
            visibleGlobalBuffs
        })
    }
    return result
}

/**
 * @desc 勾选统计（已选数）：按「已绑定的 (条目, buff) 对」增量累加——成本 O(已绑定数)，而非 O(行×列)；
 * 仅供行头/列头 tooltip 展示，勾选变化不触发结构重建，只失效这两个标题表达式。
 */
export const buildSelectionStats = (
    tableData: readonly GroupData[],
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

/** @desc ── 伤害源切换（主内容区顶部）：按角色过滤要渲染的子表，减少一次要挂载的行/格 ── */
export const NONE_SOURCE_KEY = '\u0000none'

export interface SourceTab {
    key: string
    label: string
    /** @desc 角色名（无则 null，用于取头像与元素色；「其它」页签为 null） */
    char: string | null
    element: string
    count: number
}

/** @desc 子表归属的页签键：命中队伍槽位 → slot-N；无角色/未命中 → 「其它」 */
export const sourceKeyOf = (charToIdx: Record<string, number>, charName: string): string => {
    if (!charName) return NONE_SOURCE_KEY
    const ci = charToIdx[charName]
    return ci === undefined ? NONE_SOURCE_KEY : `slot-${ci}`
}

/**
 * @desc 页签固定为「角色1 / 角色2 / 角色3 / 其它」四个队伍维度（不做「全部」——全部子表同时渲染最卡）：
 * 有角色的槽位显示角色名+头像，空槽位显示「角色N」，两者都没有子表时该页签不出现；「其它」承载无角色的伤害源。
 */
export const buildSourceTabs = (args: {
    team: readonly CharSlot[]
    tableData: readonly GroupData[]
    charToIdx: Record<string, number>
    elementColorOf: (charName: string) => string
}): SourceTab[] => {
    const counts = new Map<string, number>()
    for (const g of args.tableData) {
        const key = sourceKeyOf(args.charToIdx, g.charName)
        counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const tabs: SourceTab[] = []
    args.team.forEach((slot, i) => {
        const key = `slot-${i}`
        const count = counts.get(key) ?? 0
        if (!slot.character && count === 0) return
        tabs.push({
            key,
            label: slot.character ?? `角色${i + 1}`,
            char: slot.character ?? null,
            element: args.elementColorOf(slot.character ?? ''),
            count
        })
    })
    tabs.push({
        key: NONE_SOURCE_KEY,
        label: '其它',
        char: null,
        element: args.elementColorOf(''),
        count: counts.get(NONE_SOURCE_KEY) ?? 0
    })
    return tabs
}

/** @desc 生效的页签：未手动选择（或所选页签已不存在）时取第一个有子表的页签 */
export const resolveActiveSource = (sourceKey: string | null, sourceTabs: readonly SourceTab[]): string | null =>
    sourceKey !== null && sourceTabs.some((t) => t.key === sourceKey)
        ? sourceKey
        : (sourceTabs.find((t) => t.count > 0)?.key ?? sourceTabs[0]?.key ?? null)

/** @desc 要渲染的子表下标：始终是 tableData 的原始下标——data-group / 框选 / 高亮 / 右键全选语义不变 */
export const shownGroupIdxOf = (
    tableData: readonly GroupData[],
    activeSource: string | null,
    charToIdx: Record<string, number>
): number[] => {
    if (activeSource === null) return tableData.map((_, gi) => gi)
    return tableData
        .map((g, gi) => (sourceKeyOf(charToIdx, g.charName) === activeSource ? gi : -1))
        .filter((gi) => gi >= 0)
}

/** @desc 顶部「全局 BUFF」条：当前页签涉及的子表里能吃到该全局 buff 的并集（去重，保持出现顺序） */
export const collectShownGlobalBuffs = (
    tableData: readonly GroupData[],
    shownGroupIdx: readonly number[]
): BuffSet[] => {
    const map = new Map<string, BuffSet>()
    for (const gi of shownGroupIdx) {
        for (const gb of tableData[gi].visibleGlobalBuffs) map.set(gb.id, gb)
    }
    return [...map.values()]
}

/** @desc 结构指纹（条目集合 + 列集合）：切换工程/队伍后重置分帧进度，避免沿用上一个大表的值而失去分帧保护 */
export const rowFingerprintOf = (damageEntries: readonly DamageEntry[], tableData: readonly GroupData[]): string =>
    `${damageEntries.map((e) => e.id).join('|')}\u0000${tableData.map((g) => g.visibleColIdx.join(',')).join('|')}`

/** @desc 已揭示的行（切片而非逐行 {#if} 判断：每帧只处理新增 chunk，且未揭示时复用原数组引用） */
export const visibleRowsOf = (rows: readonly RowData[], visibleRows: number): RowData[] =>
    visibleRows >= rows.length ? (rows as RowData[]) : rows.slice(0, visibleRows)

/** @desc 列头 tooltip（已选/可用 + 操作提示；影响源列附带其说明文案） */
export const columnHeadTitle = (hc: HeadCell, selCount: number, paneText: string): string =>
    `${hc.title}（${selCount}/${hc.enabled}）：单击高亮列，右键全选/全不选${hc.paneSource ? `\n${paneText}` : ''}`

/** @desc 行头 tooltip（已选/可用 + 操作提示） */
export const rowHeadTitle = (displayName: string, selCount: number, enabledCount: number): string =>
    `${displayName}：单击高亮行，右键全选/全不选（已选 ${selCount}/${enabledCount}）`
