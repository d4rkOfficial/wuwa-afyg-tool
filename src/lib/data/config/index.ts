/**
 * @desc 一切皆「配置」：统一配置架构。
 *
 * 所有用户偏好（外观 / 交互 / 渲染 / 拉表视图 / 工具栏 / 右键菜单 / 快捷键 / 按键图标 /
 * 数据源 / 工坊 / AI 助手 / 词条方案 / Buff 库）都看作同一份「配置」的不同分组，
 * 因此可以整体导出为 JSON、导入回填，也可以分组重置。
 *
 * 存储层保持既有实现（localStorage 前缀键 + IndexedDB 键），本模块只提供**统一读写与导入导出**，
 * 不改变各 store 的既有 API，避免一次性重构带来的回归风险。
 */

import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'

/** @desc 配置文件的版本号：后续结构变化时按此做迁移 */
export const CONFIG_VERSION = 1

/** @desc 配置分组（界面按此分组展示与勾选） */
export type ConfigGroup = 'appearance' | 'interaction' | 'data' | 'assistant' | 'library'

export interface ConfigGroupDef {
    id: ConfigGroup
    label: string
    desc: string
}

export const CONFIG_GROUPS: ConfigGroupDef[] = [
    { id: 'appearance', label: '外观', desc: '主题、配色覆盖、背景与质感' },
    { id: 'interaction', label: '交互', desc: '确认弹窗、提示位置、水印、快捷键、按键图标、光标' },
    { id: 'data', label: '数据', desc: '数据源、工坊地址、性能与渲染偏好' },
    { id: 'assistant', label: 'AI 助手', desc: '模型接入、权限、提示词' },
    { id: 'library', label: '本地库', desc: 'Buff 集、词条方案' }
]

/** @desc 一条配置项：localStorage 前缀键 或 IndexedDB 键 */
interface ConfigEntry {
    key: string
    /** @desc local=localStorage 键；idb=IndexedDB 键 */
    store: 'local' | 'idb'
    group: ConfigGroup
    label: string
}

/**
 * @desc 受管配置项清单。
 * 明确**排除**：工程数据（projects）/ 当前工程指针 / 库街区登录态与缓存 / 分享冷却时间戳 / 首次访问标记
 * —— 这些属于会话或本地状态，不属于「设置偏好」，导入导出会带来误导或安全问题。
 */
const CONFIG_ENTRIES: ConfigEntry[] = [
    { key: 'theme-active', store: 'idb', group: 'appearance', label: '当前主题' },
    { key: 'theme-overrides', store: 'idb', group: 'appearance', label: '主题配色覆盖' },
    { key: 'wuwa-afyg:calc-view', store: 'local', group: 'appearance', label: '拉表默认视图' },
    { key: 'wuwa-afyg:calc-scroll-axis', store: 'local', group: 'appearance', label: '默认滚动方向' },
    { key: 'wuwa-afyg:calc-global-buff-collapsed', store: 'local', group: 'appearance', label: '全局 Buff 折叠' },
    { key: 'wuwa-afyg:toolbar-prefs', store: 'local', group: 'appearance', label: '简化工具栏' },
    { key: 'wuwa-afyg:interaction-prefs:confirm-deletes', store: 'local', group: 'interaction', label: '删除二次确认' },
    { key: 'wuwa-afyg:interaction-prefs:toast-position', store: 'local', group: 'interaction', label: '提示位置' },
    { key: 'wuwa-afyg:interaction-prefs:lock-watermark', store: 'local', group: 'interaction', label: '锁定水印' },
    {
        key: 'wuwa-afyg:interaction-prefs:lock-watermark-text',
        store: 'local',
        group: 'interaction',
        label: '水印文案'
    },
    { key: 'wuwa-afyg:interaction-prefs:sidebar-actions', store: 'local', group: 'interaction', label: '侧栏底部操作' },
    {
        key: 'wuwa-afyg:interaction-prefs:multi-entry-expand',
        store: 'local',
        group: 'interaction',
        label: '结果页多条目展开'
    },
    {
        key: 'wuwa-afyg:interaction-prefs:modal-close-position',
        store: 'local',
        group: 'interaction',
        label: '弹窗关闭按钮位置'
    },
    { key: 'wuwa-afyg:context-menu-prefs', store: 'local', group: 'interaction', label: '右键菜单精简' },
    { key: 'wuwa-afyg:render-prefs', store: 'local', group: 'data', label: 'GPU 合成加速' },
    { key: 'wuwa-afyg:render-prefs:reload-result', store: 'local', group: 'data', label: '刷新结果重载数据' },
    { key: 'wuwa-afyg:render-prefs:reload-profile', store: 'local', group: 'data', label: '链阶变动重载数据' },
    { key: 'wuwa-afyg:render-prefs:magnetic', store: 'local', group: 'data', label: '磁力光标' },
    { key: 'wuwa-afyg:data-provider', store: 'local', group: 'data', label: '当前数据源' },
    { key: 'shortcuts', store: 'idb', group: 'interaction', label: '快捷键位' },
    { key: 'keymap', store: 'idb', group: 'interaction', label: '按键图标映射' },
    { key: 'workshop', store: 'idb', group: 'data', label: '工坊地址' },
    { key: 'ai-gen-prefs', store: 'idb', group: 'assistant', label: 'AI 助手偏好与提示词' },
    { key: 'ai-config', store: 'idb', group: 'assistant', label: 'AI 模型接入（含 API Key）' },
    { key: 'buff-library', store: 'idb', group: 'library', label: 'Buff 集' },
    { key: 'substat-plans', store: 'idb', group: 'library', label: '词条方案' }
]

export interface ExportedConfig {
    kind: 'wuwa-afyg-config'
    version: number
    exportedAt: number
    /** @desc 分组 key → 该组内的配置项（key → 值） */
    entries: Record<string, Record<string, unknown>>
    /** @desc 导出时被跳过的项（如未勾选包含 API Key） */
    skipped?: string[]
}

const readLocal = (key: string): unknown => {
    if (!browser) return undefined
    const raw = localStorage.getItem(key)
    if (raw === null) return undefined
    try {
        return JSON.parse(raw)
    } catch {
        // 非 JSON 的旧格式（如 '1'/'0'/纯字符串）按原文返回
        return raw
    }
}

const writeLocal = (key: string, value: unknown): void => {
    if (!browser) return
    if (value === undefined || value === null) {
        localStorage.removeItem(key)
        return
    }
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
}

/** @desc 读取某项配置的当前值（不存在的项返回 undefined） */
export const readConfigEntry = async (entry: ConfigEntry): Promise<unknown> =>
    entry.store === 'local' ? readLocal(entry.key) : ((await dbGet<unknown>(entry.key))?.data ?? undefined)

/** @desc 写入某项配置 */
export const writeConfigEntry = async (entry: ConfigEntry, value: unknown): Promise<void> => {
    if (entry.store === 'local') writeLocal(entry.key, value)
    else await dbSet(entry.key, value)
}

/**
 * @desc 导出完整配置为可下载的 JSON 结构。
 * @param includeApiKey 是否包含 AI API Key（默认不包含，避免明文外泄）
 * @param groups 仅导出这些分组（缺省=全部）
 */
export async function exportConfig(options?: {
    includeApiKey?: boolean
    groups?: ConfigGroup[]
}): Promise<ExportedConfig> {
    const includeApiKey = options?.includeApiKey ?? false
    const groups = options?.groups
    const entries: Record<string, Record<string, unknown>> = {}
    const skipped: string[] = []

    for (const entry of CONFIG_ENTRIES) {
        if (groups && !groups.includes(entry.group)) continue
        if (!includeApiKey && entry.key === 'ai-config') {
            skipped.push(entry.label)
            continue
        }
        const value = await readConfigEntry(entry)
        if (value === undefined) continue
        const bucket = (entries[entry.group] ??= {})
        bucket[entry.key] = value
    }

    return {
        kind: 'wuwa-afyg-config',
        version: CONFIG_VERSION,
        exportedAt: Date.now(),
        entries,
        ...(skipped.length ? { skipped } : {})
    }
}

export class ConfigParseError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ConfigParseError'
    }
}

/** @desc 解析配置文件文本（校验 kind / version），失败抛 ConfigParseError */
export function parseConfigFile(text: string): ExportedConfig {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        throw new ConfigParseError('不是合法的 JSON 文件')
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ConfigParseError('无法识别的配置文件结构')
    }
    const record = raw as Record<string, unknown>
    if (record.kind !== 'wuwa-afyg-config') throw new ConfigParseError('不是本工具的配置文件')
    const version = typeof record.version === 'number' ? record.version : 0
    if (version > CONFIG_VERSION) {
        throw new ConfigParseError(`配置版本（${version}）高于当前工具支持的版本（${CONFIG_VERSION}）`)
    }
    const entries = record.entries
    if (typeof entries !== 'object' || entries === null) throw new ConfigParseError('配置文件缺少 entries')
    return {
        kind: 'wuwa-afyg-config',
        version,
        exportedAt: typeof record.exportedAt === 'number' ? record.exportedAt : Date.now(),
        entries: entries as Record<string, Record<string, unknown>>
    }
}

export interface ConfigImportResult {
    /** @desc 成功写入的配置项数 */
    applied: number
    /** @desc 被忽略的未知键 */
    unknownKeys: string[]
}

/**
 * @desc 导入配置。
 * - `merge`（默认）：只覆盖文件中出现的项，未出现的保持现状
 * - `replace`：文件中未出现的受管项会被清除（回到默认）
 * @param groups 仅应用这些分组（缺省=全部）
 */
export async function importConfig(
    config: ExportedConfig,
    options?: { mode?: 'merge' | 'replace'; groups?: ConfigGroup[] }
): Promise<ConfigImportResult> {
    const mode = options?.mode ?? 'merge'
    const groups = options?.groups
    const incoming = new Map<string, unknown>()
    for (const bucket of Object.values(config.entries ?? {})) {
        if (typeof bucket !== 'object' || bucket === null) continue
        for (const [key, value] of Object.entries(bucket)) incoming.set(key, value)
    }

    const unknownKeys: string[] = []
    let applied = 0
    for (const entry of CONFIG_ENTRIES) {
        if (groups && !groups.includes(entry.group)) continue
        if (incoming.has(entry.key)) {
            await writeConfigEntry(entry, incoming.get(entry.key))
            applied++
        } else if (mode === 'replace') {
            await writeConfigEntry(entry, undefined)
        }
    }
    for (const key of incoming.keys()) {
        if (!CONFIG_ENTRIES.some((e) => e.key === key)) unknownKeys.push(key)
    }
    return { applied, unknownKeys }
}

/** @desc 配置项清单（供界面展示与调试） */
export const listConfigEntries = (): readonly ConfigEntry[] => CONFIG_ENTRIES

/** @desc 按分组统计已存在的配置项数量（界面展示用） */
export async function countConfigEntriesByGroup(): Promise<Record<ConfigGroup, number>> {
    const counts = { appearance: 0, interaction: 0, data: 0, assistant: 0, library: 0 } as Record<ConfigGroup, number>
    for (const entry of CONFIG_ENTRIES) {
        const value = await readConfigEntry(entry)
        if (value !== undefined) counts[entry.group]++
    }
    return counts
}
