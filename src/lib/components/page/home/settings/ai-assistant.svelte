<script lang="ts">
    import { onMount, tick } from 'svelte'
    import Icon from '@iconify/svelte'
    import { fade } from 'svelte/transition'
    import { runAiTurn, type SessionEvent } from '$lib/ai/session'
    import { loadAiConfig } from '$lib/ai/config.svelte'
    import { getEffectiveDangerMode, resolveAiConfig } from '$lib/ai/session-overrides.svelte'
    import { applyCompaction, planCompaction, summarizeMessages } from '$lib/ai/compaction'
    import { loadGenPrefs, isAiEnabled } from '$lib/data/ai-prefs.svelte'
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
        getLongTaskContinuations,
        getSessionUsage,
        getTurnRuntime,
        getWorkSummary,
        isLongTaskActive,
        recordCompaction,
        resetAiSessionState,
        resetLongTask
    } from '$lib/ai/turn-state.svelte'
    import { formatDuration, formatTokens, summarizeTurn } from '$lib/ai/token-usage'
    import { MOTION_MS, motionDuration, slideParams } from '$lib/utils/motion'
    import AiComposer from './ai-composer.svelte'
    import AiContextPanel from './ai-context-panel.svelte'
    import AskUserCard from './ask-user-card.svelte'
    import { cancelResult, normalizeGroup, settleOnce } from './ask-user-card.utils'
    import {
        appendActivityNotice,
        appendActivityText,
        appendRunJsOutput,
        applyToolEventToActivities,
        applyToolProgressToActivities,
        describeToolActivity,
        describeToolCard,
        type AssistantActivity
    } from './ai-tools.utils'
    import Button from '$lib/components/ui/button.svelte'
    import type { ComponentsProps } from '$lib/types'

    /**
     * @desc 工具时间线的并入逻辑（含 `ToolCard` 类型）抽在 `./ai-tools.utils`：
     *  它是纯函数、可单测，而「最后一张卡 + 名称相同」那套旧配对一旦漏一次就全体错位
     *  （实测：服务端 `web_search` 完成时不发结果事件，后面所有工具的结果都记错人）。
     */

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
        /**
         * @desc `compaction` 是**压缩标记**：不是对话气泡，而是在对话流里插一条分隔标记，
         *  说明「从这里往上的原始消息已移出模型上下文」。界面刻意保留旧气泡供回看（DSH 同样如此）。
         */
        role: 'user' | 'assistant' | 'compaction'
        text: string
        /** @desc 用户消息附带的图片（data URL），仅 user 角色有值 */
        images?: string[]
        /**
         * @desc AI 输出的**活动流**（按发生顺序）：思考 / 工具 / 回复 / 提示。
         * 这是新的列表式 UI 的数据源 —— 不再有聊天气泡与「聊天 / 思考 / 工具」tab。
         */
        activities?: AssistantActivity[]
        // 发言是否已结束（结束后保留活动流，不再自动收起）
        done?: boolean
        // 压缩标记的统计（仅 role === 'compaction' 时有值；`text` 即摘要正文）
        compaction?: { summarized: number; tokensBefore: number; tokensAfter: number }
        // 压缩标记是否展开显示摘要正文
        expanded?: boolean
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
    /** @desc 压缩请求进行中（与 `busy` 分开：压缩不占回合，但同样要防重入） */
    let compacting = $state(false)

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
    /** @desc 会话累计（对齐 DSH 状态行的「N 轮 N 步」）；一次都没跑过时不显示 */
    const sessionStatus = $derived.by(() => {
        const usage = getSessionUsage()
        if (usage.turns === 0 && usage.steps === 0) return ''
        return `${usage.turns} 轮 · ${usage.steps} 步`
    })
    /** @desc 长任务模式（AI 开启后输出停止会自动继续；用户按停止按钮即结束） */
    const longTaskActive = $derived(isLongTaskActive())
    const longTaskContinuations = $derived(getLongTaskContinuations())
    /**
     * @desc 是否存在待确认 / 待作答的卡片。
     * 用它（而不是把卡片状态搬进 composer）决定 composer 显示输入行还是显示卡片：
     * 卡片的 resolve 回调、幂等收尾、`{#key}` 重挂全归本组件，composer 只是容器。
     */
    const hasPendingCard = $derived(Boolean(confirmCard || askCard))

    /** @desc 悬浮窗大标题 = 当前工作摘要（AI 每轮经 `set_work_summary` 工具更新） */
    const workSummary = $derived(getWorkSummary())

    /**
     * @desc 待作答卡片**收起时**显示的那一行，也就是 AI 的问题。
     * 危险确认 → 「确认执行「工具名」」；提问卡 → 归一后的**第一题**正文。
     * composer 拿不到 snippet 内部内容（snippet 是不透明的），故在这里算好传进去。
     */
    const pendingLabel = $derived.by(() => {
        if (confirmCard) return `确认执行「${confirmCard.toolName}」`
        if (askCard) {
            const group = normalizeGroup(askCard.request)
            const first = group.questions[0]
            return first ? `第 ${first.no} 题：${first.question}` : group.title || '需要你的作答'
        }
        return ''
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

    // AI 助手是否启用（悬浮窗显隐）：取**实际**状态 = 持久化偏好 ∧ 非会话级强制关闭（Toy 宿主会话内隐藏）
    const aiEnabled = $derived(isAiEnabled())
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

    /**
     * @desc 中止待确认的危险操作：按「拒绝」收尾并清掉卡片。
     *
     * 与 `cancelAskCard` 同理 —— **危险确认也把工具执行挂在 Promise 上**：
     * 只 `abort()` 是解不开的（abort 只打断 HTTP 流，打不断工具处理器），
     * 于是整轮会永远停在「正在调用工具「X」」、计时一直涨，而且停止按钮按了没反应（实测故障）。
     */
    function cancelConfirmCard() {
        confirmCard?.resolve(false)
        confirmCard = null
    }

    /** @desc 清空对话（入口已从头部右上角移到上下文面板底部的「清空对话历史」按钮） */
    function clearConversation() {
        abortCtrl?.abort()
        // 对话清掉后提问卡不该还能作答（它的 Promise 也要收尾，否则 ask_user 会永久悬挂）
        cancelAskCard()
        cancelConfirmCard()
        messages = []
        display = []
        // 会话级用量累计 / 分段快照 / 回合汇总一并清掉（分段临时禁用选择保留）
        resetAiSessionState()
    }

    function stopGenerating() {
        abortCtrl?.abort()
        // 停止按钮同时是「结束长任务」入口：即使工具调用还挂在确认卡上，也先把状态摘掉，
        // 避免自动继续逻辑在 abort 传播前又多续一轮。
        resetLongTask()
        // 提问卡 / 危险确认卡都在等用户操作，而**工具执行挂在它们的 Promise 上**：
        // 光 abort 是解不开的，必须把两张卡都按「放弃」收尾，否则整轮会永远停在「正在调用工具」。
        cancelAskCard()
        cancelConfirmCard()
    }

    /**
     * @desc 压缩历史：把较旧的历史交给模型压成摘要，用「摘要 + 最近若干条原文」替换它。
     *
     * 两点刻意的取舍：
     * 1. **不删对话气泡** —— 界面保留完整对话，只有**模型上下文**被压（DSH 同样如此），
     *    并在对话流里插一条可展开的压缩标记；否则用户会以为消息丢了。
     * 2. **摘要失败就不动历史** —— 不做静默降级。本地裁剪（直接丢最旧若干轮）会无声丢信息，
     *    与本仓库「失败要响」的口径冲突，故只报错、不改上下文。
     */
    async function compactHistory() {
        if (compacting) return
        const plan = planCompaction(messages)
        if (!plan) {
            addToast('历史太短，或切点之后找不到用户消息这一安全边界，暂不压缩', 'info')
            return
        }
        compacting = true
        try {
            const outcome = await summarizeMessages(resolveAiConfig(), plan.older)
            if (!outcome.ok) {
                addToast(`压缩失败：${outcome.error}`, 'error')
                return
            }
            const applied = applyCompaction(messages, plan, outcome.summary)
            messages = applied.history
            display = [
                ...display,
                {
                    role: 'compaction',
                    text: outcome.summary,
                    done: true,
                    compaction: {
                        summarized: applied.summarizedCount,
                        tokensBefore: applied.tokensBefore,
                        tokensAfter: applied.tokensAfter
                    }
                }
            ]
            recordCompaction({
                summarizedCount: applied.summarizedCount,
                tokensBefore: applied.tokensBefore,
                tokensAfter: applied.tokensAfter
            })
            addToast(`已压缩 ${applied.summarizedCount} 条历史`, 'success')
            scrollToBottom()
        } finally {
            compacting = false
        }
    }

    /**
     * @desc 发送一条指令。
     * @param text 指令正文（可能为空串 —— 只发图片是合法消息）
     * @param retry 是否为「重试」—— 重试先把该条用户消息（含）之后的展示与历史一并回退，再重新发送
     * @param images 图片附件 data URL（重试时沿用原消息的附件，否则会静默丢图）
     */
    async function send(text: string, retry = false, images: string[] = []) {
        const trimmed = text.trim()
        if ((!trimmed && images.length === 0) || busy) return
        busy = true
        abortCtrl = new AbortController()
        turnDangerApproved = false
        // 重试：回退到该条用户消息（含）之后全部内容，重新发送
        if (retry) {
            let lastUserIdx = -1
            for (let i = display.length - 1; i >= 0; i--) {
                if (display[i].role === 'user' && display[i].text === trimmed) {
                    lastUserIdx = i
                    break
                }
            }
            if (lastUserIdx > 0) display = display.slice(0, lastUserIdx)
            const msgUsers = messages
                .map((m, i) => (m.role === 'user' && m.content === trimmed ? i : -1))
                .filter((i) => i >= 0)
            if (msgUsers.length > 0) messages = messages.slice(0, msgUsers[msgUsers.length - 1])
        }
        display = [
            ...display,
            { role: 'user', text: trimmed, ...(images.length > 0 ? { images } : {}) },
            { role: 'assistant', text: '', activities: [], done: false }
        ]
        // 发送新消息是明确的「我要看最新」意图：强制回到底部并恢复吸附
        stickToBottom = true
        scrollToBottom(true)
        const last = () => display[display.length - 1]

        try {
            await runAiTurn({
                history: messages,
                newUserMessage: trimmed,
                context: contextState,
                signal: abortCtrl.signal,
                onMessages: (msgs) => (messages = msgs),
                requestView: onRequestView,
                onCalcUpdate: () => {
                    notifyCalcUpdate()
                    updateCalculation(getCalcState())
                },
                onGenerateProgress: (status) => {
                    // 生成任务进度：合并到正在执行的 generate_* 工具行上（否则追加纯进度伪行）。
                    // 伪行没有 seq，因此不会抢走真实调用的结果配对。
                    last().activities = applyToolProgressToActivities(last().activities ?? [], status)
                    scrollToBottom()
                },
                onConfirm: (toolName, summary) =>
                    new Promise<boolean>((resolve) => {
                        // 生效策略来自会话覆盖层（弹窗工具条可临时切换），而不是直接读全局设置
                        const mode = getEffectiveDangerMode()
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
                        last().activities = appendActivityText(last().activities ?? [], 'text', evt.text ?? '')
                    } else if (evt.type === 'reasoning') {
                        last().activities = appendActivityText(last().activities ?? [], 'reasoning', evt.text ?? '')
                    } else if (evt.type === 'tool') {
                        // 按 seq 配对（不再用「最后一行 + 名称相同」）：一次漏配对只影响自己
                        last().activities = applyToolEventToActivities(last().activities ?? [], evt)
                        // run_js 的返回值 / 报错独立成顶层行，不塞进「代码」卡片的展开结果里
                        if (evt.toolName === 'run_js' && evt.resultText !== undefined) {
                            last().activities = appendRunJsOutput(last().activities ?? [], evt.resultText)
                        }
                        // AI 切换工程/视图后告知用户（只在真正出结果的那条事件上提示一次）
                        if (evt.resultLen !== undefined && evt.toolName === 'switch_view') {
                            addToast('AI 已切换视图', 'success')
                        } else if (evt.resultLen !== undefined && evt.toolName === 'set_active_project') {
                            addToast('AI 已切换工程', 'success')
                        }
                        scrollToBottom()
                    } else if (evt.type === 'longTask') {
                        last().activities = appendActivityNotice(
                            last().activities ?? [],
                            evt.message ?? '自动继续',
                            'info',
                            'longTask'
                        )
                    } else if (evt.type === 'error') {
                        last().activities = appendActivityNotice(
                            last().activities ?? [],
                            evt.message ?? 'AI 请求失败',
                            'error'
                        )
                    }
                    scrollToBottom()
                }
            })
        } catch (e) {
            const isAborted = e instanceof AiClientError && e.debug === 'aborted'
            if (!isAborted) {
                last().activities = appendActivityNotice(
                    last().activities ?? [],
                    e instanceof Error ? e.message : 'AI 请求失败',
                    'error'
                )
            }
        }
        // 回合结束（正常 / 中止 / 报错）：提问卡一律收尾 —— 否则 `ask_user` 的 Promise 会永久悬挂
        // （提交过的卡在收尾时已把 askCard 置空，这里是无副作用的空操作）
        cancelAskCard()
        // 发言结束：活动流保持原样（不再有 tab 切换与自动收起）
        const lastMsg = display[display.length - 1]
        if (lastMsg?.role === 'assistant') lastMsg.done = true
        busy = false
        abortCtrl = null
        scrollToBottom()
    }

    let bodyEl: HTMLDivElement | undefined = $state()
    /**
     * @desc 是否「吸附在底部」。
     *
     * 只有用户本来就在底部时才自动跟随新内容；一旦用户往上翻（读旧消息 / 展开某张工具卡），
     * 后续流式输出不再把他拽回去 —— 这正是「AI 输出时不再总是强制向下滚动」。
     * 用户手动滚回底部、或点「回到底部」按钮 / 发送新消息时恢复吸附。
     */
    let stickToBottom = $state(true)
    /** @desc 自动滚动的帧级节流：流式 delta 可能一秒几十次，合并到一次 `tick` 后的写入 */
    let scrollScheduled = false
    /** @desc 距底部多少像素以内仍算「在底部」（给触控板惯性 / 1px 取整留余量） */
    const NEAR_BOTTOM_PX = 48

    const isNearBottom = (): boolean => {
        if (!bodyEl) return true
        return bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight <= NEAR_BOTTOM_PX
    }

    // 用户滚动只更新吸附状态，不做任何强制滚动
    function onBodyScroll() {
        stickToBottom = isNearBottom()
    }

    /**
     * @desc 滚动到底部。
     * @param force `true` = 用户明确要求（发送新消息 / 点回到底部 / 切 tab），忽略吸附状态。
     */
    function scrollToBottom(force = false) {
        // force 先恢复吸附：这样即使已有一帧排队，排队的那次 tick 也会跟随到底部
        if (force) stickToBottom = true
        else if (!stickToBottom) return
        if (scrollScheduled) return
        scrollScheduled = true
        void tick().then(() => {
            scrollScheduled = false
            if (!bodyEl || !stickToBottom) return
            bodyEl.scrollTop = bodyEl.scrollHeight
        })
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
                <!-- 大标题 = 当前工作摘要（AI 每轮经 `set_work_summary` 更新）。
                     提供商 / 模型刻意不再占位：输入区右侧的「模型 · 等级」已承担该信息，
                     标题留给「正在做什么」这件对用户更有用的事。 -->
                <div class="min-w-0 flex-1 leading-tight">
                    <div
                        class="truncate text-sm font-black tracking-tight {workSummary
                            ? ''
                            : 'text-(--theme-modal-text)/35'}"
                        title={workSummary || 'AI 尚未给出工作摘要'}
                    >
                        {workSummary || '新对话'}
                    </div>
                </div>
                <button
                    onclick={() => (contextOpen = !contextOpen)}
                    class="sf-radius rounded-none p-1 transition-colors {contextOpen
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

            <!-- 实时状态条原先挂在头部下方；现按 DSH 的形态**下移**到 composer 之后（见文件底部） -->

            <!-- 上下文 / 用量 / 运行情况面板（默认收起；入口为头部 layers 按钮） -->
            <AiContextPanel
                open={contextOpen}
                onclose={() => (contextOpen = false)}
                onClearHistory={clearConversation}
                onCompactHistory={compactHistory}
                {compacting}
            />

            <!-- 消息区 -->
            <div
                bind:this={bodyEl}
                class="theme-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
                onscroll={onBodyScroll}
            >
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
                                class="max-w-[85%] wrap-break-word sf-radius rounded-none px-3 py-2 text-xs leading-relaxed"
                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                            >
                                {#if m.images && m.images.length > 0}
                                    <!-- 附件缩略图：用索引作 key（同一张图可被附两次，值会重复） -->
                                    <div class="mb-1.5 flex flex-wrap gap-1.5">
                                        {#each m.images as url, imgIdx (imgIdx)}
                                            <img
                                                src={url}
                                                alt={`附件 ${imgIdx + 1}`}
                                                class="size-16 sf-radius rounded-none border object-cover"
                                                style="border-color: color-mix(in srgb, var(--theme-accent-text-on-bg, #fff) 30%, transparent);"
                                            />
                                        {/each}
                                    </div>
                                {/if}
                                {#if m.text}
                                    <span class="whitespace-pre-wrap">{m.text}</span>
                                {/if}
                                {#if isLastUser}
                                    <button
                                        onclick={() => send(m.text, true, m.images ?? [])}
                                        disabled={busy}
                                        class="ml-1 inline-flex items-center sf-radius rounded-none px-0.5 py-0.5 align-middle opacity-50 transition-opacity hover:opacity-100 disabled:opacity-30"
                                        style="color: var(--theme-accent-text-on-bg, #fff);"
                                        title="重试这条指令"
                                    >
                                        <Icon icon="mdi:refresh" class="size-3" />
                                    </button>
                                {/if}
                            </div>
                        </div>
                    {:else if m.role === 'compaction'}
                        <!-- 压缩标记：居中分隔条，展开可看摘要正文（旧气泡保留在它上方供回看） -->
                        <div class="flex flex-col items-center gap-1 py-1">
                            <button
                                type="button"
                                onclick={() => (m.expanded = !m.expanded)}
                                class="flex items-center gap-1.5 sf-radius rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/45 transition-colors hover:text-(--theme-modal-text)"
                                style="border-color: var(--theme-divider-border);"
                                title="原始消息已移出模型上下文；上方的对话气泡保留供你回看"
                            >
                                <Icon icon="mdi:archive-arrow-down-outline" class="size-3 shrink-0" />
                                已压缩 {m.compaction?.summarized} 条历史 · ≈{formatTokens(m.compaction?.tokensBefore)} → ≈{formatTokens(
                                    m.compaction?.tokensAfter
                                )} token
                                <Icon
                                    icon={m.expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                                    class="size-3 shrink-0 opacity-60"
                                />
                            </button>
                            {#if m.expanded}
                                <div
                                    class="theme-scrollbar max-h-48 w-full overflow-y-auto sf-radius rounded-none border px-2.5 py-2 text-[10px] leading-relaxed whitespace-pre-wrap text-(--theme-modal-text)/60"
                                    style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-input-bg) 60%, transparent);"
                                >
                                    {m.text}
                                </div>
                            {/if}
                        </div>
                    {:else}
                        <div class="flex w-full flex-col gap-1 py-0.5 text-[11px] leading-relaxed">
                            {#each m.activities ?? [] as act, actIdx (actIdx)}
                                {#if act.kind === 'reasoning'}
                                    <div class="flex items-start gap-1.5 text-(--theme-modal-text)/45">
                                        <Icon icon="mdi:lightbulb-on-outline" class="mt-0.5 size-3 shrink-0" />
                                        <span class="shrink-0 font-black">思考</span>
                                        <span class="shrink-0 text-(--theme-modal-text)/25">·</span>
                                        <button
                                            type="button"
                                            onclick={() => (act.expanded = !act.expanded)}
                                            class="min-w-0 flex-1 text-left transition-colors hover:text-(--theme-modal-text)/70"
                                            title={act.expanded ? '收起思考' : '展开思考'}
                                        >
                                            <span
                                                class={act.expanded
                                                    ? 'whitespace-pre-wrap'
                                                    : 'line-clamp-2 whitespace-pre-wrap'}>{act.text}</span
                                            >
                                        </button>
                                    </div>
                                {:else if act.kind === 'text'}
                                    <div class="flex items-start gap-1.5">
                                        <Icon
                                            icon="mdi:format-text"
                                            class="mt-0.5 size-3 shrink-0 text-(--theme-accent-text)"
                                        />
                                        <span class="shrink-0 font-black text-(--theme-modal-text)/70">回复</span>
                                        <span class="shrink-0 text-(--theme-modal-text)/25">·</span>
                                        <div class="ai-md min-w-0 flex-1 text-xs leading-relaxed">
                                            {@html renderMd(act.text ?? '')}
                                        </div>
                                    </div>
                                {:else if act.kind === 'longTask'}
                                    <div class="flex items-start gap-1.5 text-(--theme-accent-text)/75">
                                        <Icon icon="mdi:sync" class="mt-0.5 size-3 shrink-0" />
                                        <span class="shrink-0 font-black">长任务</span>
                                        <span class="shrink-0 text-(--theme-modal-text)/25">·</span>
                                        <span class="min-w-0 flex-1 whitespace-pre-wrap">{act.text}</span>
                                    </div>
                                {:else if act.kind === 'notice'}
                                    <div
                                        class="flex items-start gap-1.5 {act.tone === 'error'
                                            ? 'text-red-400'
                                            : 'text-(--theme-modal-text)/45'}"
                                    >
                                        <Icon
                                            icon={act.tone === 'error'
                                                ? 'mdi:alert-circle-outline'
                                                : 'mdi:information-outline'}
                                            class="mt-0.5 size-3 shrink-0"
                                        />
                                        <span class="shrink-0 font-black">{act.tone === 'error' ? '错误' : '提示'}</span
                                        >
                                        <span class="shrink-0 text-(--theme-modal-text)/25">·</span>
                                        <span class="min-w-0 flex-1 whitespace-pre-wrap">{act.text}</span>
                                    </div>
                                {:else if act.kind === 'runResult'}
                                    <div class="flex items-start gap-1.5 text-(--theme-modal-text)/65">
                                        <Icon icon="mdi:check-circle" class="mt-0.5 size-3 shrink-0" />
                                        <span class="shrink-0 font-black">运行结果</span>
                                        <span class="shrink-0 text-(--theme-modal-text)/25">·</span>
                                        <pre
                                            class="theme-scrollbar max-h-64 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-(--theme-modal-text)/70">{act.text}</pre>
                                    </div>
                                {:else if act.kind === 'runError'}
                                    <div class="flex items-start gap-1.5 text-red-400">
                                        <Icon icon="mdi:alert-circle-outline" class="mt-0.5 size-3 shrink-0" />
                                        <span class="shrink-0 font-black">运行报错</span>
                                        <span class="shrink-0 text-(--theme-modal-text)/25">·</span>
                                        <pre
                                            class="theme-scrollbar max-h-64 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed">{act.text}</pre>
                                    </div>
                                {:else if act.kind === 'tool' && act.tool}
                                    {@const tool = act.tool}
                                    {@const meta = describeToolActivity(tool)}
                                    <div class="text-(--theme-modal-text)/40">
                                        <button
                                            type="button"
                                            onclick={() => (tool.expanded = !tool.expanded)}
                                            class="flex w-full items-center gap-1.5 rounded-none px-1 py-0.5 text-left transition-colors hover:bg-(--theme-modal-text)/5"
                                            title={tool.expanded ? '收起请求 / 响应' : '展开请求 / 响应'}
                                        >
                                            <Icon icon={meta.icon} class="size-3 shrink-0" />
                                            <span class="shrink-0 font-black">{meta.label}</span>
                                            <span class="shrink-0 text-(--theme-modal-text)/25">·</span>
                                            <span class="min-w-0 flex-1 truncate text-(--theme-modal-text)/55">
                                                {meta.summary}
                                            </span>
                                            {#if tool.resultLen !== undefined}
                                                <span class="shrink-0 text-(--theme-modal-text)/30"
                                                    >{tool.resultLen} 字符</span
                                                >
                                            {:else if typeof tool.args.status === 'string' && tool.args.status}
                                                <span class="max-w-20 shrink-0 truncate text-(--theme-modal-text)/35"
                                                    >{tool.args.status}</span
                                                >
                                            {:else if tool.done}
                                                <span class="shrink-0 text-(--theme-modal-text)/30">已完成</span>
                                            {:else}
                                                <span class="shrink-0 text-(--theme-accent-text)">执行中…</span>
                                            {/if}
                                            <Icon
                                                icon={tool.expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                                                class="size-3 shrink-0 opacity-50"
                                            />
                                        </button>
                                        {#if tool.expanded}
                                            {@const detail = describeToolCard(tool)}
                                            <div
                                                class="ml-4 space-y-1.5 border-l py-1 pl-2 text-[10px]"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                <div>
                                                    <div class="mb-0.5 text-(--theme-modal-text)/35">
                                                        {detail.requestLabel}
                                                    </div>
                                                    <pre
                                                        class="theme-scrollbar max-h-48 overflow-auto whitespace-pre-wrap break-all sf-radius rounded-none p-1.5 font-mono text-[10px] leading-relaxed text-(--theme-modal-text)/70"
                                                        style="background: color-mix(in srgb, var(--theme-modal-bg) 70%, transparent);">{detail.request}</pre>
                                                </div>
                                                <!-- run_js 的返回值 / 报错已提升为顶层「运行结果 / 运行报错」行，
                                                     代码卡片只保留脚本源码，避免同一份结果出现两次 -->
                                                {#if tool.name !== 'run_js' && detail.response !== undefined}
                                                    <div>
                                                        <div class="mb-0.5 text-(--theme-modal-text)/35">
                                                            {detail.responseLabel}
                                                        </div>
                                                        <pre
                                                            class="theme-scrollbar max-h-48 overflow-auto whitespace-pre-wrap break-all sf-radius rounded-none p-1.5 font-mono text-[10px] leading-relaxed text-(--theme-modal-text)/70"
                                                            style="background: color-mix(in srgb, var(--theme-modal-bg) 70%, transparent);">{detail.response}</pre>
                                                    </div>
                                                {/if}
                                            </div>
                                        {/if}
                                    </div>
                                {/if}
                            {/each}
                            {#if busy && (!m.activities || m.activities.length === 0)}
                                <div class="flex items-center gap-1.5 text-(--theme-modal-text)/40">
                                    <Icon icon="mdi:lightbulb-on-outline" class="size-3 shrink-0" />
                                    <span class="font-black">思考</span>
                                    <span class="text-(--theme-modal-text)/25">·</span>
                                    <span>思考中…</span>
                                </div>
                            {/if}
                        </div>
                    {/if}
                {/each}

                <!-- 用户向上翻看时给出「回到底部」入口；不滚动时始终隐藏，不占布局 -->
                {#if !stickToBottom}
                    <div class="sticky bottom-0 flex justify-center pb-1">
                        <button
                            type="button"
                            onclick={() => scrollToBottom(true)}
                            class="flex items-center gap-1 sf-radius rounded-none border px-2 py-1 text-[10px] shadow-lg transition-colors"
                            style="background: color-mix(in srgb, var(--theme-modal-bg) 92%, transparent); border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                        >
                            <Icon icon="mdi:arrow-down" class="size-3" />
                            回到底部
                        </button>
                    </div>
                {/if}

                <!-- 危险确认卡与 ask_user 提问卡已移入 composer 卡片内部（见本文件末尾的 `pendingCard` snippet） -->
            </div>

            <!-- composer（输入框 + 权限 / 模型·等级 / 用量圈 / 发送）与状态行都在子组件里，宿主只给 busy 与回调。
                 危险确认卡 / `ask_user` 卡经 `pending` 槽位渲染在 composer **卡片内部**（替掉输入行）：
                 此刻回合正阻塞在工具里等作答，发送任何文本都不会被处理，故不再并排留一个用不了的输入框。 -->
            <AiComposer
                {busy}
                longTask={longTaskActive}
                onsend={(text, images) => send(text, false, images)}
                onstop={stopGenerating}
                pending={hasPendingCard ? pendingCard : undefined}
                {pendingLabel}
            />
            <!-- 会话状态行：对齐 DSH 的「本轮汇总 ｜ N 轮 N 步」，挂在 composer **下方** -->
            {#if statusText || sessionStatus || longTaskActive}
                <div class="flex shrink-0 items-center gap-1.5 px-3 pb-2.5 text-[10px] tabular-nums">
                    <span
                        class="inline-block size-1.5 shrink-0 rounded-full"
                        style="background: var(--theme-accent-bg); opacity: {runtime.running ? 1 : 0.3};"
                    ></span>
                    {#if longTaskActive}
                        <span
                            class="flex shrink-0 items-center gap-1 text-(--theme-accent-text)"
                            title="长任务模式：输出停止后会自动继续；点停止按钮结束该状态"
                        >
                            <Icon icon="mdi:sync" class="size-3" />
                            长任务{longTaskContinuations > 0 ? ` · 已续 ${longTaskContinuations} 次` : ''}
                        </span>
                    {/if}
                    <span class="min-w-0 flex-1 truncate text-(--theme-modal-text)/45" title={statusText}>
                        {statusText}
                    </span>
                    {#if sessionStatus}
                        <span class="shrink-0 text-(--theme-modal-text)/30">{sessionStatus}</span>
                    {/if}
                </div>
            {/if}
        {/if}
    </div>
{/if}

{#snippet pendingCard()}
    {#if confirmCard}
        <!-- 危险操作确认：内容驱动，样式交给 composer 卡片（不再自带外框与底色） -->
        <div class="flex items-start gap-2">
            <Icon icon="mdi:alert-outline" class="mt-px size-4 shrink-0 text-red-500" />
            <div class="min-w-0 flex-1 leading-tight">
                <div class="text-xs font-black tracking-tight">确认执行操作</div>
                <div class="mt-0.5 text-[10px] text-(--theme-modal-text)/55">这一步可能改动你的数据，请确认</div>
            </div>
        </div>
        <div
            class="mt-2 sf-radius rounded-none border px-2.5 py-2 text-xs"
            style="background: var(--theme-input-bg); border-color: var(--theme-divider-border);"
        >
            <div class="font-black text-(--theme-accent-text)">{confirmCard.toolName}</div>
            <div class="mt-0.5 wrap-break-word text-(--theme-modal-text)/70">{confirmCard.summary}</div>
        </div>
        <div class="mt-2 flex justify-end gap-2">
            <button
                type="button"
                onclick={() => {
                    confirmCard?.resolve(false)
                    confirmCard = null
                }}
                class="sf-radius rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                style="border-color: var(--theme-divider-border);"
            >
                拒绝
            </button>
            <button
                type="button"
                onclick={() => {
                    confirmCard?.resolve(true)
                    confirmCard = null
                }}
                class="sf-radius rounded-none bg-red-500 px-2.5 py-1 text-[10px] font-medium text-white transition-all hover:brightness-110"
            >
                允许执行
            </button>
        </div>
    {:else if askCard}
        <!-- 「向用户提问」卡片（ask_user）：`{#key}` 保证换一组问题一定重挂新实例，
             组件卸载时按「放弃」收尾，不会把上一组问题与作答残留到下一轮。
             `embedded` 让卡片不再自带外框/底色 —— composer 卡片已经提供了表面。 -->
        {#key askCard}
            <AskUserCard request={askCard.request} onresolve={askCard.resolve} embedded />
        {/key}
    {/if}
{/snippet}

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
