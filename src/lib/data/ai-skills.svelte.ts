// 自定义 Skill（持久化到 IndexedDB）：用户可维护一组「技能卡」，在对话里按名激活后注入指令正文
import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'

export interface AiSkill {
    id: string
    /** @desc 技能名（唯一，AI 通过它激活） */
    name: string
    /** @desc 一句话描述（注入 skill_listing，供 AI 判断何时激活） */
    description: string
    /** @desc 激活后注入的完整指令正文 */
    body: string
    /** @desc 是否启用（禁用后不出现在列表与快捷入口） */
    enabled: boolean
    /** @desc 内置技能（不可删除，可禁用/改正文） */
    builtin?: boolean
}

const SKILLS_KEY = 'ai-skills'

/** @desc 内置技能：把「查询异常恢复流程」等既有约定固化为可禁用/可改的技能卡 */
export const BUILTIN_SKILLS: AiSkill[] = [
    {
        id: 'skill-recover-query',
        name: '数据自愈',
        description: '查询计算/结果类工具返回空、报错或数据异常时，按顺序重载四阶段后再重试',
        enabled: true,
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
        builtin: true,
        body: `本工具的条件系统口径（回答用户或写配置时严格遵守）：
1. 伤害类型条件、伤害属性条件挂在**具体乘区**上（BuffZoneValue.condition）：不满足时只有该乘区不计入，同一条目其它乘区照常生效。
2. 链条件与阶条件是**整个 BUFF 的硬性条件**，只能设在 BUFF 实例级（BuffInstance.condition），且同一个 BUFF 只能生效其中一个（链与阶互斥）。
3. 链/阶档位的真源是角色槽位 team[i].chain / team[i].refinement，由「角色详情配置」设置，不是可编辑变量。
4. 同一个 BUFF 允许存在多个同名变体（variants），每个变体有自己的乘区与子条件，满足者全部叠加。`
    }
]

let _skills = $state<AiSkill[]>([])
let _loaded = false

export function getSkills(): AiSkill[] {
    return _skills
}

/** @desc 启用中的技能（注入 skill_listing 与快捷入口） */
export function getEnabledSkills(): AiSkill[] {
    return _skills.filter((s) => s.enabled)
}

export function findSkillByName(name: string): AiSkill | undefined {
    const target = name.trim().toLowerCase()
    return _skills.find((s) => s.name.toLowerCase() === target)
}

export async function loadSkills(): Promise<void> {
    if (!browser || _loaded) return
    const stored = await dbGet<AiSkill[]>(SKILLS_KEY)
    const saved = Array.isArray(stored?.data) ? stored.data.filter((s) => s && typeof s.name === 'string') : []
    // 内置技能：以代码定义为准合并（保留用户对正文/启用的修改）
    const merged: AiSkill[] = BUILTIN_SKILLS.map((builtin) => {
        const override = saved.find((s) => s.id === builtin.id)
        return override
            ? {
                  ...builtin,
                  body: typeof override.body === 'string' && override.body.trim() ? override.body : builtin.body,
                  description:
                      typeof override.description === 'string' && override.description.trim()
                          ? override.description
                          : builtin.description,
                  enabled: override.enabled !== false
              }
            : { ...builtin }
    })
    const custom = saved.filter((s) => !BUILTIN_SKILLS.some((b) => b.id === s.id))
    _skills = [...merged, ...custom]
    _loaded = true
}

async function persist(): Promise<void> {
    if (!browser) return
    await dbSet(SKILLS_KEY, JSON.parse(JSON.stringify(_skills)))
}

export async function addSkill(input: { name: string; description: string; body: string }): Promise<AiSkill | null> {
    const name = input.name.trim()
    if (!name) return null
    if (_skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) return null
    const skill: AiSkill = {
        id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        description: input.description.trim(),
        body: input.body,
        enabled: true
    }
    _skills = [..._skills, skill]
    await persist()
    return skill
}

export async function updateSkill(id: string, patch: Partial<Omit<AiSkill, 'id' | 'builtin'>>): Promise<boolean> {
    const target = _skills.find((s) => s.id === id)
    if (!target) return false
    if (patch.name !== undefined) {
        const name = patch.name.trim()
        if (!name) return false
        if (_skills.some((s) => s.id !== id && s.name.toLowerCase() === name.toLowerCase())) return false
    }
    _skills = _skills.map((s) => (s.id === id ? { ...s, ...patch, name: patch.name?.trim() ?? s.name } : s))
    await persist()
    return true
}

export async function deleteSkill(id: string): Promise<boolean> {
    const target = _skills.find((s) => s.id === id)
    if (!target || target.builtin) return false
    _skills = _skills.filter((s) => s.id !== id)
    await persist()
    return true
}

export async function toggleSkillEnabled(id: string): Promise<void> {
    _skills = _skills.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    await persist()
}

/** @desc 导入技能（同名跳过），返回新增数量 */
export async function importSkills(list: AiSkill[]): Promise<number> {
    const fresh: AiSkill[] = []
    for (const item of list) {
        const name = String(item?.name ?? '').trim()
        if (!name) continue
        if (_skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue
        fresh.push({
            id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name,
            description: String(item.description ?? ''),
            body: String(item.body ?? ''),
            enabled: item.enabled !== false
        })
    }
    if (fresh.length === 0) return 0
    _skills = [..._skills, ...fresh]
    await persist()
    return fresh.length
}

/** @desc 给 AI 的技能清单（名称 + 一句话描述；正文按需由 use_skill 激活，省 token） */
export function renderSkillListing(): string {
    const enabled = getEnabledSkills()
    if (enabled.length === 0) return ''
    const lines = enabled.map((s) => `- ${s.name}：${s.description || '（无描述）'}`)
    return [
        '【可用技能】以下是用户预置的技能卡。当任务与某个技能的描述匹配时，先调用 use_skill 激活它，再按其正文执行：',
        ...lines
    ].join('\n')
}
