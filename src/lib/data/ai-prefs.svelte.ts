// AI 助手偏好（持久化到 IndexedDB）：是否启用 AI 助手 + AI 助手人设提示词 + 危险操作策略，独立于模型配置保存
// 注：Buff 命名规则与黑话词典已迁为内置技能卡（见 $lib/ai/skills 的 BUILTIN_SKILLS），
//     这里只保留旧字段的读取（LegacyPromptPrefs），供技能卡做一次性迁移。
import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import { DEFAULT_SYSTEM_PROMPT } from '$lib/ai/persona'
import type { LegacyPromptPrefs } from '$lib/ai/skills'

export type DangerMode = 'ask' | 'ask_once' | 'trust'

export interface AiGenPrefs extends LegacyPromptPrefs {
    // 是否启用 AI 助手（悬浮窗显隐）
    enabled: boolean
    // AI 助手人设提示词（system prompt，可自定义覆盖；清空 = 用默认人设）
    systemPrompt: string
    // 危险操作确认策略：ask=每次都询问 / ask_once=一次指令内只询问一次 / trust=无条件信任
    dangerMode: DangerMode
}

const PREFS_KEY = 'ai-gen-prefs'
// 旧版本存储 key（仅 namingRule 字段），首次加载时迁移
const LEGACY_PREFS_KEY = 'ai-naming-prefs'

const DEFAULT_PREFS: AiGenPrefs = {
    // 默认关闭：首次进入隐藏 AI 助手，用户可在设置里开启（开启状态持久化保存）
    enabled: false,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    dangerMode: 'ask'
}

let _prefs: AiGenPrefs = $state({ ...DEFAULT_PREFS })
let _loaded = false

export function getGenPrefs(): AiGenPrefs {
    return _prefs
}

export function getSystemPrompt(): string {
    return _prefs.systemPrompt.trim()
}

export function getDangerMode(): DangerMode {
    return _prefs.dangerMode
}

export async function loadGenPrefs(): Promise<void> {
    if (!browser || _loaded) return
    let stored = await dbGet<Partial<AiGenPrefs>>(PREFS_KEY)
    let migrated = false
    if (!stored?.data) {
        // 旧结构迁移：仅 namingRule
        const legacy = await dbGet<{ namingRule?: string }>(LEGACY_PREFS_KEY)
        if (legacy?.data && typeof legacy.data === 'object') {
            stored = { data: legacy.data as Partial<AiGenPrefs>, ts: legacy.ts }
            migrated = true
        }
    }
    if (stored?.data && typeof stored.data === 'object') {
        const d = stored.data as Record<string, unknown>
        // 兼容旧结构（仅 namingRule / initialTaskPrompt）：字段缺失 → 填充默认值
        const hasLegacyShape = typeof d.initialTaskPrompt === 'string' && typeof d.systemPrompt !== 'string'
        _prefs = {
            enabled: typeof d.enabled === 'boolean' ? d.enabled : DEFAULT_PREFS.enabled,
            systemPrompt:
                typeof d.systemPrompt === 'string' && d.systemPrompt.trim()
                    ? d.systemPrompt
                    : DEFAULT_PREFS.systemPrompt,
            dangerMode:
                d.dangerMode === 'ask_once' || d.dangerMode === 'trust' ? d.dangerMode : DEFAULT_PREFS.dangerMode,
            // 旧字段只读保留：技能卡加载时据此补一次正文覆盖（随后不再使用）
            ...(!hasLegacyShape && typeof d.namingRule === 'string' && d.namingRule.trim()
                ? { namingRule: d.namingRule }
                : {}),
            ...(typeof d.slangDict === 'string' && d.slangDict.trim() ? { slangDict: d.slangDict } : {})
        }
    }
    _loaded = true
    if (migrated) await updateGenPrefs({})
}

export async function updateGenPrefs(patch: Partial<AiGenPrefs>): Promise<void> {
    _prefs = { ..._prefs, ...patch }
    if (browser) await dbSet(PREFS_KEY, _prefs)
}
