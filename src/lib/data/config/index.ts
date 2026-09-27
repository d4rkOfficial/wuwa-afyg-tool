/**
 * @desc 一切皆「配置」：统一配置架构。
 *
 * 全部用户偏好与自建库数据都是同一份「配置」的不同分组，因此可以整体导出为 JSON、导入回填，
 * 也可以按分组重置。
 *
 * ## 两大类（{@link ConfigCategory}）
 * - `settings`（设置）：外观 / 交互 / 数据 / AI 助手等**偏好类**，导入后直接改变使用习惯；
 * - `libraries`（本地库）：Buff 集、词条方案（含标准词条集）、自定义技能等**自建库数据**。
 *
 * ## 导出文件结构（v2）
 * ```json
 * {
 *   "kind": "wuwa-afyg-config",
 *   "version": 2,
 *   "exportedAt": 1700000000000,
 *   "settings":  { "appearance": { "theme-active": "dark" }, "interaction": { "...": "..." } },
 *   "libraries": { "library": { "buff-library": [] } },
 *   "skipped": ["AI 模型接入（含 API Key）"]
 * }
 * ```
 * 顶层按两大类拆成 `settings` / `libraries` 两个对象，各自再以「分组 id → 配置键 → 值」组织：
 * 结构稳定（即使某一大类没有条目也保留空对象），新增分组只需在 {@link CONFIG_GROUPS} 与
 * {@link CONFIG_ENTRY_SPEC} 各登记一行，导出 / 导入 / 计数自动跟随。
 *
 * ## 兼容旧文件
 * v1 及更早的导出是**扁平的** `entries: { 分组: { 键: 值 } }`（没有分类字段）。
 * {@link parseConfigFile} 会把这种文件按 {@link CONFIG_ENTRIES} 的登记信息（分组 → 大类）重新归类，
 * 因此旧文件依然可以导入，导入后重新导出即为新格式。
 *
 * 存储层保持既有实现（localStorage 前缀键 + IndexedDB 键），本模块只提供**统一读写与导入导出**，
 * 不改变各 store 的既有 API，避免一次性重构带来的回归风险。
 */

import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'

/** @desc 配置文件的版本号：后续结构变化时按此做迁移（v2 = 按「设置 / 本地库」两大类拆分） */
export const CONFIG_VERSION = 2

/** @desc 配置大类：设置（偏好）/ 本地库（自建数据） */
export type ConfigCategory = 'settings' | 'libraries'

export interface ConfigCategoryDef {
    id: ConfigCategory
    label: string
    desc: string
}

/** @desc 两大类（界面按此分组展示与勾选） */
export const CONFIG_CATEGORIES: ConfigCategoryDef[] = [
    { id: 'settings', label: '设置', desc: '外观、交互、数据源、性能、AI 助手等偏好' },
    { id: 'libraries', label: '本地库', desc: 'Buff 集、词条方案（含标准词条集）、自定义技能' }
]

/** @desc 配置分组（界面按此分组展示与勾选） */
export type ConfigGroup = 'appearance' | 'interaction' | 'data' | 'assistant' | 'library'

export interface ConfigGroupDef {
    id: ConfigGroup
    label: string
    desc: string
    /** @desc 该分组属于哪一大类（**分类的单一真源**：条目分类由此派生） */
    category: ConfigCategory
}

export const CONFIG_GROUPS: ConfigGroupDef[] = [
    { id: 'appearance', label: '外观', desc: '主题、配色覆盖、背景与质感', category: 'settings' },
    {
        id: 'interaction',
        label: '交互',
        desc: '确认弹窗、提示位置、水印、快捷键、按键图标、光标',
        category: 'settings'
    },
    { id: 'data', label: '数据', desc: '数据源、工坊地址、性能与渲染偏好', category: 'settings' },
    { id: 'assistant', label: 'AI 助手', desc: '模型接入、权限、提示词', category: 'settings' },
    {
        id: 'library',
        label: '本地库',
        desc: 'Buff 集、词条方案（含标准词条集）、自定义技能',
        category: 'libraries'
    }
]

const GROUP_BY_ID = new Map(CONFIG_GROUPS.map((g) => [g.id, g] as const))

/** @desc 分组所属大类（未登记的分组按「设置」兜底） */
export const categoryOfGroup = (group: ConfigGroup): ConfigCategory => GROUP_BY_ID.get(group)?.category ?? 'settings'

/** @desc 某大类下的全部分组（保持 `CONFIG_GROUPS` 声明顺序） */
export const groupsOfCategory = (category: ConfigCategory): ConfigGroupDef[] =>
    CONFIG_GROUPS.filter((g) => g.category === category)

/** @desc 一条配置项：localStorage 前缀键 或 IndexedDB 键 */
export interface ConfigEntry {
    key: string
    /** @desc local=localStorage 键；idb=IndexedDB 键 */
    store: 'local' | 'idb'
    group: ConfigGroup
    /** @desc 所属大类（由所在分组派生，见 {@link categoryOfGroup}） */
    category: ConfigCategory
    label: string
}

/** @desc 登记表里的一行：分组与分类由所在的登记位置决定 */
type ConfigEntrySpec = Omit<ConfigEntry, 'group' | 'category'>

/**
 * @desc 配置项登记表（按分组组织）：新增条目只要在对应分组下加一行，
 * 分组与「设置 / 本地库」分类由 {@link CONFIG_GROUPS} 自动补齐，不会漏项。
 *
 * 明确**排除**：工程数据（projects）/ 当前工程指针 / 库街区登录态与缓存 / 分享冷却时间戳 /
 * 首次访问标记 —— 这些属于会话或本地状态，不属于「配置」，导入导出会带来误导或安全问题。
 */
const CONFIG_ENTRY_SPEC: Record<ConfigGroup, ConfigEntrySpec[]> = {
    appearance: [
        { key: 'theme-active', store: 'idb', label: '当前主题' },
        { key: 'theme-overrides', store: 'idb', label: '主题配色覆盖' },
        { key: 'wuwa-afyg:calc-view', store: 'local', label: '拉表默认视图' },
        { key: 'wuwa-afyg:calc-scroll-axis', store: 'local', label: '默认滚动方向' },
        { key: 'wuwa-afyg:calc-global-buff-collapsed', store: 'local', label: '全局 Buff 折叠' },
        { key: 'wuwa-afyg:toolbar-prefs', store: 'local', label: '简化工具栏' }
    ],
    interaction: [
        { key: 'wuwa-afyg:interaction-prefs:confirm-deletes', store: 'local', label: '删除二次确认' },
        { key: 'wuwa-afyg:interaction-prefs:toast-position', store: 'local', label: '提示位置' },
        { key: 'wuwa-afyg:interaction-prefs:lock-watermark', store: 'local', label: '锁定水印' },
        { key: 'wuwa-afyg:interaction-prefs:lock-watermark-text', store: 'local', label: '水印文案' },
        { key: 'wuwa-afyg:interaction-prefs:sidebar-actions', store: 'local', label: '侧栏底部操作' },
        { key: 'wuwa-afyg:interaction-prefs:multi-entry-expand', store: 'local', label: '结果页多条目展开' },
        { key: 'wuwa-afyg:interaction-prefs:modal-close-position', store: 'local', label: '弹窗关闭按钮位置' },
        { key: 'wuwa-afyg:context-menu-prefs', store: 'local', label: '右键菜单精简' },
        { key: 'shortcuts', store: 'idb', label: '快捷键位' },
        { key: 'keymap', store: 'idb', label: '按键图标映射' }
    ],
    data: [
        { key: 'wuwa-afyg:render-prefs', store: 'local', label: 'GPU 合成加速' },
        { key: 'wuwa-afyg:render-prefs:reload-result', store: 'local', label: '刷新结果重载数据' },
        { key: 'wuwa-afyg:render-prefs:reload-profile', store: 'local', label: '链阶变动重载数据' },
        { key: 'wuwa-afyg:render-prefs:magnetic', store: 'local', label: '磁力光标' },
        { key: 'wuwa-afyg:data-provider', store: 'local', label: '当前数据源' },
        { key: 'workshop', store: 'idb', label: '工坊地址' }
    ],
    assistant: [
        { key: 'ai-gen-prefs', store: 'idb', label: 'AI 助手偏好与提示词' },
        { key: 'ai-config', store: 'idb', label: 'AI 模型接入（含 API Key）' }
    ],
    library: [
        { key: 'buff-library', store: 'idb', label: 'Buff 集' },
        { key: 'substat-plans', store: 'idb', label: '词条方案 / 标准词条集' },
        { key: 'ai-skills', store: 'idb', label: '自定义技能' }
    ]
}

/** @desc 受管配置项清单（登记表展平：分类与分组字段自动补齐，单一真源） */
const CONFIG_ENTRIES: ConfigEntry[] = CONFIG_GROUPS.flatMap((g) =>
    CONFIG_ENTRY_SPEC[g.id].map((spec) => ({ ...spec, group: g.id, category: g.category }))
)

const ENTRY_BY_KEY = new Map(CONFIG_ENTRIES.map((e) => [e.key, e] as const))

export interface ExportedConfig {
    kind: 'wuwa-afyg-config'
    version: number
    exportedAt: number
    /** @desc 设置类：分组 id → 该组内的配置项（键 → 值） */
    settings: Record<string, Record<string, unknown>>
    /** @desc 本地库类：分组 id → 该组内的配置项（键 → 值） */
    libraries: Record<string, Record<string, unknown>>
    /** @desc 导出时被跳过的项（如未勾选包含 API Key） */
    skipped?: string[]
}

/** @desc 「文件里有什么」的摘要（导入预览用） */
export interface ConfigSummaryEntry {
    key: string
    /** @desc 登记表中的名称；未登记的键回落为键名 */
    label: string
    /** @desc 是否为登记表已知条目（未知键导入时会被忽略） */
    known: boolean
}

export interface ConfigSummaryGroup {
    id: string
    label: string
    entries: ConfigSummaryEntry[]
}

export interface ConfigSummaryCategory {
    id: ConfigCategory
    label: string
    desc: string
    groups: ConfigSummaryGroup[]
    /** @desc 该大类下的条目总数 */
    count: number
}

export interface ConfigSummary {
    categories: ConfigSummaryCategory[]
    /** @desc 文件中未登记的键（导入时忽略） */
    unknownKeys: string[]
    /** @desc 文件中的条目总数 */
    count: number
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

/** @desc 空的两大类桶（导出/解析共用的稳定结构） */
const emptyCategoryBuckets = (): Record<ConfigCategory, Record<string, Record<string, unknown>>> => ({
    settings: {},
    libraries: {}
})

/**
 * @desc 导出完整配置为可下载的 JSON 结构（始终为新格式 v{@link CONFIG_VERSION}）。
 * @param includeApiKey 是否包含 AI API Key（默认不包含，避免明文外泄）
 * @param groups 仅导出这些分组（缺省=全部）
 */
export const exportConfig = async (options?: {
    includeApiKey?: boolean
    groups?: ConfigGroup[]
}): Promise<ExportedConfig> => {
    const includeApiKey = options?.includeApiKey ?? false
    const groups = options?.groups
    const buckets = emptyCategoryBuckets()
    const skipped: string[] = []

    for (const entry of CONFIG_ENTRIES) {
        if (groups && !groups.includes(entry.group)) continue
        if (!includeApiKey && entry.key === 'ai-config') {
            skipped.push(entry.label)
            continue
        }
        const value = await readConfigEntry(entry)
        if (value === undefined) continue
        const bucket = (buckets[entry.category][entry.group] ??= {})
        bucket[entry.key] = value
    }

    return {
        kind: 'wuwa-afyg-config',
        version: CONFIG_VERSION,
        exportedAt: Date.now(),
        settings: buckets.settings,
        libraries: buckets.libraries,
        ...(skipped.length ? { skipped } : {})
    }
}

export class ConfigParseError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ConfigParseError'
    }
}

/** @desc 解析结果：旧格式文件被升级后会带上 `legacyVersion`，供界面提示 */
export interface ParsedConfig extends ExportedConfig {
    /** @desc 来源是旧格式（扁平 entries、无分类字段）时记录其版本号 */
    legacyVersion?: number
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

/** @desc 文件里的某一大类桶（非法结构一律按空处理） */
const coerceBuckets = (value: unknown, field: string): Record<string, Record<string, unknown>> => {
    if (value === undefined || value === null) return {}
    if (!isPlainObject(value)) throw new ConfigParseError(`配置文件 ${field} 字段结构异常`)
    const out: Record<string, Record<string, unknown>> = {}
    for (const [group, bucket] of Object.entries(value)) {
        if (!isPlainObject(bucket)) continue
        out[group] = bucket as Record<string, unknown>
    }
    return out
}

/**
 * @desc 把旧格式（扁平 `entries: { 分组: { 键: 值 } }`）按登记表归类到两类。
 * 已知键以其登记的分组/分类为准（旧文件里放错分组也能纠正），未知键沿用原分组、
 * 分组也未知时归入「设置」，以便导入时报为未知项而不是静默丢弃。
 */
const classifyLegacyBuckets = (
    legacy: Record<string, unknown>
): Record<ConfigCategory, Record<string, Record<string, unknown>>> => {
    const out = emptyCategoryBuckets()
    for (const [group, bucket] of Object.entries(legacy)) {
        if (!isPlainObject(bucket)) continue
        for (const [key, value] of Object.entries(bucket)) {
            const registered = ENTRY_BY_KEY.get(key)
            const category = registered?.category ?? GROUP_BY_ID.get(group as ConfigGroup)?.category ?? 'settings'
            const target = (out[category][registered?.group ?? group] ??= {})
            target[key] = value
        }
    }
    return out
}

/**
 * @desc 解析配置文件文本（校验 kind / version），失败抛 {@link ConfigParseError}。
 * 新格式（v2：`settings` / `libraries`）原样读取；旧格式（v1：扁平 `entries`）按登记表归类升级，
 * 返回的始终是新格式结构，因此「导入旧文件 → 重新导出」自然产出新格式。
 */
export const parseConfigFile = (text: string): ParsedConfig => {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        throw new ConfigParseError('不是合法的 JSON 文件')
    }
    if (!isPlainObject(raw)) throw new ConfigParseError('无法识别的配置文件结构')
    const record = raw
    if (record.kind !== 'wuwa-afyg-config') throw new ConfigParseError('不是本工具的配置文件')
    const version = typeof record.version === 'number' ? record.version : 0
    if (version > CONFIG_VERSION) {
        throw new ConfigParseError(`配置版本（${version}）高于当前工具支持的版本（${CONFIG_VERSION}）`)
    }
    const exportedAt = typeof record.exportedAt === 'number' ? record.exportedAt : Date.now()

    const hasNewShape = record.settings !== undefined || record.libraries !== undefined
    if (hasNewShape) {
        const settings = coerceBuckets(record.settings, 'settings')
        const libraries = coerceBuckets(record.libraries, 'libraries')
        // 兜底：新格式文件里若还残留旧的扁平 entries，同样按登记表归类，避免静默丢数据
        const residue = isPlainObject(record.entries) ? classifyLegacyBuckets(record.entries) : null
        if (residue) {
            for (const [group, bucket] of Object.entries(residue.settings))
                Object.assign((settings[group] ??= {}), bucket)
            for (const [group, bucket] of Object.entries(residue.libraries))
                Object.assign((libraries[group] ??= {}), bucket)
        }
        return { kind: 'wuwa-afyg-config', version, exportedAt, settings, libraries }
    }

    // 旧格式：扁平的 entries（可能同时带 groups 别名），按登记表归类到两类
    const legacy = isPlainObject(record.entries) ? record.entries : isPlainObject(record.groups) ? record.groups : null
    if (!legacy) throw new ConfigParseError('配置文件缺少 settings / libraries（或旧版 entries）')
    return {
        kind: 'wuwa-afyg-config',
        version: CONFIG_VERSION,
        exportedAt,
        ...classifyLegacyBuckets(legacy),
        legacyVersion: version
    }
}

/** @desc 展开配置文件中的全部条目（不区分分组/大类） */
const flattenConfigValues = (config: ExportedConfig): Map<string, unknown> => {
    const incoming = new Map<string, unknown>()
    const buckets = { settings: config.settings ?? {}, libraries: config.libraries ?? {} }
    for (const category of Object.values(buckets)) {
        for (const bucket of Object.values(category)) {
            if (!isPlainObject(bucket)) continue
            for (const [key, value] of Object.entries(bucket)) incoming.set(key, value)
        }
    }
    return incoming
}

/**
 * @desc 汇总文件内容（导入预览用）：「文件里有什么」。
 * 大类按 {@link CONFIG_CATEGORIES} 顺序，分组按登记顺序（未知分组追加在后），
 * 每条都带上登记表里的名称与是否已知。
 */
export const summarizeConfig = (config: ExportedConfig): ConfigSummary => {
    const buckets = { settings: config.settings ?? {}, libraries: config.libraries ?? {} }
    const unknownKeys: string[] = []
    const categories = CONFIG_CATEGORIES.map((cat) => {
        const present = Object.keys(buckets[cat.id] ?? {})
        const known = CONFIG_GROUPS.filter((g) => g.category === cat.id && present.includes(g.id)).map((g) => g.id)
        const unknown = present.filter((id) => !GROUP_BY_ID.has(id as ConfigGroup))
        const groups: ConfigSummaryGroup[] = [...known, ...unknown].map((id) => ({
            id,
            label: GROUP_BY_ID.get(id as ConfigGroup)?.label ?? id,
            entries: Object.keys(buckets[cat.id]?.[id] ?? {}).map((key) => {
                const registered = ENTRY_BY_KEY.get(key)
                if (!registered) unknownKeys.push(key)
                return { key, label: registered?.label ?? key, known: registered !== undefined }
            })
        }))
        return {
            id: cat.id,
            label: cat.label,
            desc: cat.desc,
            groups,
            count: groups.reduce((n, g) => n + g.entries.length, 0)
        }
    })
    return { categories, unknownKeys, count: categories.reduce((n, c) => n + c.count, 0) }
}

export interface ConfigImportResult {
    /** @desc 成功写入的配置项数 */
    applied: number
    /** @desc 被忽略的未知键 */
    unknownKeys: string[]
}

/**
 * @desc 导入配置（新旧格式皆可：旧格式已在 {@link parseConfigFile} 里升级为新结构）。
 * - `merge`（默认）：只覆盖文件中出现的项，未出现的保持现状
 * - `replace`：文件中未出现的受管项会被清除（回到默认）
 * @param groups 仅应用这些分组（缺省=全部）
 */
export const importConfig = async (
    config: ExportedConfig,
    options?: { mode?: 'merge' | 'replace'; groups?: ConfigGroup[] }
): Promise<ConfigImportResult> => {
    const mode = options?.mode ?? 'merge'
    const groups = options?.groups
    const incoming = flattenConfigValues(config)

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
        if (!ENTRY_BY_KEY.has(key)) unknownKeys.push(key)
    }
    return { applied, unknownKeys }
}

/** @desc 配置项清单（供界面展示与调试） */
export const listConfigEntries = (): readonly ConfigEntry[] => CONFIG_ENTRIES

/** @desc 查某项配置在登记表中的信息（未登记返回 undefined） */
export const findConfigEntry = (key: string): ConfigEntry | undefined => ENTRY_BY_KEY.get(key)

/** @desc 按分组统计已存在的配置项数量（界面展示用） */
export const countConfigEntriesByGroup = async (): Promise<Record<ConfigGroup, number>> => {
    const counts = Object.fromEntries(CONFIG_GROUPS.map((g) => [g.id, 0])) as Record<ConfigGroup, number>
    for (const entry of CONFIG_ENTRIES) {
        const value = await readConfigEntry(entry)
        if (value !== undefined) counts[entry.group]++
    }
    return counts
}

/** @desc 按大类汇总分组计数（界面展示「设置 / 本地库」的总项数用） */
export const sumCountsByCategory = (counts: Record<ConfigGroup, number>): Record<ConfigCategory, number> => {
    const out = Object.fromEntries(CONFIG_CATEGORIES.map((c) => [c.id, 0])) as Record<ConfigCategory, number>
    for (const group of CONFIG_GROUPS) out[group.category] += counts[group.id] ?? 0
    return out
}
