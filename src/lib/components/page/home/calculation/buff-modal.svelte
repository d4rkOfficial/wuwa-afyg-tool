<script lang="ts">
    /** @desc BUFF 配置弹窗：左侧 Buff 块列表（叠层文件夹/拖拽排序/拖出删除）、右侧块编辑器（作用域/生效条件/乘区数值与引用/追加覆盖）、右栏乘区清单，含速查与导入入口 */
    import {
        getAllBuffSets,
        createBuffSet,
        deleteBuffSet,
        deleteBuffSets,
        duplicateBuffSet,
        renameBuffSet,
        addZoneToBuffSet,
        removeZoneFromBuffSet,
        setBuffSetZoneValue,
        setBuffSetScope,
        setBuffSetZoneRef,
        setBuffSetZoneOverride,
        setBuffSetCondition,
        setBuffSetConditionRef,
        getGlobalBuffSetIds,
        reorderNonGlobalBuffSets,
        toggleBuffSetStarred,
        setBuffSetGlobal,
        setBuffSetsGlobal
    } from '$lib/calc/calculation.store.svelte'
    import {
        ZONE_DEFS,
        ZONE_MAP,
        ZONE_REF_DEFS,
        ZONE_REF_MAP,
        groupBuffSets,
        LAYERED_BUFF_PATTERN
    } from '$lib/calc/calculation.consts'
    import type { ZoneId, GroupedBuffSetItem } from '$lib/calc/calculation.consts'
    import type { CharSlot } from '$lib/types/project'
    import type { ZoneRef, BuffSet, BuffCondition } from '$lib/calc/calculation.types'
    import { ELEMENTS, DAMAGE_TYPES, DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'
    import { getCharIconMap, elementColor } from '$lib/calc/timeline.store.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import { getConfirmDeletes } from '$lib/data/interaction-prefs.svelte'
    import Icon from '@iconify/svelte'
    import QuickLookup from '$lib/components/layout/quick-lookup.svelte'
    import BuffImportModal from './buff-import-modal.svelte'
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

    /** @desc 拖拽状态：id/源索引/目标索引/是否拖出列表/拖拽模式（条目/文件夹/子项） */
    type DragState = {
        id: string
        idx: number
        dropIdx: number
        outside: boolean
        mode: 'item' | 'folder' | 'child'
        folderPrefix?: string
    }
    let dragState = $state<DragState | null>(null)
    let collapsedFolders = $state(new Set<string>())
    let savedCollapsedState: Set<string> | null = null
    let unregisterDragCancel: (() => void) | null = null
    let showDeleteFolderConfirm = $state(false)
    let deleteFolderPrefix = $state('')
    let deleteFolderCount = $state(0)
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

    /** @desc 全局 buff 的标签颜色：全队=黄，否则取归属角色元素色 */
    function globalBuffColor(buffSet: { scope: number[] | 'all' }): string {
        if (!Array.isArray(buffSet.scope) || buffSet.scope.length === 0) return '#eab308'
        const idx = buffSet.scope[0]
        const charName = team[idx]?.character
        if (!charName) return '#eab308'
        return elementColor(charName)
    }

    let selectedBuffSetId = $state<string | null>(null)
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
    let refZoneId = $state<string>('')
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

    // groupBuffSets imported from calculation.consts

    let buffSets = $derived(getAllBuffSets())
    let globalBuffSetIds = $derived(getGlobalBuffSetIds())
    let charIconMap = $derived(getCharIconMap())
    /** @desc 全局 buff 排最前，其余保持原序 */
    let sortedBuffSets = $derived(
        [...buffSets].sort((a, b) => {
            const aG = globalBuffSetIds.includes(a.id) ? 0 : 1
            const bG = globalBuffSetIds.includes(b.id) ? 0 : 1
            return aG - bG
        })
    )

    /** @desc 分组列表：全局文件夹（皇冠）固定在前，其余按叠层规则 groupBuffSets 分组 */
    let groupedBuffSets = $derived.by(() => {
        const globalBuffs = sortedBuffSets.filter((bs) => globalBuffSetIds.includes(bs.id))
        const globalFolder: GroupedBuffSetItem[] =
            globalBuffs.length > 0
                ? [
                      {
                          key: 'folder:global',
                          type: 'folder',
                          name: '全局生效Buff',
                          prefix: 'global',
                          children: globalBuffs
                      }
                  ]
                : []
        const nonGlobalItems = groupBuffSets(sortedBuffSets.filter((bs) => !globalBuffSetIds.includes(bs.id)))
        return [...globalFolder, ...nonGlobalItems]
    })
    /** @desc 顶层条目展平（用于拖拽插入位置计算与文件夹计数） */
    let topLevelFlatItems = $derived.by(() => {
        const result: Array<{ key: string; type: 'item' | 'folder' }> = []
        for (const item of groupedBuffSets) {
            if (item.type === 'folder') {
                if (item.prefix === 'global') continue
                result.push({ key: item.prefix!, type: 'folder' })
            } else {
                result.push({ key: item.buffSet!.id, type: 'item' })
            }
        }
        return result
    })
    let topLevelIdxMap = $derived(new Map(topLevelFlatItems.map((x, i) => [x.key, i])))
    let topLevelCount = $derived(topLevelFlatItems.length)

    /** @desc 当前选中的 Buff 块、其作用域对应角色勾选态、是否效应专属 */
    let selectedBuffSet = $derived(buffSets.find((s) => s.id === selectedBuffSetId) ?? null)

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
    let currentZoneDef = $derived(ZONE_MAP.get(refZoneId as ZoneId) ?? null)
    let currentZoneUnit = $derived(currentZoneDef?.unit === '%' ? '%' : '点')

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
            (item) => item.type === 'folder' && item.children?.some((c) => c.id === selectedBuffSetId)
        )
        if (folder) {
            const nums = (folder.children ?? [])
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

    /** @desc 生效条件摘要文案（链/精炼/属性/类型拼接） */
    const conditionSummary = $derived.by(() => {
        const cond = selectedBuffSet?.condition
        if (!cond) return ''
        const parts: string[] = []
        if (cond.chain !== undefined) {
            const refIdx = selectedBuffSet.conditionRefCharIdx ?? 0
            const name = team[refIdx]?.character ?? `角色 ${refIdx + 1}`
            parts.push(`${name} ≥${cond.chain}链`)
        }
        if (cond.refinement !== undefined) {
            const name =
                team[selectedBuffSet.conditionRefCharIdx ?? 0]?.character ??
                `角色 ${(selectedBuffSet.conditionRefCharIdx ?? 0) + 1}`
            parts.push(`${name}的武器 ≥${cond.refinement}阶`)
        }
        if (cond.elements?.length) parts.push(`伤害属性 ${cond.elements.join('/')}`)
        if (cond.damageTypes?.length)
            parts.push(`伤害类型 ${cond.damageTypes.map((d) => DAMAGE_TYPE_SHORT[d] ?? d).join('/')}`)
        return parts.join('，')
    })

    /** @desc 参考角色必须恰好一个：设置了链/精炼但未选参考角色时，默认参考第一位 */
    function ensureConditionRef() {
        if (!selectedBuffSetId || !selectedBuffSet) return
        if (selectedBuffSet.conditionRefCharIdx === undefined) setBuffSetConditionRef(selectedBuffSetId, 0)
    }

    /** @desc 设置共鸣链门槛（再次点击取消）；设置链/精炼时自动补参考角色 */
    function setBuffChain(min: number) {
        if (!selectedBuffSetId || !selectedBuffSet) return
        if (isDefaultGlobalBuff()) return
        const cond = selectedBuffSet.condition ?? {}
        const next: BuffCondition = { ...cond }
        if (next.chain === min) delete next.chain
        else next.chain = min
        setBuffSetCondition(selectedBuffSetId, next)
        if (next.chain !== undefined || next.refinement !== undefined) ensureConditionRef()
    }

    /** @desc 设置武器精炼门槛（再次点击取消） */
    function setBuffRefinement(min: number) {
        if (!selectedBuffSetId || !selectedBuffSet) return
        if (isDefaultGlobalBuff()) return
        const cond = selectedBuffSet.condition ?? {}
        const next: BuffCondition = { ...cond }
        if (next.refinement === min) delete next.refinement
        else next.refinement = min
        setBuffSetCondition(selectedBuffSetId, next)
        if (next.chain !== undefined || next.refinement !== undefined) ensureConditionRef()
    }

    /** @desc 切换伤害属性条件（多选） */
    function toggleConditionElement(el: string) {
        if (!selectedBuffSetId || !selectedBuffSet) return
        if (isDefaultGlobalBuff()) return
        const cond = selectedBuffSet.condition ?? {}
        const list = cond.elements ?? []
        const next = list.includes(el) ? list.filter((e) => e !== el) : [...list, el]
        setBuffSetCondition(selectedBuffSetId, { ...cond, elements: next })
    }

    /** @desc 切换伤害类型条件（多选） */
    function toggleConditionDamageType(dt: string) {
        if (!selectedBuffSetId || !selectedBuffSet) return
        if (isDefaultGlobalBuff()) return
        const cond = selectedBuffSet.condition ?? {}
        const list = cond.damageTypes ?? []
        const next = list.includes(dt) ? list.filter((d) => d !== dt) : [...list, dt]
        setBuffSetCondition(selectedBuffSetId, { ...cond, damageTypes: next })
    }

    /** @desc 设置参考角色槽位（默认全局 buff 拒绝） */
    function setConditionRef(i: number) {
        if (!selectedBuffSetId || !selectedBuffSet) return
        if (isDefaultGlobalBuff()) {
            addToast('默认全局buff无法设置生效条件', 'info')
            return
        }
        setBuffSetConditionRef(selectedBuffSetId, i)
    }

    /** @desc 打开引用配置弹窗：有现成引用则回填各字段，否则按当前乘区初始化（同目标时自动换一个可引用属性） */
    function openRefModal(zoneId: string) {
        const zone = selectedBuffSet?.zones.find((z) => z.zoneId === zoneId)
        refZoneId = zoneId
        showRefZoneMenu = false
        if (zone?.ref) {
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
            refTargetZoneId = zoneId
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
        if (refTargetZoneId === refZoneId) {
            const fallback = ZONE_REF_DEFS.find((d) => d.id !== refZoneId)
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
        setBuffSetZoneRef(selectedBuffSetId, refZoneId, ref)
        showRefModal = false
    }

    /** @desc 清除引用 */
    function handleClearRef() {
        if (!selectedBuffSetId) return
        setBuffSetZoneRef(selectedBuffSetId, refZoneId, null)
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

    /** @desc 拖动进入 AI 悬浮窗等"禁区"时取消拖拽（不触发 drop 的删除/重排/确认弹窗） */
    function cancelBuffDrag() {
        if (!dragState) return
        dragState = null
        if (savedCollapsedState !== null) {
            collapsedFolders = savedCollapsedState
            savedCollapsedState = null
        }
    }

    /** @desc 开始拖拽：仅从拖拽把手开始（.drag-handle），记录源索引并展开全部文件夹（拖拽中便于定位） */
    function startDrag(e: PointerEvent, id: string, mode: 'item' | 'folder' | 'child', folderPrefix?: string) {
        if ((e.target as HTMLElement).closest('input')) return
        if (!(e.target as HTMLElement).closest('.drag-handle')) return
        const el = e.currentTarget as HTMLElement
        el.setPointerCapture(e.pointerId)
        savedCollapsedState = new Set(collapsedFolders)
        collapsedFolders = new Set()

        let idx = -1
        if (mode === 'child' && folderPrefix) {
            const container = el.closest('.buff-list-container') as HTMLElement | null
            if (container) {
                const items = container.querySelectorAll(`[data-folder-child="${folderPrefix}"]`)
                const ids = [...items].map((item) => (item as HTMLElement).dataset.buffsetId!)
                idx = ids.indexOf(id)
            }
        } else if (mode === 'item' || mode === 'folder') {
            idx = topLevelIdxMap.get(id) ?? -1
        }
        dragState = { id, idx, dropIdx: idx, outside: false, mode, folderPrefix }
    }

    /** @desc 拖拽移动：超出容器边缘 30px 判定为「拖出」（删除/删文件夹），否则按元素中心线计算插入位置 */
    function onDragMove(e: PointerEvent) {
        if (!dragState) return
        const container = (e.currentTarget as HTMLElement).closest('.buff-list-container') as HTMLElement | null
        if (!container) return

        const cr = container.getBoundingClientRect()
        const margin = 30
        const outside =
            e.clientX < cr.left - margin ||
            e.clientX > cr.right + margin ||
            e.clientY < cr.top - margin ||
            e.clientY > cr.bottom + margin

        if (outside) {
            dragState = { ...dragState, outside: true, dropIdx: -1 }
            return
        }

        let items: NodeListOf<HTMLElement>
        if (dragState.mode === 'child' && dragState.folderPrefix) {
            items = container.querySelectorAll(`[data-folder-child="${dragState.folderPrefix}"]`)
        } else {
            items = container.querySelectorAll('[data-buffset-id]:not([data-folder-child]), [data-folder-prefix]')
        }
        let dropIdx = items.length
        items.forEach((item, i) => {
            const r = item.getBoundingClientRect()
            if (e.clientY < r.top + r.height / 2 && dropIdx === items.length) dropIdx = i
        })
        dragState = { ...dragState, outside: false, dropIdx }
    }

    /** @desc 拖拽结束：拖出→删除（文件夹弹确认）；拖入→重排（folder 整组移动/child 组内移动/item 顶层移动）；原地→选中 */
    function onDragEnd(e: PointerEvent) {
        if (!dragState) return

        if (dragState.outside) {
            if (dragState.mode === 'folder') {
                const folder = groupedBuffSets.find((g) => g.type === 'folder' && g.prefix === dragState!.id)
                if (folder?.children && folder.children.length > 0) {
                    deleteFolderPrefix = dragState!.id
                    deleteFolderCount = folder.children.length
                    if (getConfirmDeletes()) {
                        showDeleteFolderConfirm = true
                    } else {
                        confirmDeleteFolder()
                    }
                }
                if (savedCollapsedState !== null) {
                    collapsedFolders = savedCollapsedState
                    savedCollapsedState = null
                }
                dragState = null
                return
            }
            deleteBuffSet(dragState.id)
            if (selectedBuffSetId === dragState.id) selectedBuffSetId = null
        } else if (dragState.dropIdx !== dragState.idx || dragState.mode === 'folder') {
            const container = (e.currentTarget as HTMLElement).closest('.buff-list-container') as HTMLElement | null
            if (container && (dragState.dropIdx !== dragState.idx || dragState.mode === 'folder')) {
                const reordered = computeNewOrder(container, dragState)
                if (reordered) reorderNonGlobalBuffSets(reordered)
            }
        } else {
            selectedBuffSetId = dragState.id
        }

        if (savedCollapsedState !== null) {
            collapsedFolders = savedCollapsedState
            savedCollapsedState = null
        }
        dragState = null
    }

    /** @desc 计算拖拽后的新顺序：folder=整组搬到 dropIdx 位置；child=组内重排；item=顶层重排 */
    function computeNewOrder(container: HTMLElement, state: DragState): string[] | null {
        if (state.mode === 'folder') {
            const prefix = state.id
            const draggedChildIds = [...container.querySelectorAll(`[data-folder-child="${prefix}"]`)]
                .map((el) => (el as HTMLElement).dataset.buffsetId!)
                .filter(Boolean)
            const allIds = [...container.querySelectorAll('[data-buffset-id]')]
                .map((el) => (el as HTMLElement).dataset.buffsetId!)
                .filter(Boolean)
            const withoutDragged = allIds.filter((id) => !draggedChildIds.includes(id))

            const topLevel = container.querySelectorAll(
                '[data-buffset-id]:not([data-folder-child]), [data-folder-prefix]'
            )
            let insertAt = 0
            let counted = 0
            for (const el of topLevel) {
                const htmlEl = el as HTMLElement
                if (counted === state.dropIdx) break
                const p = htmlEl.dataset.folderPrefix
                if (p) {
                    if (p !== prefix) {
                        insertAt += container.querySelectorAll(`[data-folder-child="${p}"]`).length
                    }
                } else {
                    insertAt += 1
                }
                counted++
            }

            withoutDragged.splice(insertAt, 0, ...draggedChildIds)
            return withoutDragged
        }

        if (state.mode === 'child' && state.folderPrefix) {
            const prefix = state.folderPrefix
            const childIds = [...container.querySelectorAll(`[data-folder-child="${prefix}"]`)]
                .map((el) => (el as HTMLElement).dataset.buffsetId!)
                .filter(Boolean)
            const reorderedChildren = childIds.filter((id) => id !== state.id)
            reorderedChildren.splice(state.dropIdx, 0, state.id)

            const allIds = [...container.querySelectorAll('[data-buffset-id]')]
                .map((el) => (el as HTMLElement).dataset.buffsetId!)
                .filter(Boolean)
            const result: string[] = []
            let replaced = false
            for (const id of allIds) {
                if (childIds.includes(id)) {
                    if (!replaced) {
                        result.push(...reorderedChildren)
                        replaced = true
                    }
                } else {
                    result.push(id)
                }
            }
            return result
        }

        const allIds = [...container.querySelectorAll('[data-buffset-id]')]
            .map((el) => (el as HTMLElement).dataset.buffsetId!)
            .filter(Boolean)
        const withoutDragged = allIds.filter((id) => id !== state.id)
        withoutDragged.splice(state.dropIdx, 0, state.id)
        return withoutDragged
    }

    /** @desc 确认删除文件夹：删除其全部子 Buff 并清空选中 */
    function confirmDeleteFolder() {
        const folder = groupedBuffSets.find((g) => g.type === 'folder' && g.prefix === deleteFolderPrefix)
        if (folder?.children) {
            for (const child of folder.children) {
                deleteBuffSet(child.id)
            }
        }
        if (selectedBuffSetId && folder?.children?.some((c) => c.id === selectedBuffSetId)) {
            selectedBuffSetId = null
        }
        showDeleteFolderConfirm = false
        deleteFolderPrefix = ''
        deleteFolderCount = 0
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
        const children = (folder.children ?? []).map((c) => c.id)
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

    /** @desc 单个 buff 右键菜单项：多选状态 → 批量操作；否则 → 收藏/重命名/复制/全局/删除 */
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
        const items: { label: string; action: () => void; icon: string; disabled?: boolean }[] = [
            {
                label: bs.starred ? '取消收藏' : '收藏',
                icon: bs.starred ? 'mdi:star' : 'mdi:star-outline',
                disabled: isDefaultGlobal,
                action: () => toggleBuffSetStarred(id)
            }
        ]
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
        const ids = (folder.children ?? []).map((c) => c.id)
        if (ids.length === 0) return
        setBuffSetsGlobal(ids, true)
        addToast(`已将「${folder.name}」的 ${ids.length} 条 BUFF 并入全局`, 'success')
    }

    /** @desc 文件夹整体移出全局（所有子 Buff 一次性移出） */
    function moveFolderOutOfGlobal(folder: GroupedBuffSetItem) {
        const ids = (folder.children ?? []).map((c) => c.id)
        if (ids.length === 0) return
        setBuffSetsGlobal(ids, false)
        addToast(`已将「${folder.name}」的 ${ids.length} 条 BUFF 移出全局`, 'info')
    }

    /** @desc 确认文件夹批量重命名：子 Buff 依次命名为 新前缀+1..N+新后缀 */
    function confirmFolderRename() {
        const folder = folderRenameTarget
        if (!folder?.children) return
        const prefix = folderRenamePrefix.trim()
        const suffix = folderRenameSuffix.trim()
        if (!prefix && !suffix) {
            addToast('前缀与后缀不能同时为空', 'error')
            return
        }
        folder.children.forEach((child, i) => {
            renameBuffSet(child.id, `${prefix}${i + 1}${suffix}`)
        })
        addToast(`已批量重命名 ${folder.children.length} 条 BUFF`, 'success')
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

    /** @desc 多选模式切换整个文件夹勾选（全部子 buff；内置全局块跳过） */
    function toggleMultiSelectFolder(folder: GroupedBuffSetItem) {
        const childIds = (folder.children ?? []).map((c) => c.id).filter((id) => !isMultiSelectDisabled(id))
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
            class="animate-pop-in w-full max-h-[95vh] h-full max-w-6xl rounded-xl border text-(--theme-modal-text) shadow-xl overflow-hidden flex flex-col my-4"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
        >
            <!-- @desc 标题栏：BUFF 配置 + 导入Buff集/速查入口 -->
            <div
                class="flex items-center justify-between px-5 py-3 border-b"
                style="border-bottom: 1px solid var(--theme-divider-border);"
            >
                <h2 class="text-sm font-semibold">BUFF 配置</h2>
                <div class="flex items-center gap-1">
                    <button
                        onclick={() => (showImport = true)}
                        class="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-modal-text)/5"
                    >
                        <Icon icon="mdi:import" class="size-3.5" />
                        导入Buff集
                    </button>
                    <button
                        onclick={() => (showLookup = true)}
                        class="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-modal-text)/5"
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
                                {@const isGlobalFolder = item.prefix === 'global'}
                                {@const topIdx = topLevelIdxMap.get(item.prefix!)}
                                {@const folderHasStar = item.children!.some((c) => c.starred)}
                                {#if !isGlobalFolder && dragState && dragState.mode !== 'child' && !dragState.outside && dragState.dropIdx === topIdx}
                                    <div class="mx-2 h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                                {/if}
                                <!-- 展开的文件夹头在滚动时贴顶吸附（类似表格表头）：实底 + 铺满容器宽度；
                                    吸附范围 = 整个文件夹块（头 + 子项），子项全部滚出后头随块释放 -->
                                <div class="px-2">
                                    <div
                                        class={[
                                            'flex min-w-0 items-center gap-1',
                                            !collapsedFolders.has(item.prefix!)
                                                ? 'sticky top-0 z-10 -mx-2 px-2 py-1 bg-(--theme-modal-bg) shadow-[0_1px_0_0_var(--theme-divider-border)]'
                                                : ''
                                        ].join(' ')}
                                    >
                                        <button
                                            data-folder-prefix={item.prefix}
                                            onclick={() =>
                                                multiSelect
                                                    ? toggleMultiSelectFolder(item)
                                                    : toggleFolder(item.prefix!)}
                                            oncontextmenu={multiSelect ? undefined : (e) => openFolderMenu(e, item)}
                                            onpointerdown={isGlobalFolder || multiSelect
                                                ? undefined
                                                : (e) => startDrag(e, item.prefix!, 'folder')}
                                            onpointermove={isGlobalFolder || multiSelect ? undefined : onDragMove}
                                            onpointerup={isGlobalFolder || multiSelect ? undefined : onDragEnd}
                                            class={[
                                                'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-xs text-left transition-all',
                                                multiSelect && !isGlobalFolder && folderAllSelected(item.children ?? [])
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
                                                    icon={folderAllSelected(item.children ?? [])
                                                        ? 'mdi:checkbox-marked'
                                                        : 'mdi:checkbox-blank-outline'}
                                                    class="size-4 shrink-0 text-(--theme-accent-text)"
                                                />
                                            {:else}
                                                <Icon
                                                    icon={isGlobalFolder
                                                        ? 'mdi:crown'
                                                        : collapsedFolders.has(item.prefix!)
                                                          ? 'mdi:folder'
                                                          : 'mdi:folder-open'}
                                                    class={[
                                                        'size-4 shrink-0',
                                                        isGlobalFolder
                                                            ? 'text-amber-400'
                                                            : `drag-handle touch-none select-none cursor-grab active:cursor-grabbing ${
                                                                  folderHasStar ? 'text-amber-400' : 'opacity-60'
                                                              }`
                                                    ].join(' ')}
                                                />
                                            {/if}
                                            <span class="truncate flex-1">{item.name}</span>
                                        </button>
                                        {#if !multiSelect}
                                            <button
                                                type="button"
                                                class="shrink-0 rounded p-0.5 text-(--theme-modal-text)/40 transition-colors hover:bg-(--theme-modal-text)/10 hover:text-(--theme-modal-text)"
                                                title="文件夹操作"
                                                onclick={(e) => openFolderMenu(e, item)}
                                                oncontextmenu={(e) => openFolderMenu(e, item)}
                                            >
                                                <Icon icon="mdi:dots-horizontal" class="size-4" />
                                            </button>
                                        {/if}
                                    </div>
                                    {#if !collapsedFolders.has(item.prefix!)}
                                        <div
                                            class="ml-3 mt-1 space-y-1 border-l pl-2"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            {#if isGlobalFolder}
                                                <!-- 全局区嵌套分组：叠层 buff 移入全局后仍保持文件夹形态（皇冠，不可拖拽） -->
                                                {#each groupBuffSets(item.children!) as sub (sub.key)}
                                                    {#if sub.type === 'folder'}
                                                        {@const subKey = 'global:' + sub.prefix}
                                                        <div class="space-y-1">
                                                            <!-- 全局内部文件夹头同样贴顶吸附：top-10 避开上方全局头（40px 高），
                                             -mx-2 px-2 铺满自身宽度并保持内容不跳位 -->
                                                            <div
                                                                class={[
                                                                    'flex min-w-0 items-center gap-1',
                                                                    !collapsedFolders.has(subKey)
                                                                        ? 'sticky top-10 z-10 -mx-2 px-2 py-1 bg-(--theme-modal-bg) shadow-[0_1px_0_0_var(--theme-divider-border)]'
                                                                        : ''
                                                                ].join(' ')}
                                                            >
                                                                <button
                                                                    class="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-left transition-all text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5 {multiSelect &&
                                                                    folderAllSelected(sub.children ?? [])
                                                                        ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                                        : ''}"
                                                                    onclick={() =>
                                                                        multiSelect
                                                                            ? toggleMultiSelectFolder(sub)
                                                                            : toggleFolder(subKey)}
                                                                    oncontextmenu={multiSelect
                                                                        ? undefined
                                                                        : (e) => openFolderMenu(e, sub)}
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
                                                                            icon={collapsedFolders.has(subKey)
                                                                                ? 'mdi:folder'
                                                                                : 'mdi:folder-open'}
                                                                            class="size-3.5 shrink-0 text-amber-400/70"
                                                                        />
                                                                    {/if}
                                                                    <span class="truncate flex-1">{sub.name}</span>
                                                                </button>
                                                                {#if !multiSelect}
                                                                    <button
                                                                        type="button"
                                                                        class="shrink-0 rounded p-0.5 text-(--theme-modal-text)/40 transition-colors hover:bg-(--theme-modal-text)/10 hover:text-(--theme-modal-text)"
                                                                        title="文件夹操作"
                                                                        onclick={(e) => openFolderMenu(e, sub)}
                                                                        oncontextmenu={(e) => openFolderMenu(e, sub)}
                                                                    >
                                                                        <Icon
                                                                            icon="mdi:dots-horizontal"
                                                                            class="size-3.5"
                                                                        />
                                                                    </button>
                                                                {/if}
                                                            </div>
                                                            {#if !collapsedFolders.has(subKey)}
                                                                <div
                                                                    class="ml-2 space-y-1 border-l pl-2"
                                                                    style="border-color: var(--theme-divider-border);"
                                                                >
                                                                    {#each sub.children! as subChild (subChild.id)}
                                                                        <button
                                                                            onclick={() =>
                                                                                multiSelect
                                                                                    ? isMultiSelectDisabled(
                                                                                          subChild.id
                                                                                      ) ||
                                                                                      toggleMultiSelectId(subChild.id)
                                                                                    : (selectedBuffSetId = subChild.id)}
                                                                            oncontextmenu={(e) =>
                                                                                openItemMenu(e, subChild.id)}
                                                                            class={[
                                                                                'flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-xs text-left transition-all',
                                                                                multiSelect &&
                                                                                isMultiSelectDisabled(subChild.id)
                                                                                    ? 'text-(--theme-modal-text)/30 opacity-50'
                                                                                    : multiSelect
                                                                                      ? multiSelectedIds.has(
                                                                                            subChild.id
                                                                                        )
                                                                                          ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                                                          : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5'
                                                                                      : selectedBuffSetId ===
                                                                                          subChild.id
                                                                                        ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                                                        : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5'
                                                                            ].join(' ')}
                                                                        >
                                                                            {#if multiSelect}
                                                                                <Icon
                                                                                    icon={isMultiSelectDisabled(
                                                                                        subChild.id
                                                                                    )
                                                                                        ? 'mdi:checkbox-blank-off-outline'
                                                                                        : multiSelectedIds.has(
                                                                                                subChild.id
                                                                                            )
                                                                                          ? 'mdi:checkbox-marked'
                                                                                          : 'mdi:checkbox-blank-outline'}
                                                                                    class="size-4 shrink-0 text-(--theme-accent-text)"
                                                                                />
                                                                            {:else}
                                                                                <Icon
                                                                                    icon="mdi:crown"
                                                                                    class="size-4 shrink-0 text-amber-400"
                                                                                />
                                                                            {/if}
                                                                            <span class="truncate flex-1"
                                                                                >{subChild.name}</span
                                                                            >
                                                                            {#if subChild.scope === 'all'}
                                                                                <span
                                                                                    class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                                                                    >(通用)</span
                                                                                >
                                                                            {:else if Array.isArray(subChild.scope) && subChild.scope.length === 0}
                                                                                <span
                                                                                    class="text-[10px] text-(--theme-accent-text)/50 whitespace-nowrap"
                                                                                    >(效应)</span
                                                                                >
                                                                            {:else}
                                                                                <span
                                                                                    class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                                                                    >({teamNames
                                                                                        .filter((_, i) =>
                                                                                            (
                                                                                                subChild.scope as number[]
                                                                                            ).includes(i)
                                                                                        )
                                                                                        .join(', ')})</span
                                                                                >
                                                                            {/if}
                                                                        </button>
                                                                    {/each}
                                                                </div>
                                                            {/if}
                                                        </div>
                                                    {:else}
                                                        <button
                                                            onclick={() =>
                                                                multiSelect
                                                                    ? isMultiSelectDisabled(sub.buffSet!.id) ||
                                                                      toggleMultiSelectId(sub.buffSet!.id)
                                                                    : (selectedBuffSetId = sub.buffSet!.id)}
                                                            oncontextmenu={(e) => openItemMenu(e, sub.buffSet!.id)}
                                                            class={[
                                                                'flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-xs text-left transition-all',
                                                                multiSelect && isMultiSelectDisabled(sub.buffSet!.id)
                                                                    ? 'text-(--theme-modal-text)/30 opacity-50'
                                                                    : multiSelect
                                                                      ? multiSelectedIds.has(sub.buffSet!.id)
                                                                          ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                                          : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5'
                                                                      : selectedBuffSetId === sub.buffSet!.id
                                                                        ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                                        : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5'
                                                            ].join(' ')}
                                                        >
                                                            {#if multiSelect}
                                                                <Icon
                                                                    icon={isMultiSelectDisabled(sub.buffSet!.id)
                                                                        ? 'mdi:checkbox-blank-off-outline'
                                                                        : multiSelectedIds.has(sub.buffSet!.id)
                                                                          ? 'mdi:checkbox-marked'
                                                                          : 'mdi:checkbox-blank-outline'}
                                                                    class="size-4 shrink-0 text-(--theme-accent-text)"
                                                                />
                                                            {:else}
                                                                <Icon
                                                                    icon="mdi:crown"
                                                                    class="size-4 shrink-0 text-amber-400"
                                                                />
                                                            {/if}
                                                            <span class="truncate flex-1">{sub.buffSet!.name}</span>
                                                            {#if sub.buffSet!.scope === 'all'}
                                                                <span
                                                                    class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                                                    >(通用)</span
                                                                >
                                                            {:else if Array.isArray(sub.buffSet!.scope) && sub.buffSet!.scope.length === 0}
                                                                <span
                                                                    class="text-[10px] text-(--theme-accent-text)/50 whitespace-nowrap"
                                                                    >(效应)</span
                                                                >
                                                            {:else}
                                                                <span
                                                                    class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                                                    >({teamNames
                                                                        .filter((_, i) =>
                                                                            (sub.buffSet!.scope as number[]).includes(i)
                                                                        )
                                                                        .join(', ')})</span
                                                                >
                                                            {/if}
                                                        </button>
                                                    {/if}
                                                {/each}
                                            {:else}
                                                {#each item.children! as child, ci (child.id)}
                                                    {#if !isGlobalFolder && dragState && dragState.mode === 'child' && dragState.folderPrefix === item.prefix && !dragState.outside && dragState.dropIdx === ci}
                                                        <div class="h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                                                    {/if}
                                                    <button
                                                        data-buffset-id={child.id}
                                                        data-folder-child={item.prefix}
                                                        onclick={() => {
                                                            if (multiSelect && !isGlobalFolder) {
                                                                toggleMultiSelectId(child.id)
                                                            } else {
                                                                selectedBuffSetId = child.id
                                                            }
                                                        }}
                                                        oncontextmenu={(e) => openItemMenu(e, child.id)}
                                                        onpointerdown={isGlobalFolder || multiSelect
                                                            ? undefined
                                                            : (e) => startDrag(e, child.id, 'child', item.prefix)}
                                                        onpointermove={isGlobalFolder || multiSelect
                                                            ? undefined
                                                            : onDragMove}
                                                        onpointerup={isGlobalFolder || multiSelect
                                                            ? undefined
                                                            : onDragEnd}
                                                        class={[
                                                            'flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-xs text-left transition-all',
                                                            multiSelect && !isGlobalFolder
                                                                ? multiSelectedIds.has(child.id)
                                                                    ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                                    : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5'
                                                                : selectedBuffSetId === child.id
                                                                  ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                                  : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5',
                                                            !isGlobalFolder &&
                                                                !multiSelect &&
                                                                dragState?.id === child.id &&
                                                                !dragState.outside &&
                                                                'ring-2 ring-(--theme-accent-bg)',
                                                            !isGlobalFolder &&
                                                                !multiSelect &&
                                                                dragState?.id === child.id &&
                                                                dragState.outside &&
                                                                'ring-2 ring-red-500 opacity-50'
                                                        ].join(' ')}
                                                        transition:slide={{ duration: 200 }}
                                                    >
                                                        {#if multiSelect && !isGlobalFolder}
                                                            <Icon
                                                                icon={multiSelectedIds.has(child.id)
                                                                    ? 'mdi:checkbox-marked'
                                                                    : 'mdi:checkbox-blank-outline'}
                                                                class="size-4 shrink-0 text-(--theme-accent-text)"
                                                            />
                                                        {:else}
                                                            <Icon
                                                                icon={isGlobalFolder
                                                                    ? 'mdi:crown'
                                                                    : child.starred
                                                                      ? 'mdi:star'
                                                                      : 'mdi:widgets'}
                                                                class={[
                                                                    'size-4 shrink-0',
                                                                    isGlobalFolder
                                                                        ? 'text-amber-400'
                                                                        : `drag-handle touch-none select-none cursor-grab active:cursor-grabbing ${
                                                                              child.starred
                                                                                  ? 'text-amber-400'
                                                                                  : 'opacity-60'
                                                                          }`
                                                                ].join(' ')}
                                                            />
                                                        {/if}
                                                        <span class="truncate flex-1">{child.name}</span>
                                                        {#if child.scope === 'all'}
                                                            <span
                                                                class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                                                >(通用)</span
                                                            >
                                                        {:else if Array.isArray(child.scope) && child.scope.length === 0}
                                                            <span
                                                                class="text-[10px] text-(--theme-accent-text)/50 whitespace-nowrap"
                                                                >(效应)</span
                                                            >
                                                        {:else}
                                                            <span
                                                                class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                                                >({teamNames
                                                                    .filter((_, i) =>
                                                                        (child.scope as number[]).includes(i)
                                                                    )
                                                                    .join(', ')})</span
                                                            >
                                                        {/if}
                                                    </button>
                                                {/each}
                                            {/if}
                                            {#if !isGlobalFolder && dragState && dragState.mode === 'child' && dragState.folderPrefix === item.prefix && !dragState.outside && dragState.dropIdx === item.children!.length}
                                                <div class="h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                            {:else}
                                {@const isGlobal = globalBuffSetIds.includes(item.buffSet!.id)}
                                {#if !isGlobal}
                                    {@const topIdx = topLevelIdxMap.get(item.buffSet!.id)}
                                    {#if dragState && dragState.mode !== 'child' && !dragState.outside && dragState.dropIdx === topIdx}
                                        <div class="mx-2 h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                                    {/if}
                                {/if}
                                <button
                                    data-buffset-id={isGlobal ? undefined : item.buffSet!.id}
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
                                        : (e) => startDrag(e, item.buffSet!.id, 'item')}
                                    onpointermove={isGlobal || multiSelect ? undefined : onDragMove}
                                    onpointerup={isGlobal || multiSelect ? undefined : onDragEnd}
                                    class={[
                                        'mx-2 flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-xs text-left transition-all',
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
                                            icon={isGlobal
                                                ? 'mdi:crown'
                                                : item.buffSet!.starred
                                                  ? 'mdi:star'
                                                  : 'mdi:widgets'}
                                            class={[
                                                'size-4 shrink-0',
                                                !isGlobal && item.buffSet!.starred ? 'text-amber-400' : 'opacity-60',
                                                isGlobal
                                                    ? ''
                                                    : 'drag-handle touch-none select-none cursor-grab active:cursor-grabbing'
                                            ]
                                                .filter(Boolean)
                                                .join(' ')}
                                        />
                                    {/if}
                                    <span class="truncate flex-1">{item.buffSet!.name}</span>
                                    {#if !isGlobal}
                                        {#if item.buffSet!.scope === 'all'}
                                            <span class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                                >(通用)</span
                                            >
                                        {:else if Array.isArray(item.buffSet!.scope) && item.buffSet!.scope.length === 0}
                                            <span class="text-[10px] text-(--theme-accent-text)/50 whitespace-nowrap"
                                                >(效应)</span
                                            >
                                        {:else}
                                            <span class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                                >({teamNames
                                                    .filter((_, i) => (item.buffSet!.scope as number[]).includes(i))
                                                    .join(', ')})</span
                                            >
                                        {/if}
                                    {/if}
                                </button>
                            {/if}
                        {/each}
                        {#if dragState && dragState.mode !== 'child' && !dragState.outside && dragState.dropIdx === topLevelCount}
                            <div class="h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                        {/if}
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
                                    'flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
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
                                    class="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/5"
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
                                        disabled={!multiSelectionAllNonGlobal()}
                                        onclick={() => multiSetGlobal(true)}
                                        class={[
                                            'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors',
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
                                            'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors',
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
                                        class="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[11px] text-red-400 transition-colors hover:bg-red-500/10"
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
                                class="flex w-full items-center justify-center gap-1 rounded border px-2 py-1.5 text-xs font-medium transition-all hover:brightness-125"
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
                                            class="shrink-0 rounded p-1 text-amber-400/40 cursor-not-allowed"
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
                                                class="flex-1 min-w-0 rounded border px-2 py-1.5 text-xs font-medium outline-none text-(--theme-modal-text) cursor-default"
                                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                            />
                                        {:else}
                                            <input
                                                type="text"
                                                bind:this={renameInputEl}
                                                bind:value={renameValue}
                                                onkeydown={(e) => e.key === 'Enter' && handleRenameInline()}
                                                onblur={handleRenameInline}
                                                class="flex-1 min-w-0 rounded border px-2 py-1.5 text-xs font-medium outline-none text-(--theme-modal-text)"
                                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                            />
                                        {/if}
                                        {#if !isDefaultGlobal}
                                            <button
                                                onclick={handleToggleGlobal}
                                                class="shrink-0 flex items-center gap-1 rounded border px-2 py-1.5 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-accent-bg)/10"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                <Icon icon="mdi:crown" class="size-3.5" />
                                                移出全局
                                            </button>
                                        {/if}
                                    {:else}
                                        <button
                                            onclick={() => toggleBuffSetStarred(selectedBuffSet.id)}
                                            class="shrink-0 rounded p-1 transition-colors text-amber-400 hover:text-amber-300"
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
                                            class="flex-1 min-w-0 rounded border px-2 py-1.5 text-xs font-medium outline-none text-(--theme-modal-text)"
                                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                        />
                                        <button
                                            onclick={handleCopyBuffSet}
                                            class="shrink-0 flex items-center gap-1 rounded border px-2 py-1.5 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-accent-bg)/10"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            <Icon icon="mdi:content-copy" class="size-3.5" />
                                            复制
                                        </button>
                                        <button
                                            onclick={handleToggleGlobal}
                                            class="shrink-0 flex items-center gap-1 rounded border px-2 py-1.5 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-accent-bg)/10"
                                            style="border-color: var(--theme-divider-border);"
                                            title="并入全局（全局 buff 的受益者将被锁定）"
                                        >
                                            <Icon icon="mdi:crown" class="size-3.5" />
                                            并入全局
                                        </button>
                                        <button
                                            onclick={handleDeleteBuffSet}
                                            class="shrink-0 flex items-center gap-1 rounded border border-red-500 px-2 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/20"
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
                                                        class="w-full h-full flex items-center justify-center text-[9px] font-bold text-(--theme-modal-text)/50"
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
                                                'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-all whitespace-nowrap',
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

                                <!-- @desc 生效条件区：折叠面板内配置 共鸣链/精炼/参考角色/伤害属性/伤害类型 -->
                                <!-- 生效条件 -->
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
                                        title={isDefaultGlobal ? '生效条件（默认全局buff不可配置）' : '生效条件'}
                                    >
                                        <Icon
                                            icon={condPanelOpen ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                                            class="size-3.5 shrink-0 text-(--theme-modal-text)/40"
                                        />
                                        <span class="shrink-0">生效条件</span>
                                        {#if conditionSummary}
                                            <span class="min-w-0 truncate text-[11px]">：{conditionSummary}</span>
                                        {/if}
                                    </button>
                                    {#if condPanelOpen}
                                        {@const cond = selectedBuffSet.condition ?? {}}
                                        <div
                                            transition:slide|local={{ duration: 200 }}
                                            class="flex flex-wrap items-center gap-2 px-3 pb-2.5"
                                        >
                                            {#if isDefaultGlobal}
                                                <span class="text-[10px] text-(--theme-modal-text)/35"
                                                    >默认全局buff无法设置生效条件</span
                                                >
                                            {/if}
                                            <!-- 共鸣链 -->
                                            <div class="flex items-center gap-1.5">
                                                <span
                                                    class="flex h-6 items-center text-[10px] text-(--theme-modal-text)/60"
                                                    >共鸣链</span
                                                >
                                                <div
                                                    class="flex overflow-hidden rounded border"
                                                    style="border-color: var(--theme-divider-border);"
                                                >
                                                    {#each Array.from({ length: 7 }, (_, k) => k) as n}
                                                        <button
                                                            onclick={() => setBuffChain(n)}
                                                            class={[
                                                                'flex h-6 min-w-6 items-center justify-center px-1 text-[11px] transition-colors',
                                                                cond.chain === n
                                                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                                    : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                                            ].join(' ')}
                                                        >
                                                            {n}
                                                        </button>
                                                    {/each}
                                                </div>
                                                {#if cond.chain !== undefined}
                                                    <span
                                                        class="flex h-6 items-center text-[10px] font-medium text-(--theme-accent-text)"
                                                        >≥{cond.chain}链</span
                                                    >
                                                {/if}
                                            </div>
                                            <!-- 武器精炼 -->
                                            <div class="flex items-center gap-1.5">
                                                <span
                                                    class="flex h-6 items-center text-[10px] text-(--theme-modal-text)/60"
                                                    >精炼</span
                                                >
                                                <div
                                                    class="flex overflow-hidden rounded border"
                                                    style="border-color: var(--theme-divider-border);"
                                                >
                                                    {#each Array.from({ length: 5 }, (_, k) => k + 1) as n}
                                                        <button
                                                            onclick={() => setBuffRefinement(n)}
                                                            class={[
                                                                'flex h-6 min-w-6 items-center justify-center px-1 text-[11px] transition-colors',
                                                                cond.refinement === n
                                                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                                    : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                                            ].join(' ')}
                                                        >
                                                            {n}
                                                        </button>
                                                    {/each}
                                                </div>
                                                {#if cond.refinement}
                                                    <span
                                                        class="flex h-6 items-center text-[10px] font-medium text-(--theme-accent-text)"
                                                        >≥{cond.refinement}阶</span
                                                    >
                                                {/if}
                                            </div>
                                            <!-- 参考角色（仅共鸣链 / 精炼需要） -->
                                            {#if cond.chain !== undefined || cond.refinement !== undefined}
                                                <div class="flex items-center gap-1">
                                                    <span
                                                        class="flex h-6 items-center text-[10px] text-(--theme-modal-text)/50"
                                                        >参考角色</span
                                                    >
                                                    {#each team as slot, i}
                                                        <button
                                                            onclick={() => setConditionRef(i)}
                                                            class={[
                                                                'size-6 rounded-full overflow-hidden border-2 transition-all',
                                                                (selectedBuffSet.conditionRefCharIdx ?? 0) === i
                                                                    ? 'border-(--theme-accent-bg)'
                                                                    : 'border-(--theme-divider-border) grayscale opacity-40 hover:opacity-70'
                                                            ].join(' ')}
                                                            title={`看 ${slot.character ?? `角色 ${i + 1}`} 的链 / 精炼`}
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
                                                                    class="w-full h-full flex items-center justify-center text-[8px] font-bold text-(--theme-modal-text)/50"
                                                                    >{slot.character?.charAt(0) ?? '?'}</span
                                                                >
                                                            {/if}
                                                        </button>
                                                    {/each}
                                                </div>
                                            {/if}
                                            <!-- 伤害属性 -->
                                            <div class="flex flex-wrap items-center gap-1">
                                                <span
                                                    class="flex h-6 items-center text-[10px] text-(--theme-modal-text)/60"
                                                    >伤害属性</span
                                                >
                                                {#each ELEMENTS as el}
                                                    <button
                                                        onclick={() => toggleConditionElement(el)}
                                                        class={[
                                                            'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                                                            (cond.elements ?? []).includes(el)
                                                                ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                                : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                                        ].join(' ')}
                                                    >
                                                        {el}
                                                    </button>
                                                {/each}
                                            </div>
                                            <!-- 伤害类型 -->
                                            <div class="flex flex-wrap items-center gap-1">
                                                <span
                                                    class="flex h-6 items-center text-[10px] text-(--theme-modal-text)/60"
                                                    >伤害类型</span
                                                >
                                                {#each DAMAGE_TYPES as dt}
                                                    <button
                                                        onclick={() => toggleConditionDamageType(dt)}
                                                        title={dt}
                                                        class={[
                                                            'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                                                            (cond.damageTypes ?? []).includes(dt)
                                                                ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                                : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                                        ].join(' ')}
                                                    >
                                                        {DAMAGE_TYPE_SHORT[dt] ?? dt}
                                                    </button>
                                                {/each}
                                            </div>
                                            <button
                                                onclick={clearCondition}
                                                class="flex h-6 items-center gap-1 rounded border px-2 text-[10px] text-(--theme-modal-text)/40 transition-colors hover:border-red-500/40 hover:text-red-500"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                <Icon icon="mdi:close-circle-outline" class="size-3" />
                                                清除
                                            </button>
                                        </div>
                                    {/if}
                                </div>

                                <!-- @desc 乘区列表：已配置乘区的数值输入/引用展示/追加覆盖切换/引用配置入口 -->
                                <!-- Zone list -->
                                <div class="theme-scrollbar flex-1 overflow-y-auto p-3 space-y-1">
                                    {#each selectedBuffSet.zones as zone}
                                        {@const def = ZONE_MAP.get(zone.zoneId)}
                                        {#if def}
                                            <div
                                                class="flex items-center gap-1.5 rounded px-3 py-2"
                                                style="background: var(--theme-input-bg);"
                                            >
                                                <span class="shrink-0 text-xs text-(--theme-modal-text) truncate"
                                                    >{def.label}</span
                                                >
                                                {#if zone.ref}
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
                                                                setBuffSetZoneValue(
                                                                    selectedBuffSet.id,
                                                                    zone.zoneId,
                                                                    isNaN(v) ? 0 : v
                                                                )
                                                            }}
                                                            class="w-14 h-6 rounded border bg-transparent px-1.5 text-xs text-right tabular-nums text-(--theme-modal-text) outline-none"
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
                                                            setBuffSetZoneOverride(
                                                                selectedBuffSet.id,
                                                                zone.zoneId,
                                                                !zone.override
                                                            )}
                                                        class={[
                                                            'shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5',
                                                            zone.override
                                                                ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                                                : 'border-transparent text-(--theme-modal-text)/30 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/60'
                                                        ].join(' ')}
                                                    >
                                                        <Icon icon="mdi:swap-horizontal-bold" class="size-3" />
                                                        {zone.override ? '覆盖' : '追加'}
                                                    </button>
                                                {/if}
                                                <button
                                                    onclick={() => openRefModal(zone.zoneId)}
                                                    class="shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5"
                                                    style="border-color: var(--theme-divider-border);"
                                                >
                                                    <Icon icon="mdi:link-variant" class="size-3" />
                                                    引用
                                                </button>
                                            </div>
                                        {/if}
                                    {/each}
                                    {#if selectedBuffSet.zones.length === 0}
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
                        <!-- @desc 右栏乘区清单：全部可配置乘区，点击加入/移出当前 Buff -->
                        {#if selectedBuffSet}
                            <div
                                class="w-52 shrink-0 border-l flex flex-col"
                                style="border-left: 1px solid var(--theme-divider-border);"
                            >
                                <div class="theme-scrollbar flex-1 overflow-y-auto p-3">
                                    <div class="flex flex-col gap-0.5">
                                        {#each ZONE_DEFS as def}
                                            {@const exists = selectedBuffSet.zones.some((z) => z.zoneId === def.id)}
                                            <button
                                                onclick={() => {
                                                    if (exists) {
                                                        removeZoneFromBuffSet(selectedBuffSet.id, def.id)
                                                    } else {
                                                        addZoneToBuffSet(selectedBuffSet.id, def.id)
                                                    }
                                                }}
                                                class={[
                                                    'w-full text-left rounded px-2 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1.5',
                                                    exists
                                                        ? 'bg-(--theme-accent-bg)/20 text-(--theme-accent-text)'
                                                        : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/5'
                                                ].join(' ')}
                                            >
                                                <Icon
                                                    icon={exists ? 'mdi:check' : 'mdi:circle-outline'}
                                                    class="size-3.5 shrink-0"
                                                />
                                                {def.label}
                                            </button>
                                        {/each}
                                    </div>
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
                            class="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all hover:brightness-125"
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
            class="animate-pop-in rounded-xl border p-5 shadow-xl w-[28rem]"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <div class="flex items-center justify-between mb-5">
                <h3 class="text-sm font-semibold">引用配置</h3>
                <button
                    onclick={() => (showRefLookup = true)}
                    class="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-modal-text)/5"
                >
                    <Icon icon="mdi:magnify" class="size-3.5" />
                    速查
                </button>
            </div>

            <div class="space-y-4">
                <!-- Character selector (top) -->
                <div>
                    <label class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">引用角色</label>
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
                                        class="w-full h-full flex items-center justify-center text-xs font-bold text-(--theme-modal-text)/50"
                                        >{slot.character?.charAt(0) ?? '?'}</span
                                    >
                                {/if}
                            </button>
                        {/each}
                    </div>
                </div>

                <!-- Zone selector (below) -->
                <div>
                    <label class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">引用属性</label>
                    <div class="relative">
                        <button
                            onclick={() => (showRefZoneMenu = !showRefZoneMenu)}
                            class="w-full flex items-center justify-between rounded-lg border px-3 py-2 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/5"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <span class="truncate">{refTargetDef?.label ?? refTargetZoneId}</span>
                            <Icon icon="mdi:chevron-down" class="size-3.5 shrink-0 text-(--theme-modal-text)/40" />
                        </button>
                        {#if showRefZoneMenu}
                            <div
                                class="theme-scrollbar absolute left-0 top-full z-10 mt-1.5 w-full max-h-60 overflow-y-auto rounded-lg border bg-(--theme-modal-bg) py-1 shadow-xl backdrop-blur-lg"
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
                        class="rounded-lg border px-4 py-3.5 space-y-3"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        <!-- Header: refAttr -->
                        <div class="text-xs text-(--theme-modal-text)/60">
                            <span class="font-medium text-(--theme-modal-text)/80">{refTargetDef.label}</span>
                        </div>

                        <!-- Line 1: 超过 [threshold] unit1 的部分 -->
                        <div
                            class="flex items-center rounded-md border overflow-hidden"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <button
                                onclick={() => {
                                    refHasThreshold = !refHasThreshold
                                }}
                                class={[
                                    'px-3 py-1.5 text-xs font-medium transition-all',
                                    refHasThreshold
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
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
                            class="flex rounded-md border overflow-hidden"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <button
                                onclick={() => {
                                    refIsDiscrete = false
                                }}
                                class={[
                                    'flex-1 px-3 py-1.5 text-xs font-medium transition-all',
                                    !refIsDiscrete
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
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
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
                                        : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                                ].join(' ')}
                            >
                                离散地
                            </button>
                        </div>

                        <!-- Line 2: 每 [divisor] unit1 转换为 [multiplier] unit2 -->
                        <div
                            class="flex items-center rounded-md border overflow-hidden"
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
                        class="flex items-center flex-1 rounded-md border overflow-hidden"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <button
                            onclick={() => {
                                refHasLower = !refHasLower
                            }}
                            class={[
                                'px-3 py-1.5 text-xs font-medium transition-all',
                                refHasLower
                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
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
                        class="flex items-center flex-1 rounded-md border overflow-hidden"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <button
                            onclick={() => {
                                refHasUpper = !refHasUpper
                            }}
                            class={[
                                'px-3 py-1.5 text-xs font-medium transition-all',
                                refHasUpper
                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
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
                    class="rounded-md px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/15"
                    >清除引用</button
                >
                <div class="flex items-center gap-2">
                    <button
                        onclick={() => (showRefModal = false)}
                        class="rounded-md px-3 py-1.5 text-xs text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/10"
                        >取消</button
                    >
                    <button
                        onclick={handleConfirmRef}
                        class="rounded-md px-4 py-1.5 text-xs transition-all hover:brightness-125 shadow-sm"
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
            class="animate-pop-in rounded-xl border p-5 shadow-xl w-80"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="text-sm font-semibold mb-2">确认删除文件夹</h3>
            <p class="text-xs text-(--theme-modal-text)/60 mb-4">
                将删除该文件夹内的所有 <strong>{deleteFolderCount}</strong> 条 BUFF，确定吗？
            </p>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (showDeleteFolderConfirm = false)}
                    class="h-7 rounded-md px-3 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                    style="background: var(--theme-input-bg);">取消</button
                >
                <button
                    onclick={confirmDeleteFolder}
                    class="h-7 rounded-md px-3 text-xs transition-all hover:brightness-125"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
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
            class="animate-pop-in rounded-xl border p-5 shadow-xl w-96"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="text-sm font-semibold mb-2">批量重命名文件夹</h3>
            <p class="text-xs text-(--theme-modal-text)/60 mb-3">
                「{folderRenameTarget.name}」内的 <strong>{folderRenameTarget.children!.length}</strong> 条 BUFF 将按 「新前缀
                + 序号 + 新后缀」重新编号
            </p>
            <div class="flex items-center gap-2 mb-1">
                <input
                    type="text"
                    bind:value={folderRenamePrefix}
                    placeholder="新前缀"
                    class="flex-1 min-w-0 rounded-md border px-2 py-1.5 text-xs outline-none text-(--theme-modal-text)"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                />
                <span class="text-xs text-(--theme-modal-text)/40 shrink-0">{'{'}1..N{'}'}</span>
                <input
                    type="text"
                    bind:value={folderRenameSuffix}
                    placeholder="新后缀"
                    class="flex-1 min-w-0 rounded-md border px-2 py-1.5 text-xs outline-none text-(--theme-modal-text)"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                />
            </div>
            <div
                class="theme-scrollbar max-h-28 overflow-y-auto mb-3 rounded-md border p-2 text-[11px] text-(--theme-modal-text)/50"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                {#each folderRenameTarget.children! as child, i (child.id)}
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
                    class="h-7 rounded-md px-3 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                    style="background: var(--theme-input-bg);">取消</button
                >
                <button
                    onclick={confirmFolderRename}
                    class="h-7 rounded-md px-3 text-xs transition-all hover:brightness-125"
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
            class="animate-pop-in rounded-xl border p-5 shadow-xl w-80"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="text-sm font-semibold mb-2">确认批量删除</h3>
            <p class="text-xs text-(--theme-modal-text)/60 mb-4">
                将删除选中的 <strong>{multiSelectedIds.size}</strong> 条 BUFF（全局 buff 不受影响），确定吗？
            </p>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (showMultiDeleteConfirm = false)}
                    class="h-7 rounded-md px-3 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                    style="background: var(--theme-input-bg);">取消</button
                >
                <button
                    onclick={confirmMultiDelete}
                    class="h-7 rounded-md px-3 text-xs transition-all hover:brightness-125"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
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
            class="animate-pop-in rounded-xl border p-5 shadow-xl w-96"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="text-sm font-semibold mb-2">复制 BUFF</h3>
            <p class="text-xs text-(--theme-modal-text)/60 mb-4">检测到您的 buff 名带数字，请问要复制为？</p>
            <div class="flex flex-col gap-1.5">
                {#each copyOptions as name}
                    <button
                        onclick={() => confirmCopyBuff(name)}
                        class="h-8 rounded-md px-3 text-xs text-left text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/10"
                        style="background: var(--theme-input-bg);"
                    >
                        {name}
                    </button>
                {/each}
            </div>
            <div class="flex justify-end gap-2 mt-4">
                <button
                    onclick={() => (showCopyOptions = false)}
                    class="h-7 rounded-md px-3 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                    style="background: var(--theme-input-bg);">取消</button
                >
            </div>
        </div>
    </div>
{/if}

<!-- @desc 速查弹窗（新建 BUFF 场景：创建Buff入口）与引用速查（只读），以及 Buff 导入弹窗 -->
<QuickLookup
    open={showLookup}
    {team}
    showCustomHitOption={false}
    onCreateBuff={(name) => createBuffSet(name)}
    onclose={() => (showLookup = false)}
/>

<QuickLookup
    open={showRefLookup}
    {team}
    showBuffOption={false}
    showCustomHitOption={false}
    onclose={() => (showRefLookup = false)}
/>

<BuffImportModal open={showImport} {team} onclose={() => (showImport = false)} />
