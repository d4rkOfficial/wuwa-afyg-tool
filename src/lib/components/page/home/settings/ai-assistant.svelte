<script lang="ts">
    import { onMount } from 'svelte'
    import Icon from '@iconify/svelte'
    import { fade } from 'svelte/transition'
    import { runAiTurn, type SessionEvent } from '$lib/ai/session'
    import { getAiConfig, loadAiConfig } from '$lib/ai/config.svelte'
    import { loadGenPrefs, getGenPrefs, getDangerMode } from '$lib/data/ai-prefs.svelte'
    import { getActiveProject, updateCalculation } from '$lib/data/project.svelte'
    import { notifyCalcUpdate, getCalcState } from '$lib/calc/calculation.store.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import { getGpuAccel } from '$lib/data/render-prefs.svelte'
    import { cancelActiveDrags } from '$lib/utils/drag-guard'
    import { marked } from 'marked'
    import { getOpenPanelsSummary } from '$lib/ai/panels.svelte'
    import { AiClientError, type ChatMessage } from '$lib/ai/client'
    import type { AskUserRequest, AskUserResult } from '$lib/ai/tools/ask-user.types'
    import type { WebFetchRequest, WebFetchResult } from '$lib/ai/tools/web-fetch.types'
    import {
        describeTurnPhase,
        getLastTurnSummary,
        getTurnRuntime,
        resetAiSessionState
    } from '$lib/ai/turn-state.svelte'
    import { formatDuration, summarizeTurn } from '$lib/ai/token-usage'
    import { MOTION_MS, motionDuration, slideParams } from '$lib/utils/motion'
    import AiContextPanel from './ai-context-panel.svelte'
    import AskUserCard from './ask-user-card.svelte'
    import { cancelResult, settleOnce } from './ask-user-card.utils'
    import TabPanel from '$lib/components/ui/tab-panel.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import type { ComponentsProps } from '$lib/types'

    interface ToolCard {
        name: string
        args: Record<string, unknown>
        resultLen?: number
    }

    /**
     * 当前待作答的提问卡（`ask_user` 工具）。与「危险操作确认卡」同一处渲染：都不遮罩弹窗。
     * `resolve` 是**每张卡独立**的幂等收尾函数 —— 卡片卸载时会回调它，
     * 若共用同一个函数，旧卡卸载时会把新卡误判成「放弃」（见 T24 报告）。
     *
     * 注：持有它的 `askCard` 必须是 `$state.raw`（**不能用 `$state`**）。
     * `resolve` 要按身份判断「自己还是不是当前那张卡」（`askCard === card`），
     * 而 `$state` 会把赋进来的对象**深度代理**成 Proxy，读回来的引用与原始对象恒不相等 ——
     * 于是收尾时清不掉 `askCard`：用户提交后卡片与「提问期间隐藏的输入区」一起卡死在界面上。
     */
    interface AskCardState {
        request: AskUserRequest
        resolve: (result: AskUserResult) => void
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
    // 「向用户提问」卡片（同样显示在聊天框中；一次只可能有一张 —— ask_user 会阻塞整个回合）
    // `$state.raw`：本状态只整体替换、从不改内部字段，且 `resolve` 要按对象身份判定当前卡（见 AskCardState 注释）
    let askCard = $state.raw<AskCardState | null>(null)
    // 批量信任：一次指令回合内已批准过危险操作 → 后续危险操作直接放行（dangerMode=ask_once）
    let turnDangerApproved = $state(false)
    let abortCtrl = $state<AbortController | null>(null)

    // 拖动位置（左上角坐标；null = 默认右下角）
    let dragPos = $state<{ x: number; y: number } | null>(null)
    let dragging = $state(false)
    let dragStart = $state({ mx: 0, my: 0, x: 0, y: 0 })

    // 上下文 / 用量 / 运行情况面板（默认收起，入口在头部按钮）
    let contextOpen = $state(false)
    const runtime = $derived(getTurnRuntime())
    const turnSummary = $derived(getLastTurnSummary())
    // 状态条：运行中显示实时阶段与耗时；空闲时保留最后一次回合汇总
    const statusText = $derived.by(() => {
        if (runtime.running) return `${describeTurnPhase(runtime)} · ${formatDuration(runtime.elapsedMs)}`
        return turnSummary ? summarizeTurn(turnSummary) : ''
    })

    // ── 技能管理已迁到「设置 → AI助手 → 权限 / 提示词 → 技能」；工程变化队列纯后台静默，界面都不显示 ──

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

    // 展开/收起过渡标记：切换瞬间给位置属性加形变时长（见 FORM_MORPH_MS），实现「向四周展开 / 向中心收起」
    let collapsing = $state(false)
    let collapsingTimer: ReturnType<typeof setTimeout> | null = null

    /*
     * 悬浮窗形变的**刻意**时长（380ms），不用 --motion-* 阶梯：
     *  - 语义：它是「窗口级缩放」（整个悬浮窗在按钮 / 小卡片 / 全尺寸三形态间形变），
     *    而 `layout.css` 给 `--motion-slow`(260ms) 的用途注释是「页面 / 弹窗级过渡」，不是窗口形变。
     *  - 观感：380 → 260 是 **−120ms（快 32%）** 的可见加速；本组件还刻意配了 Mac 式
     *    cubic-bezier(.32,.72,.24,1)（快出慢收）与之一致，换 token 会拆散这组配对。
     *  - 收敛：原先同一组时长在模板里手抄 8 遍、复位定时器又写死 420ms（与动画不同步）；
     *    现在模板与定时器共用这一个常量，杜绝两处数值漂移。reduce 下由 FORM_MORPH 压到 1ms。
     */
    const FORM_MORPH_MS = 380
    /*
     * 形变时长字符串：数值唯一来源 = `FORM_MORPH_MS`；reduce 下压到 1ms（走 `motionDuration`）。
     * 为什么 reduce 兜底写在 JS 而不是 Tailwind 的 `motion-reduce:transition-none`：
     * 实测该变体产出的是 `@layer utilities { @media (prefers-reduced-motion: reduce) { transition-property: none } }`，
     * 而本组件的 `transition` 是**内联 style**（无层级声明，压过任何 @layer），故那条变体在此处
     * 是无效标记 —— 与其留一个「看着有兜底其实没有」的类名，不如在时长源头归零。
     */
    const FORM_MORPH = $derived(`${motionDuration(FORM_MORPH_MS)}ms cubic-bezier(.32,.72,.24,1)`)
    /*
     * 悬停/拖拽时的跟随过渡：必须有 reduce 兜底——它写在**内联 style** 里，
     * `layout.css` 的 `prefers-reduced-motion` 块完全管不到（只管 CSS 动画与 `<button>`），
     * 故这里按仓库既有做法（`motion.ts` 的 `motionDuration`）把时长压到 1ms。
     */
    const FORM_FOLLOW_TRANSITION = $derived(
        `transform ${motionDuration(150)}ms ease,box-shadow ${motionDuration(150)}ms ease`
    )

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
        }, FORM_MORPH_MS)
    }

    /** @desc 头部「关闭悬浮窗」按钮：与「双击标题栏」走同一个 `toggle(e)`（收起分支会把圆钮中心对齐点击位置） */
    function toggleClick(e: MouseEvent) {
        toggle(e)
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

    /**
     * 抓取网页（`web_fetch` 工具的宿主能力，**AI 独享**：WS 远程接管不注入它）。
     * 必须经同源代理 `/api/ai/fetch` 由**服务端**出网：浏览器直连任意站点会被 CORS 拦下，
     * 代理侧顺带做 SSRF 校验与 HTML→正文提取（见该路由与 `web-fetch.utils.ts`）。
     */
    async function fetchWebPage(request: WebFetchRequest): Promise<WebFetchResult> {
        const res = await fetch('/api/ai/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        })
        const payload = (await res.json().catch(() => null)) as {
            ok?: boolean
            error?: string
            result?: WebFetchResult
        } | null
        if (!res.ok || !payload?.ok || !payload.result) {
            throw new Error(payload?.error ?? `抓取网页失败（HTTP ${res.status}）`)
        }
        return payload.result
    }

    /**
     * 中止当前提问卡：按「用户放弃」收尾并清掉卡片状态。
     * 顺序是「先 resolve（卡内幂等 → 清状态 → 卡片卸载 → 卸载回调再收尾一次，被幂等挡住）」，
     * 因此无论从哪条路径进来，`askCard` 的 Promise 都只会 resolve 一次、且不会残留状态。
     */
    function cancelAskCard() {
        askCard?.resolve(cancelResult())
    }

    /** @desc 清空对话（入口已从头部右上角移到上下文面板底部的「清空对话历史」按钮） */
    function clearConversation() {
        abortCtrl?.abort()
        // 对话清掉后提问卡不该还能作答（它的 Promise 也要收尾，否则 ask_user 会永久悬挂）
        cancelAskCard()
        messages = []
        display = []
        // 会话级用量累计 / 分段快照 / 回合汇总一并清掉（分段临时禁用选择保留）
        resetAiSessionState()
    }

    function stopGenerating() {
        abortCtrl?.abort()
        // 提问卡正等着用户作答时，光 abort 是**解不开**的：工具挂在我们的 Promise 上，
        // 只有把它按「放弃」收尾，回合才会往下走（下一轮的 stream 会因已 abort 立即抛 aborted）。
        cancelAskCard()
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
                // 交互式提问（ask_user）：在消息列表末尾挂一张卡片，用户逐题作答 / 忽略 / 提交后收尾
                onAskUser: (request) =>
                    new Promise<AskUserResult>((resolve) => {
                        // 同一回合不可能并发两张卡（ask_user 会阻塞回合）；防御性收尾旧的再挂新的
                        cancelAskCard()
                        const card: AskCardState = {
                            request,
                            // 幂等收尾：① 仍是当前卡时清掉状态（卡片随即卸载）② resolve 一次
                            resolve: settleOnce<AskUserResult>((result) => {
                                if (askCard === card) askCard = null
                                resolve(result)
                            })
                        }
                        askCard = card
                        scrollToBottom()
                    }),
                // 抓取网页（web_fetch）：宿主经同源代理出网，AI 独享（WS 不注入该能力）
                onWebFetch: fetchWebPage,
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
            const isAborted = e instanceof AiClientError && e.debug === 'aborted'
            if (!isAborted) {
                last().text =
                    (last().text ? last().text + '\n' : '') + `⚠ ${e instanceof Error ? e.message : 'AI 请求失败'}`
            }
        }
        // 回合结束（正常 / 中止 / 报错）：提问卡一律收尾 —— 否则 `ask_user` 的 Promise 会永久悬挂
        // （提交过的卡在收尾时已把 askCard 置空，这里是无副作用的空操作）
        cancelAskCard()
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

    // 卡片尺寸：固定横屏形态（宽度 = 半个视口宽，高度随窗口占满）
    let winW = $state(typeof window !== 'undefined' ? window.innerWidth : 1200)
    let winH = $state(typeof window !== 'undefined' ? window.innerHeight : 800)
    /*
     * 展开态宽度 = **半个窗口宽**（用户点名：展开后占半屏）。
     * 这里刻意不设下限，也刻意不用 `50vw`：
     *  - 不设下限：下限（如 480）在窄屏上会**大于**半屏，直接违背「半屏」这个诉求；
     *  - 不用 `50vw`：`curW` 还要参与拖拽/收起的坐标钳制（`clampToViewport`、`moveDrag`）与
     *    「以按钮中心向四周展开」的中心计算，那些全是 JS 数值。宽度统一由 JS 算（`window.innerWidth / 2`），
     *    动画中途与 JS 读到的 `curW` 才是同一个数，不会出现「过渡到 A、钳制按 B」的错位。
     */
    const cardW = $derived(Math.round(winW / 2))
    const cardH = $derived(winH - 24)
    // 默认展开的小卡片尺寸
    const smallW = 380
    const smallH = 460
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

    // 挂载时从本地库恢复持久化的 AI 配置（悬浮窗直接使用场景也生效）
    onMount(() => {
        loadAiConfig()
        loadGenPrefs()
    })
</script>

<!-- 单容器：收起=48px 圆钮（图标居中），展开=卡片；尺寸/圆角/背景过渡动画
     减弱动态效果（reduce）兜底全部写在时长源头（均 → 1ms）：形变 = FORM_MORPH（`motionDuration`，
     保留 FORM_MORPH_MS = 380 的刻意窗口级慢速形变）、跟随过渡 = FORM_FOLLOW_TRANSITION、
     图标淡入 = `slideParams`。根节点**刻意不放** `motion-reduce:transition-none`：那条 Tailwind 变体
     只产出 `@layer utilities` 里的 `transition-property: none`，压不过本元素内联 style 的 transition 简写，
     留着只是无效标记。 -->
{#if aiEnabled}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="ai-assistant theme-glass-surface fixed z-(--z-sticky) flex flex-col overflow-hidden border shadow-2xl {dragPos
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
            : '0'};transition:width {FORM_MORPH},height {FORM_MORPH},border-radius {FORM_MORPH},background-color {FORM_MORPH}{btnDrag ||
        dragging
            ? ''
            : `,${FORM_FOLLOW_TRANSITION}`}{collapsing
            ? `,transform ${FORM_MORPH},left ${FORM_MORPH},top ${FORM_MORPH}`
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
                <div
                    transition:fade={slideParams(MOTION_MS.fast)}
                    class="flex h-full w-full items-center justify-center"
                >
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
                <Icon icon="mdi:robot-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
                <div class="min-w-0 flex-1 leading-tight">
                    <div class="truncate text-sm font-black tracking-tight" title={aiConfig.baseUrl}>
                        {aiConfig.model}
                    </div>
                    <div class="truncate text-[10px] text-(--theme-modal-text)/40" title={aiConfig.baseUrl}>
                        {aiConfig.label}
                    </div>
                </div>
                <button
                    onclick={() => (contextOpen = !contextOpen)}
                    class="rounded-none p-1 transition-colors {contextOpen
                        ? 'text-(--theme-accent-text)'
                        : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)'}"
                    title="上下文 / 用量 / 运行情况"
                >
                    <Icon icon="mdi:layers-triple-outline" class="size-4" />
                </button>
                <!-- 头部两个 `ui/Button` 要与左边那个原生 `<button>` 同源（三者都只靠 class 里的
                     `text-(--theme-modal-text)/40` 定前景色）。这里有一个实测坑：
                     **不要传 `textColor="currentColor"`** —— 它落成内联 `color: currentColor`，语义是
                     「继承父元素颜色」（即全不透明的 `--theme-modal-text`），内联样式会压掉 class 里的 `/40`。
                     底色同理不必显式给：`bare` 档既不发射 `--theme-btn-text` 前景色兜底，也不发射
                     `--theme-btn-bg` 底色兜底（后者是**与主题昼夜相反**的按钮渐变，实测症状就是这两个按钮
                     变成夜主题浅色 / 昼主题深色的实心块）—— 见 `ui/button` 的 bare 契约与 button-contract 测试。 -->
                <Button
                    variant="text"
                    bare
                    pad="p-1"
                    onclick={toggleScale}
                    class="text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)"
                    title={size === 'small' ? '放大到全尺寸' : '缩小'}
                >
                    <Icon icon={size === 'small' ? 'mdi:arrow-expand' : 'mdi:arrow-collapse'} class="size-4" />
                </Button>
                <!-- @desc 关闭悬浮窗：与「双击标题栏」同一个动作（`toggle(e)` 的收起分支把圆钮中心对齐点击位置，钳制到视口）。
                     注：不放 aria-label / type=button，与本行其它头部按钮一致（都只靠 title）。 -->
                <Button
                    variant="text"
                    bare
                    pad="p-1"
                    onclick={toggleClick}
                    class="text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)"
                    title="收起悬浮窗（等同于双击标题栏）"
                >
                    <Icon icon="mdi:close" class="size-4" />
                </Button>
            </div>

            <!-- 实时状态条：运行中走时钟，结束后保留最后一次回合汇总 -->
            {#if statusText}
                <div
                    class="flex shrink-0 items-center gap-1.5 border-b px-3 py-1 text-[10px] tabular-nums"
                    style="border-color: var(--theme-divider-border);"
                >
                    <span
                        class="inline-block size-1.5 shrink-0 rounded-full"
                        style="background: var(--theme-accent-bg); opacity: {runtime.running ? 1 : 0.3};"
                    ></span>
                    <span class="min-w-0 flex-1 truncate text-(--theme-modal-text)/50" title={statusText}>
                        {statusText}
                    </span>
                </div>
            {/if}

            <!-- 上下文 / 用量 / 运行情况面板（默认收起；入口为头部 layers 按钮） -->
            <AiContextPanel
                open={contextOpen}
                onclose={() => (contextOpen = false)}
                onClearHistory={clearConversation}
            />

            <!-- 消息区 -->
            <div bind:this={bodyEl} class="theme-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {#if display.length === 0}
                    <div class="py-10 text-center text-xs text-(--theme-modal-text)/35">
                        用文字指挥我：创建工程、锁定环节、查队伍、
                        <br />后续还可排轴、拉表、配置 Buff 集
                    </div>
                {/if}
                {#each display as m, i (m)}
                    {#if m.role === 'user'}
                        {@const isLastUser = i === lastUserDisplayIdx}
                        <div class="flex justify-end">
                            <div
                                class="max-w-[85%] whitespace-pre-wrap wrap-break-word rounded-none px-3 py-2 text-xs leading-relaxed"
                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                            >
                                {m.text}
                                {#if isLastUser}
                                    <button
                                        onclick={() => send(m.text)}
                                        disabled={busy}
                                        class="ml-1 inline-flex items-center rounded-none px-0.5 py-0.5 align-middle opacity-50 transition-opacity hover:opacity-100 disabled:opacity-30"
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
                                class="ai-md max-w-[92%] wrap-break-word rounded-none px-3 py-2 text-xs leading-relaxed"
                                style="background: var(--theme-input-bg);"
                            >
                                {#if hasReasoning || hasTools}
                                    <div
                                        class="mb-1.5 flex items-center gap-0.5 border-b pb-1"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        <button
                                            onclick={() => setTab(m, 'chat')}
                                            class="rounded-none px-1.5 py-0.5 text-[10px] transition-colors {activeTab ===
                                            'chat'
                                                ? 'font-black bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'}"
                                        >
                                            聊天
                                        </button>
                                        {#if hasReasoning}
                                            <button
                                                onclick={() => setTab(m, 'reasoning')}
                                                class="rounded-none px-1.5 py-0.5 text-[10px] transition-colors {activeTab ===
                                                'reasoning'
                                                    ? 'font-black bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                    : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'}"
                                            >
                                                思考{busy && !m.text ? '（生成中…）' : ''}
                                            </button>
                                        {/if}
                                        {#if hasTools}
                                            <button
                                                onclick={() => setTab(m, 'tools')}
                                                class="rounded-none px-1.5 py-0.5 text-[10px] transition-colors {activeTab ===
                                                'tools'
                                                    ? 'font-black bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                    : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'}"
                                            >
                                                工具（{m.tools!.length}）
                                            </button>
                                        {/if}
                                    </div>
                                {/if}
                                <TabPanel active={activeTab}>
                                    {#if activeTab === 'chat'}
                                        {#if m.text}
                                            {@html renderMd(m.text)}
                                        {:else if busy}
                                            <span class="text-(--theme-modal-text)/40">思考中…</span>
                                        {/if}
                                    {:else if activeTab === 'reasoning'}
                                        {#if m.reasoning}
                                            <div
                                                class="whitespace-pre-wrap text-[10px] leading-relaxed text-(--theme-modal-text)/40"
                                            >
                                                {m.reasoning}
                                            </div>
                                        {:else}
                                            <span class="text-(--theme-modal-text)/40">思考中…</span>
                                        {/if}
                                    {:else}
                                        <div class="flex flex-col gap-1">
                                            {#each m.tools ?? [] as t (t.name)}
                                                <div
                                                    class="flex items-center gap-1.5 text-[10px] text-(--theme-modal-text)/40"
                                                >
                                                    <Icon icon="mdi:wrench-outline" class="size-3 shrink-0" />
                                                    <span class="font-black">{t.name}</span>
                                                    {#if t.resultLen !== undefined}
                                                        <span class="text-(--theme-modal-text)/35"
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
                                </TabPanel>
                            </div>
                        </div>
                    {/if}
                {/each}

                {#if confirmCard}
                    <div
                        class="rounded-none border border-red-500/40 px-3 py-2.5"
                        style="background: color-mix(in srgb, var(--theme-input-bg) 80%, transparent);"
                    >
                        <div class="flex items-center gap-2 text-xs font-black tracking-tight">
                            <Icon icon="mdi:alert-outline" class="size-4 shrink-0 text-red-500" />
                            确认执行操作
                        </div>
                        <div class="mt-1.5 rounded-none px-2.5 py-2 text-xs" style="background: var(--theme-input-bg);">
                            <div class="font-black text-(--theme-accent-text)">{confirmCard.toolName}</div>
                            <div class="mt-0.5 wrap-break-word text-(--theme-modal-text)/70">{confirmCard.summary}</div>
                        </div>
                        <div class="mt-2.5 flex justify-end gap-2">
                            <button
                                onclick={() => {
                                    confirmCard?.resolve(false)
                                    confirmCard = null
                                }}
                                class="rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                style="border-color: var(--theme-divider-border);"
                            >
                                拒绝
                            </button>
                            <button
                                onclick={() => {
                                    confirmCard?.resolve(true)
                                    confirmCard = null
                                }}
                                class="rounded-none bg-red-500 px-2.5 py-1 text-[10px] font-medium text-white transition-all hover:brightness-110"
                            >
                                允许执行
                            </button>
                        </div>
                    </div>
                {/if}

                <!-- 「向用户提问」卡片（ask_user）：与确认卡同处渲染；`{#key}` 保证换一组问题一定重挂新实例，
                     组件卸载时按「放弃」收尾，不会把上一组问题与作答残留到下一轮 -->
                {#if askCard}
                    {#key askCard}
                        <AskUserCard request={askCard.request} onresolve={askCard.resolve} />
                    {/key}
                {/if}
            </div>

            <!-- 输入区：`ask_user` 提问卡激活时**整块隐藏** —— 此刻回合正阻塞在工具里等作答，
                 发送任何文本都不会被处理（只会让用户以为说上了话），且 Enter 已接管为「下一题 / 提交」。
                 作答与提交全在卡片内完成；卡片消失（提交或放弃）后输入区自动回来。 -->
            {#if !askCard}
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
                            class="min-h-0 flex-1 resize-none rounded-none border px-2.5 py-2 text-xs leading-relaxed outline-none transition-colors"
                            style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                        ></textarea>
                        <div class="flex shrink-0 flex-col items-center gap-1">
                            <button
                                onclick={() => (busy ? stopGenerating() : send())}
                                disabled={!busy && !input.trim()}
                                class="flex size-9 items-center justify-center rounded-none transition-all hover:brightness-115 disabled:opacity-40"
                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                title={busy ? '停止生成' : '发送'}
                            >
                                <Icon icon={busy ? 'mdi:stop' : 'mdi:send'} class="size-4" />
                            </button>
                        </div>
                    </div>
                </div>
            {/if}
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
        font-weight: 900;
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
        border-radius: 0;
        font-size: 0.92em;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        background: color-mix(in srgb, var(--theme-accent-bg) 14%, transparent);
    }
    :global(.ai-md pre) {
        margin: 0.35em 0;
        padding: 0.5em 0.6em;
        border-radius: 0;
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
