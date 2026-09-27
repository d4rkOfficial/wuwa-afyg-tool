<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { PhaseKey, CharSlot } from '$lib/types/project'
    import { getGpuAccel } from '$lib/data/render-prefs.svelte'
    import {
        setShowDamageList,
        getQuickMode,
        getQuickSpecial,
        toggleQuickMode,
        formatTimeline,
        undo as undoTimeline,
        redo as redoTimeline,
        canUndo as canUndoTimeline,
        canRedo as canRedoTimeline
    } from '$lib/calc/timeline.store.svelte'
    import {
        setShowBuffModal,
        setShowDamageTypeModal,
        getBuffDiffMode,
        toggleBuffDiffMode,
        getHideConditionMismatch,
        toggleHideConditionMismatch,
        getConditionProfile,
        undoTable,
        redoTable,
        canUndoTable,
        canRedoTable
    } from '$lib/calc/calculation.store.svelte'
    import { getCalcViewMode, getScrollAxisDefault, setScrollAxisDefault } from '$lib/data/calc-view.svelte'
    import { openSubstatLibrary } from '$lib/data/substat-library-ui.svelte'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props extends ComponentsProps {
        simplifyToolbar: boolean
        activePhase: PhaseKey
        showResult: boolean
        phaseLocked: boolean
        canLock: boolean
        /** @desc 当前队伍（用于角色详情按钮展示链阶档位） */
        team?: [CharSlot, CharSlot, CharSlot]
        onCharDetail: () => void
        onRefresh: () => void
        onLockToggle: () => void
    }
    let {
        simplifyToolbar,
        activePhase,
        showResult,
        phaseLocked,
        canLock,
        team,
        onCharDetail,
        onRefresh,
        onLockToggle,
        class: className,
        style: styleProp
    }: Props = $props()

    /**
     * @desc 链阶文案：每个角色两位 —— 链数 + 阶数，按角色 1→3 依次拼接。
     * 例：`016100` = 角色1（0链1阶）、角色2（6链0阶）、角色3（0链0阶）。
     * 未配置角色的档位按角色面板为空处理（链 0 / 阶 0）。
     */
    let chainLabel = $derived.by(() => {
        const profile = getConditionProfile()
        return [0, 1, 2]
            .map((i) => {
                if (!team?.[i]?.character) return '00'
                const chain = profile.chains[i] ?? 0
                const refine = profile.refinements[i] ?? 0
                return `${chain}${refine}`
            })
            .join('')
    })

    /**
     * @desc 底部撤销/重做：排轴阶段回退时间线，拉表阶段只回退表格（Buff / 绑定 / 乘区条件）。
     * 依赖 store 的响应式 getter，禁用态自动跟随历史栈。
     * 结果页为只读展示，一律隐藏撤销/重做。
     */
    const showUndoRedo = $derived(!showResult && (activePhase === 'timeline' || activePhase === 'calculation'))
    const undoDisabled = $derived(activePhase === 'timeline' ? !canUndoTimeline() : !canUndoTable())
    const redoDisabled = $derived(activePhase === 'timeline' ? !canRedoTimeline() : !canRedoTable())
    const undoTitle = $derived(
        activePhase === 'timeline' ? '撤销排轴操作' : '撤销表格操作（只回退 Buff / 绑定 / 乘区条件，不动排轴与配装）'
    )
    const handleUndo = () => {
        if (activePhase === 'timeline') undoTimeline()
        else undoTable()
    }
    const handleRedo = () => {
        if (activePhase === 'timeline') redoTimeline()
        else redoTable()
    }

    // ── 简化底部工具栏：fixed 圆角矩形，仅水平拖动，磁吸侧栏右缘 / 屏幕右缘 ──
    let toolbarEl = $state<HTMLElement | null>(null)
    let toolbarX = $state<number | null>(null)
    let toolbarDrag = $state(false)
    let toolbarDragMoved = $state(false)
    let toolbarHover = $state(false)
    let toolbarStart = $state({ mx: 0, x: 0 })
    // 仅真正拖动（>4px）时整体放大 1.15；普通点击不触发整体缩放（按钮自身 :active 放大）
    const toolbarScale = $derived(toolbarDrag && toolbarDragMoved ? 1.15 : 1)
    // GPU 合成加速（设置 → 性能）：拖动定位用 transform 走合成层
    const gpuAccel = $derived(getGpuAccel())

    function toolbarDown(e: PointerEvent) {
        if (!simplifyToolbar) return
        e.preventDefault()
        toolbarDrag = true
        toolbarDragMoved = false
        const curLeft = toolbarEl?.getBoundingClientRect().left ?? toolbarX ?? window.innerWidth - 140
        toolbarStart = { mx: e.clientX, x: curLeft }
        // 不用 setPointerCapture（会把合成 click 重定向到容器导致按钮无法点击），改 window 级监听
        window.addEventListener('pointermove', toolbarMove)
        window.addEventListener('pointerup', toolbarUp)
        window.addEventListener('pointercancel', toolbarUp)
    }

    function toolbarMove(e: PointerEvent) {
        if (!toolbarDrag) return
        if (Math.abs(e.clientX - toolbarStart.mx) > 4) toolbarDragMoved = true
        const w = toolbarEl?.offsetWidth ?? 0
        const vw = window.innerWidth
        let nx = toolbarStart.x + (e.clientX - toolbarStart.mx)
        nx = Math.max(16, Math.min(nx, vw - w - 16))
        const leftAnchor = 16
        const rightAnchor = vw - w - 20
        if (Math.abs(nx - leftAnchor) < 48) nx = leftAnchor
        else if (Math.abs(nx - rightAnchor) < 48) nx = rightAnchor
        toolbarX = nx
    }

    function toolbarUp() {
        toolbarDrag = false
        window.removeEventListener('pointermove', toolbarMove)
        window.removeEventListener('pointerup', toolbarUp)
        window.removeEventListener('pointercancel', toolbarUp)
    }

    // 拖动超过阈值后抑制本次按钮 click（capture 阶段拦截）
    function toolbarClickCapture(e: MouseEvent) {
        if (toolbarDragMoved) {
            e.stopPropagation()
            toolbarDragMoved = false
        }
    }

    $effect(() => {
        if (!simplifyToolbar) return
        const onResize = () => {
            if (toolbarX !== null && toolbarEl) {
                toolbarX = Math.max(16, Math.min(toolbarX, window.innerWidth - toolbarEl.offsetWidth - 16))
            }
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    data-sf="toolbar"
    bind:this={toolbarEl}
    role="toolbar"
    onpointerdown={toolbarDown}
    onpointermove={toolbarMove}
    onpointerup={toolbarUp}
    onpointercancel={toolbarUp}
    onpointerenter={() => (toolbarHover = true)}
    onpointerleave={() => (toolbarHover = false)}
    onclickcapture={toolbarClickCapture}
    class={`${
        simplifyToolbar
            ? 'simplified-toolbar theme-glass-surface fixed bottom-5 z-40 flex cursor-grab touch-none select-none items-center gap-1.5 rounded-none border p-2 active:cursor-grabbing'
            : 'flex shrink-0 items-center gap-2 border-t px-4 py-2.5'
    } ${className || ''}`}
    style={simplifyToolbar
        ? `interpolate-size: allow-keywords; border-color: var(--theme-divider-border); --sf-base: color-mix(in srgb, var(--theme-modal-bg) 78%, transparent); color: var(--theme-modal-text);${
              toolbarX !== null && gpuAccel
                  ? `left: 0; transform: translate(${toolbarX}px, 0) scale(${toolbarScale});`
                  : `transform: scale(${toolbarScale});${toolbarX !== null ? `left: ${toolbarX}px;` : 'right: 20px;'}`
          }${
              toolbarScale > 1
                  ? ' box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-accent-bg) 60%, transparent), 0 0 14px color-mix(in srgb, var(--theme-accent-bg) 45%, transparent);'
                  : ''
          }transition: ${
              toolbarDrag
                  ? 'left 150ms ease'
                  : 'transform 150ms ease, box-shadow 150ms ease, left 150ms ease, width 250ms ease'
          };${toolbarDrag ? (gpuAccel ? ' will-change: transform;' : ' will-change: left;') : ''}${styleProp ? '; ' + styleProp : ''}`
        : `color: var(--theme-sidebar-text); border-color: var(--theme-divider-border);${styleProp ? ' ' + styleProp : ''}`}
>
    <button
        onclick={onCharDetail}
        class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-xs text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
            ? 'rounded-none px-3 py-2'
            : 'rounded-none px-3 py-1.5'}"
        title="角色详情配置（链阶：链1链2链3 阶1阶2阶3 = {chainLabel}）"
    >
        <Icon icon="mdi:account-details" class="size-4 shrink-0" />
        <span class="truncate">角色详情配置</span>
        <span class="shrink-0 font-black tabular-nums" style="color: var(--theme-accent-text);">{chainLabel}</span>
    </button>
    {#if !showResult}
        {#if activePhase === 'timeline'}
            <!-- ⛔ TEMP-HIDDEN（临时隐藏）：「查看所有伤害」入口按钮，恢复时删除本段包裹的注释即可
            <button
                onclick={() => setShowDamageList(true)}
                class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-xs text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                    ? 'rounded-none px-3 py-2'
                    : 'rounded-none px-3 py-1.5'}"
                title="查看所有伤害"
            >
                <Icon icon="mdi:chart-box-outline" class="size-4 shrink-0" />
                {#if !simplifyToolbar}<span>查看所有伤害</span>{/if}
            </button>
            ⛔ TEMP-HIDDEN-END -->
            <button
                onclick={formatTimeline}
                class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-xs text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                    ? 'rounded-none px-3 py-2'
                    : 'rounded-none px-3 py-1.5'}"
                title="自动格式化：每个操作块右边界对齐下一个块（可跨角色）的左边界，参考线跟随其左右块"
            >
                <Icon icon="mdi:auto-fix" class="size-4 shrink-0" />
                {#if !simplifyToolbar}<span>格式化</span>{/if}
            </button>
            <div class="relative group">
                <button
                    onclick={toggleQuickMode}
                    class="inline-flex items-center gap-1.5 border text-xs transition-colors {simplifyToolbar
                        ? 'rounded-none px-3 py-2'
                        : 'rounded-none px-3 py-1.5'} {getQuickMode()
                        ? 'border-(--theme-accent-bg)'
                        : 'border-(--theme-sidebar-text)/20'}"
                    style="color: {getQuickMode() ? 'var(--theme-accent-text)' : 'var(--theme-sidebar-text)'}"
                    title="快速排轴"
                >
                    <Icon icon="mdi:keyboard-outline" class="size-4 shrink-0" />
                    {#if !simplifyToolbar}
                        <span
                            >{getQuickMode()
                                ? '快速排轴(关闭' +
                                  (getQuickSpecial() !== 'none'
                                      ? `·${getQuickSpecial() === 'intro' ? '变奏' : '切回'}`
                                      : '') +
                                  ')'
                                : '快速排轴(开启)'}</span
                        >
                    {/if}
                </button>
            </div>
        {/if}
        {#if activePhase === 'config'}
            <button
                onclick={() => openSubstatLibrary()}
                disabled={phaseLocked}
                class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-xs text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 disabled:pointer-events-none disabled:opacity-40 {simplifyToolbar
                    ? 'rounded-none px-3 py-2'
                    : 'rounded-none px-3 py-1.5'}"
                title="打开快速词条方案：一键套用标准14词条，或管理/套用自定义声骸词条方案"
            >
                <Icon icon="mdi:clipboard-text-outline" class="size-4 shrink-0" />
                {#if !simplifyToolbar}<span>快速词条方案</span>{/if}
            </button>
        {/if}
        {#if activePhase === 'calculation'}
            <button
                onclick={() => setShowBuffModal(true)}
                class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-xs text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                    ? 'rounded-none px-3 py-2'
                    : 'rounded-none px-3 py-1.5'}"
                title="BUFF配置"
            >
                <Icon icon="mdi:tune-variant" class="size-4 shrink-0" />
                {#if !simplifyToolbar}<span>BUFF配置</span>{/if}
            </button>
            {#if getCalcViewMode() !== 'spread'}
                <button
                    onclick={toggleBuffDiffMode}
                    class="inline-flex items-center gap-1.5 border text-xs transition-colors {simplifyToolbar
                        ? 'rounded-none px-3 py-2'
                        : 'rounded-none px-3 py-1.5'} {getBuffDiffMode()
                        ? 'border-(--theme-accent-bg)'
                        : 'border-(--theme-sidebar-text)/20'}"
                    style="color: {getBuffDiffMode() ? 'var(--theme-accent-text)' : 'var(--theme-sidebar-text)'}"
                    title={getBuffDiffMode() ? 'Buff差异模式' : 'Buff全览模式'}
                >
                    <Icon
                        icon={getBuffDiffMode() ? 'mdi:swap-vertical-bold' : 'mdi:swap-vertical'}
                        class="size-4 shrink-0"
                    />
                    {#if !simplifyToolbar}
                        <span>{getBuffDiffMode() ? 'Buff差异模式' : 'Buff全览模式'}</span>
                    {/if}
                </button>
            {/if}
            {#if getCalcViewMode() === 'spread'}
                <button
                    onclick={() => setShowDamageTypeModal(true)}
                    class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-xs text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                        ? 'rounded-none px-3 py-2'
                        : 'rounded-none px-3 py-1.5'}"
                    title="逐个倍率确认伤害类型（拉表第一步）"
                >
                    <Icon icon="mdi:playlist-edit" class="size-4 shrink-0" />
                    {#if !simplifyToolbar}
                        <span>编辑伤害类型</span>
                    {/if}
                </button>
                <button
                    onclick={() => {
                        const next = getScrollAxisDefault() === 'vertical' ? 'horizontal' : 'vertical'
                        setScrollAxisDefault(next)
                        addToast(
                            next === 'horizontal'
                                ? '已切换为默认横向滚动（Shift+方向键改变默认方向，Ctrl+滚轮临时换向）'
                                : '已切换为默认纵向滚动（Shift+方向键改变默认方向，Ctrl+滚轮临时换向）',
                            'success'
                        )
                    }}
                    class="inline-flex items-center gap-1.5 border text-xs transition-colors {simplifyToolbar
                        ? 'rounded-none px-3 py-2'
                        : 'rounded-none px-3 py-1.5'} {getScrollAxisDefault() === 'horizontal'
                        ? 'border-(--theme-accent-bg)'
                        : 'border-(--theme-sidebar-text)/20'}"
                    style="color: {getScrollAxisDefault() === 'horizontal'
                        ? 'var(--theme-accent-text)'
                        : 'var(--theme-sidebar-text)'}"
                    title="修改默认滚动方向：Shift+方向键 改变默认方向（持久）；Ctrl+滚轮 临时换向"
                >
                    <Icon
                        icon={getScrollAxisDefault() === 'horizontal' ? 'mdi:arrow-right-bold' : 'mdi:arrow-down'}
                        class="size-4 shrink-0"
                    />
                    {#if !simplifyToolbar}
                        <span>{getScrollAxisDefault() === 'horizontal' ? '默认横向滚动' : '默认纵向滚动'}</span>
                    {/if}
                </button>
            {/if}
            {#if getCalcViewMode() !== 'spread'}
                <button
                    onclick={toggleHideConditionMismatch}
                    class="inline-flex items-center gap-1.5 border text-xs transition-colors {simplifyToolbar
                        ? 'rounded-none px-3 py-2'
                        : 'rounded-none px-3 py-1.5'} {getHideConditionMismatch()
                        ? 'border-(--theme-accent-bg)'
                        : 'border-(--theme-sidebar-text)/20'}"
                    style="color: {getHideConditionMismatch()
                        ? 'var(--theme-accent-text)'
                        : 'var(--theme-sidebar-text)'}"
                    title="隐藏条件不匹配（链/阶低于配置、属性/类型对不上条目）的 buff"
                >
                    <Icon
                        icon={getHideConditionMismatch() ? 'mdi:filter-off' : 'mdi:filter-outline'}
                        class="size-4 shrink-0"
                    />
                    {#if !simplifyToolbar}
                        <span>{getHideConditionMismatch() ? '可用Buff' : '全部Buff'}</span>
                    {/if}
                </button>
            {/if}
        {/if}
    {/if}
    {#if simplifyToolbar}
        <div
            class="mx-1.5 h-5 w-px shrink-0"
            style="background: color-mix(in srgb, var(--theme-modal-text) 15%, transparent);"
        ></div>
    {:else}
        <div class="flex-1"></div>
    {/if}
    {#if showUndoRedo}
        <button
            onclick={handleUndo}
            disabled={undoDisabled}
            class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-xs text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 disabled:pointer-events-none disabled:opacity-40 {simplifyToolbar
                ? 'rounded-none px-3 py-2'
                : 'rounded-none px-3 py-1.5'}"
            title={undoTitle}
        >
            <Icon icon="mdi:undo-variant" class="size-4 shrink-0" />
            {#if !simplifyToolbar}<span>撤销</span>{/if}
        </button>
        <button
            onclick={handleRedo}
            disabled={redoDisabled}
            class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-xs text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 disabled:pointer-events-none disabled:opacity-40 {simplifyToolbar
                ? 'rounded-none px-3 py-2'
                : 'rounded-none px-3 py-1.5'}"
            title={activePhase === 'timeline' ? '重做排轴操作' : '重做表格操作'}
        >
            <Icon icon="mdi:redo-variant" class="size-4 shrink-0" />
            {#if !simplifyToolbar}<span>重做</span>{/if}
        </button>
    {/if}
    {#if showResult}
        <button
            onclick={onRefresh}
            class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-xs text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                ? 'rounded-none px-3 py-2'
                : 'rounded-none px-3 py-1.5'}"
            title="刷新结果"
        >
            <Icon icon="mdi:refresh" class="size-4 shrink-0" />
            {#if !simplifyToolbar}<span>刷新结果</span>{/if}
        </button>
    {/if}
    {#if !showResult}
        <button
            onclick={onLockToggle}
            disabled={!phaseLocked && !canLock}
            class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-xs text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 disabled:opacity-40 disabled:pointer-events-none {simplifyToolbar
                ? 'rounded-none px-3 py-2'
                : 'rounded-none px-3 py-1.5'}"
            title={phaseLocked ? '解锁' : '锁定'}
        >
            <Icon icon={phaseLocked ? 'mdi:lock-open-variant-outline' : 'mdi:lock-outline'} class="size-4 shrink-0" />
            {#if !simplifyToolbar}<span>{phaseLocked ? '解锁' : '锁定'}</span>{/if}
        </button>
    {/if}
</div>

<style>
    /* ── 简化底部工具栏（悬浮模式）── */
    /* 按钮点击/按住时按钮自身放大（hover 不放大）；保留原有颜色过渡 */
    .simplified-toolbar > button {
        transition:
            transform 150ms ease,
            color 150ms ease,
            background-color 150ms ease,
            border-color 150ms ease;
    }
    .simplified-toolbar > button:active:not(:disabled) {
        transform: scale(1.15);
    }
</style>
