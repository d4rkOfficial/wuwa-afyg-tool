// 词条集域工具（快速词条方案）：读取标准14词条/自定义方案、改方案、套用到配队角色、从工坊同步
import { defineTool } from './registry'
import {
    deleteSubstatPlan,
    fetchSubstatPlansFromShare,
    getStoredStandardPlan,
    getSubstatPlans,
    listPlansFor,
    loadSubstatLibrary,
    renameSubstatPlan,
    resetStandardPlan,
    saveSubstatPlan,
    type SubstatPlan
} from '$lib/data/substat-library.svelte'
import { syncSubstatPlansFromKuro } from '$lib/kuro-app/kuro-sync.svelte'
import {
    buildStandardSlots,
    cloneSlots,
    normalizeAnyPlanSlots,
    planSubstatTotal,
    STANDARD_PLAN_NAME,
    STANDARD_SUBSTAT_TOTAL
} from '$lib/calc/standard-substats'
import { ensureCharInfo, getCharInfoMap } from '$lib/data/char-info.svelte'
import { getConfig, setEchoSlots } from '$lib/calc/config.store.svelte'
import { getActiveProject, updateConfig } from '$lib/data/project.svelte'
import { SUBSTAT_OPTIONS } from '$lib/consts/stat-data'
import type { EchoSlotConfig } from '$lib/calc/config.types'

const str = (v: unknown): string => String(v ?? '').trim()

const costString = (slots: EchoSlotConfig[]) =>
    slots
        .map((s) => s.cost)
        .sort((a, b) => b - a)
        .join('')

/** @desc 方案的槽位明细（文字化，便于模型阅读） */
const slotDetails = (slots: EchoSlotConfig[]) =>
    slots.map((slot, i) => ({
        slot: i + 1,
        cost: slot.cost,
        mainStat: slot.mainStat ? `${slot.mainStat.type} ${slot.mainStat.value}${slot.mainStat.unit}` : null,
        secondMainStat: slot.secondMainStat
            ? `${slot.secondMainStat.type} ${slot.secondMainStat.value}${slot.secondMainStat.unit}`
            : null,
        substats: slot.substats.map((s) => `${s.type} ${s.value}${s.unit}`)
    }))

const planSummary = (plan: SubstatPlan) => ({
    character: plan.character,
    name: plan.name,
    standard: plan.standard,
    origin: plan.standard ? (plan.source === 'share' ? '工坊同步' : '本地修改') : '自定义',
    cost: costString(plan.slots),
    substatTotal: planSubstatTotal(plan.slots)
})

/** @desc 某角色当前生效的标准14词条：库里存过的优先，否则按角色数据自动生成（未加载到角色数据时为 null） */
const standardSlotsFor = async (character: string): Promise<EchoSlotConfig[] | null> => {
    const stored = getStoredStandardPlan(character)
    if (stored) return stored.slots
    await ensureCharInfo(character)
    const info = getCharInfoMap()[character]
    if (!info) return null
    return buildStandardSlots({ element: info.element, statNodes: info.statNodes })
}

const standardOriginOf = (character: string) => {
    const stored = getStoredStandardPlan(character)
    if (!stored) return '自动生成'
    return stored.source === 'share' ? '工坊同步' : '本地修改'
}

/** @desc 按方案名或「标准」标记定位一个方案（标准方案在未指定名称时优先） */
const findPlan = async (
    character: string,
    name: string,
    standard: boolean
): Promise<{ plan: SubstatPlan | null; slots: EchoSlotConfig[] | null }> => {
    await loadSubstatLibrary()
    if (standard || name === STANDARD_PLAN_NAME) {
        const plan = getStoredStandardPlan(character) ?? null
        return { plan, slots: plan?.slots ?? (await standardSlotsFor(character)) }
    }
    const plan = listPlansFor(character).find((p) => p.name === name) ?? null
    return { plan, slots: plan?.slots ?? null }
}

const DEFAULT_SUBSTAT_VALUE = (type: string): number => {
    const opt = SUBSTAT_OPTIONS.find((o) => o.label === type)
    return opt ? opt.tiers[Math.floor((opt.tiers.length - 1) / 2)] : 0
}

/** @desc 宽松解析传入的 5 槽位：主词条允许写成字符串，副词条允许写成字符串或 {type,value} */
const parseInputSlots = (raw: unknown): EchoSlotConfig[] | null => {
    if (!Array.isArray(raw) || raw.length !== 5) return null
    const slots = raw.map((item) => {
        const rec = (item ?? {}) as Record<string, unknown>
        const mainRaw = rec.mainStat
        const mainStat = typeof mainRaw === 'string' ? { type: str(mainRaw) } : (mainRaw ?? null)
        const subsRaw = Array.isArray(rec.substats) ? rec.substats : []
        const substats = subsRaw.map((sub) => {
            if (typeof sub === 'string') return { type: str(sub), value: DEFAULT_SUBSTAT_VALUE(str(sub)) }
            const s = (sub ?? {}) as Record<string, unknown>
            const type = str(s.type)
            const value = Number(s.value)
            return { type, value: Number.isFinite(value) ? value : DEFAULT_SUBSTAT_VALUE(type) }
        })
        return { cost: Number(rec.cost), mainStat, substats }
    })
    return normalizeAnyPlanSlots(slots)
}

defineTool('list_substat_plans', {
    description:
        '列出词条集（快速词条方案）里的声骸词条方案。传 character 时列出该角色全部方案（第一项固定为「标准14词条」，其余为自定义）；不传时列出本地库里有方案的角色及数量。',
    parameters: {
        type: 'object',
        properties: {
            character: { type: 'string', description: '可选：角色名（如「绯雪」）' }
        }
    },
    handler: async (args) => {
        await loadSubstatLibrary()
        const character = str(args.character)
        if (character) {
            const standard = await standardSlotsFor(character)
            const customs = listPlansFor(character).filter((p) => !p.standard)
            return {
                character,
                standardOrigin: standardOriginOf(character),
                standardSlots: standard ? slotDetails(standard) : null,
                plans: customs.map(planSummary)
            }
        }
        const counts = new Map<string, { standard: boolean; custom: number }>()
        for (const plan of getSubstatPlans()) {
            const entry = counts.get(plan.character) ?? { standard: false, custom: 0 }
            if (plan.standard) entry.standard = true
            else entry.custom += 1
            counts.set(plan.character, entry)
        }
        const team =
            getActiveProject()
                ?.team.map((s) => s.character)
                .filter(Boolean) ?? []
        return {
            characters: [...counts.entries()].map(([name, c]) => ({ character: name, ...c })),
            team
        }
    }
})

defineTool('get_substat_plan', {
    description:
        '查看某个声骸词条方案的完整 5 槽位明细（cost、主词条、第二主词条、副词条）。不传 name 时返回该角色的标准14词条（自动生成/工坊/本地修改都算）。',
    parameters: {
        type: 'object',
        properties: {
            character: { type: 'string', description: '角色名' },
            name: { type: 'string', description: '方案名；省略则取标准14词条' },
            standard: { type: 'boolean', description: 'true 表示取该角色的标准14词条' }
        },
        required: ['character']
    },
    handler: async (args) => {
        const character = str(args.character)
        if (!character) throw new Error('缺少 character')
        const name = str(args.name)
        const standard = args.standard === true || (!name && true)
        const { plan, slots } = await findPlan(character, name, standard)
        if (!slots) {
            throw new Error(
                standard ? `未找到「${character}」的标准14词条（角色数据可能未加载）` : `未找到方案「${name}」`
            )
        }
        return {
            character,
            name: plan?.name ?? STANDARD_PLAN_NAME,
            standard: plan ? plan.standard : true,
            origin: plan ? (plan.source === 'share' ? '工坊同步' : '本地修改') : standardOriginOf(character),
            cost: costString(slots),
            substatTotal: planSubstatTotal(slots),
            slots: slotDetails(slots)
        }
    }
})

defineTool('save_substat_plan', {
    description:
        '新建或覆盖一条声骸词条方案（覆盖会先弹确认框）。standard=true 时写的是该角色的标准14词条，要求副词条恰好 14 条；自定义方案要求 5 个槽位、cost 取值 1/3/4 且合计 ≤12、每槽副词条 ≤5 且不重复。slots 里主词条可写字符串（如 "暴击率"，数值自动取满级），副词条可写 "暴击率" 或 {type:"暴击率",value:7.5}（数值自动吸附到合法档位）。',
    parameters: {
        type: 'object',
        properties: {
            character: { type: 'string', description: '角色名' },
            name: { type: 'string', description: '方案名（standard=true 时忽略，固定为「标准14词条」）' },
            standard: { type: 'boolean', description: '可选：true 表示写标准14词条' },
            slots: {
                type: 'array',
                description: '5 个声骸槽位',
                items: {
                    type: 'object',
                    properties: {
                        cost: { type: 'number', description: 'cost：1/3/4' },
                        mainStat: { type: 'string', description: '主词条名称，空字符串表示不选' },
                        substats: {
                            type: 'array',
                            description: '该声骸的副词条',
                            items: { type: 'string' }
                        }
                    },
                    required: ['cost']
                }
            }
        },
        required: ['character', 'slots']
    },
    dangerous: true,
    handler: async (args) => {
        const character = str(args.character)
        if (!character) throw new Error('缺少 character')
        const standard = args.standard === true
        const name = standard ? STANDARD_PLAN_NAME : str(args.name)
        if (!standard && !name) throw new Error('自定义方案需要 name')
        const slots = parseInputSlots(args.slots)
        if (!slots) {
            throw new Error('方案结构非法：需要 5 个槽位、cost 取值 1/3/4、cost 合计 ≤12、每槽副词条 ≤5 且不重复')
        }
        const total = planSubstatTotal(slots)
        if (standard && total !== STANDARD_SUBSTAT_TOTAL) {
            throw new Error(`标准14词条需要恰好 ${STANDARD_SUBSTAT_TOTAL} 条副词条，当前 ${total} 条`)
        }
        const id = await saveSubstatPlan({ character, name, standard, slots })
        if (!id) throw new Error('保存失败：方案结构非法')
        return { character, name, standard, cost: costString(slots), substatTotal: total }
    }
})

defineTool('rename_substat_plan', {
    description: '重命名一条自定义方案（标准14词条不能改名）。',
    parameters: {
        type: 'object',
        properties: {
            character: { type: 'string', description: '角色名' },
            name: { type: 'string', description: '当前方案名' },
            newName: { type: 'string', description: '新方案名' }
        },
        required: ['character', 'name', 'newName']
    },
    handler: async (args) => {
        await loadSubstatLibrary()
        const character = str(args.character)
        const name = str(args.name)
        const newName = str(args.newName)
        const plan = listPlansFor(character).find((p) => p.name === name)
        if (!plan) throw new Error(`未找到方案「${name}」`)
        if (plan.standard) throw new Error('标准14词条不能重命名')
        const ok = await renameSubstatPlan(plan.id, newName)
        if (!ok) throw new Error('重命名失败')
        return { character, from: name, to: newName }
    }
})

defineTool('delete_substat_plan', {
    description:
        '删除一条自定义声骸词条方案（不可恢复；标准14词条不能删除，需要清掉改动请用 reset_standard_substat_plan）。',
    parameters: {
        type: 'object',
        properties: {
            character: { type: 'string', description: '角色名' },
            name: { type: 'string', description: '方案名' }
        },
        required: ['character', 'name']
    },
    dangerous: true,
    handler: async (args) => {
        await loadSubstatLibrary()
        const character = str(args.character)
        const name = str(args.name)
        const plan = listPlansFor(character).find((p) => p.name === name)
        if (!plan) throw new Error(`未找到方案「${name}」`)
        if (plan.standard)
            throw new Error('标准14词条不能删除（可用 reset_standard_substat_plan 恢复为自动生成/工坊版本）')
        const ok = await deleteSubstatPlan(plan.id)
        if (!ok) throw new Error('删除失败')
        return { character, name }
    }
})

defineTool('apply_substat_plan', {
    description:
        '把某条声骸词条方案套用到当前配队里的该角色（替换其 5 个声骸词条）。不传 name 时套用标准14词条；该角色不在配队中会报错。',
    parameters: {
        type: 'object',
        properties: {
            character: { type: 'string', description: '角色名' },
            name: { type: 'string', description: '方案名；省略则套用标准14词条' },
            standard: { type: 'boolean', description: '可选：true 表示套用标准14词条' }
        },
        required: ['character']
    },
    handler: async (args) => {
        const character = str(args.character)
        if (!character) throw new Error('缺少 character')
        const name = str(args.name)
        const standard = args.standard === true || !name
        const { plan, slots } = await findPlan(character, name, standard)
        if (!slots) throw new Error(standard ? `未找到「${character}」的标准14词条` : `未找到方案「${name}」`)
        const idx = getActiveProject()?.team.findIndex((s) => s.character === character) ?? -1
        if (idx < 0) throw new Error(`「${character}」不在当前配队中，无法套用词条方案`)
        if (!setEchoSlots(idx, cloneSlots(slots))) throw new Error('套用失败：声骸结构非法或 cost 合计超过 12')
        await updateConfig(getConfig())
        return {
            character,
            slot: idx + 1,
            plan: plan?.name ?? STANDARD_PLAN_NAME,
            cost: costString(slots),
            substatTotal: planSubstatTotal(slots)
        }
    }
})

defineTool('reset_standard_substat_plan', {
    description: '重置某角色的标准14词条：清掉本地修改/工坊同步的版本，回落到「工坊同步」或按角色数据自动生成。',
    parameters: {
        type: 'object',
        properties: { character: { type: 'string', description: '角色名' } },
        required: ['character']
    },
    dangerous: true,
    handler: async (args) => {
        await loadSubstatLibrary()
        const character = str(args.character)
        if (!character) throw new Error('缺少 character')
        const before = standardOriginOf(character)
        await resetStandardPlan(character)
        const slots = await standardSlotsFor(character)
        return { character, from: before, to: standardOriginOf(character), cost: slots ? costString(slots) : null }
    }
})

defineTool('sync_substat_plans_from_share', {
    description:
        '从工坊同步全部角色的标准14词条集（只覆盖工坊来源的方案，本地修改与自定义方案不受影响；工坊已下线的会移除）。',
    parameters: { type: 'object', properties: {} },
    dangerous: true,
    handler: async () => {
        const result = await fetchSubstatPlansFromShare()
        if (!result.ok) throw new Error(`同步失败：${result.error ?? '工坊不可达'}`)
        return { synced: result.added }
    }
})

defineTool('sync_substat_plans_from_kuro', {
    description:
        '从库街区同步当前账号下鸣潮角色「正在装配的声骸」，写成本地自定义词条方案（方案名「库街区同步」，同名覆盖、可重复同步）。' +
        '需要先在「设置 → 库街区」登录（可用 open_panel 打开 kuro-login 窗口）；上游若缺少角色装配声骸接口会明确报错。',
    parameters: { type: 'object', properties: {} },
    dangerous: true,
    handler: async () => {
        const result = await syncSubstatPlansFromKuro()
        if (!result.ok) throw new Error(result.error ?? '库街区同步失败')
        return {
            synced: result.synced,
            role: result.roleName ?? null,
            planName: '库街区同步',
            skipped: result.skipped,
            unmatchedNames: result.unmatchedNames
        }
    }
})
