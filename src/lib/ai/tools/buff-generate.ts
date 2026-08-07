// AI 生成工具：本地库实体生成 + 当前工程队伍生成（复用 share 生成流程；命名规则由用户从零定义并持久化）
import { defineTool } from './registry'
import { getActiveProject } from '$lib/data/project.svelte'
import { getBuffEntities, updateEntityBuffs, ENTITY_TYPES, loadBuffLibrary } from '$lib/data/buff-library.svelte'
import { getCharacterList, getWeaponList, getEchoList, getEchoSetList } from '$lib/data/api'
import { importBuffSets } from '$lib/components/page/home/calculation/calculation.store.svelte'
import type { ImportBuffInput } from '$lib/components/page/home/calculation/calculation.store.svelte'
import { generateBuffSet } from '../generate'
import {
    createLibraryDataSource,
    createProjectDataSource,
    type GenerateEntityType,
    type GeneratedBuff
} from '../generate/tools'
import { getNamingRule, loadGenPrefs, updateGenPrefs } from '$lib/data/ai-prefs.svelte'
import { ownerIdxFor } from '$lib/components/page/home/buff-import-utils'
import { getAiConfig } from '../config.svelte'

const str = (v: unknown): string => String(v ?? '').trim()

// 命名规则解析：工具参数优先（并记住）；否则用已保存的；都没有 → 提示先询问用户
async function resolveNamingRule(argsRule: string): Promise<{ rule: string; missing: boolean }> {
    await loadGenPrefs()
    const r = argsRule.trim()
    if (r) {
        updateGenPrefs({ namingRule: r })
        return { rule: r, missing: false }
    }
    const stored = getNamingRule()
    if (stored) return { rule: stored, missing: false }
    return { rule: '', missing: true }
}

const NEEDS_RULE_MSG =
    '尚未定义 Buff 命名规则。请先询问用户希望如何为 Buff 命名（完全由用户从零定义，无预设风格），然后用 set_naming_rule 保存用户给出的规则，再重新调用生成工具。'

function aiRuntime() {
    const cfg = getAiConfig()
    return {
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        reasoningEffort: cfg.reasoningEffort as 'low' | 'medium' | 'high'
    }
}

// 实体列表（与生成流程数据源一致）
async function entityNames(type: GenerateEntityType): Promise<string[]> {
    if (type === 'character') return (await getCharacterList()).map((c) => c.name)
    if (type === 'weapon') return (await getWeaponList()).map((w) => w.name)
    if (type === 'echo') return (await getEchoList()).map((e) => e.name)
    const pieces = Number(type.replace('set', ''))
    return (await getEchoSetList()).filter((s) => s.pieces.includes(pieces)).map((s) => s.name)
}

defineTool('list_entities', {
    description:
        '列出某类游戏实体的全部名称（character=角色 / weapon=武器 / echo=声骸 / 1set-5set=声骸套装件数）。用于定位实体名，供 get_entity_info 查询详情或生成 Buff。',
    parameters: {
        type: 'object',
        properties: { entityType: { type: 'string', description: '实体类型' } },
        required: ['entityType']
    },
    handler: async (args) => {
        const type = str(args.entityType)
        if (!ENTITY_TYPES.includes(type as never)) throw new Error(`无效实体类型：${type}`)
        const names = await entityNames(type as GenerateEntityType)
        return { entityType: type, count: names.length, names }
    }
})

defineTool('search_entities', {
    description: '按关键词模糊搜索游戏实体名称（角色/武器/声骸/套装任意类型），用于定位准确名称后再查详情。',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: '搜索关键词（中文片段）' },
            entityType: { type: 'string', description: '可选：只搜该类型' }
        },
        required: ['query']
    },
    handler: async (args) => {
        const query = str(args.query)
        if (!query) throw new Error('缺少搜索关键词')
        const types: GenerateEntityType[] =
            str(args.entityType) && ENTITY_TYPES.includes(str(args.entityType) as never)
                ? [str(args.entityType) as GenerateEntityType]
                : (ENTITY_TYPES as readonly string[]).map((t) => t as GenerateEntityType)
        const matches: Array<{ entityType: string; name: string }> = []
        for (const t of types) {
            const names = await entityNames(t)
            for (const n of names) {
                if (n.includes(query)) matches.push({ entityType: t, name: n })
            }
        }
        return { query, count: matches.length, matches: matches.slice(0, 30) }
    }
})

defineTool('get_entity_info', {
    description:
        '查询实体的官方游戏数据详情：角色（技能/命座/固有属性）、武器（效果）、声骸（技能）、套装（各件数加成）。用于向用户说明实体机制、核对生成内容，或判断该实体适合生成哪些 Buff。',
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string', description: '实体类型' },
            entityName: { type: 'string', description: '实体名称（中文，用 list_entities / search_entities 定位）' }
        },
        required: ['entityType', 'entityName']
    },
    handler: async (args) => {
        const entityType = str(args.entityType)
        const entityName = str(args.entityName)
        if (!ENTITY_TYPES.includes(entityType as never)) throw new Error(`无效实体类型：${entityType}`)
        if (!entityName) throw new Error('实体名不能为空')
        const info = await createLibraryDataSource().getEntityInfo(entityType as GenerateEntityType, entityName)
        if (info === null)
            throw new Error(`未找到「${entityName}」的信息，请先用 list_entities / search_entities 确认名称`)
        return info
    }
})

defineTool('get_naming_rule', {
    description: '获取当前已保存的 Buff 命名规则（用户自定义）。返回空字符串表示尚未定义，生成前需要先询问用户。',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        await loadGenPrefs()
        return { namingRule: getNamingRule() }
    }
})

defineTool('set_naming_rule', {
    description:
        '保存用户自定义的 Buff 命名规则（由用户从零定义，无预设风格，可能包含格式示例/简写习惯等）。保存后生成 Buff 会自动遵守。',
    parameters: {
        type: 'object',
        properties: { rule: { type: 'string', description: '用户给出的完整命名规则描述' } },
        required: ['rule']
    },
    handler: async (args) => {
        const rule = str(args.rule)
        if (!rule) throw new Error('命名规则不能为空')
        await updateGenPrefs({ namingRule: rule })
        return { saved: rule }
    }
})

defineTool('generate_entity_buffs', {
    description:
        '为本地 Buff 库中的指定实体（character/weapon/echo/1set-5set）生成 Buff 集并写入本地库（整体覆写该实体，来源变为自定义）。该工具会自动查询实体官方详情（角色技能/命座/武器效果等）并提取 Buff，无需先调用其它查询工具；生成前若未定义命名规则会先询问用户。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string', description: '实体类型' },
            entityName: { type: 'string', description: '实体名称（中文）' },
            namingRule: { type: 'string', description: '可选：用户新定义的命名规则（会记住）' }
        },
        required: ['entityType', 'entityName']
    },
    handler: async (args, ctx) => {
        const entityType = str(args.entityType)
        const entityName = str(args.entityName)
        if (!ENTITY_TYPES.includes(entityType as never)) throw new Error(`无效实体类型：${entityType}`)
        if (!entityName) throw new Error('实体名不能为空')
        await loadBuffLibrary()
        const entity = getBuffEntities().find((e) => e.entityType === entityType && e.entityName === entityName)
        if (!entity)
            throw new Error(
                `本地 Buff 库中未找到「${entityName}」（可先 sync_buff_library_from_share 或让用户手动导入）`
            )
        const { rule, missing } = await resolveNamingRule(str(args.namingRule))
        if (missing) throw new Error(NEEDS_RULE_MSG)

        const result = await generateBuffSet({
            ...aiRuntime(),
            entityType,
            entityName,
            namingRule: rule,
            data: createLibraryDataSource(),
            onProgress: (t) => ctx.onGenerateProgress?.(t)
        })
        if (!result.buffs) throw new Error(`生成失败：${result.parseError ?? '未知错误'}`)

        await updateEntityBuffs(entityType as never, entityName, result.buffs as never)
        return {
            entityType,
            entityName,
            generated: result.buffs.length,
            buffNames: result.buffs.map((b) => b.buffName)
        }
    }
})

defineTool('generate_project_buffs', {
    description:
        '为当前工程队伍中的实体（角色/武器/首位声骸/触发套装）逐个生成 Buff 集并导入当前工程拉表（含归属绑定）。该工具会自动查询各实体官方详情并提取 Buff，无需先调用其它查询工具。默认遍历全队，可用 slot（1-3）或 entityType 过滤。生成前若未定义命名规则会先询问用户。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            slot: { type: 'number', description: '可选：只处理该槽位（1-3）' },
            entityType: { type: 'string', description: '可选：只处理该实体类型' },
            namingRule: { type: 'string', description: '可选：用户新定义的命名规则（会记住）' }
        }
    },
    handler: async (args, ctx) => {
        const project = getActiveProject()
        if (!project) throw new Error('当前没有活动工程')

        const slotArg = args.slot === undefined || args.slot === null ? null : Number(args.slot)
        if (slotArg !== null && (!Number.isInteger(slotArg) || slotArg < 1 || slotArg > 3)) {
            throw new Error('slot 须为 1-3')
        }
        const typeArg = str(args.entityType) || null
        if (typeArg && !ENTITY_TYPES.includes(typeArg as never)) throw new Error(`无效实体类型：${typeArg}`)
        const { rule, missing } = await resolveNamingRule(str(args.namingRule))
        if (missing) throw new Error(NEEDS_RULE_MSG)

        // 收集队伍实体
        const entities: Array<{ entityType: string; entityName: string }> = []
        project.team.forEach((slot, i) => {
            if (slotArg !== null && i !== slotArg - 1) return
            if (slot.character && (!typeArg || typeArg === 'character'))
                entities.push({ entityType: 'character', entityName: slot.character })
            if (slot.weapon && (!typeArg || typeArg === 'weapon'))
                entities.push({ entityType: 'weapon', entityName: slot.weapon })
            if (slot.echoes?.[0]?.name && (!typeArg || typeArg === 'echo'))
                entities.push({ entityType: 'echo', entityName: slot.echoes[0].name })
            for (const s of slot.triggerSets ?? []) {
                const et = `${s.pieces}set`
                if (!typeArg || typeArg === et) entities.push({ entityType: et, entityName: s.name })
            }
        })
        if (entities.length === 0) throw new Error('当前工程队伍中没有可生成的实体')

        // 逐个生成
        const cfg = aiRuntime()
        const succeeded: Array<{ entityType: string; entityName: string; buffs: GeneratedBuff[] }> = []
        const failed: Array<{ entityType: string; entityName: string; reason: string }> = []
        for (let i = 0; i < entities.length; i++) {
            const e = entities[i]
            ctx.onGenerateProgress?.(`正在生成（${i + 1}/${entities.length}）：${e.entityName}`)
            const result = await generateBuffSet({
                ...cfg,
                entityType: e.entityType,
                entityName: e.entityName,
                namingRule: rule,
                data: createProjectDataSource(),
                onProgress: (t) => ctx.onGenerateProgress?.(t)
            })
            if (result.buffs) {
                succeeded.push({ entityType: e.entityType, entityName: e.entityName, buffs: result.buffs })
            } else {
                failed.push({
                    entityType: e.entityType,
                    entityName: e.entityName,
                    reason: result.parseError ?? '未知错误'
                })
                ctx.onGenerateProgress?.(`生成失败，已跳过：${e.entityName}（${failed[failed.length - 1].reason}）`)
            }
        }
        if (succeeded.length === 0) throw new Error('全部实体生成失败，未导入任何 Buff')

        // 组装导入条目（ownerIdx 归属，复用 buff-import-utils）
        const team = project.team
        const items: ImportBuffInput[] = []
        for (const { entityType, entityName, buffs } of succeeded) {
            const owners = ownerIdxFor(team, { entityType, entityName })
            const firstOwner = owners[0] ?? -1
            for (const b of buffs) {
                items.push({
                    name: b.buffName ?? '',
                    scope: b.scope as ImportBuffInput['scope'],
                    ownerIdx: firstOwner,
                    ...(b.condition ? { condition: b.condition as never } : {}),
                    zones: (b.zones ?? []).map((z) => ({
                        zoneId: z.zoneId ?? '',
                        value: z.value ?? 0,
                        ...(z.override ? { override: true } : {}),
                        ...(z.ref ? { ref: z.ref as never } : {})
                    }))
                })
            }
        }
        const count = importBuffSets(items, -1, 3)
        ctx.notifyCalc?.()
        return {
            generated: count,
            totalEntities: entities.length,
            succeededEntities: succeeded.length,
            failedEntities: failed.length,
            failed: failed.map((f) => `${f.entityName}（${f.reason}）`),
            buffNames: succeeded.flatMap((s) => s.buffs.map((b) => b.buffName))
        }
    }
})
