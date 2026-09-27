// AI 工具：自定义 Skill（列出 / 激活）
import { defineTool } from './registry'
import { findSkillByName, getEnabledSkills, getSkills } from '$lib/data/ai-skills.svelte'

defineTool('list_skills', {
    description:
        '列出用户的技能卡（名称 + 一句话描述 + 是否启用）。技能卡是用户预置的操作规范，任务匹配时用 use_skill 激活其正文。',
    parameters: { type: 'object', properties: {} },
    handler: () => ({
        skills: getSkills().map((s) => ({
            name: s.name,
            description: s.description,
            enabled: s.enabled,
            builtin: !!s.builtin
        })),
        enabledCount: getEnabledSkills().length
    })
})

defineTool('use_skill', {
    description:
        '激活一张技能卡：返回该技能的完整正文，之后请严格按正文中的规范继续处理当前任务。名称必须来自技能清单。',
    parameters: {
        type: 'object',
        properties: {
            name: { type: 'string', description: '技能名（来自技能清单，需完全一致）' }
        },
        required: ['name']
    },
    handler: (args) => {
        const name = String(args.name ?? '').trim()
        const skill = findSkillByName(name)
        if (!skill) {
            return {
                ok: false,
                error: `未找到技能「${name}」`,
                available: getEnabledSkills().map((s) => s.name)
            }
        }
        if (!skill.enabled) {
            return {
                ok: false,
                error: `技能「${skill.name}」已被用户禁用`,
                available: getEnabledSkills().map((s) => s.name)
            }
        }
        return { ok: true, name: skill.name, description: skill.description, body: skill.body }
    }
})
