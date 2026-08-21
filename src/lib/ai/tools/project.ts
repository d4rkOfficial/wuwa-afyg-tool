// 工程域工具（Phase 1）：直接操作 project store，无页面依赖
import { defineTool } from './registry'
import {
    getProjects,
    getActiveId,
    getActiveProject,
    createProject,
    renameProject,
    deleteProject,
    archiveProject,
    unarchiveProject,
    cloneProject,
    setActiveProject,
    lockPhase,
    unlockPhase,
    getPhaseOrder
} from '$lib/data/project.svelte'
import { getBuffEntities, getBuffLibraryLoading } from '$lib/data/buff-library.svelte'

type PhaseKey = 'team' | 'timeline' | 'calculation' | 'config'

const str = (v: unknown): string => String(v ?? '').trim()
const phaseKeys: PhaseKey[] = ['team', 'timeline', 'calculation', 'config']

function validPhase(v: unknown): v is PhaseKey {
    return phaseKeys.includes(v as PhaseKey)
}

defineTool('list_projects', {
    description: '列出所有本地工程（含名称、是否当前活动、是否已归档）。AI 需要了解有哪些工程时调用。',
    parameters: {
        type: 'object',
        properties: {}
    },
    handler: () => {
        const activeId = getActiveId()
        return getProjects().map((p) => ({
            id: p.id,
            name: p.name,
            active: p.id === activeId,
            archived: !!p.archived
        }))
    }
})

defineTool('get_project_state', {
    description:
        '获取当前活动工程的状态：工程名、队伍（各槽位角色与武器）、各环节锁定情况。AI 动手前应调用以了解现状。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const p = getActiveProject()
        if (!p) return { hasProject: false }
        return {
            hasProject: true,
            id: p.id,
            name: p.name,
            team: p.team.map((s, i) => ({
                slot: i + 1,
                character: s.character,
                weapon: s.weapon
            })),
            phases: Object.fromEntries(phaseKeys.map((k) => [k, !!p.phases[k]?.locked]))
        }
    }
})

defineTool('get_team', {
    description: '获取当前活动工程队伍配置摘要（每个槽位的角色与武器）。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const p = getActiveProject()
        if (!p) return { error: '当前没有活动工程' }
        return p.team.map((s, i) => ({
            slot: i + 1,
            character: s.character,
            weapon: s.weapon,
            triggerSets: s.triggerSets?.map((t) => `${t.name}${t.pieces}件`) ?? [],
            echoes: s.echoes?.map((e) => e.name).filter(Boolean) ?? []
        }))
    }
})

defineTool('create_project', {
    description: '新建一个工程并切换为当前活动工程。',
    parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '工程名称' } },
        required: ['name']
    },
    handler: async (args) => {
        const name = str(args.name)
        if (!name) throw new Error('工程名称不能为空')
        const project = await createProject(name)
        return { id: project.id, name: project.name }
    }
})

defineTool('rename_project', {
    description: '重命名指定工程。',
    parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name']
    },
    handler: async (args) => {
        const id = str(args.id)
        const name = str(args.name)
        if (!id || !name) throw new Error('工程 id 与名称不能为空')
        await renameProject(id, name)
        return { renamed: true }
    }
})

defineTool('set_active_project', {
    description: '切换当前活动工程（后续操作都作用于该工程）。',
    parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '工程 id（用 list_projects 获取）' } },
        required: ['id']
    },
    handler: async (args) => {
        const id = str(args.id)
        if (!id) throw new Error('缺少工程 id')
        await setActiveProject(id)
        return { active: id }
    }
})

defineTool('archive_project', {
    description: '将指定工程归档（从侧边栏隐藏，可在设置-归档管理中恢复）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
    },
    handler: async (args) => {
        const id = str(args.id)
        if (!id) throw new Error('缺少工程 id')
        await archiveProject(id)
        return { archived: id }
    }
})

defineTool('unarchive_project', {
    description: '将已归档工程恢复显示。',
    parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
    },
    handler: async (args) => {
        const id = str(args.id)
        if (!id) throw new Error('缺少工程 id')
        await unarchiveProject(id)
        return { unarchived: id }
    }
})

defineTool('delete_project', {
    description: '永久删除指定工程（不可恢复）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
    },
    handler: async (args) => {
        const id = str(args.id)
        if (!id) throw new Error('缺少工程 id')
        await deleteProject(id)
        return { deleted: id }
    }
})

defineTool('clone_project', {
    description: '克隆指定工程（全部环节）为新工程，新工程名可指定。',
    parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, newName: { type: 'string' } },
        required: ['id', 'newName']
    },
    handler: async (args) => {
        const id = str(args.id)
        const newName = str(args.newName)
        if (!id || !newName) throw new Error('工程 id 与新名称不能为空')
        const project = await cloneProject(id, newName, getPhaseOrder())
        if (!project) throw new Error('未找到该工程')
        return { id: project.id, name: project.name }
    }
})

defineTool('lock_phase', {
    description: '锁定当前活动工程的指定环节（team/timeline/calculation/config）。',
    parameters: {
        type: 'object',
        properties: { phase: { type: 'string', enum: phaseKeys } },
        required: ['phase']
    },
    handler: async (args) => {
        if (!validPhase(args.phase)) throw new Error(`无效环节：${String(args.phase)}`)
        await lockPhase(args.phase)
        return { locked: args.phase }
    }
})

defineTool('unlock_phase', {
    description: '解锁当前活动工程的指定环节及后续所有环节。',
    parameters: {
        type: 'object',
        properties: { phase: { type: 'string', enum: phaseKeys } },
        required: ['phase']
    },
    handler: async (args) => {
        if (!validPhase(args.phase)) throw new Error(`无效环节：${String(args.phase)}`)
        const id = getActiveId()
        if (!id) throw new Error('当前没有活动工程')
        await unlockPhase(id, args.phase)
        return { unlocked: args.phase }
    }
})

defineTool('get_buff_library_summary', {
    description: '获取本地 Buff 集概览：实体数量、按类型分布、数据来源（工坊同步/自定义）。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const entities = getBuffEntities()
        const byType: Record<string, number> = {}
        let share = 0
        let custom = 0
        for (const e of entities) {
            byType[e.entityType] = (byType[e.entityType] ?? 0) + 1
            if (e.source === 'share') share++
            else custom++
        }
        return {
            loading: getBuffLibraryLoading(),
            entityCount: entities.length,
            byType,
            share,
            custom
        }
    }
})
