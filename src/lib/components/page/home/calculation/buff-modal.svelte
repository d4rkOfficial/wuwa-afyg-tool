<script lang="ts">
    /**
     * @desc BUFF 配置弹窗：标题栏「BUFF 配置」+ 全局/非全局胶囊 tab + 导入入口；
     * 左侧 Buff 块列表（文件夹/拖拽排序/拖出删除/多选批量操作/新建）；
     * 右侧块编辑器三个 tab（具体效果 / 生效成员 / 门槛条件），仅「具体效果」展开右栏乘区清单。
     */
    import {
        getAllBuffConfs,
        createBuffSet,
        deleteBuffSets,
        duplicateBuffSet,
        renameBuffSet,
        addZoneToBuffSet,
        removeZoneAt,
        setZoneValueAt,
        setZoneOverrideAt,
        setZoneRefAt,
        setZoneConditionAt,
        setBuffSetScope,
        setBuffSetRules,
        buffDeleteCascadeOf,
        getGlobalBuffSetIds,
        setBuffSetGlobal,
        setBuffSetsGlobal,
        getBuffTree,
        createBuffTreeFolder,
        renameBuffTreeFolder,
        deleteBuffTreeFolder,
        moveBuffTreeNode,
        moveBuffFolderSibling,
        pruneEmptyBuffFolders,
        getCalcState,
        restoreCalcSnapshot,
        setShowBuffModal
    } from '$lib/calc/calculation.store.svelte'
    import { ZONE_REF_DEFS } from '$lib/calc/calculation.consts'
    import type { GroupedBuffConfItem } from '$lib/calc/calculation.consts'
    import { buildStoredBuffTree } from '$lib/calc/buff-tree'
    import { findBuffPlacement, findNode } from '$lib/calc/buff-tree-state'
    import { buffLeafName } from '$lib/calc/buff-name'
    import type { CharSlot } from '$lib/types/project'
    import type {
        BuffRule,
        ZoneRef,
        BuffConf,
        BuffCondition,
        BuffTreeNode,
        CalcState
    } from '$lib/calc/calculation.types'
    import { cyclePathOf } from '$lib/calc/rules'
    import { slide } from 'svelte/transition'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
    import type { BuffEditorTab } from './buff-modal-editor.svelte'
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
    import BuffFolderNameModal from './buff-folder-name-modal.svelte'
    import BuffFolderPickerModal from './buff-folder-picker-modal.svelte'
    import UnsavedChangesDialog from '$lib/components/ui/unsaved-changes-dialog.svelte'
    import { diffBuffConfig } from './unsaved-changes.utils'
    import type { UnsavedChangeItem } from '$lib/types/unsaved-change'
    import { onMount, untrack } from 'svelte'
    import { registerPanel, unregisterPanel } from '$lib/ai/panels.svelte'
    import { registerDragCancel } from '$lib/utils/drag-guard'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'
    import type { BuffDerived, BuffTree } from './buff-modal.types'
    import type { DragState, RefModalState } from './buff-modal.utils'
    import {
        ZONE_BAR_WIDTH,
        createRefModalState,
        folderMembersOf,
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

    /**
     * @desc 打开时的数据快照（关闭确认 / 「不保存」回滚用）：`getCalcState()` 自带深拷贝。
     * 只在 `open` 翻转时取一次 —— 快照本身不能跟着 store 变化重取，否则「改动」永远为空。
     */
    let openSnapshot = $state<CalcState | null>(null)
    /** @desc 关闭前确认弹窗的改动清单；空数组 = 不需要确认 */
    let closeChanges = $state<UnsavedChangeItem[]>([])
    let showCloseConfirm = $state(false)

    $effect(() => {
        const isOpen = open
        untrack(() => {
            openSnapshot = isOpen ? getCalcState() : null
            if (!isOpen) {
                showCloseConfirm = false
                closeChanges = []
            }
        })
    })

    /**
     * @desc 真正关闭弹窗：**先清理空文件夹**再落 store（清理只在关闭/保存时做，见 requirements.md A1）。
     * 清理会走 `commitBuffTree` 一并持久化，所以不需要在这里额外落一次快照。
     */
    const finishClose = () => {
        pruneEmptyBuffFolders()
        setShowBuffModal(false)
        onclose()
    }

    /**
     * @desc 右上角 ❌ / Esc 的关闭入口：本次会话有改动时先弹「以下修改还未保存」，
     * 无改动则直接关闭（省一次无意义确认）。
     */
    const requestClose = () => {
        const changes = openSnapshot ? diffBuffConfig(openSnapshot, getCalcState()) : []
        if (changes.length === 0) {
            finishClose()
            return
        }
        closeChanges = changes
        showCloseConfirm = true
    }

    /** @desc 不保存：回滚到打开时的快照（含宿主回写）后退出 */
    const discardAndClose = () => {
        const snapshot = openSnapshot
        showCloseConfirm = false
        if (snapshot) restoreCalcSnapshot(snapshot)
        finishClose()
    }

    let showRefLookup = $state(false)
    let showImport = $state(false)

    /** @desc 挂载时注册 AI 面板「从 Buff 集导入工程 Buff 配置」与拖拽禁区回调（进入 AI 悬浮窗时取消拖拽） */
    onMount(() => {
        registerPanel(
            'buff-conf-import',
            '导入 Buff 集',
            () => showImport,
            (v) => (showImport = v)
        )
        unregisterDragCancel = registerDragCancel(cancelBuffDrag)
        return () => {
            unregisterPanel('buff-conf-import')
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
    /** @desc 删除该文件夹时会**级联**带走多少条依赖方（条件里引用了将被删 BUFF 的 Buff） */
    const deleteFolderCascadeExtra = $derived(
        Math.max(0, buffDeleteCascadeOf(deleteFolderMemberIds).length - deleteFolderMemberIds.length)
    )

    /** @desc 文件夹右键菜单：菜单位置/开关/当前目标 folder（普通与全局文件夹共用） */
    let folderMenuOpen = $state(false)
    let folderMenuX = $state(0)
    let folderMenuY = $state(0)
    let folderMenuTarget = $state<GroupedBuffConfItem | null>(null)
    /** @desc 单个 buff 右键菜单：菜单位置/开关/当前目标 id（多选状态下为多选菜单） */
    let itemMenuOpen = $state(false)
    let itemMenuX = $state(0)
    let itemMenuY = $state(0)
    let itemMenuTargetId = $state<string | null>(null)
    /** @desc 「移入文件夹」二级弹窗：目标 Buff + 当前文件夹 */
    let showMovePicker = $state(false)
    let movePickerTargetId = $state<string | null>(null)
    /** @desc 新建 BUFF 前的文件夹选择弹窗；取消时回滚本次新建的文件夹 */
    let showCreateBuffPicker = $state(false)
    let pendingCreatedFolderIds = $state<string[]>([])
    /** @desc 手动文件夹的新建 / 重命名弹窗；null = 关闭 */
    let folderNameRequest = $state<
        | { mode: 'create'; parentId?: string | null; id?: string; name: string }
        | { mode: 'rename'; id: string; name: string }
        | null
    >(null)

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
        getActiveTab: () => activeTab,
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

    let renameInputEl = $state<HTMLInputElement | null>(null)
    /**
     * @desc 名称编辑输入框（在编辑器组件内），父组件在「新建 / 右键重命名」后调用它聚焦
     */
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

    let buffSets = $derived(getAllBuffConfs())
    let globalBuffSetIds = $derived(getGlobalBuffSetIds())
    let charIconMap = $derived(getCharIconMap())
    /** @desc 当前管理的根：全局 / 非全局（一次只看一个） */
    let activeTab = $state<'global' | 'nonGlobal'>('nonGlobal')
    const manualMode = true
    let storedTree = $derived(getBuffTree())

    /** @desc 当前选中的 Buff 块、其作用域对应角色勾选态、是否效应专属 */
    let selectedBuffSet = $derived(buffSets.find((s) => s.id === selectedBuffSetId) ?? null)

    /** @desc 当前编辑乘区的 zoneId（由下标推出，供引用弹窗过滤目标属性；乘区可重复添加，故用下标定位） */
    let refZoneId = $derived(
        refModal.zoneIndex >= 0 ? (selectedBuffSet?.zones?.[refModal.zoneIndex]?.zoneId ?? '') : ''
    )

    /** @desc 左栏：显式树按当前 tab 转成列表节点（一级/二级文件夹 + Buff） */
    let buffTree = $derived(buildStoredBuffTree(storedTree, activeTab, buffSets, team))
    let listTree = $derived<BuffTree>({ nodes: buffTree.nodes, folderKeys: buffTree.folderKeys })

    type MoveFolderOption = { id: string; name: string; path: string; depth: number }
    /** @desc 「移入文件夹」弹窗的扁平文件夹清单（保留层级缩进与全路径） */
    const moveFolderOptions = $derived.by(() => {
        const out: MoveFolderOption[] = []
        const walk = (nodes: readonly BuffTreeNode[], path: string[], depth: number): void => {
            for (const node of nodes) {
                if (node.kind !== 'folder') continue
                const nextPath = [...path, node.name]
                out.push({ id: node.id, name: node.name, path: nextPath.join('\\'), depth })
                walk(node.children, nextPath, depth + 1)
            }
        }
        walk(storedTree[activeTab], [], 1)
        return out
    })

    const movePickerCurrentFolderId = $derived(
        movePickerTargetId ? (findBuffPlacement(storedTree, movePickerTargetId)?.folderId ?? null) : null
    )

    const openMovePicker = (id: string) => {
        movePickerTargetId = id
        showMovePicker = true
    }

    const confirmMoveToFolder = (folderId: string | null) => {
        if (movePickerTargetId) moveBuffTreeNode(movePickerTargetId, folderId)
        movePickerTargetId = null
        showMovePicker = false
    }

    /** @desc 新建 Buff 块：先选文件夹（可在选择器里新建子文件夹），确认后才创建并聚焦改名 */
    function handleCreateBuffSet() {
        pendingCreatedFolderIds = []
        showCreateBuffPicker = true
    }

    /** @desc 选择器内新建文件夹：记下 id 供取消时回滚（全局树不可回滚，调用方已禁用） */
    function createFolderForNewBuff(parentId: string | null, name: string): string | undefined {
        const id = createBuffTreeFolder(name, activeTab, parentId)
        if (id) pendingCreatedFolderIds = [...pendingCreatedFolderIds, id]
        return id
    }

    /** @desc 回滚本次选择器里新建的文件夹（倒序，只删空文件夹，不碰用户已有内容） */
    function rollbackCreatedFolders() {
        const ids = [...pendingCreatedFolderIds].reverse()
        pendingCreatedFolderIds = []
        for (const id of ids) {
            const located = findNode(getBuffTree(), id)
            if (located?.node.kind === 'folder' && located.node.children.length === 0) deleteBuffTreeFolder(id)
        }
    }

    function cancelCreateBuffPicker() {
        showCreateBuffPicker = false
        rollbackCreatedFolders()
    }

    /** @desc 确认落点后创建 Buff；创建失败（锁定等）同样回滚新文件夹 */
    function confirmCreateBuff(folderId: string | null) {
        const newId = createBuffSet('未命名BUFF块', { tab: activeTab, folderId })
        if (!newId) {
            showCreateBuffPicker = false
            rollbackCreatedFolders()
            return
        }
        pendingCreatedFolderIds = []
        showCreateBuffPicker = false
        if (folderId) expandFolderAndAncestors(folderId)
        selectedBuffSetId = newId
        focusRenameInput()
    }

    /** @desc 新建在折叠文件夹里时展开该文件夹与祖先，避免选中了却看不见 */
    function expandFolderAndAncestors(folderId: string) {
        const located = findNode(getBuffTree(), folderId)
        const ids = [folderId, ...(located?.parentFolder ? [located.parentFolder.id] : [])]
        collapsedFolders = new Set([...collapsedFolders].filter((key) => !ids.some((id) => key.includes(id))))
    }

    /** @desc 删除确认：将被级联删除的完整集合（含传入项自身） */
    let pendingDeleteCascade = $state<string[]>([])
    /** @desc 用户主动删除的根集合（级联项由 store 递归算） */
    let pendingDeleteRoots = $state<string[]>([])

    /** @desc 真正删除（store 内部会级联删除依赖方并剪掉存活方的引用） */
    function confirmDeleteBuffSets() {
        const roots = pendingDeleteRoots
        const cascade = pendingDeleteCascade.length > 0 ? pendingDeleteCascade : buffDeleteCascadeOf(roots)
        pendingDeleteRoots = []
        pendingDeleteCascade = []
        if (roots.length === 0) return
        deleteBuffSets(roots)
        if (selectedBuffSetId && cascade.includes(selectedBuffSetId)) selectedBuffSetId = null
    }

    /**
     * @desc 请求删除：**先算出级联集合**（删除被引用的 Buff 会连带删除依赖它的 Buff）。
     * 没有级联项时直接删（保持旧行为，不额外弹窗）；有级联项时弹确认并逐条列出。
     */
    function requestDeleteBuffSets(roots: string[]) {
        if (roots.length === 0) return
        const cascade = buffDeleteCascadeOf(roots)
        if (cascade.length <= roots.length) {
            pendingDeleteRoots = roots
            confirmDeleteBuffSets()
            return
        }
        pendingDeleteRoots = roots
        pendingDeleteCascade = cascade
    }

    /** @desc 删除当前选中的 Buff 块（含级联确认） */
    function handleDeleteBuffSet() {
        if (!selectedBuffSetId) return
        requestDeleteBuffSets([selectedBuffSetId])
    }

    /** @desc 级联删除确认框里列出的条目（排除用户主动删的那些，只列「被连带」的） */
    const cascadeOnlyNames = $derived(
        pendingDeleteCascade.filter((id) => !pendingDeleteRoots.includes(id)).map((id) => buffLabelOf(id))
    )

    /** @desc 并入/移出全局（并入成功提示作用域） */
    function handleToggleGlobal() {
        if (!selectedBuffSetId || !selectedBuffSet) return
        const isGlobal = globalBuffSetIds.includes(selectedBuffSetId)
        const ok = setBuffSetGlobal(selectedBuffSetId, !isGlobal)
        if (!ok) return
        activeTab = isGlobal ? 'nonGlobal' : 'global'
        if (!isGlobal) {
            addToast(selectedBuffSet.scope === 'all' ? '已并入全局，通用生效' : '已并入全局', 'success')
        } else {
            addToast('已移出全局', 'info')
        }
    }

    /** @desc 复制目标落点：非全局 Buff 复刻到原文件夹（全局复制品会解除全局，故不回到全局树） */
    function copyPlacementOf(): { tab: 'global' | 'nonGlobal'; folderId: string | null; index: number } | null {
        if (!selectedBuffSetId || !selectedBuffSet || selectedBuffSet.global) return null
        return findBuffPlacement(storedTree, selectedBuffSetId)
    }

    /**
     * @desc 复制 Buff：短名末尾补 `#`，留在原文件夹；重名时由 store 继续补 `#`（`原#` → `原##`）。
     * 复制品仍按原逻辑解除全局（全局树受保护，不复制回全局）。
     */
    function handleCopyBuffSet() {
        if (!selectedBuffSetId || !selectedBuffSet) return
        const placement = copyPlacementOf()
        const newId = duplicateBuffSet(
            selectedBuffSetId,
            `${buffLeafName(selectedBuffSet.name)}#`,
            placement ?? undefined
        )
        if (newId) selectedBuffSetId = newId
    }

    /** @desc 重命名选中块（空名兜底；编辑器组件内 Enter/失焦触发） */
    function handleRename(value: string) {
        if (!selectedBuffSetId) return
        renameBuffSet(selectedBuffSetId, value)
    }

    /**
     * @desc 生效成员（作用域）变更：四态状态机在 `buff-modal-members` 里算好后交回这里写 store。
     * 全局 Buff 的受益者被锁定，store 侧也会拒绝。
     */
    function handleScopeChange(scope: 'all' | number[]) {
        if (!selectedBuffSetId) return
        setBuffSetScope(selectedBuffSetId, scope)
    }

    /** @desc 右列当前 tab：默认「具体效果」（只有它展开右侧乘区栏） */
    let editorTab = $state<BuffEditorTab>('effect')

    /** @desc 是否为默认全局 buff（global- 前缀，锁定不可改名 / 条件） */
    function isDefaultGlobalBuff(): boolean {
        return !!selectedBuffSet && selectedBuffSet.id.startsWith('global-')
    }

    /**
     * @desc 保存 Buff 级规则（门槛条件 tab）。
     * `buffActive` 的成环校验在这里做：直接自引用与间接循环都拒绝并 toast，成功返回 null。
     * 默认全局块（内置）不允许配条件（与旧「链/阶不可改」一致）。
     */
    function handleSaveRules(rules: BuffRule[]): string | null {
        if (!selectedBuffSetId || !selectedBuffSet) return '没有选中的 BUFF'
        if (isDefaultGlobalBuff()) return '默认全局 BUFF 无法设置条件'
        const cycle = cyclePathOf(buffSets, selectedBuffSetId, rules)
        if (cycle) {
            const names = cycle.map((id) => buffLabelOf(id)).join(' → ')
            return `条件引用成环：${names}`
        }
        setBuffSetRules(selectedBuffSetId, rules)
        return null
    }

    /** @desc Buff id → 显示名（规则文案与成环提示用） */
    const buffLabelOf = (id: string): string => {
        const buff = buffSets.find((b) => b.id === id)
        return buff ? buffLeafName(buff.name) : id
    }

    /** @desc `buffActive` 条件可引用的候选：当前 tab 树里的其它 Buff（不含内置默认全局块） */
    const ruleBuffOptions = $derived(
        buffSets
            .filter((b) => b.id !== selectedBuffSetId && !b.id.startsWith('global-'))
            .map((b) => ({ id: b.id, label: buffLeafName(b.name) }))
    )

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
        const list = getAllBuffConfs()
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
        setConfirmDeleteFolder: (v) => (showDeleteFolderConfirm = v),
        isManual: () => manualMode,
        getActiveTab: () => activeTab
    })
    const listContext = drag.listContext
    const cancelBuffDrag = drag.cancel
    const startDrag = drag.start
    const onDragMove = drag.move
    const onDragEnd = drag.end
    const confirmDeleteFolder = () => drag.confirmDeleteFolder(deleteFolderMemberIds)

    /** @desc 打开文件夹右键菜单（点击⋯按钮或右键文件夹头均走这里） */
    function openFolderMenu(e: MouseEvent, folder: GroupedBuffConfItem) {
        e.preventDefault()
        e.stopPropagation()
        // 多选态：右键文件夹即把该组可勾选成员设为当前选中集合，菜单对整组生效
        if (multiSelect) {
            const ids = folderMembers(folder)
                .map((item) => item.id)
                .filter((id) => !isMultiSelectDisabled(id))
            multi.selectedIds = new Set(ids)
        }
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
    function moveFolderGlobal(folder: GroupedBuffConfItem, global: boolean) {
        const ids = folderMembers(folder).map((c) => c.id)
        if (ids.length === 0) return
        setBuffSetsGlobal(ids, global)
        const n = ids.length
        if (global) addToast(`已将「${folder.name}」的 ${n} 条 BUFF 并入全局`, 'success')
        else addToast(`已将「${folder.name}」的 ${n} 条 BUFF 移出全局`, 'info')
    }

    /** @desc 显式树文件夹节点 prefix = `tree:<folderId>` / `tree2:<folderId>` */
    const manualFolderIdOf = (folder: GroupedBuffConfItem): string => {
        const prefix = folder.prefix ?? ''
        if (prefix.startsWith('tree2:')) return prefix.slice('tree2:'.length)
        if (prefix.startsWith('tree:')) return prefix.slice('tree:'.length)
        return ''
    }

    const openCreateManualFolder = (parentId: string | null = null) => {
        folderNameRequest = { mode: 'create', parentId, name: '' }
    }

    const openRenameManualFolder = (folder: GroupedBuffConfItem) => {
        folderNameRequest = { mode: 'rename', id: manualFolderIdOf(folder), name: folder.name ?? '' }
    }

    const confirmFolderName = (name: string) => {
        const request = folderNameRequest
        if (!request) return
        if (request.mode === 'create') {
            const id = createBuffTreeFolder(name, activeTab, request.parentId ?? null)
            if (id) addToast(`已新建文件夹「${name}」`, 'success')
        } else {
            renameBuffTreeFolder(request.id, name)
        }
        folderNameRequest = null
    }

    const removeManualFolder = (folder: GroupedBuffConfItem) => {
        const id = manualFolderIdOf(folder)
        if (!id) return
        const count = folderMembers(folder).length
        if (!deleteBuffTreeFolder(id)) {
            addToast('全局文件夹受保护，只能把 Buff 移出全局，不能删除', 'info')
            return
        }
        addToast(`已删除文件夹「${folder.name ?? ''}」及其中 ${count} 条 BUFF`, 'info')
    }

    /** @desc 文件夹右键菜单项：多选态 → 整组批量操作；非多选 → 重命名 / 删除 / 全局 */
    let folderMenuItems = $derived.by(() => {
        const folder = folderMenuTarget
        if (!folder) return []
        if (multiSelect) {
            const count = multi.selectedIds.size
            return [
                {
                    label: `并入全局${count > 0 ? `（${count} 项）` : ''}`,
                    icon: 'mdi:crown-outline',
                    disabled: !multiSelectionAllNonGlobal(),
                    action: () => multiSetGlobal(true)
                },
                {
                    label: `移出全局${count > 0 ? `（${count} 项）` : ''}`,
                    icon: 'mdi:minus-circle-outline',
                    disabled: !multiSelectionAllGlobal(),
                    action: () => multiSetGlobal(false)
                },
                {
                    label: '按名称排序',
                    icon: 'mdi:sort-alphabetical-ascending',
                    disabled: sortableCount() < 2,
                    action: () => sortMultiSelected()
                },
                {
                    label: `删除${count > 0 ? `（${count} 项）` : ''}`,
                    icon: 'mdi:delete-outline',
                    action: () => requestMultiDelete()
                }
            ]
        }
        const members = folderMembers(folder).filter((item) => !isMultiSelectDisabled(item.id))
        const allGlobal = members.length > 0 && members.every((item) => globalBuffSetIds.includes(item.id))
        const common = [
            {
                label: allGlobal ? '整组移出全局' : '整组并入全局',
                icon: allGlobal ? 'mdi:minus-circle-outline' : 'mdi:crown-outline',
                disabled: members.length === 0,
                action: () => moveFolderGlobal(folder, !allGlobal)
            }
        ]
        if (manualMode && (folder as { folderKind?: string }).folderKind === 'manual') {
            const id = manualFolderIdOf(folder)
            const items = [
                { label: '重命名文件夹', icon: 'mdi:rename-box', action: () => openRenameManualFolder(folder) },
                { label: '上移', icon: 'mdi:arrow-up', action: () => moveBuffFolderSibling(id, -1) },
                { label: '下移', icon: 'mdi:arrow-down', action: () => moveBuffFolderSibling(id, 1) },
                ...common,
                {
                    label: activeTab === 'global' ? '全局文件夹不可删' : '删除文件夹',
                    icon: 'mdi:delete-outline',
                    disabled: activeTab === 'global',
                    action: () => removeManualFolder(folder)
                }
            ]
            if (folder.prefix?.startsWith('tree:')) {
                items.splice(1, 0, {
                    label: '新建子文件夹',
                    icon: 'mdi:folder',
                    action: () => openCreateManualFolder(id)
                })
            }
            return items
        }
        return common
    })

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
            items.splice(2, 0, {
                label: '按名称排序',
                icon: 'mdi:sort-alphabetical-ascending',
                disabled: sortableCount() < 2,
                action: () => sortMultiSelected()
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
            if (manualMode) {
                items.push({
                    label: '移入文件夹…',
                    icon: 'mdi:folder-open',
                    action: () => openMovePicker(id)
                })
            }
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

    /** @desc 右键菜单复制：选中目标后走同一套「短名 + #」逻辑 */
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

    /**
     * @desc 「并入 / 移出全局」的作用集合：多选 → 勾选集合（底部工具栏批量按钮）；
     * 非多选 → 当前选中 Buff（右列详情头部按钮，在复制/删除旁边）。内置默认块（`global-` 前缀）
     * 既不能删也不能移出全局，这里一并跳过。
     */
    const contextGlobalIds = $derived.by(() => {
        const ids = multiSelect ? [...multi.selectedIds] : selectedBuffSetId ? [selectedBuffSetId] : []
        return ids.filter((id) => !id.startsWith('global-'))
    })

    /** @desc 当前 tab 决定按钮语义：全局 → 移出全局；非全局 → 并入全局 */
    const globalActionState = $derived.by(() => {
        const toGlobal = activeTab === 'nonGlobal'
        const count = contextGlobalIds.length
        const scopeText = multiSelect ? '勾选的 BUFF' : '当前选中的 BUFF'
        return {
            label: toGlobal ? '并入全局' : '移出全局',
            icon: toGlobal ? 'mdi:crown-outline' : 'mdi:minus-circle-outline',
            disabled: count === 0,
            title:
                count > 0
                    ? `把${scopeText}（${count} 条）${toGlobal ? '并入全局' : '移出全局'}`
                    : multiSelect
                      ? '没有勾选可操作的 BUFF'
                      : '内置默认全局块：不可移出全局'
        }
    })

    /** @desc 批量删除确认里要提示的级联条数（选中项之外还会被删掉多少） */
    const multiDeleteCascadeExtra = $derived(
        Math.max(0, buffDeleteCascadeOf([...multi.selectedIds]).length - multi.selectedIds.size)
    )

    /** @desc 并入/移出全局：多选作用勾选集合（底部工具栏）、非多选作用当前选中 Buff（详情头部） */
    function handleContextGlobal() {
        const ids = contextGlobalIds
        if (ids.length === 0) return
        const toGlobal = activeTab === 'nonGlobal'
        if (!setBuffSetsGlobal(ids, toGlobal)) return
        addToast(toGlobal ? `已并入全局 ${ids.length} 条 BUFF` : `已移出全局 ${ids.length} 条 BUFF`, 'success')
        if (multiSelect) {
            multi.selectedIds = new Set()
            return
        }
        // 单条操作为了「搬完还看得见」跟随到目标 tab（与右键菜单的并入/移出行为一致）
        if (ids.length === 1) activeTab = toGlobal ? 'global' : 'nonGlobal'
    }

    /** @desc 武器图标表（按需加载，失败静默；角色详情/队伍配置共用同一份数据） */
    let weaponIcons = $state<Record<string, string>>({})
    $effect(() => {
        void getWeaponIcons().then((map) => (weaponIcons = map))
    })
</script>

<!-- @desc BUFF 配置弹窗根容器：共享弹窗外壳 + 内容（标题栏入口/左侧列表/右侧编辑器/底部保存） -->
<Modal {open} onclose={requestClose} noScroll class={mergeClass(['h-full w-[1180px]', className])} style={styleProp}>
    {#snippet title()}
        <Icon icon="mdi:widgets" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>BUFF 配置</span>
        <!-- @desc 标题栏「BUFF 配置」右侧：全局/非全局胶囊 tab；空工程时随内容一起隐藏 -->
        {#if buffSets.length > 0}
            <div
                class="ml-3 flex shrink-0 overflow-hidden border"
                style="border-color: var(--theme-divider-border);"
                role="tablist"
                aria-label="BUFF 作用域"
            >
                {#each [{ value: 'nonGlobal' as const, label: '非全局' }, { value: 'global' as const, label: '全局' }] as tab (tab.value)}
                    {@const on = activeTab === tab.value}
                    <button
                        type="button"
                        role="tab"
                        aria-selected={on}
                        onclick={() => (activeTab = tab.value)}
                        class="px-3 py-0.5 text-[11px] font-medium transition-colors"
                        style={on
                            ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);'
                            : 'color: var(--theme-modal-text); opacity: 0.65;'}
                    >
                        {tab.label}
                    </button>
                {/each}
            </div>
            <!-- @desc 标题栏右侧：只剩「导入Buff集」入口（「速查」已移除） -->
            <div class="ml-auto mr-4 flex items-center gap-1">
                <button
                    onclick={() => (showImport = true)}
                    class="flex items-center gap-1 rounded-none px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-modal-text)/5"
                >
                    <Icon icon="mdi:import" class="size-3.5" />
                    导入Buff集
                </button>
            </div>
        {/if}
    {/snippet}

    {#if buffSets.length === 0}
        <!-- @desc 空工程：清空列表/编辑器，只留两个入口大卡片 -->
        <div class="flex flex-1 items-center justify-center px-6 py-10">
            <div class="grid w-full max-w-[640px] grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                    type="button"
                    onclick={handleCreateBuffSet}
                    class="group flex min-h-40 flex-col items-center justify-center gap-3 rounded-none border px-6 py-8 transition-colors hover:border-(--theme-accent-bg) hover:bg-(--theme-accent-bg)/5"
                    style="border-color: var(--theme-divider-border);"
                >
                    <span
                        class="flex size-12 items-center justify-center rounded-full"
                        style="background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent);"
                    >
                        <Icon icon="mdi:plus" class="size-6" style="color: var(--theme-accent-text);" />
                    </span>
                    <span class="text-base font-black tracking-tight" style="color: var(--theme-modal-text);"
                        >新建 BUFF</span
                    >
                    <span class="text-[11px]" style="color: var(--theme-modal-text); opacity: 0.45;"
                        >从空白 Buff 开始配置乘区</span
                    >
                </button>
                <button
                    type="button"
                    onclick={() => (showImport = true)}
                    class="group flex min-h-40 flex-col items-center justify-center gap-3 rounded-none border px-6 py-8 transition-colors hover:border-(--theme-accent-bg) hover:bg-(--theme-accent-bg)/5"
                    style="border-color: var(--theme-divider-border);"
                >
                    <span
                        class="flex size-12 items-center justify-center rounded-full"
                        style="background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent);"
                    >
                        <Icon icon="mdi:import" class="size-6" style="color: var(--theme-accent-text);" />
                    </span>
                    <span class="text-base font-black tracking-tight" style="color: var(--theme-modal-text);"
                        >导入 Buff 集</span
                    >
                    <span class="text-[11px]" style="color: var(--theme-modal-text); opacity: 0.45;"
                        >从本地 Buff 集导入实体增益</span
                    >
                </button>
            </div>
        </div>
    {:else}
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
                {manualMode}
                multiSelectedIds={multi.selectedIds}
                {resizingSidebar}
                {sidebarDividerHover}
                globalAction={globalActionState}
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
                onContextGlobal={handleContextGlobal}
                onrequestmultidelete={requestMultiDelete}
                oncreatebuff={handleCreateBuffSet}
            />

            <!-- @desc 右列：上（块编辑器 + 乘区清单）下（保存并关闭），sidebar 占满整高 -->
            <div class="flex-1 flex flex-col overflow-hidden">
                <div class="flex flex-1 overflow-hidden">
                    {#if selectedBuffSet}
                        <BuffModalEditor
                            bind:tab={editorTab}
                            bind:expandedZoneIndex
                            bind:renameInputEl
                            buff={selectedBuffSet}
                            {team}
                            {teamNames}
                            {charIconMap}
                            isGlobal={globalBuffSetIds.includes(selectedBuffSet.id)}
                            isDefaultGlobal={selectedBuffSet.id.startsWith('global-')}
                            zones={selectedZones}
                            {overrideZoneIds}
                            {externalOverrides}
                            buffOptions={ruleBuffOptions}
                            globalAction={multiSelect ? null : globalActionState}
                            onrename={handleRename}
                            oncopy={handleCopyBuffSet}
                            ondelete={handleDeleteBuffSet}
                            onContextGlobal={handleContextGlobal}
                            onscope={handleScopeChange}
                            onsaverules={handleSaveRules}
                            onsetzonevalue={(index, value) => setZoneValueAt(selectedBuffSet.id, index, value)}
                            onoverride={(index, override) => setZoneOverrideAt(selectedBuffSet.id, index, override)}
                            onopenref={openRefModal}
                            onremovezone={(index) => removeZoneAt(selectedBuffSet.id, index)}
                            ontogglezonecond={toggleZoneCondition}
                            onzonecondchange={handleZoneConditionChange}
                        />
                        <!-- @desc 右栏乘区清单：只有「具体效果」tab 展开（展开/收起走 MOTION_MS.base） -->
                        {#if editorTab === 'effect'}
                            <div
                                class="flex shrink-0"
                                transition:slide|local={{ ...slideParams(MOTION_MS.base), axis: 'x' }}
                            >
                                <BuffModalZoneBar
                                    zones={selectedZones}
                                    onadd={(zoneId) => addZoneToBuffSet(selectedBuffSet.id, zoneId)}
                                />
                            </div>
                        {/if}
                    {:else}
                        <div class="flex-1 flex items-center justify-center text-xs text-(--theme-modal-text)/40">
                            选择一个 BUFF 块进行编辑
                        </div>
                    {/if}
                </div>
                <!-- @desc 右列底部：保存并关闭按钮（显式保存 → 不弹未保存确认） -->
                <div
                    class="flex items-center justify-end gap-2 border-t px-5 py-3 shrink-0"
                    style="border-top: 1px solid var(--theme-divider-border);"
                >
                    <button
                        onclick={finishClose}
                        class="inline-flex items-center gap-1.5 rounded-none px-4 py-1.5 text-sm font-medium transition-all hover:brightness-125"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                    >
                        <Icon icon="mdi:check" class="size-4" />
                        保存并关闭
                    </button>
                </div>
            </div>
        </div>
    {/if}
</Modal>

<!-- @desc 关闭确认：右上角 ❌ / Esc 时有改动才出现（不保存 = 回滚到打开时的快照） -->
<UnsavedChangesDialog
    open={showCloseConfirm}
    items={closeChanges}
    onclose={() => (showCloseConfirm = false)}
    ondiscard={discardAndClose}
    onsave={() => {
        showCloseConfirm = false
        finishClose()
    }}
/>

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
    将删除该文件夹内的所有 <strong>{deleteFolderCount}</strong> 条 BUFF{deleteFolderCascadeExtra > 0
        ? `，并级联删除依赖它们条件的 ${deleteFolderCascadeExtra} 条 BUFF`
        : ''}，确定吗？
</ConfirmDialog>

<!-- @desc 手动文件夹的新建 / 重命名弹窗（纯改名：只收一个文件夹名） -->
{#if folderNameRequest}
    <BuffFolderNameModal
        title={folderNameRequest.mode === 'create' ? '新建文件夹' : '重命名文件夹'}
        initialName={folderNameRequest.name}
        onclose={() => (folderNameRequest = null)}
        onconfirm={confirmFolderName}
    />
{/if}

<!-- @desc 「移入文件夹」二级弹窗：替代右键菜单里一长串移入项 -->
{#if showMovePicker}
    <BuffFolderPickerModal
        open={showMovePicker}
        folders={moveFolderOptions}
        currentFolderId={movePickerCurrentFolderId}
        onclose={() => {
            showMovePicker = false
            movePickerTargetId = null
        }}
        onpick={confirmMoveToFolder}
    />
{/if}

<!-- @desc 新建 BUFF：先选文件夹（可就地新建最多两级子文件夹），确认后才真正创建 -->
{#if showCreateBuffPicker}
    <BuffFolderPickerModal
        open={showCreateBuffPicker}
        mode="create"
        heading="新建 BUFF：选择文件夹"
        folders={moveFolderOptions}
        allowCreateFolder={activeTab === 'nonGlobal'}
        oncreatefolder={createFolderForNewBuff}
        onclose={cancelCreateBuffPicker}
        onpick={confirmCreateBuff}
    />
{/if}
<ConfirmDialog
    open={showMultiDeleteConfirm}
    title="确认批量删除"
    icon="mdi:delete-outline"
    danger
    confirmLabel="确认删除"
    onclose={() => (showMultiDeleteConfirm = false)}
    onconfirm={confirmMultiDelete}
>
    将删除选中的 <strong>{multi.selectedIds.size}</strong> 条 BUFF（全局 buff 不受影响）{multiDeleteCascadeExtra > 0
        ? `，并级联删除依赖它们条件的 ${multiDeleteCascadeExtra} 条 BUFF`
        : ''}，确定吗？
</ConfirmDialog>

<!-- @desc 级联删除确认：删除被「其它 BUFF 生效」条件引用的 BUFF 时，列出会被连带删除的依赖方 -->
<ConfirmDialog
    open={pendingDeleteCascade.length > pendingDeleteRoots.length}
    title="确认删除（含级联删除）"
    icon="mdi:delete-alert-outline"
    danger
    confirmLabel="确认删除"
    onclose={() => {
        pendingDeleteRoots = []
        pendingDeleteCascade = []
    }}
    onconfirm={confirmDeleteBuffSets}
>
    这些 BUFF 被其它 BUFF 的「生效条件」引用；删除后依赖它们的 BUFF 也无法生效，将被一起删除：
    <ul class="mt-1.5 max-h-40 overflow-y-auto text-[11px]">
        {#each cascadeOnlyNames as name, i (i)}
            <li class="truncate">· {name}</li>
        {/each}
    </ul>
    <p class="mt-1.5">
        共 <strong>{pendingDeleteCascade.length}</strong> 条（含你选中的 {pendingDeleteRoots.length} 条）。
    </p>
</ConfirmDialog>

<!-- @desc 引用速查（只读，引用配置弹窗里的入口）与 Buff 导入弹窗 -->
<QuickLookup
    locked={getLocked()}
    open={showRefLookup}
    {team}
    showCustomHitOption={false}
    onclose={() => (showRefLookup = false)}
/>

<BuffImportModal open={showImport} {team} onclose={() => (showImport = false)} />
