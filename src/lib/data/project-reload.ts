// 活动工程切换后的阶段 store 重载（页面与 AI 工具共用）
import { getCharacterInfo, getEchoInfo } from '$lib/api/data-cache'
import { init as initCalculation, setConditionProfile, setShowBuffModal } from '$lib/calc/calculation.store.svelte'
import type { CalcState } from '$lib/calc/calculation.types'
import { init as initConfig } from '$lib/calc/config.store.svelte'
import type { ConfigState } from '$lib/calc/config.types'
import { init as initTimeline } from '$lib/calc/timeline.store.svelte'
import type { TimelineData } from '$lib/calc/timeline.types'
import { conditionProfileFromTeam } from '$lib/data/migration'
import { getActiveProject, updateCalculation } from '$lib/data/project.svelte'

/** @desc 重载当前工程全部阶段数据（不改变视图状态）；切工程 / 链阶变动 / 刷新结果共用 */
export const reloadActiveProjectStores = (): void => {
    setShowBuffModal(false)
    const p = getActiveProject()
    if (!p) return
    initTimeline(p.phases.timeline.data as TimelineData | null, () => {}, p.team, p.phases.timeline?.locked ?? false)
    // 重建伤害条目（条目由队伍与时间线派生，条件数据随后由 setConditionProfile 注入）
    initCalculation(
        p.team,
        p.phases.timeline.data as TimelineData | null,
        p.phases.calculation.data as CalcState | null,
        p.phases.calculation?.locked ?? false,
        (state) => updateCalculation(state)
    )
    initConfig(p.phases.config.data as ConfigState | null, p.phases.config?.locked ?? false)
    // 预热角色与声骸数据（IndexedDB 缓存）：减少排轴/拉表等阶段首次挂载的异步等待
    for (const slot of p.team) {
        if (slot.character) void getCharacterInfo(slot.character)
        if (slot.echoes?.[0]?.name) void getEchoInfo(slot.echoes[0].name)
    }
    // 恢复工程携带的链/阶配置（链阶真源是工程 team 槽位，此处同步到条件系统的读入口）
    setConditionProfile(conditionProfileFromTeam(p.team))
}
