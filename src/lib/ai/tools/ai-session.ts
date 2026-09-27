// AI 助手自身域工具：上下文管理器（分段 / 临时禁用）、token 与缓存命中用量、实时运行情况、分享冷却。
// 这些是**会话级临时状态**（刷新即重置、不持久化），与「设置」域的持久化配置分开。
import { defineTool } from './registry'
import {
    describeTurnPhase,
    getContextSegments,
    getDisabledSegments,
    getLastTurnSummary,
    getSessionUsage,
    getTurnRuntime,
    getTurnUsage,
    hasContextSnapshot,
    resetDisabledSegments,
    setContextSnapshot,
    toggleSegmentDisabled
} from '../turn-state.svelte'
import { TURN_SEGMENT_HINTS, TURN_SEGMENT_LABELS, type TurnSegmentId } from '../turn-context'
import { cacheHitRate, formatPercent, formatTokens, summarizeTurn } from '../token-usage'
import {
    SHARE_COOLDOWN_MS,
    isShareCoolingDown,
    shareCooldownLabel,
    shareCooldownRemaining
} from '$lib/data/share.svelte'

const str = (v: unknown): string => String(v ?? '').trim()

/** @desc 合法的上下文分段 id 清单（来自 turn-context 的唯一真源） */
const SEGMENT_IDS = Object.keys(TURN_SEGMENT_LABELS) as TurnSegmentId[]

const isSegmentId = (v: string): v is TurnSegmentId => (SEGMENT_IDS as string[]).includes(v)

/** @desc 把累计用量压成模型易读的一行摘要（缺失字段保持缺失，不臆造） */
const usageView = (usage: ReturnType<typeof getTurnUsage>): Record<string, unknown> => ({
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cacheHitTokens: usage.cacheHitTokens ?? null,
    cacheMissTokens: usage.cacheMissTokens ?? null,
    cacheHitRate: formatPercent(cacheHitRate(usage)),
    requests: usage.requests,
    estimatedRequests: usage.estimatedRequests,
    promptTokensText: formatTokens(usage.promptTokens),
    completionTokensText: formatTokens(usage.completionTokens)
})

defineTool('get_ai_context_state', {
    description:
        '读取 AI 助手的**上下文管理器**状态：本轮装配进请求的各分段（人设 / 被动技能 / 主动技能 / 工程上下文 / 变更队列 / 历史 / 用户输入）的字符数、估算 token 与占用比例，以及哪些分段被临时禁用。首轮请求前快照为空（hasSnapshot=false）。返回的 id 可直接传给 set_ai_context_segment 临时禁用或恢复。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const segments = getContextSegments()
        return {
            hasSnapshot: hasContextSnapshot(),
            segments: segments.map((s) => ({
                id: s.id,
                label: s.label,
                enabled: s.enabled,
                empty: s.empty,
                charCount: s.charCount,
                tokens: s.tokens,
                ratio: s.ratio,
                ratioText: formatPercent(s.ratio),
                hint: TURN_SEGMENT_HINTS[s.id] ?? '',
                preview: s.text.length > 160 ? `${s.text.slice(0, 160)}…` : s.text
            })),
            disabled: getDisabledSegments(),
            availableSegmentIds: SEGMENT_IDS,
            hint: '分段禁用只影响当前会话的后续请求，不写任何持久化配置；用 set_ai_context_segment 逐个切换，或 reset_ai_context_segments 全部恢复'
        }
    }
})

defineTool('set_ai_context_segment', {
    description:
        '临时启用 / 禁用 AI 上下文的某一个分段（只影响当前会话后续请求，不持久化，刷新即恢复）。segmentId 取自 get_ai_context_state 返回的 availableSegmentIds：persona（人设）/ passiveSkills（被动技能）/ activeSkills（主动技能清单）/ context（工程上下文）/ changes（变更队列）/ history（对话历史）/ user（用户输入）。enabled=false 即把该段从后续请求里剔除（用于压缩上下文、排障）；enabled=true 恢复注入。返回切换后的禁用清单。',
    parameters: {
        type: 'object',
        properties: {
            segmentId: {
                type: 'string',
                enum: SEGMENT_IDS,
                description: `上下文分段 id（${SEGMENT_IDS.map((id) => `${id}（${TURN_SEGMENT_LABELS[id]}）`).join(' / ')}）`
            },
            enabled: { type: 'boolean', description: 'true=恢复注入，false=临时禁用（默认 false）' }
        },
        required: ['segmentId']
    },
    handler: (args) => {
        const segmentId = str(args.segmentId)
        if (!segmentId) throw new Error('segmentId 不能为空')
        if (!isSegmentId(segmentId)) {
            throw new Error(`未知上下文分段：${segmentId}（可用：${SEGMENT_IDS.join('/')}）`)
        }
        const wantEnabled = args.enabled === true
        const disabled = getDisabledSegments()
        const currentlyEnabled = !disabled.includes(segmentId)
        if (wantEnabled !== currentlyEnabled) toggleSegmentDisabled(segmentId)
        const next = getDisabledSegments()
        return {
            segmentId,
            label: TURN_SEGMENT_LABELS[segmentId],
            enabled: !next.includes(segmentId),
            disabled: next,
            changed: wantEnabled !== currentlyEnabled
        }
    }
})

defineTool('reset_ai_context_segments', {
    description: '恢复全部被临时禁用的 AI 上下文分段（把所有分段重新纳入后续请求）。只影响当前会话，不动持久化配置。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const before = getDisabledSegments()
        resetDisabledSegments()
        return { reset: true, restoredFrom: before, disabled: getDisabledSegments() }
    }
})

defineTool('clear_ai_context_snapshot', {
    description:
        '清空 AI 上下文的分段**快照**（下一次请求前上下文面板显示空态）。用于排障或强制下一轮重建上下文快照；不会清空对话历史（对话历史由界面上的「清空对话历史」按钮处理），也不动用量的会话累计。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const hadSnapshot = hasContextSnapshot()
        setContextSnapshot([])
        return { cleared: hadSnapshot, hasSnapshot: hasContextSnapshot() }
    }
})

defineTool('get_ai_usage', {
    description:
        '读取 AI 助手的 **token 与缓存命中用量**：本轮（turn）合计、本会话（session）累计，含 prompt / completion / total token、缓存命中与未命中 token、缓存命中率、请求数与其中「无服务商 usage、走本地估算回退」的请求数。字段缺失时返回 null（界面显示「—」，绝不臆造），estimatedRequests>0 说明有请求是本地估算值，不能当计费依据。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const last = getLastTurnSummary()
        return {
            turn: usageView(getTurnUsage()),
            session: { ...usageView(getSessionUsage()), turns: getSessionUsage().turns },
            lastTurn: last
                ? {
                      elapsedMs: last.elapsedMs,
                      toolCalls: last.toolCalls,
                      failedTools: last.failedTools,
                      usage: usageView(last.usage),
                      text: summarizeTurn(last)
                  }
                : null,
            hint: 'turn=当前这一轮（本轮开始后从零累计），session=本会话累计（清空对话历史时归零）；cacheHitRate 无法计算时为「—」'
        }
    }
})

defineTool('get_ai_turn_state', {
    description:
        '读取 AI 助手的**实时运行情况**：是否正在请求、当前阶段（思考中 / 收到流式文本 / 正在调用工具 / 等待工具结果 / 空闲）、已耗时、当前工具名与补充说明，以及本轮已发生的工具调用列表（名称 / 参数 / 耗时 / 成败 / 结果梗概）。用于自检卡在哪一步或复盘本轮调用了哪些工具。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const runtime = getTurnRuntime()
        return {
            running: runtime.running,
            phase: runtime.phase,
            phaseText: describeTurnPhase(runtime),
            toolName: runtime.toolName ?? null,
            detail: runtime.detail ?? null,
            elapsedMs: runtime.elapsedMs,
            toolCalls: runtime.toolCalls.map((c) => ({
                name: c.name,
                args: c.args,
                durationMs: c.durationMs ?? null,
                ok: c.ok ?? null,
                summary: c.summary ?? null
            }))
        }
    }
})

defineTool('get_share_cooldown', {
    description:
        '读取工程「分享」的 10 分钟频率限制状态：是否处于冷却中、剩余毫秒与 mm:ss 文案、冷却时长常量。分享本身是上传+本地导出动作，需用户在工程侧边栏右键发起（AI/WS 不代发），本工具只用于告知用户还要等多久。',
    parameters: { type: 'object', properties: {} },
    handler: () => ({
        coolingDown: isShareCoolingDown(),
        remainingMs: shareCooldownRemaining(),
        remainingText: shareCooldownLabel(),
        cooldownMs: SHARE_COOLDOWN_MS,
        cooldownMinutes: SHARE_COOLDOWN_MS / 60000,
        hint: '冷却由「上一次成功分享的时间戳」本地持久化推算，刷新页面依然生效'
    })
})
