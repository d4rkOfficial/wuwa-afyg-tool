<script lang="ts">
    /** @desc BUFF 配置弹窗：左侧 Buff 块列表（叠层文件夹/拖拽排序/拖出删除）、右侧块编辑器（作用域/生效条件/乘区数值与引用/追加覆盖）、右栏乘区清单，含速查与导入入口 */
    import {
        getAllBuffSets,
        createBuffSet,
        takePendingFocusBuffSetId,
        deleteBuffSet,
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
        setBuffSetCondition,
        setBuffSetConditionRef,
        getGlobalBuffSetIds,
        reorderNonGlobalBuffSets,
        compareNatural,
        toggleBuffSetStarred,
        setBuffSetGlobal,
        setBuffSetsGlobal
    } from '$lib/calc/calculation.store.svelte'
    import {
        ZONE_MAP,
        ZONE_NO_REF_IDS,
        ZONE_REF_DEFS,
        ZONE_REF_MAP,
        ZONE_SECTION_VIEWS,
        groupBuffSets,
        classifyBuffScope,
        LAYERED_BUFF_PATTERN
    } from '$lib/calc/calculation.consts'
    import type { ZoneId, GroupedBuffSetItem } from '$lib/calc/calculation.consts'
    import { buildBuffTree } from '$lib/calc/buff-tree'
    import type { BuffTreeNode } from '$lib/calc/buff-tree'
    import { computeDraggedOrder, dragBlockIndex } from '$lib/calc/buff-drag'
    import type { BuffDragMode } from '$lib/calc/buff-drag'
    import type { CharSlot } from '$lib/types/project'
    import type { ZoneRef, BuffSet, BuffCondition } from '$lib/calc/calculation.types'
    import { ELEMENTS, DAMAGE_TYPES, DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'
    import { getCharIconMap, elementColor, getLocked } from '$lib/calc/timeline.store.svelte'
    import { getWeaponIcons } from '$lib/api/data-cache'
    import { addToast } from '$lib/data/toast.svelte'
    import { getConfirmDeletes } from '$lib/data/interaction-prefs.svelte'
    import Icon from '@iconify/svelte'
    import QuickLookup from '$lib/components/layout/quick-lookup.svelte'
    import BuffImportModal from './buff-import-modal.svelte'
    import ZoneConditionPanel from './zone-condition-panel.svelte'
    import { describeCondition } from '$lib/calc/condition'
    import ContextMenu from '$lib/components/layout/context-menu.svelte'
    import { slide } from 'svelte/transition'
    import { onMount, onDestroy } from 'svelte'
    import { registerPanel, unregisterPanel } from '$lib/ai/panels.svelte'
    import { fallbackIcon } from '$lib/utils/icons'
    import { registerDragCancel } from '$lib/utils/drag-guard'
    import type { ComponentsProps } from '$lib/types'

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
     * @desc 拖拽状态。
     * 列表是派生的（链/武器目录按条件算、数字目录按名字算），所以只能改同一父容器内的行顺序：
     * `unitIds` 是本次搬运的 Buff（条目=单个 / 数字目录=整组成员），`parentKey` 是落点所在的父容器，
     * `dropIdx` 是父容器行序列（去掉被搬运行）里的插入位。
     */
    type DragState = {
        /** @desc 拖拽单元 key：item=Buff id；folder=数字目录的分组 key */
        id: string
        /** @desc 拖拽单元种类 */
        mode: BuffDragMode
        /** @desc 目标父容器 key（决定可落点的行序列） */
        parentKey: string
        /** @desc 被搬运的 Buff id（按展示顺序） */
        unitIds: string[]
        /** @desc 不移动时的落点下标（用于区分「点击」与「拖动」；-1=不在该父容器行序列里） */
        idx: number
        /** @desc 当前落点下标；-1=没有有效落点（拖出列表 / 原地未移动） */
        dropIdx: number
        /** @desc 是否已拖出列表（松手即删除） */
        outside: boolean
        /** @desc 插入指示条位置：显示在 dropBeforeId 这一行上方 / dropAfterId 这一行下方 */
        dropBeforeId: string | null
        dropAfterId: string | null
    }
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
    let folderRenamePrefix = $state('')
    let folderRenameSuffix = $state('')
    let folderRenameTarget = $state<GroupedBuffSetItem | null>(null)

    /** @desc 多选模式：勾选多个 buff（含文件夹整体）后批量删除 / 并入全局 */
    let multiSelect = $state(false)
    let multiSelectedIds = $state(new Set<string>())
    /** @desc 多选删除确认 */
    let showMultiDeleteConfirm = $state(false)

    /** @desc ── 左侧栏宽度拖拽调节（与主页 sidebar 拖动条一致：三态高亮 + rAF 节流） ── */
    let leftWidth = $state(256)
    let resizingSidebar = $state(false)
    let sidebarDividerHover = $state(false)
    let resizeStartX = 0
    let resizeStartWidth = 256
    $effect(() => {
        if (!resizingSidebar) return
        // rAF 节流：mousemove 只记录目标值，每帧合并一次写入（高刷屏避免每 mousemove 一次 layout）
        let pending: number | null = null
        let target = leftWidth
        const onMove = (e: MouseEvent) => {
            target = Math.max(180, Math.min(480, resizeStartWidth + (e.clientX - resizeStartX)))
            if (pending !== null) return
            pending = requestAnimationFrame(() => {
                pending = null
                leftWidth = target
            })
        }
        const onUp = () => {
            if (pending !== null) {
                cancelAnimationFrame(pending)
                pending = null
            }
            leftWidth = target
            resizingSidebar = false
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
    })
    function startSidebarResize(e: MouseEvent) {
        e.preventDefault()
        resizeStartX = e.clientX
        resizeStartWidth = leftWidth
        resizingSidebar = true
    }

    /** @desc ── 右栏「添加乘区」固定宽度（不再支持拖拽调宽）── */
    const ZONE_BAR_WIDTH = 208

    /** @desc 全局 buff 的标签颜色：全队=黄，否则取归属角色元素色 */
    function globalBuffColor(buffSet: { scope: number[] | 'all' }): string {
        if (!Array.isArray(buffSet.scope) || buffSet.scope.length === 0) return '#eab308'
        const idx = buffSet.scope[0]
        const charName = team[idx]?.character
        if (!charName) return '#eab308'
        return elementColor(charName)
    }

    let selectedBuffSetId = $state<string | null>(null)

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
    let renameValue = $state('')
    /** @desc 名称编辑输入框引用（新建/右键重命名后自动聚焦） */
    let renameInputEl = $state<HTMLInputElement | null>(null)
    /** @desc 切换选中块时同步重命名输入框内容 */
    $effect(() => {
        selectedBuffSetId
        if (selectedBuffSet) renameValue = selectedBuffSet.name
    })

    /** @desc ── ZoneRef 引用配置弹窗状态 ── */
    let showRefModal = $state(false)
    let refZoneIndex = $state<number>(-1)
    let refCharacterIdx = $state<number>(0)
    let refTargetZoneId = $state<string>('base_atk')
    let refThreshold = $state<number>(0)
    let refLower = $state<number | undefined>(undefined)
    let refUpper = $state<number | undefined>(undefined)
    let showRefZoneMenu = $state(false)
    let refHasThreshold = $state(true)
    let refDivisor = $state(10)
    let refMultiplier = $state(0)
    let refHasLower = $state(false)
    let refHasUpper = $state(false)
    let refIsDiscrete = $state(false)

    /** @desc 最大公约数（用于把百分比化简为分数） */
    function gcd(a: number, b: number): number {
        a = Math.abs(a)
        b = Math.abs(b)
        while (b) {
            const t = b
            b = a % b
            a = t
        }
        return a
    }

    /** @desc 把百分比 pct 化简为 除数/乘数 分数形式（如 12% → ÷100×12） */
    function simplifyPct(pct: number): { divisor: number; multiplier: number } {
        if (pct === 0) return { divisor: 1, multiplier: 0 }
        const num = Math.round(pct)
        const g = gcd(num, 100)
        return { divisor: 100 / g, multiplier: num / g }
    }

    let buffSets = $derived(getAllBuffSets())
    let globalBuffSetIds = $derived(getGlobalBuffSetIds())
    let charIconMap = $derived(getCharIconMap())

    /**
     * @desc 左侧列表的三级归类树：
     * 一级=全局 Buff；二级=角色名X链 / 角色名的武器X阶（依据 Buff 的链/阶硬性条件，无条件的留在最外层）；
     * 三级=名字里「前缀+数字+后缀」相同的 ≥2 条自动归档并按键数字升序。
     * 目录是派生的，因此拖拽只改变同一父容器内的顺序（见 buckets）。
     */
    let buffTree = $derived(buildBuffTree(buffSets, globalBuffSetIds, team))
    let groupedBuffSets = $derived(buffTree.nodes)

    /** @desc 当前选中的 Buff 块、其作用域对应角色勾选态、是否效应专属 */
    let selectedBuffSet = $derived(buffSets.find((s) => s.id === selectedBuffSetId) ?? null)

    /** @desc 当前编辑乘区的 zoneId（由下标推出，供引用弹窗过滤目标属性；乘区可重复添加，故用下标定位） */
    let refZoneId = $derived(refZoneIndex >= 0 ? (selectedBuffSet?.zones?.[refZoneIndex]?.zoneId ?? '') : '')

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

    /** @desc 引用弹窗相关派生：目标乘区定义/单位、当前乘区定义/单位 */
    let refTargetDef = $derived(ZONE_REF_MAP.get(refTargetZoneId) ?? ZONE_MAP.get(refTargetZoneId as any) ?? null)
    let refTargetDefUnit = $derived(refTargetDef?.unit === '%' ? '%' : '点')
    let currentZoneUnit = $derived(ZONE_MAP.get(refZoneId as ZoneId)?.unit === '%' ? '%' : '点')
    let currentZoneDef = $derived(ZONE_MAP.get(refZoneId as ZoneId) ?? null)

    /** @desc 新建 Buff 块：先创建（默认名），选中后自动聚焦名称编辑框供用户填写 */
    function handleCreateBuffSet() {
        const newId = createBuffSet('未命名BUFF块')
        if (!newId) return
        selectedBuffSetId = newId
        // 等 DOM 更新后聚焦并全选名称，方便直接输入覆盖
        requestAnimationFrame(() => {
            renameInputEl?.focus()
            renameInputEl?.select()
        })
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
        const folder = groupedBuffSets.find(
            (item) => item.type === 'folder' && folderMembersOf(item).some((c) => c.id === selectedBuffSetId)
        )
        if (folder) {
            const nums = folderMembersOf(folder)
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
        const digits = [...selectedBuffSet.name.matchAll(/\d+/g)]
        if (digits.length === 0) {
            const newId = duplicateBuffSet(selectedBuffSetId)
            if (newId) selectedBuffSetId = newId
            return
        }
        copyOptions = [
            selectedBuffSet.name + ' （复制）',
            ...digits.map((m) => {
                const inc = String(parseInt(m[0]) + 1).padStart(m[0].length, '0')
                return (
                    selectedBuffSet.name.slice(0, m.index) +
                    inc +
                    selectedBuffSet.name.slice((m.index ?? 0) + m[0].length)
                )
            })
        ]
        showCopyOptions = true
    }

    /** @desc 确认复制（选中新块） */
    function confirmCopyBuff(name: string) {
        if (!selectedBuffSetId) return
        const newId = duplicateBuffSet(selectedBuffSetId, name)
        if (newId) selectedBuffSetId = newId
        showCopyOptions = false
    }

    /** @desc 名称编辑保存（Enter/失焦触发；空名兜底） */
    function handleRenameInline() {
        if (!selectedBuffSetId) return
        renameBuffSet(selectedBuffSetId, renameValue.trim() || '未命名BUFF块')
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

    /** @desc 清除全部生效条件 */
    function clearCondition() {
        if (!selectedBuffSetId) return
        setBuffSetCondition(selectedBuffSetId, null)
        setBuffSetConditionRef(selectedBuffSetId, null)
        condPanelOpen = false
    }

    /** @desc 生效条件摘要文案（仅链/阶：它们是整个 BUFF 的硬性条件；属性/类型挂在乘区上） */
    const conditionSummary = $derived.by(() => {
        const cond = selectedBuffSet?.condition
        if (!cond) return ''
        const parts: string[] = []
        const refIdx = selectedBuffSet?.conditionRefCharIdx ?? 0
        const name = team[refIdx]?.character ?? `角色 ${refIdx + 1}`
        const chainMin = cond.chains?.[0]?.min ?? cond.chain
        const refineMin = cond.refinements?.[0]?.min ?? cond.refinement
        // 链 = 角色共鸣链：0 链 = 未点共鸣链的角色本体；阶 = 武器精炼阶数，一律按 ≥N 阶描述
        if (chainMin !== undefined) parts.push(chainMin > 0 ? `${name} ≥${chainMin}链` : `${name}本体`)
        else if (refineMin !== undefined) parts.push(`${name}的武器 ≥${refineMin}阶`)
        return parts.join('，')
    })

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
        const cond = selectedBuffSet.condition ?? {}
        const clearing = currentChain === min
        const next: BuffCondition = {
            ...cond,
            chain: undefined,
            chains: clearing ? undefined : [{ charIdx: condRefIdx, min }],
            ...(clearing ? {} : { refinement: undefined, refinements: undefined })
        }
        setBuffSetCondition(selectedBuffSetId, next)
        if (!clearing) ensureConditionRef()
    }

    /** @desc 设置阶门槛（再次点击取消）；设置阶会清空全部链条件 */
    function setBuffRefinement(min: number) {
        if (!selectedBuffSetId || !selectedBuffSet) return
        if (isDefaultGlobalBuff()) return
        const cond = selectedBuffSet.condition ?? {}
        const clearing = currentRefine === min
        const next: BuffCondition = {
            ...cond,
            refinement: undefined,
            refinements: clearing ? undefined : [{ charIdx: condRefIdx, min }],
            ...(clearing ? {} : { chain: undefined, chains: undefined })
        }
        setBuffSetCondition(selectedBuffSetId, next)
        if (!clearing) ensureConditionRef()
    }

    /**
     * @desc 链/阶档位按钮提示：当前档位说明「再次点击取消」，另一类已设置时说明「链阶互斥、点击替换」。
     * 链 = 角色共鸣链（0 链 = 角色本体）；阶 = 武器精炼阶数（0-5 一律按数字展示）。
     */
    const gateOptionTitle = (kind: 'chain' | 'refinement', n: number): string => {
        const label = kind === 'chain' ? (n === 0 ? '本体（0链）' : `${n}链`) : `${n}阶`
        const selected = kind === 'chain' ? currentChain === n : currentRefine === n
        if (selected) return `≥${label}：再次点击取消`
        const conflict = kind === 'chain' ? currentRefine !== undefined : currentChain !== undefined
        if (!conflict) return `≥${label}`
        return kind === 'chain'
            ? '已设置阶条件：链与阶只能生效其一，点击会替换为链条件'
            : '已设置链条件：链与阶只能生效其一，点击会替换为阶条件'
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
        const next: BuffCondition = { ...cond }
        if (cond.chains?.length) next.chains = cond.chains.map(() => ({ charIdx: i, min: cond.chains![0].min }))
        if (cond.refinements?.length) {
            next.refinements = cond.refinements.map(() => ({ charIdx: i, min: cond.refinements![0].min }))
        }
        setBuffSetCondition(selectedBuffSetId, next)
    }

    /**
     * @desc 打开引用配置弹窗（按**下标**定位乘区，同一乘区可添加多次）：
     * 有现成引用则回填各字段，否则按当前乘区初始化（同目标时自动换一个可引用属性）。
     */
    function openRefModal(zoneIndex: number) {
        const zone = selectedZones[zoneIndex]
        if (!zone) return
        refZoneIndex = zoneIndex
        showRefZoneMenu = false
        if (zone.ref) {
            refCharacterIdx = zone.ref.characterIdx
            refTargetZoneId = zone.ref.zoneId
            refThreshold = zone.ref.threshold
            refLower = zone.ref.lower
            refUpper = zone.ref.upper
            const s = simplifyPct(zone.ref.pct)
            refDivisor = zone.ref.divisor ?? s.divisor
            refMultiplier = zone.ref.multiplier ?? s.multiplier
            refIsDiscrete = zone.ref.discrete ?? false
            refHasThreshold = true
            refHasLower = zone.ref.lower !== undefined
            refHasUpper = zone.ref.upper !== undefined
        } else {
            refCharacterIdx = 0
            refTargetZoneId = zone.zoneId
            refThreshold = 0
            refLower = undefined
            refUpper = undefined
            refDivisor = 10
            refMultiplier = 0
            refIsDiscrete = false
            refHasThreshold = true
            refHasLower = false
            refHasUpper = false
        }
        if (refTargetZoneId === zone.zoneId) {
            const fallback = ZONE_REF_DEFS.find((d) => d.id !== zone.zoneId)
            refTargetZoneId = fallback?.id ?? ''
        }
        showRefModal = true
    }

    /** @desc 确认引用：由 除数/乘数 反算百分比并写入 */
    function handleConfirmRef() {
        if (!selectedBuffSetId) return
        const pct = refDivisor !== 0 ? (refMultiplier / refDivisor) * 100 : 0
        const ref: ZoneRef = {
            characterIdx: refCharacterIdx,
            zoneId: refTargetZoneId as any,
            threshold: refHasThreshold ? refThreshold : 0,
            pct,
            lower: refHasLower && refLower !== undefined && !isNaN(refLower) ? refLower : undefined,
            upper: refHasUpper && refUpper !== undefined && !isNaN(refUpper) ? refUpper : undefined,
            discrete: refIsDiscrete,
            divisor: refDivisor,
            multiplier: refMultiplier
        }
        setZoneRefAt(selectedBuffSetId, refZoneIndex, ref)
        showRefModal = false
    }

    /** @desc 清除引用 */
    function handleClearRef() {
        if (!selectedBuffSetId) return
        setZoneRefAt(selectedBuffSetId, refZoneIndex, null)
        showRefModal = false
    }

    /** @desc 折叠/展开叠层文件夹 */
    function toggleFolder(prefix: string) {
        const next = new Set(collapsedFolders)
        if (next.has(prefix)) {
            next.delete(prefix)
        } else {
            next.add(prefix)
        }
        collapsedFolders = next
    }

    /** @desc 列表滚动容器（拖拽的行序列与落点都从它里面读） */
    const listContainerOf = (el: EventTarget | null): HTMLElement | null =>
        (el as HTMLElement | null)?.closest('.buff-list-container') ?? null

    /**
     * @desc 某个父容器的**直接行**元素（DOM 顺序）。
     * 行用 `data-drag-parent` 标注自己属于哪个容器，落点只在同一容器内计算 ——
     * 目录顺序由名字/条件派生，跨容器搬行没有意义（渲染时会被重新归档）。
     */
    const parentRowsOf = (container: HTMLElement, parentKey: string): HTMLElement[] => [
        ...container.querySelectorAll<HTMLElement>(`[data-buffset-id][data-drag-parent="${parentKey}"]`)
    ]

    /** @desc 父容器行 id 序列（DOM 顺序，可能含正在搬运的行 —— 落点计算内部会剔除它们） */
    const parentRowIdsOf = (container: HTMLElement, parentKey: string): string[] =>
        parentRowsOf(container, parentKey)
            .map((row) => row.dataset.buffsetId ?? '')
            .filter((id) => id.length > 0)

    /** @desc 拖动进入 AI 悬浮窗等"禁区"时取消拖拽（不触发 drop 的删除/重排/确认弹窗） */
    function cancelBuffDrag() {
        if (!dragState) return
        dragState = null
        if (savedCollapsedState !== null) {
            collapsedFolders = savedCollapsedState
            savedCollapsedState = null
        }
    }

    /**
     * @desc 被拖动元素所在**目录链**（自身 + 全部祖先目录）的折叠 key。
     * 拖动时会收起所有目录，但这条链必须保持展开 —— 否则组内重排的行不在 DOM 里，落点算不出来。
     */
    const dragKeepExpanded = (el: HTMLElement, container: HTMLElement): Set<string> => {
        const keys = new Set<string>()
        let node: HTMLElement | null = el
        while (node && node !== container) {
            const key = node.dataset?.folderCollapseKey
            if (key) keys.add(key)
            node = node.parentElement
        }
        return keys
    }

    /**
     * @desc 开始拖拽（仅从拖拽把手 `.drag-handle` 起手）。
     * `id` 是拖拽单元：item=Buff id；folder=数字目录的分组 key。`memberIds` 由目录头按**数据**给出
     * （整组成员），因此目录处于折叠状态时也能整组搬/整组删。
     */
    function startDrag(e: PointerEvent, id: string, mode: BuffDragMode, parentKey: string, memberIds?: string[]) {
        if ((e.target as HTMLElement).closest('input')) return
        if (!(e.target as HTMLElement).closest('.drag-handle')) return
        const el = e.currentTarget as HTMLElement
        const container = listContainerOf(el)
        if (!container) return
        const unitIds = mode === 'folder' ? [...(memberIds ?? [])] : [id]
        if (unitIds.length === 0) return
        el.setPointerCapture(e.pointerId)
        savedCollapsedState = new Set(collapsedFolders)
        // 拖动时**收起所有目录**：列表变短、落点更清晰；被拖动单元所在目录链保持展开
        const keep = dragKeepExpanded(el, container)
        collapsedFolders = new Set(buffTree.folderKeys.filter((key) => !keep.has(key)))
        const idx = dragBlockIndex(parentRowIdsOf(container, parentKey), unitIds)
        dragState = {
            id,
            mode,
            parentKey,
            unitIds,
            idx,
            dropIdx: idx,
            outside: false,
            dropBeforeId: null,
            dropAfterId: null
        }
    }

    /** @desc 拖拽移动：超出容器边缘 30px 判定为「拖出」（删除/删目录），否则按同一父容器内行的中心线算落点 */
    function onDragMove(e: PointerEvent) {
        if (!dragState) return
        const container = listContainerOf(e.currentTarget)
        if (!container) return

        const cr = container.getBoundingClientRect()
        const margin = 30
        const outside =
            e.clientX < cr.left - margin ||
            e.clientX > cr.right + margin ||
            e.clientY < cr.top - margin ||
            e.clientY > cr.bottom + margin

        if (outside) {
            dragState = { ...dragState, outside: true, dropIdx: -1, dropBeforeId: null, dropAfterId: null }
            return
        }

        const rows = parentRowsOf(container, dragState.parentKey).filter(
            (row) => !dragState!.unitIds.includes(row.dataset.buffsetId ?? '')
        )
        let dropIdx = rows.length
        let dropBeforeId: string | null = null
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i].getBoundingClientRect()
            if (e.clientY < r.top + r.height / 2) {
                dropIdx = i
                dropBeforeId = rows[i].dataset.buffsetId ?? null
                break
            }
        }
        // 落在最后一行下方（或容器没有可作锚点的行）时，指示条画在最后一个锚点行下方
        const dropAfterId =
            dropBeforeId === null && rows.length > 0 ? (rows[rows.length - 1].dataset.buffsetId ?? null) : null
        dragState = { ...dragState, outside: false, dropIdx, dropBeforeId, dropAfterId }
    }

    /** @desc 拖拽结束：拖出→删除（目录弹确认）；拖入→同父重排；原地未动→选中 */
    function onDragEnd(e: PointerEvent) {
        if (!dragState) return
        const state = dragState

        if (state.outside) {
            if (state.mode === 'folder') {
                // 全局 buff 不可删（deleteBuffSets 会跳过），这里先剔除，避免弹出「删除 0 条」的确认框
                deleteFolderMemberIds = state.unitIds.filter((id) => !globalBuffSetIds.includes(id))
                if (deleteFolderMemberIds.length > 0) {
                    if (getConfirmDeletes()) {
                        showDeleteFolderConfirm = true
                    } else {
                        confirmDeleteFolder()
                    }
                }
            } else {
                deleteBuffSet(state.id)
                if (selectedBuffSetId === state.id) selectedBuffSetId = null
            }
        } else if (state.mode === 'folder' || state.dropIdx !== state.idx) {
            const container = listContainerOf(e.currentTarget)
            if (container) {
                const next = computeDraggedOrder({
                    // 顺序真源取整份列表（含全局，保证锚点都能找到）；reorderNonGlobalBuffSets 只应用非全局部分
                    orderedIds: buffSets.map((bs) => bs.id),
                    parentRowIds: parentRowIdsOf(container, state.parentKey),
                    unitIds: state.unitIds,
                    dropIdx: state.dropIdx
                })
                if (next) reorderNonGlobalBuffSets(next)
            }
        } else {
            selectedBuffSetId = state.id
        }

        if (savedCollapsedState !== null) {
            collapsedFolders = savedCollapsedState
            savedCollapsedState = null
        }
        dragState = null
    }

    /** @desc 确认删除目录（拖出列表松手触发）：删除其全部子 Buff（全局 buff 由 store 跳过）并清空选中 */
    function confirmDeleteFolder() {
        const ids = deleteFolderMemberIds
        if (ids.length > 0) {
            deleteBuffSets(ids)
            if (selectedBuffSetId && ids.includes(selectedBuffSetId)) selectedBuffSetId = null
        }
        showDeleteFolderConfirm = false
        deleteFolderMemberIds = []
    }

    /** @desc 打开文件夹右键菜单（点击⋯按钮或右键文件夹头均走这里） */
    function openFolderMenu(e: MouseEvent, folder: GroupedBuffSetItem) {
        e.preventDefault()
        e.stopPropagation()
        folderMenuTarget = folder
        folderMenuX = e.clientX
        folderMenuY = e.clientY
        folderMenuOpen = true
    }

    /** @desc 文件夹右键菜单项：重命名 / 并入或移出全局 */
    let folderMenuItems = $derived.by(() => {
        const folder = folderMenuTarget
        if (!folder) return []
        const children = folderMembersOf(folder).map((c) => c.id)
        const hasGlobal = children.some((id) => globalBuffSetIds.includes(id))
        const items: { label: string; action: () => void; icon: string }[] = [
            { label: '批量重命名', icon: 'mdi:rename-box', action: () => openFolderRename(folder) }
        ]
        if (hasGlobal) {
            items.push({
                label: '整体移出全局',
                icon: 'mdi:minus-circle-outline',
                action: () => moveFolderOutOfGlobal(folder)
            })
        } else {
            items.push({ label: '整体并入全局', icon: 'mdi:crown-outline', action: () => moveFolderToGlobal(folder) })
        }
        return items
    })

    /** @desc 打开文件夹批量重命名弹窗：按「新前缀 + 序号 + 新后缀」重新编号全部子 Buff */
    function openFolderRename(folder: GroupedBuffSetItem) {
        folderRenameTarget = folder
        folderRenamePrefix = folder.prefixText ?? ''
        folderRenameSuffix = folder.suffixText ?? ''
        showFolderRename = true
    }

    /** @desc 打开单个 buff 右键菜单（普通/全局/多选状态统一入口） */
    function openItemMenu(e: MouseEvent, id: string) {
        e.preventDefault()
        e.stopPropagation()
        // 多选状态：右键目标不在选中集合且可勾选时，将选中集合重置为该目标（菜单针对当前集合）
        if (multiSelect && !isMultiSelectDisabled(id) && !multiSelectedIds.has(id)) {
            multiSelectedIds = new Set([id])
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
            const count = multiSelectedIds.size
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
                    renameValue = bs.name
                    requestAnimationFrame(() => {
                        renameInputEl?.focus()
                        renameInputEl?.select()
                    })
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

    /** @desc 文件夹整体并入全局（所有子 Buff 一次性移入） */
    function moveFolderToGlobal(folder: GroupedBuffSetItem) {
        const ids = folderMembersOf(folder).map((c) => c.id)
        if (ids.length === 0) return
        setBuffSetsGlobal(ids, true)
        addToast(`已将「${folder.name}」的 ${ids.length} 条 BUFF 并入全局`, 'success')
    }

    /** @desc 文件夹整体移出全局（所有子 Buff 一次性移出） */
    function moveFolderOutOfGlobal(folder: GroupedBuffSetItem) {
        const ids = folderMembersOf(folder).map((c) => c.id)
        if (ids.length === 0) return
        setBuffSetsGlobal(ids, false)
        addToast(`已将「${folder.name}」的 ${ids.length} 条 BUFF 移出全局`, 'info')
    }

    /** @desc 确认文件夹批量重命名：子 Buff 依次命名为 新前缀+1..N+新后缀 */
    function confirmFolderRename() {
        const folder = folderRenameTarget
        if (!folder) return
        const members = folderMembersOf(folder)
        if (members.length === 0) return
        const prefix = folderRenamePrefix.trim()
        const suffix = folderRenameSuffix.trim()
        if (!prefix && !suffix) {
            addToast('前缀与后缀不能同时为空', 'error')
            return
        }
        members.forEach((child, i) => {
            renameBuffSet(child.id, `${prefix}${i + 1}${suffix}`)
        })
        addToast(`已批量重命名 ${members.length} 条 BUFF`, 'success')
        showFolderRename = false
        folderRenameTarget = null
    }

    /** @desc 进入/退出多选模式：清空勾选，关闭文件夹菜单，取消拖拽状态 */
    function toggleMultiSelect() {
        multiSelect = !multiSelect
        multiSelectedIds = new Set()
        folderMenuOpen = false
        folderMenuTarget = null
        itemMenuOpen = false
        itemMenuTargetId = null
        dragState = null
        collapsedFolders = savedCollapsedState ?? collapsedFolders
        savedCollapsedState = null
    }

    /** @desc 多选模式下不可勾选的 buff：内置默认全局块（global- 前缀）既不能删除也不能移出全局 */
    function isMultiSelectDisabled(id: string): boolean {
        return id.startsWith('global-')
    }

    /** @desc 多选模式切换单个 buff 勾选（内置全局块不可勾选） */
    function toggleMultiSelectId(id: string) {
        if (isMultiSelectDisabled(id)) return
        const next = new Set(multiSelectedIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        multiSelectedIds = next
    }

    /** @desc 多选模式切换整个文件夹勾选（传入目录的全部子 buff；内置全局块跳过） */
    function toggleMultiSelectFolder(members: BuffSet[]) {
        const childIds = members.map((c) => c.id).filter((id) => !isMultiSelectDisabled(id))
        if (childIds.length === 0) return
        const next = new Set(multiSelectedIds)
        const allSelected = childIds.every((id) => next.has(id))
        for (const id of childIds) {
            if (allSelected) next.delete(id)
            else next.add(id)
        }
        multiSelectedIds = next
    }

    /** @desc 多选模式是否全选（可勾选条目全部选中） */
    function isAllMultiSelected(): boolean {
        const selectable = selectableMultiIds()
        return selectable.length > 0 && selectable.every((id) => multiSelectedIds.has(id))
    }

    /** @desc 多选模式全选/清空 */
    function toggleSelectAll() {
        multiSelectedIds = isAllMultiSelected() ? new Set() : new Set(selectableMultiIds())
    }

    /** @desc 可勾选的全部 buff id 列表（内置全局块不可操作，排除；全局+非全局其余均可勾选） */
    function selectableMultiIds(): string[] {
        return buffSets.map((bs) => bs.id).filter((id) => !isMultiSelectDisabled(id))
    }

    /** @desc 已选是否全部为非全局（满足「批量并入全局」条件） */
    function multiSelectionAllNonGlobal(): boolean {
        return multiSelectedIds.size > 0 && [...multiSelectedIds].every((id) => !globalBuffSetIds.includes(id))
    }

    /** @desc 已选是否全部为全局（满足「批量移出全局」条件） */
    function multiSelectionAllGlobal(): boolean {
        return multiSelectedIds.size > 0 && [...multiSelectedIds].every((id) => globalBuffSetIds.includes(id))
    }

    /** @desc 文件夹在多选下是否全选：不可勾选的子项视为已选（保持全选语义） */
    function folderAllSelected(children: BuffSet[]): boolean {
        const selectable = children.map((c) => c.id).filter((id) => !isMultiSelectDisabled(id))
        return selectable.length > 0 && selectable.every((id) => multiSelectedIds.has(id))
    }

    /** @desc 多选批量删除（确认后） */
    function confirmMultiDelete() {
        const ids = [...multiSelectedIds]
        if (ids.length === 0) return
        deleteBuffSets(ids)
        addToast(`已删除 ${ids.length} 条 BUFF`, 'success')
        multiSelectedIds = new Set()
        showMultiDeleteConfirm = false
        if (selectedBuffSetId && ids.includes(selectedBuffSetId)) selectedBuffSetId = null
    }

    /** @desc 请求多选批量删除：关闭二次确认时直接删除，否则弹出确认 */
    function requestMultiDelete() {
        if (multiSelectedIds.size === 0) return
        if (getConfirmDeletes()) {
            showMultiDeleteConfirm = true
        } else {
            confirmMultiDelete()
        }
    }

    /** @desc 多选排序：可排序的已选数量（非全局、且 ≥2 才有意义） */
    function sortableCount(): number {
        return [...multiSelectedIds].filter((id) => !globalBuffSetIds.includes(id)).length
    }

    /**
     * @desc 按名称排序已选 BUFF：连续数字按数值大小、其它字符按 unicode（`compareNatural`）。
     * 只重排「已选中的那些位置」，未选项与其位置保持不变。
     */
    function sortMultiSelected() {
        const ids = [...multiSelectedIds].filter((id) => !globalBuffSetIds.includes(id))
        if (ids.length < 2) return
        const order = buffSets.filter((b) => !globalBuffSetIds.includes(b.id)).map((b) => b.id)
        const slots: number[] = []
        order.forEach((id, i) => {
            if (multiSelectedIds.has(id)) slots.push(i)
        })
        const nameById = new Map(buffSets.map((b) => [b.id, b.name]))
        const sorted = order
            .filter((id) => multiSelectedIds.has(id))
            .sort((a, b) => compareNatural(nameById.get(a) ?? '', nameById.get(b) ?? ''))
        const next = [...order]
        slots.forEach((slot, k) => {
            next[slot] = sorted[k]
        })
        reorderNonGlobalBuffSets(next)
        addToast(`已按名称排序 ${sorted.length} 个 BUFF`, 'success')
    }

    /** @desc 多选批量并入全局 */
    function multiSetGlobal(global: boolean) {
        const ids = [...multiSelectedIds]
        if (ids.length === 0) return
        if (setBuffSetsGlobal(ids, global)) {
            addToast(global ? `已并入全局 ${ids.length} 条 BUFF` : `已移出全局 ${ids.length} 条 BUFF`, 'success')
            multiSelectedIds = new Set()
        }
    }

    let teamNames = $derived(team.map((s) => s.character ?? '?'))
    /** @desc 非全局容器（角色链 / 武器目录）下未被数字归并的散条目（数字目录由上面的 folders 分支渲染） */
    const looseChildrenOf = (children: BuffSet[] | undefined): BuffSet[] =>
        groupBuffSets(children ?? [])
            .filter((x) => x.type !== 'folder')
            .map((x) => x.buffSet!)
    /** @desc 非全局容器下的数字目录（含成员），恒排在散条目前面 */
    const foldersOf = (children: BuffSet[] | undefined): GroupedBuffSetItem[] =>
        groupBuffSets(children ?? []).filter((x) => x.type === 'folder')

    /**
     * @desc 最低一层 buff 条目的统一图标（全局目录内 / 链武器目录内 / 数字目录内 / 顶层散条目一致）：
     * 未收藏 = 灰色空心星，已收藏 = 黄色实心星；多选态的勾选框不受影响。
     */
    const buffItemIcon = (starred: boolean | undefined): string => (starred ? 'mdi:star' : 'mdi:star-outline')
    const buffItemIconClass = (starred: boolean | undefined, draggable = false): string =>
        [
            'size-4 shrink-0',
            starred ? 'text-amber-400' : 'text-(--theme-modal-text)/35',
            draggable ? 'drag-handle touch-none select-none cursor-grab active:cursor-grabbing' : ''
        ]
            .filter(Boolean)
            .join(' ')

    /** @desc 条目是否在「全局 Buff」目录里（全局 buff 顺序不走非全局重排，因此不参与拖拽） */
    const isGlobalBuff = (id: string): boolean => globalBuffSetIds.includes(id)

    /**
     * @desc 条目作用域徽标（名称右侧）：
     * - 全队 → 只出一个「全队」，主题色实心
     * - 效应专属（scope 空数组）→ 主题色空心
     * - 指定角色（1~2 个槽位）→ 逐个出角色名，用该角色属性色做空心 + 半透明底
     * 三个角色都能吃到时归类为「全队」，不再逐个列角色名（口径见 classifyBuffScope）。
     */
    const scopeBadgesOf = (bs: BuffSet): { key: string; label: string; style: string }[] => {
        const cls = classifyBuffScope(bs.scope, team.length)
        if (cls.kind === 'all') {
            return [
                {
                    key: 'all',
                    label: '全队',
                    style: 'border-color: transparent; background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);'
                }
            ]
        }
        if (cls.kind === 'effect') {
            return [
                {
                    key: 'effect',
                    label: '效应专属',
                    style: 'border-color: var(--theme-accent-bg); background: transparent; color: var(--theme-accent-text);'
                }
            ]
        }
        return cls.idxs.map((idx) => {
            const name = team[idx]?.character ?? `角色${idx + 1}`
            const color = elementColor(name)
            return {
                key: `char-${idx}`,
                label: name,
                style: `border-color: ${color}; background: color-mix(in srgb, ${color} 15%, transparent); color: ${color};`
            }
        })
    }

    /** @desc 数字目录（三级）的折叠 key：按所属容器分区，避免不同容器下的同名目录互相影响 */
    const layeredKeyOf = (containerKey: string, prefix: string | undefined): string => `${containerKey}/${prefix}`

    /**
     * @desc 目录下的全部成员 Buff（数字目录直接取 children；
     * 「全局 Buff」目录还要并入二级子目录的成员，否则批量操作会漏掉它们；
     * 二级子目录自身的数字子目录（`children`）也一并并入）
     */
    const folderMembersOf = (folder: GroupedBuffSetItem): BuffSet[] => [
        ...(folder.children ?? []),
        ...((folder as BuffTreeNode).gateChildren ?? []).flatMap((gate) => folderMembersOf(gate))
    ]
    /**
     * @desc 目录（含**嵌套子目录**）内是否存在收藏条目。
     * 数字目录只会出现在 `children` 里（界面就地派生，不是独立节点），
     * 而二级目录走 `gateChildren`，所以这里按节点递归即可覆盖全部层级。
     */
    const folderHasStar = (folder: GroupedBuffSetItem): boolean =>
        (folder.children ?? []).some((c) => c.starred) ||
        ((folder as BuffTreeNode).gateChildren ?? []).some((g) => folderHasStar(g))
    /** @desc 普通目录图标配色：内部有收藏条目才标黄，否则灰色（特殊图标目录——链/武器头像——不受影响） */
    const folderIconClass = (folder: GroupedBuffSetItem, base: string): string =>
        folderHasStar(folder) ? `${base} text-amber-400` : `${base} opacity-60`
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
    /** @desc 武器图标表（按需加载，失败静默；角色详情/队伍配置共用同一份数据） */
    let weaponIcons = $state<Record<string, string>>({})
    $effect(() => {
        void getWeaponIcons().then((map) => (weaponIcons = map))
    })
</script>

<!-- @desc BUFF 配置弹窗根容器：遮罩 + 主卡片（标题栏/左侧列表/右侧编辑器/底部保存） -->
{#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5)); {styleProp || ''}"
        class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm {className}"
        onkeydown={(e) => e.key === 'Escape' && onclose()}
    >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            data-sf="modal"
            class="animate-pop-in w-full max-h-[95vh] h-full rounded-none border text-(--theme-modal-text) shadow-2xl overflow-hidden flex flex-col my-4"
            style="border-color: var(--theme-divider-border); width: min(1180px, calc(100vw - 2rem)); max-width: 100%;"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
        >
            <!-- @desc 标题栏：BUFF 配置 + 导入Buff集/速查入口 -->
            <div
                class="flex items-center justify-between border-b px-5 pb-2.5 pt-3"
                style="border-bottom: 1px solid var(--theme-divider-border);"
            >
                <h2 class="flex items-center gap-2 text-base font-black tracking-tight">
                    <Icon icon="mdi:widgets" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
                    BUFF 配置
                </h2>
                <div class="flex items-center gap-1">
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
            </div>

            <div class="flex flex-1 overflow-hidden">
                <!-- Left column: block list -->
                <div
                    class="shrink-0 border-r flex flex-col"
                    style="width: {leftWidth}px; border-right: 1px solid var(--theme-divider-border);"
                >
                    <!-- @desc 左侧列表：叠层文件夹（可折叠/整体拖拽）+ 独立 buff
                    块（可拖拽/拖出删除），插入位置显示指示条。
                    容器不设 padding：sticky 头的 top-0 吸附位 = 容器顶，贴顶时无缝隙；
                    四周留白由子元素（块 px-2 / item mx-2 / 首末 mt-2 mb-2）承担 -->
                    <div
                        class="theme-scrollbar flex-1 overflow-y-auto overflow-x-hidden space-y-1 buff-list-container [&>*:first-child]:mt-2 [&>*:last-child]:mb-2"
                    >
                        {#each groupedBuffSets as item (item.key)}
                            {#if item.type === 'folder'}
                                {@const isGlobalFolder = item.folderKind === 'global'}
                                {@const isAutoFolder = item.folderKind === 'char-gate'}
                                {@const folderMembers = folderMembersOf(item)}
                                <!-- 展开的文件夹头在滚动时贴顶吸附（类似表格表头）：实底 + 铺满容器宽度；
                                    吸附范围 = 整个文件夹块（头 + 子项），子项全部滚出后头随块释放。
                                    data-folder-collapse-key：拖动时按目录链判断哪些目录要保持在展开态 -->
                                <div class="px-2" data-folder-collapse-key={item.prefix}>
                                    {#if isAutoFolder}
                                        {@render gateFolderHead(item, 'top-0')}
                                    {:else}
                                        <div
                                            class={[
                                                'flex min-w-0 items-center gap-1',
                                                !collapsedFolders.has(item.prefix!)
                                                    ? 'sticky top-0 z-10 -mx-2 border-b border-(--theme-divider-border) px-2 py-1 bg-(--theme-modal-bg)'
                                                    : ''
                                            ].join(' ')}
                                        >
                                            <button
                                                onclick={() =>
                                                    multiSelect
                                                        ? toggleMultiSelectFolder(folderMembers)
                                                        : toggleFolder(item.prefix!)}
                                                oncontextmenu={multiSelect ? undefined : (e) => openFolderMenu(e, item)}
                                                onpointerdown={isGlobalFolder || multiSelect
                                                    ? undefined
                                                    : (e) =>
                                                          startDrag(
                                                              e,
                                                              item.prefix!,
                                                              'folder',
                                                              item.parentKey,
                                                              folderMembers.map((c) => c.id)
                                                          )}
                                                onpointermove={isGlobalFolder || multiSelect ? undefined : onDragMove}
                                                onpointerup={isGlobalFolder || multiSelect ? undefined : onDragEnd}
                                                class={[
                                                    'flex min-w-0 flex-1 items-center gap-2 rounded-none px-3 py-2 text-xs text-left transition-all',
                                                    multiSelect && !isGlobalFolder && folderAllSelected(folderMembers)
                                                        ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                        : 'text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5',
                                                    !isGlobalFolder &&
                                                        !multiSelect &&
                                                        dragState?.id === item.prefix &&
                                                        !dragState!.outside &&
                                                        'ring-2 ring-(--theme-accent-bg)',
                                                    !isGlobalFolder &&
                                                        !multiSelect &&
                                                        dragState?.id === item.prefix &&
                                                        dragState!.outside &&
                                                        'ring-2 ring-red-500 opacity-50'
                                                ].join(' ')}
                                                transition:slide={{ duration: 200 }}
                                            >
                                                {#if multiSelect && !isGlobalFolder}
                                                    <Icon
                                                        icon={folderAllSelected(folderMembers)
                                                            ? 'mdi:checkbox-marked'
                                                            : 'mdi:checkbox-blank-outline'}
                                                        class="size-4 shrink-0 text-(--theme-accent-text)"
                                                    />
                                                {:else if isGlobalFolder}
                                                    <Icon
                                                        icon="mdi:crown"
                                                        class={folderIconClass(item, 'size-4 shrink-0')}
                                                    />
                                                {:else}
                                                    <!-- 叠层（数字前后缀）目录：可整组拖动 -->
                                                    <Icon
                                                        icon={collapsedFolders.has(item.prefix!)
                                                            ? 'mdi:folder-account-outline'
                                                            : 'mdi:folder-account'}
                                                        class={folderIconClass(
                                                            item,
                                                            'drag-handle touch-none select-none cursor-grab active:cursor-grabbing size-4 shrink-0'
                                                        )}
                                                    />
                                                {/if}
                                                <span class="truncate flex-1">{item.name}</span>
                                            </button>
                                            {#if !multiSelect}
                                                <button
                                                    type="button"
                                                    class="shrink-0 rounded-none p-0.5 text-(--theme-modal-text)/40 transition-colors hover:bg-(--theme-modal-text)/10 hover:text-(--theme-modal-text)"
                                                    title="文件夹操作"
                                                    onclick={(e) => openFolderMenu(e, item)}
                                                    oncontextmenu={(e) => openFolderMenu(e, item)}
                                                >
                                                    <Icon icon="mdi:dots-horizontal" class="size-4" />
                                                </button>
                                            {/if}
                                        </div>
                                    {/if}
                                    {#if !collapsedFolders.has(item.prefix!)}
                                        <div
                                            class="ml-3 mt-1 space-y-1 border-l pl-2"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            {#if isGlobalFolder}
                                                <!-- @desc 全局 Buff 目录内先按链/阶条件分二级目录（与顶层同一套规则），再在每个二级目录内做数字归并 -->
                                                {#each item.gateChildren ?? [] as gate (gate.key)}
                                                    <div class="space-y-1" data-folder-collapse-key={gate.prefix}>
                                                        {@render gateFolderHead(gate, 'top-10')}
                                                        {#if !collapsedFolders.has(gate.prefix!)}
                                                            <div
                                                                class="ml-2 space-y-1 border-l pl-2"
                                                                style="border-color: var(--theme-divider-border);"
                                                            >
                                                                {@render buffContainer(gate.children, gate.prefix!)}
                                                            </div>
                                                        {/if}
                                                    </div>
                                                {/each}
                                                <!-- 无链/阶条件的全局 buff 直接留在全局目录下（数字归并） -->
                                                {@render buffContainer(item.children, item.prefix!)}
                                            {:else if isAutoFolder}
                                                <!-- @desc 非全局容器（角色链 / 武器目录）：先做一级数字前后缀归并（文件夹排在所有条目上方），再挨个列出散条目 -->
                                                {@render buffContainer(item.children, item.prefix!)}
                                            {:else}
                                                <!-- @desc 叠层（数字前后缀）目录：children 本身就是同源条目，直接列出 -->
                                                {#each item.children ?? [] as child (child.id)}
                                                    {@render buffRow(child, item.prefix!, 'px-3 py-1.5')}
                                                {/each}
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                            {:else}
                                {@const isGlobal = isGlobalBuff(item.buffSet!.id)}
                                {@render dropLine(item.buffSet!.id, 'before', 'mx-2')}
                                <button
                                    data-buffset-id={item.buffSet!.id}
                                    data-drag-parent={item.parentKey}
                                    onclick={() => {
                                        if (multiSelect) {
                                            if (!isMultiSelectDisabled(item.buffSet!.id))
                                                toggleMultiSelectId(item.buffSet!.id)
                                        } else {
                                            selectedBuffSetId = item.buffSet!.id
                                        }
                                    }}
                                    oncontextmenu={(e) => openItemMenu(e, item.buffSet!.id)}
                                    onpointerdown={isGlobal || multiSelect
                                        ? undefined
                                        : (e) => startDrag(e, item.buffSet!.id, 'item', item.parentKey)}
                                    onpointermove={isGlobal || multiSelect ? undefined : onDragMove}
                                    onpointerup={isGlobal || multiSelect ? undefined : onDragEnd}
                                    class={[
                                        'mx-2 flex w-full min-w-0 items-center gap-2 rounded-none px-3 py-2 text-xs text-left transition-all',
                                        multiSelect && isMultiSelectDisabled(item.buffSet!.id)
                                            ? 'text-(--theme-modal-text)/30 opacity-50'
                                            : multiSelect
                                              ? multiSelectedIds.has(item.buffSet!.id)
                                                  ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                  : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5'
                                              : selectedBuffSetId === item.buffSet!.id
                                                ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5',
                                        !isGlobal &&
                                            !multiSelect &&
                                            dragState?.id === item.buffSet!.id &&
                                            !dragState.outside &&
                                            'ring-2 ring-(--theme-accent-bg)',
                                        !isGlobal &&
                                            !multiSelect &&
                                            dragState?.id === item.buffSet!.id &&
                                            dragState.outside &&
                                            'ring-2 ring-red-500 opacity-50'
                                    ].join(' ')}
                                    transition:slide={{ duration: 200 }}
                                >
                                    {#if multiSelect}
                                        <Icon
                                            icon={isMultiSelectDisabled(item.buffSet!.id)
                                                ? 'mdi:checkbox-blank-off-outline'
                                                : multiSelectedIds.has(item.buffSet!.id)
                                                  ? 'mdi:checkbox-marked'
                                                  : 'mdi:checkbox-blank-outline'}
                                            class="size-4 shrink-0 text-(--theme-accent-text)"
                                        />
                                    {:else}
                                        <Icon
                                            icon={buffItemIcon(item.buffSet!.starred)}
                                            class={buffItemIconClass(item.buffSet!.starred, !isGlobal)}
                                        />
                                    {/if}
                                    <span class="truncate flex-1">{item.buffSet!.name}</span>
                                    {@render scopeBadges(item.buffSet!)}
                                </button>
                                {@render dropLine(item.buffSet!.id, 'after', 'mx-2')}
                            {/if}
                        {/each}
                        {#if buffSets.length === 0}
                            <div class="text-xs text-(--theme-modal-text)/30 text-center py-4">暂无 BUFF 块</div>
                        {/if}
                    </div>
                    <!-- @desc 底部操作栏：单排多选工具栏（多选开关 + 全选 + 批量操作），窄宽度时按钮文本压缩为仅图标；再往下是新建栏 -->
                    <div
                        class="shrink-0 border-t p-2 flex flex-col gap-1.5"
                        style="border-top: 1px solid var(--theme-divider-border);"
                    >
                        <div class="flex items-center gap-1">
                            <button
                                type="button"
                                onclick={toggleMultiSelect}
                                class={[
                                    'flex items-center gap-1 rounded-none px-2 py-1 text-[11px] font-medium transition-colors',
                                    multiSelect
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                                        : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/5'
                                ].join(' ')}
                                title={multiSelect ? '退出多选' : '进入多选'}
                            >
                                <Icon
                                    icon={multiSelect ? 'mdi:check-decagram' : 'mdi:checkbox-multiple-marked-outline'}
                                    class="size-3.5"
                                />
                                {#if leftWidth >= 280}<span>多选</span>{/if}
                            </button>
                            {#if multiSelect}
                                <button
                                    type="button"
                                    onclick={toggleSelectAll}
                                    class="flex items-center gap-1 rounded-none px-2 py-1 text-[11px] text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/5"
                                    title={isAllMultiSelected() ? '取消全选' : '全选'}
                                >
                                    <Icon
                                        icon={isAllMultiSelected()
                                            ? 'mdi:checkbox-multiple-blank-outline'
                                            : 'mdi:select-all'}
                                        class="size-3.5"
                                    />
                                    {#if leftWidth >= 280}
                                        <span>{isAllMultiSelected() ? '取消全选' : '全选'}</span>
                                    {/if}
                                </button>
                                {#if multiSelectedIds.size > 0}
                                    <button
                                        type="button"
                                        disabled={sortableCount() < 2}
                                        onclick={sortMultiSelected}
                                        class={[
                                            'flex items-center gap-1 rounded-none px-2 py-1 text-[11px] transition-colors',
                                            sortableCount() >= 2
                                                ? 'text-(--theme-accent-text) hover:bg-(--theme-accent-bg)/10'
                                                : 'text-(--theme-modal-text)/25 cursor-not-allowed'
                                        ].join(' ')}
                                        title="按名称排序已选 BUFF（连续数字按数值大小，其它字符按 unicode；只重排已选项，位置不变）"
                                    >
                                        <Icon icon="mdi:sort-alphabetical-ascending" class="size-3.5" />
                                        {#if leftWidth >= 360}<span>按名称排序</span>{/if}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!multiSelectionAllNonGlobal()}
                                        onclick={() => multiSetGlobal(true)}
                                        class={[
                                            'flex items-center gap-1 rounded-none px-2 py-1 text-[11px] transition-colors',
                                            multiSelectionAllNonGlobal()
                                                ? 'text-(--theme-accent-text) hover:bg-(--theme-accent-bg)/10'
                                                : 'text-(--theme-modal-text)/25 cursor-not-allowed'
                                        ].join(' ')}
                                        title={multiSelectionAllNonGlobal() ? '并入全局' : '仅选中非全局 BUFF 时可并入'}
                                    >
                                        <Icon icon="mdi:crown-outline" class="size-3.5" />
                                        {#if leftWidth >= 360}<span>并入全局</span>{/if}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!multiSelectionAllGlobal()}
                                        onclick={() => multiSetGlobal(false)}
                                        class={[
                                            'flex items-center gap-1 rounded-none px-2 py-1 text-[11px] transition-colors',
                                            multiSelectionAllGlobal()
                                                ? 'text-(--theme-accent-text) hover:bg-(--theme-accent-bg)/10'
                                                : 'text-(--theme-modal-text)/25 cursor-not-allowed'
                                        ].join(' ')}
                                        title={multiSelectionAllGlobal() ? '移出全局' : '仅选中全局 BUFF 时可移出'}
                                    >
                                        <Icon icon="mdi:minus-circle-outline" class="size-3.5" />
                                        {#if leftWidth >= 360}<span>移出全局</span>{/if}
                                    </button>
                                    <button
                                        type="button"
                                        onclick={() => requestMultiDelete()}
                                        class="ml-auto flex items-center gap-1 rounded-none px-2 py-1 text-[11px] text-red-400 transition-colors hover:bg-red-500/10"
                                        title="删除"
                                    >
                                        <Icon icon="mdi:delete-outline" class="size-3.5" />
                                        {#if leftWidth >= 280}<span>删除</span>{/if}
                                    </button>
                                {/if}
                            {/if}
                        </div>
                        <div class="flex">
                            <button
                                type="button"
                                onclick={handleCreateBuffSet}
                                class="flex w-full items-center justify-center gap-1 rounded-none border px-2 py-1.5 text-xs font-medium transition-all hover:brightness-125"
                                style="border-color: var(--theme-divider-border); background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                                title="新建 BUFF 块"
                            >
                                <Icon icon="mdi:plus" class="size-3.5" />
                                <span>新建 BUFF</span>
                            </button>
                        </div>
                    </div>
                </div>
                <!-- @desc 左栏宽度调节把手（与主页 sidebar 拖动条一致的三态样式） -->
                <div
                    class="shrink-0 w-1 cursor-col-resize"
                    style="background: {resizingSidebar
                        ? 'var(--theme-accent-bg)'
                        : sidebarDividerHover
                          ? 'color-mix(in srgb, var(--theme-accent-bg) 45%, transparent)'
                          : 'color-mix(in srgb, var(--theme-divider-border) 80%, transparent)'};{resizingSidebar
                        ? ' box-shadow: 0 0 10px color-mix(in srgb, var(--theme-accent-bg) 55%, transparent);'
                        : sidebarDividerHover
                          ? ' box-shadow: 0 0 8px color-mix(in srgb, var(--theme-accent-bg) 30%, transparent);'
                          : ''}"
                    title="拖拽调整宽度"
                    onmouseenter={() => (sidebarDividerHover = true)}
                    onmouseleave={() => (sidebarDividerHover = false)}
                    onmousedown={startSidebarResize}
                ></div>

                <!-- @desc 右列：上（块编辑器 + 乘区清单）下（保存并关闭），sidebar 占满整高 -->
                <div class="flex-1 flex flex-col overflow-hidden">
                    <div class="flex flex-1 overflow-hidden">
                        <!-- @desc 块编辑器（main） -->
                        <div class="flex-1 flex flex-col">
                            {#if selectedBuffSet}
                                {@const isGlobal = globalBuffSetIds.includes(selectedBuffSet.id)}
                                {@const isDefaultGlobal = selectedBuffSet.id.startsWith('global-')}
                                <!-- @desc 选中块头部：收藏/重命名（双击编辑）/复制/并入全局/移出全局/删除（全局块锁定只读） -->
                                <!-- Buff name header -->
                                <div
                                    class="shrink-0 px-3 py-2.5 border-b flex items-center gap-2"
                                    style="border-bottom: 1px solid var(--theme-divider-border);"
                                >
                                    {#if isGlobal}
                                        <button
                                            disabled
                                            class="shrink-0 rounded-none p-1 text-amber-400/40 cursor-not-allowed"
                                        >
                                            <Icon
                                                icon={selectedBuffSet.starred ? 'mdi:star' : 'mdi:star-outline'}
                                                class="size-4"
                                            />
                                        </button>
                                        {#if isDefaultGlobal}
                                            <input
                                                type="text"
                                                value={selectedBuffSet.name}
                                                readonly
                                                class="flex-1 min-w-0 rounded-none border px-2 py-1.5 text-xs font-medium outline-none text-(--theme-modal-text) cursor-default"
                                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                            />
                                        {:else}
                                            <input
                                                type="text"
                                                bind:this={renameInputEl}
                                                bind:value={renameValue}
                                                onkeydown={(e) => e.key === 'Enter' && handleRenameInline()}
                                                onblur={handleRenameInline}
                                                class="flex-1 min-w-0 rounded-none border px-2 py-1.5 text-xs font-medium outline-none text-(--theme-modal-text)"
                                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                            />
                                        {/if}
                                        {#if !isDefaultGlobal}
                                            <button
                                                onclick={handleToggleGlobal}
                                                class="shrink-0 flex items-center gap-1 rounded-none border px-2 py-1.5 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-accent-bg)/10"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                <Icon icon="mdi:crown" class="size-3.5" />
                                                移出全局
                                            </button>
                                        {/if}
                                    {:else}
                                        <button
                                            onclick={() => toggleBuffSetStarred(selectedBuffSet.id)}
                                            class="shrink-0 rounded-none p-1 transition-colors text-amber-400 hover:text-amber-300"
                                        >
                                            <Icon
                                                icon={selectedBuffSet.starred ? 'mdi:star' : 'mdi:star-outline'}
                                                class="size-4"
                                            />
                                        </button>
                                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                                        <input
                                            type="text"
                                            bind:this={renameInputEl}
                                            bind:value={renameValue}
                                            onkeydown={(e) => e.key === 'Enter' && handleRenameInline()}
                                            onblur={handleRenameInline}
                                            class="flex-1 min-w-0 rounded-none border px-2 py-1.5 text-xs font-medium outline-none text-(--theme-modal-text)"
                                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                        />
                                        <button
                                            onclick={handleCopyBuffSet}
                                            class="shrink-0 flex items-center gap-1 rounded-none border px-2 py-1.5 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-accent-bg)/10"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            <Icon icon="mdi:content-copy" class="size-3.5" />
                                            复制
                                        </button>
                                        <button
                                            onclick={handleToggleGlobal}
                                            class="shrink-0 flex items-center gap-1 rounded-none border px-2 py-1.5 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-accent-bg)/10"
                                            style="border-color: var(--theme-divider-border);"
                                            title="并入全局（全局 buff 的受益者将被锁定）"
                                        >
                                            <Icon icon="mdi:crown" class="size-3.5" />
                                            并入全局
                                        </button>
                                        <button
                                            onclick={handleDeleteBuffSet}
                                            class="shrink-0 flex items-center gap-1 rounded-none border border-red-500 px-2 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/20"
                                        >
                                            <Icon icon="mdi:delete-outline" class="size-3.5" />
                                            删除
                                        </button>
                                    {/if}
                                </div>

                                <!-- @desc 作用域区：角色头像勾选（可吃到的角色）+ 效应专属切换（全局块锁定） -->
                                <!-- Character scope -->
                                <div
                                    class="shrink-0 px-3 pt-3 pb-2.5 border-b"
                                    style="border-bottom: 1px solid var(--theme-divider-border);"
                                >
                                    <div class="flex items-center gap-1.5">
                                        <span class="text-xs text-(--theme-modal-text)/50 mr-0.5"
                                            >这些角色可以吃到：</span
                                        >
                                        {#each team as slot, i}
                                            {@const globalDisabled =
                                                selectedBuffSet && globalBuffSetIds.includes(selectedBuffSet.id)}
                                            {@const disabled = globalDisabled || isNonCharBuff}
                                            <button
                                                onclick={() => {
                                                    if (isGlobal) {
                                                        addToast('全局buff无法更改作用域，请先移出全局', 'info')
                                                        return
                                                    }
                                                    if (!disabled) handleToggleChar(i)
                                                }}
                                                class={[
                                                    'size-8 rounded-full overflow-hidden border-2 transition-all',
                                                    scopeChars[i]
                                                        ? 'border-(--theme-accent-bg)'
                                                        : 'border-(--theme-divider-border) grayscale opacity-30',
                                                    isGlobal
                                                        ? 'cursor-not-allowed'
                                                        : disabled
                                                          ? 'pointer-events-none'
                                                          : 'hover:opacity-60'
                                                ].join(' ')}
                                            >
                                                {#if slot.character && charIconMap[slot.character]}
                                                    <img
                                                        src={charIconMap[slot.character]}
                                                        alt={slot.character}
                                                        draggable="false"
                                                        use:fallbackIcon={'/icons/placeholder-character.svg'}
                                                        class="h-full w-full object-cover"
                                                    />
                                                {:else}
                                                    <span
                                                        class="w-full h-full flex items-center justify-center text-[9px] font-medium text-(--theme-modal-text)/50"
                                                        >{slot.character?.charAt(0) ?? '?'}</span
                                                    >
                                                {/if}
                                            </button>
                                        {/each}
                                        <div
                                            class="w-px h-5 mx-1"
                                            style="background: var(--theme-divider-border);"
                                        ></div>
                                        <button
                                            onclick={() => {
                                                if (isGlobal) {
                                                    addToast('全局buff无法更改作用域，请先移出全局', 'info')
                                                    return
                                                }
                                                handleToggleNonChar()
                                            }}
                                            class={[
                                                'flex items-center gap-1 rounded-none border px-2 py-1 text-[11px] font-medium transition-all whitespace-nowrap',
                                                isGlobal ? 'cursor-not-allowed opacity-50' : '',
                                                isNonCharBuff
                                                    ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                    : 'border-transparent text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5'
                                            ].join(' ')}
                                        >
                                            <svg viewBox="0 0 24 24" class="size-3.5 shrink-0">
                                                {#if isNonCharBuff}
                                                    <path d="M7 2v11h3v9l7-12h-4l4-8H7z" fill="currentColor" />
                                                {:else}
                                                    <path
                                                        d="M7 2v11h3v9l7-12h-4l4-8H7z"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="1.5"
                                                        stroke-linejoin="round"
                                                    />
                                                {/if}
                                            </svg>
                                            效应专属
                                        </button>
                                    </div>
                                </div>

                                <!-- @desc 链/阶条件区：折叠面板内左侧参考角色（正方形头像框）、右侧链（0-6）/ 阶（0-5）两行（链阶互斥） -->
                                <!-- 链/阶条件 -->
                                <div
                                    class="shrink-0 border-b"
                                    style="border-bottom: 1px solid var(--theme-divider-border);"
                                >
                                    <button
                                        onclick={toggleCondPanel}
                                        class={[
                                            'flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] transition-colors hover:bg-(--theme-modal-text)/5',
                                            conditionSummary
                                                ? 'text-(--theme-accent-text)'
                                                : 'text-(--theme-modal-text)/60'
                                        ].join(' ')}
                                        title={isDefaultGlobal ? '链/阶条件（默认全局buff不可配置）' : '链/阶条件'}
                                    >
                                        <Icon
                                            icon={condPanelOpen ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                                            class="size-4 shrink-0 text-(--theme-modal-text)/40"
                                        />
                                        <span class="shrink-0 text-xs font-black tracking-tight">链/阶条件</span>
                                        {#if conditionSummary}
                                            <span class="min-w-0 truncate text-[11px]">：{conditionSummary}</span>
                                        {/if}
                                    </button>
                                    {#if condPanelOpen}
                                        <div
                                            transition:slide|local={{ duration: 200 }}
                                            class="flex flex-wrap items-start gap-3 px-3 pb-2.5"
                                        >
                                            <!-- 参考角色：三个正方形头像框（未选降饱和/暗化，选中=主题色描边 + 光晕） -->
                                            <div class="flex flex-col gap-1">
                                                <span class="text-[10px] text-(--theme-modal-text)/50">参考角色</span>
                                                <div class="flex items-center gap-1.5">
                                                    {#each team as slot, i}
                                                        <button
                                                            onclick={() => setConditionRef(i)}
                                                            class={[
                                                                'size-8 shrink-0 overflow-hidden border-2 transition-all',
                                                                condRefIdx === i
                                                                    ? 'border-(--theme-accent-bg)'
                                                                    : 'border-(--theme-divider-border) grayscale opacity-40 hover:opacity-70'
                                                            ].join(' ')}
                                                            style={condRefIdx === i
                                                                ? 'box-shadow: 0 0 8px color-mix(in srgb, var(--theme-accent-bg) 55%, transparent);'
                                                                : ''}
                                                            title={`看 ${slot.character ?? `角色 ${i + 1}`} 的链 / 阶`}
                                                        >
                                                            {#if slot.character && charIconMap[slot.character]}
                                                                <img
                                                                    src={charIconMap[slot.character]}
                                                                    alt={slot.character}
                                                                    draggable="false"
                                                                    use:fallbackIcon={'/icons/placeholder-character.svg'}
                                                                    class="h-full w-full object-cover"
                                                                />
                                                            {:else}
                                                                <span
                                                                    class="w-full h-full flex items-center justify-center text-[9px] font-medium text-(--theme-modal-text)/50"
                                                                    >{slot.character?.charAt(0) ?? '?'}</span
                                                                >
                                                            {/if}
                                                        </button>
                                                    {/each}
                                                </div>
                                            </div>
                                            <!-- 链（上）/ 阶（下）：设置链会清空全部阶，设置阶会清空全部链 -->
                                            <div class="flex flex-col gap-1">
                                                <div class="flex items-center gap-1.5">
                                                    <span
                                                        class="flex h-6 w-4 shrink-0 items-center text-[10px] text-(--theme-modal-text)/60"
                                                        >链</span
                                                    >
                                                    <div
                                                        class="flex overflow-hidden rounded-none border"
                                                        style="border-color: var(--theme-divider-border);"
                                                    >
                                                        {#each Array.from({ length: 7 }, (_, k) => k) as n}
                                                            <button
                                                                onclick={() => setBuffChain(n)}
                                                                title={gateOptionTitle('chain', n)}
                                                                class={[
                                                                    'flex h-6 min-w-6 items-center justify-center px-1 text-[11px] transition-colors',
                                                                    currentChain === n
                                                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                                        : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                                                ].join(' ')}
                                                            >
                                                                {n === 0 ? '本体' : n}
                                                            </button>
                                                        {/each}
                                                    </div>
                                                </div>
                                                <div class="flex items-center gap-1.5">
                                                    <span
                                                        class="flex h-6 w-4 shrink-0 items-center text-[10px] text-(--theme-modal-text)/60"
                                                        >阶</span
                                                    >
                                                    <div
                                                        class="flex overflow-hidden rounded-none border"
                                                        style="border-color: var(--theme-divider-border);"
                                                    >
                                                        {#each Array.from({ length: 6 }, (_, k) => k) as n}
                                                            <button
                                                                onclick={() => setBuffRefinement(n)}
                                                                title={gateOptionTitle('refinement', n)}
                                                                class={[
                                                                    'flex h-6 min-w-6 items-center justify-center px-1 text-[11px] transition-colors',
                                                                    currentRefine === n
                                                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                                        : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                                                ].join(' ')}
                                                            >
                                                                {n}
                                                            </button>
                                                        {/each}
                                                    </div>
                                                </div>
                                            </div>
                                            {#if isDefaultGlobal}
                                                <span class="text-[10px] text-(--theme-modal-text)/35"
                                                    >默认全局buff无法设置链/阶条件</span
                                                >
                                            {/if}
                                        </div>
                                    {/if}
                                </div>

                                <!-- @desc 乘区列表：已配置乘区的数值输入/引用展示/追加覆盖切换/引用配置入口 -->
                                <!-- Zone list -->
                                <div class="theme-scrollbar flex-1 overflow-y-auto p-3 space-y-1">
                                    {#each selectedZones as zone, zoneIndex (zoneIndex)}
                                        {@const def = ZONE_MAP.get(zone.zoneId)}
                                        {@const zoneKey = zone.zoneId as string}
                                        {@const overridden = !zone.override && overrideZoneIds.has(zoneKey)}
                                        {@const external = externalOverrides[zoneKey] ?? []}
                                        {#if def}
                                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                                            <div
                                                class="flex items-center gap-1.5 rounded-none border px-3 py-2 transition-colors {overridden
                                                    ? 'opacity-40'
                                                    : 'hover:border-(--theme-accent-bg)'}"
                                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                                title={overridden
                                                    ? `同乘区已有覆盖条目：覆盖优先于一切，本条目不参与计算`
                                                    : ''}
                                            >
                                                <span class="shrink-0 text-xs text-(--theme-modal-text) truncate"
                                                    >{def.label}</span
                                                >
                                                {#if zone.override}
                                                    <span
                                                        class="shrink-0 px-1 py-0.5 text-[10px] font-black tracking-tight"
                                                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                                        title="覆盖优先于一切：该乘区的其它条目都不参与计算"
                                                        >覆盖生效</span
                                                    >
                                                {:else if overridden}
                                                    <span
                                                        class="shrink-0 px-1 py-0.5 text-[10px] text-(--theme-modal-text)/50"
                                                        title="同乘区已有覆盖条目，本条目被覆盖">已被覆盖</span
                                                    >
                                                {:else if external.length > 0}
                                                    <span
                                                        class="shrink-0 px-1 py-0.5 text-[10px] text-(--theme-modal-text)/50"
                                                        title={`同乘区在其它 BUFF 上也有覆盖：${external
                                                            .map(
                                                                (e) =>
                                                                    `「${e.name}」${e.later ? '在本 Buff 之后 → 最终生效' : '在本 Buff 之前 → 会被本 Buff 覆盖'}`
                                                            )
                                                            .join('；')}`}>跨 Buff 覆盖 ×{external.length}</span
                                                    >
                                                {/if}
                                                {#if zone.ref && !ZONE_NO_REF_IDS.has(zone.zoneId)}
                                                    {@const refDef =
                                                        ZONE_REF_MAP.get(zone.ref.zoneId) ??
                                                        ZONE_MAP.get(zone.ref.zoneId as any)}
                                                    {@const refName = teamNames[zone.ref.characterIdx] ?? '?'}
                                                    {@const refOp = zone.ref.threshold < 0 ? '+' : '-'}
                                                    {@const refTh =
                                                        zone.ref.threshold < 0
                                                            ? -zone.ref.threshold
                                                            : zone.ref.threshold}
                                                    {@const refS = simplifyPct(zone.ref.pct)}
                                                    {@const hasThreshold = zone.ref.threshold !== 0}
                                                    {@const hasLower = zone.ref.lower !== undefined}
                                                    {@const hasUpper = zone.ref.upper !== undefined}
                                                    <span
                                                        class="flex-1 text-[10px] text-(--theme-modal-text)/40 truncate min-w-0 text-right"
                                                        title="({refName}.{refDef?.label ?? '?'}{hasThreshold
                                                            ? ' ' +
                                                              refOp +
                                                              ' ' +
                                                              refTh +
                                                              (refDef?.unit === '%' ? '%' : '')
                                                            : ''}) ÷{refS.divisor}×{refS.multiplier}{hasLower ||
                                                        hasUpper
                                                            ? ' clamp(' +
                                                              (hasLower ? String(zone.ref.lower) : '') +
                                                              ' ~ ' +
                                                              (hasUpper ? String(zone.ref.upper) : '') +
                                                              ')'
                                                            : ''}"
                                                    >
                                                        引用: ({refName}.{refDef?.label ?? '?'}{hasThreshold
                                                            ? refOp + refTh + (refDef?.unit === '%' ? '%' : '')
                                                            : ''}) ÷{refS.divisor}×{refS.multiplier}
                                                        {#if hasLower || hasUpper}
                                                            <span class="text-(--theme-modal-text)/30">
                                                                ({hasLower ? zone.ref.lower : ''}~{hasUpper
                                                                    ? zone.ref.upper
                                                                    : ''})
                                                            </span>
                                                        {/if}
                                                    </span>
                                                {:else}
                                                    <div class="flex-1 flex justify-end items-center gap-1">
                                                        <input
                                                            type="number"
                                                            value={zone.value}
                                                            oninput={(e) => {
                                                                const v = parseFloat(
                                                                    (e.target as HTMLInputElement).value
                                                                )
                                                                setZoneValueAt(
                                                                    selectedBuffSet.id,
                                                                    zoneIndex,
                                                                    isNaN(v) ? 0 : v
                                                                )
                                                            }}
                                                            class="w-14 h-6 rounded-none border bg-transparent px-1.5 text-xs text-right tabular-nums text-(--theme-modal-text) outline-none"
                                                            style="border-color: var(--theme-divider-border);"
                                                        />
                                                        <span class="text-[10px] text-(--theme-modal-text)/40 w-3"
                                                            >{def.unit === '%' ? '%' : ''}</span
                                                        >
                                                    </div>
                                                {/if}
                                                {#if zone.zoneId !== 'atkPct' && zone.zoneId !== 'hpPct' && zone.zoneId !== 'defPct' && zone.zoneId !== 'extraRatio'}
                                                    <button
                                                        onclick={() =>
                                                            setZoneOverrideAt(
                                                                selectedBuffSet.id,
                                                                zoneIndex,
                                                                !zone.override
                                                            )}
                                                        class={[
                                                            'shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5',
                                                            zone.override
                                                                ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                                                : 'border-transparent text-(--theme-modal-text)/30 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/60'
                                                        ].join(' ')}
                                                    >
                                                        <Icon icon="mdi:swap-horizontal-bold" class="size-3" />
                                                        {zone.override ? '覆盖' : '追加'}
                                                    </button>
                                                {/if}
                                                {#if !ZONE_NO_REF_IDS.has(zone.zoneId)}
                                                    <button
                                                        onclick={() => openRefModal(zoneIndex)}
                                                        class="shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5"
                                                        style="border-color: var(--theme-divider-border);"
                                                    >
                                                        <Icon icon="mdi:link-variant" class="size-3" />
                                                        引用
                                                    </button>
                                                {/if}
                                                <!-- @desc 乘区级生效条件（行内下拉展开）：伤害类型 / 伤害属性 -->
                                                <button
                                                    onclick={() => toggleZoneCondition(zoneIndex)}
                                                    class={[
                                                        'shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5',
                                                        zone.condition
                                                            ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                                            : 'border-transparent text-(--theme-modal-text)/30 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/60'
                                                    ].join(' ')}
                                                    title={zone.condition
                                                        ? `该乘区条件：${describeCondition(zone.condition)}`
                                                        : '为该乘区设置生效条件（伤害类型/属性）'}
                                                >
                                                    <Icon
                                                        icon={expandedZoneIndex === zoneIndex
                                                            ? 'mdi:chevron-up'
                                                            : 'mdi:filter-outline'}
                                                        class="size-3"
                                                    />
                                                    条件{#if zone.condition}<span class="ml-0.5">•</span>{/if}
                                                </button>
                                                <!-- @desc 移除该乘区条目（同名乘区可添加多个，逐个移除） -->
                                                <button
                                                    onclick={() => removeZoneAt(selectedBuffSet.id, zoneIndex)}
                                                    class="shrink-0 rounded-none border border-transparent px-1 py-0.5 text-[10px] text-(--theme-modal-text)/30 transition-colors hover:border-red-500/40 hover:text-red-500"
                                                    title="移除该乘区"
                                                >
                                                    <Icon icon="mdi:close" class="size-3" />
                                                </button>
                                            </div>
                                            {#if expandedZoneIndex === zoneIndex}
                                                <ZoneConditionPanel
                                                    condition={zone.condition}
                                                    onchange={(next) => handleZoneConditionChange(zoneIndex, next)}
                                                />
                                            {/if}
                                        {/if}
                                    {/each}
                                    {#if selectedZones.length === 0}
                                        <div class="text-xs text-(--theme-modal-text)/30 py-4 text-center">
                                            暂无乘区
                                        </div>
                                    {/if}
                                </div>
                            {:else}
                                <div
                                    class="flex-1 flex items-center justify-center text-xs text-(--theme-modal-text)/40"
                                >
                                    选择一个 BUFF 块进行编辑
                                </div>
                            {/if}
                        </div>
                        <!-- @desc 右栏乘区清单：点击即**添加**一个乘区条目（同一乘区可添加多次，各自独立配置）；宽度固定 -->
                        {#if selectedBuffSet}
                            <div class="shrink-0 border-l flex flex-col" style="width: {ZONE_BAR_WIDTH}px;">
                                <div class="shrink-0 px-3 pt-3 pb-1.5">
                                    <div class="flex items-center gap-1.5">
                                        <Icon
                                            icon="mdi:playlist-plus"
                                            class="size-3.5 shrink-0"
                                            style="color: var(--theme-accent-text);"
                                        />
                                        <span class="text-xs font-black tracking-tight">添加乘区</span>
                                    </div>
                                </div>
                                <div class="theme-scrollbar flex-1 overflow-y-auto px-2 pb-3">
                                    {#each ZONE_SECTION_VIEWS as section (section.title)}
                                        <div class="mt-2 first:mt-0">
                                            <div
                                                class="px-1 pb-1 text-[10px] font-black tracking-[0.1em] text-(--theme-modal-text)/35"
                                            >
                                                {section.title}
                                            </div>
                                            <div class="flex flex-col gap-0.5">
                                                {#each section.defs as def (def.id)}
                                                    {@const count = selectedZones.filter(
                                                        (z) => z.zoneId === def.id
                                                    ).length}
                                                    <button
                                                        onclick={() => addZoneToBuffSet(selectedBuffSet!.id, def.id)}
                                                        class="w-full text-left rounded-none px-2 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1.5 text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/5 hover:text-(--theme-accent-text)"
                                                        title={`添加「${def.label}」${count > 0 ? `（已有 ${count} 个）` : ''}`}
                                                    >
                                                        <Icon icon="mdi:plus" class="size-3.5 shrink-0" />
                                                        <span class="min-w-0 flex-1 truncate">{def.label}</span>
                                                        {#if count > 0}
                                                            <span
                                                                class="shrink-0 px-1 text-[10px] tabular-nums"
                                                                style="background: color-mix(in srgb, var(--theme-accent-bg) 18%, transparent); color: var(--theme-accent-text);"
                                                                >{count}</span
                                                            >
                                                        {/if}
                                                    </button>
                                                {/each}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
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
        </div>
    </div>
{/if}

<!-- @desc 引用配置弹窗：选择引用角色/属性、阈值与换算规则（线性/离散、除乘）、上下限 clamp -->
{#if showRefModal}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="animate-fade-in fixed inset-0 z-60 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onkeydown={(e) => e.key === 'Escape' && (showRefModal = false)}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            data-sf="modal"
            class="animate-pop-in rounded-none border p-5 shadow-2xl w-md"
            style="border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <div
                class="flex items-center justify-between mb-5 border-b pb-2.5"
                style="border-color: var(--theme-divider-border);"
            >
                <h3 class="flex items-center gap-2 text-base font-black tracking-tight">
                    <Icon icon="mdi:link-variant" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
                    引用配置
                </h3>
                <button
                    onclick={() => (showRefLookup = true)}
                    class="flex items-center gap-1 rounded-none px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-modal-text)/5"
                >
                    <Icon icon="mdi:magnify" class="size-3.5" />
                    速查
                </button>
            </div>

            <div class="space-y-4">
                <!-- Character selector (top) -->
                <div role="group" aria-label="引用角色">
                    <span class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">引用角色</span>
                    <div class="flex gap-2">
                        {#each team as slot, i}
                            <button
                                onclick={() => (refCharacterIdx = i)}
                                class={[
                                    'size-9 rounded-full overflow-hidden border-2 transition-all',
                                    refCharacterIdx === i
                                        ? 'border-(--theme-accent-bg) ring-2 ring-(--theme-accent-bg)/30'
                                        : 'border-transparent grayscale opacity-30 hover:opacity-60'
                                ].join(' ')}
                            >
                                {#if slot.character && charIconMap[slot.character]}
                                    <img
                                        src={charIconMap[slot.character]}
                                        alt={slot.character}
                                        draggable="false"
                                        use:fallbackIcon={'/icons/placeholder-character.svg'}
                                        class="h-full w-full object-cover"
                                    />
                                {:else}
                                    <span
                                        class="w-full h-full flex items-center justify-center text-xs font-medium text-(--theme-modal-text)/50"
                                        >{slot.character?.charAt(0) ?? '?'}</span
                                    >
                                {/if}
                            </button>
                        {/each}
                    </div>
                </div>

                <!-- Zone selector (below) -->
                <div role="group" aria-label="引用属性">
                    <span class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">引用属性</span>
                    <div class="relative">
                        <button
                            onclick={() => (showRefZoneMenu = !showRefZoneMenu)}
                            class="w-full flex items-center justify-between rounded-none border px-3 py-2 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/5"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <span class="truncate">{refTargetDef?.label ?? refTargetZoneId}</span>
                            <Icon icon="mdi:chevron-down" class="size-3.5 shrink-0 text-(--theme-modal-text)/40" />
                        </button>
                        {#if showRefZoneMenu}
                            <div
                                class="theme-scrollbar absolute left-0 top-full z-10 mt-1.5 w-full max-h-60 overflow-y-auto rounded-none border bg-(--theme-modal-bg) py-1 backdrop-blur-lg"
                                style="border-color: var(--theme-divider-border);"
                                onclick={(e) => e.stopPropagation()}
                            >
                                {#each ZONE_REF_DEFS.filter((d) => d.id !== refZoneId) as def}
                                    <button
                                        onclick={() => {
                                            refTargetZoneId = def.id
                                            showRefZoneMenu = false
                                        }}
                                        class={[
                                            'flex w-full items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
                                            refTargetZoneId === def.id
                                                ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                : 'text-(--theme-modal-text) hover:bg-(--theme-modal-text)/5'
                                        ].join(' ')}
                                    >
                                        <span class="flex-1">{def.label}</span>
                                        <span class="text-[10px] text-(--theme-modal-text)/40"
                                            >{def.unit === '%' ? '%' : ''}</span
                                        >
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Conversion rule card -->
                {#if refTargetDef && currentZoneDef}
                    <div
                        class="rounded-none border px-4 py-3.5 space-y-3"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        <!-- Header: refAttr -->
                        <div class="text-xs text-(--theme-modal-text)/60">
                            <span class="font-medium text-(--theme-modal-text)/80">{refTargetDef.label}</span>
                        </div>

                        <!-- Line 1: 超过 [threshold] unit1 的部分 -->
                        <div
                            class="flex items-center rounded-none border overflow-hidden"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <button
                                onclick={() => {
                                    refHasThreshold = !refHasThreshold
                                }}
                                class={[
                                    'px-3 py-1.5 text-xs font-medium transition-all',
                                    refHasThreshold
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                                        : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                                ].join(' ')}
                            >
                                超过
                            </button>
                            <div
                                class="flex items-center flex-1 px-3 py-1.5 border-x"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <input
                                    type="number"
                                    bind:value={refThreshold}
                                    disabled={!refHasThreshold}
                                    class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                                    class:text-(--theme-modal-text)={refHasThreshold}
                                />
                                <span class="text-xs text-(--theme-modal-text)/40">{refTargetDefUnit}</span>
                            </div>
                            <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">的部分</span>
                        </div>

                        <!-- Conversion mode tab -->
                        <div
                            class="flex rounded-none border overflow-hidden"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <button
                                onclick={() => {
                                    refIsDiscrete = false
                                }}
                                class={[
                                    'flex-1 px-3 py-1.5 text-xs font-medium transition-all',
                                    !refIsDiscrete
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                                        : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                                ].join(' ')}
                            >
                                线性地
                            </button>
                            <div class="w-px self-stretch" style="background: var(--theme-divider-border);"></div>
                            <button
                                onclick={() => {
                                    refIsDiscrete = true
                                }}
                                class={[
                                    'flex-1 px-3 py-1.5 text-xs font-medium transition-all',
                                    refIsDiscrete
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                                        : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                                ].join(' ')}
                            >
                                离散地
                            </button>
                        </div>

                        <!-- Line 2: 每 [divisor] unit1 转换为 [multiplier] unit2 -->
                        <div
                            class="flex items-center rounded-none border overflow-hidden"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <span
                                class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5 border-r"
                                style="border-color: var(--theme-divider-border);">每</span
                            >
                            <div
                                class="flex items-center flex-1 px-3 py-1.5 border-r"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <input
                                    type="number"
                                    bind:value={refDivisor}
                                    class="w-full min-w-0 text-xs text-(--theme-modal-text) outline-none tabular-nums text-center bg-transparent"
                                />
                                <span class="text-xs text-(--theme-modal-text)/40">{refTargetDefUnit}</span>
                            </div>
                            <span
                                class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5 border-r"
                                style="border-color: var(--theme-divider-border);">转换为</span
                            >
                            <div
                                class="flex items-center flex-1 px-3 py-1.5"
                                style="background: var(--theme-input-bg);"
                            >
                                <input
                                    type="number"
                                    bind:value={refMultiplier}
                                    class="w-full min-w-0 text-xs text-(--theme-modal-text) outline-none tabular-nums text-center bg-transparent"
                                />
                                <span class="text-xs text-(--theme-modal-text)/40">{currentZoneUnit}</span>
                            </div>
                        </div>

                        <!-- Footer: 的 targetName -->
                        <div class="flex justify-end text-sm text-(--theme-modal-text)/60">
                            <span class="text-(--theme-modal-text)/30">的</span>
                            <span class="font-medium text-(--theme-accent-text) ml-1">{currentZoneDef.label}</span>
                        </div>
                    </div>
                {/if}

                <!-- Lower & Upper -->
                <div class="flex gap-2">
                    <div
                        class="flex items-center flex-1 rounded-none border overflow-hidden"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <button
                            onclick={() => {
                                refHasLower = !refHasLower
                            }}
                            class={[
                                'px-3 py-1.5 text-xs font-medium transition-all',
                                refHasLower
                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                                    : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                            ].join(' ')}
                        >
                            下限
                        </button>
                        <div
                            class="flex items-center flex-1 px-3 py-1.5 border-x"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <input
                                type="number"
                                bind:value={refLower}
                                disabled={!refHasLower}
                                class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                                class:text-(--theme-modal-text)={refHasLower}
                            />
                        </div>
                        <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">{currentZoneUnit}</span>
                    </div>
                    <div
                        class="flex items-center flex-1 rounded-none border overflow-hidden"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <button
                            onclick={() => {
                                refHasUpper = !refHasUpper
                            }}
                            class={[
                                'px-3 py-1.5 text-xs font-medium transition-all',
                                refHasUpper
                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                                    : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                            ].join(' ')}
                        >
                            上限
                        </button>
                        <div
                            class="flex items-center flex-1 px-3 py-1.5 border-x"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <input
                                type="number"
                                bind:value={refUpper}
                                disabled={!refHasUpper}
                                class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                                class:text-(--theme-modal-text)={refHasUpper}
                            />
                        </div>
                        <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">{currentZoneUnit}</span>
                    </div>
                </div>
            </div>

            <div
                class="flex items-center justify-between mt-5 pt-4 border-t"
                style="border-color: var(--theme-divider-border);"
            >
                <button
                    onclick={handleClearRef}
                    class="rounded-none px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/15"
                    >清除引用</button
                >
                <div class="flex items-center gap-2">
                    <button
                        onclick={() => (showRefModal = false)}
                        class="rounded-none px-3 py-1.5 text-xs text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/10"
                        >取消</button
                    >
                    <button
                        onclick={handleConfirmRef}
                        class="rounded-none px-4 py-1.5 text-xs transition-all hover:brightness-125"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                        >确认</button
                    >
                </div>
            </div>
        </div>
    </div>
{/if}

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
{#if showDeleteFolderConfirm}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="animate-fade-in fixed inset-0 z-70 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onkeydown={(e) => e.key === 'Escape' && (showDeleteFolderConfirm = false)}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            data-sf="modal"
            class="animate-pop-in rounded-none border p-5 shadow-2xl w-80"
            style="border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="mb-2 flex items-center gap-2 text-base font-black tracking-tight">
                <Icon icon="mdi:folder" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
                确认删除文件夹
            </h3>
            <p class="text-xs text-(--theme-modal-text)/60 mb-4">
                将删除该文件夹内的所有 <strong>{deleteFolderCount}</strong> 条 BUFF，确定吗？
            </p>
            <div class="flex justify-end gap-2 border-t pt-3" style="border-color: var(--theme-divider-border);">
                <button
                    onclick={() => (showDeleteFolderConfirm = false)}
                    class="h-7 rounded-none px-3 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                    style="background: var(--theme-input-bg);">取消</button
                >
                <button
                    onclick={confirmDeleteFolder}
                    class="h-7 rounded-none bg-red-500 px-3 text-xs text-white transition-all hover:brightness-110"
                    >确认删除</button
                >
            </div>
        </div>
    </div>
{/if}

<!-- @desc 文件夹批量重命名弹窗：按「新前缀 + 1..N + 新后缀」重新编号全部子 Buff -->
{#if showFolderRename && folderRenameTarget}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="animate-fade-in fixed inset-0 z-70 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onkeydown={(e) => e.key === 'Escape' && (showFolderRename = false)}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            data-sf="modal"
            class="animate-pop-in rounded-none border p-5 shadow-2xl w-96"
            style="border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="mb-2 flex items-center gap-2 text-base font-black tracking-tight">
                <Icon icon="mdi:rename-box" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
                批量重命名文件夹
            </h3>
            <p class="text-xs text-(--theme-modal-text)/60 mb-3">
                「{folderRenameTarget.name}」内的 <strong>{folderMembersOf(folderRenameTarget).length}</strong> 条 BUFF 将按
                「新前缀 + 序号 + 新后缀」重新编号
            </p>
            <div class="flex items-center gap-2 mb-1">
                <input
                    type="text"
                    bind:value={folderRenamePrefix}
                    placeholder="新前缀"
                    class="flex-1 min-w-0 rounded-none border px-2 py-1.5 text-xs outline-none text-(--theme-modal-text)"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                />
                <span class="text-xs text-(--theme-modal-text)/40 shrink-0">{'{'}1..N{'}'}</span>
                <input
                    type="text"
                    bind:value={folderRenameSuffix}
                    placeholder="新后缀"
                    class="flex-1 min-w-0 rounded-none border px-2 py-1.5 text-xs outline-none text-(--theme-modal-text)"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                />
            </div>
            <div
                class="theme-scrollbar max-h-28 overflow-y-auto mb-3 rounded-none border p-2 text-[11px] text-(--theme-modal-text)/50"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                {#each folderMembersOf(folderRenameTarget) as child, i (child.id)}
                    <div class="flex items-center gap-1 py-0.5">
                        <span class="line-through text-(--theme-modal-text)/30">{child.name}</span>
                        <Icon icon="mdi:arrow-right" class="size-3 shrink-0" />
                        <span class="text-(--theme-modal-text)/70"
                            >{folderRenamePrefix.trim()}{i + 1}{folderRenameSuffix.trim()}</span
                        >
                    </div>
                {/each}
            </div>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (showFolderRename = false)}
                    class="h-7 rounded-none px-3 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                    style="background: var(--theme-input-bg);">取消</button
                >
                <button
                    onclick={confirmFolderRename}
                    class="h-7 rounded-none px-3 text-xs transition-all hover:brightness-125"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                    >确认重命名</button
                >
            </div>
        </div>
    </div>
{/if}

<!-- @desc 多选批量删除确认弹窗 -->
{#if showMultiDeleteConfirm}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="animate-fade-in fixed inset-0 z-70 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onkeydown={(e) => e.key === 'Escape' && (showMultiDeleteConfirm = false)}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            data-sf="modal"
            class="animate-pop-in rounded-none border p-5 shadow-2xl w-80"
            style="border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="mb-2 flex items-center gap-2 text-base font-black tracking-tight">
                <Icon icon="mdi:delete-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
                确认批量删除
            </h3>
            <p class="text-xs text-(--theme-modal-text)/60 mb-4">
                将删除选中的 <strong>{multiSelectedIds.size}</strong> 条 BUFF（全局 buff 不受影响），确定吗？
            </p>
            <div class="flex justify-end gap-2 border-t pt-3" style="border-color: var(--theme-divider-border);">
                <button
                    onclick={() => (showMultiDeleteConfirm = false)}
                    class="h-7 rounded-none px-3 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                    style="background: var(--theme-input-bg);">取消</button
                >
                <button
                    onclick={confirmMultiDelete}
                    class="h-7 rounded-none bg-red-500 px-3 text-xs text-white transition-all hover:brightness-110"
                    >确认删除</button
                >
            </div>
        </div>
    </div>
{/if}

<!-- @desc 复制命名选项弹窗（buff 名带数字时的递增命名选择） -->
{#if showCopyOptions}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="animate-fade-in fixed inset-0 z-70 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onkeydown={(e) => e.key === 'Escape' && (showCopyOptions = false)}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            data-sf="modal"
            class="animate-pop-in rounded-none border p-5 shadow-2xl w-96"
            style="border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="mb-2 flex items-center gap-2 text-base font-black tracking-tight">
                <Icon icon="mdi:content-copy" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
                复制 BUFF
            </h3>
            <p class="text-xs text-(--theme-modal-text)/60 mb-4">检测到您的 buff 名带数字，请问要复制为？</p>
            <div class="flex flex-col gap-1.5">
                {#each copyOptions as name}
                    <button
                        onclick={() => confirmCopyBuff(name)}
                        class="h-8 rounded-none px-3 text-xs text-left text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/10"
                        style="background: var(--theme-input-bg);"
                    >
                        {name}
                    </button>
                {/each}
            </div>
            <div class="flex justify-end gap-2 mt-4">
                <button
                    onclick={() => (showCopyOptions = false)}
                    class="h-7 rounded-none px-3 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                    style="background: var(--theme-input-bg);">取消</button
                >
            </div>
        </div>
    </div>
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

<!-- @desc ── 列表复用部件：最低一层 buff 条目 / 容器内容（数字目录 + 散条目）/ 二级（链·武器）目录头 ── -->

<!-- @desc 拖拽插入指示条：只在当前落点锚点行的上/下方出现（锚点由 onDragMove 按同一父容器行序列算出） -->
{#snippet dropLine(anchorId: string, side: 'before' | 'after', pad: string)}
    {#if !dragState?.outside && (side === 'before' ? dragState?.dropBeforeId === anchorId : dragState?.dropAfterId === anchorId)}
        <div class="{pad} h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
    {/if}
{/snippet}

<!-- @desc 条目作用域徽标（名称右侧）：全队=主题色实心 / 效应专属=主题色空心 / 指定角色=角色属性色空心+半透明底 -->
{#snippet scopeBadges(bs: BuffSet)}
    {#each scopeBadgesOf(bs) as badge (badge.key)}
        <span
            class="shrink-0 whitespace-nowrap rounded-none border px-1 py-px text-[10px] leading-none tabular-nums"
            style={badge.style}
            title={`作用域：${badge.label}`}>{badge.label}</span
        >
    {/each}
{/snippet}

{#snippet buffRow(child: BuffSet, parentKey: string, rowPad: string)}
    {@const draggable = !multiSelect && !isGlobalBuff(child.id)}
    {@render dropLine(child.id, 'before', 'mx-1')}
    <button
        data-buffset-id={child.id}
        data-drag-parent={parentKey}
        onclick={() => {
            if (multiSelect) !isMultiSelectDisabled(child.id) && toggleMultiSelectId(child.id)
            else selectedBuffSetId = child.id
        }}
        oncontextmenu={(e) => openItemMenu(e, child.id)}
        onpointerdown={draggable ? (e) => startDrag(e, child.id, 'item', parentKey) : undefined}
        onpointermove={draggable ? onDragMove : undefined}
        onpointerup={draggable ? onDragEnd : undefined}
        class={[
            `flex w-full min-w-0 items-center gap-2 rounded-none ${rowPad} text-left text-xs transition-all`,
            multiSelect && isMultiSelectDisabled(child.id)
                ? 'text-(--theme-modal-text)/30 opacity-50'
                : (multiSelect ? multiSelectedIds.has(child.id) : selectedBuffSetId === child.id)
                  ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                  : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5',
            draggable && dragState?.id === child.id && !dragState.outside && 'ring-2 ring-(--theme-accent-bg)',
            draggable && dragState?.id === child.id && dragState.outside && 'ring-2 ring-red-500 opacity-50'
        ].join(' ')}
    >
        {#if multiSelect}
            <Icon
                icon={isMultiSelectDisabled(child.id)
                    ? 'mdi:checkbox-blank-off-outline'
                    : multiSelectedIds.has(child.id)
                      ? 'mdi:checkbox-marked'
                      : 'mdi:checkbox-blank-outline'}
                class="size-4 shrink-0 text-(--theme-accent-text)"
            />
        {:else}
            <Icon icon={buffItemIcon(child.starred)} class={buffItemIconClass(child.starred, draggable)} />
        {/if}
        <span class="truncate flex-1">{child.name}</span>
        {@render scopeBadges(child)}
    </button>
    {@render dropLine(child.id, 'after', 'mx-1')}
{/snippet}

{#snippet buffContainer(children: BuffSet[] | undefined, containerKey: string)}
    {#each foldersOf(children) as sub (sub.key)}
        {@const subKey = layeredKeyOf(containerKey, sub.prefix)}
        {@const subMembers = (sub.children ?? []).map((c) => c.id)}
        {@const subDraggable = !multiSelect && subMembers.some((id) => !isGlobalBuff(id))}
        <div class="space-y-1" data-folder-collapse-key={subKey}>
            <button
                class={[
                    'flex w-full min-w-0 items-center gap-2 rounded-none px-3 py-1.5 text-left text-xs transition-all',
                    multiSelect && folderAllSelected(sub.children ?? [])
                        ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                        : 'text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5',
                    subDraggable && dragState?.id === subKey && !dragState.outside && 'ring-2 ring-(--theme-accent-bg)',
                    subDraggable && dragState?.id === subKey && dragState.outside && 'ring-2 ring-red-500 opacity-50'
                ].join(' ')}
                onclick={() => (multiSelect ? toggleMultiSelectFolder(sub.children ?? []) : toggleFolder(subKey))}
                oncontextmenu={multiSelect ? undefined : (e) => openFolderMenu(e, sub)}
                onpointerdown={subDraggable
                    ? (e) => startDrag(e, subKey, 'folder', containerKey, subMembers)
                    : undefined}
                onpointermove={subDraggable ? onDragMove : undefined}
                onpointerup={subDraggable ? onDragEnd : undefined}
            >
                {#if multiSelect}
                    <Icon
                        icon={folderAllSelected(sub.children ?? [])
                            ? 'mdi:checkbox-marked'
                            : 'mdi:checkbox-blank-outline'}
                        class="size-3.5 shrink-0 text-(--theme-accent-text)"
                    />
                {:else}
                    <Icon
                        icon={collapsedFolders.has(subKey) ? 'mdi:folder' : 'mdi:folder-open'}
                        class={folderIconClass(
                            sub,
                            subDraggable
                                ? 'size-3.5 shrink-0 drag-handle touch-none select-none cursor-grab active:cursor-grabbing'
                                : 'size-3.5 shrink-0'
                        )}
                    />
                {/if}
                <span class="truncate flex-1">{sub.name}</span>
            </button>
            {#if !collapsedFolders.has(subKey)}
                <div class="ml-3 space-y-1 border-l pl-2" style="border-color: var(--theme-divider-border);">
                    {#each sub.children ?? [] as sc (sc.id)}
                        {@render buffRow(sc, subKey, 'px-3 py-1.5')}
                    {/each}
                </div>
            {/if}
        </div>
    {/each}
    {#each looseChildrenOf(children) as child (child.id)}
        {@render buffRow(child, containerKey, 'px-3 py-2')}
    {/each}
{/snippet}

{#snippet gateFolderHead(node: BuffTreeNode, stickyTop: string)}
    {@const members = folderMembersOf(node)}
    <div
        class={[
            'flex min-w-0 items-center gap-1',
            !collapsedFolders.has(node.prefix!)
                ? `sticky ${stickyTop} z-10 -mx-2 border-b border-(--theme-divider-border) px-2 py-1 bg-(--theme-modal-bg)`
                : ''
        ].join(' ')}
    >
        <!-- @desc 二级目录（角色名X链 / 角色名的武器名）由链/阶硬性条件派生，改条件即换目录，因此**不可拖动** -->
        <button
            onclick={() => (multiSelect ? toggleMultiSelectFolder(members) : toggleFolder(node.prefix!))}
            oncontextmenu={multiSelect ? undefined : (e) => openFolderMenu(e, node)}
            class={[
                'flex min-w-0 flex-1 items-center gap-2 rounded-none px-3 py-2 text-xs text-left transition-all',
                multiSelect && folderAllSelected(members)
                    ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                    : 'text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5'
            ].join(' ')}
            transition:slide={{ duration: 200 }}
        >
            {#if multiSelect}
                <Icon
                    icon={folderAllSelected(members) ? 'mdi:checkbox-marked' : 'mdi:checkbox-blank-outline'}
                    class="size-4 shrink-0 text-(--theme-accent-text)"
                />
            {:else if node.charIdx !== undefined && teamIconOf(node.charIdx)}
                <!-- @desc 二级目录：角色图标 + 角标（链目录=链门槛角标；武器目录=当前装配武器图标） -->
                <span class="relative shrink-0">
                    <img
                        src={teamIconOf(node.charIdx)}
                        alt=""
                        draggable="false"
                        class="size-4 rounded-full object-cover"
                    />
                    {#if node.gateKind === 'weapon'}
                        {#if weaponIconOf(node.charIdx)}
                            <img
                                src={weaponIconOf(node.charIdx)}
                                alt=""
                                draggable="false"
                                class="absolute -bottom-0.5 -right-1 size-3 rounded-sm border object-cover"
                                style="border-color: var(--theme-modal-bg);"
                            />
                        {/if}
                    {:else}
                        <span
                            class="absolute -bottom-1 -right-1 flex h-3 min-w-3 items-center justify-center px-0.5 text-[8px] font-black leading-none"
                            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                            >{node.gateMin ?? 0}</span
                        >
                    {/if}
                </span>
            {:else}
                <Icon
                    icon={collapsedFolders.has(node.prefix!) ? 'mdi:folder-account-outline' : 'mdi:folder-account'}
                    class={folderIconClass(node, 'size-4 shrink-0')}
                />
            {/if}
            <span class="truncate flex-1">{node.name}</span>
        </button>
        {#if !multiSelect}
            <button
                type="button"
                class="shrink-0 rounded-none p-0.5 text-(--theme-modal-text)/40 transition-colors hover:bg-(--theme-modal-text)/10 hover:text-(--theme-modal-text)"
                title="文件夹操作"
                onclick={(e) => openFolderMenu(e, node)}
                oncontextmenu={(e) => openFolderMenu(e, node)}
            >
                <Icon icon="mdi:dots-horizontal" class="size-4" />
            </button>
        {/if}
    </div>
{/snippet}
