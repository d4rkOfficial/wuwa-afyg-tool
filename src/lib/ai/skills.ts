/**
 * @desc 技能卡的**纯逻辑**（类型 / 兼容归一化 / 内置合并 / 注入文本渲染）。
 *
 * 与 `$lib/data/ai-skills.svelte.ts` 的分工：
 * - 本文件不做任何持久化与响应式，只处理「数组进、文本出」，便于单测
 * - `.svelte.ts` 负责 IndexedDB 读写与 `$state`，渲染时调用本文件的函数
 *
 * 主动 / 被动语义：
 * - `active`：回合装配只注入「名称 + 一句话描述」清单，AI 判断匹配后调用 `use_skill` 激活正文
 * - `passive`：每回合**直接注入正文**（常驻生效），且不再出现在主动技能清单里（避免重复）
 * - 两者都在 `enabled=false` 时完全不注入
 */

/** @desc 技能类型：主动（按需激活）/ 被动（常驻注入正文） */
export type SkillMode = 'active' | 'passive'

export const DEFAULT_SKILL_MODE: SkillMode = 'active'

export interface AiSkill {
    id: string
    /** @desc 技能名（唯一，AI 通过它激活） */
    name: string
    /** @desc 一句话描述（注入技能清单，供 AI 判断何时激活；被动技能不注入清单） */
    description: string
    /** @desc 激活后注入的完整指令正文 */
    body: string
    /** @desc 是否启用（禁用后既不入清单也不注入正文） */
    enabled: boolean
    /** @desc 主动 / 被动（旧数据缺失时按 active 处理） */
    mode: SkillMode
    /** @desc 内置技能（不可删除，可改正文 / 描述 / 类型 / 启停） */
    builtin?: boolean
}

/** @desc 技能类型的中文说明（设置界面展示用） */
export const SKILL_MODE_LABELS: Record<SkillMode, string> = {
    active: '主动',
    passive: '被动'
}

export const SKILL_MODE_HINTS: Record<SkillMode, string> = {
    active: '只把「名称 + 一句话描述」列给助手；任务匹配时助手调用 use_skill 激活正文（省 token）',
    passive: '每一轮都直接注入正文，常驻生效，无需助手调用 use_skill'
}

/** @desc 任意来源（旧数据 / 导入 JSON）的 mode → 合法 SkillMode，缺失或非法一律视为主动 */
export const coerceSkillMode = (value: unknown): SkillMode =>
    value === 'passive' || value === 'active' ? value : DEFAULT_SKILL_MODE

/** @desc 把任意来源的对象补全为合法 AiSkill（旧数据缺 mode 时按 active 兼容） */
export const normalizeSkill = (raw: Partial<AiSkill> & { id?: string }, fallback?: AiSkill): AiSkill => ({
    id: String(raw.id ?? fallback?.id ?? ''),
    name: String(raw.name ?? fallback?.name ?? '').trim(),
    description: String(raw.description ?? fallback?.description ?? ''),
    body: String(raw.body ?? fallback?.body ?? ''),
    enabled: raw.enabled !== false,
    mode: coerceSkillMode(raw.mode),
    ...(fallback?.builtin ? { builtin: true } : {})
})

/** @desc 内置技能 id（生成流程按 id 取正文：命名规则 / 黑话词典） */
export const SKILL_IDS = {
    buffNaming: 'skill-buff-naming',
    slangDict: 'skill-slang-dict',
    recoverQuery: 'skill-recover-query',
    buffConditions: 'skill-buff-conditions'
} as const

/**
 * @desc 内置技能：把「查询异常恢复流程」等既有约定固化为可禁用 / 可改的技能卡。
 *  - 「数据自愈」= 主动：只在查询异常时才需要，按需激活最省 token
 *  - 「条件与链阶」= 被动：只要在碰 Buff 条件就适用，属于常驻口径，直接每轮注入
 *  - 「Buff 命名规则」/「黑话词典」= 主动：原「提示词设置」里的两项配置，改为技能卡；
 *    生成流程按 id 直接读取正文（用户改正文即改生成口径），禁用 / 清空则回落到内置宽松默认
 *    用户可在设置里改类型。
 */
export const BUILTIN_SKILLS: AiSkill[] = [
    {
        id: SKILL_IDS.buffNaming,
        name: 'Buff 命名规则',
        description: '生成 / 命名 Buff时遵循的命名规范（归属者·触发·效果词条），含叠层与精炼拆分硬性要求',
        enabled: true,
        mode: 'active',
        builtin: true,
        body: `buff 名格式（默认遵循工坊风格，对齐批量改名脚本）：
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
    },
    {
        id: SKILL_IDS.slangDict,
        name: '黑话词典',
        description: '官方 / 生僻叫法 → 玩家黑话的对照表（角色简称、技能按键代称），命名 Buff 时用来对齐习惯叫法',
        enabled: true,
        mode: 'active',
        builtin: true,
        body: `普攻=A
重击=Z
施放共鸣技能=E
施放共鸣解放=R
施放声骸技能=Q
施放谐度破坏=F // 俗称处决
漂泊者·衍射=光主
漂泊者·湮灭=暗主
漂泊者·气动=风主
漂泊者·导电=雷主
漂泊者·热熔=火主
漂泊者·冷凝=冰主
布兰特=船长`
    },
    {
        id: SKILL_IDS.recoverQuery,
        name: '数据自愈',
        description: '查询计算/结果类工具返回空、报错或数据异常时，按顺序重载四阶段后再重试',
        enabled: true,
        mode: 'active',
        builtin: true,
        body: `当查询类工具（尤其 get_result_summary / get_result_entry_breakdown / get_data_analysis）返回空、报错或数据明显异常时，按以下顺序自愈后重试：
① set_active_project 重新打开当前工程（按 id 切回，触发数据重载）。
② 依次进入并校正每个环节，顺序 team → timeline → calculation → config；每个环节执行：switch_view 切到该环节 → unlock_phase 解锁 → lock_phase 重新锁定。
③ 四个环节都走完后，switch_view 切到所需视图。
④ 重新执行最初失败的查询工具。
若自愈后仍失败，再如实告知异常原因，并建议用户手动检查对应环节配置。`
    },
    {
        id: SKILL_IDS.buffConditions,
        name: '条件与链阶',
        description: '配置 Buff 生效条件（乘区级伤害类型/属性、实例级链/阶硬性条件）时的规则与口径',
        enabled: true,
        mode: 'passive',
        builtin: true,
        body: `本工具的条件系统口径（回答用户或写配置时严格遵守）：
1. 伤害类型条件、伤害属性条件挂在**具体乘区**上（BuffZoneValue.condition）：不满足时只有该乘区不计入，同一条目其它乘区照常生效。
2. 链条件与阶条件是**整个 BUFF 的硬性条件**，只能设在 BUFF 实例级（BuffInstance.condition），且同一个 BUFF 只能生效其中一个（链与阶互斥）。
3. 链/阶档位的真源是角色槽位 team[i].chain / team[i].refinement，由「角色详情配置」设置，不是可编辑变量。
4. 同一个 BUFF 允许存在多个同名变体（variants），每个变体有自己的乘区与子条件，满足者全部叠加。`
    }
]

/** @desc 启用中的技能 */
export const enabledSkillsOf = (skills: AiSkill[]): AiSkill[] => skills.filter((s) => s.enabled)

/** @desc 启用中的主动技能（进技能清单，AI 用 use_skill 激活） */
export const activeSkillsOf = (skills: AiSkill[]): AiSkill[] => skills.filter((s) => s.enabled && s.mode === 'active')

/** @desc 启用中的被动技能（正文每轮直接注入） */
export const passiveSkillsOf = (skills: AiSkill[]): AiSkill[] => skills.filter((s) => s.enabled && s.mode === 'passive')

/** @desc 内置默认 + 用户存档合并：内置以代码定义为准，仅保留用户对描述 / 正文 / 类型 / 启停的修改 */
export const mergeBuiltinSkills = (stored: AiSkill[]): AiSkill[] => {
    const merged = BUILTIN_SKILLS.map((builtin) => {
        const override = stored.find((s) => s.id === builtin.id)
        if (!override) return normalizeSkill(builtin)
        return normalizeSkill(
            {
                id: builtin.id,
                name: builtin.name,
                description:
                    typeof override.description === 'string' && override.description.trim()
                        ? override.description
                        : builtin.description,
                body: typeof override.body === 'string' && override.body.trim() ? override.body : builtin.body,
                enabled: override.enabled !== false,
                mode: override.mode
            },
            builtin
        )
    })
    const custom = stored
        .filter((s) => !BUILTIN_SKILLS.some((b) => b.id === s.id))
        .filter((s) => s && typeof s.name === 'string' && s.name.trim())
        .map((s) => normalizeSkill(s))
    return [...merged, ...custom]
}

/**
 * @desc 主动技能清单（system 消息）：只含名称 + 一句话描述，正文按需由 use_skill 激活。
 * 返回空串表示没有启用的主动技能（调用方据此跳过注入）。
 */
export const renderActiveSkillListing = (skills: AiSkill[] = []): string => {
    const active = activeSkillsOf(skills)
    if (active.length === 0) return ''
    const lines = active.map((s) => `- ${s.name}：${s.description || '（无描述）'}`)
    return [
        '【可用技能】以下是用户预置的技能卡。当任务与某个技能的描述匹配时，先调用 use_skill 激活它，再按其正文执行：',
        ...lines
    ].join('\n')
}

/**
 * @desc 被动技能正文（system 消息）：启用中的被动技能正文每轮直接注入，常驻生效。
 * 返回空串表示没有启用的被动技能（调用方据此跳过注入）。
 */
export const renderPassiveSkillsPrompt = (skills: AiSkill[] = []): string => {
    const passive = passiveSkillsOf(skills)
    if (passive.length === 0) return ''
    return [
        '【常驻技能】以下被动技能由用户预置并**始终生效**，请无条件遵守，无需调用 use_skill 激活：',
        ...passive.map((s) => `## ${s.name}\n${s.body}`)
    ].join('\n\n')
}

/** @desc 取指定技能（启用中）的正文；未启用 / 已清空 / 不存在时返回空串（调用方自行回落默认） */
export const enabledSkillBodyOf = (skills: AiSkill[], id: string): string => {
    const skill = skills.find((s) => s.id === id)
    return skill?.enabled ? skill.body.trim() : ''
}

/** @desc 旧版「提示词设置」里的命名规则 / 黑话词典（已迁为内置技能卡） */
export interface LegacyPromptPrefs {
    namingRule?: string
    slangDict?: string
}

/**
 * @desc 把旧版提示词偏好换算成内置技能的正文覆盖（一次性迁移用）。
 *  只返回确实有自定义内容的项；对应技能 id 已有存档时由调用方跳过，避免覆盖现有技能。
 */
export const legacyPrefsToSkillOverrides = (legacy: LegacyPromptPrefs | null | undefined): AiSkill[] => {
    if (!legacy) return []
    const overrides: AiSkill[] = []
    const seed = (id: string, body: string) => {
        const builtin = BUILTIN_SKILLS.find((s) => s.id === id)
        if (builtin && body) overrides.push(normalizeSkill({ id, body }, builtin))
    }
    seed(SKILL_IDS.buffNaming, String(legacy.namingRule ?? '').trim())
    seed(SKILL_IDS.slangDict, String(legacy.slangDict ?? '').trim())
    return overrides
}
