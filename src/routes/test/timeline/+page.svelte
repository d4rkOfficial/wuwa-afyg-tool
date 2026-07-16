<script lang="ts">
    interface RefLine {
        id: string
        time: number
    }

    interface OpBlock {
        id: string
        trackIndex: number
        time: number
        key: string
        desc: string
        intro: boolean
    }

    interface DamageBlock {
        id: string
        trackIndex: number
        sourceType: 'op' | 'ref'
        sourceId: string
    }

    import { resources } from '$lib/data/resources.svelte.js'

    let showCharSelect = $state(true)
    let pickCharacters = $state<any[]>([])
    let charIconMap = $state<Record<string, string>>({})
    let elementIconMap = $state<Record<string, string>>({})
    let selectedCharNames = $state<string[]>(['散华', '维里奈', '秧秧'])
    let selection = $state<string[]>([])
    let pickLoading = $state(true)
    let pickSearch = $state('')
    let pickNavEl: HTMLElement | undefined = $state()

    const ELEMENT_ORDER = ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭']

    const ELEMENT_COLORS: Record<string, string> = {
        冷凝: '#38bdf8',
        热熔: '#fb923c',
        导电: '#a78bfa',
        气动: '#34d399',
        衍射: '#facc15',
        湮灭: '#f472b6'
    }

    const charElementMap = $derived(Object.fromEntries(pickCharacters.map((c: any) => [c.name, c.element])))

    const elementColor = (name: string) => {
        const el = charElementMap[name]
        return el ? (ELEMENT_COLORS[el] ?? '#71717a') : '#71717a'
    }

    const btnIconUrl = (key: string) => uiBtnIcons.find(([k]) => k === key)?.[1] ?? ''

    const sortChars = (a: { name: string; star: number }, b: { name: string; star: number }) => {
        const aIsRover = a.name.startsWith('漂泊者') ? 0 : 1
        const bIsRover = b.name.startsWith('漂泊者') ? 0 : 1
        if (aIsRover !== bIsRover) return aIsRover - bIsRover
        if (b.star !== a.star) return b.star - a.star
        return a.name.localeCompare(b.name)
    }

    const elementGroups = $derived(
        ELEMENT_ORDER.map((label) => ({
            label,
            items: pickCharacters
                .filter((c: any) => c.element === label && c.name.toLowerCase().includes(pickSearch.toLowerCase()))
                .sort(sortChars as any),
            icon: elementIconMap[label] ?? ''
        })).filter((g) => g.items.length > 0)
    )

    const TRACKS = $derived([...selectedCharNames, '直伤', '处决／效应'])
    const TRACK_COLORS = ['#60a5fa', '#a78bfa', '#f472b6', '#f87171', '#4ade80']

    const PPS = 60
    const SIDE_PAD = 48
    const RIGHT_EXTRA = 500
    const ADD_OFFSET = 24
    const MIN_GAP = 60
    const SNAP_PX = 8
    const MIN_TIME = 0
    const MAX_TIME = 150

    const vx = (id: string, time: number) => dragVisualPositions[id] ?? SIDE_PAD + (time - MIN_TIME) * PPS

    const timeToX = (t: number) => SIDE_PAD + (t - MIN_TIME) * PPS

    let refLines = $state<RefLine[]>([
        { id: 'left', time: 0 },
        { id: 'c1', time: 12.5 },
        { id: 'right', time: 150 }
    ])

    const segments = $derived(
        refLines.slice(0, -1).map((rl, i) => ({
            from: rl,
            to: refLines[i + 1],
            width: vx(refLines[i + 1].id, refLines[i + 1].time) - vx(rl.id, rl.time)
        }))
    )

    const tableWidth = $derived(
        80 + vx(refLines[refLines.length - 1].id, refLines[refLines.length - 1].time) + RIGHT_EXTRA
    )

    let editingId = $state<string | null>(null)
    let editValue = $state('')
    let editInput: HTMLInputElement | undefined = $state()
    let contextMenu = $state<{ x: number; y: number; id: string } | null>(null)
    let draggingId = $state<string | null>(null)
    let dragVisualPositions = $state<Record<string, number>>({})
    let opBlocks = $state<OpBlock[]>([])
    let trackMenu = $state<{ x: number; y: number; trackIndex: number; time: number } | null>(null)
    let editingBlockId = $state<string | null>(null)
    let editingBlockDesc = $state('')
    let dragBlockId = $state<string | null>(null)
    let dragBlockStartTime = $state(0)
    let blockWidths = $state<Record<string, number>>({})
    let blockMenu = $state<{ x: number; y: number; blockId: string } | null>(null)
    let damageBlocks = $state<DamageBlock[]>([])
    let uiBtnIcons = $state<[string, string][]>([])
    let timelineEl: HTMLDivElement | undefined = $state()

    $effect(() => {
        if (editingId) editInput?.focus()
    })

    let blockEditInput: HTMLInputElement | undefined = $state()
    $effect(() => {
        if (editingBlockId) blockEditInput?.focus()
    })

    $effect(() => {
        if (!showCharSelect) return
        pickLoading = true
        ;(async () => {
            const [list, iconMap, elMap, btnData] = await Promise.all([
                resources.getList<any>('character'),
                resources.getIconMap('character'),
                resources.getIconMap('element'),
                fetch('/api/v1/ui-btn-icons').then((r) => r.json() as Promise<[string, string][]>)
            ])
            pickCharacters = list
            charIconMap = iconMap
            elementIconMap = elMap
            uiBtnIcons = btnData
            const paths = [...Object.values(iconMap), ...Object.values(elMap), ...btnData.map(([, url]) => url)].filter(
                Boolean
            )
            if (paths.length) resources.loadIcons(paths)
            pickLoading = false
        })()
    })

    function togglePick(name: string) {
        if (selection.includes(name)) {
            selection = selection.filter((n) => n !== name)
        } else if (selection.length < 3) {
            selection = [...selection, name]
        }
    }

    function confirmPick() {
        if (selection.length === 3) {
            selectedCharNames = selection
            showCharSelect = false
        }
    }

    function isSelected(name: string) {
        return selection.includes(name)
    }

    const imgUrl = (name: string) => {
        const path = charIconMap[name]
        return path ? (resources.icons[path] ?? '') : ''
    }

    const hideImg = (e: Event) => {
        ;(e.currentTarget as HTMLElement).style.display = 'none'
    }

    const starColor = (star: number): string => {
        const map: Record<number, string> = { 5: '#fbbf24', 4: '#a78bfa', 3: '#60a5fa', 2: '#4ade80', 1: '#71717a' }
        return map[star] || '#71717a'
    }

    const scrollTo = (label: string) => {
        document.getElementById(`p-${label}`)?.scrollIntoView({ behavior: 'smooth' })
        document.querySelector(`[data-sidebar="${label}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    function addAfter(id: string) {
        const idx = refLines.findIndex((r) => r.id === id)
        if (idx < 0 || idx >= refLines.length - 1) return
        const parentX = vx(id, refLines[idx].time)
        const nextX = vx(refLines[idx + 1].id, refLines[idx + 1].time)
        if (nextX - parentX < MIN_GAP * 2) return
        const nid = `c${Date.now()}`
        dragVisualPositions = {
            ...dragVisualPositions,
            [nid]: Math.min(parentX + ADD_OFFSET, (parentX + nextX) / 2)
        }
        refLines = [...refLines.slice(0, idx + 1), { id: nid, time: refLines[idx].time }, ...refLines.slice(idx + 1)]
        startEdit(nid, refLines[idx].time)
    }

    function addBefore(id: string) {
        const idx = refLines.findIndex((r) => r.id === id)
        if (idx <= 0) return
        const prevX = vx(refLines[idx - 1].id, refLines[idx - 1].time)
        const thisX = vx(id, refLines[idx].time)
        if (thisX - prevX < MIN_GAP * 2) return
        const nid = `c${Date.now()}`
        dragVisualPositions = {
            ...dragVisualPositions,
            [nid]: Math.max(thisX - ADD_OFFSET, (prevX + thisX) / 2)
        }
        refLines = [...refLines.slice(0, idx), { id: nid, time: refLines[idx].time }, ...refLines.slice(idx)]
        startEdit(nid, refLines[idx].time)
    }

    function canDelete(id: string) {
        return id !== 'left' && id !== 'right'
    }

    function removeLine(id: string) {
        if (!canDelete(id)) return
        refLines = refLines.filter((r) => r.id !== id)
        const { [id]: _, ...rest } = dragVisualPositions
        dragVisualPositions = rest
        contextMenu = null
    }

    function startEdit(id: string, time: number) {
        editingId = id
        editValue = time.toFixed(2)
    }

    function confirmEdit() {
        if (!editingId || isBoundary(editingId)) return
        const v = parseFloat(editValue)
        if (!isNaN(v) && v > 0) {
            const idx = refLines.findIndex((r) => r.id === editingId)
            if (idx > 0 && v <= refLines[idx - 1].time) return
            if (idx < refLines.length - 1 && v >= refLines[idx + 1].time) return
            const currentX = vx(editingId, refLines[idx].time)
            dragVisualPositions = { ...dragVisualPositions, [editingId]: currentX }
            refLines = refLines.map((r) => (r.id === editingId ? { ...r, time: v } : r))
        }
        editingId = null
    }

    function canAddBefore(id: string) {
        const idx = refLines.findIndex((r) => r.id === id)
        if (idx <= 0) return false
        const prevX = vx(refLines[idx - 1].id, refLines[idx - 1].time)
        const thisX = vx(id, refLines[idx].time)
        return thisX - prevX >= MIN_GAP * 2
    }

    function canAddAfter(id: string) {
        const idx = refLines.findIndex((r) => r.id === id)
        if (idx < 0 || idx >= refLines.length - 1) return false
        const parentX = vx(id, refLines[idx].time)
        const nextX = vx(refLines[idx + 1].id, refLines[idx + 1].time)
        return nextX - parentX >= MIN_GAP * 2
    }

    function handleContextmenu(e: MouseEvent, id: string) {
        e.preventDefault()
        contextMenu = { x: e.clientX, y: e.clientY, id }
    }

    function handleWindowMousedown(e: MouseEvent) {
        const target = e.target as HTMLElement
        if (contextMenu && !target.closest('[data-context-menu]')) contextMenu = null
        if (trackMenu && !target.closest('[data-track-menu]')) trackMenu = null
        if (blockMenu && !target.closest('[data-block-menu]')) blockMenu = null
    }

    function handleTrackContextmenu(e: MouseEvent, trackIndex: number) {
        if (trackIndex >= 3 || !timelineEl) return
        const rect = timelineEl.getBoundingClientRect()
        const scrollL = timelineEl.scrollLeft
        const x = e.clientX - rect.left + scrollL - 80
        const t = Math.max(0, Math.min(MAX_TIME, (x - SIDE_PAD) / PPS))
        trackMenu = { x: e.clientX, y: e.clientY, trackIndex, time: t }
    }

    function addOpBlock(trackIndex: number, time: number, key: string) {
        opBlocks = [...opBlocks, { id: `b${Date.now()}`, trackIndex, time, key, desc: '', intro: false }]
        trackMenu = null
        enforceIntro()
    }

    function startBlockDrag(e: MouseEvent, blockId: string) {
        if (e.button !== 0 || !timelineEl) return
        dragBlockId = blockId
        dragBlockStartTime = opBlocks.find((b) => b.id === blockId)?.time ?? 0
    }

    function onBlockDrag(e: MouseEvent) {
        if (!dragBlockId || !timelineEl) return
        const rect = timelineEl.getBoundingClientRect()
        const scrollL = timelineEl.scrollLeft
        const rawX = e.clientX - rect.left + scrollL - 80
        const idx = opBlocks.findIndex((b) => b.id === dragBlockId)
        if (idx < 0) return
        const t = snapBlockX(rawX, opBlocks[idx].trackIndex, dragBlockId, blockWidths[dragBlockId] ?? 0)
        opBlocks = opBlocks.map((b) => (b.id === dragBlockId ? { ...b, time: Math.max(0, Math.min(MAX_TIME, t)) } : b))
    }

    function stopBlockDrag() {
        if (!dragBlockId) {
            dragBlockId = null
            return
        }
        const idx = opBlocks.findIndex((b) => b.id === dragBlockId)
        if (idx < 0) {
            dragBlockId = null
            return
        }
        const dragged = opBlocks[idx]
        if (Math.abs(dragged.time - dragBlockStartTime) > 0.01) {
            const dw = blockWidths[dragBlockId] ?? 0
            const dx = timeToX(dragged.time)
            const dLeft = dx - dw / 2
            for (const b of opBlocks) {
                if (b.id === dragBlockId || b.trackIndex !== dragged.trackIndex) continue
                const bw = blockWidths[b.id] ?? 0
                const bx = timeToX(b.time)
                const bLeft = bx - bw / 2
                const bRight = bx + bw / 2
                if (dragged.time >= b.time && dLeft > bLeft + SNAP_PX && dLeft < bRight - SNAP_PX) {
                    opBlocks = opBlocks.map((ob) =>
                        ob.id === dragBlockId
                            ? { ...ob, time: Math.max(0, Math.min(MAX_TIME, (bRight + dw / 2 - SIDE_PAD) / PPS)) }
                            : ob
                    )
                    break
                }
            }
            reflowTrack(dragged.trackIndex)
        }
        dragBlockId = null
    }

    function handleBlockContextmenu(e: MouseEvent, blockId: string) {
        e.preventDefault()
        e.stopPropagation()
        blockMenu = { x: e.clientX, y: e.clientY, blockId }
    }

    function handleBlockDblclick(blockId: string) {
        const block = opBlocks.find((b) => b.id === blockId)
        if (!block) return
        editingBlockId = blockId
        editingBlockDesc = block.desc
    }

    function removeBlock(blockId: string) {
        opBlocks = opBlocks.filter((b) => b.id !== blockId)
        blockMenu = null
        enforceIntro()
    }

    function canSetIntro(blockId: string) {
        const block = opBlocks.find((b) => b.id === blockId)
        if (!block || block.intro) return false
        if (block.trackIndex >= 3) return false
        const sorted = opBlocks.filter((b) => b.trackIndex < 3).sort((a, b) => a.time - b.time)
        const idx = sorted.findIndex((b) => b.id === blockId)
        if (idx <= 0) return true
        const prev = sorted[idx - 1]
        return prev.trackIndex !== block.trackIndex
    }

    function toggleIntro(blockId: string) {
        const block = opBlocks.find((b) => b.id === blockId)
        if (!block) return
        if (block.intro) {
            opBlocks = opBlocks.map((b) => (b.id === blockId ? { ...b, intro: false } : b))
        } else if (canSetIntro(blockId)) {
            opBlocks = opBlocks.map((b) => (b.id === blockId ? { ...b, intro: true } : b))
        }
    }

    function enforceIntro() {
        const sorted = opBlocks.filter((b) => b.trackIndex < 3).sort((a, b) => a.time - b.time)
        let changed = false
        const updated = opBlocks.map((b) => {
            if (!b.intro) return b
            const idx = sorted.findIndex((s) => s.id === b.id)
            if (idx <= 0) return b
            const prev = sorted[idx - 1]
            if (prev.trackIndex === b.trackIndex) {
                changed = true
                return { ...b, intro: false }
            }
            return b
        })
        if (changed) opBlocks = updated
    }

    const damageBlockLeft = (d: DamageBlock) => {
        if (d.sourceType === 'ref') {
            const rl = refLines.find((r) => r.id === d.sourceId)
            return rl ? vx(rl.id, rl.time) : 0
        }
        const op = opBlocks.find((b) => b.id === d.sourceId)
        if (!op) return 0
        return timeToX(op.time) - (blockWidths[op.id] ?? 0) / 2
    }

    function addDamageBlock(sourceType: 'op' | 'ref', sourceId: string, trackIndex: number) {
        const exists = damageBlocks.some((d) => d.sourceId === sourceId && d.trackIndex === trackIndex)
        if (exists) return
        damageBlocks = [...damageBlocks, { id: `d${Date.now()}`, trackIndex, sourceType, sourceId }]
    }

    function removeDamageBlock(id: string) {
        damageBlocks = damageBlocks.filter((d) => d.id !== id)
    }

    function removeDamageBySource(sourceId: string, trackIndex: number) {
        const d = damageBlocks.find((b) => b.sourceId === sourceId && b.trackIndex === trackIndex)
        if (d) removeDamageBlock(d.id)
    }

    function snapBlockX(centerX: number, trackIndex: number, excludeId: string, width: number) {
        const left = centerX - width / 2
        const right = centerX + width / 2
        for (const b of opBlocks) {
            if (b.id === excludeId) continue
            const bw = blockWidths[b.id] ?? 0
            const bx = timeToX(b.time)
            const bLeft = bx - bw / 2
            const bRight = bx + bw / 2
            if (Math.abs(left - bRight) < SNAP_PX) return (bRight + width / 2 - SIDE_PAD) / PPS
            if (Math.abs(right - bLeft) < SNAP_PX) return (bLeft - width / 2 - SIDE_PAD) / PPS
            if (centerX > bx) {
                const inL = bLeft + 18.6
                const inR = bRight - 18.6
                if (Math.abs(left - inL) < SNAP_PX) return (inL + width / 2 - SIDE_PAD) / PPS
                if (Math.abs(left - inR) < SNAP_PX) return (inR + width / 2 - SIDE_PAD) / PPS
            }
        }
        return (centerX - SIDE_PAD) / PPS
    }

    function areBlocksTouching(leftBlock: OpBlock, rightBlock: OpBlock) {
        const lw = blockWidths[leftBlock.id] ?? 0
        const rw = blockWidths[rightBlock.id] ?? 0
        const lr = timeToX(leftBlock.time) + lw / 2
        const rl = timeToX(rightBlock.time) - rw / 2
        if (Math.abs(lr - rl) < SNAP_PX) return true
        const lc = timeToX(leftBlock.time)
        const inL = lc - lw / 2 + 18.6
        const inR = lc + lw / 2 - 18.6
        if (Math.abs(rl - inL) < SNAP_PX) return true
        if (Math.abs(rl - inR) < SNAP_PX) return true
        return false
    }

    function reflowTrack(trackIndex: number) {
        const sorted = opBlocks.filter((b) => b.trackIndex < 3).sort((a, b) => a.time - b.time)
        if (sorted.length < 2) return
        const groups: OpBlock[][] = []
        let cur: OpBlock[] = [sorted[0]]
        for (let i = 1; i < sorted.length; i++) {
            if (areBlocksTouching(sorted[i - 1], sorted[i])) {
                cur.push(sorted[i])
            } else {
                groups.push(cur)
                cur = [sorted[i]]
            }
        }
        groups.push(cur)
        const result: OpBlock[] = []
        for (const group of groups) {
            if (result.length === 0) {
                result.push(...group)
            } else {
                const prev = result[result.length - 1]
                const pw = blockWidths[prev.id] ?? 0
                const first = group[0]
                const fw = blockWidths[first.id] ?? 0
                const prx = timeToX(prev.time) + pw / 2
                const offset = (prx + 1 + fw / 2 - SIDE_PAD) / PPS - first.time
                for (const b of group) {
                    result.push({ ...b, time: Math.max(0, Math.min(MAX_TIME, b.time + offset)) })
                }
            }
        }
        const updated = opBlocks.map((b) => {
            const nb = result.find((r) => r.id === b.id)
            return nb ?? b
        })
        opBlocks = updated
        enforceIntro()
    }

    function measureWidth(node: HTMLElement, blockId: string) {
        const set = () => {
            blockWidths = { ...blockWidths, [blockId]: node.offsetWidth }
        }
        set()
        const ro = new ResizeObserver(set)
        ro.observe(node)
        return { destroy: () => ro.disconnect() }
    }

    function confirmBlockDesc() {
        if (editingBlockId) {
            const oldW = blockWidths[editingBlockId] ?? 0
            const idx = opBlocks.findIndex((b) => b.id === editingBlockId)
            opBlocks = opBlocks.map((b) => (b.id === editingBlockId ? { ...b, desc: editingBlockDesc } : b))
            if (idx >= 0) {
                const edited = opBlocks[idx]
                const newW = blockWidths[editingBlockId] ?? oldW
                const dw = newW - oldW
                if (Math.abs(dw) > 1) {
                    const oldRight = timeToX(edited.time) + oldW / 2
                    const shift = dw / 2
                    opBlocks = opBlocks.map((b) => {
                        if (b.id === editingBlockId || b.trackIndex >= 3) return b
                        const bl = timeToX(b.time) - (blockWidths[b.id] ?? 0) / 2
                        if (bl >= oldRight) return { ...b, time: Math.max(0, Math.min(MAX_TIME, b.time + shift / PPS)) }
                        return b
                    })
                }
            }
            reflowTrack(0)
        }
        editingBlockId = null
    }

    function clampDragPos(cx: number, id: string) {
        const idx = refLines.findIndex((r) => r.id === id)
        if (idx > 0) {
            cx = Math.max(cx, vx(refLines[idx - 1].id, refLines[idx - 1].time) + MIN_GAP)
        }
        if (idx < refLines.length - 1) {
            cx = Math.min(cx, vx(refLines[idx + 1].id, refLines[idx + 1].time) - MIN_GAP)
        }
        return cx
    }

    function startDrag(e: MouseEvent, id: string) {
        if (e.button !== 0 || id === 'left' || !timelineEl) return
        draggingId = id
        const rect = timelineEl.getBoundingClientRect()
        const scrollL = timelineEl.scrollLeft
        dragVisualPositions = {
            ...dragVisualPositions,
            [id]: clampDragPos(e.clientX - rect.left + scrollL - 80, id)
        }
    }

    function onDrag(e: MouseEvent) {
        if (!draggingId || !timelineEl) return
        const rect = timelineEl.getBoundingClientRect()
        const scrollL = timelineEl.scrollLeft
        dragVisualPositions = {
            ...dragVisualPositions,
            [draggingId]: clampDragPos(e.clientX - rect.left + scrollL - 80, draggingId)
        }
    }

    function stopDrag() {
        draggingId = null
    }

    function isBoundary(id: string) {
        return id === 'left' || id === 'right'
    }

    function onWheel(e: WheelEvent) {
        if (!timelineEl) return
        e.preventDefault()
        timelineEl.scrollLeft += e.deltaY
    }
</script>

<svelte:window
    onmousedown={handleWindowMousedown}
    onmousemove={(e) => {
        onDrag(e)
        onBlockDrag(e)
    }}
    onmouseup={() => {
        stopDrag()
        stopBlockDrag()
    }}
    onmouseleave={() => {
        stopDrag()
        stopBlockDrag()
    }}
    oncontextmenu={(e) => e.preventDefault()}
    oncopy={(e) => e.preventDefault()}
    oncut={(e) => e.preventDefault()}
/>

<div class="h-dvh flex flex-col bg-zinc-950 text-zinc-100 select-none">
    <header class="shrink-0 h-12 flex items-center gap-3 px-5 border-b border-zinc-800/50">
        <h1 class="text-sm font-semibold">时间线 Demo</h1>
        <div class="ml-auto text-[10px] text-zinc-600 flex items-center gap-3">
            <span>拖拽参考线移动 · 右键菜单</span>
            <span>右键行添加操作块 · 拖拽调整</span>
            <span>双击改备注 · 右键绑定/变奏</span>
        </div>
    </header>

    <div class="flex-1 overflow-x-auto overflow-y-hidden" bind:this={timelineEl} onwheel={onWheel}>
        <div class="relative" style="width: {tableWidth}px; min-width: 100%; height: 100%;">
            <!-- flex column for row alignment -->
            <div class="flex flex-col h-full">
                <!-- Header row -->
                <div class="relative shrink-0 h-8 border-b border-zinc-800/50">
                    <div class="sticky left-0 z-[35] w-20 h-full bg-zinc-950 border-r border-zinc-800/50"></div>
                </div>

                <!-- Track rows -->
                {#each TRACKS as name, i}
                    <div
                        class="relative shrink-0 {i < 3 ? 'h-14' : 'flex-1'}"
                        style="border-bottom: 1px solid color-mix(in srgb, {TRACK_COLORS[i]} 15%, transparent);"
                        oncontextmenu={(e) => handleTrackContextmenu(e, i)}
                        role="region"
                    >
                        <div
                            class="sticky left-0 z-[35] w-20 h-full bg-zinc-950 border-r border-zinc-800/50 flex items-center justify-center"
                        >
                            {#if i < 3}
                                {@const url = imgUrl(name)}
                                {#if url}
                                    {@const c = elementColor(name)}
                                    <div
                                        class="size-10 box-border rounded overflow-hidden shrink-0"
                                        style="border-bottom: 2px solid {c}; border-right: 2px solid {c};
                                        background: linear-gradient(135deg, transparent 0%, {c}40 100%);"
                                    >
                                        <img src={url} alt={name} class="size-full object-contain" />
                                    </div>
                                {:else}
                                    <div class="[writing-mode:vertical-rl] text-[11px] font-medium text-zinc-400">
                                        {name}
                                    </div>
                                {/if}

                                {#if blockMenu}
                                    {@const bm = blockMenu}
                                    <div
                                        class="fixed z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
                                        style="left: {bm.x}px; top: {bm.y}px"
                                        data-block-menu="true"
                                    >
                                        <div
                                            class="px-3 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider"
                                        >
                                            操作块
                                        </div>
                                        <button
                                            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                                            onclick={() => {
                                                handleBlockDblclick(bm.blockId)
                                                blockMenu = null
                                            }}
                                        >
                                            <svg
                                                viewBox="0 0 16 16"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="1.5"
                                                class="size-3.5 shrink-0 text-zinc-500"
                                                ><path d="M11 2l3 3-9 9H2v-3z" /></svg
                                            >
                                            修改备注
                                        </button>
                                        <button
                                            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                                            onclick={() => removeBlock(bm.blockId)}
                                        >
                                            <svg
                                                viewBox="0 0 16 16"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="1.5"
                                                class="size-3.5 shrink-0"
                                                ><path
                                                    d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M12 4v9.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5V4"
                                                /></svg
                                            >
                                            删除操作块
                                        </button>
                                        <div class="border-t border-zinc-800 my-1"></div>
                                        <div
                                            class="px-3 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider"
                                        >
                                            变奏
                                        </div>
                                        {#if canSetIntro(bm.blockId)}
                                            <button
                                                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                                                onclick={() => {
                                                    toggleIntro(bm.blockId)
                                                    blockMenu = null
                                                }}
                                            >
                                                <svg
                                                    viewBox="0 0 16 16"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    class="size-3.5 shrink-0 text-zinc-500"
                                                    ><path d="M11 4L5 12M5 4l6 8" /><circle
                                                        cx="8"
                                                        cy="8"
                                                        r="6.5"
                                                    /></svg
                                                >
                                                设置变奏入场
                                            </button>
                                        {/if}
                                        {#if opBlocks.some((b) => b.id === bm.blockId && b.intro)}
                                            <button
                                                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                                                onclick={() => {
                                                    toggleIntro(bm.blockId)
                                                    blockMenu = null
                                                }}
                                            >
                                                <svg
                                                    viewBox="0 0 16 16"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    class="size-3.5 shrink-0 text-zinc-500"
                                                    ><path d="M4 8h8M2 8a6 6 0 0112 0 6 6 0 01-12 0z" /></svg
                                                >
                                                取消变奏入场
                                            </button>
                                        {/if}
                                        <div class="border-t border-zinc-800 my-1"></div>
                                        <div
                                            class="px-3 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider"
                                        >
                                            伤害绑定
                                        </div>
                                        <div class="px-3 py-0.5 text-[9px] text-zinc-600">直伤</div>
                                        {#if damageBlocks.some((d) => d.sourceId === bm.blockId && d.trackIndex === 3)}
                                            <button
                                                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                                                onclick={() => {
                                                    removeDamageBySource(bm.blockId, 3)
                                                    blockMenu = null
                                                }}
                                            >
                                                <svg
                                                    viewBox="0 0 16 16"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    class="size-3.5 shrink-0"
                                                    ><path
                                                        d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M12 4v9.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5V4"
                                                    /></svg
                                                >
                                                删除直伤块
                                            </button>
                                            <button
                                                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                                                onclick={() => {
                                                    blockMenu = null
                                                }}
                                            >
                                                <svg
                                                    viewBox="0 0 16 16"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    class="size-3.5 shrink-0 text-zinc-500"
                                                    ><path d="M11 2l3 3-9 9H2v-3z" /></svg
                                                >
                                                编辑直伤
                                            </button>
                                        {:else}
                                            <button
                                                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                                                onclick={() => {
                                                    addDamageBlock('op', bm.blockId, 3)
                                                    blockMenu = null
                                                }}
                                            >
                                                <svg
                                                    viewBox="0 0 16 16"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    class="size-3.5 shrink-0 text-zinc-500"
                                                    ><path d="M5 11l3-3 3 3M8 8v6" /><path
                                                        d="M3 5a2 2 0 012-2h6a2 2 0 012 2v2a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"
                                                    /></svg
                                                >
                                                绑定直伤
                                            </button>
                                        {/if}
                                        <div class="px-3 py-0.5 text-[9px] text-zinc-600">效应/处决</div>
                                        {#if damageBlocks.some((d) => d.sourceId === bm.blockId && d.trackIndex === 4)}
                                            <button
                                                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                                                onclick={() => {
                                                    removeDamageBySource(bm.blockId, 4)
                                                    blockMenu = null
                                                }}
                                            >
                                                <svg
                                                    viewBox="0 0 16 16"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    class="size-3.5 shrink-0"
                                                    ><path
                                                        d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M12 4v9.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5V4"
                                                    /></svg
                                                >
                                                删除效应/处决块
                                            </button>
                                            <button
                                                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                                                onclick={() => {
                                                    blockMenu = null
                                                }}
                                            >
                                                <svg
                                                    viewBox="0 0 16 16"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    class="size-3.5 shrink-0 text-zinc-500"
                                                    ><path d="M11 2l3 3-9 9H2v-3z" /></svg
                                                >
                                                编辑效应/处决
                                            </button>
                                        {:else}
                                            <button
                                                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                                                onclick={() => {
                                                    addDamageBlock('op', bm.blockId, 4)
                                                    blockMenu = null
                                                }}
                                            >
                                                <svg
                                                    viewBox="0 0 16 16"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    class="size-3.5 shrink-0 text-zinc-500"
                                                    ><path d="M5 11l3-3 3 3M8 8v6" /><path
                                                        d="M3 5a2 2 0 012-2h6a2 2 0 012 2v2a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"
                                                    /></svg
                                                >
                                                绑定效应/处决
                                            </button>
                                        {/if}
                                    </div>
                                {/if}
                            {:else if i === 3}
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.8"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    class="size-7 text-zinc-300"
                                >
                                    <path d="M12 2v12" />
                                    <path d="M9 10 12 13l3-3" />
                                    <path d="M10.5 13v8" />
                                    <path d="M13.5 13v8" />
                                    <path d="M8.5 21h7" />
                                </svg>
                            {:else}
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.8"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    class="size-7 text-zinc-300"
                                >
                                    <path d="M12 2 13.5 10.5 22 12 13.5 13.5 12 22 10.5 13.5 2 12 10.5 10.5z" />
                                    <path d="M18.5 5.5 19 7 18 6l-1 1z" />
                                    <path d="M5.5 5.5 5 7 6 6l1 1z" />
                                </svg>
                            {/if}
                        </div>

                        <!-- block overlay -->
                        <div class="absolute pointer-events-none" style="left: 5rem; top: 0; right: 0; bottom: 0;">
                            {#each opBlocks.filter((b) => b.trackIndex === i) as block (block.id)}
                                <div
                                    class="absolute inset-y-0 flex items-center pointer-events-auto cursor-grab active:cursor-grabbing select-none"
                                    style="left: {timeToX(block.time)}px; transform: translateX(-50%) {dragBlockId ===
                                    block.id
                                        ? 'translateY(-4px)'
                                        : ''}; z-index: {dragBlockId === block.id ? 20 : 5};"
                                    role="button"
                                    tabindex="0"
                                    data-block="true"
                                    use:measureWidth={block.id}
                                    onmousedown={(e) => startBlockDrag(e, block.id)}
                                    oncontextmenu={(e) => handleBlockContextmenu(e, block.id)}
                                    ondblclick={() => handleBlockDblclick(block.id)}
                                >
                                    <div
                                        class="flex items-center gap-1.5 h-full rounded-md px-2.5 text-xs bg-zinc-800/90 border whitespace-nowrap shadow-sm min-w-[56px] {dragBlockId ===
                                        block.id
                                            ? 'border-blue-400 shadow-blue-500/20'
                                            : 'border-zinc-700/60'}"
                                    >
                                        {#if block.intro}
                                            <span class="text-xs text-yellow-400 font-semibold shrink-0">变奏</span>
                                        {/if}
                                        {#if btnIconUrl(block.key)}
                                            <img
                                                src={btnIconUrl(block.key)}
                                                alt={block.key}
                                                draggable="false"
                                                class="size-7 object-contain shrink-0 pointer-events-none"
                                            />
                                        {:else}
                                            <span class="font-bold text-zinc-200">{block.key}</span>
                                        {/if}
                                        {#if editingBlockId === block.id}
                                            <input
                                                bind:this={blockEditInput}
                                                bind:value={editingBlockDesc}
                                                onblur={confirmBlockDesc}
                                                onkeydown={(e) => {
                                                    if (e.key === 'Enter') confirmBlockDesc()
                                                    if (e.key === 'Escape') editingBlockId = null
                                                }}
                                                class="w-14 bg-zinc-700 text-xs text-zinc-200 text-center rounded outline-none border border-blue-500/50"
                                            />
                                        {:else}
                                            <span class="text-zinc-400 max-w-24 truncate">{block.desc}</span>
                                        {/if}
                                    </div>
                                </div>
                            {/each}
                        </div>

                        <!-- damage block overlay -->
                        <div
                            class="absolute pointer-events-none"
                            style="left: 5rem; top: 0; right: 0; bottom: 0; z-index: 6;"
                        >
                            {#each damageBlocks.filter((d) => d.trackIndex === i) as dmg (dmg.id)}
                                <div
                                    class="absolute inset-y-0 flex items-center pointer-events-auto cursor-default min-w-[24px]"
                                    style="left: {damageBlockLeft(dmg)}px;"
                                >
                                    <div class="h-full min-w-3 rounded-sm bg-red-500/70"></div>
                                </div>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>

            <!-- Ref line overlay (vertical lines below header) -->
            <div class="absolute pointer-events-none" style="left: 5rem; top: 2rem; right: 0; bottom: 0; z-index: 10;">
                {#each refLines as rl}
                    <div
                        class="absolute top-0 bottom-0 {draggingId === rl.id
                            ? 'border-l border-dashed border-blue-400'
                            : 'border-l border-dashed border-zinc-700/60'}"
                        style="left: {vx(rl.id, rl.time)}px;"
                    ></div>
                {/each}
            </div>

            <!-- Header label overlay (centered on each ref line) -->
            <div class="absolute pointer-events-none" style="left: 5rem; top: 0; right: 0; height: 2rem; z-index: 20;">
                {#each refLines as rl}
                    <div
                        class="absolute top-0 h-full flex items-center pointer-events-auto"
                        style="left: {vx(rl.id, rl.time)}px; transform: translateX(-50%); white-space: nowrap;"
                    >
                        {#if editingId === rl.id && rl.id !== 'left' && rl.id !== 'right'}
                            <input
                                bind:this={editInput}
                                bind:value={editValue}
                                onblur={confirmEdit}
                                onkeydown={(e) => {
                                    if (e.key === 'Enter') confirmEdit()
                                    if (e.key === 'Escape') editingId = null
                                }}
                                class="w-12 bg-zinc-800 text-[9px] text-zinc-200 text-center rounded outline-none border border-blue-500/50 tabular-nums"
                            />
                        {:else}
                            <span
                                class="text-[9px] tabular-nums text-zinc-500 cursor-pointer hover:text-zinc-300"
                                oncontextmenu={(e) => handleContextmenu(e, rl.id)}
                                role="button"
                                tabindex="-1">{rl.time.toFixed(1)}s</span
                            >
                        {/if}
                    </div>
                {/each}
            </div>

            <!-- Drag hot zone overlay -->
            <div class="absolute pointer-events-none" style="top: 2rem; left: 5rem; right: 0; bottom: 0; z-index: 30;">
                {#each refLines as rl}
                    <div
                        class="absolute inset-y-0 pointer-events-auto {rl.id !== 'left' ? 'cursor-col-resize' : ''}"
                        style="left: {vx(rl.id, rl.time) - 10}px; width: 20px;"
                        role="presentation"
                        tabindex="-1"
                        onmousedown={(e) => {
                            if (rl.id !== 'left') startDrag(e, rl.id)
                        }}
                        oncontextmenu={(e) => handleContextmenu(e, rl.id)}
                    ></div>
                {/each}
            </div>
        </div>
    </div>
</div>

{#if showCharSelect}
    <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" role="dialog">
        <div class="mx-4 flex w-full max-w-2xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div class="flex items-center justify-between shrink-0 px-5 py-3 border-b border-zinc-800/50">
                <div class="flex items-center gap-3">
                    <h2 class="text-sm font-semibold text-zinc-100">选择三个角色</h2>
                    <span class="text-[11px] text-zinc-500 tabular-nums">{selection.length}/3</span>
                </div>
                <div class="max-w-48 w-full relative">
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-500"
                    >
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                    </svg>
                    <input
                        bind:value={pickSearch}
                        placeholder="搜索..."
                        class="h-7 w-full pl-8 pr-2.5 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-[11px] text-zinc-200 placeholder:text-zinc-600 outline-none transition-colors focus:border-blue-500/50"
                    />
                </div>
            </div>
            <div class="flex flex-1 overflow-hidden" style="max-height: 65vh;">
                <nav
                    class="shrink-0 w-28 border-r border-zinc-800/50 bg-zinc-950/60 overflow-y-auto flex flex-col gap-0.5 py-3 pl-2 pr-1.5"
                    bind:this={pickNavEl}
                >
                    {#each elementGroups as group}
                        <button
                            onclick={() => scrollTo(group.label)}
                            data-sidebar={group.label}
                            class="h-7 rounded-lg flex items-center gap-1.5 px-2 hover:bg-zinc-800/60 transition-colors shrink-0 text-left"
                            title={group.label}
                        >
                            {#if group.icon}
                                <img src={group.icon} alt="" class="size-4 object-contain shrink-0" onerror={hideImg} />
                            {/if}
                            <span class="text-[10px] leading-none text-zinc-400 truncate">{group.label}</span>
                        </button>
                    {/each}
                </nav>
                <div class="flex-1 overflow-y-auto p-4">
                    {#if pickLoading}
                        <div class="flex items-center justify-center py-12 text-xs text-zinc-500">加载角色列表...</div>
                    {:else}
                        {#each elementGroups as group}
                            <section id="p-{group.label}" class="mb-6 last:mb-0">
                                <div
                                    class="flex items-center gap-2 text-[11px] font-semibold text-zinc-400 mb-2 pb-1.5"
                                >
                                    {#if group.icon}
                                        <img
                                            src={group.icon}
                                            alt=""
                                            class="size-3.5 rounded object-contain"
                                            onerror={hideImg}
                                        />
                                    {/if}
                                    {group.label}
                                    <span class="text-zinc-600 font-medium">{group.items.length}</span>
                                </div>
                                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {#each group.items as char (char.name)}
                                        {@const c = starColor(char.star)}
                                        <button
                                            class="rounded-lg overflow-hidden flex items-center gap-2 p-2.5 cursor-pointer text-left transition-all hover:-translate-y-0.5 {isSelected(
                                                char.name
                                            )
                                                ? 'ring-2 ring-blue-500 ring-inset bg-blue-500/5'
                                                : ''}"
                                            style="background-image: linear-gradient(135deg, transparent 30%, {c}15 100%);"
                                            onclick={() => togglePick(char.name)}
                                        >
                                            <div
                                                class="size-9 shrink-0 rounded-md bg-zinc-800/40 flex items-center justify-center overflow-hidden"
                                            >
                                                {#if imgUrl(char.name)}
                                                    <img
                                                        src={imgUrl(char.name)}
                                                        alt={char.name}
                                                        class="size-full object-contain"
                                                    />
                                                {/if}
                                            </div>
                                            <span class="text-[11px] font-semibold text-zinc-200 truncate min-w-0"
                                                >{char.name}</span
                                            >
                                        </button>
                                    {/each}
                                </div>
                            </section>
                        {/each}
                        {#if elementGroups.length === 0}
                            <div class="flex flex-col items-center justify-center py-16 text-zinc-500">
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.5"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    class="size-8 mb-2 text-zinc-600"
                                >
                                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                                </svg>
                                <span class="text-xs font-medium">没有匹配的角色</span>
                            </div>
                        {/if}
                    {/if}
                </div>
            </div>
            <div class="flex items-center justify-end gap-2 shrink-0 border-t border-zinc-800/50 px-5 py-3">
                <span class="text-[11px] text-zinc-600 mr-auto">已选 {selection.length} / 3</span>
                <button
                    class="rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-colors
                        {selection.length === 3
                        ? 'bg-blue-600 hover:bg-blue-500'
                        : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'}"
                    onclick={confirmPick}
                    disabled={selection.length !== 3}
                >
                    确认
                </button>
            </div>
        </div>
    </div>
{/if}

{#if contextMenu}
    {@const cmId = contextMenu.id}
    <div
        class="fixed z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
        style="left: {contextMenu.x}px; top: {contextMenu.y}px"
        data-context-menu="true"
    >
        <div class="px-3 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">参考线</div>
        {#if canAddBefore(cmId)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    addBefore(cmId)
                    contextMenu = null
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"><path d="M8 3v10M3 8h10" /></svg
                >
                左侧添加参考线
            </button>
        {/if}
        {#if canAddAfter(cmId)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    addAfter(cmId)
                    contextMenu = null
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"><path d="M8 3v10M3 8h10" /></svg
                >
                右侧添加参考线
            </button>
        {/if}
        {#if !isBoundary(cmId)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    startEdit(cmId, refLines.find((r) => r.id === cmId)!.time)
                    contextMenu = null
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"><path d="M11 2l3 3-9 9H2v-3z" /></svg
                >
                设置时间值
            </button>
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    removeLine(cmId)
                    contextMenu = null
                }}
            >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="size-3.5 shrink-0"
                    ><path
                        d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M12 4v9.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5V4"
                    /></svg
                >
                删除参考线
            </button>
        {/if}
        <div class="border-t border-zinc-800 my-1"></div>
        <div class="px-3 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">伤害绑定</div>
        <div class="px-3 py-0.5 text-[9px] text-zinc-600">直伤</div>
        {#if damageBlocks.some((d) => d.sourceId === cmId && d.trackIndex === 3)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    removeDamageBySource(cmId, 3)
                    contextMenu = null
                }}
            >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="size-3.5 shrink-0"
                    ><path
                        d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M12 4v9.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5V4"
                    /></svg
                >
                删除直伤块
            </button>
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    contextMenu = null
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"><path d="M11 2l3 3-9 9H2v-3z" /></svg
                >
                编辑直伤
            </button>
        {:else}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    addDamageBlock('ref', cmId, 3)
                    contextMenu = null
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"
                    ><path d="M5 11l3-3 3 3M8 8v6" /><path
                        d="M3 5a2 2 0 012-2h6a2 2 0 012 2v2a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"
                    /></svg
                >
                绑定直伤
            </button>
        {/if}
        <div class="px-3 py-0.5 text-[9px] text-zinc-600">效应/处决</div>
        {#if damageBlocks.some((d) => d.sourceId === cmId && d.trackIndex === 4)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    removeDamageBySource(cmId, 4)
                    contextMenu = null
                }}
            >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="size-3.5 shrink-0"
                    ><path
                        d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M12 4v9.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5V4"
                    /></svg
                >
                删除效应/处决块
            </button>
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    contextMenu = null
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"><path d="M11 2l3 3-9 9H2v-3z" /></svg
                >
                编辑效应/处决
            </button>
        {:else}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    addDamageBlock('ref', cmId, 4)
                    contextMenu = null
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"
                    ><path d="M5 11l3-3 3 3M8 8v6" /><path
                        d="M3 5a2 2 0 012-2h6a2 2 0 012 2v2a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"
                    /></svg
                >
                绑定效应/处决
            </button>
        {/if}
    </div>
{/if}

{#if trackMenu}
    {@const tm = trackMenu}
    <div
        class="fixed z-50 rounded-lg border border-zinc-700 bg-zinc-900 py-1.5 px-2 shadow-xl"
        style="left: {tm.x}px; top: {tm.y}px"
        data-track-menu="true"
    >
        <div class="flex items-center gap-1">
            {#each uiBtnIcons as [name, url]}
                <button
                    class="size-7 flex items-center justify-center rounded hover:bg-zinc-800 transition-colors"
                    onclick={() => addOpBlock(tm.trackIndex, tm.time, name)}
                    title={name}
                >
                    <img src={url} alt={name} class="size-5 object-contain pointer-events-none" />
                </button>
            {/each}
        </div>
    </div>
{/if}
