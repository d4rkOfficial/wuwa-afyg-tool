<script lang="ts">
    /** @desc 拉表平铺视图（同一组件两种模式）：分类平铺 = 按角色×直伤/非直伤分组、Buff 作列、条目作行（同源两条倍率之间夹了别的来源 → 行间画主题色分割线）；分段平铺 = 按时间记点切段、所有伤害按顺序列出（非选中来源的行首列灰化、右侧留白，选中来源的连续行段首尾画主题色分割线）。支持单元格三态勾选 / 灰色禁止 / 空心圆门槛提示、框选批量、叠层文件夹列线区分
     *  性能约定：
     *  1) 结构化数据（可用性/表头/列分隔）与勾选状态分离——点单元格不重建整表结构；
     *  2) 列表底色走区域系统 card（data-sf-flat，无毛玻璃）；吸顶表头（toolbar 叠 card 底）与首列行头（card 毛玻璃）保留模糊，
     *     这样铺开表的首列不会把壁纸直接漏出来（模糊元素数量只与列数/行数同阶）；
     *  3) 高亮只给目标行/列上主题色，不压暗其它行列（无遮罩测量、无逐行 opacity 合成层），也不替换单元格图标；
     *  4) 渐进渲染按结构指纹重置，并以切片方式分帧揭示；
     *  5) 表格宽度由表头内容决定（不测宽等宽、不补填充列）；
     *  6) 顶部「伤害源」切换按角色过滤要渲染的子表，从根上减少一次挂载的行/格数量。 */
    import { onMount, onDestroy } from 'svelte'
    import type { BuffConf, DamageEntry } from '$lib/calc/calculation.types'
    import type { WeaponInfo } from '$lib/api/types'
    import { getWeaponInfo } from '$lib/api/data-cache'
    import { buffLeafName } from '$lib/calc/buff-name'
    import type { CharSlot } from '$lib/types/project'
    import type { ConditionProfile, RuleEvalDeps } from '$lib/calc/compute'
    import type { PaneEffectSource } from '$lib/calc/pane-effects'
    import { createEntryRuleMatcher } from '$lib/calc/compute'
    import {
        applyIdsSelection,
        buildCharToIdx,
        buildDamageTypesByEntry,
        buildInferredDamageTypeMap,
        cellBlockReasonOf,
        damageTypeShort,
        inferredDamageTypeText,
        paneSourceText
    } from './damage-table.utils'
    import {
        buildCategorizedTable,
        buildSegmentedTables,
        buildSegmentMarkers,
        buildSegmentSpecs,
        buildSelectionStats,
        buildSourceTabs,
        columnHeadTitle,
        groupEntriesBySource,
        headColumnWidthPx,
        HEAD_BAND_LINES,
        HEAD_BAND_TRACKING_PX,
        HEAD_COL_MIN_PX,
        HEAD_NAME_LINES,
        resolveActiveSource,
        rowFingerprintOf,
        rowHeadTitle,
        visibleRowsOf,
        type CalcTable,
        type CellState,
        type RowData,
        type SourceEntryGroup
    } from './spread-table.utils'
    import { getCalcElementMap, getPaneEffectSources, getBuffTree } from '$lib/calc/calculation.store.svelte'
    import { getConfig } from '$lib/calc/config.store.svelte'
    import { getRefLines, getOpBlocks } from '$lib/calc/timeline.store.svelte'
    import { storedColumnLayout } from '$lib/calc/buff-tree-state'
    import { elementColor, getCharIconMap } from '$lib/calc/timeline.store.svelte'
    import {
        getHeaderCompact,
        getScrollAxisDefault,
        getShowUnmetColumns,
        setScrollAxisDefault,
        type CalcViewMode
    } from '$lib/data/calc-view.svelte'
    import { ensureCharInfo, ensureEchoSkillText, getCharInfoMap, getEchoSkillText } from '$lib/data/char-info.svelte'
    import { buildEchoDescByEntry } from '$lib/calc/skill-infer'
    import { getShortcutKey, normalizeShortcutEvent } from '$lib/data/shortcuts.svelte'
    import { registerDragCancel } from '$lib/utils/drag-guard'
    import { fallbackIcon } from '$lib/utils/icons'
    import { getGpuAccel } from '$lib/data/render-prefs.svelte'
    import { getActiveId, getActiveProject } from '$lib/data/project.svelte'
    import { attachSessionScroll, readSessionScroll, readSessionTab, writeSessionTab } from '$lib/data/view-session'
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import ContextMenu from '$lib/components/layout/context-menu.svelte'
    import Tag from '$lib/components/ui/tag.svelte'
    import EmptyState from '$lib/components/ui/empty-state.svelte'

    interface Props extends ComponentsProps {
        team: [CharSlot, CharSlot, CharSlot]
        damageEntries: DamageEntry[]
        buffSets: BuffConf[]
        entryBuffSetIdMap: Record<string, string[]>
        entryDamageTypeMap: Record<string, string[]>
        conditionProfile: ConditionProfile
        /** @desc 视图模式：分类平铺 / 分段平铺（同一张组件，靠它切换结构） */
        mode: CalcViewMode
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
        conditionProfile,
        mode,
        ontoggle,
        onSetEntryBuffSetIds,
        onSetEntriesBuffSetIds,
        class: className,
        style: styleProp
    }: Props = $props()

    /** @desc 非全局树按存储顺序展开：列 + 每列的「一级/二级/Buff」路径 */
    const columnLayout = $derived(storedColumnLayout(getBuffTree(), buffSets))
    const columns = $derived(columnLayout.columns)
    const columnPaths = $derived(columnLayout.paths)

    /** @desc 列 id → 全局列序索引（勾选统计用，避免每格线性查找） */
    const colIndexById = $derived.by(() => new Map(columns.map((c, i) => [c.id, i] as const)))

    /** @desc 不按名字叠层分组；表头路径由 columnPaths 提供 */
    const folderGroupOf = $derived(new Map())

    const pathAt = (ci: number): string[] => columnPaths.get(columns[ci]?.id ?? '') ?? [columns[ci]?.name ?? '']

    /** @desc 顶级文件夹边界=实线；次级文件夹边界=虚线；同文件夹内/根 Buff 间=常规线 */
    const sepClassAt = (group: CalcTable, colPos: number): string => {
        const ci = group.visibleColIdx[colPos]
        const nextCi = group.visibleColIdx[colPos + 1]
        if (ci === undefined || nextCi === undefined) return ''
        const cur = pathAt(ci)
        const next = pathAt(nextCi)
        const topOf = (path: string[]) => (path.length > 1 ? path[0] : null)
        const secondOf = (path: string[]) => (path.length > 2 ? path[1] : null)
        const curTop = topOf(cur)
        const nextTop = topOf(next)
        if (curTop !== nextTop) {
            return curTop === null && nextTop === null ? 'spread-sep' : 'spread-sep-solid'
        }
        return secondOf(cur) !== secondOf(next) ? 'spread-sep-dashed' : 'spread-sep'
    }

    /** @desc 表头层数 = 最深路径长度（根 Buff=1、一级文件夹=2、二级文件夹=3） */
    const headerDepth = $derived(Math.max(1, ...columns.map((column) => columnPaths.get(column.id)?.length ?? 1)))
    /** @desc 表头是否简略（全局偏好）：简略 = 隐藏首行/次行（文件夹横条），只保留列名行 */
    const headerCompact = $derived(getHeaderCompact())
    /** @desc 当前有效表头层数：简略时恒为 1（角格 rowspan / 吸顶偏移都按它算） */
    const effectiveDepth = $derived(headerCompact ? 1 : headerDepth)

    interface HeaderBandCell {
        key: string
        label: string
        /** @desc 该横条覆盖的列数（colspan） */
        span: number
        /** @desc 该横条在 `visibleColIdx` 里的起始列位（分配列宽时用） */
        start: number
        sepClass: string
    }

    /** @desc 顶级/中层表头按路径前缀合并为 colspan；根 Buff 的上级留空 */
    const headerBandsOf = (group: CalcTable): HeaderBandCell[][] => {
        if (headerCompact) return []
        const bands = headerDepth - 1
        if (bands <= 0) return []
        const paths = group.visibleColIdx.map((ci) => pathAt(ci))
        const rows: HeaderBandCell[][] = []
        const keyOf = (path: string[], level: number): string => {
            const top = path.length > 1 ? path[0] : ''
            const second = path.length > 2 ? path[1] : ''
            return level === 0 ? top : `${top}\u0000${second}`
        }
        const labelOf = (path: string[], level: number): string =>
            level === 0 ? (path.length > 1 ? path[0] : '') : path.length > 2 ? path[1] : ''
        for (let level = 0; level < bands; level++) {
            const cells: HeaderBandCell[] = []
            let i = 0
            while (i < paths.length) {
                const key = keyOf(paths[i], level)
                let j = i + 1
                while (j < paths.length && keyOf(paths[j], level) === key) j++
                const next = paths[j]
                let sepClass = ''
                if (next) {
                    const nextKey = keyOf(next, level)
                    if (level === 0) sepClass = 'spread-sep-solid'
                    else if (keyOf(paths[j], 0) !== keyOf(paths[i], 0)) sepClass = 'spread-sep-solid'
                    else if (nextKey !== key) sepClass = 'spread-sep-dashed'
                }
                cells.push({
                    key: `${level}:${i}:${key}`,
                    label: labelOf(paths[i], level),
                    span: j - i,
                    start: i,
                    sepClass
                })
                i = j
            }
            rows.push(cells)
        }
        return rows
    }

    /**
     * @desc 每列宽度（px，按 `visibleColIdx` 的列位索引）。
     * 取「列名行最多 2 行」与「各级文件夹横条最多 3 行、按 colspan 分摊」两者的较大需求，
     * 于是长文案靠**列变宽**而不是靠无限折行消化（口径与常量见 `spread-table.utils` 的 `headColumnWidthPx`）。
     * 横条带 `tracking-[0.1em]`：字距必须一起算进去，否则宽度算少一截，长文案会正好多折一行。
     */
    const columnWidthsOf = (group: CalcTable, bands: readonly HeaderBandCell[][]): number[] => {
        const widths = group.visibleColIdx.map((ci, colPos) => {
            const hc = group.headerCols[colPos]
            const label = hc ? buffLeafName(columns[ci]?.name ?? hc.label) : ''
            return headColumnWidthPx(label, HEAD_NAME_LINES)
        })
        for (const band of bands) {
            for (const cell of band) {
                if (!cell.label) continue
                const width = headColumnWidthPx(cell.label, HEAD_BAND_LINES, cell.span, HEAD_BAND_TRACKING_PX)
                for (let k = 0; k < cell.span; k++) {
                    const idx = cell.start + k
                    if (idx < widths.length) widths[idx] = Math.max(widths[idx], width)
                }
            }
        }
        return widths
    }

    /** @desc 横条文字上限 = 它覆盖的那几列宽度之和（防止长文本把整组列撑宽） */
    const bandLabelMaxWidth = (widths: readonly number[], start: number, span: number): number => {
        let total = 0
        for (let k = 0; k < span; k++) total += widths[start + k] ?? HEAD_COL_MIN_PX
        return total
    }

    /** @desc 一列的分隔线类（列位索引）：一次算好，单元格渲染只查数组 */
    const columnSepsOf = (table: CalcTable): string[] =>
        table.visibleColIdx.map((_, colPos) => sepClassAt(table, colPos))

    interface TableLayout {
        bands: HeaderBandCell[][]
        widths: number[]
        seps: string[]
    }

    /**
     * @desc 表头各行的 sticky 顶部偏移（入参是该行在 thead 里的下标，列名行也按同一套算）。
     * 必须与模板里的两档高度逐项对齐（改高度就要同步改这里，否则吸顶表头会互相盖住）：
     * 文件夹行 `h-12`(48px，3 行文字 + 4px 余量) → 列名行 `h-8`(32px，2 行文字)；
     * 两级表头时列名行从 48 起 → `top-12`；三级表头时从 48×2=96 起 → `top-24`。
     */
    const headerTopClass = (rowIndex: number, depth: number): string => {
        if (rowIndex === 0) return 'top-0'
        if (depth === 2) return 'top-12'
        return rowIndex === 1 ? 'top-12' : 'top-24'
    }

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

    /** @desc 武器信息（面板类门槛 `zoneCompare` 要用；与技术详情同源，取不到就按无武器算） */
    let weaponInfoMap = $state<Record<string, WeaponInfo>>({})
    $effect(() => {
        const names = team.map((slot) => slot.weapon).filter((name): name is string => !!name)
        if (names.length === 0) return
        void Promise.all(names.map((name) => getWeaponInfo(name).catch(() => null))).then((list) => {
            const map: Record<string, WeaponInfo> = {}
            names.forEach((name, i) => {
                const info = list[i]
                if (info) map[name] = info
            })
            weaponInfoMap = map
        })
    })

    /** @desc 引擎入参（Buff 级门槛求值用：面板 / 敌人类型 / 队伍） */
    const engineDeps = $derived<RuleEvalDeps>({
        team,
        configState: getConfig(),
        charInfoMap,
        weaponInfoMap,
        ...(getConfig().enemy?.type ? { enemyType: getConfig().enemy.type } : {})
    })

    /**
     * @desc **与勾选无关**的单元格结构判定（`cellBlockReasonOf`）：
     * 硬门槛（作用域 / 乘区）决定列是否保留；软条件（伤害属性/类型）只让该格变灰禁。
     *
     * 缓存只有「与勾选无关」的上下文 → **点单元格不会重建整表结构**（这是交互流畅的关键）。
     * 缓存挂在组件实例上（普通 `<script>` 是实例作用域），上下文引用变化即整体作废。
     */
    /** @desc 结构判定上下文（与勾选无关）：`$derived` 引用比较，逐格 O(1) 且不分配对象 */
    const stateCtx = $derived({
        profile: conditionProfile,
        types: entryDamageTypeMap,
        chars: charToIdx,
        infos: charInfoMap,
        echoes: echoDescByEntry,
        entries: damageEntries
    })
    let _stateCache = new Map<string, CellState>()
    let _stateCtxRef: typeof stateCtx | null = null

    function cellStateOf(bs: BuffConf, entry: DamageEntry, charIdx: number): CellState {
        if (_stateCtxRef !== stateCtx) {
            _stateCtxRef = stateCtx
            _stateCache.clear()
        }
        const key = entry.id + '\u0000' + bs.id
        const cached = _stateCache.get(key)
        if (cached) return cached
        const reason = cellBlockReasonOf(bs, entry, charIdx, damageTypesByEntry.get(entry.id), conditionProfile)
        // 硬门槛不过（scope/zone）→ 列不保留；软条件不过（condition）→ 列保留、只是这格灰禁
        const state: CellState = { blocked: reason !== null, hardOk: reason === null || reason === 'condition' }
        _stateCache.set(key, state)
        return state
    }

    /**
     * @desc Buff 级门槛（链/阶/面板/伤害名/敌人类型/Buff 依赖）是否满足 —— **依赖勾选**（面板与生效集合随绑定变化），
     * 所以只在**渲染时**按可见格现算，不写进表结构；开启「隐藏不达门槛列」时才在构建期参与选列。
     *
     * 判定器按条目装配一次（`createEntryRuleMatcher`）再逐 Buff 调用：一条行有上百列，逐格重建面板会把整表拖垮。
     * 缓存按**该条目的绑定数组引用**失效（与 `paneSourcesOf` 同一套键设计）：勾选一次只有那一条的绑定数组换新，
     * 其余行直接命中；否则一次勾选会把全部 matcher 重装（实测 C 档 5.4ms）。
     */
    /** @desc 门槛判定上下文（与勾选无关的那部分）：`$derived` 引用比较，整体作废用 */
    const rulesCtx = $derived({
        profile: conditionProfile,
        deps: engineDeps,
        buffs: buffSets,
        entries: damageEntries
    })
    interface EntryRules {
        /** @desc 该条目当前的绑定数组（引用即版本号，换新即整条失效） */
        bound: readonly string[]
        matcher: (buff: BuffConf) => boolean
    }
    let _rulesByEntry = new Map<string, EntryRules>()
    let _rulesMet = new Map<string, Map<string, boolean>>()
    let _rulesCtxRef: typeof rulesCtx | null = null

    function rulesMetOf(bs: BuffConf, entry: DamageEntry): boolean {
        if ((bs.rules?.length ?? 0) === 0) return true
        if (_rulesCtxRef !== rulesCtx) {
            _rulesCtxRef = rulesCtx
            _rulesByEntry = new Map()
            _rulesMet = new Map()
        }
        const perEntry = _rulesMet.get(entry.id)
        const cached = perEntry?.get(bs.id)
        if (cached !== undefined) return cached
        const bound = entryBuffSetIdMap[entry.id] ?? EMPTY_IDS
        let rules = _rulesByEntry.get(entry.id)
        if (!rules || rules.bound !== bound) {
            const boundIds = new Set(bound)
            rules = {
                bound,
                matcher: createEntryRuleMatcher({
                    entry,
                    boundBuffs: buffSets.filter((buff) => boundIds.has(buff.id)),
                    profile: conditionProfile,
                    deps: engineDeps
                })
            }
            _rulesByEntry.set(entry.id, rules)
        }
        const met = rules.matcher(bs)
        const byBuff = _rulesMet.get(entry.id) ?? new Map<string, boolean>()
        byBuff.set(bs.id, met)
        _rulesMet.set(entry.id, byBuff)
        return met
    }

    const EMPTY_IDS: string[] = []
    /** @desc 是否隐藏「不达门槛」的 Buff 列（全局偏好；关闭时结构完全不依赖勾选，交互最顺） */
    const hideUnmetColumns = $derived(!getShowUnmetColumns())

    /**
     * @desc 影响源查询的**按条目缓存**：`paneEffectSourcesOf` 要对「本段已绑定的引用」×「全量 Buff」做嵌套扫描
     * （实测 190 条 × 139 Buff ≈ 10ms），而勾选一次只有一条条目的绑定真的变了。
     * 用「该条目的绑定数组引用」作缓存键 → 只有被改的那一条重算，其余直接命中。
     */
    let _paneCache = new Map<string, { bound: readonly string[]; value: Record<string, PaneEffectSource> }>()
    const paneSourcesOf = (entryId: string): Record<string, PaneEffectSource> => {
        const bound = entryBuffSetIdMap[entryId] ?? EMPTY_IDS
        const hit = _paneCache.get(entryId)
        if (hit && hit.bound === bound) return hit.value
        const value = getPaneEffectSources(entryId)
        _paneCache.set(entryId, { bound, value })
        return value
    }

    /**
     * @desc 影响源提示文案：该列 Buff 作用于「被本组某段伤害引用的角色」，会改写那个角色的面板乘区。
     * 伤害是当下的 —— 勾上它，它就会参与该角色在这一段伤害下的面板计算。
     */
    const paneSourceTooltip = (src: { charName: string; zoneLabels: string[] }): string =>
        paneSourceText(src.charName, src.zoneLabels, '本组的伤害')

    /** @desc 视角记忆所属工程：本组件随工程切换重挂载（+page 的 `{#key activeProject.id}`），取挂载时的活动工程即可 */
    const sessionProjectId = getActiveId()

    /** @desc ── 伤害源切换（主内容区顶部）：一次只选一个来源；只影响显示/可编辑范围，不改任何勾选数据。
     *  初值取本工程上次看的页签（会话记忆，见 `$lib/data/view-session`）── */
    let sourceKey = $state<string | null>(readSessionTab(sessionProjectId, 'calculation'))
    const charIconMap = $derived(getCharIconMap())

    /** @desc 页签 = 角色×(直伤/非直伤) + 其它；空表页签不出现（计数直接来自条目分组，不必先建表） */
    const sourceGroups = $derived<SourceEntryGroup[]>(groupEntriesBySource(damageEntries, charToIdx))
    /** @desc 条目 → 全量伤害序列下标（分类平铺判定「不连续」：两个同源倍率之间夹了别的来源） */
    const entryOrderMap = $derived.by(() => {
        const map = new Map<string, number>()
        damageEntries.forEach((entry, i) => map.set(entry.id, i))
        return map
    })
    const sourceTabs = $derived(buildSourceTabs({ team, groups: sourceGroups, elementColorOf: elementColor }))
    /** @desc 生效的页签：未手动选择（或所选页签已消失）时取第一个页签 */
    const activeSource = $derived(resolveActiveSource(sourceKey, sourceTabs))
    /** @desc 分类平铺：**只为选中来源建这一张表**（全量建其它来源纯属浪费） */
    const categorizedTables = $derived<CalcTable[]>(
        mode !== 'categorized'
            ? []
            : (() => {
                  const group = sourceGroups.find((g) => g.key === activeSource)
                  if (!group) return []
                  return [
                      buildCategorizedTable(
                          {
                              columns,
                              charToIdx,
                              team,
                              folderGroupOf,
                              stateFor: cellStateOf,
                              ...(hideUnmetColumns ? { rulesMetFor: rulesMetOf, hideUnmetColumns } : {}),
                              paneSourcesOf,
                              orderIndexOf: (id) => entryOrderMap.get(id) ?? -1
                          },
                          group
                      )
                  ]
              })()
    )

    /** @desc 条目 → 时间轴位置（分段平铺切段用；来源块可能是操作块也可能是参考线） */
    const blockPosMap = $derived.by(() => {
        const map = new Map<string, number>()
        for (const block of getOpBlocks()) map.set(block.id, block.pos)
        for (const line of getRefLines()) map.set(line.id, line.pos)
        return map
    })
    /** @desc 分割标记 = 有记点的参考线（`analysis.timings` 里 seconds 非空的那些） */
    const segmentMarkers = $derived(buildSegmentMarkers(getActiveProject()?.analysis?.timings ?? [], getRefLines()))
    const segmentSpecs = $derived(buildSegmentSpecs(segmentMarkers))

    /** @desc 分段平铺：每段一张表，行 = 全部伤害（非选中来源的行只显示首列，右侧留白） */
    const segmentedTables = $derived(
        mode === 'segmented'
            ? buildSegmentedTables({
                  specs: segmentSpecs,
                  damageEntries,
                  posOf: (entry) => blockPosMap.get(entry.sourceTimelineBlockId) ?? 0,
                  charToIdx,
                  activeSource,
                  columns,
                  folderGroupOf,
                  stateFor: cellStateOf,
                  ...(hideUnmetColumns ? { rulesMetFor: rulesMetOf, hideUnmetColumns } : {})
              })
            : []
    )

    /** @desc 要渲染的表：分类平铺 = 选中来源那张；分段平铺 = 每段一张 */
    const tables = $derived<CalcTable[]>(mode === 'segmented' ? segmentedTables : categorizedTables)

    /**
     * @desc 每张表的**渲染布局**（表头横条 / 列宽 / 分隔线）一次性算好并缓存。
     *
     * 为什么不在模板里现算：模板里的 `{#each}` 会在「渐进渲染揭示新行」「高亮切换」等状态变化时重新求值，
     * 现算会把 `headerBandsOf` / `columnWidthsOf`（按文字量估算宽度）重复跑上百次。
     * 这里只依赖表结构 → 行揭示/高亮不触发这些计算。
     */
    const tableLayouts = $derived<TableLayout[]>(
        tables.map((table) => {
            const bands = headerBandsOf(table)
            return { bands, widths: columnWidthsOf(table, bands), seps: columnSepsOf(table) }
        })
    )

    /** @desc 勾选统计（已选数）：按「已绑定的 (条目, buff) 对」增量累加——成本 O(已绑定数)，而非 O(行×列) */
    const selStats = $derived(buildSelectionStats(tables, entryBuffSetIdMap, colIndexById))

    const selectSource = (key: string) => {
        sourceKey = key
        writeSessionTab(sessionProjectId, 'calculation', key)
        // 被过滤掉的子表上的高亮随之失效，避免留下看不见的高亮状态
        highlight = null
    }

    /** @desc 单击单元格：切换绑定（分段平铺里非选中来源的行不可编辑） */
    function toggleCell(row: RowData, buffId: string) {
        if (!row.editable) return
        ontoggle(row.entry.id, buffId)
    }

    /** @desc 行/列全选或全不选（右键菜单触发；行/列头点击只做高亮） */
    function selectRow(row: RowData, all: boolean) {
        if (!row.editable || row.enabledBuffIds.length === 0) return
        onSetEntryBuffSetIds(
            row.entry.id,
            applyIdsSelection(entryBuffSetIdMap[row.entry.id] ?? [], row.enabledBuffIds, all)
        )
    }

    function selectColumn(group: CalcTable, ci: number, all: boolean) {
        const col = columns[ci]
        for (const r of group.rows) {
            if (!r.editable || !r.cells[ci]?.enabled) continue
            onSetEntryBuffSetIds(r.entry.id, applyIdsSelection(entryBuffSetIdMap[r.entry.id] ?? [], [col.id], all))
        }
    }

    /** @desc ── 行/列高亮（左键单击首列/表头触发，行列互斥；再点同目标取消，表格外点击清除）──
     *  行高亮=行级 opacity 压暗其他行；列高亮=单层遮罩压暗非高亮列（仅 1~2 个矩形，不用逐单元格 opacity） */
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

    function onRowHeaderContextMenu(e: MouseEvent, ti: number, ri: number) {
        e.preventDefault()
        const row = tables[ti]?.rows[ri]
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

    function onColHeaderContextMenu(e: MouseEvent, ti: number, ci: number) {
        e.preventDefault()
        const group = tables[ti]
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
    const maxGroupRows = $derived(tables.reduce((m, table) => Math.max(m, table.rows.length), 0))
    const ROW_CHUNK = 24
    let visibleRows = $state(ROW_CHUNK)
    /** @desc 结构指纹（条目集合 + 列集合）：切换工程/队伍后重置分帧进度，避免沿用上一个大表的值而失去分帧保护 */
    const rowFingerprint = $derived(rowFingerprintOf(tables))
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
    const shownRows = (g: CalcTable): RowData[] => visibleRowsOf(g.rows, visibleRows)

    /**
     * @desc 表格滚动位置的会话记忆（切页签/切工程再回来时回到上次的视野，见 `$lib/data/view-session`）。
     *
     * 位置**按「视图+页签」分别记**：页签之间行数差别很大，共用一份会被较短页签夹掉。
     * 记录与恢复都要让着「渐进渲染」与浏览器的夹取：
     *  - 必须等本页签的行**铺满**（`visibleRows >= activeGroupRows`）再恢复：行是逐帧揭示的，过早写
     *    scrollTop 会被夹到「当前已揭示的高度」，对着还没长高的表设位置只会把记忆里的位置丢掉；
     *  - 恢复落定前**不记录**：切页签时浏览器会把 scrollTop 夹到新内容的高度并补发一次 scroll 事件，
     *    记下来就会把新页签的位置覆盖成「夹后的值」（恰是马上要恢复的那个值）。
     */
    const spreadSlotOf = (source: string): string => `spread:${mode}:${source}`
    const spreadScrollKey = (source: string): string => `${source}|${rowFingerprint}`
    /** @desc 当前页签要渲染的行数上限：渐进渲染进度拿它比，不必等别的页签的大表铺完才恢复本页签的位置 */
    const activeGroupRows = $derived(tables.reduce((m, table) => Math.max(m, table.rows.length), 0))
    /** @desc 已恢复落定的「页签|结构指纹」（$state：记录下来要让上面的记录 effect 重新挂上监听） */
    let scrollRestoredKey = $state('')
    $effect(() => {
        const el = rootEl
        const source = activeSource
        if (!el || source === null) return
        if (scrollRestoredKey !== spreadScrollKey(source)) return
        return attachSessionScroll(el, sessionProjectId, 'calculation', spreadSlotOf(source), { restore: false })
    })
    $effect(() => {
        const el = rootEl
        const source = activeSource
        if (!el || source === null) return
        if (visibleRows < activeGroupRows) return
        const key = spreadScrollKey(source)
        if (scrollRestoredKey === key) return
        scrollRestoredKey = key
        const pos = readSessionScroll(sessionProjectId, 'calculation', spreadSlotOf(source))
        if (!pos) return
        el.scrollTop = pos.top
        el.scrollLeft = pos.left
    })

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
     *  范围由调用方（mouseup）快照传入，不读交互状态，便于「先隐藏框、延后应用」 */
    function applySelection(gi: number, r0: number, r1: number, c0: number, c1: number) {
        const group = tables[gi]
        if (!group) return
        const byRow = new Map<RowData, string[]>()
        let anySelected = false
        for (let ri = r0; ri <= r1; ri++) {
            const row = group.rows[ri]
            if (!row?.editable) continue
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

<!-- @desc 平铺表根容器：顶部伤害源页签（不滚动）+ 下方表格滚动区 -->
<div class="flex h-full flex-col {className}" style={styleProp}>
    <!-- @desc 伤害源切换：页签 = 每个角色的「直伤」「非直伤」各一个 + 「其它」，空表页签不显示；
         一次只选一个来源（分类平铺只渲染那张子表，分段平铺只有该来源的行可勾 Buff） -->
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
                    title={`${tab.label}：${tab.count} 条伤害`}
                >
                    {#if tab.char && charIconMap[tab.char]}
                        <img
                            src={charIconMap[tab.char]}
                            alt=""
                            use:fallbackIcon={'/icons/placeholder-character.svg'}
                            class="size-5 shrink-0 rounded-full"
                        />
                    {:else if tab.kind === 'other'}
                        <span
                            class="flex size-5 shrink-0 items-center justify-center rounded-full bg-(--theme-modal-text)/10"
                            ><Icon icon="mdi:dots-horizontal" class="size-3.5" /></span
                        >
                    {:else}
                        <span
                            class="flex size-5 shrink-0 items-center justify-center rounded-full bg-(--theme-modal-text)/10 text-[10px]"
                            >{tab.char?.charAt(0) ?? '?'}</span
                        >
                    {/if}
                    <span>{tab.label}</span>
                </button>
            {/each}
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
        {:else if tables.length === 0}
            <EmptyState size="lg" class="flex items-center justify-center">该伤害源暂无伤害条目</EmptyState>
        {/if}
        <!-- @desc 逐表渲染：分类平铺 = 选中来源那一张；分段平铺 = 每个时间段一张（表宽由表头内容决定） -->
        {#each tables as table, ti (table.key)}
            {@const charElement = table.element ? (getCalcElementMap()[table.element] ?? '') : ''}
            {@const layout = tableLayouts[ti]}
            <div class="mx-3 my-3.5" data-group-wrap={ti}>
                <!-- 列表（表体）底色跟随「卡片」透明度/深度；data-sf-flat 只取底色不用毛玻璃（逐格元素避免逐元素重算模糊） -->
                <table
                    class="w-auto text-xs shadow-(--theme-card-shadow)"
                    data-sf="card"
                    data-sf-flat
                    data-group-table={ti}
                    style="--sf-base: var(--theme-modal-bg); border-collapse: separate; border-spacing: 0; border-right: 1px solid var(--theme-divider-border); border-bottom: 1px solid var(--theme-divider-border); border-left: 1px solid var(--theme-divider-border);"
                >
                    <!-- 标题块与全局 buff 折叠行放入 caption：宽度自动跟随表头（表格宽度） -->
                    <!-- 条带底纹与分隔线铺满表宽（strip 不动），里面的标题文字块单独 `sticky left-0`：
                         横向滚动时标题不跟着跑掉。sticky 要有滑动余量 —— 文字块必须比 caption 窄
                         （用 `w-max` 按内容自适应），否则和 caption 同宽会被顶住而失效（实测）。 -->
                    <caption
                        class="border-b border-(--theme-divider-border) text-left"
                        data-sf="card"
                        data-sf-flat
                        style="--sf-base: var(--theme-modal-bg); box-shadow: inset 0 0 0 9999px color-mix(in srgb, var(--theme-modal-text) 4%, transparent);"
                    >
                        <div class="sticky left-0 z-10 flex w-max items-center gap-2 px-3 py-2">
                            <span
                                class="text-sm font-black tracking-tight"
                                style={charElement
                                    ? `color: var(--theme-element-${charElement}, #888);`
                                    : 'color: var(--theme-modal-text);'}>{table.title}</span
                            >
                            <span class="text-xs text-(--theme-modal-text)/60">· {table.subtitle}</span>
                            <span class="text-[10px] text-(--theme-modal-text)/40">{table.rows.length} 条</span>
                        </div>
                    </caption>
                    <!-- 表头：顶级/中层文件夹按路径前缀 colspan 合并，最后一行为每列 Buff 短名；简略态跳过文件夹横条 -->
                    <thead>
                        {#each layout.bands as band, rowIdx (rowIdx)}
                            <tr>
                                {#if rowIdx === 0}
                                    {@render entryCorner(effectiveDepth)}
                                {/if}
                                {#each band as cell (cell.key)}
                                    <!-- 文件夹横条：固定 3 行高度（`h-12` = 3 × leading-3 12px + py-1 8px = 44px，另留 4px 余量），
                                         文字放不下时靠**列变宽**消化（列宽由 `columnWidthsOf` 按文字量算），不无限折行。 -->
                                    <th
                                        data-sf="toolbar"
                                        data-sf-under="card"
                                        data-sf-layer
                                        class="sticky {headerTopClass(
                                            rowIdx,
                                            effectiveDepth
                                        )} z-30 h-12 overflow-hidden border-b border-(--theme-divider-border) p-0 text-center {cell.sepClass}"
                                        style="--sf-base: var(--theme-modal-bg); --sfu-base: var(--theme-modal-bg);"
                                        colspan={cell.span}
                                    >
                                        {#if cell.label}
                                            <!-- 上限 = 该横条覆盖的那几列宽度之和：表格是 `w-auto` 自动布局，
                                                 `max-content` 会把整组列撑宽，故必须给长文本一个包住它的上限。 -->
                                            <span
                                                class="line-clamp-3 max-w-full break-words px-1.5 py-1 text-center text-[10px] font-black leading-3 tracking-[0.1em] text-(--theme-modal-text)/70"
                                                style="max-width: {bandLabelMaxWidth(
                                                    layout.widths,
                                                    cell.start,
                                                    cell.span
                                                )}px;"
                                                title={cell.label}>{cell.label}</span
                                            >
                                        {/if}
                                    </th>
                                {/each}
                            </tr>
                        {/each}
                        <tr>
                            {#if layout.bands.length === 0}
                                {@render entryCorner(effectiveDepth)}
                            {/if}
                            {#each table.headerCols as hc, colPos (hc.ci)}
                                {@const colHighlighted =
                                    highlight?.gi === ti && highlight.kind === 'col' && highlight.index === hc.ci}
                                {@const selCount = selStats.colCounts[ti]?.get(hc.ci) ?? 0}
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
                                    data-sf-layer
                                    data-col-w={layout.widths[colPos] ?? HEAD_COL_MIN_PX}
                                    class="sticky {headerTopClass(
                                        layout.bands.length,
                                        effectiveDepth
                                    )} z-30 h-8 min-w-[108px] cursor-pointer select-none border-b border-(--theme-divider-border) p-0 align-middle {layout
                                        .seps[colPos] ?? ''}"
                                    style="--sf-base: var(--theme-modal-bg); --sfu-base: var(--theme-modal-bg); width: {layout
                                        .widths[colPos] ?? HEAD_COL_MIN_PX}px;"
                                    class:spread-head-hl={colHighlighted}
                                    title={headTitle}
                                    onclick={() => clickColHeader(ti, hc.ci)}
                                    oncontextmenu={(e) => onColHeaderContextMenu(e, ti, hc.ci)}
                                >
                                    <span
                                        class="relative flex h-full w-full flex-col items-center justify-center px-1.5 py-1 transition-colors hover:bg-(--theme-modal-text)/5 {hc.enabled ===
                                        0
                                            ? 'opacity-30'
                                            : ''}"
                                    >
                                        <!-- 表头 Buff 名：最多 2 行（`h-8` 32px − `py-1` 8px = 24px = 2 × `leading-3`）。
                                             列宽由 `columnWidthsOf` 按名字长度算好，故这里只需把文字上限钉在「列宽 − 内边距」，
                                             免得 `max-content` 再把列撑宽；超长仍由 `line-clamp` 收尾（完整名字在 `title` 里）。 -->
                                        <span
                                            class="line-clamp-2 w-full break-words text-center text-[10px] font-medium leading-3 text-(--theme-modal-text)/60"
                                            style="max-width: {(layout.widths[colPos] ?? HEAD_COL_MIN_PX) - 12}px;"
                                            title={hc.title}>{buffLeafName(columns[hc.ci]?.name ?? hc.label)}</span
                                        >
                                        {#if hc.paneSource}
                                            <span
                                                class="absolute right-0.5 top-0.5 flex shrink-0 items-center"
                                                style="color: var(--theme-accent-text);"
                                                title={paneSourceTooltip(hc.paneSource)}
                                            >
                                                <Icon icon="mdi:transit-connection-variant" class="size-3" />
                                            </span>
                                        {/if}
                                    </span>
                                </th>
                            {/each}
                        </tr>
                    </thead>
                    <!-- 表体：每行一个伤害条目（行头单击高亮行/右键全选全不选 + 伤害类型编辑），单元格可勾选 -->
                    <tbody>
                        {#each shownRows(table) as row, ri (row.entry.id)}
                            {@const rowHighlighted =
                                row.editable &&
                                highlight?.gi === ti &&
                                highlight.kind === 'row' &&
                                highlight.index === ri}
                            {@const colHighlightActive =
                                row.editable && highlight?.gi === ti && highlight.kind === 'col'}
                            {@const selIds = entryBuffSetIdMap[row.entry.id] ?? EMPTY_IDS}
                            {@const selIdSet = new Set(selIds)}
                            <tr
                                class:spread-rowhl-on={rowHighlighted}
                                class:spread-run-start={row.runStart}
                                class:spread-run-end={row.runEnd}
                            >
                                <td
                                    data-press=""
                                    data-rowhead={ri}
                                    data-sf="card"
                                    data-sf-layer
                                    class="sticky left-0 z-20 select-none border-r border-b border-(--theme-divider-border) px-3 py-1.5 {row.editable
                                        ? 'cursor-pointer'
                                        : 'cursor-default'}"
                                    class:spread-rowhead-muted={!row.editable}
                                    style="--sf-base: var(--theme-modal-bg);"
                                    class:spread-frozen-hl={rowHighlighted}
                                    title={rowHeadTitle(
                                        row.entry.displayName,
                                        selStats.rowCounts.get(row.entry.id) ?? 0,
                                        row.enabledBuffIds.length
                                    )}
                                    onclick={() => row.editable && clickRowHeader(ti, ri)}
                                    oncontextmenu={(e) => row.editable && onRowHeaderContextMenu(e, ti, ri)}
                                >
                                    <div class="flex w-full items-center gap-1.5 py-0.5 text-left">
                                        <span
                                            class="truncate text-(--theme-modal-text)"
                                            style="color: {row.editable
                                                ? `var(--theme-element-${row.entry.damageElement}, #888)`
                                                : 'var(--theme-modal-text)'};">{row.entry.displayName}</span
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
                                        <!-- 去重后渲染：既有工程数据 / 外部导入的伤害类型数组可能带重复项，重复 key 会抛 each_key_duplicate -->
                                        {#each [...new Set(entryDamageTypeMap[row.entry.id] ?? [])] as dt (dt)}
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
                                {#each table.visibleColIdx as ci, colPos (ci)}
                                    {@const cell = row.cells[ci]}
                                    {@const head = table.headerCols[colPos]}
                                    {@const colHighlighted = colHighlightActive && highlight?.index === ci}
                                    {@const on = !!cell && selIdSet.has(cell.buffId)}
                                    {@const cellTitle = !row.editable
                                        ? ''
                                        : !cell?.enabled
                                          ? `本条目吃不到「${head?.title ?? ''}」（受作用域 / 伤害类型 / 属性条件限制，不可勾选）`
                                          : cell.pane && head?.paneSource
                                            ? `${paneSourceTooltip(head.paneSource)}\n${on ? '点击取消勾选' : '点击勾选'}`
                                            : on
                                              ? head?.titleOn
                                              : head?.titleOff}
                                    {@const unmet = !!cell && cell.enabled && !rulesMetOf(columns[ci], row.entry)}
                                    <td
                                        class="w-[108px] min-w-[108px] border-b border-(--theme-divider-border) p-0 text-center {layout
                                            .seps[colPos] ?? ''}"
                                        class:spread-cell-hl={colHighlighted}
                                        data-group={ti}
                                        data-row={ri}
                                        data-col={ci}
                                    >
                                        {#if !row.editable}
                                            <!-- 分段平铺：非选中来源的行，右侧**绝对留白**（不显示图标/勾选，连禁止图标都不给） -->
                                            <span class="block h-7 w-full"></span>
                                        {:else if !cell.enabled}
                                            <!-- 受作用域 / 伤害类型 / 属性条件限制：灰色叉图标（尺寸与打勾 / 空心圆一致），且点不动 -->
                                            <span
                                                class="flex min-h-7 w-full items-center justify-center px-1 py-1"
                                                title={cellTitle}
                                            >
                                                <Icon
                                                    icon="mdi:close"
                                                    class="size-5 shrink-0"
                                                    style="color: var(--theme-modal-text); opacity: 0.25;"
                                                />
                                            </span>
                                        {:else}
                                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                                            <button
                                                onclick={() => toggleCell(row, cell.buffId)}
                                                title={cellTitle}
                                                class="flex min-h-7 w-full cursor-pointer items-center justify-center px-1 py-1 transition-colors hover:bg-(--theme-modal-text)/10"
                                            >
                                                {#if on && !unmet}
                                                    <!-- 已勾选 + 达门槛：加粗打勾（图标不随行列高亮换成 buff 名，名字看表头即可） -->
                                                    <Icon
                                                        icon="mdi:check-bold"
                                                        class="size-5 shrink-0"
                                                        style="color: var(--theme-accent-text);"
                                                    />
                                                {:else if unmet}
                                                    <!-- 未达门槛（Buff 级规则不满足）：已勾选 = 主题色空心圆（放大 1.25 倍），未勾 = 灰色空心圆（保持原尺寸） -->
                                                    <Icon
                                                        icon="mdi:circle-outline"
                                                        class={on ? 'size-5 shrink-0' : 'size-4 shrink-0'}
                                                        style="color: {on
                                                            ? 'var(--theme-accent-text)'
                                                            : 'var(--theme-modal-text)'}; opacity: {on ? 1 : 0.3};"
                                                    />
                                                {:else if cell.pane}
                                                    <!-- 影响源（未勾选）：用连接图标提示这是别的角色面板的改写者 -->
                                                    <Icon
                                                        icon="mdi:transit-connection-variant"
                                                        class="size-4 shrink-0 opacity-30"
                                                    />
                                                {/if}
                                            </button>
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
        data-sf-layer
        class="sticky left-0 top-0 z-(--z-sticky) w-52 min-w-52 border-r border-(--theme-divider-border) px-3 text-left text-[10px] font-black tracking-[0.12em] text-(--theme-modal-text)/50"
        style="--sf-base: var(--theme-modal-bg); --sfu-base: var(--theme-modal-bg);"
        {rowspan}
    ></th>
{/snippet}

<style>
    /* 根容器：高亮用色（供单元格/行头/表头复用，避免逐元素拼内联样式） */
    .spread-root {
        --spread-hl: color-mix(in srgb, var(--theme-accent-bg) 20%, transparent);
    }
    /* 底色交给区域系统（data-sf）：列表=card（表体逐格用 flat）；表头=toolbar 叠 card 底、首列行头=card 毛玻璃；
       此处只放高亮/分隔线等叠加效果 */
    /* 列间分割线：叠层组与邻接列之间用主题色实线，其余用常规分隔线 */
    .spread-sep {
        border-right: 1px solid var(--theme-divider-border);
    }
    .spread-sep-solid {
        border-right: 2px solid color-mix(in srgb, var(--theme-accent-bg) 25%, transparent);
    }
    .spread-sep-dashed {
        border-right: 1px dashed color-mix(in srgb, var(--theme-accent-bg) 55%, transparent);
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
    /* 行间分割线（两种平铺共用）：段首行上方 / 段尾行下方各画一条主题色分割线（整行含吸顶首列） */
    .spread-run-start td {
        border-top: 2px solid color-mix(in srgb, var(--theme-accent-bg) 70%, transparent);
    }
    .spread-run-end td {
        border-bottom: 2px solid color-mix(in srgb, var(--theme-accent-bg) 70%, transparent);
    }
    /* 非选中口径的行：首列灰化（文字/伤害类型一起压暗，元素色也取常规文字色） */
    .spread-rowhead-muted {
        opacity: 0.4;
    }
</style>
