/**
 * @desc AI 写工具的**环节锁定**守卫。
 *
 * 为什么需要：store 的写函数在锁定时只做 `assertUnlocked()` 并静默返回 false/undefined，
 * 工具层若忽略返回值就会把「没写入」报告成 `ok: true` —— AI 会据此得出错误结论。
 * 这里在工具执行入口统一拦一次，锁定环节的写操作直接返回可读错误。
 */
import { getActiveProject, isPhaseReadonly } from '$lib/data/project.svelte'

export type GuardedPhase = 'timeline' | 'calculation' | 'config'

const PHASE_LABELS: Record<GuardedPhase, string> = {
    timeline: '排轴',
    calculation: '拉表',
    config: '词条/环境配置'
}

export const assertPhaseEditable = (phase: GuardedPhase): void => {
    const project = getActiveProject()
    if (!project) throw new Error('当前没有活动工程')
    if (isPhaseReadonly(project, phase)) {
        throw new Error(`${PHASE_LABELS[phase]}环节已锁定，请先解锁后再写入`)
    }
}
