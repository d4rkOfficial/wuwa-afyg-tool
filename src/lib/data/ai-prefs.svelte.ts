// AI 生成偏好（持久化到 IndexedDB）：是否启用 AI 助手 + Buff 命名规则 + 黑话词典 + AI 助手人设提示词，独立于模型配置保存
import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import { DEFAULT_SYSTEM_PROMPT } from '$lib/ai/persona'
import { DEFAULT_SLANG_DICT } from '$lib/ai/generate/prompts.config'

export type DangerMode = 'ask' | 'ask_once' | 'trust'

export interface AiGenPrefs {
    // 是否启用 AI 助手（悬浮窗显隐）
    enabled: boolean
    // 用户自定义的 Buff 命名规则（默认使用工坊 share 端风格；清空 = 生成前由 AI 询问用户）
    namingRule: string
    // 用户自定义的黑话词典（官方/生僻叫法 → 玩家黑话；清空 = 用默认词典）
    slangDict: string
    // AI 助手人设提示词（system prompt，可自定义覆盖；清空 = 用默认人设）
    systemPrompt: string
    // 危险操作确认策略：ask=每次都询问 / ask_once=一次指令内只询问一次 / trust=无条件信任
    dangerMode: DangerMode
}

// share 端命名规范（默认值）：对齐工坊批量改名脚本 STYLE_RULES——
// <归属者><链数> <触发>? <效果词条> <N层/N阶>?（武器/角色名不写数值，数值由 zones 承载）
const SHARE_NAMING_RULES = `buff 名格式（默认遵循工坊风格，对齐批量改名脚本）：
<归属者><链数> <触发>? <效果词条> <N层/N阶>?

各部分：
1. 归属者：
   - 角色：用玩家黑话短名（散华→散、长离→离、卡卡罗→卡、维里奈→维），链数紧跟短名放开头（散6链、卡4链）；短名未定的由 AI 拟 1-2 字简称。
   - 武器：用全名，精炼阶数放末尾（万物持存的注释 … 1阶）。
   - 首位声骸：首位+声骸简称（首位万囮牢、首位云闪）。
   - 套装：套装简称+件数（不绝2、冥途5、隐世5件）或「XX套」（命理套、盾套）。
2. 触发条件：保留但简写，动作后带「时」或「后」（施放X→X时，达成Y→Y后）；「延奏/变奏」作为动作时不带时/后（如「延奏」「延奏登场」）。
3. 常驻/无条件增益：省略触发段，直接写效果。
4. 效果词条：保留原语义与写法——攻击/暴击率/暴击伤害/增伤(属性)/加深(类型)/无视防御/穿防/倍率提升…；全队+/队友+ 前缀、层数（N层）均保留。
5. 名字里必须能看出：谁（短名/武器全名）、什么条件触发（如有）、加什么。
6. 武器/角色名不写数值（数值由 zones 承载）；首位声骸/套装的简单加成可附数值（首位万囮牢 12热熔、不绝2 10攻击）。只改名字，不改任何数值。

叠层拆分（必须填增量，不是累计值）：
- 同一增益分多层/多阶生效（如"每层+5%，可叠4层""可叠加2层"），拆成多条独立 buff，buff 名用层数区分（XXXX1层、XXXX2层…）。
- 每层 value 填"该层的新增数值"：第 n 层 = 第 n 层效果值 − 第 n-1 层效果值。
  例：1/2/3 层效果为 20/40/80 → 1层=20、2层=20、3层=40；每层+5%可叠4层 → 各层都填 5。
- 原因：工具箱把各层 buff 全部叠加计算，只有填增量才能得到正确累计值。
- 武器精炼按阶拆分同理：1-5 阶各填该阶增量（见 get_condition_rules 的武器精炼规则）。

示例（真实库内风格）：
- 散华固有攻击（合并 7.8%）→ 散 攻击
- 散华 6 链第5段普攻自身暴击 → 散6链 第5段普攻时 暴击率
- 长离共鸣技能热熔增伤 → 离 共鸣技能时 增伤(热熔)
- 维里奈重击全队衍射增伤 → 维 重击时 全队+增伤(衍射)
- 隐世 5 件治疗触发全队攻击 → 隐世5件 治疗友方时 全队+攻击
- 万物持存的注释 变奏/共解时 增伤(共解) 1阶
- 曙色天光可叠 2 层 → 拆两条：散 引爆冰棱后 全队+攻击1层 / 散 引爆冰棱后 全队+攻击2层
- 复杂条件/多段联动无法清晰表达时，直接保留游戏原 buff 文案作为 buff 名。`

const PREFS_KEY = 'ai-gen-prefs'
// 旧版本存储 key（仅 namingRule 字段），首次加载时迁移
const LEGACY_PREFS_KEY = 'ai-naming-prefs'

const DEFAULT_PREFS: AiGenPrefs = {
    enabled: true,
    namingRule: SHARE_NAMING_RULES,
    slangDict: DEFAULT_SLANG_DICT,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    dangerMode: 'ask'
}

let _prefs: AiGenPrefs = $state({ ...DEFAULT_PREFS })
let _loaded = false

export function getGenPrefs(): AiGenPrefs {
    return _prefs
}

export function getNamingRule(): string {
    return _prefs.namingRule.trim()
}

export function getSlangDict(): string {
    return _prefs.slangDict.trim()
}

export function getSystemPrompt(): string {
    return _prefs.systemPrompt.trim()
}

export function getDangerMode(): DangerMode {
    return _prefs.dangerMode
}

/** 各提示词字段的默认值（供弹窗「恢复默认」使用） */
export function defaultPrefsValue(kind: 'naming' | 'persona' | 'slang'): string {
    if (kind === 'naming') return DEFAULT_PREFS.namingRule
    if (kind === 'persona') return DEFAULT_PREFS.systemPrompt
    return DEFAULT_PREFS.slangDict
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
            namingRule:
                typeof d.namingRule === 'string' && d.namingRule.trim()
                    ? d.namingRule
                    : hasLegacyShape
                      ? ''
                      : DEFAULT_PREFS.namingRule,
            slangDict: typeof d.slangDict === 'string' && d.slangDict.trim() ? d.slangDict : DEFAULT_PREFS.slangDict,
            systemPrompt:
                typeof d.systemPrompt === 'string' && d.systemPrompt.trim()
                    ? d.systemPrompt
                    : DEFAULT_PREFS.systemPrompt,
            dangerMode:
                d.dangerMode === 'ask_once' || d.dangerMode === 'trust' ? d.dangerMode : DEFAULT_PREFS.dangerMode
        }
    }
    _loaded = true
    if (migrated) await updateGenPrefs({})
}

export async function updateGenPrefs(patch: Partial<AiGenPrefs>): Promise<void> {
    _prefs = { ..._prefs, ...patch }
    if (browser) await dbSet(PREFS_KEY, _prefs)
}
