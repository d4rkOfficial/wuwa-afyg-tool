// 本地 Buff 集域工具（Phase 2）：同步、查询、编辑、删除
import { defineTool } from './registry'
import {
    getBuffEntities,
    fetchBuffSetsFromShare,
    updateEntityBuffs,
    deleteBuffEntity,
    clearBuffLibrary as clearBuffSet,
    ENTITY_TYPES,
    type BuffLibraryScope as BuffSetScope
} from '$lib/data/buff-library.svelte'
import { ZONE_NO_REF_IDS } from '$lib/calc/calculation.consts'

const str = (v: unknown): string => String(v ?? '').trim()
const SCOPES: BuffSetScope[] = ['self', 'self_except', 'team', 'effect_only']

defineTool('sync_buff_set_from_share', {
    description:
        '从工坊同步最新 Buff 集到主页的本地 Buff 集。注意：会整体覆盖“来自工坊”的实体，且工坊中已下线的实体将被移除（自定义实体不受影响）。',
    dangerous: true,
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        const res = await fetchBuffSetsFromShare()
        if (!res.ok) throw new Error(res.error ?? '同步失败')
        return { added: res.added }
    }
})

defineTool('list_buff_set_entities', {
    description:
        '列出本地 Buff 集的实体（仅管理主页数据，不修改工程 Buff 配置；可按类型过滤）：实体名、类型、来源（share/custom）、Buff 数量。',
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

defineTool('get_buff_set_entity_buffs', {
    description:
        '查看本地 Buff 集中指定实体的全部 Buff 详情（不读取工程 Buff 配置；名称、作用范围、生效条件、乘区与数值、引用）。',
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string', description: '实体类型：character/weapon/echo/1set-5set' },
            entityName: { type: 'string', description: '实体名称（中文，用 list_buff_set_entities 定位）' }
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

defineTool('update_buff_set_entity_buffs', {
    description:
        '整体覆写主页的本地 Buff 集中指定实体的 Buff 列表；仅在用户明确要求维护 Buff 集时使用，不用于给工程配 Buff（该实体来源变为 custom）。buffs 结构：[{"buffName":"名称","scope":"self|self_except|team|effect_only","exclusive":false,"condition":{...可选},"zones":[{"zoneId":"乘区id","value":数值,"override":false,"ref":{...可选}}]}]。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string', description: '实体类型：character/weapon/echo/1set-5set' },
            entityName: { type: 'string', description: '实体名称（中文）' },
            buffs: {
                type: 'array',
                items: { type: 'object' },
                description: '完整 Buff 列表（整体覆写，格式见工具描述）'
            }
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
            const scope = (b.scope as BuffSetScope) ?? 'team'
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
                    // 层数类乘区（集谐干涉/同奏增益等）只填固定层数，丢弃引用
                    ...(z.ref && typeof z.ref === 'object' && !ZONE_NO_REF_IDS.has(zoneId)
                        ? { ref: z.ref as never }
                        : {})
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

defineTool('delete_buff_set_entity', {
    description: '从本地 Buff 集删除指定实体（不可恢复）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string', description: '实体类型：character/weapon/echo/1set-5set' },
            entityName: { type: 'string', description: '要删除的实体名称（中文）' }
        },
        required: ['entityType', 'entityName']
    },
    handler: async (args) => {
        const entityType = str(args.entityType)
        const entityName = str(args.entityName)
        await deleteBuffEntity(entityType as never, entityName)
        return { deleted: entityName }
    }
})

defineTool('clear_buff_set', {
    description: '清空整个本地 Buff 集（所有实体与 Buff，不可恢复）。',
    dangerous: true,
    parameters: { type: 'object', properties: {} },
    handler: () => {
        clearBuffSet()
        return { cleared: true }
    }
})
