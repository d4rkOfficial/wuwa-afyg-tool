<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { PhaseKey } from '$lib/types/project'
    import { getGpuAccel } from '$lib/data/render-prefs.svelte'
    import {
        setShowDamageList,
        getQuickMode,
        getQuickSpecial,
        toggleQuickMode,
        formatTimeline
    } from '$lib/calc/timeline.store.svelte'
    import {
        setShowBuffModal,
        getBuffDiffMode,
        toggleBuffDiffMode,
        getHideConditionMismatch,
        toggleHideConditionMismatch
    } from '$lib/calc/calculation.store.svelte'
    import {
        getCalcViewMode,
        getDamageTypeEditMode,
        setDamageTypeEditMode,
        getScrollAxisDefault,
        setScrollAxisDefault
    } from '$lib/data/calc-view.svelte'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props extends ComponentsProps {
        simplifyToolbar: boolean
        activePhase: PhaseKey
        showResult: boolean
        teamPhaseLocked: boolean
        phaseLocked: boolean
        canLock: boolean
        onLookup: () => void
        onCharDetail: () => void
        onRefresh: () => void
        onLockToggle: () => void
    }
    let {
        simplifyToolbar,
        activePhase,
        showResult,
        teamPhaseLocked,
        phaseLocked,
        canLock,
        onLookup,
        onCharDetail,
        onRefresh,
        onLockToggle,
        class: className,
        style: styleProp
    }: Props = $props()

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
            ? 'simplified-toolbar theme-glass-surface fixed bottom-5 z-40 flex cursor-grab touch-none select-none items-center gap-1.5 rounded-xl border p-2 shadow-2xl active:cursor-grabbing'
            : 'flex shrink-0 items-center gap-2 border-t border-white/5 px-4 py-2.5'
    } ${className || ''}`}
    style={simplifyToolbar
        ? `interpolate-size: allow-keywords; border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 78%, transparent); color: var(--theme-modal-text);${
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
        : `background: var(--theme-sidebar-bg); color: var(--theme-sidebar-text);${styleProp ? ' ' + styleProp : ''}`}
>
    <button
        onclick={onLookup}
        disabled={!teamPhaseLocked}
        class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 disabled:opacity-40 disabled:pointer-events-none {simplifyToolbar
            ? 'rounded-full px-3 py-2'
            : 'rounded-lg px-3 py-1.5'}"
        title="速查"
    >
        <Icon icon="mdi:book-search-outline" class="size-4 shrink-0" />
        {#if !simplifyToolbar}<span>速查</span>{/if}
    </button>
    <button
        onclick={onCharDetail}
        class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
            ? 'rounded-full px-3 py-2'
            : 'rounded-lg px-3 py-1.5'}"
        title="角色详情配置"
    >
        <Icon icon="mdi:account-details" class="size-4 shrink-0" />
        {#if !simplifyToolbar}<span>角色详情配置</span>{/if}
    </button>
    {#if !showResult}
        {#if activePhase === 'timeline'}
            <button
                onclick={() => setShowDamageList(true)}
                class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                    ? 'rounded-full px-3 py-2'
                    : 'rounded-lg px-3 py-1.5'}"
                title="查看所有伤害"
            >
                <Icon icon="mdi:chart-box-outline" class="size-4 shrink-0" />
                {#if !simplifyToolbar}<span>查看所有伤害</span>{/if}
            </button>
            <button
                onclick={formatTimeline}
                class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                    ? 'rounded-full px-3 py-2'
                    : 'rounded-lg px-3 py-1.5'}"
                title="自动格式化：每个操作块右边界对齐下一个块（可跨角色）的左边界，参考线跟随其左右块"
            >
                <Icon icon="mdi:auto-fix" class="size-4 shrink-0" />
                {#if !simplifyToolbar}<span>格式化</span>{/if}
            </button>
            <div class="relative group">
                <button
                    onclick={toggleQuickMode}
                    class="inline-flex items-center gap-1.5 border text-sm transition-colors {simplifyToolbar
                        ? 'rounded-full px-3 py-2'
                        : 'rounded-lg px-3 py-1.5'} {getQuickMode()
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
        {#if activePhase === 'calculation'}
            <button
                onclick={() => setShowBuffModal(true)}
                class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                    ? 'rounded-full px-3 py-2'
                    : 'rounded-lg px-3 py-1.5'}"
                title="BUFF配置"
            >
                <Icon icon="mdi:tune-variant" class="size-4 shrink-0" />
                {#if !simplifyToolbar}<span>BUFF配置</span>{/if}
            </button>
            {#if getCalcViewMode() !== 'spread'}
                <button
                    onclick={toggleBuffDiffMode}
                    class="inline-flex items-center gap-1.5 border text-sm transition-colors {simplifyToolbar
                        ? 'rounded-full px-3 py-2'
                        : 'rounded-lg px-3 py-1.5'} {getBuffDiffMode()
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
                    onclick={() => {
                        const next = !getDamageTypeEditMode()
                        setDamageTypeEditMode(next)
                        addToast(next ? '已切换为编辑伤害类型' : '已切换为仅查看伤害类型', 'success')
                    }}
                    class="inline-flex items-center gap-1.5 border text-sm transition-colors {simplifyToolbar
                        ? 'rounded-full px-3 py-2'
                        : 'rounded-lg px-3 py-1.5'} {getDamageTypeEditMode()
                        ? 'border-(--theme-accent-bg)'
                        : 'border-(--theme-sidebar-text)/20'}"
                    style="color: {getDamageTypeEditMode() ? 'var(--theme-accent-text)' : 'var(--theme-sidebar-text)'}"
                    title="切换「视为」列伤害类型的编辑 / 只读查看"
                >
                    <Icon icon={getDamageTypeEditMode() ? 'mdi:pencil' : 'mdi:eye-off'} class="size-4 shrink-0" />
                    {#if !simplifyToolbar}
                        <span>{getDamageTypeEditMode() ? '伤害类型(编辑中)' : '伤害类型(仅查看)'}</span>
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
                    class="inline-flex items-center gap-1.5 border text-sm transition-colors {simplifyToolbar
                        ? 'rounded-full px-3 py-2'
                        : 'rounded-lg px-3 py-1.5'} {getScrollAxisDefault() === 'horizontal'
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
                    class="inline-flex items-center gap-1.5 border text-sm transition-colors {simplifyToolbar
                        ? 'rounded-full px-3 py-2'
                        : 'rounded-lg px-3 py-1.5'} {getHideConditionMismatch()
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
    {#if showResult}
        <button
            onclick={onRefresh}
            class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                ? 'rounded-full px-3 py-2'
                : 'rounded-lg px-3 py-1.5'}"
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
            class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 disabled:opacity-40 disabled:pointer-events-none {simplifyToolbar
                ? 'rounded-full px-3 py-2'
                : 'rounded-lg px-3 py-1.5'}"
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
