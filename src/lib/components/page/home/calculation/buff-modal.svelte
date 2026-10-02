<script lang="ts">
    /** @desc BUFF 配置弹窗：左侧 Buff 块列表（叠层文件夹/拖拽排序/拖出删除）、右侧块编辑器（作用域/生效条件/乘区数值与引用/追加覆盖）、右栏乘区清单，含速查与导入入口 */
    import {
        getAllBuffSets,
        createBuffSet,
        takePendingFocusBuffSetId,
        deleteBuffSet,
        duplicateBuffSet,
        renameBuffSet,
        addZoneToBuffSet,
        removeZoneAt,
        setZoneValueAt,
        setZoneOverrideAt,
        setZoneRefAt,
        setZoneConditionAt,
        setBuffSetScope,
        setBuffSetCondition,
        setBuffSetConditionRef,
        getGlobalBuffSetIds,
        toggleBuffSetStarred,
        setBuffSetGlobal,
        setBuffSetsGlobal
    } from '$lib/calc/calculation.store.svelte'
    import { ZONE_REF_DEFS, LAYERED_BUFF_PATTERN } from '$lib/calc/calculation.consts'
    import type { GroupedBuffSetItem } from '$lib/calc/calculation.consts'
    import { buildBuffTree } from '$lib/calc/buff-tree'
    import type { CharSlot } from '$lib/types/project'
    import type { ZoneRef, BuffSet, BuffCondition } from '$lib/calc/calculation.types'
    import { getCharIconMap, elementColor, getLocked } from '$lib/calc/timeline.store.svelte'
    import { getWeaponIcons } from '$lib/api/data-cache'
    import { addToast } from '$lib/data/toast.svelte'
    import Icon from '@iconify/svelte'
    import QuickLookup from '$lib/components/page/home/quick-lookup/quick-lookup.svelte'
    import BuffImportModal from './buff-import-modal.svelte'
    import ContextMenu from '$lib/components/layout/context-menu.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import ConfirmDialog from '$lib/components/ui/confirm-dialog.svelte'
    import BuffModalList from './buff-modal-list.svelte'
    import BuffModalEditor from './buff-modal-editor.svelte'
    import BuffModalZoneBar from './buff-modal-zone-bar.svelte'
    import BuffModalRefModal from './buff-modal-ref-modal.svelte'
    import BuffModalFolderRenameModal from './buff-modal-folder-rename-modal.svelte'
    import BuffModalCopyModal from './buff-modal-copy-modal.svelte'
    import { onMount } from 'svelte'
    import { registerPanel, unregisterPanel } from '$lib/ai/panels.svelte'
    import { registerDragCancel } from '$lib/utils/drag-guard'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'
    import type { BuffDerived, BuffTree } from './buff-modal.types'
    import type { DragState, RefModalState } from './buff-modal.utils'
    import {
        ZONE_BAR_WIDTH,
        conditionSummaryOf,
        conditionWithRefCharIdx,
        copyNameOptions,
        createRefModalState,
        folderMembersOf,
        nextConditionForChain,
        nextConditionForRefinement,
        pctOfFraction,
        simplifyPct,
        toggledSet
    } from './buff-modal.utils'
    import { createMultiSelect } from './buff-modal-multiselect.svelte'
    import { createSidebarResizer } from './buff-modal-resizer.svelte'
    import { createBuffDrag } from './buff-modal-drag.svelte'

    // ── 自有 props（与 `buff-modal.types.ts` 的 `BuffModalProps` 同形；此处显式展开以便闸门 ① 识别）──
    interface Props extends ComponentsProps {
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        onclose: () => void
    }

    let { open, team, onclose, class: className, style: styleProp }: Props = $props()

    let showLookup = $state(false)
    let showRefLookup = $state(false)
    let showImport = $state(false)

    /** @desc 挂载时注册 AI 面板「导入 Buff 集」与拖拽禁区回调（进入 AI 悬浮窗时取消拖拽） */
    onMount(() => {
        registerPanel(
            'buff-import',
            '导入 Buff 集',
            () => showImport,
            (v) => (showImport = v)
        )
        unregisterDragCancel = registerDragCancel(cancelBuffDrag)
        return () => {
            unregisterPanel('buff-import')
            unregisterDragCancel?.()
        }
    })

    /**
     * @desc 拖拽状态（列表是派生的，所以只能改同一父容器内的行顺序）：
     * `unitIds` 是本次搬运的 Buff（条目=单个 / 数字目录=整组成员），`parentKey` 是落点所在的父容器，
     * `dropIdx` 是父容器行序列（去掉被搬运行）里的插入位。状态本身在 `buff-modal.utils.ts` 里定义，
     * 列表组件经 `$bindable` 双向绑定（父组件在拖拽取消 / 退出多选 / 弹窗重置时都要清它）。
     */
    let dragState = $state<DragState | null>(null)
    let collapsedFolders = $state(new Set<string>())
    let savedCollapsedState: Set<string> | null = null
    let unregisterDragCancel: (() => void) | null = null
    let showDeleteFolderConfirm = $state(false)
    /** @desc 将被整目录删除的 Buff id（拖出列表松手后确认删除；按数据算，折叠状态也能删） */
    let deleteFolderMemberIds = $state<string[]>([])
    let deleteFolderCount = $derived(deleteFolderMemberIds.length)
    let showCopyOptions = $state(false)
    let copyOptions = $state<string[]>([])

    /** @desc 文件夹右键菜单：菜单位置/开关/当前目标 folder（普通与全局文件夹共用） */
    let folderMenuOpen = $state(false)
    let folderMenuX = $state(0)
    let folderMenuY = $state(0)
    let folderMenuTarget = $state<GroupedBuffSetItem | null>(null)
    /** @desc 单个 buff 右键菜单：菜单位置/开关/当前目标 id（多选状态下为多选菜单） */
    let itemMenuOpen = $state(false)
    let itemMenuX = $state(0)
    let itemMenuY = $state(0)
    let itemMenuTargetId = $state<string | null>(null)
    /** @desc 文件夹批量重命名弹窗 */
    let showFolderRename = $state(false)
    let folderRenameTarget = $state<GroupedBuffSetItem | null>(null)

    /** @desc 多选模式：勾选集合 / 全选 / 批量删除·并入全局·排序，状态机在 `./buff-modal-multiselect.svelte` */
    let multiSelect = $state(false)
    /** @desc 多选删除确认 */
    let showMultiDeleteConfirm = $state(false)

    /** @desc ── 左侧栏宽度拖拽调节（与主页 sidebar 拖动条一致：三态高亮 + rAF 节流） ── */
    /** @desc ── 左侧栏宽度拖拽调节：状态机在 `./buff-modal-resizer.svelte` ── */
    const resizer = createSidebarResizer()
    const leftWidth = $derived(resizer.width)
    const resizingSidebar = $derived(resizer.resizing)
    const sidebarDividerHover = $derived(resizer.dividerHover)
    const startSidebarResize = resizer.start

    let selectedBuffSetId = $state<string | null>(null)

    /**
     * @desc 多选模式状态机（勾选 / 全选 / 批量删除·并入全局·排序）。
     * 放在 `selectedBuffSetId` 之后：构造时传入的 getter 闭包会读它，虽由闭包延迟求值（无 TDZ 风险），
     * 但按依赖顺序书写更易读。`onExit` 的互斥清理原先内联在 `toggleMultiSelect()` 里。
     */
    const multi = createMultiSelect({
        isActive: () => multiSelect,
        setActive: (v) => (multiSelect = v),
        getSelectedId: () => selectedBuffSetId,
        setSelectedId: (id) => (selectedBuffSetId = id),
        setConfirmDelete: (v) => (showMultiDeleteConfirm = v),
        onExit: () => {
            folderMenuOpen = false
            folderMenuTarget = null
            itemMenuOpen = false
            itemMenuTargetId = null
            dragState = null
            collapsedFolders = savedCollapsedState ?? collapsedFolders
            savedCollapsedState = null
        }
    })

    /**
     * @desc 从速查右键菜单「以此为名创建BUFF」进来时：自动选中并滚动到刚新建的那条
     * （id 由 createBuffSet 返回后写入 pending，这里消费一次）
     */
    $effect(() => {
        if (!open) return
        const id = takePendingFocusBuffSetId()
        if (!id) return
        selectedBuffSetId = id
        requestAnimationFrame(() => {
            document
                .querySelector<HTMLElement>(`[data-buffset-id="${id}"]`)
                ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        })
    })

    /** @desc 名称编辑输入框（在编辑器组件内），父组件在「新建 / 右键重命名」后调用它聚焦 */
    let renameInputEl = $state<HTMLInputElement | null>(null)
    /** @desc 新建 / 右键重命名后，等 DOM 更新再聚焦并全选名称（原来散在 3 处，收敛为一处） */
    const focusRenameInput = () => {
        requestAnimationFrame(() => {
            renameInputEl?.focus()
            renameInputEl?.select()
        })
    }

    /**
     * @desc ── 引用配置弹窗状态 ──
     * 草稿 12 个字段 + 「配置哪个乘区 / 下拉开关 / 引用角色」收进一个对象（原先是 13 个平行 `$state`），
     * 组件只读写字段；打开时由 `openRefModal()` 一次性写入，避免「先改字段、再置 open」的顺序被拆散。
     */
    interface RefModalUi extends RefModalState {}
    let refModal = $state<RefModalUi>(createRefModalState('base_atk'))

    let buffSets = $derived(getAllBuffSets())
    let globalBuffSetIds = $derived(getGlobalBuffSetIds())
    let charIconMap = $derived(getCharIconMap())

    /** @desc 当前选中的 Buff 块、其作用域对应角色勾选态、是否效应专属 */
    let selectedBuffSet = $derived(buffSets.find((s) => s.id === selectedBuffSetId) ?? null)

    /** @desc 当前编辑乘区的 zoneId（由下标推出，供引用弹窗过滤目标属性；乘区可重复添加，故用下标定位） */
    let refZoneId = $derived(
        refModal.zoneIndex >= 0 ? (selectedBuffSet?.zones?.[refModal.zoneIndex]?.zoneId ?? '') : ''
    )

    /**
     * @desc 左侧列表的三级归类树：
     * 一级=全局 Buff；二级=角色名X链 / 角色名的X阶（依据 Buff 的链/阶硬性条件，无条件的留在最外层）；
     * 三级=名字里「前缀+数字+后缀」相同的 ≥2 条自动归档并按键数字升序。
     * 目录是派生的，因此拖拽只改变同一父容器内的顺序（见 buckets）。
     */
    let buffTree = $derived(buildBuffTree(buffSets, globalBuffSetIds, team))
    let listTree = $derived<BuffTree>({ nodes: buffTree.nodes, folderKeys: buffTree.folderKeys })

    let scopeChars = $derived.by(() => {
        if (!selectedBuffSet || selectedBuffSet.scope === 'all') return [true, true, true]
        const s = selectedBuffSet.scope
        return team.map((_, i) => s.includes(i))
    })

    let isNonCharBuff = $derived(
        !!selectedBuffSet &&
            selectedBuffSet.scope !== 'all' &&
            Array.isArray(selectedBuffSet.scope) &&
            selectedBuffSet.scope.length === 0
    )

    /** @desc 新建 Buff 块：先创建（默认名），选中后自动聚焦名称编辑框供用户填写 */
    function handleCreateBuffSet() {
        const newId = createBuffSet('未命名BUFF块')
        if (!newId) return
        selectedBuffSetId = newId
        focusRenameInput()
    }

    /** @desc 删除当前 Buff 块 */
    function handleDeleteBuffSet() {
        if (!selectedBuffSetId) return
        deleteBuffSet(selectedBuffSetId)
        selectedBuffSetId = null
    }

    /** @desc 并入/移出全局（并入成功提示作用域） */
    function handleToggleGlobal() {
        if (!selectedBuffSetId || !selectedBuffSet) return
        const isGlobal = globalBuffSetIds.includes(selectedBuffSetId)
        const ok = setBuffSetGlobal(selectedBuffSetId, !isGlobal)
        if (!ok) return
        if (!isGlobal) {
            addToast(selectedBuffSet.scope === 'all' ? '已并入全局，全队生效' : '已并入全局', 'success')
        } else {
            addToast('已移出全局', 'info')
        }
    }

    /** @desc 复制 Buff：在叠层文件夹内→层数+1 命名；名字带数字→列出递增命名选项；否则「名字 复制」 */
    function handleCopyBuffSet() {
        if (!selectedBuffSetId || !selectedBuffSet) return
        const folder = listTree.nodes.find(
            (item) => item.type === 'folder' && folderMembers(item).some((c) => c.id === selectedBuffSetId)
        )
        if (folder) {
            const nums = folderMembers(folder)
                .map((c) => {
                    const m = c.name.match(LAYERED_BUFF_PATTERN)
                    return m ? parseInt(m[2]) : 0
                })
                .filter((n) => !isNaN(n))
            const max = nums.length > 0 ? Math.max(...nums) : 0
            const copyName = (folder.prefixText ?? '') + (max + 1) + (folder.suffixText ?? '')
            const newId = duplicateBuffSet(selectedBuffSetId, copyName)
            if (newId) selectedBuffSetId = newId
            return
        }
        const options = copyNameOptions(selectedBuffSet.name)
        if (options.length === 1) {
            const newId = duplicateBuffSet(selectedBuffSetId)
            if (newId) selectedBuffSetId = newId
            return
        }
        copyOptions = options
        showCopyOptions = true
    }

    /** @desc 确认复制（选中新块） */
    function confirmCopyBuff(name: string) {
        if (!selectedBuffSetId) return
        const newId = duplicateBuffSet(selectedBuffSetId, name)
        if (newId) selectedBuffSetId = newId
        showCopyOptions = false
    }

    /** @desc 重命名选中块（空名兜底；编辑器组件内 Enter/失焦触发） */
    function handleRename(value: string) {
        if (!selectedBuffSetId) return
        renameBuffSet(selectedBuffSetId, value)
    }

    /** @desc 切换某角色的作用域；全部选中时归为 all */
    function handleToggleChar(idx: number) {
        if (!selectedBuffSetId || !selectedBuffSet) return
        const current: number[] = selectedBuffSet.scope === 'all' ? [0, 1, 2] : (selectedBuffSet.scope as number[])
        const next = current.includes(idx) ? current.filter((i) => i !== idx) : [...current, idx].sort()
        setBuffSetScope(selectedBuffSetId, next.length === 3 ? 'all' : next)
    }

    /** @desc 切换「效应专属」作用域（空数组=仅效应） */
    function handleToggleNonChar() {
        if (!selectedBuffSetId || !selectedBuffSet) return
        setBuffSetScope(selectedBuffSetId, isNonCharBuff ? 'all' : [])
    }

    /** @desc 是否为默认全局 buff（global- 前缀，锁定不可编辑条件） */
    function isDefaultGlobalBuff(): boolean {
        return !!selectedBuffSet && selectedBuffSet.id.startsWith('global-')
    }

    let condPanelOpen = $state(false)

    /** @desc 当前 Buff 的乘区条目列表（同一乘区可多条，各自配数值/引用/覆盖/条件） */
    const selectedZones = $derived(selectedBuffSet?.zones ?? [])

    /**
     * @desc 覆盖优先于一切：同一 Buff 内某乘区存在**生效的覆盖条目**（非引用且值 ≠ 0）时，
     * 该乘区的其它非覆盖条目会被覆盖，界面上置灰提示（不参与计算）。
     */
    const overrideZoneIds = $derived(
        new Set(selectedZones.filter((z) => z.override && !z.ref && z.value !== 0).map((z) => z.zoneId as string))
    )

    /**
     * @desc 跨 Buff 的同乘区覆盖：覆盖唯一是指「同一 Buff 内唯一」，跨 Buff 都允许存在，
     * 引擎按 Buff 进入计算的顺序判定 —— 后进入者最终生效。这里给出提示用的信息。
     */
    const externalOverrides = $derived.by(() => {
        const out: Record<string, { name: string; later: boolean }[]> = {}
        const list = getAllBuffSets()
        const selfIdx = list.findIndex((b) => b.id === selectedBuffSetId)
        for (let i = 0; i < list.length; i++) {
            const bs = list[i]
            if (bs.id === selectedBuffSetId) continue
            for (const z of bs.zones ?? []) {
                if (!z.override || z.ref || z.value === 0) continue
                const key = z.zoneId as string
                if (!out[key]) out[key] = []
                out[key].push({ name: bs.name, later: selfIdx < 0 ? true : i > selfIdx })
            }
        }
        return out
    })

    /** @desc 乘区级条件的行内展开目标（按下标定位，同一乘区可添加多次） */
    let expandedZoneIndex = $state<number | null>(null)
    const toggleZoneCondition = (index: number) => {
        expandedZoneIndex = expandedZoneIndex === index ? null : index
    }
    const handleZoneConditionChange = (index: number, next: BuffCondition | null) => {
        if (!selectedBuffSetId) return
        setZoneConditionAt(selectedBuffSetId, index, next)
    }
    // 切换 Buff 时收起行内条件面板
    $effect(() => {
        selectedBuffSetId
        expandedZoneIndex = null
    })

    /** @desc 展开/收起生效条件面板 */
    function toggleCondPanel() {
        if (!selectedBuffSetId || !selectedBuffSet) return
        condPanelOpen = !condPanelOpen
    }

    /** @desc 生效条件摘要文案（仅链/阶：它们是整个 BUFF 的硬性条件；属性/类型挂在乘区上） */
    const conditionSummary = $derived(conditionSummaryOf(selectedBuffSet, team))

    /** @desc 参考角色必须恰好一个：设置了链/阶但未选参考角色时，默认参考第一位 */
    function ensureConditionRef() {
        if (!selectedBuffSetId || !selectedBuffSet) return
        if (selectedBuffSet.conditionRefCharIdx === undefined) setBuffSetConditionRef(selectedBuffSetId, 0)
    }

    /** @desc 当前参考角色槽位 */
    const condRefIdx = $derived(selectedBuffSet?.conditionRefCharIdx ?? 0)
    /** @desc 当前链门槛（chains 数组形式；兼容旧 chain 字段） */
    const currentChain = $derived(selectedBuffSet?.condition?.chains?.[0]?.min ?? selectedBuffSet?.condition?.chain)
    /** @desc 当前阶门槛（refinements 数组形式；兼容旧 refinement 字段） */
    const currentRefine = $derived(
        selectedBuffSet?.condition?.refinements?.[0]?.min ?? selectedBuffSet?.condition?.refinement
    )

    /**
     * @desc 设置链门槛（再次点击取消）。
     * 链条件与阶条件**只能生效其中一个**：设置链会清空全部阶条件。
     */
    function setBuffChain(min: number) {
        if (!selectedBuffSetId || !selectedBuffSet) return
        if (isDefaultGlobalBuff()) return
        const { next, clearing } = nextConditionForChain(selectedBuffSet.condition ?? {}, min, currentChain, condRefIdx)
        setBuffSetCondition(selectedBuffSetId, next)
        if (!clearing) ensureConditionRef()
    }

    /** @desc 设置阶门槛（再次点击取消）；设置阶会清空全部链条件 */
    function setBuffRefinement(min: number) {
        if (!selectedBuffSetId || !selectedBuffSet) return
        if (isDefaultGlobalBuff()) return
        const { next, clearing } = nextConditionForRefinement(
            selectedBuffSet.condition ?? {},
            min,
            currentRefine,
            condRefIdx
        )
        setBuffSetCondition(selectedBuffSetId, next)
        if (!clearing) ensureConditionRef()
    }

    /** @desc 设置参考角色槽位（默认全局 buff 拒绝）；链/阶门槛同步迁移到新参考角色 */
    function setConditionRef(i: number) {
        if (!selectedBuffSetId || !selectedBuffSet) return
        if (isDefaultGlobalBuff()) {
            addToast('默认全局buff无法设置链/阶条件', 'info')
            return
        }
        setBuffSetConditionRef(selectedBuffSetId, i)
        const cond = selectedBuffSet.condition
        if (!cond) return
        setBuffSetCondition(selectedBuffSetId, conditionWithRefCharIdx(cond, i))
    }

    /**
     * @desc 打开引用配置弹窗（按**下标**定位乘区，同一乘区可添加多次）：
     * 有现成引用则回填各字段，否则按当前乘区初始化（同目标时自动换一个可引用属性）。
     */
    function openRefModal(zoneIndex: number) {
        const zone = selectedZones[zoneIndex]
        if (!zone) return
        refModal.zoneIndex = zoneIndex
        refModal.zoneMenuOpen = false
        if (zone.ref) {
            refModal.characterIdx = zone.ref.characterIdx
            refModal.targetZoneId = zone.ref.zoneId
            refModal.threshold = zone.ref.threshold
            refModal.lower = zone.ref.lower
            refModal.upper = zone.ref.upper
            const s = simplifyPct(zone.ref.pct)
            refModal.divisor = zone.ref.divisor ?? s.divisor
            refModal.multiplier = zone.ref.multiplier ?? s.multiplier
            refModal.isDiscrete = zone.ref.discrete ?? false
            refModal.hasThreshold = true
            refModal.hasLower = zone.ref.lower !== undefined
            refModal.hasUpper = zone.ref.upper !== undefined
        } else {
            refModal.characterIdx = 0
            refModal.targetZoneId = zone.zoneId
            refModal.threshold = 0
            refModal.lower = undefined
            refModal.upper = undefined
            refModal.divisor = 10
            refModal.multiplier = 0
            refModal.isDiscrete = false
            refModal.hasThreshold = true
            refModal.hasLower = false
            refModal.hasUpper = false
        }
        if (refModal.targetZoneId === zone.zoneId) {
            const fallback = ZONE_REF_DEFS.find((d) => d.id !== zone.zoneId)
            refModal.targetZoneId = fallback?.id ?? ''
        }
    }

    /** @desc 确认引用：由 除数/乘数 反算百分比并写入 */
    function handleConfirmRef() {
        if (!selectedBuffSetId) return
        const pct = pctOfFraction(refModal.divisor, refModal.multiplier)
        const ref: ZoneRef = {
            characterIdx: refModal.characterIdx,
            zoneId: refModal.targetZoneId as any,
            threshold: refModal.hasThreshold ? refModal.threshold : 0,
            pct,
            lower:
                refModal.hasLower && refModal.lower !== undefined && !isNaN(refModal.lower)
                    ? refModal.lower
                    : undefined,
            upper:
                refModal.hasUpper && refModal.upper !== undefined && !isNaN(refModal.upper)
                    ? refModal.upper
                    : undefined,
            discrete: refModal.isDiscrete,
            divisor: refModal.divisor,
            multiplier: refModal.multiplier
        }
        setZoneRefAt(selectedBuffSetId, refModal.zoneIndex, ref)
        refModal.zoneIndex = -1
    }

    /** @desc 清除引用 */
    function handleClearRef() {
        if (!selectedBuffSetId) return
        setZoneRefAt(selectedBuffSetId, refModal.zoneIndex, null)
        refModal.zoneIndex = -1
    }

    /** @desc 折叠/展开叠层文件夹 */
    function toggleFolder(prefix: string) {
        collapsedFolders = toggledSet(collapsedFolders, prefix)
    }

    /** @desc ── 拖拽子系统：起手/落点/松手/拖出删除 全在 `./buff-modal-drag.svelte` ──
     * 跨边界状态（dragState / collapsedFolders / 删除确认）仍由本组件持有，经 getter/setter 注入。 */
    const drag = createBuffDrag({
        getState: () => dragState,
        setState: (s) => (dragState = s),
        getCollapsed: () => collapsedFolders,
        setCollapsed: (s) => (collapsedFolders = s),
        getFolderKeys: () => buffTree.folderKeys,
        setDeleteFolderIds: (ids) => (deleteFolderMemberIds = ids),
        getSelectedId: () => selectedBuffSetId,
        setSelectedId: (id) => (selectedBuffSetId = id),
        setConfirmDeleteFolder: (v) => (showDeleteFolderConfirm = v)
    })
    const listContext = drag.listContext
    const cancelBuffDrag = drag.cancel
    const startDrag = drag.start
    const onDragMove = drag.move
    const onDragEnd = drag.end
    const confirmDeleteFolder = () => drag.confirmDeleteFolder(deleteFolderMemberIds)

    /** @desc 打开文件夹右键菜单（点击⋯按钮或右键文件夹头均走这里） */
    function openFolderMenu(e: MouseEvent, folder: GroupedBuffSetItem) {
        e.preventDefault()
        e.stopPropagation()
        folderMenuTarget = folder
        folderMenuX = e.clientX
        folderMenuY = e.clientY
        folderMenuOpen = true
    }

    /**
     * @desc 目录下的全部成员 Buff（数字目录直接取 children；
     * 「全局 Buff」目录还要并入二级子目录的成员，否则批量操作会漏掉它们）。
     */
    const folderMembers = folderMembersOf

    /** @desc 目录整体并入 / 移出全局（所有子 Buff 一次性搬迁） */
    function moveFolderGlobal(folder: GroupedBuffSetItem, global: boolean) {
        const ids = folderMembers(folder).map((c) => c.id)
        if (ids.length === 0) return
        setBuffSetsGlobal(ids, global)
        const n = ids.length
        if (global) addToast(`已将「${folder.name}」的 ${n} 条 BUFF 并入全局`, 'success')
        else addToast(`已将「${folder.name}」的 ${n} 条 BUFF 移出全局`, 'info')
    }

    /** @desc 文件夹右键菜单项：重命名 / 并入或移出全局 */
    let folderMenuItems = $derived.by(() => {
        const folder = folderMenuTarget
        if (!folder) return []
        const hasGlobal = folderMembers(folder).some((c) => globalBuffSetIds.includes(c.id))
        return [
            { label: '批量重命名', icon: 'mdi:rename-box', action: () => openFolderRename(folder) },
            hasGlobal
                ? {
                      label: '整体移出全局',
                      icon: 'mdi:minus-circle-outline',
                      action: () => moveFolderGlobal(folder, false)
                  }
                : { label: '整体并入全局', icon: 'mdi:crown-outline', action: () => moveFolderGlobal(folder, true) }
        ]
    })

    /** @desc 打开文件夹批量重命名弹窗：按「新前缀 + 序号 + 新后缀」重新编号全部子 Buff */
    function openFolderRename(folder: GroupedBuffSetItem) {
        folderRenameTarget = folder
        showFolderRename = true
    }

    /** @desc 打开单个 buff 右键菜单（普通/全局/多选状态统一入口） */
    function openItemMenu(e: MouseEvent, id: string) {
        e.preventDefault()
        e.stopPropagation()
        // 多选状态：右键目标不在选中集合且可勾选时，将选中集合重置为该目标（菜单针对当前集合）
        if (multiSelect && !isMultiSelectDisabled(id) && !multi.selectedIds.has(id)) {
            multi.selectedIds = new Set([id])
        }
        itemMenuTargetId = id
        itemMenuX = e.clientX
        itemMenuY = e.clientY
        itemMenuOpen = true
    }

    /** @desc 单个 buff 右键菜单项：多选状态 → 批量操作；否则 → 重命名/复制/全局/删除 */
    let itemMenuItems = $derived.by(() => {
        const id = itemMenuTargetId
        if (!id) return []
        if (multiSelect) {
            // 多选状态：对整个选中集合操作（右键任意条目即打开）
            const items: { label: string; action: () => void; icon: string; disabled?: boolean }[] = []
            const count = multi.selectedIds.size
            items.push({
                label: `并入全局${count > 0 ? `（${count} 项）` : ''}`,
                icon: 'mdi:crown-outline',
                disabled: !multiSelectionAllNonGlobal(),
                action: () => multiSetGlobal(true)
            })
            items.push({
                label: `移出全局${count > 0 ? `（${count} 项）` : ''}`,
                icon: 'mdi:minus-circle-outline',
                disabled: !multiSelectionAllGlobal(),
                action: () => multiSetGlobal(false)
            })
            items.push({
                label: `删除${count > 0 ? `（${count} 项）` : ''}`,
                icon: 'mdi:delete-outline',
                action: () => requestMultiDelete()
            })
            return items
        }
        const bs = buffSets.find((b) => b.id === id)
        if (!bs) return []
        const isGlobal = globalBuffSetIds.includes(id)
        const isDefaultGlobal = id.startsWith('global-')
        // 内置默认全局块（global- 前缀）：仅可查看，全部操作禁用
        const items: { label: string; action: () => void; icon: string; disabled?: boolean }[] = []
        if (!isGlobal) {
            items.push({
                label: '重命名',
                icon: 'mdi:rename-box',
                action: () => {
                    selectedBuffSetId = id
                    focusRenameInput()
                }
            })
            items.push({ label: '复制', icon: 'mdi:content-copy', action: () => handleCopyFor(id) })
        }
        items.push(
            isGlobal
                ? {
                      label: '移出全局',
                      icon: 'mdi:minus-circle-outline',
                      disabled: isDefaultGlobal,
                      action: () => handleToggleGlobalFor(id)
                  }
                : {
                      label: '并入全局',
                      icon: 'mdi:crown-outline',
                      action: () => handleToggleGlobalFor(id)
                  }
        )
        items.push({
            label: '删除',
            icon: 'mdi:delete-outline',
            disabled: isGlobal,
            action: () => handleDeleteFor(id)
        })
        return items
    })

    /** @desc 右键菜单复制：选中目标后走原复制逻辑（含叠层/数字递增命名） */
    function handleCopyFor(id: string) {
        selectedBuffSetId = id
        handleCopyBuffSet()
    }

    /** @desc 右键菜单并入/移出全局：选中目标后走原逻辑 */
    function handleToggleGlobalFor(id: string) {
        selectedBuffSetId = id
        handleToggleGlobal()
    }

    /** @desc 右键菜单删除：选中目标后走原删除逻辑 */
    function handleDeleteFor(id: string) {
        selectedBuffSetId = id
        handleDeleteBuffSet()
    }

    /** @desc 确认文件夹批量重命名：子 Buff 依次命名为 新前缀+1..N+新后缀 */
    function confirmFolderRename(prefix: string, suffix: string) {
        const folder = folderRenameTarget
        if (!folder) return
        const members = folderMembers(folder)
        if (members.length === 0) return
        const trimmedPrefix = prefix.trim()
        const trimmedSuffix = suffix.trim()
        if (!trimmedPrefix && !trimmedSuffix) {
            addToast('前缀与后缀不能同时为空', 'error')
            return
        }
        members.forEach((child, i) => {
            renameBuffSet(child.id, `${trimmedPrefix}${i + 1}${trimmedSuffix}`)
        })
        addToast(`已批量重命名 ${members.length} 条 BUFF`, 'success')
        showFolderRename = false
        folderRenameTarget = null
    }

    // ── 多选模式的全部行为已抽到 `./buff-modal-multiselect.svelte`；此处只做模板可读的薄别名 ──
    const toggleMultiSelect = multi.toggle
    const isMultiSelectDisabled = multi.isDisabled
    const toggleMultiSelectId = multi.toggleId
    const toggleMultiSelectFolder = multi.toggleGroup
    const isAllMultiSelected = multi.isAllSelected
    const toggleSelectAll = multi.toggleAll
    const multiSelectionAllNonGlobal = multi.allNonGlobal
    const multiSelectionAllGlobal = multi.allGlobal
    const confirmMultiDelete = multi.confirmDelete
    const requestMultiDelete = multi.requestDelete
    const sortableCount = multi.sortableCount
    const sortMultiSelected = multi.sortSelected
    const multiSetGlobal = multi.setGlobal

    let teamNames = $derived(team.map((s) => s.character ?? '?'))

    /** @desc 队伍槽位角色图标（二级「角色名的武器名」目录用） */
    const teamIconOf = (idx: number): string | undefined => {
        const name = team[idx]?.character
        return name ? charIconMap[name] : undefined
    }

    /** @desc 队伍槽位当前装配武器的图标（二级「角色名的武器名」目录用） */
    const weaponIconOf = (idx: number | undefined): string | undefined => {
        if (idx === undefined) return undefined
        const weapon = team[idx]?.weapon
        return weapon ? weaponIcons[weapon] : undefined
    }

    /** @desc 注入列表组件的派生查询（同一份函数引用，避免子组件各算一遍） */
    const listDerived: BuffDerived = {
        isGlobalBuff: (id) => globalBuffSetIds.includes(id),
        teamIconOf,
        weaponIconOf,
        elementColor
    }

    /** @desc 多选工具栏的可用性（父组件按同一集合算一次，列表只渲染） */
    const selectionState = $derived({
        allSelected: isAllMultiSelected(),
        sortableCount: sortableCount(),
        allNonGlobal: multiSelectionAllNonGlobal(),
        allGlobal: multiSelectionAllGlobal()
    })

    /** @desc 武器图标表（按需加载，失败静默；角色详情/队伍配置共用同一份数据） */
    let weaponIcons = $state<Record<string, string>>({})
    $effect(() => {
        void getWeaponIcons().then((map) => (weaponIcons = map))
    })
</script>

<!-- @desc BUFF 配置弹窗根容器：共享弹窗外壳 + 内容（标题栏入口/左侧列表/右侧编辑器/底部保存） -->
<Modal {open} {onclose} noScroll class={mergeClass(['h-full w-[1180px]', className])} style={styleProp}>
    {#snippet title()}
        <Icon icon="mdi:widgets" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>BUFF 配置</span>
        <!-- @desc 标题栏右侧：导入Buff集/速查入口 -->
        <div class="ml-auto mr-4 flex items-center gap-1">
            <button
                onclick={() => (showImport = true)}
                class="flex items-center gap-1 rounded-none px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-modal-text)/5"
            >
                <Icon icon="mdi:import" class="size-3.5" />
                导入Buff集
            </button>
            <button
                onclick={() => (showLookup = true)}
                class="flex items-center gap-1 rounded-none px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-modal-text)/5"
            >
                <Icon icon="mdi:magnify" class="size-3.5" />
                速查
            </button>
        </div>
    {/snippet}

    <div class="flex flex-1 overflow-hidden">
        <BuffModalList
            bind:selectedBuffSetId
            bind:collapsedFolders
            bind:dragState
            tree={listTree}
            buffCount={buffSets.length}
            {leftWidth}
            {team}
            {charIconMap}
            derivedQueries={listDerived}
            context={listContext}
            {multiSelect}
            multiSelectedIds={multi.selectedIds}
            {resizingSidebar}
            {sidebarDividerHover}
            selection={selectionState}
            onselect={(id) => (selectedBuffSetId = id)}
            ontogglemultiid={toggleMultiSelectId}
            ontogglemultifolder={toggleMultiSelectFolder}
            ontogglefolder={toggleFolder}
            onfoldermenu={openFolderMenu}
            onitemmenu={openItemMenu}
            onstartdrag={startDrag}
            ondragmove={onDragMove}
            ondragend={onDragEnd}
            ondragcancel={cancelBuffDrag}
            onstartresize={startSidebarResize}
            onhoverdivider={(hover) => (resizer.dividerHover = hover)}
            onToggleMultiSelect={toggleMultiSelect}
            onselectall={toggleSelectAll}
            onsortselected={sortMultiSelected}
            onmultiglobal={multiSetGlobal}
            onrequestmultidelete={requestMultiDelete}
            oncreatebuff={handleCreateBuffSet}
        />

        <!-- @desc 右列：上（块编辑器 + 乘区清单）下（保存并关闭），sidebar 占满整高 -->
        <div class="flex-1 flex flex-col overflow-hidden">
            <div class="flex flex-1 overflow-hidden">
                {#if selectedBuffSet}
                    <BuffModalEditor
                        bind:condPanelOpen
                        bind:expandedZoneIndex
                        bind:renameInputEl
                        buff={selectedBuffSet}
                        {team}
                        {teamNames}
                        {charIconMap}
                        isGlobal={globalBuffSetIds.includes(selectedBuffSet.id)}
                        isDefaultGlobal={selectedBuffSet.id.startsWith('global-')}
                        {scopeChars}
                        {isNonCharBuff}
                        {conditionSummary}
                        {currentChain}
                        {currentRefine}
                        {condRefIdx}
                        zones={selectedZones}
                        {overrideZoneIds}
                        {externalOverrides}
                        ontogglestar={() => toggleBuffSetStarred(selectedBuffSet.id)}
                        onrename={handleRename}
                        oncopy={handleCopyBuffSet}
                        ontoggleglobal={handleToggleGlobal}
                        ondelete={handleDeleteBuffSet}
                        ontogglechar={handleToggleChar}
                        ontogglenonchar={handleToggleNonChar}
                        ontogglecond={toggleCondPanel}
                        onsetref={setConditionRef}
                        onsetchain={setBuffChain}
                        onsetrefine={setBuffRefinement}
                        onsetzonevalue={(index, value) => setZoneValueAt(selectedBuffSet.id, index, value)}
                        onoverride={(index, override) => setZoneOverrideAt(selectedBuffSet.id, index, override)}
                        onopenref={openRefModal}
                        onremovezone={(index) => removeZoneAt(selectedBuffSet.id, index)}
                        ontogglezonecond={toggleZoneCondition}
                        onzonecondchange={handleZoneConditionChange}
                    />
                    <!-- @desc 右栏乘区清单：点击即**添加**一个乘区条目（同一乘区可添加多次，各自独立配置）；宽度固定 -->
                    <BuffModalZoneBar
                        zones={selectedZones}
                        onadd={(zoneId) => addZoneToBuffSet(selectedBuffSet.id, zoneId)}
                    />
                {:else}
                    <div class="flex-1 flex items-center justify-center text-xs text-(--theme-modal-text)/40">
                        选择一个 BUFF 块进行编辑
                    </div>
                {/if}
            </div>
            <!-- @desc 右列底部：保存并关闭按钮 -->
            <div
                class="flex items-center justify-end gap-2 border-t px-5 py-3 shrink-0"
                style="border-top: 1px solid var(--theme-divider-border);"
            >
                <button
                    onclick={onclose}
                    class="inline-flex items-center gap-1.5 rounded-none px-4 py-1.5 text-sm font-medium transition-all hover:brightness-125"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                >
                    <Icon icon="mdi:check" class="size-4" />
                    保存并关闭
                </button>
            </div>
        </div>
    </div>
</Modal>

<!-- @desc 引用配置弹窗：选择引用角色/属性、阈值与换算规则（线性/离散、除乘）、上下限 clamp -->
<BuffModalRefModal
    bind:ui={refModal}
    open={refModal.zoneIndex >= 0}
    zoneId={refZoneId}
    {team}
    {charIconMap}
    onclose={() => (refModal.zoneIndex = -1)}
    onconfirm={handleConfirmRef}
    onclear={handleClearRef}
    onlookup={() => (showRefLookup = true)}
/>

<!-- @desc 文件夹右键菜单（点击⋯按钮或右键文件夹头均打开） -->
<ContextMenu
    x={folderMenuX}
    y={folderMenuY}
    items={folderMenuItems}
    open={folderMenuOpen}
    onclose={() => (folderMenuOpen = false)}
/>

<!-- @desc 单个 buff 右键菜单（普通条目 / 全局条目 / 多选状态批量操作） -->
<ContextMenu
    x={itemMenuX}
    y={itemMenuY}
    items={itemMenuItems}
    open={itemMenuOpen}
    onclose={() => (itemMenuOpen = false)}
/>

<!-- @desc 删除文件夹确认弹窗 -->
<ConfirmDialog
    open={showDeleteFolderConfirm}
    title="确认删除文件夹"
    icon="mdi:folder"
    danger
    confirmLabel="确认删除"
    onclose={() => (showDeleteFolderConfirm = false)}
    onconfirm={confirmDeleteFolder}
>
    将删除该文件夹内的所有 <strong>{deleteFolderCount}</strong> 条 BUFF，确定吗？
</ConfirmDialog>

<!-- @desc 文件夹批量重命名弹窗：按「新前缀 + 1..N + 新后缀」重新编号全部子 Buff -->
{#if showFolderRename && folderRenameTarget}
    <BuffModalFolderRenameModal
        folder={folderRenameTarget}
        onclose={() => (showFolderRename = false)}
        onconfirm={confirmFolderRename}
    />
{/if}

<!-- @desc 多选批量删除确认弹窗 -->
<ConfirmDialog
    open={showMultiDeleteConfirm}
    title="确认批量删除"
    icon="mdi:delete-outline"
    danger
    confirmLabel="确认删除"
    onclose={() => (showMultiDeleteConfirm = false)}
    onconfirm={confirmMultiDelete}
>
    将删除选中的 <strong>{multi.selectedIds.size}</strong> 条 BUFF（全局 buff 不受影响），确定吗？
</ConfirmDialog>

<!-- @desc 复制命名选项弹窗（buff 名带数字时的递增命名选择） -->
{#if showCopyOptions}
    <BuffModalCopyModal names={copyOptions} onclose={() => (showCopyOptions = false)} onpick={confirmCopyBuff} />
{/if}

<!-- @desc 速查弹窗（新建 BUFF 场景：创建Buff入口）与引用速查（只读），以及 Buff 导入弹窗 -->
<QuickLookup
    locked={getLocked()}
    open={showLookup}
    {team}
    showCustomHitOption={false}
    onCreateBuff={(name) => createBuffSet(name)}
    onclose={() => (showLookup = false)}
/>

<QuickLookup
    locked={getLocked()}
    open={showRefLookup}
    {team}
    showBuffOption={false}
    showCustomHitOption={false}
    onclose={() => (showRefLookup = false)}
/>

<BuffImportModal open={showImport} {team} onclose={() => (showImport = false)} />
