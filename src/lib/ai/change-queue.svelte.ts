/**
 * @desc AI 变化队列：把「切换工程 / 当前工程四阶段数据的任何变化」记录下来，供 AI 助手在下一轮对话开头
 * 以系统消息形式消费。
 *
 * 设计要点：
 * - 只记录**摘要**（kind + 一句话 + 可选指纹），不保存全量工程数据，避免内存与 token 膨胀
 * - 同帧 / 短窗口内的同 kind 变化合并为一条（防抖），并保留发生次数
 * - 环形上限：超出后丢弃最旧的记录，只保留最近的 N 条
 * - AI 回合开始时 `drain()` 取出并清空，保证同一条变化不会被重复上报
 */

import { browser } from '$app/environment'

export type ChangeKind = 'switch-project' | 'project-created' | 'project-deleted' | 'phase-data' | 'team'

export interface ProjectChange {
    kind: ChangeKind
    /** @desc 一句话描述（直接给 AI 读） */
    summary: string
    /** @desc 环节（phase 变化时填写） */
    phase?: string
    /** @desc 首次发生时间 */
    at: number
    /** @desc 合并窗口内累计发生次数 */
    count: number
}

/** @desc 环形上限：最多保留的变化条数 */
export const MAX_CHANGES = 50
/** @desc 合并窗口（毫秒）：同 kind 的连续变化在该窗口内合并为一条 */
const COALESCE_MS = 1500

let _changes = $state<ProjectChange[]>([])
/** @desc 变化队列版本号（供界面徽标响应式） */
let _version = $state(0)
/** @desc kind → 最后一次入队时间（用于合并窗口判定） */
const _lastAt = new Map<ChangeKind, number>()

const PHASE_LABELS: Record<string, string> = {
    team: '队伍配置',
    timeline: '排轴',
    calculation: '拉表',
    config: '词条/环境'
}

/** @desc 入队一条变化（同 kind 且在合并窗口内则累加计数，不新增条目） */
export function pushChange(kind: ChangeKind, summary: string, phase?: string): void {
    if (!browser) return
    const now = Date.now()
    const last = _lastAt.get(kind)
    const lastItem = _changes[_changes.length - 1]
    if (
        last !== undefined &&
        now - last < COALESCE_MS &&
        lastItem &&
        lastItem.kind === kind &&
        lastItem.phase === phase
    ) {
        _changes = _changes.map((c, i) => (i === _changes.length - 1 ? { ...c, count: c.count + 1, summary } : c))
        _lastAt.set(kind, now)
        _version++
        return
    }
    const next = [..._changes, { kind, summary, phase, at: now, count: 1 }]
    _changes = next.length > MAX_CHANGES ? next.slice(next.length - MAX_CHANGES) : next
    _lastAt.set(kind, now)
    _version++
}

/** @desc 记录「切换当前工程」 */
export function pushProjectSwitch(name: string, id: string): void {
    pushChange('switch-project', `切换到工程「${name}」（${id}）`)
}

/** @desc 记录某环节数据变化（四阶段的任何变化都走这里） */
export function pushPhaseChange(phase: string, detail?: string): void {
    const label = PHASE_LABELS[phase] ?? phase
    pushChange('phase-data', detail ? `${label}数据变化：${detail}` : `${label}数据发生变化`, phase)
}

/** @desc 记录队伍配置变化 */
export function pushTeamChange(detail: string): void {
    pushChange('team', `队伍配置变化：${detail}`)
}

/** @desc 当前待消费的变化（只读，供界面展示徽标） */
export function getPendingChanges(): ProjectChange[] {
    return _changes
}

/** @desc 待消费变化条数（响应式） */
export function getPendingChangeCount(): number {
    const version = _version
    void version
    return _changes.length
}

/** @desc 队列摘要（界面 tooltip 用；不消费队列） */
export function renderPendingSummary(): string {
    if (_changes.length === 0) return ''
    return _changes.map((c) => `${c.summary}${c.count > 1 ? `（×${c.count}）` : ''}`).join('\n')
}

/** @desc 取出并清空队列（AI 回合开始时调用一次） */
export function drainChanges(): ProjectChange[] {
    const drained = _changes
    _changes = []
    _lastAt.clear()
    _version++
    return drained
}

/** @desc 清空队列（切换会话 / 用户手动忽略时调用） */
export function clearChanges(): void {
    _changes = []
    _lastAt.clear()
    _version++
}

/**
 * @desc 把变化队列渲染成注入 AI 的系统消息正文。
 * 返回空串表示没有变化（调用方据此跳过注入）。
 */
export function renderChangesForPrompt(changes: ProjectChange[]): string {
    if (changes.length === 0) return ''
    const lines = changes.map((c) => `- ${c.summary}${c.count > 1 ? `（×${c.count}）` : ''}`)
    return [
        '【自上次对话以来的变化】用户在你这轮回复之后改动了工程状态，请以这些变化为最新事实：',
        ...lines,
        '注意：若上述变化与你记忆中的状态冲突，一律以变化为准；需要细节时用工具重新查询。'
    ].join('\n')
}
