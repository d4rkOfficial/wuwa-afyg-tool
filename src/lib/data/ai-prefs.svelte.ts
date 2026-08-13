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

// share 端命名规范（默认值）：buff 名格式 <归属者> <触发>? <数值+属性黑话> <层数/阶数>?
const SHARE_NAMING_RULES = `buff 名格式（默认遵循工坊风格）：
<归属者> <触发>? <数值+属性黑话> <层数/阶数>?

各部分：
1. 归属者（不带括号，直接写）：
   - 角色：直接写角色名（散华、长离、维里奈）。
   - 武器：直接写武器名或效果名简称。
   - 首位声骸：用「首位+声骸简称」（首位万囮牢、首位云闪）。
   - 套装：套装简称+件数（不绝2、冥途5、隐世5件），或「XX套」（命理套、盾套）。
   - 角色/武器门槛：需要某角色 ≥N 链或武器 ≥N 阶才生效时，后缀标注（散[3链]、赫奕3阶，与 condition 对应）。
2. 触发短语（居中；常驻/无条件触发的增益可省略，归属者后直接跟数值）：
   - 触发动作+条件，用「后/时/内/下/中」收尾：E后、R后、Q后、开大后、变奏后、幻形后、A/Z后、追击命中后。
   - 状态条件：在场、叠盾、满层、领域内、0能量、挂虚湮后、目标带虚湮效应、目标光噪10层。
   - 多条件用「,」分隔（共解出伤,清除落雪）；复合触发用「+」连接（重击+声骸）。
   - 附加效果用「追加」：追加10气动、追加转模攻击。
3. 数值+属性黑话（触发之后，数字直接拼属性）：
   - 数字+属性：10攻击、12热熔、22.5冷凝、30全增伤、80协同、12共解、20暴伤。
   - 全队作用在数值前加「全队」：全队15攻击、全队20增幅、全队10冷凝。
   - 多乘区合并用「+」或空格：攻击+暴伤、20热熔暴击 20热熔、30气动暴伤 30气动。
   - 属性黑话见 get_slang_dict（共解=共鸣解放、共技=共鸣技能、共效=共鸣效率、暴伤=暴击伤害、增伤(X)、加深(X)…）。
4. 层数/阶数（末尾）：
   - 叠层 >1：带「N层」，每层一条（暴击1层、暴击2层…）；单层不带「1层」。
   - 武器精炼按阶拆分：带「N阶」（赫奕1阶…赫奕5阶）。
   - 无法自动确定的用括号备注：双极律动 增伤6层（请根据实际层数修改）。

叠层拆分（必须填增量，不是累计值）：
- 同一增益分多层/多阶生效（如"每层+5%，可叠4层""可叠加2层"），拆成多条独立 buff，buff 名用层数区分（XXXX1层、XXXX2层…）。
- 每层 value 填"该层的新增数值"：第 n 层 = 第 n 层效果值 − 第 n-1 层效果值。
  例：1/2/3 层效果为 20/40/80 → 1层=20、2层=20、3层=40；每层+5%可叠4层 → 各层都填 5。
- 原因：工具箱把各层 buff 全部叠加计算，只有填增量才能得到正确累计值。
- 武器精炼按阶拆分同理：1-5 阶各填该阶增量（见 get_condition_rules 的武器精炼规则）。

示例（真实库内风格）：
- 散华固有攻击（合并 7.8%）→ 散 7.8攻击
- 散华 3 链共鸣链第5段普攻自身暴击 → 散[3链] 第5段普攻后 15暴击
- 长离共鸣技能热熔增伤 → 长离 E后 12热熔
- 维里奈共鸣链重击全队衍射增伤 → 维里奈 重击后 全队10衍射
- 隐世 5 件治疗触发全队攻击 → 隐世5件 治疗友方 全队15攻击
- 曙色天光可叠 2 层（每层 10%）→ 拆两条：散 引爆冰棱后 全队攻击1层（10）+ 散 引爆冰棱后 全队攻击2层（10，增量）
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
