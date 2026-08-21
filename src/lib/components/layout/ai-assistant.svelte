<script lang="ts">
    import { onMount } from 'svelte'
    import Icon from '@iconify/svelte'
    import { fade } from 'svelte/transition'
    import { runAiTurn, type SessionEvent } from '../../ai/session'
    import { getAiConfig, loadAiConfig } from '../../ai/config.svelte'
    import { loadGenPrefs, getGenPrefs, getDangerMode } from '$lib/data/ai-prefs.svelte'
    import { getActiveProject, updateCalculation } from '$lib/data/project.svelte'
    import { notifyCalcUpdate, getCalcState } from '$lib/calc/calculation.store.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import { getGpuAccel } from '$lib/data/render-prefs.svelte'
    import { cancelActiveDrags } from '$lib/utils/drag-guard'
    import { marked } from 'marked'
    import { getOpenPanelsSummary } from '../../ai/panels.svelte'
    import { DeepSeekError, type ChatMessage } from '../../ai/client'
    import type { ComponentsProps } from '$lib/types'

    interface ToolCard {
        name: string
        args: Record<string, unknown>
        resultLen?: number
    }

    interface DisplayMsg {
        role: 'user' | 'assistant'
        text: string
        reasoning?: string
        tools?: ToolCard[]
        // 发言是否已结束（结束后自动收起思考过程与工具调用）
        done?: boolean
        // 气泡内当前激活的 tab（聊天/思考/工具）
        tab?: 'chat' | 'reasoning' | 'tools'
    }

    interface Props extends ComponentsProps {
        // 宿主视图状态（+page 传入，用户切换时 AI 可感知）
        viewPhase?: string
        viewShowResult?: boolean
        // AI 请求切换视图（+page 提供 setter）
        onRequestView?: (phase: string) => void
    }

    let {
        viewPhase = 'team',
        viewShowResult = false,
        onRequestView,
        class: className,
        style: styleProp
    }: Props = $props()

    const VIEW_LABELS: Record<string, string> = {
        team: '队伍',
        timeline: '排轴',
        calculation: '拉表',
        config: '配装',
        result: '结果'
    }

    // 悬浮窗形态：collapsed=48px 圆钮 / small=默认小卡片 / large=全尺寸卡片
    let size = $state<'collapsed' | 'small' | 'large'>('collapsed')
    let busy = $state(false)
    let input = $state('')
    let messages = $state<ChatMessage[]>([])
    let display = $state<DisplayMsg[]>([])
    // 危险操作确认卡片（显示在聊天框中，不遮罩弹窗）
    let confirmCard = $state<{ toolName: string; summary: string; resolve: (v: boolean) => void } | null>(null)
    // 批量信任：一次指令回合内已批准过危险操作 → 后续危险操作直接放行（dangerMode=ask_once）
    let turnDangerApproved = $state(false)
    let abortCtrl = $state<AbortController | null>(null)

    // 拖动位置（左上角坐标；null = 默认右下角）
    let dragPos = $state<{ x: number; y: number } | null>(null)
    let dragging = $state(false)
    let dragStart = $state({ mx: 0, my: 0, x: 0, y: 0 })

    function startDrag(e: PointerEvent) {
        const target = e.target as HTMLElement
        if (target.closest('button')) return
        // 阻止兼容 mouse 事件穿透到下层页面（避免拖动卡片时触发排轴/拉表框选）
        e.preventDefault()
        dragging = true
        const base = dragPos ?? {
            x: window.innerWidth - curW - 16,
            y: window.innerHeight - curH - 16
        }
        dragStart = { mx: e.clientX, my: e.clientY, x: base.x, y: base.y }
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    }

    function moveDrag(e: PointerEvent) {
        if (!dragging) return
        const nx = dragStart.x + (e.clientX - dragStart.mx)
        const ny = dragStart.y + (e.clientY - dragStart.my)
        dragPos = {
            x: Math.max(0, Math.min(nx, window.innerWidth - curW)),
            y: Math.max(0, Math.min(ny, window.innerHeight - curH))
        }
    }

    function stopDrag() {
        if (!dragging) return
        dragging = false
    }

    // 收起态圆钮拖动（共用 dragPos；拖动后不触发展开）
    let btnDrag = $state(false)
    let btnMoved = $state(false)
    let btnStart = $state({ mx: 0, my: 0, x: 0, y: 0 })
    // 收起态悬浮钮 hover 状态（强调轮廓 + 放大 1.05；拖拽时放大 1.15）
    let btnHover = $state(false)
    const btnScale = $derived(size === 'collapsed' ? (btnDrag ? 1.15 : btnHover ? 1.05 : 1) : 1)

    function btnDown(e: PointerEvent) {
        // 阻止兼容 mouse 事件穿透到下层页面（避免拖动圆钮时触发排轴/拉表框选）
        e.preventDefault()
        btnDrag = true
        btnMoved = false
        const base = dragPos ?? { x: window.innerWidth - 48 - 16, y: window.innerHeight - 48 - 16 }
        btnStart = { mx: e.clientX, my: e.clientY, x: base.x, y: base.y }
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    }

    function btnMove(e: PointerEvent) {
        if (!btnDrag) return
        if (Math.abs(e.clientX - btnStart.mx) > 4 || Math.abs(e.clientY - btnStart.my) > 4) btnMoved = true
        const nx = btnStart.x + (e.clientX - btnStart.mx)
        const ny = btnStart.y + (e.clientY - btnStart.my)
        dragPos = {
            x: Math.max(0, Math.min(nx, window.innerWidth - 48)),
            y: Math.max(0, Math.min(ny, window.innerHeight - 48))
        }
    }

    function btnUp() {
        btnDrag = false
    }

    function btnClick() {
        if (btnMoved) return
        toggle()
    }

    // 将坐标钳制到当前视口内（按元素尺寸 w/h 留 8px 边距；视口不可用/过小则回退默认位置）
    function clampToViewport(
        pos: { x: number; y: number } | null,
        w: number,
        h: number
    ): { x: number; y: number } | null {
        if (!pos) return null
        const vw = typeof window !== 'undefined' ? window.innerWidth : 0
        const vh = typeof window !== 'undefined' ? window.innerHeight : 0
        if (vw <= 0 || vh <= 0) return null
        const maxX = vw - w - 8
        const maxY = vh - h - 8
        if (maxX < 8 || maxY < 8) return null
        return { x: Math.max(8, Math.min(pos.x, maxX)), y: Math.max(8, Math.min(pos.y, maxY)) }
    }

    const aiConfig = $derived(getAiConfig())
    // AI 助手是否启用（悬浮窗显隐）
    const aiEnabled = $derived(getGenPrefs().enabled)
    // GPU 合成加速（设置 → 交互相关）：拖拽定位用 transform 走合成层
    const gpuAccel = $derived(getGpuAccel())
    // 最新一条用户消息的展示索引（仅它可重试）
    const lastUserDisplayIdx = $derived.by(() => {
        for (let i = display.length - 1; i >= 0; i--) {
            if (display[i].role === 'user') return i
        }
        return -1
    })

    // 当前状态上下文（工程 + 视图），每轮注入给 AI；用户切换工程/视图会自动反映
    const contextState = $derived.by(() => {
        const p = getActiveProject()
        const project = p ? `「${p.name}」（${p.id}）` : '无'
        const view = viewShowResult ? '结果' : (VIEW_LABELS[viewPhase] ?? viewPhase)
        const phases = ['team', 'timeline', 'calculation', 'config'] as const
        const locked = p ? phases.map((k) => `${k}${p.phases[k]?.locked ? '已锁' : '未锁'}`).join('，') : ''
        const panels = getOpenPanelsSummary()
        return `工程：${project}；视图：${view}${locked ? `；环节：${locked}` : ''}${panels ? `；弹窗：${panels}` : ''}`
    })

    // 展开/收起过渡标记：切换瞬间给位置属性加 0.38s 过渡，实现「向四周展开 / 向中心收起」
    let collapsing = $state(false)
    let collapsingTimer: ReturnType<typeof setTimeout> | null = null

    function toggle(e?: MouseEvent) {
        const wasCollapsed = size === 'collapsed'
        const prevSize = size
        size = wasCollapsed ? 'small' : 'collapsed'
        const w = size === 'small' ? smallW : cardW
        const h = size === 'small' ? smallH : cardH
        // 切换前形态的尺寸（按钮 48 / 小卡片 / 全尺寸）
        const pw = prevSize === 'small' ? smallW : prevSize === 'large' ? cardW : 48
        const ph = prevSize === 'small' ? smallH : prevSize === 'large' ? cardH : 48
        // 当前形态的左上角与中心（默认位置按右下角推算）
        const curLeft = dragPos ? dragPos.x : window.innerWidth - pw - 16
        const curTop = dragPos ? dragPos.y : window.innerHeight - ph - 16
        const centerX = curLeft + pw / 2
        const centerY = curTop + ph / 2
        if (!wasCollapsed) {
            // 展开：以按钮为中心向四周展开（新卡片中心 = 按钮中心），钳制到视口
            dragPos = clampToViewport({ x: centerX - w / 2, y: centerY - h / 2 }, w, h)
        } else if (e) {
            // 收起：按钮中心对齐双击时的鼠标位置，钳制到视口（不持久化，位置为本次会话临时状态）
            dragPos = clampToViewport({ x: e.clientX - 24, y: e.clientY - 24 }, 48, 48)
        }
        // 位置与尺寸走同步过渡（视觉上向四周展开 / 向中心收起）
        collapsing = true
        if (collapsingTimer !== null) clearTimeout(collapsingTimer)
        collapsingTimer = setTimeout(() => {
            collapsing = false
            collapsingTimer = null
        }, 420)
    }

    // 小卡片 ↔ 全尺寸卡片切换
    function toggleScale() {
        size = size === 'small' ? 'large' : 'small'
        if (dragPos) {
            const w = size === 'small' ? smallW : cardW
            const h = size === 'small' ? smallH : cardH
            const clamped = clampToViewport(dragPos, w, h)
            if (clamped && (clamped.x !== dragPos.x || clamped.y !== dragPos.y)) dragPos = clamped
            else if (!clamped) dragPos = null
        }
    }

    function clearConversation() {
        abortCtrl?.abort()
        messages = []
        display = []
    }

    function stopGenerating() {
        abortCtrl?.abort()
    }

    async function send(retryText?: string) {
        const text = (retryText ?? input).trim()
        if (!text || busy) return
        input = ''
        busy = true
        abortCtrl = new AbortController()
        turnDangerApproved = false
        // 重试：回退到该条用户消息（含）之后全部内容，重新发送
        if (retryText) {
            let lastUserIdx = -1
            for (let i = display.length - 1; i >= 0; i--) {
                if (display[i].role === 'user' && display[i].text === retryText) {
                    lastUserIdx = i
                    break
                }
            }
            if (lastUserIdx > 0) display = display.slice(0, lastUserIdx)
            const msgUsers = messages
                .map((m, i) => (m.role === 'user' && m.content === retryText ? i : -1))
                .filter((i) => i >= 0)
            if (msgUsers.length > 0) messages = messages.slice(0, msgUsers[msgUsers.length - 1])
        }
        display = [
            ...display,
            { role: 'user', text },
            { role: 'assistant', text: '', reasoning: '', tools: [], done: false, tab: 'chat' }
        ]
        const last = () => display[display.length - 1]

        try {
            await runAiTurn({
                history: messages,
                newUserMessage: text,
                context: contextState,
                signal: abortCtrl.signal,
                onMessages: (msgs) => (messages = msgs),
                requestView: onRequestView,
                onCalcUpdate: () => {
                    notifyCalcUpdate()
                    updateCalculation(getCalcState())
                },
                onGenerateProgress: (status) => {
                    // 生成任务进度：合并到正在执行的 generate_* 工具卡片上，并切到工具 tab
                    const tools = last().tools ?? []
                    const prev = tools[tools.length - 1]
                    if (prev && prev.name.startsWith('generate_') && prev.resultLen === undefined) {
                        prev.args = { ...prev.args, status }
                    } else {
                        tools.push({ name: 'buff生成', args: { status } })
                    }
                    last().tools = tools
                    last().tab = 'tools'
                    scrollToBottom()
                },
                onConfirm: (toolName, summary) =>
                    new Promise<boolean>((resolve) => {
                        const mode = getDangerMode()
                        // 无条件信任：直接放行
                        if (mode === 'trust') {
                            resolve(true)
                            return
                        }
                        // 批量只询问一次：本回合已批准过 → 直接放行
                        if (mode === 'ask_once' && turnDangerApproved) {
                            addToast(`已按批量信任放行「${toolName}」`, 'info')
                            resolve(true)
                            return
                        }
                        confirmCard = {
                            toolName,
                            summary,
                            resolve: (v) => {
                                if (v && mode === 'ask_once') turnDangerApproved = true
                                resolve(v)
                            }
                        }
                    }),
                onEvent: (evt: SessionEvent) => {
                    if (evt.type === 'ai') {
                        last().text += evt.text ?? ''
                        last().tab = 'chat'
                    } else if (evt.type === 'reasoning') {
                        last().reasoning = (last().reasoning ?? '') + (evt.text ?? '')
                        last().tab = 'reasoning'
                    } else if (evt.type === 'tool') {
                        const tools = last().tools ?? []
                        const prev = tools[tools.length - 1]
                        if (
                            evt.resultLen !== undefined &&
                            prev &&
                            prev.name === evt.toolName &&
                            prev.resultLen === undefined
                        ) {
                            prev.resultLen = evt.resultLen
                            // AI 切换工程/视图后告知用户
                            if (evt.toolName === 'switch_view') {
                                addToast('AI 已切换视图', 'success')
                            } else if (evt.toolName === 'set_active_project') {
                                addToast('AI 已切换工程', 'success')
                            }
                        } else if (evt.toolName) {
                            tools.push({ name: evt.toolName, args: evt.toolArgs ?? {} })
                        }
                        last().tools = tools
                        last().tab = 'tools'
                        scrollToBottom()
                    } else if (evt.type === 'error') {
                        last().text = (last().text ? last().text + '\n' : '') + `⚠ ${evt.message ?? 'AI 请求失败'}`
                        last().tab = 'chat'
                    }
                    scrollToBottom()
                }
            })
        } catch (e) {
            const isAborted = e instanceof DeepSeekError && e.debug === 'aborted'
            if (!isAborted) {
                last().text =
                    (last().text ? last().text + '\n' : '') + `⚠ ${e instanceof Error ? e.message : 'AI 请求失败'}`
            }
        }
        // 发言结束：切回聊天 tab（自动收起思考过程与工具调用）
        const lastMsg = display[display.length - 1]
        if (lastMsg?.role === 'assistant') {
            lastMsg.done = true
            lastMsg.tab = 'chat'
        }
        busy = false
        abortCtrl = null
        scrollToBottom()
    }

    let bodyEl: HTMLDivElement | undefined = $state()
    $effect(() => {
        if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight
    })

    // 滚动到聊天区底部（tab 切换 / 内容更新时调用）
    function scrollToBottom() {
        if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight
    }

    // 切换气泡内 tab（聊天/思考/工具）并滚动到底部
    function setTab(m: DisplayMsg, tab: NonNullable<DisplayMsg['tab']>) {
        m.tab = tab
        scrollToBottom()
    }

    // AI 回复 Markdown 渲染（换行即 <br>；链接新窗口打开）
    function renderMd(text: string): string {
        try {
            const renderer = new marked.Renderer()
            const link = renderer.link.bind(renderer)
            renderer.link = (linkArg) => link(linkArg).replace('<a ', '<a target="_blank" rel="noreferrer" ')
            return marked.parse(text, { breaks: true, renderer }) as string
        } catch {
            return text
        }
    }

    // 卡片尺寸：固定横屏形态（宽度固定，高度随窗口占满）
    let winH = $state(typeof window !== 'undefined' ? window.innerHeight : 800)
    const cardW = 480
    const cardH = $derived(winH - 24)
    // 默认展开的小卡片尺寸
    const smallW = 380
    const smallH = 460
    const curW = $derived(size === 'collapsed' ? 48 : size === 'small' ? smallW : cardW)
    const curH = $derived(size === 'collapsed' ? 48 : size === 'small' ? smallH : cardH)
    let expandedH = $state(600)
    $effect(() => {
        const update = () => {
            winH = window.innerHeight
            expandedH = cardH
            // 窗口尺寸变化（或展开/收起切换）时按当前形态尺寸修正悬浮窗位置
            const cw = size === 'collapsed' ? 48 : size === 'small' ? smallW : cardW
            const ch = size === 'collapsed' ? 48 : size === 'small' ? smallH : cardH
            if (dragPos) {
                const clamped = clampToViewport(dragPos, cw, ch)
                if (clamped && (clamped.x !== dragPos.x || clamped.y !== dragPos.y)) dragPos = clamped
                else if (!clamped) dragPos = null
            }
        }
        update()
        window.addEventListener('resize', update)
        return () => window.removeEventListener('resize', update)
    })

    // 挂载时从本地库恢复持久化的 AI 配置（悬浮窗直接使用场景也生效）
    onMount(() => {
        loadAiConfig()
        loadGenPrefs()
    })
</script>

<!-- 单容器：收起=48px 圆钮（图标居中），展开=卡片；尺寸/圆角/背景过渡动画 -->
{#if aiEnabled}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="ai-assistant theme-glass-surface fixed z-40 flex flex-col overflow-hidden border shadow-2xl {dragPos
            ? ''
            : 'bottom-4 right-4'} {className}"
        style="{dragPos
            ? gpuAccel
                ? `left:0;top:0;transform: translate(${dragPos.x}px, ${dragPos.y}px)${size === 'collapsed' ? ` scale(${btnScale})` : ''};`
                : `left:${dragPos.x}px;top:${dragPos.y}px;${size === 'collapsed' ? `transform: scale(${btnScale});` : ''}`
            : size === 'collapsed'
              ? `transform: scale(${btnScale});`
              : ''}{gpuAccel && (dragging || btnDrag) ? ' will-change: transform;' : ''}{size === 'collapsed' &&
        btnScale > 1
            ? ' box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-accent-bg) 60%, transparent), 0 0 14px color-mix(in srgb, var(--theme-accent-bg) 45%, transparent);'
            : ''}width:{curW}px;height:{curH}px;border-radius:{size === 'collapsed'
            ? '9999px'
            : '0.75rem'};transition:width .38s cubic-bezier(.32,.72,.24,1),height .38s cubic-bezier(.32,.72,.24,1),border-radius .38s cubic-bezier(.32,.72,.24,1),background-color .38s cubic-bezier(.32,.72,.24,1){btnDrag ||
        dragging
            ? ''
            : ',transform 150ms ease,box-shadow 150ms ease'}{collapsing
            ? ',transform .38s cubic-bezier(.32,.72,.24,1),left .38s cubic-bezier(.32,.72,.24,1),top .38s cubic-bezier(.32,.72,.24,1)'
            : ''};background:{size === 'collapsed'
            ? 'var(--theme-accent-bg)'
            : 'color-mix(in srgb, var(--theme-modal-bg) 78%, transparent)'};color:{size === 'collapsed'
            ? 'var(--theme-accent-text-on-bg, #fff)'
            : 'var(--theme-modal-text)'};border-color:var(--theme-divider-border);${styleProp || ''}"
        onmousedown={(e) => e.stopPropagation()}
        onmousemove={(e) => e.stopPropagation()}
        onmouseup={(e) => e.stopPropagation()}
        onpointerenter={(e) => {
            if (e.buttons !== 0) cancelActiveDrags()
        }}
        onmouseenter={(e) => {
            if (e.buttons !== 0) cancelActiveDrags()
        }}
    >
        {#if size === 'collapsed'}
            <!-- 收起态：图标居中（可点击/拖动，拖动不触发展开） -->
            <div
                class="flex h-full w-full cursor-grab touch-none select-none items-center justify-center"
                role="button"
                tabindex="0"
                aria-label="AI 助手（点击展开，拖动可移动）"
                onpointerdown={btnDown}
                onpointermove={btnMove}
                onpointerup={btnUp}
                onpointercancel={btnUp}
                onpointerenter={() => (btnHover = true)}
                onpointerleave={() => (btnHover = false)}
                onclick={btnClick}
                onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        btnClick()
                    }
                }}
                title="AI 助手（拖动可移动）"
            >
                <div transition:fade class="flex h-full w-full items-center justify-center">
                    <Icon icon="mdi:robot-outline" class="size-6" />
                </div>
            </div>
        {:else}
            <!-- 头部（可拖动；双击非按钮区域收起） -->
            <div
                class="flex shrink-0 cursor-move touch-none select-none items-center gap-2 border-b px-3 py-2.5"
                style="border-color: var(--theme-divider-border);"
                onpointerdown={startDrag}
                onpointermove={moveDrag}
                onpointerup={stopDrag}
                onpointercancel={stopDrag}
                ondblclick={(e) => {
                    if (!(e.target as HTMLElement).closest('button')) toggle(e)
                }}
            >
                <Icon icon="mdi:robot-outline" class="size-5 shrink-0 text-(--theme-accent-text)" />
                <div class="min-w-0 flex-1 leading-tight">
                    <div class="truncate text-sm font-semibold" title={aiConfig.baseUrl}>{aiConfig.model}</div>
                    <div class="truncate text-[10px] text-(--theme-modal-text)/50" title={aiConfig.baseUrl}>
                        {aiConfig.label}
                    </div>
                </div>
                <button
                    onclick={clearConversation}
                    class="rounded p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/80"
                    title="清空对话"
                >
                    <Icon icon="mdi:broom" class="size-4" />
                </button>
                <button
                    onclick={toggleScale}
                    class="rounded p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/80"
                    title={size === 'small' ? '放大到全尺寸' : '缩小'}
                >
                    <Icon icon={size === 'small' ? 'mdi:arrow-expand' : 'mdi:arrow-collapse'} class="size-4" />
                </button>
            </div>

            <!-- 消息区 -->
            <div bind:this={bodyEl} class="theme-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {#if display.length === 0}
                    <div class="py-10 text-center text-xs text-(--theme-modal-text)/30">
                        用文字指挥我：创建工程、锁定环节、查队伍、
                        <br />后续还可排轴、拉表、配置 Buff 集
                    </div>
                {/if}
                {#each display as m, i (m)}
                    {#if m.role === 'user'}
                        {@const isLastUser = i === lastUserDisplayIdx}
                        <div class="flex justify-end">
                            <div
                                class="max-w-[85%] whitespace-pre-wrap wrap-break-word rounded-2xl rounded-br-sm px-3 py-2 text-xs leading-relaxed"
                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                            >
                                {m.text}
                                {#if isLastUser}
                                    <button
                                        onclick={() => send(m.text)}
                                        disabled={busy}
                                        class="ml-1 inline-flex items-center rounded px-0.5 py-0.5 align-middle opacity-50 transition-opacity hover:opacity-100 disabled:opacity-30"
                                        style="color: var(--theme-accent-text-on-bg, #fff);"
                                        title="重试这条指令"
                                    >
                                        <Icon icon="mdi:refresh" class="size-3" />
                                    </button>
                                {/if}
                            </div>
                        </div>
                    {:else}
                        {@const hasReasoning = !!m.reasoning}
                        {@const hasTools = !!(m.tools && m.tools.length > 0)}
                        {@const activeTab = m.tab ?? 'chat'}
                        <div class="flex justify-start">
                            <div
                                class="ai-md max-w-[92%] wrap-break-word rounded-2xl rounded-bl-sm px-3 py-2 text-xs leading-relaxed"
                                style="background: var(--theme-input-bg);"
                            >
                                {#if hasReasoning || hasTools}
                                    <div
                                        class="mb-1.5 flex items-center gap-0.5 border-b pb-1"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        <button
                                            onclick={() => setTab(m, 'chat')}
                                            class="rounded px-1.5 py-0.5 text-[10px] transition-colors {activeTab ===
                                            'chat'
                                                ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'}"
                                        >
                                            聊天
                                        </button>
                                        {#if hasReasoning}
                                            <button
                                                onclick={() => setTab(m, 'reasoning')}
                                                class="rounded px-1.5 py-0.5 text-[10px] transition-colors {activeTab ===
                                                'reasoning'
                                                    ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                    : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'}"
                                            >
                                                思考{busy && !m.text ? '（生成中…）' : ''}
                                            </button>
                                        {/if}
                                        {#if hasTools}
                                            <button
                                                onclick={() => setTab(m, 'tools')}
                                                class="rounded px-1.5 py-0.5 text-[10px] transition-colors {activeTab ===
                                                'tools'
                                                    ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                    : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'}"
                                            >
                                                工具（{m.tools!.length}）
                                            </button>
                                        {/if}
                                    </div>
                                {/if}
                                {#if activeTab === 'chat'}
                                    {#if m.text}
                                        {@html renderMd(m.text)}
                                    {:else if busy}
                                        <span class="text-(--theme-modal-text)/40">思考中…</span>
                                    {/if}
                                {:else if activeTab === 'reasoning'}
                                    {#if m.reasoning}
                                        <div
                                            class="whitespace-pre-wrap text-[10px] leading-relaxed text-(--theme-modal-text)/50"
                                        >
                                            {m.reasoning}
                                        </div>
                                    {:else}
                                        <span class="text-(--theme-modal-text)/40">思考中…</span>
                                    {/if}
                                {:else}
                                    <div class="flex flex-col gap-1">
                                        {#each m.tools ?? [] as t}
                                            <div
                                                class="flex items-center gap-1.5 text-[10px] text-(--theme-modal-text)/50"
                                            >
                                                <Icon icon="mdi:wrench-outline" class="size-3 shrink-0" />
                                                <span class="font-medium">{t.name}</span>
                                                {#if t.resultLen !== undefined}
                                                    <span class="text-(--theme-modal-text)/30"
                                                        >→ {t.resultLen} 字符</span
                                                    >
                                                {:else if typeof t.args.status === 'string' && t.args.status}
                                                    <span class="truncate text-(--theme-modal-text)/40"
                                                        >{t.args.status}</span
                                                    >
                                                {:else}
                                                    <span class="text-(--theme-accent-text)">执行中…</span>
                                                {/if}
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        </div>
                    {/if}
                {/each}

                {#if confirmCard}
                    <div
                        class="rounded-2xl border border-red-500/40 px-3 py-2.5"
                        style="background: color-mix(in srgb, var(--theme-input-bg) 80%, transparent);"
                    >
                        <div class="flex items-center gap-2 text-xs font-semibold">
                            <Icon icon="mdi:alert-outline" class="size-4 text-red-500" />
                            确认执行操作
                        </div>
                        <div class="mt-1.5 rounded-lg px-2.5 py-2 text-xs" style="background: var(--theme-input-bg);">
                            <div class="font-medium text-(--theme-accent-text)">{confirmCard.toolName}</div>
                            <div class="mt-0.5 wrap-break-word text-(--theme-modal-text)/60">{confirmCard.summary}</div>
                        </div>
                        <div class="mt-2.5 flex justify-end gap-2">
                            <button
                                onclick={() => {
                                    confirmCard?.resolve(false)
                                    confirmCard = null
                                }}
                                class="rounded-lg px-3 py-1.5 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                            >
                                拒绝
                            </button>
                            <button
                                onclick={() => {
                                    confirmCard?.resolve(true)
                                    confirmCard = null
                                }}
                                class="rounded-lg px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:brightness-110"
                                style="background: #ef4444;"
                            >
                                允许执行
                            </button>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- 输入区 -->
            <div class="shrink-0 border-t p-2.5" style="border-color: var(--theme-divider-border);">
                <div class="flex items-end gap-2">
                    <textarea
                        bind:value={input}
                        placeholder="输入指令…（Enter 发送，Shift+Enter 换行）"
                        rows="2"
                        onkeydown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                send()
                            }
                        }}
                        class="min-h-0 flex-1 resize-none rounded-lg border px-2.5 py-2 text-xs leading-relaxed outline-none transition-colors"
                        style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                    ></textarea>
                    <div class="flex shrink-0 flex-col items-center gap-1">
                        <button
                            onclick={() => (busy ? stopGenerating() : send())}
                            disabled={!busy && !input.trim()}
                            class="flex size-9 items-center justify-center rounded-lg transition-all hover:brightness-115 disabled:opacity-40"
                            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                            title={busy ? '停止生成' : '发送'}
                        >
                            <Icon icon={busy ? 'mdi:stop' : 'mdi:send'} class="size-4" />
                        </button>
                    </div>
                </div>
            </div>
        {/if}
    </div>
{/if}

<style>
    .ai-md > :first-child {
        margin-top: 0;
    }
    .ai-md > :last-child {
        margin-bottom: 0;
    }
    /* {@html} 注入的 Markdown 内容对 Svelte 作用域不可见，必须用 :global 才能匹配并保留 */
    :global(.ai-md) {
        user-select: text;
        -webkit-user-select: text;
    }
    :global(.ai-md p) {
        margin: 0.25em 0;
    }
    :global(.ai-md h1),
    :global(.ai-md h2),
    :global(.ai-md h3),
    :global(.ai-md h4) {
        margin: 0.5em 0 0.25em;
        font-weight: 600;
        line-height: 1.3;
    }
    :global(.ai-md h1) {
        font-size: 1.1em;
    }
    :global(.ai-md h2) {
        font-size: 1.05em;
    }
    :global(.ai-md h3),
    :global(.ai-md h4) {
        font-size: 1em;
    }
    :global(.ai-md ul),
    :global(.ai-md ol) {
        margin: 0.25em 0;
        padding-left: 1.2em;
        list-style: disc;
    }
    :global(.ai-md ol) {
        list-style: decimal;
    }
    :global(.ai-md li) {
        margin: 0.15em 0;
    }
    :global(.ai-md code) {
        padding: 0.1em 0.35em;
        border-radius: 4px;
        font-size: 0.92em;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        background: color-mix(in srgb, var(--theme-accent-bg) 14%, transparent);
    }
    :global(.ai-md pre) {
        margin: 0.35em 0;
        padding: 0.5em 0.6em;
        border-radius: 6px;
        overflow-x: auto;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        background: color-mix(in srgb, var(--theme-modal-bg) 80%, #000);
    }
    :global(.ai-md pre code) {
        padding: 0;
        background: none;
    }
    :global(.ai-md strong) {
        font-weight: 600;
    }
    :global(.ai-md a) {
        color: var(--theme-accent-text);
        text-decoration: underline;
    }
    :global(.ai-md blockquote) {
        margin: 0.35em 0;
        padding-left: 0.6em;
        border-left: 2px solid var(--theme-divider-border);
        color: color-mix(in srgb, var(--theme-modal-text) 70%, transparent);
    }
    :global(.ai-md table) {
        margin: 0.35em 0;
        border-collapse: collapse;
        width: 100%;
        display: block;
        overflow-x: auto;
    }
    :global(.ai-md th),
    :global(.ai-md td) {
        padding: 0.2em 0.5em;
        border: 1px solid var(--theme-divider-border);
    }
    :global(.ai-md th) {
        font-weight: 600;
    }
    :global(.ai-md hr) {
        margin: 0.5em 0;
        border: 0;
        border-top: 1px solid var(--theme-divider-border);
    }
</style>
