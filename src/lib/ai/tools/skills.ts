// AI 工具：自定义 Skill（列出 / 激活）
// 主动技能用 use_skill 按需激活；被动技能正文已随每轮 system 常驻注入
import { defineTool } from './registry'
import { findSkillByName, getActiveSkills, getEnabledSkills, getSkills } from '$lib/data/ai-skills.svelte'
import { SKILL_MODE_LABELS } from '$lib/ai/skills'

defineTool('list_skills', {
    description:
        '列出用户的技能卡（名称 + 类型 + 一句话描述 + 是否启用）。主动技能在任务匹配时用 use_skill 激活其正文；被动技能已常驻生效，正文已在系统提示中，无需激活。',
    parameters: { type: 'object', properties: {} },
    handler: () => ({
        skills: getSkills().map((s) => ({
            name: s.name,
            mode: s.mode,
            modeLabel: SKILL_MODE_LABELS[s.mode],
            description: s.description,
            enabled: s.enabled,
            builtin: !!s.builtin,
            note:
                s.mode === 'passive'
                    ? '被动技能：正文已常驻注入，无需调用 use_skill'
                    : '主动技能：描述匹配时用 use_skill 激活正文'
        })),
        enabledCount: getEnabledSkills().length,
        activeCount: getActiveSkills().length
    })
})

defineTool('use_skill', {
    description:
        '激活一张**主动**技能卡：返回该技能的完整正文，之后请严格按正文中的规范继续处理当前任务。名称必须来自技能清单（被动技能无需激活，其正文已常驻生效）。',
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
                available: getEnabledSkills().map((s) => `${s.name}（${SKILL_MODE_LABELS[s.mode]}）`)
            }
        }
        if (!skill.enabled) {
            return {
                ok: false,
                error: `技能「${skill.name}」已被用户禁用`,
                available: getEnabledSkills().map((s) => `${s.name}（${SKILL_MODE_LABELS[s.mode]}）`)
            }
        }
        if (skill.mode === 'passive') {
            return {
                ok: true,
                name: skill.name,
                mode: skill.mode,
                note: '该技能为被动技能，已常驻生效，无需激活；以下正文仅供核对',
                body: skill.body
            }
        }
        return { ok: true, name: skill.name, mode: skill.mode, description: skill.description, body: skill.body }
    }
})
