// 生成工具集：15 个工具 schema + 执行器（移植自 wuwa-afyg-share src/lib/ai/tools.ts），数据源按目标注入
import {
    getCharacterList,
    getWeaponList,
    getEchoList,
    getEchoSetList,
    getCharacterInfo,
    getWeaponInfo,
    getEchoInfo,
    getEchoSetInfo
} from '$lib/data/api'
import { providerQuery } from '$lib/api/provider'
import { getBuffEntities } from '$lib/data/buff-library.svelte'
import { getAllBuffSets } from '$lib/components/page/home/calculation/calculation.store.svelte'
import {
    ZONE_DEFS,
    ZONE_MAP,
    ZONE_REF_DEFS,
    ZONE_REF_MAP
} from '$lib/components/page/home/calculation/calculation.consts'
import { DEFAULT_SLANG_DICT, EFFECTS_TEXT, SCOPE_RULES_TEXT, EXAMPLES_TEXT, REF_RULES_TEXT } from './prompts.config'
import { renderConditionRules, renderNamingRules } from './prompts'
import { analyzeCharacterTerms } from './terms'
import { sanitizeCondition } from './sanitize'
import type { GeneratedBuff } from './sanitize'

export type { GeneratedBuff }

export const ENTITY_TYPES = ['character', 'weapon', 'echo', '1set', '2set', '3set', '4set', '5set'] as const
export type GenerateEntityType = (typeof ENTITY_TYPES)[number]

export interface ToolDefinition {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: Record<string, unknown>
    }
}

function validEntityType(v: unknown): v is GenerateEntityType {
    return typeof v === 'string' && (ENTITY_TYPES as readonly string[]).includes(v)
}

// ── 数据源（按生成目标注入：本地 Buff 库 / 当前工程）──

export interface BuffSetRowLike {
    buff_name: string
    scope?: string
    exclusive?: boolean
    condition?: unknown
    buff_set?: Array<{ zoneId?: string; value?: number; override?: boolean }>
}

export interface GenerateDataSource {
    listEntities(entityType: GenerateEntityType): Promise<string[]>
    getEntityInfo(entityType: GenerateEntityType, entityName: string): Promise<unknown | null>
    getCharacterTerms(entityName: string): Promise<unknown>
    getBuffSets(
        entityType?: string,
        entityName?: string,
        query?: string
    ): Promise<{ total: number; buffSets: BuffSetRowLike[] }>
}

function includesQuery(name: string, query: string): boolean {
    return !query || name.includes(query)
}

// 本地 Buff 库模式：get_buff_sets 查库内已收录实体
export function createLibraryDataSource(): GenerateDataSource {
    return {
        async listEntities(entityType) {
            if (entityType === 'character') return (await getCharacterList()).map((c) => c.name)
            if (entityType === 'weapon') return (await getWeaponList()).map((w) => w.name)
            if (entityType === 'echo') return (await getEchoList()).map((e) => e.name)
            const pieces = Number(entityType.replace('set', ''))
            return (await getEchoSetList()).filter((s) => s.pieces.includes(pieces)).map((s) => s.name)
        },
        async getEntityInfo(entityType, entityName) {
            try {
                if (entityType === 'character') return summarizeAiInfo(entityType, await getCharacterInfo(entityName))
                if (entityType === 'weapon') return summarizeAiInfo(entityType, await getWeaponInfo(entityName))
                if (entityType === 'echo') return summarizeAiInfo(entityType, await getEchoInfo(entityName))
                return summarizeAiInfo(entityType, await getEchoSetInfo(entityName))
            } catch {
                return null
            }
        },
        async getCharacterTerms(entityName) {
            const res = await fetch(`/api/v2/info/character/${encodeURIComponent(entityName)}${providerQuery()}`, {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            })
            if (!res.ok)
                return {
                    error: res.status === 404 ? `未找到角色「${entityName}」` : `v2 接口失败（HTTP ${res.status}）`
                }
            const info = await res.json()
            if ((info as { error?: string }).error) return info
            return analyzeCharacterTerms(entityName, info)
        },
        async getBuffSets(entityType, entityName, query) {
            const entities = getBuffEntities().filter(
                (e) =>
                    (!entityType || e.entityType === entityType) &&
                    (!entityName || e.entityName === entityName) &&
                    includesQuery(e.entityName, query ?? '')
            )
            const buffSets: BuffSetRowLike[] = []
            for (const e of entities) {
                for (const b of e.buffs) {
                    if (!includesQuery(b.buffName, query ?? '')) continue
                    buffSets.push({
                        buff_name: b.buffName,
                        scope: b.scope,
                        exclusive: b.exclusive,
                        condition: b.condition,
                        buff_set: b.zones.map((z) => ({
                            zoneId: z.zoneId,
                            value: z.value,
                            ...(z.override ? { override: true } : {})
                        }))
                    })
                }
            }
            return { total: buffSets.length, buffSets }
        }
    }
}

// 当前工程模式：get_buff_sets 查当前工程拉表内的 Buff 集
export function createProjectDataSource(): GenerateDataSource {
    return {
        async listEntities(entityType) {
            if (entityType === 'character') return (await getCharacterList()).map((c) => c.name)
            if (entityType === 'weapon') return (await getWeaponList()).map((w) => w.name)
            if (entityType === 'echo') return (await getEchoList()).map((e) => e.name)
            const pieces = Number(entityType.replace('set', ''))
            return (await getEchoSetList()).filter((s) => s.pieces.includes(pieces)).map((s) => s.name)
        },
        async getEntityInfo(entityType, entityName) {
            try {
                if (entityType === 'character') return summarizeAiInfo(entityType, await getCharacterInfo(entityName))
                if (entityType === 'weapon') return summarizeAiInfo(entityType, await getWeaponInfo(entityName))
                if (entityType === 'echo') return summarizeAiInfo(entityType, await getEchoInfo(entityName))
                return summarizeAiInfo(entityType, await getEchoSetInfo(entityName))
            } catch {
                return null
            }
        },
        async getCharacterTerms(entityName) {
            const res = await fetch(`/api/v2/info/character/${encodeURIComponent(entityName)}${providerQuery()}`, {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            })
            if (!res.ok)
                return {
                    error: res.status === 404 ? `未找到角色「${entityName}」` : `v2 接口失败（HTTP ${res.status}）`
                }
            const info = await res.json()
            if ((info as { error?: string }).error) return info
            return analyzeCharacterTerms(entityName, info)
        },
        async getBuffSets(_entityType, entityName, query) {
            const buffSets: BuffSetRowLike[] = getAllBuffSets()
                .filter((bs) => (!entityName || bs.name === entityName) && includesQuery(bs.name, query ?? ''))
                .map((bs) => ({
                    buff_name: bs.name,
                    scope: bs.scope === 'all' ? 'all' : JSON.stringify(bs.scope),
                    condition: bs.condition,
                    buff_set: bs.zones.map((z) => ({
                        zoneId: z.zoneId,
                        value: z.value,
                        ...(z.override ? { override: true } : {})
                    }))
                }))
            return { total: buffSets.length, buffSets }
        }
    }
}

// ── 工具 schema ──
export const GENERATE_TOOLS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'list_entities',
            description: '列出某个实体类型的全部实体名称（角色/武器/声骸/声骸套装）。返回实体名数组。',
            parameters: {
                type: 'object',
                properties: { entityType: { type: 'string', enum: ENTITY_TYPES, description: '实体类型' } },
                required: ['entityType']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_entities',
            description:
                '按关键词模糊搜索实体名称（支持角色/武器/声骸/套装任意类型）。实体很多时用它定位准确名称，再调用 get_entity_info。',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: '搜索关键词（中文片段）' },
                    entityType: {
                        type: 'string',
                        enum: ENTITY_TYPES,
                        description: '实体类型（可选，不填则搜全部类型）'
                    }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_entity_info',
            description:
                '获取单个实体的官方信息（角色技能/武器效果/声骸技能/套装加成等），用于提取增益 Buff。返回精简后的 JSON。',
            parameters: {
                type: 'object',
                properties: {
                    entityType: { type: 'string', enum: ENTITY_TYPES },
                    entityName: { type: 'string', description: '实体名称（中文）' }
                },
                required: ['entityType', 'entityName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_character_terms',
            description:
                '按需获取某角色的结构化术语速查：效果名【】、触发关键词（Highlight）、术语链接，以及每条技能/共鸣链（俗称命座）/固有去标签后的纯文本摘要。用于识别 buff 名称的触发来源与归属、以及判定元素/效果。',
            parameters: {
                type: 'object',
                properties: { entityName: { type: 'string', description: '角色名称（中文）' } },
                required: ['entityName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_buff_sets',
            description:
                '查询已收录的 Buff 集（本地 Buff 库或当前工程拉表）。可按实体类型/实体名精确过滤，或用 query 模糊搜索实体名或 buff 名。返回现有 buff 的 buff_name/scope/exclusive/乘区数值，用于对比、去重或核对。',
            parameters: {
                type: 'object',
                properties: {
                    entityType: { type: 'string', enum: ENTITY_TYPES, description: '实体类型（可选）' },
                    entityName: { type: 'string', description: '实体名称（可选，精确匹配）' },
                    query: { type: 'string', description: '模糊搜索关键词（可选）' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_editing_context',
            description:
                '获取当前正在生成的实体：实体类型、实体名，以及该实体已收录的全部 Buff（用于了解现状、避免重复）。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'diff_buffs',
            description:
                '将你拟定的 buff 列表与已收录的 buff 做差异对比，返回「新增/需修改/重复/可删除」清单。用于精准增改、避免与已有内容冲突。',
            parameters: {
                type: 'object',
                properties: {
                    entityType: { type: 'string', enum: ENTITY_TYPES, description: '实体类型（可选，默认当前实体）' },
                    entityName: { type: 'string', description: '实体名称（可选，默认当前实体）' },
                    buffs: { type: 'array', description: '拟定的 buff 列表', items: { type: 'object' } }
                },
                required: ['buffs']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_zone',
            description: '获取某个乘区（zoneId）的说明（含义/单位/判定提示），用于确认该增益应归入哪个乘区。',
            parameters: {
                type: 'object',
                properties: { zoneId: { type: 'string', description: '乘区 id（乘区或引用乘区）' } },
                required: ['zoneId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_effects',
            description: '获取游戏内六种"效应"的说明（光噪/霜渐/聚爆/电磁/风蚀/虚湮），以及效应专属 buff 的映射规则。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_scope_rules',
            description: '获取受影响者（scope）的取值与判定细则（self/self_except/team/effect_only）。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_condition_rules',
            description:
                '获取 Buff 生效条件（condition）的取值与判定细则（角色共鸣链 chain / 武器精炼 refinement / 伤害属性 elements / 伤害类型 damageTypes，多字段可并存）。当某增益确实存在共鸣链/精炼门槛或属性/类型限定时调用。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_ref_rules',
            description:
                '获取引用乘区（ref）的转模字段规则（threshold 阈值 / 线性 pct / 离散 discrete+divisor+multiplier / lower、upper 上下限 / refOwner）。当增益数值按"某属性百分比"、"每 X 转 Y"、"超过 X 的部分"、"最高/至少"等规则换算时调用。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_slang_dict',
            description: '获取黑话词典（官方/生僻叫法 → 玩家黑话），用于 buff 命名优化。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_naming_rules',
            description:
                '获取当前 Buff 命名规则（用户自定义规则或默认要求，含叠层/精炼拆分硬性要求）。开始命名前调用。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_examples',
            description: '获取 few-shot 示例（声骸套装/武器叠层/角色引用属性的输入输出对照），用于理解格式与判定。',
            parameters: { type: 'object', properties: {} }
        }
    }
]

export interface GenerateToolContext {
    entityType: GenerateEntityType
    entityName: string
    namingRule: string
    slangDict: string
    data: GenerateDataSource
}

// ── 执行器 ──
export async function executeGenerateTool(
    ctx: GenerateToolContext,
    name: string,
    args: Record<string, unknown>
): Promise<string> {
    const { entityType: curType, entityName: curName, namingRule, data } = ctx

    switch (name) {
        case 'list_entities': {
            const entityType = args.entityType
            if (!validEntityType(entityType)) return JSON.stringify({ error: '无效的实体类型' })
            const list = await data.listEntities(entityType)
            return JSON.stringify({ entityType, count: list.length, names: list })
        }
        case 'search_entities': {
            const query = typeof args.query === 'string' ? args.query.trim() : ''
            if (!query) return JSON.stringify({ error: '缺少搜索关键词' })
            const types: GenerateEntityType[] = validEntityType(args.entityType)
                ? [args.entityType as GenerateEntityType]
                : [...ENTITY_TYPES]
            const results: Array<{ entityType: string; name: string }> = []
            for (const t of types) {
                const list = await data.listEntities(t)
                for (const e of list) {
                    if (e.includes(query)) results.push({ entityType: t, name: e })
                }
            }
            return JSON.stringify({ query, count: results.length, matches: results.slice(0, 30) })
        }
        case 'get_entity_info': {
            const entityType = args.entityType
            const entityName = typeof args.entityName === 'string' ? args.entityName.trim() : ''
            if (!validEntityType(entityType)) return JSON.stringify({ error: '无效的实体类型' })
            if (!entityName) return JSON.stringify({ error: '缺少实体名' })
            const info = await data.getEntityInfo(entityType, entityName)
            if (info === null) return JSON.stringify({ error: `未找到「${entityName}」的信息` })
            return JSON.stringify(info)
        }
        case 'get_character_terms': {
            const entityName = typeof args.entityName === 'string' ? args.entityName.trim() : ''
            if (!entityName) return JSON.stringify({ error: '缺少实体名' })
            const res = await data.getCharacterTerms(entityName)
            return JSON.stringify(res)
        }
        case 'get_buff_sets': {
            const entityType = validEntityType(args.entityType) ? (args.entityType as string) : undefined
            const entityName = typeof args.entityName === 'string' ? args.entityName.trim() : undefined
            const query = typeof args.query === 'string' ? args.query.trim() : undefined
            const data2 = await data.getBuffSets(entityType, entityName, query)
            return JSON.stringify(data2)
        }
        case 'get_editing_context': {
            const buffSets = await data.getBuffSets(curType, curName)
            return JSON.stringify({ entityType: curType, entityName: curName, ...(buffSets as object) })
        }
        case 'diff_buffs': {
            const entityType = validEntityType(args.entityType) ? (args.entityType as GenerateEntityType) : curType
            const entityName =
                typeof args.entityName === 'string' && args.entityName.trim() ? args.entityName.trim() : curName
            const proposed = Array.isArray(args.buffs) ? (args.buffs as ProposedBuff[]) : []
            const existingRaw = await data.getBuffSets(entityType, entityName)
            const existing = ((existingRaw as { buffSets?: BuffSetRowLike[] }).buffSets ?? []) as BuffSetRowLike[]
            return JSON.stringify(buildDiff(entityType, entityName, existing, proposed))
        }
        case 'get_zone': {
            const zoneId = typeof args.zoneId === 'string' ? args.zoneId.trim() : ''
            const def = ZONE_MAP.get(zoneId as never) ?? ZONE_REF_MAP.get(zoneId as never)
            if (!def) {
                const known = [...ZONE_DEFS.map((z) => z.id), ...ZONE_REF_DEFS.map((z) => z.id)]
                return JSON.stringify({ error: `未知乘区：${zoneId}`, knownZones: known })
            }
            return JSON.stringify({ zoneId: def.id, label: def.label, unit: def.unit })
        }
        case 'get_effects':
            return EFFECTS_TEXT
        case 'get_scope_rules':
            return SCOPE_RULES_TEXT
        case 'get_condition_rules':
            return renderConditionRules(curType)
        case 'get_ref_rules':
            return REF_RULES_TEXT
        case 'get_slang_dict':
            return ctx.slangDict?.trim() || DEFAULT_SLANG_DICT
        case 'get_naming_rules':
            return renderNamingRules(namingRule)
        case 'get_examples':
            return filterExamples(curType)
        default:
            return JSON.stringify({ error: `未知工具：${name}` })
    }
}

// 从 EXAMPLES_TEXT 中按实体类型过滤条件相关示例（示例7=chain 仅角色；示例8=refinement 仅武器）
function filterExamples(entityType: GenerateEntityType): string {
    const parts = EXAMPLES_TEXT.split('\n—— ')
    const keep: string[] = []
    parts.forEach((sec, i) => {
        if (i === 0) {
            keep.push(sec)
            return
        }
        if (sec.startsWith('示例7') && entityType !== 'character') return
        if (sec.startsWith('示例8') && entityType !== 'weapon') return
        keep.push(`—— ${sec}`)
    })
    return keep.join('\n')
}

interface ProposedBuff {
    buffName?: string
    scope?: string
    exclusive?: boolean
    condition?: Record<string, unknown>
    zones?: Array<{ zoneId?: string; value?: number; override?: boolean }>
}

// 比对已存 buff 与拟定 buff，返回差异清单
export function buildDiff(
    entityType: string,
    entityName: string,
    existing: BuffSetRowLike[],
    proposed: ProposedBuff[]
): unknown {
    const existingKeyed = new Map(existing.map((r) => [r.buff_name, r]))
    const proposedKeyed = new Map<string, ProposedBuff>()
    for (const p of proposed) {
        const name = p.buffName?.trim()
        if (name) proposedKeyed.set(name, p)
    }

    const toAdd: ProposedBuff[] = []
    const toModify: Array<{ buffName: string; old: BuffSetRowLike; next: ProposedBuff }> = []
    const duplicates: Array<{ buffName: string; existing: BuffSetRowLike }> = []
    const unchanged: string[] = []

    for (const [name, p] of proposedKeyed) {
        const e = existingKeyed.get(name)
        if (!e) {
            toAdd.push(p)
            continue
        }
        if (sameBuff(e, p)) {
            unchanged.push(name)
        } else {
            duplicates.push({ buffName: name, existing: e })
            toModify.push({ buffName: name, old: e, next: p })
        }
    }

    const toRemove: BuffSetRowLike[] = existing.filter((r) => !proposedKeyed.has(r.buff_name))

    return {
        entityType,
        entityName,
        summary: {
            totalExisting: existing.length,
            totalProposed: proposedKeyed.size,
            add: toAdd.length,
            modify: toModify.length,
            duplicate: duplicates.length,
            remove: toRemove.length,
            unchanged: unchanged.length
        },
        toAdd,
        toModify: toModify.map((m) => ({ buffName: m.buffName, old: m.old, next: m.next })),
        duplicates,
        toRemove: toRemove.map((r) => r.buff_name),
        unchanged
    }
}

function sameBuff(existing: BuffSetRowLike, p: ProposedBuff): boolean {
    if (existing.scope !== p.scope) return false
    if (!!existing.exclusive !== !!p.exclusive) return false
    const normCond = (c: unknown): string => {
        if (!c || typeof c !== 'object') return ''
        const o = c as Record<string, unknown>
        if (o.type === 'chain' || o.type === 'refinement') {
            const min = typeof o.min === 'number' ? Math.floor(o.min) : 0
            return `${o.type}:${min}`
        }
        const parts: string[] = []
        if (typeof o.chain === 'number') parts.push(`chain:${Math.floor(o.chain)}`)
        if (typeof o.refinement === 'number') parts.push(`refinement:${Math.floor(o.refinement)}`)
        if (Array.isArray(o.elements)) parts.push(`elements:${[...(o.elements as string[])].sort().join(',')}`)
        if (Array.isArray(o.damageTypes)) parts.push(`damageTypes:${[...(o.damageTypes as string[])].sort().join(',')}`)
        return parts.join('|')
    }
    if (normCond(existing.condition) !== normCond(p.condition)) return false
    const eZones = existing.buff_set ?? []
    const pZones = p.zones ?? []
    if (eZones.length !== pZones.length) return false
    const key = (z: { zoneId?: string; value?: number; override?: boolean }) =>
        `${z.zoneId}:${z.value}:${z.override ? 'o' : 'a'}`
    const eKeys = [...eZones].map(key).sort().join('|')
    const pKeys = pZones.map(key).sort().join('|')
    return eKeys === pKeys
}

// ── info 精简（供 AI 分析，只保留可量化增益相关）───────────
export function summarizeAiInfo(entityType: GenerateEntityType, info: unknown): unknown {
    if (!info || typeof info !== 'object') return info
    const o = info as Record<string, unknown>

    switch (entityType) {
        case 'weapon':
            return { effect: o.effect }
        case 'echo':
            return { cost: o.cost, skill: o.skill, groups: o.groups }
        case 'character':
            return {
                element: o.element,
                weaponType: o.weaponType,
                skills: o.skills,
                statNodes: o.statNodes,
                chains: o.chains
            }
        case '1set':
        case '2set':
        case '3set':
        case '4set':
        case '5set':
            return { bonuses: o.bonuses }
        default:
            return o
    }
}

export { sanitizeCondition }
