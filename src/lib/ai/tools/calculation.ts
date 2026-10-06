// 拉表/计算域工具（Phase 2）：伤害条目、工程 Buff 配置、绑定、伤害类型、链/阶配置、导入本地 Buff
import { defineTool } from './registry'
import {
    getAllBuffConfs,
    createBuffSet as createBuffConf,
    renameBuffSet as renameBuffConf,
    duplicateBuffSet as duplicateBuffConf,
    deleteBuffSet as deleteBuffConf,
    getBuffSetIdsForEntry as getBuffConfIdsForEntry,
    setBuffSetIdsForEntry as setBuffConfIdsForEntry,
    getDamageTypesForEntry,
    setDamageTypesForEntry,
    toggleDamageTypeForEntry,
    getConditionProfile,
    setConditionProfileChains,
    setConditionProfileRefinements,
    getHideConditionMismatch,
    toggleHideConditionMismatch,
    importBuffSets as importBuffConfs,
    getGlobalBuffSetIds as getGlobalBuffConfIds,
    getPaneEffectSources,
    setBuffSetScope as setBuffConfScope,
    setBuffSetCondition as setBuffConfCondition,
    setBuffSetZoneRef as setBuffConfZoneRef,
    setBuffSetZoneOverride as setBuffConfZoneOverride,
    setBuffSetZoneCondition as setBuffConfZoneCondition,
    getBuffSetZoneCondition as getBuffConfZoneCondition,
    addZoneToBuffSet as addZoneToBuffConf,
    removeZoneFromBuffSet as removeZoneFromBuffConf,
    setBuffSetZoneValue as setBuffConfZoneValue,
    undoTable,
    redoTable,
    canUndoTable,
    canRedoTable
} from '$lib/calc/calculation.store.svelte'
import { getBuffEntities } from '$lib/data/buff-library.svelte'
import { getActiveProject } from '$lib/data/project.svelte'
import { buildEntityImportItems } from '$lib/calc/buff-import-utils'
import { getOpBlocks, getRefLines } from '$lib/calc/timeline.store.svelte'
import { renderBuffConfList, renderCalculationDigest } from '$lib/ai/phase-digest'
import { buffConfsInOrder, damageEntriesInOrder, resolveBuffConf, resolveDamageEntry } from '$lib/ai/refs'
import { LEGACY_ZONE_IDS, resolveZoneId, ZONE_MAP, ZONE_NO_REF_IDS, ZONE_REF_MAP } from '$lib/calc/calculation.consts'
import { ELEMENTS, DAMAGE_TYPES } from '$lib/consts/game-terms'
import type { ZoneRef } from '$lib/calc/calculation.types'

const str = (v: unknown): string => String(v ?? '').trim()

/** @desc 条目来源（操作块 / 参考线 id）→ 时间轴像素位置；用于把拉表按时间顺序排 */
const timelinePosOf = (sourceId: string): number | undefined => {
    const op = getOpBlocks().find((b) => b.id === sourceId)
    if (op) return op.pos
    return getRefLines().find((r) => r.id === sourceId)?.pos
}
const CONDITION_KEYS = ['chain', 'refinement', 'elements', 'damageTypes'] as const
/** @desc 乘区级条件允许的 key（链/阶是 Buff 实例级硬门槛，不允许挂到乘区上） */
const ZONE_CONDITION_KEYS = ['elements', 'damageTypes'] as const

/**
 * @desc 把传入的乘区 id 归一化为当前 id（`customFinalDmg → specialFinal1`、`customFinalDmgMul → specialFinal2`），
 *  并对无法识别的 id 抛出带完整清单的错误。返回是否发生了旧 id 重映射，便于回传告知模型。
 */
const normalizeZoneId = (raw: string): { zoneId: string; remappedFrom?: string } => {
    const zoneId = resolveZoneId(raw)
    if (!ZONE_MAP.has(zoneId)) {
        throw new Error(
            `无效乘区：${raw}（可用：${[...ZONE_MAP.keys()].join('/')}；旧 id ${Object.keys(LEGACY_ZONE_IDS).join('/')} 会自动重映射）`
        )
    }
    return zoneId === raw ? { zoneId } : { zoneId, remappedFrom: raw }
}

/** @desc 构造「旧 id 重映射」提示字段（未发生重映射时返回空对象） */
const remapNote = (remappedFrom: string | undefined, zoneId: string): Record<string, unknown> =>
    remappedFrom ? { remappedFrom, remapNote: `旧乘区 id「${remappedFrom}」已重映射为当前 id「${zoneId}」` } : {}

function conditionSummary(c: Record<string, unknown> | undefined): string | undefined {
    if (!c) return undefined
    const parts: string[] = []
    for (const k of CONDITION_KEYS) {
        const v = (c as Record<string, unknown>)[k]
        if (v !== undefined && v !== null) parts.push(`${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    }
    return parts.length > 0 ? parts.join('，') : undefined
}

defineTool('get_damage_entries', {
    description:
        '获取当前工程的伤害条目（拉表）：**按条目在时间轴上的顺序**逐条给出「**序号** / 归属角色 / 名称 / 属性 / 伤害类型 / 已绑 Buff 名」。行首方括号里的数字就是序号，增删改（bind_buff_conf_to_entry / set_entry_damage_types / toggle_damage_type / get_damage_entry_buff_sources）填它。不含倍率与乘区数值——倍率用 get_timeline_damage_list，乘区与引用明细用 get_buff_conf_detail / get_damage_entry_buff_sources 按需查。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const nameById = new Map(getAllBuffConfs().map((b) => [b.id, b.name]))
        const buffNamesOf = (entryId: string): string[] =>
            getBuffConfIdsForEntry(entryId).map((id) => nameById.get(id) ?? id)
        return {
            calculation: renderCalculationDigest({
                // 序号真源：与 resolveDamageEntry 用同一套排序
                entries: damageEntriesInOrder(),
                buffNamesOf,
                damageTypesOf: (entryId) => getDamageTypesForEntry(entryId),
                posOf: (e) => timelinePosOf(e.sourceTimelineBlockId)
            })
        }
    }
})

defineTool('get_buff_confs', {
    description:
        '获取工程 Buff 配置清单（一行一条）：行首方括号里的数字就是**序号**（create/rename/delete/绑定/乘区工具都填它）、名称、作用范围（self/self_except/team/effect_only/all）、是否全局默认、生效条件、乘区条数。**不含各乘区的数值/引用**——那部分用 get_buff_conf_detail 按需查；某条目绑了哪些 Buff 见 get_damage_entries。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const globalIds = new Set(getGlobalBuffConfIds())
        return {
            buffConfs: renderBuffConfList(
                buffConfsInOrder().map((bs) => ({
                    id: bs.id,
                    name: bs.name,
                    scope: bs.scope,
                    global: globalIds.has(bs.id),
                    starred: !!bs.starred,
                    condition: conditionSummary(bs.condition as Record<string, unknown> | undefined),
                    zoneCount: bs.zones.length
                }))
            )
        }
    }
})

defineTool('create_buff_conf', {
    description:
        '创建一条空的工程 Buff 配置。返回新配置的**序号**（清单里的第几条，见 get_buff_confs），后续操作用这个序号。',
    parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '工程 Buff 配置名称' } },
        required: ['name']
    },
    handler: (args, ctx) => {
        const name = str(args.name)
        if (!name) throw new Error('名称不能为空')
        const id = createBuffConf(name)
        ctx.notifyCalc?.()
        return { created: name, buffConf: buffConfsInOrder().findIndex((b) => b.id === id) + 1 }
    }
})

defineTool('rename_buff_conf', {
    description: '重命名指定工程 Buff 配置（按**序号**）。',
    parameters: {
        type: 'object',
        properties: {
            buffConf: { type: 'number', description: '工程 Buff 配置序号（见 get_buff_confs 的「[NN]」）' },
            name: { type: 'string', description: '新名称' }
        },
        required: ['buffConf', 'name']
    },
    handler: (args, ctx) => {
        const set = resolveBuffConf(args.buffConf)
        const name = str(args.name)
        if (!name) throw new Error('新名称不能为空')
        renameBuffConf(set.id, name)
        ctx.notifyCalc?.()
        return { renamed: true, from: set.name, to: name }
    }
})

defineTool('duplicate_buff_conf', {
    description:
        '复制指定工程 Buff 配置为一条新配置（按**序号**），可指定新名称（默认“原名 复制”）。返回新配置的序号。',
    parameters: {
        type: 'object',
        properties: {
            buffConf: { type: 'number', description: '要复制的 工程 Buff 配置序号' },
            customName: { type: 'string', description: '新集名称（可空）' }
        },
        required: ['buffConf']
    },
    handler: (args, ctx) => {
        const set = resolveBuffConf(args.buffConf)
        const newId = duplicateBuffConf(set.id, str(args.customName) || undefined)
        ctx.notifyCalc?.()
        const index = newId ? buffConfsInOrder().findIndex((b) => b.id === newId) + 1 : 0
        return { duplicated: set.name, buffConf: index }
    }
})

defineTool('delete_buff_conf', {
    description: '删除指定工程 Buff 配置（按**序号**，同时清理它对所有条目的绑定）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: { buffConf: { type: 'number', description: '工程 Buff 配置序号' } },
        required: ['buffConf']
    },
    handler: (args, ctx) => {
        const set = resolveBuffConf(args.buffConf)
        deleteBuffConf(set.id)
        ctx.notifyCalc?.()
        return { deleted: true, name: set.name }
    }
})

defineTool('bind_buff_conf_to_entry', {
    description:
        '把指定工程 Buff 配置绑定到指定伤害条目（该条目计算时生效）。两个参数都填**序号**：条目序号见 get_damage_entries，工程 Buff 配置序号见 get_buff_confs。',
    parameters: {
        type: 'object',
        properties: {
            entry: { type: 'number', description: '伤害条目序号（见 get_damage_entries 的「[NN]」）' },
            buffConf: { type: 'number', description: '工程 Buff 配置序号（见 get_buff_confs 的「[NN]」）' }
        },
        required: ['entry', 'buffConf']
    },
    handler: (args, ctx) => {
        const entry = resolveDamageEntry(args.entry)
        const set = resolveBuffConf(args.buffConf)
        const ids = getBuffConfIdsForEntry(entry.id)
        if (ids.includes(set.id)) return { alreadyBound: true, entry: args.entry, buffConf: args.buffConf }
        setBuffConfIdsForEntry(entry.id, [...ids, set.id])
        ctx.notifyCalc?.()
        return { bound: true, entry: args.entry, buffConf: args.buffConf, buffName: set.name }
    }
})

defineTool('unbind_buff_conf_from_entry', {
    description: '把指定工程 Buff 配置从指定伤害条目解除绑定（两个参数都填**序号**）。',
    parameters: {
        type: 'object',
        properties: {
            entry: { type: 'number', description: '伤害条目序号' },
            buffConf: { type: 'number', description: '工程 Buff 配置序号' }
        },
        required: ['entry', 'buffConf']
    },
    handler: (args, ctx) => {
        const entry = resolveDamageEntry(args.entry)
        const set = resolveBuffConf(args.buffConf)
        const ids = getBuffConfIdsForEntry(entry.id)
        if (!ids.includes(set.id)) return { alreadyUnbound: true, entry: args.entry, buffConf: args.buffConf }
        setBuffConfIdsForEntry(
            entry.id,
            ids.filter((sid) => sid !== set.id)
        )
        ctx.notifyCalc?.()
        return { unbound: true, entry: args.entry, buffConf: args.buffConf, buffName: set.name }
    }
})

defineTool('set_entry_damage_types', {
    description:
        '设置指定伤害条目的伤害类型列表（覆盖，按**序号**）。取值：普攻伤害/重击伤害/共鸣技能伤害/共鸣解放伤害/声骸技能伤害/变奏技能伤害/延奏技能伤害/协同攻击伤害/效应伤害/其它类型伤害。',
    parameters: {
        type: 'object',
        properties: {
            entry: { type: 'number', description: '伤害条目序号（见 get_damage_entries 的「[NN]」）' },
            damageTypes: { type: 'array', items: { type: 'string' }, description: '伤害类型列表（可空 = 清空）' }
        },
        required: ['entry', 'damageTypes']
    },
    handler: (args, ctx) => {
        const entry = resolveDamageEntry(args.entry)
        const types = (Array.isArray(args.damageTypes) ? args.damageTypes : []).map((t) => str(t)).filter(Boolean)
        setDamageTypesForEntry(entry.id, types)
        ctx.notifyCalc?.()
        return { entry: args.entry, damageTypes: types }
    }
})

defineTool('toggle_damage_type', {
    description:
        '切换指定伤害条目的单个伤害类型（加上或移除，按**序号**）。已勾选的会被移除 —— 要「确保勾上」请先用 get_damage_entries 看当前类型。',
    parameters: {
        type: 'object',
        properties: {
            entry: { type: 'number', description: '伤害条目序号（见 get_damage_entries 的「[NN]」）' },
            damageType: { type: 'string', description: '伤害类型（如 共鸣技能伤害）' }
        },
        required: ['entry', 'damageType']
    },
    handler: (args, ctx) => {
        const entry = resolveDamageEntry(args.entry)
        const dt = str(args.damageType)
        if (!dt) throw new Error('缺少 damageType')
        toggleDamageTypeForEntry(entry.id, dt)
        ctx.notifyCalc?.()
        return { entry: args.entry, damageTypes: getDamageTypesForEntry(entry.id) }
    }
})

defineTool('get_condition_profile', {
    description: '获取当前链/阶配置（每个角色的共鸣链 0-6 与武器精炼 0-5，0=未精炼）及“可用Buff”过滤开关状态。',
    parameters: { type: 'object', properties: {} },
    handler: () => ({
        chains: getConditionProfile().chains,
        refinements: getConditionProfile().refinements,
        hideConditionMismatch: getHideConditionMismatch()
    })
})

defineTool('set_chain', {
    description: '设置指定角色槽位（1-3）的共鸣链数（0-6）。',
    parameters: {
        type: 'object',
        properties: {
            slot: { type: 'number', description: '角色槽位 1-3' },
            value: { type: 'number', description: '链数 0-6' }
        },
        required: ['slot', 'value']
    },
    handler: (args, ctx) => {
        const slot = Number(args.slot)
        const value = Number(args.value)
        if (!Number.isInteger(slot) || slot < 1 || slot > 3) throw new Error('slot 须为 1-3')
        if (!Number.isInteger(value) || value < 0 || value > 6) throw new Error('value 须为 0-6')
        setConditionProfileChains(slot - 1, value)
        ctx.notifyCalc?.()
        return { slot, chains: getConditionProfile().chains }
    }
})

defineTool('set_refinement', {
    description: '设置指定角色槽位（1-3）的武器精炼阶数（0-5，0=未精炼、不触发专武 1-5 阶 buff）。',
    parameters: {
        type: 'object',
        properties: {
            slot: { type: 'number', description: '角色槽位（1-3）' },
            value: { type: 'number', description: '阶数 0-5' }
        },
        required: ['slot', 'value']
    },
    handler: (args, ctx) => {
        const slot = Number(args.slot)
        const value = Number(args.value)
        if (!Number.isInteger(slot) || slot < 1 || slot > 3) throw new Error('slot 须为 1-3')
        if (!Number.isInteger(value) || value < 0 || value > 5) throw new Error('value 须为 0-5')
        setConditionProfileRefinements(slot - 1, value)
        ctx.notifyCalc?.()
        return { slot, refinements: getConditionProfile().refinements }
    }
})

defineTool('toggle_condition_mismatch_hide', {
    description: '切换“可用Buff/全部Buff”过滤：开启时隐藏条件不匹配（链/阶低于配置、属性/类型对不上条目）的 Buff。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        toggleHideConditionMismatch()
        return { hideConditionMismatch: getHideConditionMismatch() }
    }
})

defineTool('import_buff_set_entity_to_project', {
    description:
        '把主页 Buff 集中指定实体（角色/武器/首位声骸/套装）的全部 Buff 导入当前工程 Buff 配置（保留实体归属，导入后可再绑定到伤害条目）。entityType 取值：character/weapon/echo/1set/2set/3set/4set/5set。',
    parameters: {
        type: 'object',
        properties: {
            entityType: { type: 'string', description: '实体类型' },
            entityName: { type: 'string', description: '实体名称' }
        },
        required: ['entityType', 'entityName']
    },
    handler: (args, ctx) => {
        const entityType = str(args.entityType)
        const entityName = str(args.entityName)
        const entity = getBuffEntities().find((e) => e.entityType === entityType && e.entityName === entityName)
        if (!entity) throw new Error(`主页 Buff 集中未找到「${entityName}」`)
        const items = buildEntityImportItems(entity, getActiveProject()?.team)
        const count = importBuffConfs(items, -1, 3)
        ctx.notifyCalc?.()
        const ownerFound = items.some((it) => (it.ownerIdx ?? -1) >= 0)
        return {
            imported: count,
            ...(!ownerFound
                ? { note: `当前队伍中未找到「${entityName}」，self 范围 Buff 不会生效，可先设置队伍后重新导入` }
                : {})
        }
    }
})

defineTool('get_buff_conf_detail', {
    description:
        '获取指定工程 Buff 配置的完整详情：作用范围、是否全局、生效条件（链/阶硬门槛 + 属性/类型条件）、每个乘区条目（zoneId/数值/是否覆盖/引用/**各自的乘区级条件**）及其生效角色槽位。同一乘区可有多条，每条各自判定条件后相加；覆盖唯一（同一乘区仅一个覆盖条目）。',
    parameters: {
        type: 'object',
        properties: { buffConf: { type: 'number', description: '工程 Buff 配置序号（见 get_buff_confs 的「[NN]」）' } },
        required: ['buffConf']
    },
    handler: (args) => {
        const set = resolveBuffConf(args.buffConf)
        // 同一乘区可能有多条贡献条目：按出现顺序全部列出，并标出每条自身的条件
        const zoneEntries = set.zones.map((z, index) => ({
            index,
            zoneId: z.zoneId,
            label: ZONE_MAP.get(z.zoneId)?.label ?? z.zoneId,
            value: z.value,
            override: !!z.override,
            ref: z.ref ?? null,
            condition: z.condition ?? null
        }))
        const zoneCounts = new Map<string, number>()
        for (const z of zoneEntries) zoneCounts.set(z.zoneId, (zoneCounts.get(z.zoneId) ?? 0) + 1)
        return {
            id: set.id,
            name: set.name,
            scope: set.scope,
            global: getGlobalBuffConfIds().includes(set.id),
            starred: !!set.starred,
            condition: set.condition ?? null,
            conditionRefCharIdx: set.conditionRefCharIdx ?? null,
            conditionHint:
                'condition.chains/refinements 是整块 Buff 的硬门槛（乘区级不接受）；乘区级只接受 elements/damageTypes，用 set_buff_conf_zone_condition 设置',
            zones: zoneEntries,
            overrideZoneIds: [...new Set(zoneEntries.filter((z) => z.override).map((z) => z.zoneId))],
            multiEntryZoneIds: [...zoneCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k)
        }
    }
})

defineTool('set_buff_conf_zone', {
    description:
        '设置工程 Buff 配置内指定乘区的数值（百分数乘区填数值，如 15 表示 15%）。zoneId 不存在时自动创建。zoneId 可选：atkFlat/atkPct/hpFlat/hpPct/defFlat/defPct/critRate/critDmg/recharge/tuneBreakBoost/offTuneBuildupRate/bonusDmg/deepenDmg/resPen/defPen/defDown/dmgRedPen/resDown/tuneStrainLayer/unisonBoonLayer/finalDmg/dmgTakenInc/specialFinal1/specialFinal2/extraRatio。其中 tuneStrainLayer（集谐干涉层数）与 unisonBoonLayer（同奏增益层数）是层数类 flat 乘区，填层数本身（如 +2 层 → value=2）；集谐干涉层数只允许固定层数、不可配引用/转模，也不能作为引用目标 —— 它挂在**目标/怪物**身上、全队共用一份，不存在「某角色的集谐干涉层数」；同奏增益层数属于角色，可以配引用/转模、也可以作为引用来源。旧 id customFinalDmg/customFinalDmgMul 会被自动重映射为 specialFinal1/specialFinal2（返回值里用 remappedFrom/remapNote 标注）。override 为 true 时该乘区覆盖其它 Buff 的同乘区（extraRatio 不支持覆盖）；同一 Buff 内每个乘区只允许一个覆盖条目，开启时落在该乘区第一条、其余条目自动取消覆盖。',
    parameters: {
        type: 'object',
        properties: {
            buffConf: { type: 'number', description: '工程 Buff 配置序号（见 get_buff_confs 的「[NN]」）' },
            zoneId: { type: 'string', description: '乘区 id（接受旧 id，会自动重映射）' },
            value: { type: 'number', description: '数值' },
            override: { type: 'boolean', description: '可选，是否覆盖其它 Buff 的同乘区' }
        },
        required: ['buffConf', 'zoneId', 'value']
    },
    handler: (args, ctx) => {
        const setId = resolveBuffConf(args.buffConf).id
        const rawZoneId = str(args.zoneId)
        const value = Number(args.value)
        if (!rawZoneId) throw new Error('zoneId 不能为空')
        const { zoneId, remappedFrom } = normalizeZoneId(rawZoneId)
        if (!Number.isFinite(value)) throw new Error('value 须为数字')
        const set = resolveBuffConf(args.buffConf)
        if (!set.zones.some((z) => z.zoneId === (zoneId as never))) addZoneToBuffConf(setId, zoneId)
        setBuffConfZoneValue(setId, zoneId, value)
        if (args.override !== undefined) setBuffConfZoneOverride(setId, zoneId, !!args.override)
        ctx.notifyCalc?.()
        return { buffConf: args.buffConf, zoneId, value, override: args.override, ...remapNote(remappedFrom, zoneId) }
    }
})

defineTool('set_buff_conf_zone_ref', {
    description:
        '设置工程 Buff 配置内指定乘区的引用（跟随某角色的属性按百分比折算），ref 为 null 时清除引用。ref 结构：{"targetZoneId":"引用目标","pct":百分比,"characterIdx":槽位 1-3,"threshold":阈值,"lower"/"upper"/"discrete"/"divisor"/"multiplier"可选}。targetZoneId 可选：baseAtk/totalAtk/baseHp/totalHp/baseDef/totalDef/recharge/tuneBreakBoost/offTuneBuildupRate/critRate/critDmg/unisonBoonLayer（最后一项是**按角色独立**的同奏增益层数：读该角色自己累计的层数，可用于「按层数折算」的转模；集谐干涉层数不属于角色，不能作为引用目标）。乘区 id 接受旧 id（customFinalDmg/customFinalDmgMul 会自动重映射）。**跨角色影响源**：引用他角色面板（characterIdx 与目标角色不同）后，作用域指向该角色的 Buff 必须用 bind_buff_conf_to_entry 勾到本段才会参与面板计算，可用 get_buff_conf_detail 或 get_damage_entry_buff_sources 查影响源清单。',
    parameters: {
        type: 'object',
        properties: {
            buffConf: { type: 'number', description: '工程 Buff 配置序号' },
            zoneId: { type: 'string', description: '乘区 id（接受旧 id，会自动重映射）' },
            ref: {
                type: 'object',
                description: '引用定义或 null 清除',
                properties: {
                    targetZoneId: { type: 'string' },
                    pct: { type: 'number' },
                    characterIdx: { type: 'number', description: '引用角色槽位 1-3' },
                    threshold: { type: 'number' },
                    lower: { type: 'number' },
                    upper: { type: 'number' },
                    discrete: { type: 'boolean' },
                    divisor: { type: 'number' },
                    multiplier: { type: 'number' }
                }
            }
        },
        required: ['buffConf', 'zoneId']
    },
    handler: (args, ctx) => {
        const setId = resolveBuffConf(args.buffConf).id
        const rawZoneId = str(args.zoneId)
        if (!rawZoneId) throw new Error('zoneId 不能为空')
        const { zoneId, remappedFrom } = normalizeZoneId(rawZoneId)
        const set = resolveBuffConf(args.buffConf)

        const raw = args.ref
        if (!raw || typeof raw !== 'object') {
            setBuffConfZoneRef(setId, zoneId, null)
            ctx.notifyCalc?.()
            return { cleared: true, ...remapNote(remappedFrom, zoneId) }
        }
        if (ZONE_NO_REF_IDS.has(zoneId)) {
            throw new Error(
                `乘区「${ZONE_MAP.get(zoneId as never)?.label ?? zoneId}」只支持填固定层数，不支持引用/转模`
            )
        }
        const o = raw as Record<string, unknown>
        const targetZoneId = str(o.targetZoneId)
        const pct = Number(o.pct)
        if (!targetZoneId) throw new Error('ref.targetZoneId 不能为空')
        if (!ZONE_REF_MAP.has(targetZoneId)) throw new Error(`无效引用目标：${targetZoneId}`)
        if (!Number.isFinite(pct)) throw new Error('ref.pct 须为数字')
        const characterIdx = Number(o.characterIdx ?? 1)
        if (!Number.isInteger(characterIdx) || characterIdx < 1 || characterIdx > 3) {
            throw new Error('ref.characterIdx 须为 1-3')
        }
        const ref: ZoneRef = {
            characterIdx: characterIdx - 1,
            zoneId: targetZoneId,
            threshold: Number(o.threshold ?? 0),
            pct,
            ...(o.lower !== undefined ? { lower: Number(o.lower) } : {}),
            ...(o.upper !== undefined ? { upper: Number(o.upper) } : {}),
            ...(o.discrete !== undefined ? { discrete: !!o.discrete } : {}),
            ...(o.divisor !== undefined ? { divisor: Number(o.divisor) } : {}),
            ...(o.multiplier !== undefined ? { multiplier: Number(o.multiplier) } : {})
        }
        if (!set.zones.some((z) => z.zoneId === (zoneId as never))) addZoneToBuffConf(setId, zoneId)
        setBuffConfZoneRef(setId, zoneId, ref)
        ctx.notifyCalc?.()
        return { buffConf: args.buffConf, zoneId, ref, ...remapNote(remappedFrom, zoneId) }
    }
})

defineTool('remove_buff_conf_zone', {
    description:
        '从工程 Buff 配置中删除指定乘区（不可恢复；同一乘区的多条贡献条目会全部删除）。乘区 id 接受旧 id（customFinalDmg/customFinalDmgMul 会自动重映射）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            buffConf: { type: 'number', description: '工程 Buff 配置序号' },
            zoneId: { type: 'string', description: '乘区 id（接受旧 id，会自动重映射）' }
        },
        required: ['buffConf', 'zoneId']
    },
    handler: (args, ctx) => {
        const setId = resolveBuffConf(args.buffConf).id
        const rawZoneId = str(args.zoneId)
        if (!rawZoneId) throw new Error('zoneId 不能为空')
        const { zoneId, remappedFrom } = normalizeZoneId(rawZoneId)
        const set = resolveBuffConf(args.buffConf)
        if (!set.zones.some((z) => z.zoneId === (zoneId as never))) throw new Error(`工程 Buff 配置无乘区：${zoneId}`)
        removeZoneFromBuffConf(setId, zoneId)
        ctx.notifyCalc?.()
        return { removed: zoneId, ...remapNote(remappedFrom, zoneId) }
    }
})

defineTool('get_buff_conf_zone_condition', {
    description:
        '读取某条工程 Buff 配置内指定乘区的**乘区级生效条件**（伤害属性 / 伤害类型；类内「或」）。只读取，不修改。同一乘区有多条贡献条目时返回第一条的条件，完整逐条清单请用 get_buff_conf_detail。',
    parameters: {
        type: 'object',
        properties: {
            buffConf: { type: 'number', description: '工程 Buff 配置序号（见 get_buff_confs 的「[NN]」）' },
            zoneId: { type: 'string', description: '乘区 id（接受旧 id，会自动重映射）' }
        },
        required: ['buffConf', 'zoneId']
    },
    handler: (args) => {
        const setId = resolveBuffConf(args.buffConf).id
        const rawZoneId = str(args.zoneId)
        if (!rawZoneId) throw new Error('zoneId 不能为空')
        const { zoneId, remappedFrom } = normalizeZoneId(rawZoneId)
        const set = resolveBuffConf(args.buffConf)
        if (!set.zones.some((z) => z.zoneId === (zoneId as never))) throw new Error(`工程 Buff 配置无乘区：${zoneId}`)
        return {
            buffConf: args.buffConf,
            zoneId,
            label: ZONE_MAP.get(zoneId)?.label ?? zoneId,
            condition: getBuffConfZoneCondition(setId, zoneId) ?? null,
            summary: conditionSummary(getBuffConfZoneCondition(setId, zoneId) as Record<string, unknown> | undefined),
            ...remapNote(remappedFrom, zoneId)
        }
    }
})

defineTool('set_buff_conf_zone_condition', {
    description:
        '设置某条工程 Buff 配置内指定乘区的**乘区级生效条件**，传 null 清除。只接受 elements（伤害属性）与 damageTypes（伤害类型）两类，可只给其中一类；condition 对象形如 {"elements":["冷凝","热熔"],"damageTypes":["普攻伤害","重击伤害"]}。取值边界：属性取自 game-terms 的 ELEMENTS、伤害类型取自 DAMAGE_TYPES（见参数说明里的完整可选值）。判定口径为**类内「或」、类间「与」**——同类多选任一命中即满足，两类都给了则必须同时满足。链条件（chains）与阶条件（refinements）是整个 Buff 的硬门槛，不允许挂到乘区上（传了会被忽略并回传 strippedKeys），请用 set_buff_conf_condition 设置。生效效果：不满足时仅该乘区不计入，同一条目的其它乘区照常生效。',
    parameters: {
        type: 'object',
        properties: {
            buffConf: { type: 'number', description: '工程 Buff 配置序号（见 get_buff_confs 的「[NN]」）' },
            zoneId: { type: 'string', description: '乘区 id（接受旧 id，会自动重映射）' },
            condition: {
                type: 'object',
                description: '乘区级条件（只认 elements/damageTypes），或 null 清除',
                properties: {
                    elements: {
                        type: 'array',
                        items: { type: 'string' },
                        description: `伤害属性多选（任一匹配即满足），可选：${ELEMENTS.join('/')}`
                    },
                    damageTypes: {
                        type: 'array',
                        items: { type: 'string' },
                        description: `伤害类型多选（任一匹配即满足），可选：${DAMAGE_TYPES.join('/')}`
                    }
                }
            }
        },
        required: ['buffConf', 'zoneId']
    },
    handler: (args, ctx) => {
        const setId = resolveBuffConf(args.buffConf).id
        const rawZoneId = str(args.zoneId)
        if (!rawZoneId) throw new Error('zoneId 不能为空')
        const { zoneId, remappedFrom } = normalizeZoneId(rawZoneId)
        const set = resolveBuffConf(args.buffConf)
        if (!set.zones.some((z) => z.zoneId === (zoneId as never))) throw new Error(`工程 Buff 配置无乘区：${zoneId}`)

        const raw = args.condition
        if (!raw || typeof raw !== 'object') {
            setBuffConfZoneCondition(setId, zoneId, null)
            ctx.notifyCalc?.()
            return { buffConf: args.buffConf, zoneId, cleared: true }
        }
        const o = raw as Record<string, unknown>
        const stripped: string[] = []
        for (const key of Object.keys(o)) {
            if (!(ZONE_CONDITION_KEYS as readonly string[]).includes(key)) stripped.push(key)
        }
        const condition: Record<string, unknown> = {}
        if (o.elements !== undefined) {
            if (!Array.isArray(o.elements)) throw new Error('condition.elements 须为属性名数组')
            const bad = o.elements.map((v) => str(v)).filter((v) => v && !ELEMENTS.includes(v as never))
            if (bad.length > 0) throw new Error(`无效伤害属性：${bad.join('/')}（可选：${ELEMENTS.join('/')}）`)
            condition.elements = o.elements.map((v) => str(v)).filter(Boolean)
        }
        if (o.damageTypes !== undefined) {
            if (!Array.isArray(o.damageTypes)) throw new Error('condition.damageTypes 须为伤害类型名数组')
            const bad = o.damageTypes.map((v) => str(v)).filter((v) => v && !DAMAGE_TYPES.includes(v as never))
            if (bad.length > 0) throw new Error(`无效伤害类型：${bad.join('/')}（可选：${DAMAGE_TYPES.join('/')}）`)
            condition.damageTypes = o.damageTypes.map((v) => str(v)).filter(Boolean)
        }
        if (Object.keys(condition).length === 0) {
            throw new Error(
                `须至少提供 elements 或 damageTypes${stripped.length > 0 ? `（${stripped.join('/')} 不能挂在乘区上，请用 set_buff_conf_condition 设置整块 Buff 条件）` : ''}`
            )
        }
        setBuffConfZoneCondition(setId, zoneId, condition as never)
        ctx.notifyCalc?.()
        return {
            buffConf: args.buffConf,
            zoneId,
            label: ZONE_MAP.get(zoneId)?.label ?? zoneId,
            condition,
            strippedKeys: stripped,
            note: '类内「或」、类间「与」；不满足时仅该乘区不计入',
            ...remapNote(remappedFrom, zoneId)
        }
    }
})

defineTool('get_damage_entry_buff_sources', {
    description:
        '查询某伤害条目的**跨角色影响源**（按**序号**）：本段引用了其它角色的面板（乘区 ref 里 characterIdx 指向他角色）时，作用域指向那个角色、且会改写被引用面板乘区的 Buff —— 这些 Buff 必须用 bind_buff_conf_to_entry 勾到本段才会参与该角色在这一段的面板计算（拉表里它们以「影响源」列/勾选项出现，不是自动生效的）。返回每条影响源的**工程 Buff 配置序号**与名称、被引用角色槽位、被改写的面板乘区。',
    parameters: {
        type: 'object',
        properties: { entry: { type: 'number', description: '伤害条目序号（见 get_damage_entries 的「[NN]」）' } },
        required: ['entry']
    },
    handler: (args) => {
        const entry = resolveDamageEntry(args.entry)
        const entryId = entry.id
        const sources = getPaneEffectSources(entryId)
        const boundIds = new Set(getBuffConfIdsForEntry(entryId))
        const buffConfs = buffConfsInOrder()
        return {
            entry: args.entry,
            displayName: entry.displayName,
            character: entry.character ?? null,
            boundCount: boundIds.size,
            sources: Object.entries(sources).map(([buffId, src]) => {
                const buffIndex = buffConfs.findIndex((s) => s.id === buffId)
                const buff = buffIndex >= 0 ? buffConfs[buffIndex] : undefined
                return {
                    buffConf: buffIndex >= 0 ? buffIndex + 1 : null,
                    name: buff?.name ?? null,
                    scope: buff?.scope ?? null,
                    /** @desc 被本段引用、且被该 Buff 改写的角色槽位（1 起） */
                    refCharacterSlot: src.charIdx + 1,
                    refCharacter: getActiveProject()?.team[src.charIdx]?.character ?? null,
                    rewrittenPanelZones: src.zoneIds,
                    bound: boundIds.has(buffId)
                }
            }),
            hint: 'bound=false 的影响源当前未勾到本段，不参与面板计算；用 bind_buff_conf_to_entry 勾选'
        }
    }
})

defineTool('set_buff_conf_scope', {
    description:
        '设置工程 Buff 配置的作用范围：all（全队）或槽位数组（如 [1,3] 表示仅 1、3 号位）。全局工程 Buff 配置不可修改范围。',
    parameters: {
        type: 'object',
        properties: {
            buffConf: { type: 'number', description: '工程 Buff 配置序号' },
            scope: { type: ['string', 'array'], description: 'all 或槽位数组 [1-3]' }
        },
        required: ['buffConf', 'scope']
    },
    handler: (args, ctx) => {
        const setId = resolveBuffConf(args.buffConf).id
        if (args.scope === 'all' || str(args.scope) === 'all') {
            setBuffConfScope(setId, 'all')
        } else if (Array.isArray(args.scope)) {
            const slots = args.scope.map((v) => Number(v))
            if (slots.length === 0 || slots.some((s) => !Number.isInteger(s) || s < 1 || s > 3)) {
                throw new Error('scope 数组须为 1-3 的槽位列表')
            }
            setBuffConfScope(
                setId,
                slots.map((s) => s - 1)
            )
        } else {
            throw new Error('scope 须为 all 或槽位数组')
        }
        ctx.notifyCalc?.()
        return { buffConf: args.buffConf, scope: args.scope }
    }
})

defineTool('set_buff_conf_condition', {
    description:
        '设置工程 Buff 配置生效条件（全部满足才生效），传 null 清除。condition 结构：{"chain":共鸣链要求 0-6,"refinement":精炼要求 1-5,"elements":["伤害属性..."],"damageTypes":["伤害类型..."]}。全局工程 Buff 配置不可设置链/阶条件。',
    parameters: {
        type: 'object',
        properties: {
            buffConf: { type: 'number', description: '工程 Buff 配置序号' },
            condition: {
                type: 'object',
                description: '条件定义或 null 清除',
                properties: {
                    chain: { type: 'number' },
                    refinement: { type: 'number' },
                    elements: { type: 'array', items: { type: 'string' } },
                    damageTypes: { type: 'array', items: { type: 'string' } }
                }
            }
        },
        required: ['buffConf']
    },
    handler: (args, ctx) => {
        const setId = resolveBuffConf(args.buffConf).id
        const raw = args.condition
        if (!raw || typeof raw !== 'object') {
            setBuffConfCondition(setId, null)
            ctx.notifyCalc?.()
            return { cleared: true }
        }
        const o = raw as Record<string, unknown>
        const condition: Record<string, unknown> = {}
        if (o.chain !== undefined) {
            const chain = Number(o.chain)
            if (!Number.isInteger(chain) || chain < 0 || chain > 6) throw new Error('chain 须为 0-6')
            condition.chain = chain
        }
        if (o.refinement !== undefined) {
            const refinement = Number(o.refinement)
            if (!Number.isInteger(refinement) || refinement < 1 || refinement > 5)
                throw new Error('refinement 须为 1-5')
            condition.refinement = refinement
        }
        if (o.elements !== undefined) {
            const elements = (Array.isArray(o.elements) ? o.elements : []).map((e) => str(e)).filter(Boolean)
            const invalid = elements.filter((e) => !ELEMENTS.includes(e as never))
            if (invalid.length > 0)
                throw new Error(`无效伤害属性：${invalid.join('、')}（可选：${ELEMENTS.join('、')}）`)
            if (elements.length > 0) condition.elements = elements
        }
        if (o.damageTypes !== undefined) {
            const types = (Array.isArray(o.damageTypes) ? o.damageTypes : []).map((t) => str(t)).filter(Boolean)
            const invalid = types.filter((t) => !DAMAGE_TYPES.includes(t as never))
            if (invalid.length > 0) throw new Error(`无效伤害类型：${invalid.join('、')}`)
            if (types.length > 0) condition.damageTypes = types
        }
        setBuffConfCondition(setId, condition as never)
        ctx.notifyCalc?.()
        return { buffConf: args.buffConf, condition }
    }
})

// ── 拉表撤销 / 重做 ──
// 拉表的撤销栈**只回退表格**（工程 Buff 配置、条目↔Buff 绑定、伤害类型），不动排轴与词条；
// 排轴的撤销/重做是另一套独立历史，见 undo_timeline / redo_timeline。

defineTool('get_table_history', {
    description:
        '读取拉表（表格）撤销/重做历史状态：是否可撤销、是否可重做。拉表历史与排轴历史相互独立——本工具只看表格，排轴用 get_timeline_summary 配合 undo_timeline/redo_timeline。',
    parameters: { type: 'object', properties: {} },
    handler: () => ({
        canUndo: canUndoTable(),
        canRedo: canRedoTable(),
        note: '拉表历史只回退表格（工程 Buff 配置 / 条目绑定 / 伤害类型），不回退排轴与词条'
    })
})

defineTool('undo_table', {
    description:
        '撤销上一次**拉表（表格）**变更（工程 Buff 配置增删改、条目↔Buff 绑定、伤害类型勾选等）。只回退表格，不动排轴与词条；排轴请用 undo_timeline。没有可撤销的操作时 ok=false 并给出原因（不会静默成功）。',
    parameters: { type: 'object', properties: {} },
    handler: (args, ctx) => {
        const canUndo = canUndoTable()
        const done = undoTable()
        if (!done) {
            return {
                undone: false,
                reason: canUndo ? '当前环节已锁定，表格不可修改' : '没有可撤销的表格操作',
                canUndo,
                canRedo: canRedoTable()
            }
        }
        ctx.notifyCalc?.()
        return { undone: true, canUndo: canUndoTable(), canRedo: canRedoTable() }
    }
})

defineTool('redo_table', {
    description:
        '重做上一次被撤销的**拉表（表格）**变更。只影响表格，不动排轴与词条；排轴请用 redo_timeline。没有可重做的操作时 ok=false 并给出原因。',
    parameters: { type: 'object', properties: {} },
    handler: (args, ctx) => {
        const canRedo = canRedoTable()
        const done = redoTable()
        if (!done) {
            return {
                redone: false,
                reason: canRedo ? '当前环节已锁定，表格不可修改' : '没有可重做的表格操作',
                canUndo: canUndoTable(),
                canRedo
            }
        }
        ctx.notifyCalc?.()
        return { redone: true, canUndo: canUndoTable(), canRedo: canRedoTable() }
    }
})
