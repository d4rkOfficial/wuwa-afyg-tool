<script lang="ts">
    import { onMount } from 'svelte'
    import Icon from '@iconify/svelte'
    import { fade } from 'svelte/transition'
    import { runAiTurn, type SessionEvent } from '../session'
    import { getAiConfig, loadAiConfig } from '../config.svelte'
    import { loadGenPrefs, getGenPrefs } from '$lib/data/ai-prefs.svelte'
    import { getActiveProject, updateCalculation } from '$lib/data/project.svelte'
    import { notifyCalcUpdate, getCalcState } from '$lib/components/page/home/calculation/calculation.store.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import { getGpuAccel } from '$lib/data/render-prefs.svelte'
    import { cancelActiveDrags } from '$lib/utils/drag-guard'
    import { marked } from 'marked'
    import { getOpenPanelsSummary } from '../panels.svelte'
    import { DeepSeekError, type ChatMessage } from '../client'

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

    interface Props {
        // 宿主视图状态（+page 传入，用户切换时 AI 可感知）
        viewPhase?: string
        viewShowResult?: boolean
        // AI 请求切换视图（+page 提供 setter）
        onRequestView?: (phase: string) => void
    }

    let { viewPhase = 'team', viewShowResult = false, onRequestView }: Props = $props()

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
        if (dragPos && typeof localStorage !== 'undefined') {
            localStorage.setItem('ai-assistant-pos', JSON.stringify(dragPos))
        }
    }

    // 收起态圆钮拖动（共用 dragPos；拖动后不触发展开）
    let btnDrag = $state(false)
    let btnMoved = $state(false)
    let btnStart = $state({ mx: 0, my: 0, x: 0, y: 0 })

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
        if (btnMoved && dragPos && typeof localStorage !== 'undefined') {
            localStorage.setItem('ai-assistant-pos', JSON.stringify(dragPos))
        }
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
    const modelLabel = $derived(`${aiConfig.label} · ${aiConfig.model}`)
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

    function toggle() {
        size = size === 'collapsed' ? 'small' : 'collapsed'
        // 展开瞬间按卡片尺寸重新钳制，保证面板不伸出屏幕
        if (size !== 'collapsed' && dragPos) {
            const w = size === 'small' ? smallW : cardW
            const h = size === 'small' ? smallH : cardH
            const clamped = clampToViewport(dragPos, w, h)
            if (clamped && (clamped.x !== dragPos.x || clamped.y !== dragPos.y)) dragPos = clamped
            else if (!clamped) dragPos = null
        }
        if (typeof localStorage !== 'undefined') localStorage.setItem('ai-assistant-open', size)
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
        if (typeof localStorage !== 'undefined') localStorage.setItem('ai-assistant-open', size)
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
                        confirmCard = { toolName, summary, resolve }
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

    // AI 回复 Markdown 渲染（换行即 <br>）
    function renderMd(text: string): string {
        try {
            return marked.parse(text, { breaks: true }) as string
        } catch {
            return text
        }
    }

    // 响应式卡片尺寸：横屏（宽>高）高度占满屏幕；竖屏（高>宽）宽度占满屏幕
    let winW = $state(typeof window !== 'undefined' ? window.innerWidth : 1280)
    let winH = $state(typeof window !== 'undefined' ? window.innerHeight : 800)
    const isLandscape = $derived(winW > winH)
    const cardW = $derived(isLandscape ? 480 : Math.max(280, winW - 24))
    const cardH = $derived(isLandscape ? winH - 24 : Math.min(winH * 0.6, 560))
    // 默认展开的小卡片尺寸
    const smallW = $derived(isLandscape ? 380 : Math.max(280, winW - 24))
    const smallH = $derived(isLandscape ? 460 : Math.min(winH * 0.45, 420))
    const curW = $derived(size === 'collapsed' ? 48 : size === 'small' ? smallW : cardW)
    const curH = $derived(size === 'collapsed' ? 48 : size === 'small' ? smallH : cardH)
    let expandedH = $state(600)
    $effect(() => {
        const update = () => {
            winW = window.innerWidth
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

    // 展开卡片尺寸（非响应式场景，与 cardW/cardH 同逻辑）
    function expandedCardSize(): { w: number; h: number } {
        const w = typeof window !== 'undefined' ? window.innerWidth : 1280
        const h = typeof window !== 'undefined' ? window.innerHeight : 800
        const landscape = w > h
        return {
            w: landscape ? 480 : Math.max(280, w - 24),
            h: landscape ? h - 24 : Math.min(h * 0.6, 560)
        }
    }

    // 恢复记忆位置（按展开卡片尺寸钳制，保证收起/展开都不出屏；越界/脏数据回退默认右下角）
    if (typeof localStorage !== 'undefined') {
        try {
            const saved = localStorage.getItem('ai-assistant-pos')
            if (saved) {
                const parsed = JSON.parse(saved) as { x: number; y: number }
                if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
                    const cardSize = expandedCardSize()
                    dragPos = clampToViewport({ x: parsed.x, y: parsed.y }, cardSize.w, cardSize.h)
                }
            }
        } catch {
            /* ignore */
        }
    }

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
        class="theme-glass-surface fixed z-40 flex flex-col overflow-hidden border shadow-2xl {dragPos
            ? ''
            : 'bottom-4 right-4'}"
        style="{dragPos
            ? gpuAccel
                ? `left:0;top:0;transform: translate(${dragPos.x}px, ${dragPos.y}px);`
                : `left:${dragPos.x}px;top:${dragPos.y}px;`
            : ''}{gpuAccel && (dragging || btnDrag)
            ? ' will-change: transform;'
            : ''}width:{curW}px;height:{curH}px;border-radius:{size === 'collapsed'
            ? '9999px'
            : '0.75rem'};transition:width .38s cubic-bezier(.32,.72,.24,1),height .38s cubic-bezier(.32,.72,.24,1),border-radius .38s cubic-bezier(.32,.72,.24,1),background-color .38s cubic-bezier(.32,.72,.24,1);background:{size ===
        'collapsed'
            ? 'var(--theme-accent-bg)'
            : 'color-mix(in srgb, var(--theme-modal-bg) 78%, transparent)'};color:{size === 'collapsed'
            ? 'var(--theme-accent-text-on-bg, #fff)'
            : 'var(--theme-modal-text)'};border-color:var(--theme-divider-border);"
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
                onpointerdown={btnDown}
                onpointermove={btnMove}
                onpointerup={btnUp}
                onpointercancel={btnUp}
                onclick={btnClick}
                title="AI 助手（拖动可移动）"
            >
                <div transition:fade class="flex h-full w-full items-center justify-center">
                    <Icon icon="mdi:robot-outline" class="size-6" />
                </div>
            </div>
        {:else}
            <!-- 头部（可拖动） -->
            <div
                class="flex shrink-0 cursor-move touch-none select-none items-center gap-2 border-b px-3 py-2.5"
                style="border-color: var(--theme-divider-border);"
                onpointerdown={startDrag}
                onpointermove={moveDrag}
                onpointerup={stopDrag}
                onpointercancel={stopDrag}
            >
                <Icon icon="mdi:robot-outline" class="size-5 text-(--theme-accent-text)" />
                <span class="min-w-0 flex-1 truncate text-sm font-semibold">AI 助手</span>
                <span class="shrink-0 text-[10px] text-(--theme-modal-text)/40" title={aiConfig.baseUrl}
                    >{modelLabel}</span
                >
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
                <button
                    onclick={toggle}
                    class="rounded p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/80"
                    title="收起"
                >
                    <Icon icon="mdi:chevron-down" class="size-4" />
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
                                class="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm px-3 py-2 text-xs leading-relaxed"
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
                                class="ai-md max-w-[92%] break-words rounded-2xl rounded-bl-sm px-3 py-2 text-xs leading-relaxed"
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
                            <div class="mt-0.5 break-words text-(--theme-modal-text)/60">{confirmCard.summary}</div>
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
    .ai-md p {
        margin: 0.25em 0;
    }
    .ai-md h1,
    .ai-md h2,
    .ai-md h3,
    .ai-md h4 {
        margin: 0.5em 0 0.25em;
        font-weight: 600;
        line-height: 1.3;
    }
    .ai-md h1 {
        font-size: 1.1em;
    }
    .ai-md h2 {
        font-size: 1.05em;
    }
    .ai-md h3,
    .ai-md h4 {
        font-size: 1em;
    }
    .ai-md ul,
    .ai-md ol {
        margin: 0.25em 0;
        padding-left: 1.2em;
        list-style: disc;
    }
    .ai-md ol {
        list-style: decimal;
    }
    .ai-md li {
        margin: 0.15em 0;
    }
    .ai-md code {
        padding: 0.1em 0.35em;
        border-radius: 4px;
        font-size: 0.92em;
        background: color-mix(in srgb, var(--theme-accent-bg) 14%, transparent);
    }
    .ai-md pre {
        margin: 0.35em 0;
        padding: 0.5em 0.6em;
        border-radius: 6px;
        overflow-x: auto;
        background: color-mix(in srgb, var(--theme-modal-bg) 80%, #000);
    }
    .ai-md pre code {
        padding: 0;
        background: none;
    }
    .ai-md strong {
        font-weight: 600;
    }
    .ai-md a {
        color: var(--theme-accent-text);
        text-decoration: underline;
    }
    .ai-md blockquote {
        margin: 0.35em 0;
        padding-left: 0.6em;
        border-left: 2px solid var(--theme-divider-border);
        color: var(--theme-modal-text) / 70;
    }
    .ai-md table {
        margin: 0.35em 0;
        border-collapse: collapse;
        width: 100%;
    }
    .ai-md th,
    .ai-md td {
        padding: 0.2em 0.5em;
        border: 1px solid var(--theme-divider-border);
    }
    .ai-md th {
        font-weight: 600;
    }
    .ai-md hr {
        margin: 0.5em 0;
        border: 0;
        border-top: 1px solid var(--theme-divider-border);
    }
</style>
