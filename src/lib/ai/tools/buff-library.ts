// 本地 Buff 库域工具（Phase 2）：同步、查询、编辑、删除
import { defineTool } from './registry'
import {
    getBuffEntities,
    fetchBuffSetsFromShare,
    updateEntityBuffs,
    deleteBuffEntity,
    clearBuffLibrary,
    ENTITY_TYPES,
    type BuffLibraryScope
} from '$lib/data/buff-library.svelte'

const str = (v: unknown): string => String(v ?? '').trim()
const SCOPES: BuffLibraryScope[] = ['self', 'self_except', 'team', 'effect_only']

defineTool('sync_buff_library_from_share', {
    description:
        '从工坊同步最新 Buff 集到本地库。注意：会整体覆盖“来自工坊”的实体，且工坊中已下线的实体将被移除（自定义实体不受影响）。',
    dangerous: true,
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        const res = await fetchBuffSetsFromShare()
        if (!res.ok) throw new Error(res.error ?? '同步失败')
        return { added: res.added }
    }
})

defineTool('list_buff_entities', {
    description: '列出本地 Buff 库的实体（可按类型过滤）：实体名、类型、来源（share/custom）、Buff 数量。',
    parameters: {
        type: 'object',
        properties: { entityType: { type: 'string', description: '可选：character/weapon/echo/1set-5set' } },
        required: []
    },
    handler: (args) => {
        const filter = str(args.entityType)
        if (filter && !ENTITY_TYPES.includes(filter as never)) throw new Error(`无效实体类型：${filter}`)
        return getBuffEntities()
            .filter((e) => !filter || e.entityType === filter)
            .map((e) => ({
                entityType: e.entityType,
                entityName: e.entityName,
                source: e.source,
                buffCount: e.buffs.length
            }))
    }
})

defineTool('get_entity_buffs', {
    description: '查看本地 Buff 库中指定实体的全部 Buff 详情（名称、作用范围、生效条件、乘区与数值、引用）。',
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string' },
            entityName: { type: 'string' }
        },
        required: ['entityType', 'entityName']
    },
    handler: (args) => {
        const entityType = str(args.entityType)
        const entityName = str(args.entityName)
        const entity = getBuffEntities().find((e) => e.entityType === entityType && e.entityName === entityName)
        if (!entity) throw new Error(`未找到「${entityName}」`)
        return {
            entityType,
            entityName,
            source: entity.source,
            buffs: entity.buffs.map((b) => ({
                buffName: b.buffName,
                scope: b.scope,
                exclusive: !!b.exclusive,
                condition: b.condition ?? null,
                zones: b.zones
            }))
        }
    }
})

defineTool('update_entity_buffs', {
    description:
        '整体覆写本地 Buff 库中指定实体的 Buff 列表（该实体来源变为 custom）。buffs 结构：[{"buffName":"名称","scope":"self|self_except|team|effect_only","exclusive":false,"condition":{...可选},"zones":[{"zoneId":"乘区id","value":数值,"override":false,"ref":{...可选}}]}]。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string' },
            entityName: { type: 'string' },
            buffs: { type: 'array', items: { type: 'object' } }
        },
        required: ['entityType', 'entityName', 'buffs']
    },
    handler: async (args) => {
        const entityType = str(args.entityType)
        const entityName = str(args.entityName)
        if (!ENTITY_TYPES.includes(entityType as never)) throw new Error(`无效实体类型：${entityType}`)
        const buffs = (Array.isArray(args.buffs) ? args.buffs : []).map((raw) => {
            const b = (raw ?? {}) as Record<string, unknown>
            const buffName = str(b.buffName)
            if (!buffName) throw new Error('存在未命名的 Buff')
            const scope = (b.scope as BuffLibraryScope) ?? 'team'
            if (!SCOPES.includes(scope)) throw new Error(`无效 scope：${String(b.scope)}`)
            const zones = (Array.isArray(b.zones) ? b.zones : []).map((zr) => {
                const z = (zr ?? {}) as Record<string, unknown>
                const zoneId = str(z.zoneId)
                const value = Number(z.value)
                if (!zoneId || !Number.isFinite(value)) throw new Error(`无效乘区：${String(z.zoneId)}`)
                return {
                    zoneId,
                    value,
                    ...(z.override ? { override: true } : {}),
                    ...(z.ref && typeof z.ref === 'object' ? { ref: z.ref as never } : {})
                }
            })
            return {
                buffName,
                scope,
                exclusive: !!b.exclusive,
                ...(b.condition && typeof b.condition === 'object' ? { condition: b.condition as never } : {}),
                zones
            }
        })
        await updateEntityBuffs(entityType as never, entityName, buffs as never)
        return { updated: buffs.length }
    }
})

defineTool('delete_buff_entity', {
    description: '从本地 Buff 库删除指定实体（不可恢复）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: { entityType: { type: 'string' }, entityName: { type: 'string' } },
        required: ['entityType', 'entityName']
    },
    handler: async (args) => {
        const entityType = str(args.entityType)
        const entityName = str(args.entityName)
        await deleteBuffEntity(entityType as never, entityName)
        return { deleted: entityName }
    }
})

defineTool('clear_buff_library', {
    description: '清空整个本地 Buff 库（所有实体与 Buff，不可恢复）。',
    dangerous: true,
    parameters: { type: 'object', properties: {} },
    handler: () => {
        clearBuffLibrary()
        return { cleared: true }
    }
})
