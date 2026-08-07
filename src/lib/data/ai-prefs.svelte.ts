// AI 生成偏好（持久化到 IndexedDB）：Buff 命名规则 + AI 助手人设提示词，独立于模型配置保存
import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import { DEFAULT_SYSTEM_PROMPT } from '$lib/ai/persona'

export interface AiGenPrefs {
    // 用户自定义的 Buff 命名规则（默认使用工坊 share 端风格；清空 = 生成前由 AI 询问用户）
    namingRule: string
    // AI 助手人设提示词（system prompt，可自定义覆盖；清空 = 用默认人设）
    systemPrompt: string
}

// share 端命名规范（默认值）：buff 名格式 [条件]<触发,附加条件>乘区1+乘区2+…+乘区n+层数
const SHARE_NAMING_RULES = `buff 名格式（默认遵循工坊风格）：
[条件]<触发,附加条件>乘区1+乘区2+…+乘区n+层数

各部分：
1. 条件（方括号内，按 condition/实体如实标注，用「,」分隔）：
   - 谁：buff 归属者名称。角色用玩家黑话简称（散华→散、长离→离、卡卡罗→卡、维里奈→维，可在黑话词典补充）；武器用效果名或简称；声骸套装用简称+件数（隐世回光→隐世5件）。
   - 某某角色[N链]：该 buff 需某角色 ≥N 链才生效时标注（与 condition.chain 对应）。
   - 某某武器N阶：该 buff 需某武器 ≥N 阶精炼才生效时标注（与 condition.refinement 对应）。
2. 触发（尖括号内）：
   - 做什么：触发动作（普攻/重击/共鸣技能/共鸣解放/声骸技能/谐度破坏/治疗/造成伤害…）。
   - 满足什么（可选）：附加触发条件（如 目标生命低于70%、引爆【冰棱】、施放第5段普攻），用「,」接在动作后。
   - 常驻/无条件触发的增益可省略尖括号。
3. 乘区：受影响的乘区黑话简称，多个用「+」连接（如 暴击率、暴击伤害、攻击、增伤(热熔)、加深、穿抗…）。
   - 作用对象在 scope 中体现：self/team 等，名字里体现"全队"等仅当 scope 为 team/self_except 时。
4. 层数：仅叠层 >1 时在末尾带「N层」（每层一条，用层数区分）；单层不带「1层」。

叠层拆分（必须填增量，不是累计值）：
- 同一增益分多层/多阶生效（如"每层+5%，可叠4层""可叠加2层"），拆成多条独立 buff，buff 名用层数区分（XXXX1层、XXXX2层…）。
- 每层 value 填"该层的新增数值"：第 n 层 = 第 n 层效果值 − 第 n-1 层效果值。
  例：1/2/3 层效果为 20/40/80 → 1层=20、2层=20、3层=40；每层+5%可叠4层 → 各层都填 5。
- 原因：工具箱把各层 buff 全部叠加计算，只有填增量才能得到正确累计值。
- 武器精炼按阶拆分同理：1-5 阶各填该阶增量（见 get_condition_rules 的武器精炼规则）。

示例（真实数据）：
- 散华固有攻击（合并 7.8%）→ [散]<常驻>攻击
- 散华 3 链命座自身暴击 → [散[3链]]<施放第5段普攻>暴击率
- 长离共鸣技能热熔增伤 → [离]<施放共鸣技能>增伤(热熔)
- 维里奈命座全队衍射增伤 → [维]<施放重击>全队+增伤(衍射)
- 隐世 5 件治疗触发全队攻击 → [隐世5件]<治疗友方>全队+攻击
- 曙色天光可叠 2 层（每层 10%）→ 拆两条：[散]<引爆冰棱>全队+攻击1层（10）+ [散]<引爆冰棱>全队+攻击2层（10，增量）
- 复杂条件/多段联动无法清晰表达时，直接保留游戏原 buff 文案作为 buff 名。`

const PREFS_KEY = 'ai-gen-prefs'
// 旧版本存储 key（仅 namingRule 字段），首次加载时迁移
const LEGACY_PREFS_KEY = 'ai-naming-prefs'

const DEFAULT_PREFS: AiGenPrefs = {
    namingRule: SHARE_NAMING_RULES,
    systemPrompt: DEFAULT_SYSTEM_PROMPT
}

let _prefs: AiGenPrefs = $state({ ...DEFAULT_PREFS })
let _loaded = false

export function getGenPrefs(): AiGenPrefs {
    return _prefs
}

export function getNamingRule(): string {
    return _prefs.namingRule.trim()
}

export function getSystemPrompt(): string {
    return _prefs.systemPrompt.trim()
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
            namingRule:
                typeof d.namingRule === 'string' && d.namingRule.trim()
                    ? d.namingRule
                    : hasLegacyShape
                      ? ''
                      : DEFAULT_PREFS.namingRule,
            systemPrompt:
                typeof d.systemPrompt === 'string' && d.systemPrompt.trim()
                    ? d.systemPrompt
                    : DEFAULT_PREFS.systemPrompt
        }
    }
    _loaded = true
    if (migrated) await updateGenPrefs({})
}

export async function updateGenPrefs(patch: Partial<AiGenPrefs>): Promise<void> {
    _prefs = { ..._prefs, ...patch }
    if (browser) await dbSet(PREFS_KEY, _prefs)
}
