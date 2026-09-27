// 自定义 Skill（持久化到 IndexedDB）：用户可维护一组「技能卡」，按主动/被动两种方式注入对话
// 纯逻辑（类型 / 兼容归一化 / 内置合并 / 注入文本渲染）见 $lib/ai/skills.ts
import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import {
    BUILTIN_SKILLS,
    activeSkillsOf,
    coerceSkillMode,
    enabledSkillBodyOf,
    enabledSkillsOf,
    legacyPrefsToSkillOverrides,
    mergeBuiltinSkills,
    normalizeSkill,
    passiveSkillsOf,
    renderActiveSkillListing,
    renderPassiveSkillsPrompt,
    SKILL_IDS,
    type AiSkill,
    type SkillMode
} from '$lib/ai/skills'
import { getGenPrefs, loadGenPrefs } from '$lib/data/ai-prefs.svelte'

export { BUILTIN_SKILLS, renderActiveSkillListing, renderPassiveSkillsPrompt, SKILL_IDS }
export type { AiSkill, SkillMode }

const SKILLS_KEY = 'ai-skills'

let _skills = $state<AiSkill[]>([])
let _loaded = false

export function getSkills(): AiSkill[] {
    return _skills
}

/** @desc 启用中的技能（既进主动清单，也进被动注入） */
export function getEnabledSkills(): AiSkill[] {
    return enabledSkillsOf(_skills)
}

/** @desc 启用中的主动技能（`list_skills` 的可用提示用） */
export function getActiveSkills(): AiSkill[] {
    return activeSkillsOf(_skills)
}

/** @desc 启用中的被动技能（常驻注入正文，不参与 use_skill 激活） */
export function getPassiveSkills(): AiSkill[] {
    return passiveSkillsOf(_skills)
}

export function findSkillByName(name: string): AiSkill | undefined {
    const target = name.trim().toLowerCase()
    return _skills.find((s) => s.name.toLowerCase() === target)
}

/** @desc 取指定技能（启用中）的正文：生成流程按 id 读取命名规则 / 黑话词典，禁用或清空时返回空串 */
export function getEnabledSkillBody(id: string): string {
    return enabledSkillBodyOf(_skills, id)
}

export async function loadSkills(): Promise<void> {
    if (!browser || _loaded) return
    const stored = await dbGet<AiSkill[]>(SKILLS_KEY)
    const saved = Array.isArray(stored?.data) ? stored.data.filter((s) => s && typeof s.name === 'string') : []
    // 旧数据兼容：缺 mode 字段 → 按主动处理（mergeBuiltinSkills → normalizeSkill → coerceSkillMode）
    // 一次性迁移：旧版「提示词设置」里的命名规则 / 黑话词典 → 对应内置技能卡的正文覆盖
    await loadGenPrefs()
    const legacy = legacyPrefsToSkillOverrides(getGenPrefs()).filter((o) => !saved.some((s) => s.id === o.id))
    _skills = mergeBuiltinSkills([...saved, ...legacy])
    _loaded = true
    if (legacy.length > 0) await persist()
}

async function persist(): Promise<void> {
    if (!browser) return
    await dbSet(SKILLS_KEY, JSON.parse(JSON.stringify(_skills)))
}

export async function addSkill(input: {
    name: string
    description: string
    body: string
    mode?: SkillMode
    enabled?: boolean
}): Promise<AiSkill | null> {
    const name = input.name.trim()
    if (!name) return null
    if (_skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) return null
    const skill: AiSkill = {
        id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        description: input.description.trim(),
        body: input.body,
        enabled: input.enabled !== false,
        mode: coerceSkillMode(input.mode)
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
    _skills = _skills.map((s) =>
        s.id === id
            ? {
                  ...s,
                  ...patch,
                  name: patch.name?.trim() ?? s.name,
                  mode: patch.mode === undefined ? s.mode : coerceSkillMode(patch.mode)
              }
            : s
    )
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

/** @desc 导入技能（同名跳过），返回新增数量；旧格式缺 mode 时按主动导入 */
export async function importSkills(list: Partial<AiSkill>[]): Promise<number> {
    const fresh: AiSkill[] = []
    for (const item of list) {
        const name = String(item?.name ?? '').trim()
        if (!name) continue
        if (_skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue
        fresh.push({
            ...normalizeSkill({ ...item, name }),
            id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        })
    }
    if (fresh.length === 0) return 0
    _skills = [..._skills, ...fresh]
    await persist()
    return fresh.length
}
