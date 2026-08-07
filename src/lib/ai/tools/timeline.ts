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
    getSkillCache,
    loadCharSkills,
    setDamageBlockSkillHits,
    getTimelineState
} from '$lib/components/page/home/timeline/timeline.store.svelte'
import { updateTimeline } from '$lib/data/project.svelte'
import { BUTTON_KEY_ORDER } from '$lib/components/page/home/timeline/timeline.consts'
import type { SkillHit } from '$lib/components/page/home/timeline/timeline.types'

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

// 技能缓存读取（未加载则异步拉取）
async function skillGroupsFor(character: string) {
    const cached = getSkillCache()[character]
    if (cached && cached.length > 0) return cached
    return loadCharSkills(character)
}

function appendPos(trackIndex: number): number {
    let maxRight = 0
    for (const b of getOpBlocks()) {
        if (b.trackIndex !== trackIndex) continue
        maxRight = Math.max(maxRight, b.pos + BLOCK_W / 2)
    }
    return maxRight > 0 ? maxRight + BLOCK_W / 2 : 40 + BLOCK_W / 2
}

defineTool('get_timeline_summary', {
    description:
        '获取当前排轴摘要：每轨（角色）的操作块（id、按键、描述、是否变奏入场/切回）、参考线、伤害条目数、环节是否锁定。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const team = getTeam()
        const blocks = getOpBlocks()
        return {
            locked: getLocked(),
            tracks: team.map((_, i) => {
                const list = blocks
                    .filter((b) => b.trackIndex === i)
                    .sort((a, b) => a.pos - b.pos)
                    .map((b) => ({
                        id: b.id,
                        key: b.key,
                        desc: b.desc,
                        intro: b.intro,
                        switchback: b.switchback
                    }))
                return { track: i + 1, character: team[i]?.character ?? null, blocks: list }
            }),
            refLines: getRefLines().map((r) => ({ id: r.id, time: r.time })),
            damageBlockCount: getDamageBlocks().length
        }
    }
})

defineTool('get_timeline_damage_list', {
    description: '获取排轴中的伤害条目清单（供了解哪些操作被标记为伤害）。',
    parameters: { type: 'object', properties: {} },
    handler: () => getDamageList()
})

defineTool('add_op_block', {
    description:
        '在当前排轴指定轨道（1-3）末尾追加一个操作块。key 支持：普攻/重击/闪避/跳跃/共鸣技能/共鸣解放/声骸技能/谐度破坏，或 Q/E/R/F/T 等字母。desc 为描述文本（如“重击”“变奏入场”）。',
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
        const id = addOpBlock(track - 1, appendPos(track - 1), key, desc)
        if (!id) throw new Error('排轴已锁定或添加失败')
        await updateTimeline(getTimelineState())
        return { id, track, key, desc }
    }
})

defineTool('get_char_skills', {
    description: '获取指定角色可绑定的伤害命中列表（技能类型、命中名、倍率、元素），用于把伤害倍率绑定到操作块。',
    parameters: {
        type: 'object',
        properties: { character: { type: 'string', description: '角色名' } },
        required: ['character']
    },
    handler: async (args) => {
        const character = str(args.character)
        if (!character) throw new Error('缺少角色名')
        const groups = await skillGroupsFor(character)
        const hits: Array<{ skillType: string; hitName: string; ratio: string; element: string }> = []
        for (const g of groups) {
            for (const h of g.hits)
                hits.push({ skillType: g.type, hitName: h.name, ratio: h.ratio, element: h.element })
        }
        if (hits.length === 0) throw new Error(`未找到角色「${character}」的技能数据`)
        return hits
    }
})

defineTool('bind_damage_to_block', {
    description:
        '把伤害倍率绑定到指定操作块：hits 为 [{character, hitName, hits?}]，hitName 用 get_char_skills 查询到的命中名；hits 为该命中次数（默认 1）。可一次绑定多条。',
    parameters: {
        type: 'object',
        properties: {
            blockId: { type: 'string', description: '操作块 id（get_timeline_summary 获取）' },
            hits: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        character: { type: 'string' },
                        hitName: { type: 'string' },
                        hits: { type: 'number' }
                    },
                    required: ['character', 'hitName']
                }
            }
        },
        required: ['blockId', 'hits']
    },
    handler: async (args) => {
        const blockId = str(args.blockId)
        if (!blockId) throw new Error('缺少块 id')
        const raw = Array.isArray(args.hits) ? args.hits : []
        if (raw.length === 0) throw new Error('缺少命中列表')

        const skillHits: SkillHit[] = []
        for (const item of raw) {
            const o = (item ?? {}) as Record<string, unknown>
            const character = str(o.character)
            const hitName = str(o.hitName)
            if (!character || !hitName) throw new Error('character 与 hitName 不能为空')
            const groups = await skillGroupsFor(character)
            let found: { skillType: string; ratio: string; element: string } | null = null
            for (const g of groups) {
                const h = g.hits.find((x) => x.name === hitName)
                if (h) {
                    found = { skillType: g.type, ratio: h.ratio, element: h.element }
                    break
                }
            }
            if (!found) {
                const names = groups.flatMap((g) => g.hits.map((h) => h.name))
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
    description: '删除指定操作块（按 id）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '操作块 id（get_timeline_summary 获取）' } },
        required: ['id']
    },
    handler: async (args) => {
        const id = str(args.id)
        if (!id) throw new Error('缺少块 id')
        removeBlock(id)
        await updateTimeline(getTimelineState())
        return { removed: id }
    }
})

defineTool('set_block_key', {
    description: '修改指定操作块的按键。',
    parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, key: { type: 'string' } },
        required: ['id', 'key']
    },
    handler: async (args) => {
        const id = str(args.id)
        const key = str(args.key)
        if (!id || !key) throw new Error('id 与 key 不能为空')
        setBlockKey(id, key)
        await updateTimeline(getTimelineState())
        return { updated: true }
    }
})

defineTool('set_block_special', {
    description: '设置指定操作块的变奏标记：intro=变奏入场、switchback=切回、none=取消。',
    parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['none', 'intro', 'switchback'] } },
        required: ['id', 'kind']
    },
    handler: async (args) => {
        const id = str(args.id)
        const kind = str(args.kind) as 'none' | 'intro' | 'switchback'
        if (!id) throw new Error('缺少块 id')
        if (!['none', 'intro', 'switchback'].includes(kind)) throw new Error(`无效标记：${kind}`)
        setBlockSpecial(id, kind)
        await updateTimeline(getTimelineState())
        return { id, kind }
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
        properties: { track: { type: 'number' } },
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

defineTool('add_ref_line', {
    description:
        '在指定操作块附近添加参考线：side 为 before（块左侧）或 after（块右侧，默认）。参考线用于标记时间节点。',
    parameters: {
        type: 'object',
        properties: {
            blockId: { type: 'string', description: '操作块 id（get_timeline_summary 获取）' },
            side: { type: 'string', enum: ['before', 'after'], description: '默认 after' }
        },
        required: ['blockId']
    },
    handler: async (args) => {
        const blockId = str(args.blockId)
        const side = str(args.side) === 'before' ? 'before' : 'after'
        const block = getOpBlocks().find((b) => b.id === blockId)
        if (!block) throw new Error(`未找到操作块：${blockId}`)
        const x = side === 'before' ? block.pos - 40 : block.pos + 40
        const ok = addRefLineAt(x)
        if (!ok) throw new Error('空间不足，无法创建参考线（与相邻参考线过近）')
        await updateTimeline(getTimelineState())
        return { added: true, side }
    }
})

defineTool('remove_ref_line', {
    description: '删除指定参考线（按 id）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '参考线 id（get_timeline_summary 获取）' } },
        required: ['id']
    },
    handler: async (args) => {
        const id = str(args.id)
        if (!id) throw new Error('缺少参考线 id')
        removeLine(id)
        await updateTimeline(getTimelineState())
        return { removed: id }
    }
})
