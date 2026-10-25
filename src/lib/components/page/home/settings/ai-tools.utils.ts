/**
 * @desc 助手工具时间线的并入逻辑（纯函数，便于单测）。
 *
 * ## 为什么必须单独抽出来
 * 原实现是「拿**最后一张卡**，名称相同就当作它的结果」：
 * 只要有一张卡没配对到结果事件，**后续每一次配对都会顺延错位**，症状就是卡片永远停在「执行中…」。
 * 实测触发点：服务端 `web_search` 完成时只更新了实时状态、**没有发结果事件**，
 * 于是它后面所有工具的结果都被记到了别人身上（或各自新增一张卡），原卡永远不收尾。
 *
 * 改成按 `seq`（回合内递增的调用序号）配对后，一次错配**只影响自己**，不会传染。
 */
export interface ToolCard {
    name: string
    args: Record<string, unknown>
    /** @desc 结果字符数（有值即表示已结束） */
    resultLen?: number
    /** @desc 工具返回的完整结果文本（JSON），用于卡片展开查看请求 / 响应 */
    result?: string
    /** @desc 「无结果体」的结束标记（如服务端 `web_search` 只报检索完成） */
    done?: boolean
    /** @desc 本次调用的序号（与 `session.ts` 的 emit 配对；纯进度伪卡片没有它） */
    seq?: number
    /**
     * @desc 长任务（`generate_*`）的**实时状态行**：一行人话，随生成过程不断刷新
     *  （第几轮、在调哪个工具、模型已流出多少字），完成后保留最后一次。
     */
    progress?: string
    /**
     * @desc 长任务**正在流出的原始正文尾巴**（只留尾部若干字符，避免每 delta 都复制超长字符串）。
     *  生成结束后仍保留，用户可展开看模型到底写了什么。
     */
    live?: string
    /** @desc 卡片是否展开（只影响展示，不是工具状态） */
    expanded?: boolean
}

/** @desc 一次 `tool` 事件里与时间线有关的字段（`SessionEvent` 的子集，便于测试构造） */
export interface ToolEventLike {
    toolName?: string
    toolArgs?: Record<string, unknown>
    resultLen?: number
    resultText?: string
    done?: boolean
    seq?: number
}

/** @desc 结果事件 = 带 resultLen 或显式 done；否则是「开始调用」 */
const isResultEvent = (evt: ToolEventLike): boolean => evt.resultLen !== undefined || evt.done === true

/**
 * @desc 把一次 `tool` 事件并入工具时间线。
 * - 调用事件 → 追加一张新卡；
 * - 结果事件 → 按 `seq` 定位并补上结果；**找不到也绝不动别的卡**，只追加一张已结束的卡。
 */
export const applyToolEvent = (cards: readonly ToolCard[], evt: ToolEventLike): ToolCard[] => {
    if (!isResultEvent(evt)) {
        return [
            ...cards,
            {
                name: evt.toolName ?? 'tool',
                args: evt.toolArgs ?? {},
                ...(evt.seq !== undefined ? { seq: evt.seq } : {})
            }
        ]
    }
    const index = evt.seq === undefined ? -1 : cards.findIndex((card) => card.seq === evt.seq)
    if (index < 0) {
        return [
            ...cards,
            {
                name: evt.toolName ?? 'tool',
                args: evt.toolArgs ?? {},
                ...(evt.resultLen !== undefined ? { resultLen: evt.resultLen } : {}),
                ...(evt.resultText !== undefined ? { result: evt.resultText } : {}),
                ...(evt.done ? { done: true } : {})
            }
        ]
    }
    return cards.map((card, i) =>
        i === index
            ? {
                  ...card,
                  ...(evt.resultLen !== undefined ? { resultLen: evt.resultLen } : {}),
                  ...(evt.resultText !== undefined ? { result: evt.resultText } : {}),
                  ...(evt.done ? { done: true } : {})
              }
            : card
    )
}

/**
 * @desc 长任务进度（`generate_*`）：优先挂到正在跑的那张卡上（改它的 `progress`），
 * 否则追加一张**纯进度伪卡** —— 它没有 `seq`，因此永远不会抢走真实调用的结果配对。
 */
export const applyToolProgress = (cards: readonly ToolCard[], status: string): ToolCard[] => {
    const last = cards[cards.length - 1]
    if (last && last.name.startsWith('generate_') && last.resultLen === undefined && !last.done) {
        return cards.map((card, i) => (i === cards.length - 1 ? { ...card, progress: status } : card))
    }
    return [...cards, { name: 'buff生成', args: {}, progress: status }]
}

/** @desc 卡片详情区最多展示这么多字符（工具结果本身可达 4 万字符，全塞进 DOM 会卡） */
const MAX_DETAIL_CHARS = 12_000

/** @desc 任意值 → 可读的多行文本（JSON 优先；循环引用 / BigInt 兜底为 String） */
export const formatDetailValue = (value: unknown, maxChars = MAX_DETAIL_CHARS): string => {
    let text: string
    try {
        text = JSON.stringify(value, null, 2) ?? String(value)
    } catch {
        text = String(value)
    }
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n…[已截断 ${text.length - maxChars} 字符]` : text
}

/** @desc 工具结果的统一 JSON 形状（`{ ok, data | error }`；解析失败返回 `null`） */
export interface ParsedToolResult {
    ok?: boolean
    data?: unknown
    error?: string
}

export const parseToolResult = (raw?: string): ParsedToolResult | null => {
    if (!raw) return null
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        if (!parsed || typeof parsed !== 'object') return null
        return {
            ...(typeof parsed.ok === 'boolean' ? { ok: parsed.ok } : {}),
            ...(parsed.data !== undefined ? { data: parsed.data } : {}),
            ...(typeof parsed.error === 'string' ? { error: parsed.error } : {})
        }
    } catch {
        return null
    }
}

/** @desc 聊天卡片里「请求 / 响应」两块内容（`response` 为空表示还没跑完） */
export interface ToolDetailView {
    requestLabel: string
    request: string
    responseLabel: string
    response?: string
}

/**
 * @desc 把一张工具卡转成可展开的请求 / 响应视图。
 *
 * `run_js` 单独处理：请求就是脚本源码（不应被 JSON 包一层转义），响应拆成「返回值 + 脚本日志」；
 * 其余工具按统一 JSON 展示 —— `web_fetch` 的 args 里就是 method/headers/body，
 * 结果里就是 status/headers/content，用户要看的正是这些。
 */
export const describeToolCard = (card: Pick<ToolCard, 'name' | 'args' | 'result'>): ToolDetailView => {
    const isRunJs = card.name === 'run_js'
    const requestLabel = isRunJs ? '脚本代码' : '请求参数'
    const request = isRunJs && typeof card.args.code === 'string' ? card.args.code : formatDetailValue(card.args)
    const responseLabel = isRunJs ? '执行结果' : '响应结果'
    if (card.result === undefined) return { requestLabel, request, responseLabel }

    const parsed = parseToolResult(card.result)
    if (!parsed) return { requestLabel, request, responseLabel, response: formatDetailValue(card.result) }

    if (isRunJs && parsed.ok && parsed.data && typeof parsed.data === 'object') {
        const data = parsed.data as { value?: unknown; logs?: unknown }
        const logs = Array.isArray(data.logs) ? data.logs.map((line) => String(line)) : []
        const parts = [`返回值\n${formatDetailValue(data.value)}`]
        if (logs.length > 0) parts.push(`脚本日志（${logs.length} 条）\n${logs.join('\n')}`)
        return { requestLabel, request, responseLabel, response: parts.join('\n\n') }
    }

    const response = parsed.ok === false ? `错误：${parsed.error ?? '执行失败'}` : formatDetailValue(parsed.data)
    return { requestLabel, request, responseLabel, response }
}

// ── AI 输出「活动流」：思考 / 工具 / 回复 / 提示按发生顺序排列（取代聊天气泡里的三个 tab）──

/** @desc 一条活动（渲染顺序即发生顺序） */
export interface AssistantActivity {
    kind: 'reasoning' | 'text' | 'tool' | 'notice' | 'longTask' | 'runResult' | 'runError'
    /** @desc 思考 / 回复 / 提示的正文（流式累积） */
    text?: string
    /** @desc 工具活动对应的卡片 */
    tool?: ToolCard
    /** @desc 提示的语气（错误用红色图标） */
    tone?: 'info' | 'error'
    /** @desc 思考内容是否展开（长思考默认折成两行） */
    expanded?: boolean
}

/**
 * @desc 连续同类文本合并到同一行；切换类型（如工具调用之后）则新起一行。
 *
 * 流式 delta 可能一秒几十次；这里对「追加到最后一个同类活动」走**原地更新**，
 * 不再每次复制整个活动数组。长会话里这能把每次 token 的 O(活动数) 拷贝降成 O(1)；
 * 仅在新起一行时才创建新数组。
 */
export const appendActivityText = (
    activities: readonly AssistantActivity[],
    kind: 'reasoning' | 'text',
    delta: string
): AssistantActivity[] => {
    if (!delta) return activities as AssistantActivity[]
    const last = activities[activities.length - 1]
    if (last && last.kind === kind) {
        last.text = (last.text ?? '') + delta
        return activities as AssistantActivity[]
    }
    return [...activities, { kind, text: delta }]
}

/** @desc 追加一条提示（错误 / 长任务自动继续等），永远新起一行 */
export const appendActivityNotice = (
    activities: readonly AssistantActivity[],
    text: string,
    tone: 'info' | 'error' = 'info',
    kind: 'notice' | 'longTask' | 'runResult' | 'runError' = 'notice'
): AssistantActivity[] => [...activities, { kind, text, tone }]

/**
 * @desc 工具事件 → 活动流。
 * 调用事件新起一行；结果事件按 `seq` 找到对应的工具行并补结果（与 `applyToolEvent` 同一口径）。
 */
export const applyToolEventToActivities = (
    activities: readonly AssistantActivity[],
    evt: ToolEventLike
): AssistantActivity[] => {
    if (!isResultEvent(evt)) {
        return [
            ...activities,
            {
                kind: 'tool',
                tool: {
                    name: evt.toolName ?? 'tool',
                    args: evt.toolArgs ?? {},
                    ...(evt.seq !== undefined ? { seq: evt.seq } : {})
                }
            }
        ]
    }
    const index = evt.seq === undefined ? -1 : activities.findIndex((a) => a.kind === 'tool' && a.tool?.seq === evt.seq)
    if (index < 0) {
        const [card] = applyToolEvent([], evt)
        return [...activities, { kind: 'tool', tool: card }]
    }
    return activities.map((activity, i) => {
        if (i !== index || !activity.tool) return activity
        const [card] = applyToolEvent([activity.tool], evt)
        return { ...activity, tool: card }
    })
}

/** @desc 长任务进度（`generate_*`）→ 活动流：优先挂到最后一张正在跑的工具行 */
export const applyToolProgressToActivities = (
    activities: readonly AssistantActivity[],
    status: string
): AssistantActivity[] => {
    const index = findRunningGenerateIndex(activities)
    if (index >= 0) {
        return activities.map((item, idx) =>
            idx === index ? { ...item, tool: setToolProgress(item.tool, status) } : item
        )
    }
    return [...activities, { kind: 'tool', tool: { name: 'buff生成', args: {}, progress: status } }]
}

/** @desc 正在运行的 `generate_*` 工具行下标（没有则 -1） */
const findRunningGenerateIndex = (activities: readonly AssistantActivity[]): number => {
    for (let i = activities.length - 1; i >= 0; i--) {
        const activity = activities[i]
        if (activity.kind !== 'tool' || !activity.tool) continue
        if (!activity.tool.name.startsWith('generate_')) continue
        if (activity.tool.resultLen !== undefined || activity.tool.done) return -1
        return i
    }
    return -1
}

const withToolProgress = (tool: ToolCard | undefined, patch: Partial<ToolCard>): ToolCard => ({
    name: tool?.name ?? 'buff生成',
    args: tool?.args ?? {},
    ...tool,
    ...patch
})

const setToolProgress = (tool: ToolCard | undefined, status: string): ToolCard =>
    withToolProgress(tool, { progress: status })

/** @desc 生成任务事件（`GenerateEvent` 的子集，便于测试构造） */
export interface GenerateEventLike {
    kind: 'status' | 'content' | 'reasoning' | 'tool' | 'tool-result' | 'result' | 'error'
    text?: string
    round?: number
    toolCalls?: number
    toolName?: string
    /** @desc 流式增量正文（content / reasoning） */
    delta?: string
    contentChars?: number
    reasoningChars?: number
    buffCount?: number
}

/** @desc 生成正文尾巴最多留这么多字符（再长就截尾，只用于实时预览） */
const GENERATE_LIVE_CHARS = 900

/**
 * @desc 生成任务的实时事件 → 活动流。
 *
 * 目标始终是**那张正在跑的 `generate_*` 工具行**：状态类事件刷它的 `progress`，
 * 流式正文/思考累积到 `live`（只留尾部），于是用户能在不结束生成的前提下看到
 * 「第几轮、在查什么、模型正在写什么」。
 */
export const applyGenerateEventToActivities = (
    activities: readonly AssistantActivity[],
    evt: GenerateEventLike
): AssistantActivity[] => {
    const index = findRunningGenerateIndex(activities)
    const isStream = evt.kind === 'content' || evt.kind === 'reasoning'

    if (index < 0) {
        // 没有正在跑的生成行（例如状态先于工具事件到达）：退化成一条纯进度伪行
        if (!evt.text) return activities as AssistantActivity[]
        return [...activities, { kind: 'tool', tool: { name: 'buff生成', args: {}, progress: evt.text } }]
    }

    const activity = activities[index]
    const tool = activity.tool
    let patch: Partial<ToolCard>
    if (isStream) {
        const merged = `${tool?.live ?? ''}${evt.delta ?? ''}`
        const live = merged.length > GENERATE_LIVE_CHARS ? merged.slice(-GENERATE_LIVE_CHARS) : merged
        const parts: string[] = []
        if (evt.round) parts.push(`第 ${evt.round} 轮`)
        if (evt.contentChars) parts.push(`输出 ${formatCount(evt.contentChars)} 字`)
        if (evt.reasoningChars) parts.push(`思考 ${formatCount(evt.reasoningChars)} 字`)
        // 这一轮还没拿到工具名时，保留上一次的状态行更有信息量
        patch = { live, progress: parts.length > 0 ? parts.join(' · ') : tool?.progress }
    } else {
        patch = {
            ...(evt.text ? { progress: evt.text } : {}),
            // 新工具调用开始 → 上一轮流出的正文已经过期，清掉尾巴
            ...(evt.kind === 'tool' ? { live: '' } : {})
        }
    }
    const nextTool = withToolProgress(tool, patch)
    return activities.map((item, idx) => (idx === index ? { ...item, tool: nextTool } : item))
}

/** @desc 字符数 / 工具次数的紧凑写法（12 / 1.2k / 34k） */
export const formatCount = (value: number): string =>
    value >= 10_000 ? `${Math.round(value / 1000)}k` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)

/**
 * @desc `run_js` 的执行结果 → **顶层活动行**（与「代码」工具行分开）。
 *
 * 用户要求「代码 / 运行结果 / 运行报错」是三行独立输出：返回值与错误不再只藏在
 * 代码卡片的展开结果里。返回值与日志由 worker 侧按上限截断过，这里只负责解析与排版。
 */
export const appendRunJsOutput = (activities: readonly AssistantActivity[], raw?: string): AssistantActivity[] => {
    const parsed = parseToolResult(raw)
    if (!parsed) return appendActivityNotice(activities, raw ?? '（无输出）', 'info', 'runResult')
    if (parsed.ok === false) {
        return appendActivityNotice(activities, parsed.error ?? '脚本执行失败', 'error', 'runError')
    }
    const data = (parsed.data ?? {}) as { value?: unknown; logs?: unknown; truncated?: boolean }
    const valueText = data.truncated && typeof data.value === 'string' ? data.value : formatDetailValue(data.value)
    const parts = [data.truncated ? `（结果超过输出上限，已截断）\n${valueText}` : valueText]
    const logs = Array.isArray(data.logs) ? data.logs.map((line) => String(line)) : []
    if (logs.length > 0) parts.push(`脚本日志（${logs.length} 条）\n${logs.join('\n')}`)
    return appendActivityNotice(activities, parts.join('\n\n'), 'info', 'runResult')
}

/** @desc 工具行左侧的「类别 · 摘要」：让用户不展开也能看懂这次操作做了什么 */
export interface ToolActivityMeta {
    label: string
    icon: string
    summary: string
}

/** @desc 取第一行非空文本并截断（脚本代码 / 多行参数的一行预览） */
const firstLine = (text: string, max = 80): string => {
    const line = text
        .split('\n')
        .map((part) => part.trim())
        .find((part) => part.length > 0)
    if (!line) return ''
    return line.length > max ? `${line.slice(0, max)}…` : line
}

/** @desc 参数的一行预览：优先第一个非空标量（`key=value`），数组只报长度，对象只报 key */
const summarizeArgs = (args: Record<string, unknown>): string => {
    for (const [key, value] of Object.entries(args)) {
        if (key === 'status' || value === undefined || value === null || value === '') continue
        if (typeof value === 'string') return `${key}=${firstLine(value, 60)}`
        if (typeof value === 'number' || typeof value === 'boolean') return `${key}=${value}`
        if (Array.isArray(value)) return `${key}[ ${value.length} 项 ]`
        if (typeof value === 'object') return key
    }
    return ''
}

/**
 * @desc 工具名 → 列表行的类别 / 图标 / 一行摘要。
 * 分类只影响**展示**，不影响工具能力；未知工具统一落到「工具 · 名称」。
 */
export const describeToolActivity = (card: Pick<ToolCard, 'name' | 'args'>): ToolActivityMeta => {
    const name = card.name
    const args = card.args ?? {}
    if (name === 'run_js') {
        return {
            label: '代码',
            icon: 'mdi:file-document-outline',
            summary: firstLine(String(args.code ?? '')) || '执行脚本'
        }
    }
    if (name === 'web_fetch') {
        return { label: '抓取', icon: 'mdi:link-variant', summary: String(args.url ?? '网页') }
    }
    if (name === 'web_search') {
        return { label: '搜索', icon: 'mdi:magnify', summary: String(args.query ?? '联网搜索') }
    }
    if (name === 'set_long_task') {
        return {
            label: '长任务',
            icon: 'mdi:sync',
            summary: args.enabled ? String(args.note ?? '已开启') : '已关闭'
        }
    }
    if (name === 'set_work_summary') {
        return { label: '摘要', icon: 'mdi:clipboard-text-outline', summary: String(args.summary ?? '更新工作摘要') }
    }
    if (name === 'ask_user') {
        const questions = Array.isArray(args.questions) ? args.questions : []
        const first = questions[0] as { question?: unknown } | undefined
        return {
            label: '提问',
            icon: 'mdi:help-circle-outline',
            summary: typeof first?.question === 'string' ? firstLine(first.question, 60) : '等待用户作答'
        }
    }
    const preview = summarizeArgs(args)
    const withPreview = (label: string, icon: string) => ({
        label,
        icon,
        summary: preview ? `${name} · ${preview}` : name
    })
    if (/^generate_/.test(name)) return withPreview('生成', 'mdi:auto-fix')
    if (/^(import|sync|export)_/.test(name)) return withPreview('导入', 'mdi:swap-horizontal-bold')
    if (/^(get|list|read|search|query)_/.test(name)) return withPreview('读取', 'mdi:file-document-outline')
    if (/^(set|update|delete|switch|lock|unlock|rename|create|add|move)_/.test(name)) {
        return withPreview('修改', 'mdi:pencil-outline')
    }
    return withPreview('工具', 'mdi:toolbox-outline')
}
