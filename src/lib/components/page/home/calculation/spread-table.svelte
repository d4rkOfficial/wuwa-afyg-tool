<script lang="ts">
    /** @desc 铺开表（拉表铺开模式）：按角色×直伤/非直伤分组，Buff 作列、条目作行，支持单元格/行列头三态勾选、框选批量、叠层文件夹列线区分
     *  性能约定：
     *  1) 结构化数据（可用性/表头/列分隔）与勾选状态分离——点单元格不再重建整表结构；
     *  2) 列表底色走区域系统 card（data-sf-flat，无毛玻璃）；吸顶表头为 toolbar 叠 card 底并取卡片毛玻璃（数量只与列数相关）；
     *  3) 高亮只给目标行/列上主题色，不压暗其它行列（无遮罩测量、无逐行 opacity 合成层）；
     *  4) 渐进渲染按结构指纹重置，并以切片方式分帧揭示；
     *  5) 表格宽度由表头内容决定（不再测宽等宽、不再补填充列）；
     *  6) 顶部「伤害源」切换按角色过滤要渲染的子表，从根上减少一次挂载的行/格数量。 */
    import { onMount, onDestroy } from 'svelte'
    import { fade, slide } from 'svelte/transition'
    import type { BuffSet, DamageEntry } from '$lib/calc/calculation.types'
    import type { CharSlot } from '$lib/types/project'
    import type { ConditionProfile } from '$lib/calc/compute'
    import {
        applyIdsSelection,
        buildCharToIdx,
        buildDamageTypesByEntry,
        buildInferredDamageTypeMap,
        buffMatchesEntry,
        buffScopeOk,
        buffUsableByEntry,
        damageTypeShort,
        inferredDamageTypeText,
        paneSourceText
    } from './damage-table.utils'
    import {
        buildFolderGroups,
        buildSelectionStats,
        buildSourceTabs,
        buildSpreadTable,
        collectShownGlobalBuffs,
        columnHeadTitle,
        orderColumns,
        resolveActiveSource,
        rowFingerprintOf,
        rowHeadTitle,
        shownGroupIdxOf,
        visibleRowsOf,
        NONE_SOURCE_KEY,
        type CellData,
        type GroupData,
        type RowData
    } from './spread-table.utils'
    import { getCalcElementMap, compareNatural, getPaneEffectSources } from '$lib/calc/calculation.store.svelte'
    import { elementColor, getCharIconMap } from '$lib/calc/timeline.store.svelte'
    import {
        getGlobalBuffCollapsed,
        getScrollAxisDefault,
        setGlobalBuffCollapsed,
        setScrollAxisDefault
    } from '$lib/data/calc-view.svelte'
    import { ensureCharInfo, ensureEchoSkillText, getCharInfoMap, getEchoSkillText } from '$lib/data/char-info.svelte'
    import { buildEchoDescByEntry } from '$lib/calc/skill-infer'
    import { getShortcutKey, normalizeShortcutEvent } from '$lib/data/shortcuts.svelte'
    import { registerDragCancel } from '$lib/utils/drag-guard'
    import { fallbackIcon } from '$lib/utils/icons'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
    import { getGpuAccel } from '$lib/data/render-prefs.svelte'
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import ContextMenu from '$lib/components/layout/context-menu.svelte'
    import Chip from '$lib/components/ui/chip.svelte'
    import Tag from '$lib/components/ui/tag.svelte'
    import EmptyState from '$lib/components/ui/empty-state.svelte'

    interface Props extends ComponentsProps {
        team: [CharSlot, CharSlot, CharSlot]
        damageEntries: DamageEntry[]
        buffSets: BuffSet[]
        entryBuffSetIdMap: Record<string, string[]>
        entryDamageTypeMap: Record<string, string[]>
        globalBuffSetIds: string[]
        conditionProfile: ConditionProfile
        hideConditionMismatch: boolean
        ontoggle: (entryId: string, buffId: string) => void
        onSetEntryBuffSetIds: (entryId: string, ids: string[]) => void
        onSetEntriesBuffSetIds?: (map: Record<string, string[]>) => void
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
        ontoggle,
        onSetEntryBuffSetIds,
        onSetEntriesBuffSetIds,
        class: className,
        style: styleProp
    }: Props = $props()

    /** @desc 普通 buff 列（非全局）与全局 buff 列（仅展示，不可勾选）；列序算法见 `spread-table.utils.orderColumns` */
    const rawColumns = $derived(buffSets.filter((b) => !globalBuffSetIds.includes(b.id)))
    const columns = $derived(orderColumns(rawColumns, compareNatural))
    const globalBuffs = $derived(buffSets.filter((b) => globalBuffSetIds.includes(b.id)))

    /** @desc 列 id → 全局列序索引（勾选统计用，避免每格线性查找） */
    const colIndexById = $derived.by(() => new Map(columns.map((c, i) => [c.id, i] as const)))

    /** @desc 叠层分组信息：buffId → 组（同「前缀+后缀」≥2 条成组；仅用于表头分组展示与分隔线，列本身仍每层一列） */
    const folderGroupOf = $derived(buildFolderGroups(columns))

    /** @desc 角色/声骸技能文案缓存（伤害类型规则2需要）：补齐后映射变化会让推导与可用性缓存自动重算 */
    const charInfoMap = $derived(getCharInfoMap())
    const echoSkillText = $derived(getEchoSkillText())
    const echoDescByEntry = $derived(buildEchoDescByEntry(damageEntries, team, echoSkillText))

    /** @desc 自动推导伤害类型映射（未手填伤害类型时展示推导结果；规则2需要角色/声骸技能文案，故补齐数据） */
    const inferredDamageTypeMap = $derived(buildInferredDamageTypeMap(damageEntries, charInfoMap, echoDescByEntry))

    /** @desc 角色名→槽位索引（用于 scope 判定） */
    const charToIdx = $derived(buildCharToIdx(team))

    /** @desc 条目 → 生效伤害类型：只依赖条目与角色/声骸信息，与具体 buff 无关，故按条目记忆一次（两个视图共用同一口径） */
    const damageTypesByEntry = $derived(
        buildDamageTypesByEntry(damageEntries, entryDamageTypeMap, charInfoMap, echoDescByEntry)
    )
    $effect(() => {
        for (const slot of team) {
            if (slot.character) void ensureCharInfo(slot.character)
            const echoName = slot.echoes?.[0]?.name
            if (echoName) void ensureEchoSkillText(echoName)
        }
    })

    /**
     * @desc 非直伤条目对 buff 的可用性判定：scope 匹配 + 乘区可吃（`buffUsableByEntry`）+
     * （隐藏条件不匹配时）**该 buff 对本条目仍有贡献**。
     *
     * 注意不能用实例级条件代替：属性/类型条件挂在**乘区条目**上（条件分层之后实例级只剩链/阶硬门槛），
     * 只看实例级会出现「乘区条件不满足、格子却仍可勾选」的 bug。
     * 判定口径（含非直伤丢掉 damageTypes 维度）与下拉表共用 `damage-table.utils`。
     *
     * `buffUsableByEntry` 是**乘区级硬门槛**：处决/响应/效应的双暴只有「覆盖」写入生效，
     * 因此「追加型暴击率/暴击伤害」buff 在这些行上不可勾（勾了也不参与计算）。
     */
    const buffEnabledForEntry = (bs: BuffSet, entry: DamageEntry, charIdx: number): boolean =>
        buffScopeOk(bs, entry.isEffect, charIdx) &&
        buffUsableByEntry(bs, entry) &&
        buffMatchesEntry(bs, entry, {
            hideConditionMismatch,
            conditionProfile,
            damageTypes: damageTypesByEntry.get(entry.id),
            charIdx
        })

    /**
     * @desc 可用性结果缓存：(entryId, buffId) → enabled，避免每次重建都全量重跑贡献判定。
     *
     * 缓存与上下文都挂在**组件实例**上（Svelte 的普通 `<script>` 是实例作用域，不是模块作用域）：
     * 模块级会让缓存跨实例/跨工程存活，而这里的作废判据是「引用是否变化」，
     * 一旦条目被就地改写（引用不变）就会拿到过期结果，故刻意保持实例级。
     *
     * 上下文（含**条目清单本身**的引用）未变时复用；任一项变了即整体作废。
     * 把条目清单也纳入上下文，是为了让缓存不会跨工程串味——不同工程可能撞出
     * 相同的 entry.id/buffId，仅比条件档位/角色信息是不足以判定结果仍然有效的。
     */
    let _enabledCache = new Map<string, boolean>()
    let _enabledCacheCtx: {
        hide: boolean
        profile: ConditionProfile | null
        types: Record<string, string[]> | null
        chars: Record<string, number> | null
        infos: Record<string, unknown> | null
        echoes: Record<string, string> | null
        entries: DamageEntry[] | null
    } = { hide: false, profile: null, types: null, chars: null, infos: null, echoes: null, entries: null }

    function buffEnabledForEntryCached(bs: BuffSet, entry: DamageEntry, charIdx: number): boolean {
        const ctx = {
            hide: hideConditionMismatch,
            profile: conditionProfile,
            types: entryDamageTypeMap,
            chars: charToIdx,
            infos: charInfoMap,
            echoes: echoDescByEntry,
            entries: damageEntries
        }
        if (
            ctx.hide !== _enabledCacheCtx.hide ||
            ctx.profile !== _enabledCacheCtx.profile ||
            ctx.types !== _enabledCacheCtx.types ||
            ctx.chars !== _enabledCacheCtx.chars ||
            ctx.infos !== _enabledCacheCtx.infos ||
            ctx.echoes !== _enabledCacheCtx.echoes ||
            ctx.entries !== _enabledCacheCtx.entries
        ) {
            _enabledCacheCtx = ctx
            _enabledCache.clear()
        }
        const key = entry.id + '\u0000' + bs.id
        let v = _enabledCache.get(key)
        if (v === undefined) {
            v = buffEnabledForEntry(bs, entry, charIdx)
            _enabledCache.set(key, v)
        }
        return v
    }

    const EMPTY_IDS: string[] = []

    /** @desc 预计算整表「结构」数据：单元格可用性、表头标签/分隔线、行统计一次算好；勾选态不参与，故点单元格不重建整表 */
    const tableData = $derived.by(() =>
        buildSpreadTable({
            columns,
            damageEntries,
            charToIdx,
            globalBuffs,
            team,
            folderGroupOf,
            // 可用性判定走组件实例上的缓存（见 buffEnabledForEntryCached），影响源查询仍是 store 的按需查询
            enabledFor: buffEnabledForEntryCached,
            paneSourcesOf: getPaneEffectSources
        })
    )

    /**
     * @desc 影响源提示文案：该列 Buff 作用于「被本组某段伤害引用的角色」，会改写那个角色的面板乘区。
     * 伤害是当下的 —— 勾上它，它就会参与该角色在这一段伤害下的面板计算。
     */
    const paneSourceTooltip = (src: { charName: string; zoneLabels: string[] }): string =>
        paneSourceText(src.charName, src.zoneLabels, '本组的伤害')

    /** @desc 勾选统计（已选数）：按「已绑定的 (条目, buff) 对」增量累加——成本 O(已绑定数)，而非 O(行×列) */
    const selStats = $derived(buildSelectionStats(tableData, entryBuffSetIdMap, colIndexById))

    /** @desc ── 伤害源切换（主内容区顶部）：按角色过滤要渲染的子表，减少一次要挂载的行/格（大表卡顿从根上缓解）；
     *  UI 对齐「词条/环境配置」的角色页签；只影响显示哪些子表，不改任何勾选数据 ── */
    let sourceKey = $state<string | null>(null)
    const charIconMap = $derived(getCharIconMap())

    /** @desc 页签固定为「角色1 / 角色2 / 角色3 / 其它」四个队伍维度（不做「全部」——全部子表同时渲染最卡） */
    const sourceTabs = $derived(buildSourceTabs({ team, tableData, charToIdx, elementColorOf: elementColor }))
    /** @desc 生效的页签：未手动选择（或所选页签已不存在）时取第一个有子表的页签 */
    const activeSource = $derived(resolveActiveSource(sourceKey, sourceTabs))
    /** @desc 要渲染的子表下标：始终是 tableData 的原始下标——data-group / 框选 / 高亮 / 右键全选语义不变 */
    const shownGroupIdx = $derived(shownGroupIdxOf(tableData, activeSource, charToIdx))

    /** @desc 顶部「全局 BUFF」条：当前页签涉及的子表里能吃到该全局 buff 的并集（去重，保持出现顺序） */
    const shownGlobalBuffs = $derived(collectShownGlobalBuffs(tableData, shownGroupIdx))

    const selectSource = (key: string) => {
        sourceKey = key
        // 被过滤掉的子表上的高亮随之失效，避免留下看不见的高亮状态
        highlight = null
    }

    /** @desc 单击单元格：切换绑定 */
    function toggleCell(row: RowData, cell: CellData) {
        ontoggle(row.entry.id, cell.buffId)
    }

    /** @desc 行/列全选或全不选（右键菜单触发，取代原行/列头点击三态） */
    function selectRow(row: RowData, all: boolean) {
        if (row.enabledBuffIds.length === 0) return
        onSetEntryBuffSetIds(
            row.entry.id,
            applyIdsSelection(entryBuffSetIdMap[row.entry.id] ?? [], row.enabledBuffIds, all)
        )
    }

    function selectColumn(group: GroupData, ci: number, all: boolean) {
        const col = columns[ci]
        for (const r of group.rows) {
            if (!r.cells[ci].enabled) continue
            onSetEntryBuffSetIds(r.entry.id, applyIdsSelection(entryBuffSetIdMap[r.entry.id] ?? [], [col.id], all))
        }
    }

    /** @desc ── 行/列高亮（左键单击首列/表头触发，行列互斥；再点同目标取消，表格外点击清除）──
     *  行高亮=行级 opacity 压暗其他行；列高亮=单层遮罩压暗非高亮列（仅 1~2 个矩形，替代逐单元格 opacity） */
    let highlight = $state<{ gi: number; kind: 'row' | 'col'; index: number } | null>(null)

    function clickRowHeader(gi: number, ri: number) {
        highlight =
            highlight && highlight.gi === gi && highlight.kind === 'row' && highlight.index === ri
                ? null
                : { gi, kind: 'row', index: ri }
    }

    function clickColHeader(gi: number, ci: number) {
        highlight =
            highlight && highlight.gi === gi && highlight.kind === 'col' && highlight.index === ci
                ? null
                : { gi, kind: 'col', index: ci }
    }

    /** @desc 首列/表头右键菜单（仿 layout/context-menu；items 在触发处构造闭包） */
    let ctxMenu = $state<{ x: number; y: number; items: Array<{ label: string; action: () => void }> } | null>(null)

    function onRowHeaderContextMenu(e: MouseEvent, gi: number, ri: number) {
        e.preventDefault()
        const row = tableData[gi]?.rows[ri]
        if (!row) return
        ctxMenu = {
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: '全选本行', action: () => selectRow(row, true) },
                { label: '全不选本行', action: () => selectRow(row, false) }
            ]
        }
    }

    function onColHeaderContextMenu(e: MouseEvent, gi: number, ci: number) {
        e.preventDefault()
        const group = tableData[gi]
        if (!group) return
        ctxMenu = {
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: '全选本列', action: () => selectColumn(group, ci, true) },
                { label: '全不选本列', action: () => selectColumn(group, ci, false) }
            ]
        }
    }

    /** @desc ── 框选批量生效/失效（拖拽矩形范围：范围内有已勾选 → 全部取消，否则全部勾选）── */
    let rootEl = $state<HTMLDivElement | undefined>()
    let selStart: { g: number; r: number; c: number; x: number; y: number } | null = null
    let selStartTd: HTMLElement | null = null
    let selCurrentTd: HTMLElement | null = null
    // selCurrent/dragging 不参与模板渲染，用普通局部变量即可（避免无谓的响应式开销）
    let selCurrent: { r: number; c: number } | null = null
    let dragging = false
    let justDragged = false
    let selRect = $state<{ left: number; top: number; width: number; height: number } | null>(null)
    let lastMouseX = 0
    let lastMouseY = 0

    /** @desc 重置框选状态（拖入禁区/鼠标松开时调用，不应用选中） */
    function cancelSelection() {
        selStart = null
        selStartTd = null
        selCurrentTd = null
        selCurrent = null
        dragging = false
        justDragged = false
        selRect = null
    }

    /** @desc 拖动进入 AI 悬浮窗等"禁区"时取消框选（不应用选中） */
    let unregisterDragCancel: (() => void) | null = null
    const gpuAccel = $derived(getGpuAccel())
    onMount(() => {
        unregisterDragCancel = registerDragCancel(cancelSelection)
    })
    onDestroy(() => {
        unregisterDragCancel?.()
    })

    /** @desc 渐进渲染：首帧不立刻铺满所有行，逐帧新增 chunk 行，避免打开大表/切换工程时单帧阻塞卡顿。
     *  box-select/行列高亮均依赖 data-row/data-col，行分批挂载不影响交互；切片保留原索引，data-row 语义不变。 */
    const maxGroupRows = $derived(tableData.reduce((m, g) => Math.max(m, g.rows.length), 0))
    const ROW_CHUNK = 24
    let visibleRows = $state(ROW_CHUNK)
    /** @desc 结构指纹（条目集合 + 列集合）：切换工程/队伍后重置分帧进度，避免沿用上一个大表的值而失去分帧保护 */
    const rowFingerprint = $derived(rowFingerprintOf(damageEntries, tableData))
    let lastFingerprint = ''
    $effect(() => {
        const fp = rowFingerprint
        if (fp === lastFingerprint) return
        lastFingerprint = fp
        visibleRows = ROW_CHUNK
    })
    $effect(() => {
        if (visibleRows >= maxGroupRows) return
        // 每帧最多揭示 ROW_CHUNK 行，逐帧推进直到铺满（小表一次到位；数据切换后自动续播）
        const raf = requestAnimationFrame(() => {
            visibleRows = Math.min(visibleRows + ROW_CHUNK, maxGroupRows)
        })
        return () => cancelAnimationFrame(raf)
    })
    /** @desc 已揭示的行（切片而非逐行 {#if} 判断：每帧只处理新增 chunk，且未揭示时复用原数组引用） */
    const shownRows = (g: GroupData): RowData[] => visibleRowsOf(g.rows, visibleRows)

    /** @desc mousedown：记录框选起点单元格（仅左键）；起点为 folder 列时进入层级框选模式 */
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

    /** @desc 滚动后同步框选：按鼠标最后位置更新当前单元格，并重算选区矩形（滚动不破坏框选） */
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
        selRect = rectTo(selStartTd, selCurrentTd ?? selStartTd)
    }

    /** @desc 两个单元格的并集矩形（视口坐标） */
    const rectTo = (a: HTMLElement, b: HTMLElement) => {
        const ra = a.getBoundingClientRect()
        const rb = b.getBoundingClientRect()
        return {
            left: Math.min(ra.left, rb.left),
            top: Math.min(ra.top, rb.top),
            width: Math.max(ra.right, rb.right) - Math.min(ra.left, rb.left),
            height: Math.max(ra.bottom, rb.bottom) - Math.min(ra.top, rb.top)
        }
    }

    /** @desc 滚动事件用 rAF 合并（滚动可每帧多次触发，避免重复强制布局 + 重复写 state） */
    let scrollRaf = 0
    const scheduleSyncSelection = () => {
        if (scrollRaf) return
        scrollRaf = requestAnimationFrame(() => {
            scrollRaf = 0
            syncSelectionRect()
        })
    }
    onDestroy(() => {
        if (scrollRaf) cancelAnimationFrame(scrollRaf)
    })

    /** @desc 拖拽中的 mousemove 同样用 rAF 合并：每帧最多一次强制布局（鼠标位置同步记录，不丢帧） */
    let moveRaf = 0
    const updateDragSelection = () => {
        if (!selStart || !selStartTd) return
        const el = document.elementFromPoint(lastMouseX, lastMouseY)
        const td = el?.closest?.<HTMLElement>('td[data-row][data-col]')
        if (td && Number(td.dataset.group) === selStart.g) {
            selCurrentTd = td
            selCurrent = { r: Number(td.dataset.row), c: Number(td.dataset.col) }
        }
        selRect = rectTo(selStartTd, selCurrentTd ?? selStartTd)
    }

    /** @desc mousemove：拖动超过 4px 阈值后进入框选，随鼠标更新当前单元格与选区矩形 */
    function handleMouseMove(e: MouseEvent) {
        if (!selStart || !selStartTd) return
        lastMouseX = e.clientX
        lastMouseY = e.clientY
        if (!dragging && Math.hypot(e.clientX - selStart.x, e.clientY - selStart.y) < 4) return
        dragging = true
        if (moveRaf) return
        moveRaf = requestAnimationFrame(() => {
            moveRaf = 0
            updateDragSelection()
        })
    }

    /** @desc mouseup：先把框选矩形隐藏（并让浏览器先画一帧），再延后一帧应用批量勾选——
     *  这样「框先消失、勾选随后落地」，不会出现框停在屏幕上干等整表重渲染的卡顿感 */
    let applyRaf = 0
    function handleMouseUp() {
        if (moveRaf) {
            cancelAnimationFrame(moveRaf)
            moveRaf = 0
            updateDragSelection()
        }
        if (!selStart || !dragging) {
            cancelSelection()
            return
        }
        // 快照选区范围（随后 cancelSelection 会清空交互状态）
        const g = selStart.g
        const r0 = Math.min(selStart.r, selCurrent?.r ?? selStart.r)
        const r1 = Math.max(selStart.r, selCurrent?.r ?? selStart.r)
        const c0 = Math.min(selStart.c, selCurrent?.c ?? selStart.c)
        const c1 = Math.max(selStart.c, selCurrent?.c ?? selStart.c)
        cancelSelection()
        justDragged = true
        applyRaf = requestAnimationFrame(() => {
            // 第二个 rAF：第一个 rAF 只负责让「框已隐藏」这一帧先画出来
            applyRaf = requestAnimationFrame(() => {
                applyRaf = 0
                applySelection(g, r0, r1, c0, c1)
                setTimeout(() => {
                    justDragged = false
                }, 0)
            })
        })
    }
    onDestroy(() => {
        if (moveRaf) cancelAnimationFrame(moveRaf)
        if (applyRaf) cancelAnimationFrame(applyRaf)
    })

    /** @desc 框选结束后拦截单元格 click，避免误触发单选 */
    function handleClickCapture(e: MouseEvent) {
        // 框选结束后拦截单元格 click，避免误触发单选
        if (justDragged) {
            e.preventDefault()
            e.stopPropagation()
            justDragged = false
        }
    }

    /** @desc 全局 BUFF 条展开/收起（偏好持久化在 calc-view 里） */
    let globalBuffCollapsed = $state(getGlobalBuffCollapsed())
    const toggleGlobalBuffCollapsed = () => {
        globalBuffCollapsed = !globalBuffCollapsed
        setGlobalBuffCollapsed(globalBuffCollapsed)
    }

    /** @desc 方向键滚动：↑↓ 沿「主轴」（默认滚动方向），←→ 沿次轴；Shift 键本身直接切换默认方向 */
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

    /** @desc 应用框选：范围内单元格有已勾选 → 全部取消，否则全部勾选（仅可启用单元格）；
     *  范围由调用方（mouseup）快照传入，不再读交互状态，便于「先隐藏框、延后应用」 */
    function applySelection(gi: number, r0: number, r1: number, c0: number, c1: number) {
        const group = tableData[gi]
        if (!group) return
        const byRow = new Map<RowData, string[]>()
        let anySelected = false
        for (let ri = r0; ri <= r1; ri++) {
            const row = group.rows[ri]
            if (!row) continue
            const selIds = new Set(entryBuffSetIdMap[row.entry.id] ?? [])
            for (let ci = c0; ci <= c1; ci++) {
                const cell = row.cells[ci]
                if (!cell?.enabled) continue
                if (selIds.has(cell.buffId)) anySelected = true
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
        const batch = new Map<string, string[]>()
        for (const [row, buffIds] of byRow) {
            const cur = new Set(entryBuffSetIdMap[row.entry.id] ?? [])
            for (const id of buffIds) {
                if (targetSelected) cur.add(id)
                else cur.delete(id)
            }
            batch.set(row.entry.id, [...cur])
        }
        // 批量 API：N 行框选单次通知（无批量回调时逐行回退）
        if (onSetEntriesBuffSetIds && batch.size > 1) {
            onSetEntriesBuffSetIds(Object.fromEntries(batch))
        } else {
            for (const [entryId, ids] of batch) onSetEntryBuffSetIds(entryId, ids)
        }
    }

    /** @desc 高亮不压暗其它行/列，只给目标行/列上主题色：纯 CSS 类切换，DOM 写入 O(1)（无遮罩测量、无临时层、
     *  无逐行 opacity 合成层），滚动与切换都不产生额外重排/重绘成本 ── */
</script>

<!-- @desc 窗口级事件：鼠标移动/松开（框选）、方向键滚动、快捷键切换默认滚动轴（输入框/文本域内不拦截）、表格外点击清除高亮 -->
<svelte:window
    onmousemove={handleMouseMove}
    onmouseup={handleMouseUp}
    onclick={(e) => {
        const t = e.target as HTMLElement
        if (rootEl && !rootEl.contains(t)) highlight = null
    }}
    onkeydown={(e) => {
        // 方向键滚动界面（输入框内不拦截）
        const el = e.target as HTMLElement
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return
        // 配置键直接切换默认滚动方向（不需要配合方向键）
        if (normalizeShortcutEvent(e) === getShortcutKey('calc-spread.axis-switch') && !e.repeat) {
            const next = getScrollAxisDefault() === 'vertical' ? 'horizontal' : 'vertical'
            setScrollAxisDefault(next)
            return
        }
        if (e.key.startsWith('Arrow')) handleArrowKey(e)
    }}
/>

<!-- @desc 铺开表根容器：顶部伤害源页签（不滚动）+ 下方表格滚动区 -->
<div class="flex h-full flex-col {className}" style={styleProp}>
    <!-- @desc 伤害源切换：固定「角色1/角色2/角色3/其它」四个队伍维度页签（UI 对齐「词条/环境配置」的角色页签）；
         不做「全部」——所有子表同时渲染最卡，故一次只看一个伤害源 -->
    {#if sourceTabs.length > 1}
        <div
            class="flex shrink-0 flex-wrap items-center gap-2 border-b border-(--theme-divider-border) px-3 py-2"
            data-sf="toolbar"
            data-sf-flat
        >
            {#each sourceTabs as tab (tab.key)}
                <button
                    class={[
                        'flex cursor-pointer items-center gap-1.5 rounded-none border px-2.5 py-1 text-xs font-black tracking-tight transition-colors',
                        activeSource === tab.key
                            ? 'border-current'
                            : 'border-transparent text-(--theme-modal-text)/40 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/70'
                    ].join(' ')}
                    style={activeSource === tab.key
                        ? `background: color-mix(in srgb, ${tab.element} 18%, transparent); color: ${tab.element};`
                        : ''}
                    onclick={() => selectSource(tab.key)}
                    title={tab.count > 0 ? `${tab.label}：${tab.count} 张子表` : `${tab.label}：暂无伤害条目`}
                >
                    {#if tab.char && charIconMap[tab.char]}
                        <img
                            src={charIconMap[tab.char]}
                            alt=""
                            use:fallbackIcon={'/icons/placeholder-character.svg'}
                            class="size-5 shrink-0 rounded-full"
                        />
                    {:else if tab.key === NONE_SOURCE_KEY}
                        <span
                            class="flex size-5 shrink-0 items-center justify-center rounded-full bg-(--theme-modal-text)/10"
                            ><Icon icon="mdi:dots-horizontal" class="size-3.5" /></span
                        >
                    {:else}
                        <span
                            class="flex size-5 shrink-0 items-center justify-center rounded-full bg-(--theme-modal-text)/10 text-[10px]"
                            >{tab.label.charAt(0)}</span
                        >
                    {/if}
                    <span>{tab.label}</span>
                </button>
            {/each}
        </div>
    {/if}
    <!-- @desc 全局 BUFF 条：当前伤害源涉及的所有全局 buff 列在表上方，chips 自动换行；可展开/收起（偏好持久化） -->
    {#if shownGlobalBuffs.length > 0}
        <div class="flex shrink-0 flex-col border-b border-(--theme-divider-border)" data-sf="toolbar" data-sf-flat>
            <div class="flex items-center gap-1.5 px-3 py-1.5">
                <button
                    onclick={toggleGlobalBuffCollapsed}
                    class="inline-flex items-center gap-1 rounded-none px-1 py-0.5 text-[10px] font-black tracking-[0.12em] text-(--theme-modal-text)/50 transition-colors hover:text-(--theme-modal-text)"
                    title={globalBuffCollapsed ? '展开全局 BUFF' : '收起全局 BUFF'}
                    aria-expanded={!globalBuffCollapsed}
                >
                    <Icon
                        icon={globalBuffCollapsed ? 'mdi:chevron-right' : 'mdi:chevron-down'}
                        class="size-3.5 shrink-0"
                    />
                    全局 BUFF
                    <span class="text-(--theme-modal-text)/30">{shownGlobalBuffs.length}</span>
                </button>
                {#if globalBuffCollapsed}
                    <!-- 收起时给一行摘要，知道当前吃到了哪些（超出宽度截断） -->
                    <span
                        class="min-w-0 flex-1 truncate text-[10px] text-(--theme-modal-text)/35"
                        transition:fade={slideParams(MOTION_MS.fast)}
                        >{shownGlobalBuffs.map((gb) => gb.name).join('、')}</span
                    >
                {/if}
            </div>
            {#if !globalBuffCollapsed}
                <div
                    class="theme-scrollbar flex max-h-28 flex-wrap items-center gap-1 overflow-y-auto px-3 pb-2"
                    transition:slide|local={slideParams(MOTION_MS.base)}
                >
                    {#each shownGlobalBuffs as gb (gb.id)}
                        <Chip style="background: var(--theme-buff-yellow-bg); color: var(--theme-buff-yellow-text);">
                            <Icon icon="mdi:crown" class="size-3" />{gb.name}
                        </Chip>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
    <!-- @desc 表格滚动容器：横向/纵向滚动 + 框选鼠标事件 + Ctrl 滚轮次轴滚动 + 默认横向时普通滚轮也横滚 -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="spread-root theme-scrollbar min-h-0 flex-1 overflow-auto pb-48"
        data-sf="content"
        bind:this={rootEl}
        onmousedown={handleMouseDown}
        onclickcapture={handleClickCapture}
        onscroll={scheduleSyncSelection}
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
            <!-- 框选范围指示（GPU 模式用 transform 定位走合成层） -->
            <div
                class="pointer-events-none fixed z-(--z-modal)"
                style="{gpuAccel
                    ? `left:0;top:0;transform: translate(${selRect.left}px, ${selRect.top}px);`
                    : `left: ${selRect.left}px; top: ${selRect.top}px;`} width: {selRect.width}px; height: {selRect.height}px; background: color-mix(in srgb, var(--theme-accent-bg) 25%, transparent); border: 1px solid var(--theme-accent-bg);"
            ></div>
        {/if}
        {#if damageEntries.length === 0}
            <EmptyState size="lg" class="flex items-center justify-center">暂无伤害数据</EmptyState>
        {:else if shownGroupIdx.length === 0}
            <EmptyState size="lg" class="flex items-center justify-center">该伤害源暂无伤害条目</EmptyState>
        {/if}
        <!-- @desc 逐组渲染：每个角色×直伤/非直伤一个子表（表宽由表头内容决定）；只渲染当前伤害源页签命中的子表 -->
        {#each shownGroupIdx as gi (tableData[gi].key)}
            {@const group = tableData[gi]}
            {@const charElement = getCalcElementMap()[group.charName] ?? ''}
            {@const hasFolder = group.hasFolder}
            <div class="mx-3 my-3.5" data-group-wrap={gi}>
                <!-- 列表（表体）底色跟随「卡片」透明度/深度；data-sf-flat 只取底色不用毛玻璃（逐格元素避免逐元素重算模糊） -->
                <table
                    class="w-auto text-xs shadow-(--theme-card-shadow)"
                    data-sf="card"
                    data-sf-flat
                    data-group-table={gi}
                    style="--sf-base: var(--theme-modal-bg); border-collapse: separate; border-spacing: 0; border-right: 1px solid var(--theme-divider-border); border-bottom: 1px solid var(--theme-divider-border); border-left: 1px solid var(--theme-divider-border);"
                >
                    <!-- 标题块与全局 buff 折叠行放入 caption：宽度自动跟随表头（表格宽度） -->
                    <caption class="text-left" data-sf="card" data-sf-flat style="--sf-base: var(--theme-modal-bg);">
                        <div
                            class="flex items-center gap-2 border-b border-(--theme-divider-border) px-3 py-2"
                            style="background-image: linear-gradient(
                            color-mix(in srgb, var(--theme-modal-text) 4%, transparent),
                            color-mix(in srgb, var(--theme-modal-text) 4%, transparent)
                        );"
                        >
                            <span
                                class="text-sm font-black tracking-tight"
                                style="color: var(--theme-element-{charElement}, #888);"
                                >{group.charName || '无角色'}</span
                            >
                            <span class="text-xs text-(--theme-modal-text)/60"
                                >· {group.kind === 'direct' ? '直伤' : '非直伤'}</span
                            >
                            <span class="ml-auto text-[10px] text-(--theme-modal-text)/40">{group.rows.length} 条</span>
                        </div>
                    </caption>
                    <!-- 表头（两级，仅含叠层组时）：第一行=叠层组名行（跨列合并，普通列占位）；第二行=列名行（folder 子列显示层数数字，普通列显示略名换行），吸顶 -->
                    <thead>
                        {#if hasFolder}
                            <tr>
                                <!-- 表头（含「条目」角格）底色 = 工具栏层叠一层卡片底（并取卡片的毛玻璃，吸顶时挡住滚过的行）；角格只叠这一套，不再额外叠行头卡片底 -->
                                {@render entryCorner(2)}
                                {#each group.headerGroups as hc, i (i)}
                                    <th
                                        data-sf="toolbar"
                                        data-sf-under="card"
                                        class="sticky top-0 z-30 h-6 p-0 text-center {hc.sepClass}"
                                        style="--sf-base: var(--theme-modal-bg); --sfu-base: var(--theme-modal-bg);"
                                        colspan={hc.span}
                                    >
                                        {#if hc.label}
                                            <span
                                                class="block truncate px-1.5 text-[10px] font-black tracking-[0.12em] text-(--theme-modal-text)/70"
                                                title={hc.label}>{hc.label}</span
                                            >
                                        {/if}
                                    </th>
                                {/each}
                            </tr>
                        {/if}
                        <tr>
                            {#if !hasFolder}
                                <!-- 无叠层组时补「条目」占位列，避免第一个 buff 列错位到表头首列 -->
                                {@render entryCorner(undefined)}
                            {/if}
                            {#each group.headerCols as hc (hc.ci)}
                                {@const colHighlighted =
                                    highlight?.gi === gi && highlight.kind === 'col' && highlight.index === hc.ci}
                                {@const selCount = selStats.colCounts[gi]?.get(hc.ci) ?? 0}
                                {@const headTitle = columnHeadTitle(
                                    hc,
                                    selCount,
                                    hc.paneSource ? paneSourceTooltip(hc.paneSource) : ''
                                )}
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <th
                                    data-press=""
                                    data-colhead={hc.ci}
                                    data-sf="toolbar"
                                    data-sf-under="card"
                                    class="sticky {hasFolder
                                        ? 'top-6'
                                        : 'top-0'} z-30 cursor-pointer select-none border-b border-(--theme-divider-border) p-0 align-top {hc.isLayer
                                        ? 'w-[43px] min-w-[43px]'
                                        : ''} {hc.sepClass}"
                                    style="--sf-base: var(--theme-modal-bg); --sfu-base: var(--theme-modal-bg);"
                                    class:spread-head-hl={colHighlighted}
                                    title={headTitle}
                                    onclick={() => clickColHeader(gi, hc.ci)}
                                    oncontextmenu={(e) => onColHeaderContextMenu(e, gi, hc.ci)}
                                >
                                    <span
                                        class="flex h-full w-full flex-col items-center justify-center gap-1 px-1.5 pt-1 pb-1.5 transition-colors hover:bg-(--theme-modal-text)/5 {hc.enabled ===
                                        0
                                            ? 'opacity-30'
                                            : ''}"
                                    >
                                        {#if hc.isLayer}
                                            <span
                                                class="text-[11px] font-black leading-none tabular-nums text-(--theme-modal-text)/70"
                                                title={hc.title}>{hc.label}</span
                                            >
                                        {:else}
                                            <span
                                                class="line-clamp-2 w-max max-w-24 wrap-break-word text-center text-[10px] font-medium leading-3 text-(--theme-modal-text)/60"
                                                title={hc.title}>{hc.label}</span
                                            >
                                            <!-- @desc 影响源标记：该列作用于被本组引用的角色面板（勾上即参与该角色在这一段的面板） -->
                                            {#if hc.paneSource}
                                                <span
                                                    class="flex shrink-0 items-center"
                                                    style="color: var(--theme-accent-text);"
                                                    title={paneSourceTooltip(hc.paneSource)}
                                                >
                                                    <Icon icon="mdi:transit-connection-variant" class="size-3" />
                                                </span>
                                            {/if}
                                        {/if}
                                    </span>
                                </th>
                            {/each}
                        </tr>
                    </thead>
                    <!-- 表体：每行一个伤害条目（行头单击高亮行/右键全选全不选 + 伤害类型编辑），单元格可勾选 -->
                    <tbody>
                        {#each shownRows(group) as row, ri (row.entry.id)}
                            {@const rowHighlighted =
                                highlight?.gi === gi && highlight.kind === 'row' && highlight.index === ri}
                            {@const colHighlightActive = highlight?.gi === gi && highlight.kind === 'col'}
                            {@const selIds = entryBuffSetIdMap[row.entry.id] ?? EMPTY_IDS}
                            <tr class:spread-rowhl-on={rowHighlighted} class:split-row={row.splitBefore}>
                                <td
                                    data-press=""
                                    data-rowhead={ri}
                                    data-sf="card"
                                    data-sf-flat
                                    class="sticky left-0 z-20 cursor-pointer select-none border-r border-b border-(--theme-divider-border) px-3 py-1.5"
                                    style="--sf-base: var(--theme-modal-bg);"
                                    class:spread-frozen-hl={rowHighlighted}
                                    title={rowHeadTitle(
                                        row.entry.displayName,
                                        selStats.rowCounts.get(row.entry.id) ?? 0,
                                        row.enabledBuffIds.length
                                    )}
                                    onclick={() => clickRowHeader(gi, ri)}
                                    oncontextmenu={(e) => onRowHeaderContextMenu(e, gi, ri)}
                                >
                                    <div class="flex w-full items-center gap-1.5 py-0.5 text-left">
                                        <span
                                            class="truncate text-(--theme-modal-text)"
                                            style="color: var(--theme-element-{row.entry.damageElement}, #888);"
                                            >{row.entry.displayName}</span
                                        >
                                    </div>
                                    <!-- 视为：伤害类型（只读展示，编辑统一在底部工具栏的「编辑伤害类型」弹窗）；stopPropagation 避免触发行高亮 -->
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <div
                                        class="flex flex-wrap items-center gap-0.5 px-0.5 pb-0.5"
                                        onclick={(e) => e.stopPropagation()}
                                    >
                                        <span class="text-[10px] font-black leading-tight text-(--theme-modal-text)/70"
                                            >伤害类型：</span
                                        >
                                        {#each entryDamageTypeMap[row.entry.id] ?? [] as dt (dt)}
                                            <Tag style="background: var(--theme-input-bg);">{damageTypeShort(dt)}</Tag>
                                        {/each}
                                        {#if (entryDamageTypeMap[row.entry.id] ?? []).length === 0}
                                            {@const inferred = inferredDamageTypeMap[row.entry.id] ?? []}
                                            {#if inferred.length > 0}
                                                <span class="text-[10px] leading-tight text-(--theme-modal-text)/35"
                                                    >{inferredDamageTypeText(inferred)}</span
                                                >
                                            {/if}
                                        {/if}
                                    </div>
                                </td>
                                {#each group.visibleColIdx as ci, colPos (ci)}
                                    {@const cell = row.cells[ci]}
                                    {@const head = group.headerCols[colPos]}
                                    {@const colHighlighted = colHighlightActive && highlight?.index === ci}
                                    {@const on = selIds.includes(cell.buffId)}
                                    {@const named = on && (colHighlighted || rowHighlighted)}
                                    {@const cellTitle =
                                        cell.pane && head?.paneSource
                                            ? `${paneSourceTooltip(head.paneSource)}\n${on ? '点击取消勾选' : '点击勾选'}`
                                            : on
                                              ? head?.titleOn
                                              : head?.titleOff}
                                    <td
                                        class="min-w-9 border-b border-(--theme-divider-border) p-0 text-center {head?.sepClass ??
                                            ''}"
                                        class:spread-cell-hl={colHighlighted}
                                        data-group={gi}
                                        data-row={ri}
                                        data-col={ci}
                                    >
                                        {#if cell.enabled}
                                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                                            <button
                                                onclick={() => toggleCell(row, cell)}
                                                title={cellTitle}
                                                class="flex min-h-6 w-full cursor-pointer items-center justify-center px-1.5 py-1.5 transition-colors hover:bg-(--theme-modal-text)/10"
                                            >
                                                {#if on}
                                                    <!-- 高亮行/列时改显 buff 名：图标保留挂载仅隐藏，避免切换高亮时反复销毁/创建图标组件；
                                                     名称宽度上限与表头列宽上限一致，保证出现/消失不改变列 max-content（不触发整表重排） -->
                                                    <Icon
                                                        icon="mdi:check"
                                                        class="size-3.5 shrink-0"
                                                        style="color: var(--theme-accent-text);{named
                                                            ? ' display:none;'
                                                            : ''}"
                                                    />
                                                    {#if named}
                                                        <span
                                                            class="w-full {head?.nameMaxClass ??
                                                                'max-w-[106px]'} line-clamp-2 text-[10px] leading-tight text-(--theme-accent-text)"
                                                            >{columns[ci].name}</span
                                                        >
                                                    {/if}
                                                {:else if cell.pane}
                                                    <!-- 影响源（未勾选）：用连接图标提示这是别的角色面板的改写者 -->
                                                    <Icon
                                                        icon="mdi:transit-connection-variant"
                                                        class="size-3.5 shrink-0 opacity-30"
                                                    />
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
        {/each}
    </div>
</div>

<!-- @desc 首列/表头右键菜单：全选/全不选（行或列） -->
{#if ctxMenu}
    <ContextMenu open x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onclose={() => (ctxMenu = null)} />
{/if}

<!-- @desc 表头「条目」角格：两级表头时它跨两行（rowspan=2），单级表头时只占列名行 → 同一壳渲染两处 -->
{#snippet entryCorner(rowspan: number | undefined)}
    <th
        data-rowhead
        data-sf="toolbar"
        data-sf-under="card"
        class="sticky left-0 top-0 z-(--z-sticky) w-52 min-w-52 border-r border-(--theme-divider-border) px-3 text-left text-[10px] font-black tracking-[0.12em] text-(--theme-modal-text)/50"
        style="--sf-base: var(--theme-modal-bg); --sfu-base: var(--theme-modal-bg);"
        {rowspan}
    >
        条目
    </th>
{/snippet}

<style>
    /* 根容器：高亮用色（供单元格/行头/表头复用，避免逐元素拼内联样式） */
    .spread-root {
        --spread-hl: color-mix(in srgb, var(--theme-accent-bg) 20%, transparent);
    }
    /* 底色交给区域系统（data-sf）：列表=card；表头=toolbar 叠 card 底（含卡片毛玻璃）；此处只放高亮/分隔线等叠加效果 */
    /* 列间分割线：叠层组与邻接列之间用主题色实线，其余用常规分隔线 */
    .spread-sep {
        border-right: 1px solid var(--theme-divider-border);
    }
    .spread-sep-solid {
        border-right: 2px solid color-mix(in srgb, var(--theme-accent-bg) 25%, transparent);
    }
    /* 高亮：只给目标行/列上主题色浅洗（不压暗其它行列）：行=行级背景、列=列内单元格背景，表头/行头另加主题色标记线 */
    .spread-rowhl-on {
        background-color: var(--spread-hl);
    }
    /* 行头/表头带 data-sf（表头为 toolbar+card 两层图片背景），浅洗改用 inset box-shadow 叠加，避免覆盖区域系统的 background-image */
    .spread-frozen-hl {
        box-shadow:
            inset 3px 0 0 var(--theme-accent-bg),
            inset 0 0 0 9999px var(--spread-hl);
    }
    .spread-head-hl {
        box-shadow:
            inset 0 -2px 0 var(--theme-accent-bg),
            inset 0 0 0 9999px var(--spread-hl);
    }
    .spread-cell-hl {
        background-color: var(--spread-hl);
    }
    /* 排轴上「上一个伤害倍率不是当前伤害源引起的」→ 该行上方画加粗提亮的主题色点横线，行头处实线收口，突出这次不连续 */
    .split-row td {
        border-top: 2px dashed color-mix(in srgb, var(--theme-accent-bg) 70%, transparent);
    }
    .split-row td[data-rowhead] {
        border-top-style: solid;
    }
</style>
