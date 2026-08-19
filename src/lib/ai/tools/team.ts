// 队伍域写入工具（Phase 1 补全）：设置槽位角色/武器/首位声骸/触发套装，校验逻辑与 UI 选择器一致
import { defineTool } from './registry'
import { getActiveProject, updateTeam, isPhaseReadonly } from '$lib/data/project.svelte'
import { getCharacterList, getWeaponList, getEchoList, getEchoSetList } from '$lib/api/data-cache'
import type { Character } from '$lib/api/types'
import type { CharSlot, EchoSlot, SelectedSet } from '$lib/types/project'
import { HECATE_ECHO } from '$lib/consts/game-terms'

const str = (v: unknown): string => String(v ?? '').trim()

// 校验槽位 1-3
function assertSlot(slot: unknown): number {
    const s = Number(slot)
    if (!Number.isInteger(s) || s < 1 || s > 3) throw new Error('slot 须为 1-3')
    return s
}

// 校验存在活动工程且队伍阶段未锁定
function editableProject() {
    const p = getActiveProject()
    if (!p) throw new Error('当前没有活动工程')
    if (isPhaseReadonly(p, 'team')) throw new Error('队伍阶段已锁定，请先解锁')
    return p
}

// 有效套装总件数：同名取最大件数后求和（与 UI getEffectiveTotal 一致）
function effectiveTotal(sets: SelectedSet[]): number {
    const byName = new Map<string, number>()
    for (const s of sets) {
        const cur = byName.get(s.name) ?? 0
        if (s.pieces > cur) byName.set(s.name, s.pieces)
    }
    return [...byName.values()].reduce((a, b) => a + b, 0)
}

function cloneTeam(team: [CharSlot, CharSlot, CharSlot]): [CharSlot, CharSlot, CharSlot] {
    return JSON.parse(JSON.stringify(team)) as [CharSlot, CharSlot, CharSlot]
}

function emptyEchoSlot(): EchoSlot {
    return { name: null, cost: 0 }
}

function clearSlot(team: [CharSlot, CharSlot, CharSlot], idx: number) {
    team[idx] = {
        character: null,
        weapon: null,
        triggerSets: [],
        echoes: [emptyEchoSlot(), emptyEchoSlot(), emptyEchoSlot(), emptyEchoSlot(), emptyEchoSlot()]
    }
}

async function weaponMatchesChar(weaponName: string, char: Character): Promise<boolean> {
    const weapons = await getWeaponList()
    const wp = weapons.find((w) => w.name === weaponName)
    return !!wp && wp.weaponType === char.weaponType
}

defineTool('get_team_catalog', {
    description:
        '获取可用的队伍配置数据：角色（元素/武器类型）、武器（类型/星级）、声骸（cost/所属套装）、套装（支持件数）。设置队伍前先调用以获取准确名称。',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        const [characters, weapons, echoes, echoSets] = await Promise.all([
            getCharacterList(),
            getWeaponList(),
            getEchoList(),
            getEchoSetList()
        ])
        return {
            characters: characters.map((c) => ({ name: c.name, element: c.element, weaponType: c.weaponType })),
            weapons: weapons.map((w) => ({ name: w.name, weaponType: w.weaponType, star: w.star })),
            echoes: echoes.map((e) => ({ name: e.name, cost: e.cost, sets: e.sets })),
            echoSets: echoSets.map((s) => ({ name: s.name, pieces: s.pieces }))
        }
    }
})

defineTool('set_team_character', {
    description:
        '设置指定槽位（1-3）的角色，或传空字符串清空该槽位（同时清空武器、首位声骸与触发套装）。角色名用 get_team_catalog 查询，不能与其它槽位重复；已有武器类型不匹配时自动清空武器。',
    parameters: {
        type: 'object',
        properties: {
            slot: { type: 'number', description: '槽位 1-3' },
            character: { type: 'string', description: '角色名，空字符串清空' }
        },
        required: ['slot']
    },
    handler: async (args) => {
        const slot = assertSlot(args.slot)
        editableProject()
        const name = str(args.character)
        const team = cloneTeam(getActiveProject()!.team)

        if (!name) {
            clearSlot(team, slot - 1)
            await updateTeam(team)
            return { slot, character: null }
        }

        const characters = await getCharacterList()
        const char = characters.find((c) => c.name === name)
        if (!char) throw new Error(`未找到角色「${name}」`)
        if (team.some((s, i) => i !== slot - 1 && s.character === name)) {
            throw new Error(`角色「${name}」已在其它槽位`)
        }

        const current = team[slot - 1]
        const keepWeapon = current.weapon && (await weaponMatchesChar(current.weapon, char)) ? current.weapon : null
        team[slot - 1] = { ...current, character: name, weapon: keepWeapon }
        await updateTeam(team)
        return { slot, character: name, weapon: keepWeapon }
    }
})

defineTool('set_team_weapon', {
    description:
        '设置指定槽位（1-3）的武器，或传空字符串清空。武器名用 get_team_catalog 查询，武器类型须与该槽位角色匹配。',
    parameters: {
        type: 'object',
        properties: {
            slot: { type: 'number', description: '槽位 1-3' },
            weapon: { type: 'string', description: '武器名，空字符串清空' }
        },
        required: ['slot']
    },
    handler: async (args) => {
        const slot = assertSlot(args.slot)
        editableProject()
        const name = str(args.weapon)
        const team = cloneTeam(getActiveProject()!.team)

        const charName = team[slot - 1].character
        if (!charName) throw new Error(`槽位 ${slot} 尚未设置角色`)

        if (!name) {
            team[slot - 1].weapon = null
            await updateTeam(team)
            return { slot, weapon: null }
        }

        const weapons = await getWeaponList()
        const wp = weapons.find((w) => w.name === name)
        if (!wp) throw new Error(`未找到武器「${name}」`)

        const characters = await getCharacterList()
        const char = characters.find((c) => c.name === charName)
        if (!char) throw new Error(`未找到角色「${charName}」`)
        if (wp.weaponType !== char.weaponType) throw new Error(`武器「${name}」类型与角色「${charName}」不匹配`)

        team[slot - 1].weapon = name
        await updateTeam(team)
        return { slot, weapon: name }
    }
})

defineTool('set_team_first_echo', {
    description:
        '设置指定槽位（1-3）的首位声骸，或传空字符串清空（同时清空触发套装）。声骸名用 get_team_catalog 查询；若触发套装已满 5 件且声骸不属于任何已选套装（赫卡忒除外），会清空触发套装。',
    parameters: {
        type: 'object',
        properties: {
            slot: { type: 'number', description: '槽位 1-3' },
            echo: { type: 'string', description: '声骸名，空字符串清空' }
        },
        required: ['slot']
    },
    handler: async (args) => {
        const slot = assertSlot(args.slot)
        editableProject()
        const name = str(args.echo)
        const team = cloneTeam(getActiveProject()!.team)
        const slotData = team[slot - 1]
        if (!slotData.character) throw new Error(`槽位 ${slot} 尚未设置角色`)

        if (!name) {
            slotData.echoes[0] = emptyEchoSlot()
            slotData.triggerSets = []
            await updateTeam(team)
            return { slot, echo: null }
        }

        const echoes = await getEchoList()
        const echo = echoes.find((e) => e.name === name)
        if (!echo) throw new Error(`未找到声骸「${name}」`)

        slotData.echoes[0] = { name: echo.name, cost: echo.cost }
        if (effectiveTotal(slotData.triggerSets) === 5 && echo.name !== HECATE_ECHO) {
            const setNames = new Set(slotData.triggerSets.map((s) => s.name))
            if (!echo.sets.some((sn) => setNames.has(sn))) {
                slotData.triggerSets = []
            }
        }
        await updateTeam(team)
        return { slot, echo: echo.name, cost: echo.cost }
    }
})

defineTool('set_team_trigger_sets', {
    description:
        '设置指定槽位（1-3）的触发套装（整体覆盖）。sets 为 [{name, pieces}]，套装名与支持件数用 get_team_catalog 查询，总有效件数 ≤5；满 5 件且首位声骸不属于任何已选套装（赫卡忒除外）时清空首位声骸。',
    parameters: {
        type: 'object',
        properties: {
            slot: { type: 'number', description: '槽位 1-3' },
            sets: {
                type: 'array',
                items: { type: 'object', properties: { name: { type: 'string' }, pieces: { type: 'number' } } }
            }
        },
        required: ['slot', 'sets']
    },
    handler: async (args) => {
        const slot = assertSlot(args.slot)
        editableProject()
        const raw = Array.isArray(args.sets) ? args.sets : []
        const sets: SelectedSet[] = raw.map((item) => {
            const o = (item ?? {}) as Record<string, unknown>
            const name = str(o.name)
            if (!name) throw new Error('存在未命名的套装')
            return { name, pieces: Number(o.pieces) }
        })

        const echoSets = await getEchoSetList()
        const setMap = new Map(echoSets.map((s) => [s.name, s]))
        for (const s of sets) {
            const def = setMap.get(s.name)
            if (!def) throw new Error(`未找到套装「${s.name}」`)
            if (!def.pieces.includes(s.pieces)) throw new Error(`套装「${s.name}」不支持 ${s.pieces} 件套`)
        }
        if (effectiveTotal(sets) > 5) throw new Error('套装总有效件数不能超过 5')

        const team = cloneTeam(getActiveProject()!.team)
        const slotData = team[slot - 1]
        if (!slotData.character) throw new Error(`槽位 ${slot} 尚未设置角色`)

        slotData.triggerSets = sets
        if (effectiveTotal(sets) === 5 && slotData.echoes[0].name && slotData.echoes[0].name !== HECATE_ECHO) {
            const echoes = await getEchoList()
            const echo = echoes.find((e) => e.name === slotData.echoes[0]!.name)
            const setNames = new Set(sets.map((s) => s.name))
            if (!echo || !echo.sets.some((sn) => setNames.has(sn))) {
                slotData.echoes[0] = emptyEchoSlot()
            }
        }
        await updateTeam(team)
        return { slot, sets }
    }
})
