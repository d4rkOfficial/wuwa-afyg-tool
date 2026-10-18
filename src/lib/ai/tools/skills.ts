// AI 工具：AI Skill（技能卡）的通用增删改查 + 激活
// 主动技能用 use_skill 按需激活；被动技能正文已随每轮 system 常驻注入。
// 通用 CRUD 取代旧的 get_naming_rule / set_naming_rule：命名规则只是内置技能卡之一，
// AI 通过 update_skill 修改「Buff 命名规则」即可，不再有专用工具。
import { defineTool } from './registry'
import {
    addSkill,
    deleteSkill,
    findSkillByName,
    getActiveSkills,
    getEnabledSkills,
    getSkills,
    updateSkill
} from '$lib/data/ai-skills.svelte'
import { SKILL_MODE_LABELS, type SkillMode } from '$lib/ai/skills'

const str = (v: unknown): string => String(v ?? '').trim()
const MODES: SkillMode[] = ['active', 'passive']

const readMode = (value: unknown): SkillMode | undefined => {
    if (value === undefined || value === null || value === '') return undefined
    const mode = str(value) as SkillMode
    if (!MODES.includes(mode)) throw new Error(`mode 须为 active 或 passive（收到 ${String(value)}）`)
    return mode
}

const readEnabled = (value: unknown): boolean | undefined => {
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'boolean') throw new Error('enabled 须为布尔值（true/false）')
    return value
}

const skillView = (skill: ReturnType<typeof findSkillByName>) => {
    if (!skill) return null
    return {
        id: skill.id,
        name: skill.name,
        mode: skill.mode,
        modeLabel: SKILL_MODE_LABELS[skill.mode],
        description: skill.description,
        enabled: skill.enabled,
        builtin: !!skill.builtin,
        body: skill.body
    }
}

defineTool('list_skills', {
    description:
        '列出用户的技能卡（名称 + 类型 + 一句话描述 + 是否启用 + 是否内置）。主动技能在任务匹配时用 use_skill 激活其正文；被动技能已常驻生效，正文已在系统提示中，无需激活。要读取正文用 get_skill。',
    parameters: { type: 'object', properties: {} },
    handler: () => ({
        skills: getSkills().map((s) => ({
            id: s.id,
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
        activeCount: getActiveSkills().length,
        hint: '增删改查分别用 create_skill / delete_skill / update_skill / get_skill；内置技能可改描述/正文/类型/启停，不可删除或改名'
    })
})

defineTool('get_skill', {
    description:
        '读取一张技能卡的完整内容（名称、类型、描述、正文、是否启用、是否内置）。修改前先读；内置技能「Buff 命名规则」「黑话词典」等也可通过它读取正文。',
    parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '技能名（可用 list_skills 查询，需完全一致）' } },
        required: ['name']
    },
    handler: (args) => {
        const name = str(args.name)
        if (!name) throw new Error('缺少 name（技能名）')
        const skill = findSkillByName(name)
        if (!skill) {
            return {
                ok: false,
                error: `未找到技能「${name}」`,
                available: getSkills().map(
                    (s) => `${s.name}（${SKILL_MODE_LABELS[s.mode]}${s.builtin ? '，内置' : ''}）`
                )
            }
        }
        return { ok: true, skill: skillView(skill) }
    }
})

defineTool('create_skill', {
    description:
        '创建一张新的**自定义技能卡**（AI 可自创并自行管理）。name 必须与现有技能不重名；body 是激活后注入的完整操作规范/正文。主动技能需 AI 判断匹配后调用 use_skill 激活；被动技能每轮自动注入正文。创建后可用 update_skill 继续维护。',
    parameters: {
        type: 'object',
        properties: {
            name: { type: 'string', description: '技能名（唯一，例如「XX 角色配装口径」）' },
            description: {
                type: 'string',
                description: '一句话描述（主动技能清单会用它判断何时激活；建议不超过 60 字）'
            },
            body: { type: 'string', description: '技能正文：激活后要遵守的完整规范/步骤/注意事项' },
            mode: {
                type: 'string',
                enum: ['active', 'passive'],
                description: 'active=按需激活（默认）；passive=每轮常驻注入正文'
            },
            enabled: { type: 'boolean', description: '是否启用（默认 true）' }
        },
        required: ['name', 'body']
    },
    handler: async (args) => {
        const name = str(args.name)
        const body = str(args.body)
        if (!name) throw new Error('缺少 name（技能名）')
        if (!body) throw new Error('缺少 body（技能正文）')
        const created = await addSkill({
            name,
            description: str(args.description),
            body: args.body === undefined ? '' : String(args.body),
            mode: readMode(args.mode),
            enabled: readEnabled(args.enabled)
        })
        if (!created) throw new Error(`技能名「${name}」已存在（技能名必须唯一）`)
        return { created: true, skill: skillView(created) }
    }
})

defineTool('update_skill', {
    description:
        '修改一张已有技能卡（按当前 name 定位）。可改 newName（改名，内置技能不可改名）、description、body、mode、enabled；未提供的字段保持原值。这是管理内置技能（如「Buff 命名规则」「黑话词典」）的唯一入口：改其正文即改对应流程的口径，清空正文会让内置默认重新生效。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            name: { type: 'string', description: '要修改的技能当前名称' },
            newName: { type: 'string', description: '可选：改成的新名称（自定义技能才可改名）' },
            description: { type: 'string', description: '新的一句话描述' },
            body: { type: 'string', description: '新的技能正文（传空串表示清空；内置技能清空后回落内置默认）' },
            mode: {
                type: 'string',
                enum: ['active', 'passive'],
                description: '新的技能类型：active=按需激活 / passive=常驻注入'
            },
            enabled: { type: 'boolean', description: '是否启用' }
        },
        required: ['name']
    },
    handler: async (args) => {
        const name = str(args.name)
        if (!name) throw new Error('缺少 name（技能名）')
        const skill = findSkillByName(name)
        if (!skill) throw new Error(`未找到技能「${name}」`)

        const newName = str(args.newName)
        if (newName && newName !== skill.name && skill.builtin) {
            throw new Error('内置技能不可改名；可以改描述 / 正文 / 类型 / 启停')
        }
        const patch: Parameters<typeof updateSkill>[1] = {}
        if (newName && newName !== skill.name) patch.name = newName
        if (args.description !== undefined) patch.description = String(args.description)
        if (args.body !== undefined) patch.body = String(args.body)
        const mode = readMode(args.mode)
        if (mode !== undefined) patch.mode = mode
        const enabled = readEnabled(args.enabled)
        if (enabled !== undefined) patch.enabled = enabled
        if (Object.keys(patch).length === 0) throw new Error('没有需要修改的字段')

        const ok = await updateSkill(skill.id, patch)
        if (!ok) throw new Error(`技能名「${String(patch.name ?? skill.name)}」已存在，或技能名为空`)
        return { updated: true, skill: skillView(findSkillByName(patch.name ?? skill.name)) }
    }
})

defineTool('delete_skill', {
    description:
        '删除一张**自定义**技能卡（按名称定位）。内置技能不可删除，只能通过 update_skill 禁用。删除后使用 use_skill 将无法再激活它。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '要删除的技能名' } },
        required: ['name']
    },
    handler: async (args) => {
        const name = str(args.name)
        if (!name) throw new Error('缺少 name（技能名）')
        const skill = findSkillByName(name)
        if (!skill) throw new Error(`未找到技能「${name}」`)
        if (skill.builtin) throw new Error('内置技能不可删除；请用 update_skill 设置 enabled=false')
        const ok = await deleteSkill(skill.id)
        if (!ok) throw new Error(`删除技能「${name}」失败`)
        return { deleted: true, name: skill.name }
    }
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
        const name = str(args.name)
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
