/**
 * @desc 配置同步弹窗的纯逻辑：选择集合运算 / 快捷范围 / 导入方式解析 / 导出条目计数。
 *  不碰 DOM 与存储，供 `config-sync-modal.svelte` 与单测复用。
 */
import { CONFIG_CATEGORIES, configKeysOfCategory, listConfigEntries, type ConfigCategory } from '$lib/data/config'

/** @desc 导入方式：合并只覆盖文件里出现的项；覆盖会把勾选项里文件中缺失的清空 */
export type ImportMode = 'merge' | 'replace'
export type ScopePreset = 'all' | 'clear' | ConfigCategory

/** @desc 导入方式卡片文案（弹窗右侧「导入」页用） */
export const IMPORT_MODES: { value: ImportMode; label: string; desc: string; icon: string }[] = [
    { value: 'merge', label: '合并', desc: '只覆盖文件里出现的项，其余保持不动', icon: 'mdi:call-merge' },
    { value: 'replace', label: '覆盖', desc: '勾选项里文件中未出现的会被清空（回到默认）', icon: 'mdi:swap-horizontal' }
]

/** @desc 快捷范围按钮文案（顺序即界面顺序） */
export const SCOPE_PRESETS: { value: ScopePreset; label: string }[] = [
    { value: 'all', label: '全选' },
    { value: 'clear', label: '清空' },
    { value: 'settings', label: '仅设置' },
    { value: 'libraries', label: '仅本地库' }
]

/** @desc 导入方式字符串 → 类型（非法值返回 null，供 `ui/tabs` 的 onchange 收窄） */
export const parseImportMode = (value: string): ImportMode | null =>
    value === 'merge' || value === 'replace' ? value : null

/** @desc 一批 key 里被选中的数量 */
export const countSelected = (keys: readonly string[], selected: ReadonlySet<string>): number =>
    keys.reduce((n, key) => n + (selected.has(key) ? 1 : 0), 0)

/** @desc 一批 key 是否全部选中（空集合不算全选） */
export const areAllSelected = (keys: readonly string[], selected: ReadonlySet<string>): boolean =>
    keys.length > 0 && countSelected(keys, selected) === keys.length

/** @desc 部分选中（用于复选框 indeterminate） */
export const isPartiallySelected = (keys: readonly string[], selected: ReadonlySet<string>): boolean => {
    const n = countSelected(keys, selected)
    return n > 0 && n < keys.length
}

/** @desc 返回新的选择集合：把一批 key 全设为选中 / 取消 */
export const withKeysSelected = (selected: ReadonlySet<string>, keys: readonly string[], on: boolean): Set<string> => {
    const next = new Set(selected)
    for (const key of keys) {
        if (on) next.add(key)
        else next.delete(key)
    }
    return next
}

/** @desc 返回新的选择集合：翻转单个 key */
export const withKeyToggled = (selected: ReadonlySet<string>, key: string): Set<string> => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
}

/** @desc 快捷范围 → key 集合（`clear` 返回空集） */
export const keysOfPreset = (preset: ScopePreset): string[] => {
    if (preset === 'clear') return []
    if (preset === 'all') return listConfigEntries().map((e) => e.key)
    return configKeysOfCategory(preset)
}

/** @desc 某大类下已勾选的 key 数量（右侧页头展示用） */
export const selectedCountOfCategory = (category: ConfigCategory, selected: ReadonlySet<string>): number =>
    countSelected(configKeysOfCategory(category), selected)

/** @desc 导出结构里实际写入的条目数（用于「预计写入 N 条」与导出后提示） */
export const countExportedEntries = (config: {
    settings?: Record<string, Record<string, unknown>>
    libraries?: Record<string, Record<string, unknown>>
}): number =>
    [...Object.values(config.settings ?? {}), ...Object.values(config.libraries ?? {})].reduce(
        (n, bucket) => n + Object.keys(bucket).length,
        0
    )

/** @desc 大类标签（按 `CONFIG_CATEGORIES` 顺序取） */
export const categoryLabel = (category: ConfigCategory): string =>
    CONFIG_CATEGORIES.find((c) => c.id === category)?.label ?? category

/** @desc 导出文件名（本地日期即可，避免用户看到 UTC 日期差一天） */
export const exportFileName = (now: Date = new Date()): string => {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `椰果工具箱-配置-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}
