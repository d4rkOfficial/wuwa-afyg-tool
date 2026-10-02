// 排轴域工具（Phase 3）：轴摘要、增删块、按键/变奏设置、撤销重做、格式化、参考线、伤害倍率绑定
import { defineTool } from './registry'
import {
    getOpBlocks,
    getRefLines,
    getDamageBlocks,
    getLocked,
    getTeam,
    addOpBlock,
    removeBlock,
    setBlockKey,
    setBlockSpecial,
    reflowTrack,
    formatTimeline,
    undo,
    redo,
    addRefLineAt,
    removeLine,
    getDamageList,
    getFullSkillGroups,
    setDamageBlockSkillHits,
    setDamageBlockNonDirectEntries,
    setOpBlockPos,
    setRefLinePos,
    getMaxPos,
    getCustomSkillHits,
    getTimelineState
} from '$lib/calc/timeline.store.svelte'
import { updateTimeline, updateResultAnalysis, getActiveProject } from '$lib/data/project.svelte'
import { BUTTON_KEY_ORDER, NON_DIRECT_CONFIGS, SIDE_PAD, PPS } from '$lib/calc/timeline.consts'
import { resolveRefLineSeconds, type RefLineLike } from '$lib/calc/ref-line-timing'
import { renderDamageRatioList, renderTimelineDigest } from '$lib/ai/phase-digest'
import { opBlocksInOrder, refLinesInOrder, resolveOpBlock, resolveRefLine } from '$lib/ai/refs'
import type { SkillHit, NonDirectEntry } from '$lib/calc/timeline.types'

const str = (v: unknown): string => String(v ?? '').trim()
const BLOCK_W = 60

// 按键名规范化：id/中文/单字母 → 图标键（MouseLeft/SpaceBar/Q/E/R/F/T...）
const BLOCK_KEY_ALIASES: Record<string, string> = {
    attack: 'MouseLeft',
    heavypress: 'MouseLeft',
    dodge: 'MouseRight',
    q: 'Q',
    e: 'E',
    r: 'R',
    f: 'F',
    t: 'T',
    space: 'SpaceBar',
    普攻: 'MouseLeft',
    重击: 'MouseLeft',
    闪避: 'MouseRight',
    跳跃: 'SpaceBar',
    共鸣技能: 'E',
    共鸣解放: 'R',
    声骸技能: 'Q',
    谐度破坏: 'F'
}
const VALID_BLOCK_KEYS = new Set<string>(BUTTON_KEY_ORDER as readonly string[])

function normalizeBlockKey(raw: string): string {
    const v = raw.trim()
    if (BLOCK_KEY_ALIASES[v]) return BLOCK_KEY_ALIASES[v]
    if (VALID_BLOCK_KEYS.has(v)) return v
    const upper = v.toUpperCase()
    if (VALID_BLOCK_KEYS.has(upper)) return upper
    return ''
}

// 追加位置：三行（所有轨道）最右空白位置，保证按顺序排轴
function appendPos(): number {
    let maxRight = 0
    for (const b of getOpBlocks()) {
        maxRight = Math.max(maxRight, b.pos + BLOCK_W / 2)
    }
    return maxRight > 0 ? maxRight + BLOCK_W / 2 : 40 + BLOCK_W / 2
}

// 解析位置参数：{time: 秒} 绝对时间，或 {anchor: 块序号, side?: before/after, offset?: 秒} 相对块
function resolvePosition(position: Record<string, unknown>): number {
    if (position.time !== undefined) {
        const t = Number(position.time)
        const maxT = Math.floor((getMaxPos() - SIDE_PAD) / PPS)
        if (!Number.isFinite(t) || t < 0 || t > maxT) throw new Error(`time 须为 0-${maxT} 秒`)
        return SIDE_PAD + t * PPS
    }
    const anchorRef = position.anchor
    if (anchorRef === undefined || anchorRef === null || String(anchorRef).trim() === '')
        throw new Error('需要 time（秒）或 anchor（目标操作块序号）')
    const anchor = resolveOpBlock(anchorRef)
    const side = str(position.side) === 'before' ? 'before' : 'after'
    const offset = Number(position.offset ?? 0)
    if (!Number.isFinite(offset) || offset < 0) throw new Error('offset 须为非负数字（秒）')
    const gap = BLOCK_W / 2 + offset * PPS
    return side === 'before' ? anchor.pos - gap : anchor.pos + gap
}

defineTool('get_timeline_summary', {
    description:
        '获取当前排轴：**按时间（pos）顺序**列出所有操作块、参考线与已绑定的伤害。每行给出秒数、轨道与角色、操作内容、id，其下缩进列出该块绑定的伤害命中（只给命中名，**不含倍率**——倍率用 get_timeline_damage_list 按需查）。AI 需要看排轴结构时调用（比原始 JSON 更紧凑、顺序更清楚）。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const team = getTeam()
        return {
            locked: getLocked(),
            timeline: renderTimelineDigest({
                opBlocks: getOpBlocks(),
                refLines: getRefLines(),
                damageBlocks: getDamageBlocks(),
                trackLabels: team.map((s, i) => s?.character ?? `轨${i + 1}`),
                locked: getLocked(),
                sidePad: SIDE_PAD,
                pps: PPS,
                timings: getTimings()
            })
        }
    }
})

defineTool('get_timeline_damage_list', {
    description:
        '**按需**查询排轴里每个已绑定伤害的**倍率明细**（命中名、倍率、属性、系数类型；含效应/处决/响应的折算结果），按时间顺序每行一条。只想看排轴结构（哪些块、绑了什么）请用 get_timeline_summary —— 那里不含倍率，避免无谓的 token 开销。',
    parameters: { type: 'object', properties: {} },
    handler: () => ({ ratios: renderDamageRatioList(getDamageList(), SIDE_PAD, PPS) })
})

defineTool('add_op_block', {
    description:
        '在当前排轴指定轨道（1-3）追加一个操作块，位置为三行最右空白位置（按顺序排轴：新块总是落在所有操作块之后）。key 支持：普攻/重击/闪避/跳跃/共鸣技能/共鸣解放/声骸技能/谐度破坏，或 Q/E/R/F/T 等字母。desc 为描述文本（如“重击”“变奏入场”）。返回新块的**序号**（时间轴上的第几个操作块）。',
    parameters: {
        type: 'object',
        properties: {
            track: { type: 'number', description: '轨道 1-3' },
            key: {
                type: 'string',
                description: '按键名（普攻/重击/闪避/跳跃/共鸣技能/共鸣解放/声骸技能/谐度破坏 或 字母）'
            },
            desc: { type: 'string', description: '描述（可空）' }
        },
        required: ['track', 'key']
    },
    handler: async (args) => {
        const track = Number(args.track)
        const rawKey = str(args.key)
        if (!Number.isInteger(track) || track < 1 || track > 3) throw new Error('track 须为 1-3')
        const key = normalizeBlockKey(rawKey)
        if (!key)
            throw new Error(
                `无效按键名：${rawKey}（可用：普攻/重击/闪避/跳跃/共鸣技能/共鸣解放/声骸技能/谐度破坏 或 Q/E/R/F/T 等字母）`
            )
        let desc = str(args.desc)
        // 重击/普攻同键（MouseLeft），用描述区分
        if (!desc && (rawKey === '重击' || rawKey === 'heavypress')) desc = '重击'
        const id = addOpBlock(track - 1, appendPos(), key, desc)
        if (!id) throw new Error('排轴已锁定或添加失败')
        await updateTimeline(getTimelineState())
        const index = opBlocksInOrder().findIndex((b) => b.id === id) + 1
        return { block: index, track, key, desc }
    }
})

defineTool('get_char_skills', {
    description:
        '获取指定角色可绑定的伤害命中列表（技能类型、命中名、倍率、元素），含：角色技能、装备声骸技能、用户自定义直伤（技能类型分别为声骸技能/自定义）。用于把伤害倍率绑定到操作块。',
    parameters: {
        type: 'object',
        properties: { character: { type: 'string', description: '角色名' } },
        required: ['character']
    },
    handler: async (args) => {
        const character = str(args.character)
        if (!character) throw new Error('缺少角色名')
        const groups = await getFullSkillGroups(character)
        const hits: Array<{ skillType: string; hitName: string; ratio: string; element: string }> = []
        for (const g of groups) {
            for (const h of g.hits) {
                if (g.type === '自定义') {
                    const ch = getCustomSkillHits()[character]?.find((c) => c.id === h.name)
                    if (ch) hits.push({ skillType: g.type, hitName: ch.name, ratio: h.ratio, element: h.element })
                } else {
                    hits.push({ skillType: g.type, hitName: h.name, ratio: h.ratio, element: h.element })
                }
            }
        }
        if (hits.length === 0) throw new Error(`未找到角色「${character}」的技能数据`)
        return hits
    }
})

defineTool('bind_damage_to_block', {
    description:
        '把伤害倍率绑定到指定操作块：hits 为 [{character, hitName, hits?}]，hitName 用 get_char_skills 查询到的命中名（含角色技能、声骸技能、自定义直伤）；hits 为该命中次数（默认 1）。可一次绑定多条。',
    parameters: {
        type: 'object',
        properties: {
            block: {
                type: 'number',
                description: '操作块**序号**（时间轴上第几个，见 get_timeline_summary 的「[块N]」）'
            },
            hits: {
                type: 'array',
                description: '要绑定到该操作块的伤害条目列表',
                items: {
                    type: 'object',
                    properties: {
                        character: { type: 'string', description: '伤害来源角色名' },
                        hitName: { type: 'string', description: '倍率名（用 get_skill_options 查询）' },
                        hits: { type: 'number', description: '段数（默认 1）' }
                    },
                    required: ['character', 'hitName']
                }
            }
        },
        required: ['block', 'hits']
    },
    handler: async (args) => {
        const block = resolveOpBlock(args.block)
        const blockId = block.id
        const raw = Array.isArray(args.hits) ? args.hits : []
        if (raw.length === 0) throw new Error('缺少命中列表')

        const skillHits: SkillHit[] = []
        for (const item of raw) {
            const o = (item ?? {}) as Record<string, unknown>
            const character = str(o.character)
            const hitName = str(o.hitName)
            if (!character || !hitName) throw new Error('character 与 hitName 不能为空')
            const groups = await getFullSkillGroups(character)
            let found: { skillType: string; ratio: string; element: string } | null = null
            for (const g of groups) {
                let h: { name: string; ratio: string; element: string } | null = null
                if (g.type === '自定义') {
                    const ch = getCustomSkillHits()[character]?.find((c) => c.name === hitName)
                    if (ch) h = g.hits.find((x) => x.name === ch.id) ?? null
                } else {
                    h = g.hits.find((x) => x.name === hitName) ?? null
                }
                if (h) {
                    found = { skillType: g.type, ratio: h.ratio, element: h.element }
                    break
                }
            }
            if (!found) {
                const names = groups.flatMap((g) =>
                    g.type === '自定义'
                        ? g.hits.map(
                              (h) => getCustomSkillHits()[character]?.find((c) => c.id === h.name)?.name ?? h.name
                          )
                        : g.hits.map((h) => h.name)
                )
                throw new Error(`角色「${character}」无命中「${hitName}」（可用：${names.slice(0, 20).join('、')}）`)
            }
            const entry: SkillHit = {
                character,
                skillType: found.skillType,
                hitName,
                ratio: found.ratio,
                element: found.element
            }
            const count = Number(o.hits)
            if (Number.isInteger(count) && count > 1) entry.hits = count
            skillHits.push(entry)
        }

        setDamageBlockSkillHits(blockId, skillHits)
        await updateTimeline(getTimelineState())
        return { bound: skillHits.length, blockId }
    }
})

defineTool('remove_op_block', {
    description: '删除指定操作块（按**序号**）。删除后其余块的序号会前移，后续操作请重新读 get_timeline_summary。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: { block: { type: 'number', description: '操作块序号（见 get_timeline_summary 的「[块N]」）' } },
        required: ['block']
    },
    handler: async (args) => {
        const block = resolveOpBlock(args.block)
        removeBlock(block.id)
        await updateTimeline(getTimelineState())
        return { removed: true, key: block.key }
    }
})

defineTool('set_block_key', {
    description:
        '修改指定操作块的按键（按**序号**）。key 可用：普攻/重击/闪避/跳跃/共鸣技能/共鸣解放/声骸技能/谐度破坏 或字母。',
    parameters: {
        type: 'object',
        properties: {
            block: { type: 'number', description: '操作块序号' },
            key: { type: 'string', description: '新按键名' }
        },
        required: ['block', 'key']
    },
    handler: async (args) => {
        const block = resolveOpBlock(args.block)
        const key = str(args.key)
        if (!key) throw new Error('缺少 key')
        setBlockKey(block.id, key)
        await updateTimeline(getTimelineState())
        return { updated: true, key }
    }
})

defineTool('set_block_special', {
    description: '设置指定操作块的变奏标记（按**序号**）：intro=变奏入场、switchback=切回、none=取消。',
    parameters: {
        type: 'object',
        properties: {
            block: { type: 'number', description: '操作块序号' },
            kind: {
                type: 'string',
                enum: ['none', 'intro', 'switchback'],
                description: '特殊标记：none=无，intro=变奏（入场），switchback=切回'
            }
        },
        required: ['block', 'kind']
    },
    handler: async (args) => {
        const block = resolveOpBlock(args.block)
        const kind = str(args.kind) as 'none' | 'intro' | 'switchback'
        if (!['none', 'intro', 'switchback'].includes(kind)) throw new Error(`无效标记：${kind}`)
        setBlockSpecial(block.id, kind)
        await updateTimeline(getTimelineState())
        return { block: args.block, kind }
    }
})

defineTool('undo_timeline', {
    description: '撤销上一次排轴操作。',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        undo()
        await updateTimeline(getTimelineState())
        return { undone: true }
    }
})

defineTool('redo_timeline', {
    description: '重做上一次撤销的排轴操作。',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        redo()
        await updateTimeline(getTimelineState())
        return { redone: true }
    }
})

defineTool('format_timeline', {
    description: '自动格式化排轴：各操作块右边界对齐下一个块（可跨角色）的左边界，参考线跟随其左右块。',
    dangerous: true,
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        formatTimeline()
        await updateTimeline(getTimelineState())
        return { formatted: true }
    }
})

defineTool('reflow_track', {
    description: '重新排布指定轨道（1-3）的操作块，消除重叠。',
    parameters: {
        type: 'object',
        properties: { track: { type: 'number', description: '要重排的轨道（1-3）' } },
        required: ['track']
    },
    handler: async (args) => {
        const track = Number(args.track)
        if (!Number.isInteger(track) || track < 1 || track > 3) throw new Error('track 须为 1-3')
        reflowTrack(track - 1)
        await updateTimeline(getTimelineState())
        return { reflowed: track }
    }
})

defineTool('move_op_block', {
    description:
        '把已有操作块移动到指定位置（按**序号**）：position 为 {time: 秒}（绝对时间 0 至当前结束线）或 {anchor: 块序号, side: before/after（默认 after）, offset?: 秒}（相对某块）。移动后自动消除同轨道重叠。',
    parameters: {
        type: 'object',
        properties: {
            block: { type: 'number', description: '要移动的操作块序号' },
            position: {
                type: 'object',
                description:
                    '把操作块移动到哪个时间位置：{time: 秒}（绝对时间 0 至当前结束线）或 {anchor: 块序号, side, offset}（相对某块）',
                properties: {
                    time: { type: 'number', description: '绝对时间（秒，0 至当前结束线）' },
                    anchor: { type: 'number', description: '目标操作块序号（相对它移动）' },
                    side: { type: 'string', enum: ['before', 'after'] },
                    offset: { type: 'number', description: '相对偏移（秒，默认 0）' }
                }
            }
        },
        required: ['block', 'position']
    },
    handler: async (args) => {
        const block = resolveOpBlock(args.block)
        const raw = (args.position ?? {}) as Record<string, unknown>
        const pos = resolvePosition(raw)
        const set = setOpBlockPos(block.id, pos)
        if (set === null) throw new Error('设置位置失败（排轴已锁定或块不存在）')
        reflowTrack(block.trackIndex)
        await updateTimeline(getTimelineState())
        return { moved: true, track: block.trackIndex + 1, pos: set }
    }
})

defineTool('move_ref_line', {
    description:
        '把已有参考线移动到指定位置（按**序号**）：position 为 {time: 秒}（绝对时间 0 至当前结束线）或 {anchor: 块序号, side: before/after, offset?: 秒}（相对某块）。与相邻参考线保持最小间距，过近会报错。',
    parameters: {
        type: 'object',
        properties: {
            line: { type: 'number', description: '参考线序号（见 get_timeline_summary 的「[线N]」）' },
            position: {
                type: 'object',
                description:
                    '把参考线移动到哪个时间位置：{time: 秒}（绝对时间 0 至当前结束线）或 {anchor: 块序号, side, offset}（相对某块）',
                properties: {
                    time: { type: 'number', description: '绝对时间（秒，0 至当前结束线）' },
                    anchor: { type: 'number', description: '目标操作块序号（相对它移动）' },
                    side: { type: 'string', enum: ['before', 'after'] },
                    offset: { type: 'number', description: '相对偏移（秒，默认 0）' }
                }
            }
        },
        required: ['line', 'position']
    },
    handler: async (args) => {
        const ref = resolveRefLine(args.line)
        const raw = (args.position ?? {}) as Record<string, unknown>
        const pos = resolvePosition(raw)
        const set = setRefLinePos(ref.id, pos)
        if (set === null) throw new Error('目标位置与相邻参考线间距不足或超出范围')
        await updateTimeline(getTimelineState())
        return { moved: true, pos: set }
    }
})

defineTool('add_ref_line', {
    description:
        '在当前排轴最右空白位置添加参考线（按顺序排轴：参考线落在所有操作块之后），用于标记时间节点（如启动轴/循环轴）。返回新参考线的**序号**。',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        let maxRight = 0
        for (const b of getOpBlocks()) {
            maxRight = Math.max(maxRight, b.pos + BLOCK_W / 2)
        }
        const x = Math.max(SIDE_PAD, Math.min(getMaxPos(), maxRight > 0 ? maxRight : SIDE_PAD))
        const before = new Set(getRefLines().map((r) => r.id))
        const ok = addRefLineAt(x)
        if (!ok) throw new Error('空间不足，无法创建参考线（与相邻参考线过近）')
        await updateTimeline(getTimelineState())
        const ordered = refLinesInOrder()
        const line = ordered.findIndex((r) => !before.has(r.id)) + 1
        return { added: true, line }
    }
})

defineTool('remove_ref_line', {
    description: '删除指定参考线（按**序号**）。删除后其余参考线的序号会前移，后续操作请重新读 get_timeline_summary。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: { line: { type: 'number', description: '参考线序号' } },
        required: ['line']
    },
    handler: async (args) => {
        const ref = resolveRefLine(args.line)
        removeLine(ref.id)
        await updateTimeline(getTimelineState())
        return { removed: true, name: ref.time || '未命名' }
    }
})

defineTool('get_non_direct_options', {
    description:
        '获取可绑定到操作块的非直伤选项：谐度破坏（处决，可带触发角色）、震谐响应/骇破响应（偏谐响应，必须带触发角色）、各类效应（层数 1-上限、元素），以及电磁爆发（须先绑电磁效应）。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const options = NON_DIRECT_CONFIGS.map((c) => ({
            name: c.name,
            category: c.category,
            maxLayers: c.max,
            element: 'element' in c ? c.element : ''
        }))
        return {
            options: [...options, { name: '电磁爆发', category: '效应', maxLayers: 19, element: '导电' }]
        }
    }
})

defineTool('bind_non_direct_to_block', {
    description:
        '把非直伤绑定到指定操作块（可覆盖原有绑定）：entries 为 [{name, layers?, responders?}]，名称用 get_non_direct_options 获取。谐度破坏/震谐响应/骇破响应 可带 responders（触发角色名数组，响应必须有）；效应必须带 layers（1-上限）。',
    parameters: {
        type: 'object',
        properties: {
            block: { type: 'number', description: '操作块**序号**（见 get_timeline_summary 的「[块N]」）' },
            entries: {
                type: 'array',
                description: '非直伤条目列表（整体覆盖该块）：处决/响应/效应',
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: '条目名（用 get_non_direct_options 查询）' },
                        layers: { type: 'number', description: '层数（效应类用，默认 1）' },
                        responders: { type: 'array', items: { type: 'string' }, description: '响应者角色名列表' }
                    },
                    required: ['name']
                }
            }
        },
        required: ['block', 'entries']
    },
    handler: async (args) => {
        const block = resolveOpBlock(args.block)
        const blockId = block.id
        const raw = Array.isArray(args.entries) ? args.entries : []
        if (raw.length === 0) throw new Error('缺少非直伤条目')
        const configMap = new Map<string, (typeof NON_DIRECT_CONFIGS)[number]>(
            NON_DIRECT_CONFIGS.map((c) => [c.name, c])
        )
        const entries: NonDirectEntry[] = []
        for (const item of raw) {
            const o = (item ?? {}) as Record<string, unknown>
            const name = str(o.name)
            if (name === '电磁爆发') {
                const layers = Number(o.layers)
                if (!Number.isInteger(layers) || layers < 1 || layers > 19) throw new Error('电磁爆发 层数须为 1-19')
                entries.push({ name, category: '效应', layers })
                continue
            }
            const cfg = configMap.get(name)
            if (!cfg) {
                const names = [...NON_DIRECT_CONFIGS.map((c) => c.name), '电磁爆发']
                throw new Error(`未知非直伤：${name}（可用：${names.join('、')}）`)
            }
            const responders = Array.isArray(o.responders) ? o.responders.map((r) => str(r)).filter(Boolean) : []
            if (cfg.category === '处决') {
                entries.push({
                    name,
                    category: '处决',
                    layers: 0,
                    responders: responders.length ? responders : undefined
                })
            } else if (cfg.category === '响应') {
                if (responders.length === 0) throw new Error(`${name} 需要 responders（触发角色名）`)
                entries.push({ name, category: '响应', layers: 0, responders })
            } else {
                const layers = Number(o.layers)
                if (!Number.isInteger(layers) || layers < 1 || layers > cfg.max)
                    throw new Error(`${name} 层数须为 1-${cfg.max}`)
                entries.push({ name, category: '效应', layers })
            }
        }
        setDamageBlockNonDirectEntries(blockId, entries)
        await updateTimeline(getTimelineState())
        return { bound: entries.length, blockId }
    }
})

// ── 时间参考线记点（结果分析用，timings 持久在 project.analysis）──

/** @desc 取当前工程的 timings（analysis.timings，缺省为空数组） */
const getTimings = (): { refLineId: string; seconds: number | null }[] => {
    const p = getActiveProject()
    return p?.analysis?.timings ? JSON.parse(JSON.stringify(p.analysis.timings)) : []
}

defineTool('get_ref_line_timings', {
    description:
        '查询时间参考线记点状态：哪些参考线已启用为时间记点、各自的秒数（null=未填写/未解析，不参与 DPS 分段）。秒数来源：自动推导（从参考线命名解析）或自定义覆盖。结果按参考线在时间轴上的位置排序，并给出**序号**。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const timings = getTimings()
        const ordered = refLinesInOrder()
        const enabled = new Map(timings.map((t) => [t.refLineId, t.seconds]))
        const rows = ordered
            .map((rl, i) => ({ rl, line: i + 1 }))
            .filter(({ rl }) => enabled.has(rl.id))
            .map(({ rl, line }) => {
                const seconds = enabled.get(rl.id) ?? null
                return {
                    line,
                    name: rl.time || '未命名',
                    seconds,
                    status: seconds === null ? '未填写（不参与分段）' : '已填写'
                }
            })
        return {
            timings: rows,
            totalEnabled: rows.length,
            validCount: rows.filter((r) => r.seconds !== null).length,
            hint: 'seconds=null 表示「未填写」（名称无时间片段）；用 enable_ref_line_timing 启用、disable_ref_line_timing 禁用、set_ref_line_timing_seconds 设自定义秒数；参数里的 line 就是这里的序号。'
        }
    }
})

defineTool('enable_ref_line_timing', {
    description:
        '启用某条参考线作为时间记点（按**序号**）。启用时秒数自动推导：按参考线命名解析时间片段（如 "1m30s"→90、"起手"→null 未解析）；结束线（最后一条）默认 120s。若该参考线已启用则幂等返回当前状态。',
    parameters: {
        type: 'object',
        properties: { line: { type: 'number', description: '参考线序号（见 get_timeline_summary 的「[线N]」）' } },
        required: ['line']
    },
    handler: async (args) => {
        const ref = resolveRefLine(args.line)
        const id = ref.id
        const refLines = getRefLines()
        const project = getActiveProject()
        if (!project) throw new Error('当前没有活动工程')
        const timings = getTimings()
        if (timings.some((t) => t.refLineId === id)) {
            return { line: args.line, alreadyEnabled: true, timings }
        }
        const seconds = resolveRefLineSeconds(id, refLines as RefLineLike[], timings)
        const next = [...timings, { refLineId: id, seconds }]
        await updateResultAnalysis({
            ...project.analysis,
            timings: next
        })
        return {
            line: args.line,
            name: ref.time || '未命名',
            enabled: true,
            seconds,
            status: seconds === null ? '未填写（名称无时间片段，需手动设秒数）' : '自动推导',
            timings: next
        }
    }
})

defineTool('disable_ref_line_timing', {
    description:
        '禁用某条参考线的时间记点（按**序号**，从 timings 移除，不再参与 DPS 分段）。若该参考线未启用则幂等返回。',
    parameters: {
        type: 'object',
        properties: { line: { type: 'number', description: '参考线序号' } },
        required: ['line']
    },
    handler: async (args) => {
        const id = resolveRefLine(args.line).id
        const project = getActiveProject()
        if (!project) throw new Error('当前没有活动工程')
        const timings = getTimings()
        if (!timings.some((t) => t.refLineId === id)) {
            return { line: args.line, alreadyDisabled: true, timings }
        }
        const next = timings.filter((t) => t.refLineId !== id)
        await updateResultAnalysis({
            ...project.analysis,
            timings: next
        })
        return { line: args.line, disabled: true, timings: next }
    }
})

defineTool('set_ref_line_timing_seconds', {
    description:
        '设置已启用记点的秒数（按**序号**）。mode=auto：按参考线命名自动推导（清空自定义覆盖，回到自动解析值；命名无时间片段则秒数为 null「未填写」）；mode=custom：手动填秒数（须 ≥ 0，负数/空串视为清除→null「未填写」）。若该参考线尚未启用，会先自动启用再设秒数。',
    parameters: {
        type: 'object',
        properties: {
            line: { type: 'number', description: '参考线序号' },
            mode: {
                type: 'string',
                enum: ['auto', 'custom'],
                description: 'auto=自动推导（从命名解析），custom=自定义秒数'
            },
            seconds: { type: 'number', description: '秒数（mode=custom 时必填，≥0；留空/负数→清除为 null 未填写）' }
        },
        required: ['line', 'mode']
    },
    handler: async (args) => {
        const id = resolveRefLine(args.line).id
        const mode = str(args.mode)
        const refLines = getRefLines()
        const project = getActiveProject()
        if (!project) throw new Error('当前没有活动工程')
        const timings = getTimings()

        let seconds: number | null
        if (mode === 'auto') {
            seconds = resolveRefLineSeconds(id, refLines as RefLineLike[], timings)
        } else if (mode === 'custom') {
            const raw = args.seconds
            if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
                seconds = null
            } else {
                seconds = raw
            }
        } else {
            throw new Error('mode 须为 auto/custom')
        }

        // 若未启用 → 先加入；已启用 → 覆盖秒数
        const next = timings.some((t) => t.refLineId === id)
            ? timings.map((t) => (t.refLineId === id ? { ...t, seconds } : t))
            : [...timings, { refLineId: id, seconds }]
        await updateResultAnalysis({
            ...project.analysis,
            timings: next
        })
        return {
            line: args.line,
            mode,
            seconds,
            status: seconds === null ? '未填写（不参与分段）' : '已填写',
            timings: next
        }
    }
})
