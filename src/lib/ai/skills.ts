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

/**
 * @desc 内置技能：把「查询异常恢复流程」等既有约定固化为可禁用 / 可改的技能卡。
 *  - 「数据自愈」= 主动：只在查询异常时才需要，按需激活最省 token
 *  - 「条件与链阶」= 被动：只要在碰 Buff 条件就适用，属于常驻口径，直接每轮注入
 *    用户可在设置里改类型。
 */
export const BUILTIN_SKILLS: AiSkill[] = [
    {
        id: 'skill-recover-query',
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
        id: 'skill-buff-conditions',
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
