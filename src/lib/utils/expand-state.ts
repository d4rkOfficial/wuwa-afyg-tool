/**
 * @desc 结果页「伤害条目展开状态」的选择逻辑（纯函数，无副作用）。
 *
 * 兼容两种模式：
 * - `multi === false`（默认，同时只展开一个）：点未展开项 → 只保留它；点已展开项 → 全部收起。
 * - `multi === true`（设置里开启多开）：点未展开项 → 追加；点已展开项 → 只移除它，其余保留。
 *
 * 入参集合不会被修改（返回新 `Set`），这样 Svelte 的 `$state` 赋值才能触发重渲染。
 */
export const nextExpandedIds = (current: Set<string>, id: string, multi: boolean): Set<string> => {
    if (!multi) return current.has(id) && current.size === 1 ? new Set<string>() : new Set<string>([id])
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
}
