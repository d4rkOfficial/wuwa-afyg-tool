<script lang="ts">
    import type { BuffSet, DamageEntry } from './calculation.types'
    import type { CharSlot } from '$lib/data/types'
    import type { ConditionProfile } from '../result/compute'
    import { conditionMet } from '../result/compute'
    import { inferDamageTypes } from '../result/utils'
    import { DAMAGE_TYPES, DAMAGE_TYPE_SHORT, LAYERED_BUFF_PATTERN } from './calculation.consts'
    import { getCalcElementMap } from './calculation.store.svelte'
    import { getDamageTypeEditMode, getScrollAxisDefault, setScrollAxisDefault } from '$lib/data/calc-view.svelte'
    import Icon from '@iconify/svelte'

    interface Props {
        team: [CharSlot, CharSlot, CharSlot]
        damageEntries: DamageEntry[]
        buffSets: BuffSet[]
        entryBuffSetIdMap: Record<string, string[]>
        entryDamageTypeMap: Record<string, string[]>
        globalBuffSetIds: string[]
        conditionProfile: ConditionProfile
        hideConditionMismatch: boolean
        onToggle: (entryId: string, buffId: string) => void
        onToggleDamageType: (entryId: string, damageType: string) => void
        onSetEntryBuffSetIds: (entryId: string, ids: string[]) => void
    }

    let {
        team,
        damageEntries,
        buffSets,
        entryBuffSetIdMap,
        entryDamageTypeMap,
        globalBuffSetIds,
        conditionProfile,
        hideConditionMismatch,
        onToggle,
        onToggleDamageType,
        onSetEntryBuffSetIds
    }: Props = $props()

    const columns = $derived(buffSets.filter((b) => !globalBuffSetIds.includes(b.id)))
    const globalBuffs = $derived(buffSets.filter((b) => globalBuffSetIds.includes(b.id)))

    // 叠层 folder 归属：名字匹配「前缀+数字+后缀」且同前缀 ≥2 条 → 视为紧密相连的倍率条目组
    const folderPrefixOf = $derived.by(() => {
        const groups = new Map<string, number>()
        for (const c of columns) {
            const m = c.name.match(LAYERED_BUFF_PATTERN)
            if (m) {
                const key = m[1] + m[3]
                groups.set(key, (groups.get(key) ?? 0) + 1)
            }
        }
        const map = new Map<string, string>()
        for (const c of columns) {
            const m = c.name.match(LAYERED_BUFF_PATTERN)
            if (m) {
                const key = m[1] + m[3]
                if ((groups.get(key) ?? 0) >= 2) map.set(c.id, key)
            }
        }
        return map
    })

    // 列间分割线：同一 folder 内部 → 虚线；folder 与 folder/普通 buff 接壤 → 主题色半透明实线加粗；普通 buff 之间 → 虚线。
    // 以 border-right 绘制（相邻列只画一侧，避免 separate 模式下边框重叠）；最后一列不画（表格右边缘由 table 边框提供）
    const colBorderStyle = (curId: string, nextId: string | undefined): string => {
        if (nextId === undefined) return ''
        const curFolder = folderPrefixOf.get(curId)
        const nextFolder = folderPrefixOf.get(nextId)
        const solid = (curFolder !== undefined || nextFolder !== undefined) && curFolder !== nextFolder
        return solid
            ? 'border-right: 2px solid color-mix(in srgb, var(--theme-accent-bg) 50%, transparent);'
            : 'border-right: 1px dashed var(--theme-divider-border);'
    }

    const inferredDamageTypeMap = $derived<Record<string, string[]>>(
        Object.fromEntries(damageEntries.map((e) => [e.id, inferDamageTypes(e)]))
    )

    const charToIdx = $derived<Record<string, number>>(
        Object.fromEntries(team.map((s, i) => [s.character ?? '', i]).filter(([name]) => name !== ''))
    )

    interface CellData {
        buffId: string
        enabled: boolean
        selected: boolean
    }
    interface RowData {
        entry: DamageEntry
        cells: CellData[]
        enabledBuffIds: string[]
        selectedCount: number
        allSelected: boolean
        partial: boolean
        splitBefore: boolean
    }
    interface ColStat {
        enabled: number
        selected: number
    }
    interface GroupData {
        charName: string
        kind: 'direct' | 'nondirect'
        rows: RowData[]
        colStats: ColStat[]
        // 该组角色吃不到的 buff 列索引（组内无任何启用行）——表头直接筛掉
        visibleColIdx: number[]
    }

    // 预计算整表数据：单元格可用性/选中态、行/列统计、不连续分割标记一次算好，模板零逻辑
    const tableData = $derived.by(() => {
        const cols = columns
        const groupMap = new Map<
            string,
            { charName: string; kind: 'direct' | 'nondirect'; items: { entry: DamageEntry; idx: number }[] }
        >()
        for (let i = 0; i < damageEntries.length; i++) {
            const entry = damageEntries[i]
            const isDirect = !entry.isEffect && !entry.isTuneBreak && !entry.isTuneResponse
            const key = `${entry.character ?? ''}|${isDirect ? 'direct' : 'nondirect'}`
            let g = groupMap.get(key)
            if (!g) {
                g = {
                    charName: entry.character ?? '',
                    kind: isDirect ? 'direct' : 'nondirect',
                    items: []
                }
                groupMap.set(key, g)
            }
            g.items.push({ entry, idx: i })
        }

        const result: GroupData[] = []
        for (const g of groupMap.values()) {
            const colStats: ColStat[] = cols.map(() => ({ enabled: 0, selected: 0 }))
            const rows: RowData[] = []
            let prevIdx = -Infinity
            for (const { entry, idx } of g.items) {
                const charIdx = entry.character ? (charToIdx[entry.character] ?? -1) : -1
                const cells: CellData[] = []
                for (let ci = 0; ci < cols.length; ci++) {
                    const bs = cols[ci]
                    const scopeOk = entry.isEffect
                        ? bs.scope === 'all' || (Array.isArray(bs.scope) && bs.scope.length === 0)
                        : charIdx >= 0 && (bs.scope === 'all' || (bs.scope as number[]).includes(charIdx))
                    const enabled =
                        scopeOk &&
                        (!hideConditionMismatch ||
                            conditionMet(bs, conditionProfile, charIdx, entry, entryDamageTypeMap))
                    // selected 反映真实绑定状态（含条件不匹配但已勾选的 buff，用于降透明度展示）
                    const selected = (entryBuffSetIdMap[entry.id] ?? []).includes(bs.id)
                    cells.push({ buffId: bs.id, enabled, selected })
                    if (enabled) colStats[ci].enabled++
                    if (enabled && selected) colStats[ci].selected++
                }
                const enabledBuffIds = cells.filter((c) => c.enabled).map((c) => c.buffId)
                const selectedCount = enabledBuffIds.filter((id) =>
                    (entryBuffSetIdMap[entry.id] ?? []).includes(id)
                ).length
                rows.push({
                    entry,
                    cells,
                    enabledBuffIds,
                    selectedCount,
                    allSelected: enabledBuffIds.length > 0 && selectedCount === enabledBuffIds.length,
                    partial: selectedCount > 0 && selectedCount < enabledBuffIds.length,
                    splitBefore: idx - prevIdx > 1
                })
                prevIdx = idx
            }
            result.push({
                charName: g.charName,
                kind: g.kind,
                rows,
                colStats,
                visibleColIdx: cols.map((_, ci) => ci).filter((ci) => colStats[ci].enabled > 0)
            })
        }
        return result
    })

    function toggleCell(row: RowData, cell: CellData) {
        onToggle(row.entry.id, cell.buffId)
    }

    function toggleColumn(group: GroupData, ci: number) {
        const col = columns[ci]
        const stat = group.colStats[ci]
        const enabledRows = group.rows.filter((r) => r.cells[ci].enabled)
        if (enabledRows.length === 0) return
        const allSelected = stat.selected > 0 && stat.selected === stat.enabled
        for (const r of enabledRows) {
            const cur = entryBuffSetIdMap[r.entry.id] ?? []
            onSetEntryBuffSetIds(
                r.entry.id,
                allSelected ? cur.filter((id) => id !== col.id) : cur.includes(col.id) ? cur : [...cur, col.id]
            )
        }
    }

    function toggleRow(row: RowData) {
        if (row.enabledBuffIds.length === 0) return
        const cur = new Set(entryBuffSetIdMap[row.entry.id] ?? [])
        const next = new Set(cur)
        for (const id of row.enabledBuffIds) {
            if (row.allSelected) next.delete(id)
            else next.add(id)
        }
        onSetEntryBuffSetIds(row.entry.id, [...next])
    }

    // ── 框选批量生效/失效（拖拽矩形范围：范围内有已勾选 → 全部取消，否则全部勾选） ──
    let rootEl = $state<HTMLDivElement | undefined>()
    let selStart: { g: number; r: number; c: number; x: number; y: number } | null = null
    let selStartTd: HTMLElement | null = null
    let selCurrentTd: HTMLElement | null = null
    let selCurrent = $state<{ r: number; c: number } | null>(null)
    let dragging = $state(false)
    let justDragged = false
    let selRect = $state<{ left: number; top: number; width: number; height: number } | null>(null)
    let lastMouseX = 0
    let lastMouseY = 0

    function cancelSelection() {
        selStart = null
        selStartTd = null
        selCurrentTd = null
        selCurrent = null
        dragging = false
        justDragged = false
        selRect = null
    }

    function handleMouseDown(e: MouseEvent) {
        if (e.button !== 0) return
        const td = (e.target as HTMLElement).closest<HTMLElement>('td[data-row][data-col]')
        if (!td) return
        selStart = {
            g: Number(td.dataset.group),
            r: Number(td.dataset.row),
            c: Number(td.dataset.col),
            x: e.clientX,
            y: e.clientY
        }
        selStartTd = td
        selCurrentTd = td
        selCurrent = { r: selStart.r, c: selStart.c }
        dragging = false
    }

    // 滚动后同步框选：按鼠标最后位置更新当前单元格，并重算选区矩形（滚动不破坏框选）
    function syncSelectionRect() {
        if (!selStart || !selStartTd) return
        if (dragging) {
            const el = document.elementFromPoint(lastMouseX, lastMouseY)
            const td = el?.closest?.<HTMLElement>('td[data-row][data-col]')
            if (td && Number(td.dataset.group) === selStart.g) {
                selCurrentTd = td
                selCurrent = { r: Number(td.dataset.row), c: Number(td.dataset.col) }
            }
        }
        const curTd = selCurrentTd ?? selStartTd
        const a = selStartTd.getBoundingClientRect()
        const b = curTd.getBoundingClientRect()
        selRect = {
            left: Math.min(a.left, b.left),
            top: Math.min(a.top, b.top),
            width: Math.max(a.right, b.right) - Math.min(a.left, b.left),
            height: Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top)
        }
    }

    function handleMouseMove(e: MouseEvent) {
        if (!selStart || !selStartTd) return
        lastMouseX = e.clientX
        lastMouseY = e.clientY
        if (!dragging && Math.hypot(e.clientX - selStart.x, e.clientY - selStart.y) < 4) return
        dragging = true
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const td = el?.closest?.<HTMLElement>('td[data-row][data-col]')
        if (td && Number(td.dataset.group) === selStart.g) {
            selCurrentTd = td
            selCurrent = { r: Number(td.dataset.row), c: Number(td.dataset.col) }
        }
        const a = selStartTd.getBoundingClientRect()
        const b = (selCurrentTd ?? selStartTd).getBoundingClientRect()
        selRect = {
            left: Math.min(a.left, b.left),
            top: Math.min(a.top, b.top),
            width: Math.max(a.right, b.right) - Math.min(a.left, b.left),
            height: Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top)
        }
    }

    function handleMouseUp() {
        if (selStart && dragging) {
            justDragged = true
            applySelection()
            setTimeout(() => {
                justDragged = false
            }, 0)
        }
        cancelSelection()
    }

    function handleClickCapture(e: MouseEvent) {
        // 框选结束后拦截单元格 click，避免误触发单选
        if (justDragged) {
            e.preventDefault()
            e.stopPropagation()
            justDragged = false
        }
    }

    // 方向键滚动：↑↓ 沿「主轴」（默认滚动方向），←→ 沿次轴；Shift 键本身直接切换默认方向
    const ARROW_STEP = 60
    function handleArrowKey(e: KeyboardEvent) {
        if (!rootEl) return
        const axis = getScrollAxisDefault()
        let dx = 0
        let dy = 0
        switch (e.key) {
            case 'ArrowUp':
                if (axis === 'vertical') dy = -ARROW_STEP
                else dx = -ARROW_STEP
                break
            case 'ArrowDown':
                if (axis === 'vertical') dy = ARROW_STEP
                else dx = ARROW_STEP
                break
            case 'ArrowLeft':
                if (axis === 'vertical') dx = -ARROW_STEP
                else dy = -ARROW_STEP
                break
            case 'ArrowRight':
                if (axis === 'vertical') dx = ARROW_STEP
                else dy = ARROW_STEP
                break
            default:
                return
        }
        e.preventDefault()
        rootEl.scrollBy({ left: dx, top: dy })
    }

    function applySelection() {
        if (!selStart || !selCurrent) return
        const group = tableData[selStart.g]
        if (!group) return
        const r0 = Math.min(selStart.r, selCurrent.r)
        const r1 = Math.max(selStart.r, selCurrent.r)
        const c0 = Math.min(selStart.c, selCurrent.c)
        const c1 = Math.max(selStart.c, selCurrent.c)
        const byRow = new Map<RowData, string[]>()
        let anySelected = false
        for (let ri = r0; ri <= r1; ri++) {
            const row = group.rows[ri]
            if (!row) continue
            for (let ci = c0; ci <= c1; ci++) {
                const cell = row.cells[ci]
                if (!cell?.enabled) continue
                if (cell.selected) anySelected = true
                let list = byRow.get(row)
                if (!list) {
                    list = []
                    byRow.set(row, list)
                }
                list.push(cell.buffId)
            }
        }
        if (byRow.size === 0) return
        const targetSelected = !anySelected
        for (const [row, buffIds] of byRow) {
            const cur = new Set(entryBuffSetIdMap[row.entry.id] ?? [])
            for (const id of buffIds) {
                if (targetSelected) cur.add(id)
                else cur.delete(id)
            }
            onSetEntryBuffSetIds(row.entry.id, [...cur])
        }
    }
</script>

<svelte:window
    onmousemove={handleMouseMove}
    onmouseup={handleMouseUp}
    onkeydown={(e) => {
        // 方向键滚动界面（输入框内不拦截）
        const el = e.target as HTMLElement
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return
        // Shift 键直接切换默认滚动方向（不需要配合方向键）
        if (e.key === 'Shift' && !e.repeat) {
            const next = getScrollAxisDefault() === 'vertical' ? 'horizontal' : 'vertical'
            setScrollAxisDefault(next)
            return
        }
        if (e.key.startsWith('Arrow')) handleArrowKey(e)
    }}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="h-full overflow-auto pb-48"
    bind:this={rootEl}
    onmousedown={handleMouseDown}
    onclickcapture={handleClickCapture}
    onscroll={syncSelectionRect}
    onwheel={(e) => {
        const axis = getScrollAxisDefault()
        if (e.ctrlKey) {
            // Ctrl+滚轮 = 次轴（默认纵向时横向滚动；默认横向时纵向滚动）
            e.preventDefault()
            if (axis === 'vertical') {
                ;(e.currentTarget as HTMLElement).scrollLeft += e.deltaY
            } else {
                ;(e.currentTarget as HTMLElement).scrollTop += e.deltaY
            }
            return
        }
        // 默认横向：普通滚轮也横向滚动；默认纵向沿用浏览器默认（纵向）
        if (axis === 'horizontal') {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).scrollLeft += e.deltaY
        }
    }}
>
    {#if selRect}
        <!-- 框选范围指示 -->
        <div
            class="pointer-events-none fixed z-50"
            style="left: {selRect.left}px; top: {selRect.top}px; width: {selRect.width}px; height: {selRect.height}px; background: color-mix(in srgb, var(--theme-accent-bg) 25%, transparent); border: 1px solid var(--theme-accent-bg);"
        ></div>
    {/if}
    {#if damageEntries.length === 0}
        <div class="flex items-center justify-center py-12 text-xs text-(--theme-modal-text)/40">暂无伤害数据</div>
    {/if}
    {#each tableData as group, gi}
        {@const charElement = getCalcElementMap()[group.charName] ?? ''}
        <div class="mb-6">
            <div>
                <!-- 表格主体底色不透明（单元格区域保持透明）；上/右/下 = 主题色双实线，右上/右下圆角；左 = 常规分隔线 -->
                <table
                    class="min-w-full text-xs"
                    style="background: var(--theme-modal-bg); border-collapse: separate; border-spacing: 0; border-top: 3px double var(--theme-accent-bg); border-right: 3px double var(--theme-accent-bg); border-bottom: 3px double var(--theme-accent-bg); border-left: 1px solid var(--theme-divider-border); border-top-right-radius: 0.5rem; border-bottom-right-radius: 0.5rem;"
                >
                    <!-- 标题块与全局 buff 行放入 caption：宽度自动跟随表头（表格宽度） -->
                    <caption class="text-left">
                        <div
                            class="-mr-px flex items-center gap-2 border-b px-2 py-1.5"
                            style="background: var(--theme-modal-bg); border-color: var(--theme-divider-border);"
                        >
                            <span class="text-sm font-bold" style="color: var(--theme-element-{charElement}, #888);"
                                >{group.charName || '无角色'}</span
                            >
                            <span class="text-xs text-(--theme-modal-text)/60"
                                >· {group.kind === 'direct' ? '直伤' : '非直伤'}</span
                            >
                            <span class="text-[10px] text-(--theme-modal-text)/35">{group.rows.length} 条</span>
                        </div>
                        {#if globalBuffs.length > 0}
                            <div
                                class="flex items-center gap-1 overflow-hidden whitespace-nowrap border-b px-2 py-1"
                                style="background: var(--theme-modal-bg); border-color: var(--theme-divider-border);"
                            >
                                {#each globalBuffs as gb}
                                    <span
                                        class="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium"
                                        style="background: var(--theme-buff-yellow-bg); color: var(--theme-buff-yellow-text);"
                                    >
                                        <Icon icon="mdi:crown" class="size-3" />{gb.name}
                                    </span>
                                {/each}
                            </div>
                        {/if}
                    </caption>
                    <thead>
                        <tr>
                            <th
                                class="sticky left-0 top-0 z-40 w-52 min-w-52 px-2 py-1.5 text-left font-medium text-(--theme-modal-text)/50 border-r"
                                style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 80%, transparent); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);"
                            >
                                条目
                            </th>
                            {#each group.visibleColIdx as ci, colPos}
                                {@const col = columns[ci]}
                                {@const stat = group.colStats[ci]}
                                {@const allSelected = stat.selected > 0 && stat.selected === stat.enabled}
                                {@const partial = stat.selected > 0 && !allSelected}
                                <th
                                    class="sticky top-0 z-30 p-0 align-top border-b"
                                    style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 80%, transparent); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); {colBorderStyle(
                                        col.id,
                                        colPos + 1 < group.visibleColIdx.length
                                            ? columns[group.visibleColIdx[colPos + 1]]?.id
                                            : undefined
                                    )}"
                                >
                                    <button
                                        onclick={() => toggleColumn(group, ci)}
                                        title={`${col.name}${stat.enabled > 0 ? `（${stat.selected}/${stat.enabled}）` : '（无可应用条目）'}`}
                                        class="flex h-full w-full flex-col items-center justify-center gap-1 px-1 pt-1 pb-1.5 transition-colors hover:bg-(--theme-modal-text)/5 disabled:opacity-30"
                                        disabled={stat.enabled === 0}
                                    >
                                        <span
                                            class="line-clamp-3 w-max max-w-40 text-center text-[10px] leading-4 text-(--theme-modal-text)/60"
                                            title={col.name}>{col.name}</span
                                        >
                                        <span
                                            class="flex size-3.5 shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none"
                                            style={allSelected
                                                ? 'background: var(--theme-accent-bg); border-color: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                                : partial
                                                  ? 'background: color-mix(in srgb, var(--theme-accent-bg) 40%, transparent); border-color: color-mix(in srgb, var(--theme-accent-bg) 60%, transparent); color: var(--theme-accent-text);'
                                                  : 'border-color: var(--theme-divider-border);'}
                                        >
                                            {allSelected ? '✓' : partial ? '—' : ''}
                                        </span>
                                    </button>
                                </th>
                            {/each}
                        </tr>
                    </thead>
                    <tbody>
                        {#each group.rows as row, ri}
                            <tr
                                class:split-row={row.splitBefore}
                                class="border-b"
                                style="border-bottom: 1px dashed var(--theme-divider-border);"
                            >
                                <td
                                    class="sticky left-0 z-20 px-2 py-1 border-r"
                                    style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 80%, transparent); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);"
                                >
                                    <button
                                        onclick={() => toggleRow(row)}
                                        title={row.enabledBuffIds.length > 0
                                            ? `${row.selectedCount}/${row.enabledBuffIds.length}`
                                            : '无可应用增益'}
                                        class="flex w-full items-center gap-1.5 py-0.5 text-left transition-colors hover:bg-(--theme-modal-text)/5 disabled:opacity-30"
                                        disabled={row.enabledBuffIds.length === 0}
                                    >
                                        <span
                                            class="flex size-3.5 shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none"
                                            style={row.allSelected
                                                ? 'background: var(--theme-accent-bg); border-color: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                                : row.partial
                                                  ? 'background: color-mix(in srgb, var(--theme-accent-bg) 40%, transparent); border-color: color-mix(in srgb, var(--theme-accent-bg) 60%, transparent); color: var(--theme-accent-text);'
                                                  : 'border-color: var(--theme-divider-border);'}
                                        >
                                            {row.allSelected ? '✓' : row.partial ? '—' : ''}
                                        </span>
                                        <span
                                            class="truncate text-(--theme-modal-text)"
                                            style="color: var(--theme-element-{row.entry.damageElement}, #888);"
                                            title={row.entry.displayName}>{row.entry.displayName}</span
                                        >
                                    </button>
                                    <!-- 视为：伤害类型（可切换 编辑 / 仅查看） -->
                                    <div class="flex flex-wrap gap-0.5 px-0.5 pb-0.5">
                                        {#if getDamageTypeEditMode()}
                                            {#each DAMAGE_TYPES as dt}
                                                {@const selected = (entryDamageTypeMap[row.entry.id] ?? []).includes(
                                                    dt
                                                )}
                                                <button
                                                    onclick={() => onToggleDamageType(row.entry.id, dt)}
                                                    title={dt}
                                                    class="rounded px-1 text-[10px] leading-tight transition-colors"
                                                    style={selected
                                                        ? 'background: color-mix(in srgb, var(--theme-accent-bg) 25%, transparent); color: var(--theme-accent-text);'
                                                        : 'background: var(--theme-input-bg); color: var(--theme-modal-text)/50; hover: background: var(--theme-modal-text)/10;'}
                                                    >{DAMAGE_TYPE_SHORT[dt as keyof typeof DAMAGE_TYPE_SHORT] ??
                                                        dt}</button
                                                >
                                            {/each}
                                        {:else}
                                            <span
                                                class="text-[10px] font-bold leading-tight text-(--theme-modal-text)/70"
                                                >伤害类型：</span
                                            >
                                            {#each entryDamageTypeMap[row.entry.id] ?? [] as dt}
                                                <span
                                                    class="rounded px-1 text-[10px] leading-tight text-(--theme-modal-text)/70"
                                                    style="background: var(--theme-input-bg);"
                                                    >{DAMAGE_TYPE_SHORT[dt as keyof typeof DAMAGE_TYPE_SHORT] ??
                                                        dt}</span
                                                >
                                            {/each}
                                        {/if}
                                        {#if (entryDamageTypeMap[row.entry.id] ?? []).length === 0}
                                            {@const inferred = inferredDamageTypeMap[row.entry.id] ?? []}
                                            {#if inferred.length > 0}
                                                <span class="text-[10px] leading-tight text-(--theme-modal-text)/35"
                                                    >自动推导：{inferred
                                                        .map(
                                                            (t) =>
                                                                DAMAGE_TYPE_SHORT[
                                                                    t as keyof typeof DAMAGE_TYPE_SHORT
                                                                ] ?? t
                                                        )
                                                        .join('/')}</span
                                                >
                                            {/if}
                                        {/if}
                                    </div>
                                </td>
                                {#each group.visibleColIdx as ci, colPos}
                                    {@const cell = row.cells[ci]}
                                    <td
                                        class="min-w-9 p-0 text-center"
                                        style={colBorderStyle(
                                            cell.buffId,
                                            colPos + 1 < group.visibleColIdx.length
                                                ? columns[group.visibleColIdx[colPos + 1]]?.id
                                                : undefined
                                        )}
                                        data-group={gi}
                                        data-row={ri}
                                        data-col={ci}
                                    >
                                        {#if cell.enabled}
                                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                                            <button
                                                onclick={() => toggleCell(row, cell)}
                                                title={cell.selected
                                                    ? `取消勾选：${columns[ci]?.name}`
                                                    : `勾选：${columns[ci]?.name}`}
                                                class="flex min-h-6 w-full items-center justify-center px-1 py-1 transition-colors hover:bg-(--theme-modal-text)/10"
                                                style={cell.selected
                                                    ? 'background: color-mix(in srgb, var(--theme-accent-bg) 20%, transparent);'
                                                    : ''}
                                            >
                                                {#if cell.selected}
                                                    <span
                                                        class="line-clamp-2 text-[10px] leading-tight"
                                                        style="color: var(--theme-accent-text);"
                                                        >{columns[ci]?.name}</span
                                                    >
                                                {/if}
                                            </button>
                                        {:else}
                                            <!-- 不可用（作用域/条件不匹配）不显示文字 -->
                                            <span class="block h-6 w-full"></span>
                                        {/if}
                                    </td>
                                {/each}
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </div>
    {/each}
</div>

<style>
    /* 同角色来源、时间线上不连续的伤害之间画主题色点横线（半透明） */
    .split-row td {
        border-top: 2px dashed color-mix(in srgb, var(--theme-accent-bg) 50%, transparent);
    }
</style>
