// 配装域工具（Phase 4）：读取配置摘要、改声骸词条/敌人/抗性
import { defineTool } from './registry'
import {
    getConfig,
    setEchoCost,
    setMainStat,
    addSubstat,
    removeSubstat,
    updateSubstatValue,
    updateEnemy,
    updateResistance
} from '$lib/components/page/home/config/config.store.svelte'
import { getActiveProject, updateConfig } from '$lib/data/project.svelte'
import { MAIN_STAT_POOL } from '$lib/consts/stat-data'

const str = (v: unknown): string => String(v ?? '').trim()
const COSTS = [1, 3, 4, 5]

defineTool('get_config_summary', {
    description:
        '获取当前配装配置摘要：每个角色的 5 个声骸（cost、主词条、副词条）与敌人配置（类型/等级/防御/减伤/各抗性）。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const cfg = getConfig()
        const p = getActiveProject()
        return {
            characters: cfg.characters.map((c, i) => ({
                slot: i + 1,
                character: p?.team[i]?.character ?? null,
                echoes: c.echoes.map((e, si) => ({
                    slot: si + 1,
                    cost: e.cost,
                    mainStat: e.mainStat ? { type: e.mainStat.type, value: e.mainStat.value } : null,
                    substats: e.substats.map((s) => ({ type: s.type, value: s.value }))
                }))
            })),
            enemy: cfg.enemy
        }
    }
})

defineTool('set_echo_cost', {
    description: '设置指定角色槽位（1-3）第 N 个声骸（1-5）的 cost（3/4/5；改 cost 会重置主词条）。',
    parameters: {
        type: 'object',
        properties: {
            char: { type: 'number', description: '角色槽位 1-3' },
            slot: { type: 'number', description: '声骸位 1-5' },
            cost: { type: 'number', description: 'cost：3/4/5' }
        },
        required: ['char', 'slot', 'cost']
    },
    handler: async (args) => {
        const char = Number(args.char)
        const slot = Number(args.slot)
        const cost = Number(args.cost)
        if (!Number.isInteger(char) || char < 1 || char > 3) throw new Error('char 须为 1-3')
        if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new Error('slot 须为 1-5')
        if (!COSTS.includes(cost)) throw new Error('cost 须为 3/4/5')
        setEchoCost(char - 1, slot - 1, cost)
        await updateConfig(getConfig())
        return { char, slot, cost }
    }
})

defineTool('set_main_stat', {
    description:
        '设置指定角色槽位（1-3）第 N 个声骸（1-5）的主词条。label 须为该声骸 cost 支持的主词条（可选列表与 cost 相关，先 set_echo_cost 或 get_config_summary 查看），传空字符串清空。不传 value 时使用该词条满级默认值。',
    parameters: {
        type: 'object',
        properties: {
            char: { type: 'number', description: '角色槽位 1-3' },
            slot: { type: 'number', description: '声骸位 1-5' },
            label: { type: 'string', description: '主词条名称，空字符串清空' },
            value: { type: 'number', description: '可选，覆盖默认满级值' }
        },
        required: ['char', 'slot']
    },
    handler: async (args) => {
        const char = Number(args.char)
        const slot = Number(args.slot)
        if (!Number.isInteger(char) || char < 1 || char > 3) throw new Error('char 须为 1-3')
        if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new Error('slot 须为 1-5')

        const echo = getConfig().characters[char - 1].echoes[slot - 1]
        const label = str(args.label)
        if (!label) {
            setMainStat(char - 1, slot - 1, null)
            await updateConfig(getConfig())
            return { cleared: true }
        }
        const options = MAIN_STAT_POOL[echo.cost] ?? []
        const opt = options.find((o) => o.label === label)
        if (!opt)
            throw new Error(
                `cost ${echo.cost} 声骸不支持主词条「${label}」（可选：${options.map((o) => o.label).join('、') || '请先设置 cost'}）`
            )
        const value = args.value !== undefined ? Number(args.value) : opt.maxValue
        if (!Number.isFinite(value)) throw new Error('value 须为数字')
        setMainStat(char - 1, slot - 1, { type: opt.label, value, unit: opt.unit })
        await updateConfig(getConfig())
        return { type: opt.label, value, unit: opt.unit }
    }
})

defineTool('add_substat', {
    description:
        '给指定角色槽位（1-3）第 N 个声骸（1-5）追加一条副词条。label 取值：攻击/生命/防御/暴击率/暴击伤害/共鸣效率/治疗加成/攻击%/生命%/防御%（攻击% 等百分比词条）。不传 value 时使用中档默认值。',
    parameters: {
        type: 'object',
        properties: {
            char: { type: 'number' },
            slot: { type: 'number' },
            label: { type: 'string', description: '副词条名称' },
            value: { type: 'number', description: '可选，覆盖中档默认值（百分数词条填数值，如 8 表示 8%）' }
        },
        required: ['char', 'slot', 'label']
    },
    handler: async (args) => {
        const char = Number(args.char)
        const slot = Number(args.slot)
        const label = str(args.label)
        if (!Number.isInteger(char) || char < 1 || char > 3) throw new Error('char 须为 1-3')
        if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new Error('slot 须为 1-5')
        if (!label) throw new Error('缺少词条名称')
        const before = getConfig().characters[char - 1].echoes[slot - 1].substats.length
        addSubstat(char - 1, slot - 1, label)
        const after = getConfig().characters[char - 1].echoes[slot - 1].substats.length
        if (after <= before) throw new Error('副词条已达上限或已存在该词条')
        if (args.value !== undefined) {
            const value = Number(args.value)
            if (!Number.isFinite(value)) throw new Error('value 须为数字')
            updateSubstatValue(char - 1, slot - 1, after - 1, value)
            await updateConfig(getConfig())
            return { added: label, value }
        }
        await updateConfig(getConfig())
        return { added: label }
    }
})

defineTool('remove_substat', {
    description: '移除指定角色槽位（1-3）第 N 个声骸（1-5）的第 idx 条副词条（从 0 开始）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: { char: { type: 'number' }, slot: { type: 'number' }, idx: { type: 'number' } },
        required: ['char', 'slot', 'idx']
    },
    handler: async (args) => {
        const char = Number(args.char)
        const slot = Number(args.slot)
        const idx = Number(args.idx)
        if (!Number.isInteger(char) || char < 1 || char > 3) throw new Error('char 须为 1-3')
        if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new Error('slot 须为 1-5')
        if (!Number.isInteger(idx) || idx < 0) throw new Error('idx 须为非负整数')
        removeSubstat(char - 1, slot - 1, idx)
        await updateConfig(getConfig())
        return { removed: true }
    }
})

defineTool('update_substat_value', {
    description:
        '修改指定角色槽位（1-3）第 N 个声骸（1-5）第 idx 条副词条（从 0 开始）的数值（百分数词条填数值，如 8 表示 8%）。',
    parameters: {
        type: 'object',
        properties: {
            char: { type: 'number' },
            slot: { type: 'number' },
            idx: { type: 'number' },
            value: { type: 'number' }
        },
        required: ['char', 'slot', 'idx', 'value']
    },
    handler: async (args) => {
        const char = Number(args.char)
        const slot = Number(args.slot)
        const idx = Number(args.idx)
        const value = Number(args.value)
        if (!Number.isInteger(char) || char < 1 || char > 3) throw new Error('char 须为 1-3')
        if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new Error('slot 须为 1-5')
        if (!Number.isInteger(idx) || idx < 0) throw new Error('idx 须为非负整数')
        if (!Number.isFinite(value)) throw new Error('value 须为数字')
        updateSubstatValue(char - 1, slot - 1, idx, value)
        await updateConfig(getConfig())
        return { updated: true }
    }
})

defineTool('update_enemy', {
    description:
        '修改敌人配置项：level（等级）、defense（防御）、dmgReduction（减伤，数值如 10 表示 10%）、type（BOSS/精英怪/小怪）。',
    parameters: {
        type: 'object',
        properties: {
            key: { type: 'string', enum: ['level', 'defense', 'dmgReduction', 'type'] },
            value: { type: ['number', 'string'] }
        },
        required: ['key', 'value']
    },
    handler: async (args) => {
        const key = str(args.key) as 'level' | 'defense' | 'dmgReduction' | 'type'
        if (key === 'type') {
            const t = str(args.value)
            if (!['BOSS', '精英怪', '小怪'].includes(t)) throw new Error('type 须为 BOSS/精英怪/小怪')
            updateEnemy('type', t as never)
        } else {
            const v = Number(args.value)
            if (!Number.isFinite(v)) throw new Error('value 须为数字')
            updateEnemy(key, v as never)
        }
        await updateConfig(getConfig())
        return { key, updated: true }
    }
})

defineTool('update_resistance', {
    description: '修改敌人某元素抗性（百分比数值，如 10 表示 10%）。元素：物理/冷凝/热熔/导电/气动/衍射/湮灭。',
    parameters: {
        type: 'object',
        properties: { element: { type: 'string' }, value: { type: 'number' } },
        required: ['element', 'value']
    },
    handler: async (args) => {
        const element = str(args.element)
        const value = Number(args.value)
        if (!element) throw new Error('缺少元素名')
        if (!Number.isFinite(value)) throw new Error('value 须为数字')
        updateResistance(element, value)
        await updateConfig(getConfig())
        return { element, value }
    }
})
