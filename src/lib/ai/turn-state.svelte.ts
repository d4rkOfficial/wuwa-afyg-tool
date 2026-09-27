/**
 * @desc AI 回合的**会话级临时状态**（响应式，**不持久化**，刷新即恢复默认）。
 *
 * 三块内容：
 * 1. **上下文分段快照 + 临时禁用集合**：快照由 `session.ts` 在回合开始时写入（装配真源），
 *    禁用集合只影响当前会话的后续请求，不写任何持久化配置。
 * 2. **实时运行情况**：请求中 / 空闲、阶段（思考 / 流式文本 / 调用工具 / 等待结果）、
 *    已耗时（运行中由内部时钟推进）、本轮工具调用列表（耗时 / 成败 / 梗概）。
 * 3. **token 与缓存命中**：本轮合计 + 本会话累计（服务商 usage 优先，缺失部分不计入）。
 *
 * 写入方只有 `session.ts`（回合流程）；界面（`ai-assistant.svelte` / `ai-context-panel.svelte`）
 * 只读展示。所有 getter 直接读 `$state`，在组件模板里调用即可获得响应式追踪。
 */
import type { TurnSegment, TurnSegmentId } from './turn-context'
import {
    emptySessionUsageTotals,
    emptyUsageTotals,
    type SessionUsageTotals,
    type TokenUsage,
    type TurnSummary,
    type UsageTotals
} from './token-usage'

// ── 上下文分段（快照 + 临时禁用）────────────────────────────────────

let _segments = $state<TurnSegment[]>([])
/** @desc 被临时禁用的分段 id（会话级；数组而非 Set，便于响应式比较） */
let _disabled = $state<TurnSegmentId[]>([])

/** @desc 面板展示用的分段视图（token 占比按启用中的非空段计算） */
export interface ContextSegmentView {
    id: TurnSegmentId
    label: string
    text: string
    /** @desc 是否参与注入（未被临时禁用） */
    enabled: boolean
    /** @desc 该段是否没有内容（空段即使启用也不会注入） */
    empty: boolean
    charCount: number
    tokens: number
    /** @desc 占启用段 token 合计的比例（0~1；合计为 0 时为 0） */
    ratio: number
}

/** @desc 写入本轮装配的分段快照（`session.ts` 在回合开始时调用一次） */
export const setContextSnapshot = (segments: TurnSegment[]): void => {
    _segments = segments
}

/** @desc 分段快照是否已存在（首轮请求前为 false，面板显示空态） */
export const hasContextSnapshot = (): boolean => _segments.length > 0

/** @desc 临时禁用集合（`session.ts` 据此过滤装配） */
export const getDisabledSegments = (): TurnSegmentId[] => _disabled

export const isSegmentDisabled = (id: TurnSegmentId): boolean => _disabled.includes(id)

/** @desc 临时禁用 / 恢复一个分段（只影响当前会话的后续请求） */
export const toggleSegmentDisabled = (id: TurnSegmentId): void => {
    _disabled = isSegmentDisabled(id) ? _disabled.filter((x) => x !== id) : [..._disabled, id]
}

/** @desc 恢复全部分段 */
export const resetDisabledSegments = (): void => {
    _disabled = []
}

/** @desc 面板视图：分段 + 启用态 + 字符数 / 估算 token / 占比 */
export const getContextSegments = (): ContextSegmentView[] => {
    const total = _segments
        .filter((s) => !_disabled.includes(s.id) && s.messages.length > 0)
        .reduce((sum, s) => sum + s.tokens, 0)
    return _segments.map((s) => {
        const enabled = !_disabled.includes(s.id)
        const empty = s.messages.length === 0
        return {
            id: s.id,
            label: s.label,
            text: s.text,
            enabled,
            empty,
            charCount: s.text.length,
            tokens: s.tokens,
            ratio: enabled && !empty && total > 0 ? s.tokens / total : 0
        }
    })
}

// ── 实时运行情况 ─────────────────────────────────────────────────────

/** @desc 回合阶段：思考中 / 收到流式文本 / 正在调用工具 / 等待工具结果 */
export type TurnPhase = 'idle' | 'thinking' | 'streaming' | 'tool' | 'waiting'

export interface LiveToolCall {
    name: string
    args: Record<string, unknown>
    startedAt: number
    endedAt?: number
    durationMs?: number
    /** @desc 工具返回的 `ok` 字段（未知为 undefined） */
    ok?: boolean
    /** @desc 结果梗概（成功给一行摘要，失败给错误信息） */
    summary?: string
}

export interface TurnRuntime {
    running: boolean
    phase: TurnPhase
    /** @desc 当前工具名（phase === 'tool' 时有效） */
    toolName?: string
    /** @desc 阶段补充说明（等待确认 / 生成进度等） */
    detail?: string
    startedAt: number | null
    elapsedMs: number
    /** @desc 本轮已发生的工具调用（回合结束后保留到下一轮开始） */
    toolCalls: LiveToolCall[]
}

const IDLE_RUNTIME: TurnRuntime = {
    running: false,
    phase: 'idle',
    startedAt: null,
    elapsedMs: 0,
    toolCalls: []
}

/** @desc 运行中时钟推进间隔（毫秒） */
const CLOCK_TICK_MS = 200

let _runtime = $state<TurnRuntime>({ ...IDLE_RUNTIME })
let _turnUsage = $state<UsageTotals>(emptyUsageTotals())
let _sessionUsage = $state<SessionUsageTotals>(emptySessionUsageTotals())
let _lastSummary = $state<TurnSummary | null>(null)
let _clock: ReturnType<typeof setInterval> | null = null

const stopClock = (): void => {
    if (_clock !== null) {
        clearInterval(_clock)
        _clock = null
    }
}

const startClock = (): void => {
    stopClock()
    if (typeof window === 'undefined') return
    _clock = setInterval(() => {
        if (!_runtime.running || !_runtime.startedAt) return
        _runtime = { ..._runtime, elapsedMs: Date.now() - _runtime.startedAt }
    }, CLOCK_TICK_MS)
}

export const getTurnRuntime = (): TurnRuntime => _runtime

/** @desc 阶段文案（状态条与上下文面板共用同一份口径） */
export const describeTurnPhase = (runtime: Pick<TurnRuntime, 'running' | 'phase' | 'toolName' | 'detail'>): string => {
    if (!runtime.running) return '空闲'
    if (runtime.phase === 'tool' && runtime.toolName) return `正在调用工具「${runtime.toolName}」`
    if (runtime.phase === 'thinking') return '思考中'
    if (runtime.phase === 'streaming') return '收到流式文本'
    return runtime.detail ? `等待工具结果（${runtime.detail}）` : '等待工具结果'
}

/** @desc 回合开始：清空上一轮实时数据与用量，进入「思考中」 */
export const beginTurn = (): void => {
    _turnUsage = emptyUsageTotals()
    _runtime = { running: true, phase: 'thinking', startedAt: Date.now(), elapsedMs: 0, toolCalls: [] }
    startClock()
}

/** @desc 切换阶段（回合未运行时忽略） */
export const setTurnPhase = (phase: TurnPhase, detail?: { toolName?: string; text?: string }): void => {
    if (!_runtime.running) return
    _runtime = { ..._runtime, phase, toolName: detail?.toolName, detail: detail?.text }
}

/** @desc 收到首个流式文本增量 → 「收到流式文本」 */
export const markStreaming = (): void => {
    if (!_runtime.running || _runtime.phase === 'streaming') return
    _runtime = { ..._runtime, phase: 'streaming', toolName: undefined, detail: undefined }
}

/** @desc 等待类阶段（危险操作等用户确认 / 长任务生成进度）：仍属「等待工具结果」 */
export const markToolWaiting = (detail: string, toolName?: string): void => {
    if (!_runtime.running) return
    _runtime = { ..._runtime, phase: 'waiting', detail, toolName: toolName ?? _runtime.toolName }
}

/** @desc 开始一次工具调用，返回其索引（结束与实时查看都用它） */
export const beginToolCall = (name: string, args: Record<string, unknown>): number => {
    const call: LiveToolCall = { name, args, startedAt: Date.now() }
    _runtime = { ..._runtime, toolCalls: [..._runtime.toolCalls, call] }
    setTurnPhase('tool', { toolName: name })
    return _runtime.toolCalls.length - 1
}

/** @desc 结束一次工具调用（记录耗时 / 成败 / 结果梗概），并回到「思考中」等待后续轮次 */
export const endToolCall = (index: number, ok: boolean | undefined, summary?: string): void => {
    const endedAt = Date.now()
    _runtime = {
        ..._runtime,
        toolCalls: _runtime.toolCalls.map((call, i) =>
            i === index ? { ...call, endedAt, durationMs: endedAt - call.startedAt, ok, summary } : call
        ),
        phase: _runtime.running ? 'thinking' : _runtime.phase,
        toolName: undefined,
        detail: undefined
    }
}

/**
 * @desc 记录一次模型请求的用量。
 * @param providerUsage 服务商 usage（`parseUsage` 结果；为 `null` 表示这次没拿到）
 * @param fallback 本地估算回退（**仅当整次请求都没拿到 usage 时**生效：prompt 由消息估算、
 * completion 由回复文本估算）。拿到了 usage 时缺失的字段（例如没有缓存字段）保持缺失，
 * 界面显示「—」，不做任何估算填充。
 */
export const recordRequestUsage = (
    providerUsage: TokenUsage | null,
    fallback?: { promptTokens?: number; completionTokens?: number }
): void => {
    const useFallback = providerUsage === null
    const prompt = providerUsage?.promptTokens ?? (useFallback ? fallback?.promptTokens : undefined)
    const completion = providerUsage?.completionTokens ?? (useFallback ? fallback?.completionTokens : undefined)
    const total =
        providerUsage?.totalTokens ??
        (prompt !== undefined && completion !== undefined ? prompt + completion : undefined)
    const add = (base: number | undefined, delta: number | undefined): number | undefined =>
        delta === undefined ? base : (base ?? 0) + delta
    _turnUsage = {
        promptTokens: _turnUsage.promptTokens + (prompt ?? 0),
        completionTokens: _turnUsage.completionTokens + (completion ?? 0),
        totalTokens: _turnUsage.totalTokens + (total ?? 0),
        cacheHitTokens: add(_turnUsage.cacheHitTokens, providerUsage?.cacheHitTokens),
        cacheMissTokens: add(_turnUsage.cacheMissTokens, providerUsage?.cacheMissTokens),
        requests: _turnUsage.requests + 1,
        estimatedRequests: _turnUsage.estimatedRequests + (providerUsage === null ? 1 : 0)
    }
}

export const getTurnUsage = (): UsageTotals => _turnUsage
export const getSessionUsage = (): SessionUsageTotals => _sessionUsage
/** @desc 上一次完成的回合汇总（回合结束后保留，直到下一轮开始） */
export const getLastTurnSummary = (): TurnSummary | null => _lastSummary

/** @desc 回合结束：停表、保留汇总、把本轮用量并进会话累计（未开始时为空操作） */
export const finishTurn = (): void => {
    if (!_runtime.running) return
    const elapsedMs = _runtime.startedAt ? Date.now() - _runtime.startedAt : _runtime.elapsedMs
    stopClock()
    const toolCalls = _runtime.toolCalls
    _runtime = { ..._runtime, running: false, phase: 'idle', elapsedMs, toolName: undefined, detail: undefined }
    _lastSummary = {
        elapsedMs,
        toolCalls: toolCalls.length,
        failedTools: toolCalls.filter((c) => c.ok === false).length,
        usage: { ..._turnUsage }
    }
    _sessionUsage = {
        promptTokens: _sessionUsage.promptTokens + _turnUsage.promptTokens,
        completionTokens: _sessionUsage.completionTokens + _turnUsage.completionTokens,
        totalTokens: _sessionUsage.totalTokens + _turnUsage.totalTokens,
        cacheHitTokens:
            _turnUsage.cacheHitTokens === undefined
                ? _sessionUsage.cacheHitTokens
                : (_sessionUsage.cacheHitTokens ?? 0) + _turnUsage.cacheHitTokens,
        cacheMissTokens:
            _turnUsage.cacheMissTokens === undefined
                ? _sessionUsage.cacheMissTokens
                : (_sessionUsage.cacheMissTokens ?? 0) + _turnUsage.cacheMissTokens,
        requests: _sessionUsage.requests + _turnUsage.requests,
        estimatedRequests: _sessionUsage.estimatedRequests + _turnUsage.estimatedRequests,
        turns: _sessionUsage.turns + 1
    }
}

/** @desc 清空对话时调用：清掉用量累计、分段快照与回合汇总（保留分段禁用选择） */
export const resetAiSessionState = (): void => {
    stopClock()
    _runtime = { ...IDLE_RUNTIME, toolCalls: [] }
    _turnUsage = emptyUsageTotals()
    _sessionUsage = emptySessionUsageTotals()
    _lastSummary = null
    _segments = []
}
