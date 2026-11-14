// 本地 Buff 集域工具（Phase 2）：同步、查询、编辑、删除
import { defineTool } from './registry'
import {
    getBuffEntities,
    fetchBuffSetsFromShare,
    updateEntityBuffs,
    updateEntityFolders,
    deleteBuffEntity,
    clearBuffLibrary as clearBuffSet,
    ENTITY_TYPES,
    mergeFolders,
    type BuffLibraryScope as BuffSetScope
} from '$lib/data/buff-library.svelte'
import { ZONE_NO_REF_IDS } from '$lib/calc/calculation.consts'
import { buffFolderPath, buffLeafName, joinBuffPath, sanitizeLeafName } from '$lib/calc/buff-name'

const str = (v: unknown): string => String(v ?? '').trim()
const SCOPES: BuffSetScope[] = ['self', 'self_except', 'team', 'team_only', 'effect_only']

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
                folderCount: e.folders.length,
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
            folders: entity.folders,
            buffs: entity.buffs.map((b) => ({
                buffName: b.buffName,
                shortName: buffLeafName(b.buffName),
                scope: b.scope,
                exclusive: !!b.exclusive,
                rules: b.rules ?? [],
                zones: b.zones
            }))
        }
    }
})

defineTool('update_buff_set_entity_buffs', {
    description:
        '整体覆写主页的本地 Buff 集中指定实体的 Buff 列表；仅在用户明确要求维护 Buff 集时使用，不用于给工程配 Buff（该实体来源变为 custom）。buffName 必须是全名（文件夹A\\buff名，根 Buff 直接写短名）；folders 可传空文件夹/排序。buffs 结构：[{"buffName":"文件夹A\\\\buff名","scope":"self|self_except|team_only|team|effect_only","exclusive":false,"rules":[...可选],"zones":[...]}]。scope 语义：self=自己 / self_except=自己除外 / team_only=全队（仅三名角色，不含效应）/ team=通用（三名角色 + 效应）/ effect_only=效应专属。rules 是 Buff 级门槛（全部 AND，**同一种 kind 只能有一条**），库内允许 kind：chain（min 0-6）、refinement（min 1-5）、damageNameRegex（pattern）、zoneCompare（charIdx 只有 0=本角色 / -1=出伤者，zone 取 atk/hp/def/recharge/offTuneBuildupRate/critRate/critDmg，op 取 ge/gt/eq/le/lt）、enemyType（types 数组，多选：BOSS/精英怪/小怪）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string', description: '实体类型：character/weapon/echo/1set-5set' },
            entityName: { type: 'string', description: '实体名称（中文）' },
            buffs: {
                type: 'array',
                items: { type: 'object' },
                description: '完整 Buff 列表（整体覆写，buffName 为全名，格式见工具描述）'
            },
            folders: {
                type: 'array',
                items: { type: 'object' },
                description: '可选：一级文件夹列表 [{name, sortOrder}]，用于保留空文件夹/排序'
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
                ...(b.rules && Array.isArray(b.rules) ? { rules: b.rules as never } : {}),
                zones
            }
        })
        const folders = Array.isArray(args.folders)
            ? args.folders
                  .map((raw) => {
                      const f = (raw ?? {}) as Record<string, unknown>
                      return { name: sanitizeLeafName(str(f.name)), sortOrder: Number(f.sortOrder) || 0 }
                  })
                  .filter((f) => f.name && !f.name.includes('\\'))
            : undefined
        await updateEntityBuffs(entityType as never, entityName, buffs as never, folders)
        return { updated: buffs.length }
    }
})

defineTool('list_buff_set_folders', {
    description: '列出本地 Buff 集某实体的一级文件夹（含空文件夹与排序）。',
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string', description: '实体类型：character/weapon/echo/1set-5set' },
            entityName: { type: 'string', description: '实体名称' }
        },
        required: ['entityType', 'entityName']
    },
    handler: (args) => {
        const entityType = str(args.entityType)
        const entityName = str(args.entityName)
        const entity = getBuffEntities().find((e) => e.entityType === entityType && e.entityName === entityName)
        if (!entity) throw new Error(`未找到「${entityName}」`)
        return { entityType, entityName, source: entity.source, folders: entity.folders }
    }
})

const customEntityOf = (entityType: string, entityName: string) => {
    if (!ENTITY_TYPES.includes(entityType as never)) throw new Error(`无效实体类型：${entityType}`)
    const entity = getBuffEntities().find((e) => e.entityType === entityType && e.entityName === entityName)
    if (!entity) throw new Error(`未找到「${entityName}」`)
    if (entity.source !== 'custom') throw new Error('工坊来源实体的文件夹结构只读；请先复制为自定义实体')
    return entity
}

defineTool('create_buff_set_folder', {
    description: '在本地自定义 Buff 集实体中新建一级文件夹（工坊来源实体只读）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string', description: '实体类型' },
            entityName: { type: 'string', description: '实体名称' },
            name: { type: 'string', description: '文件夹短名（不能含 \\）' }
        },
        required: ['entityType', 'entityName', 'name']
    },
    handler: async (args) => {
        const entity = customEntityOf(str(args.entityType), str(args.entityName))
        const name = sanitizeLeafName(str(args.name))
        if (!name) throw new Error('文件夹名不能为空')
        const folders = mergeFolders([...entity.folders, { name, sortOrder: entity.folders.length }], entity.buffs)
        await updateEntityFolders(entity.entityType, entity.entityName, folders)
        return { created: name }
    }
})

defineTool('rename_buff_set_folder', {
    description: '重命名本地自定义 Buff 集实体的文件夹；成员 Buff 的全名前缀会级联更新。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string', description: '实体类型' },
            entityName: { type: 'string', description: '实体名称' },
            oldName: { type: 'string', description: '原文件夹短名' },
            name: { type: 'string', description: '新文件夹短名（不能含 \\）' }
        },
        required: ['entityType', 'entityName', 'oldName', 'name']
    },
    handler: async (args) => {
        const entity = customEntityOf(str(args.entityType), str(args.entityName))
        const oldName = sanitizeLeafName(str(args.oldName))
        const name = sanitizeLeafName(str(args.name))
        if (!oldName || !name) throw new Error('文件夹名不能为空')
        const buffs = entity.buffs.map((buff) =>
            buffFolderPath(buff.buffName)[0] === oldName
                ? { ...buff, buffName: joinBuffPath(name, buffLeafName(buff.buffName)) }
                : buff
        )
        const folders = mergeFolders(
            entity.folders.map((folder) => (folder.name === oldName ? { ...folder, name } : folder)),
            buffs
        )
        await updateEntityBuffs(entity.entityType, entity.entityName, buffs, folders)
        return { renamed: { oldName, name } }
    }
})

defineTool('delete_buff_set_folder', {
    description: '删除本地自定义 Buff 集实体的一级文件夹；成员 Buff 移回根目录，不删除 Buff。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string', description: '实体类型' },
            entityName: { type: 'string', description: '实体名称' },
            name: { type: 'string', description: '文件夹短名' }
        },
        required: ['entityType', 'entityName', 'name']
    },
    handler: async (args) => {
        const entity = customEntityOf(str(args.entityType), str(args.entityName))
        const name = sanitizeLeafName(str(args.name))
        if (!name) throw new Error('文件夹名不能为空')
        const buffs = entity.buffs.map((buff) =>
            buffFolderPath(buff.buffName)[0] === name ? { ...buff, buffName: buffLeafName(buff.buffName) } : buff
        )
        const folders = mergeFolders(
            entity.folders.filter((folder) => folder.name !== name),
            buffs
        )
        await updateEntityBuffs(entity.entityType, entity.entityName, buffs, folders)
        return { deleted: name }
    }
})

defineTool('move_buff_set_buff_to_folder', {
    description:
        '把本地自定义 Buff 集实体的一条 Buff 移入一级文件夹（folder 省略/空 = 移回根）；短名不变，全名前缀级联更新。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string', description: '实体类型' },
            entityName: { type: 'string', description: '实体名称' },
            buffName: { type: 'string', description: '当前 Buff 全名' },
            folder: { type: 'string', description: '目标文件夹短名；空 = 根' }
        },
        required: ['entityType', 'entityName', 'buffName']
    },
    handler: async (args) => {
        const entity = customEntityOf(str(args.entityType), str(args.entityName))
        const buffName = str(args.buffName)
        const folder = sanitizeLeafName(str(args.folder))
        const hit = entity.buffs.find((buff) => buff.buffName === buffName)
        if (!hit) throw new Error(`未找到 Buff「${buffName}」`)
        const buffs = entity.buffs.map((buff) =>
            buff === hit ? { ...buff, buffName: joinBuffPath(folder, buffLeafName(buff.buffName)) } : buff
        )
        const folders = folder
            ? mergeFolders([...entity.folders, { name: folder, sortOrder: entity.folders.length }], buffs)
            : mergeFolders(entity.folders, buffs)
        await updateEntityBuffs(entity.entityType, entity.entityName, buffs, folders)
        return { moved: hit.buffName, to: folder || null }
    }
})

defineTool('reorder_buff_set_folder', {
    description: '把本地自定义 Buff 集实体的一级文件夹上移/下移一位（delta=-1/1）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string', description: '实体类型' },
            entityName: { type: 'string', description: '实体名称' },
            name: { type: 'string', description: '文件夹短名' },
            delta: { type: 'number', description: '-1 上移 / 1 下移' }
        },
        required: ['entityType', 'entityName', 'name', 'delta']
    },
    handler: async (args) => {
        const entity = customEntityOf(str(args.entityType), str(args.entityName))
        const name = sanitizeLeafName(str(args.name))
        const delta = Number(args.delta) === 1 ? 1 : -1
        const index = entity.folders.findIndex((folder) => folder.name === name)
        const target = index + delta
        if (index < 0 || target < 0 || target >= entity.folders.length) throw new Error('文件夹不存在或已经到边界')
        const next = [...entity.folders]
        const [item] = next.splice(index, 1)
        next.splice(target, 0, item)
        await updateEntityFolders(
            entity.entityType,
            entity.entityName,
            next.map((folder, i) => ({ ...folder, sortOrder: i }))
        )
        return { moved: name, delta }
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
