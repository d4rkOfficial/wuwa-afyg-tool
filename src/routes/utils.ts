/**
 * @desc `src/routes/+page.svelte` 的**路由级纯函数**（AGENTS §2 / §5.1）。
 *
 * 全部为无副作用纯函数：组件状态（`$state` / `$derived` / `$effect` / 事件处理器）按 AGENTS §2 留在页面里，
 * 这里只做「入参 → 结果」的映射。本文件在 `eslint.config.js` 的 functional-preference 层内
 * （`src/routes/` 下的 `*.utils.ts` / `*.consts.ts` / `*.types.ts` glob），故：箭头函数、只用 `const`、
 * 入参不可重赋值、单表达式一律简洁体（`arrow-body-style: as-needed`）。
 */
import { CLONE_SELECTION_NONE } from './consts'
import type { PhaseSelectionMap, TeamSlots } from './types'
import type { TimelineData } from '$lib/calc/timeline.types'
import type { PhaseKey, Project } from '$lib/types/project'

/** @desc 队伍是否已配置（至少一个槽位同时有角色与武器） */
export const isTeamComplete = (team: TeamSlots): boolean => team.some((s) => s.character !== null && s.weapon !== null)

/** @desc 克隆弹窗的阶段勾选：勾选到 `phase` 为止（含），按阶段顺序累加 */
export const cloneSelectionsUpTo = (order: readonly PhaseKey[], phase: PhaseKey): PhaseSelectionMap => {
    const atIdx = order.indexOf(phase)
    const selections: PhaseSelectionMap = { ...CLONE_SELECTION_NONE }
    for (let i = 0; i < order.length; i++) selections[order[i]] = i <= atIdx
    return selections
}

/** @desc 勾选表里已选的阶段（保持勾选表的键序，供 `cloneProject` 记录要复制的阶段） */
export const selectedPhaseKeys = (selections: PhaseSelectionMap): PhaseKey[] =>
    (Object.entries(selections) as [PhaseKey, boolean][]).filter(([, v]) => v).map(([k]) => k)

/** @desc 工程里出现过的角色名（含锁定队伍的遗留名）：去重后供角色元素预热用 */
export const collectTeamCharacterNames = (projects: readonly Project[]): string[] => {
    const names = new Set<string>()
    for (const p of projects) {
        for (const s of p.team) {
            if (s.character) names.add(s.character)
        }
        if (p.lockedTeamNames) {
            for (const n of p.lockedTeamNames) names.add(n)
        }
    }
    return [...names]
}

/**
 * @desc 工程数据指纹：队伍 + 时间线骨架（引用线/操作块/伤害块数量与首尾 id）+ 拉表数据 + 配置数据。
 * 用途：判断「刷新结果」时数据是否真的变过（未变则跳过逐阶段重挂载）。
 * 入参而非内部读 store：原实现读 `getActiveProject()`，调用点改为 `projectDataFingerprint(getActiveProject())`
 * ——实参在同一时刻求值，语义不变，换来一个可单测的纯函数。
 */
export const projectDataFingerprint = (project: Project | null): string => {
    if (!project) return 'null'
    const tl = project.phases.timeline.data as TimelineData | null
    const tlFp = tl
        ? `${tl.refLines.length}:${tl.opBlocks.length}:${tl.damageBlocks.length}:${tl.damageBlocks[0]?.id ?? ''}:${
              tl.damageBlocks[tl.damageBlocks.length - 1]?.id ?? ''
          }`
        : 'null'
    return JSON.stringify([
        project.team,
        tlFp,
        JSON.stringify(project.phases.calculation.data ?? null),
        JSON.stringify(project.phases.config.data ?? null)
    ])
}
