// Buff 文件夹命名迁移：旧「角色名本体 / 角色名2链 / 角色名的武器」→ 新「角色名-本体 / 角色名-2链 / 角色名-武器名」，
// 并把旧导入混在角色本体里的声骸 / 套装 / 武器 Buff 归到 `角色名-实体名[-x件]`。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { migrateProject } from '$src/migration'
import type { BuffInstance, BuffTreeNode, BuffTreeState } from '$lib/calc/calculation.types'
import type { CharSlot } from '$lib/types/project'

const echoSlot = (name: string | null) => ({ name, cost: name ? 4 : 0 })

const TEAM = [
    {
        character: '甲',
        weapon: '武器A',
        triggerSets: [{ name: '套装S', pieces: 2 }],
        echoes: [echoSlot('声骸X'), echoSlot(null), echoSlot(null), echoSlot(null), echoSlot(null)]
    },
    {
        character: '乙',
        weapon: '武器B',
        triggerSets: [],
        echoes: [echoSlot(null), echoSlot(null), echoSlot(null), echoSlot(null), echoSlot(null)]
    },
    { character: null, weapon: null, triggerSets: [], echoes: [] }
] as unknown as [CharSlot, CharSlot, CharSlot]

const buff = (id: string, name: string, condition: BuffInstance['condition']): BuffInstance => ({
    id,
    name,
    zones: [{ zoneId: 'atkPct', value: 10 }],
    scope: 'all',
    ...(condition ? { condition } : {})
})

const tree: BuffTreeState = {
    global: [],
    nonGlobal: [
        {
            kind: 'folder',
            id: 'f-body',
            name: '甲本体',
            children: [
                {
                    kind: 'folder',
                    id: 'f-echo',
                    name: '声骸X',
                    children: [{ kind: 'buff', id: 'b-echo', buffId: 'b-echo' }]
                },
                {
                    kind: 'folder',
                    id: 'f-set',
                    name: '套装S',
                    children: [{ kind: 'buff', id: 'b-set', buffId: 'b-set' }]
                },
                {
                    kind: 'folder',
                    id: 'f-unknown',
                    name: '未知来源',
                    children: [{ kind: 'buff', id: 'b-unknown', buffId: 'b-unknown' }]
                },
                { kind: 'buff', id: 'b-body', buffId: 'b-body' }
            ]
        },
        {
            kind: 'folder',
            id: 'f-chain',
            name: '甲2链',
            children: [{ kind: 'buff', id: 'b-chain', buffId: 'b-chain' }]
        },
        {
            kind: 'folder',
            id: 'f-weapon',
            name: '甲的武器A',
            children: [{ kind: 'buff', id: 'b-weapon', buffId: 'b-weapon' }]
        }
    ]
}

const projectOf = (buffs: BuffInstance[], buffTree: BuffTreeState = tree): Record<string, unknown> => ({
    version: 5,
    id: 'p-buff-folders',
    name: 'Buff 文件夹迁移',
    createdAt: 1,
    team: TEAM,
    customSkillHits: {},
    encounter: {
        teamLocked: false,
        timeline: { locked: false, data: null },
        calculation: {
            locked: false,
            data: {
                buffSets: buffs,
                damageEntryBuffSetIds: {},
                damageEntryDamageTypes: {},
                buffTree,
                buffTreeVersion: 2
            }
        },
        config: { locked: false, data: null }
    }
})

const BUFFS = [
    buff('b-body', '甲本体\\本体效果', { chains: [{ charIdx: 0, min: 0 }] }),
    buff('b-chain', '甲2链\\链效果', { chains: [{ charIdx: 0, min: 2 }] }),
    buff('b-weapon', '甲的武器A\\武器效果', { refinements: [{ charIdx: 0, min: 1 }] }),
    buff('b-echo', '甲本体\\声骸X\\声骸效果', { chains: [{ charIdx: 0, min: 0 }] }),
    buff('b-set', '甲本体\\套装S\\套装效果', { chains: [{ charIdx: 0, min: 0 }] }),
    buff('b-unknown', '甲本体\\未知来源\\普通效果', { chains: [{ charIdx: 0, min: 0 }] })
]

const migrate = (buffs: BuffInstance[] = BUFFS) => {
    const project = migrateProject(projectOf(buffs))
    const calc = project.encounter.calculation.data
    assert.ok(calc, '迁移后的工程必须有拉表数据')
    return calc
}

const folderNames = (nodes: readonly BuffTreeNode[], depth = 0): string[] => {
    const out: string[] = []
    for (const node of nodes) {
        if (node.kind !== 'folder') continue
        out.push(`${'  '.repeat(depth)}${node.name}`)
        out.push(...folderNames(node.children, depth + 1))
    }
    return out
}

describe('Buff 文件夹命名迁移', () => {
    it('本体 / 链 / 武器文件夹改成短横线命名', () => {
        const names = migrate().buffSets.map((b) => b.name)
        assert.ok(names.includes('甲-本体\\本体效果'))
        assert.ok(names.includes('甲-2链\\链效果'))
        assert.ok(names.includes('甲-武器A\\武器效果'))
    })

    it('旧导入的声骸 / 套装从角色本体移出，武器也按实体归类', () => {
        const names = migrate().buffSets.map((b) => b.name)
        assert.ok(names.includes('甲-声骸X\\声骸效果'), '首位声骸进 角色-声骸名')
        assert.ok(names.includes('甲-套装S-2件\\套装效果'), '套装进 角色-套装名-x件')
        assert.ok(!names.some((name) => name.startsWith('甲-本体\\声骸X')), '声骸来源文件夹不再留在本体下')
        assert.ok(!names.some((name) => name.startsWith('甲-本体\\套装S')), '套来源文件夹不再留在本体下')
        assert.ok(names.includes('甲-本体\\未知来源\\普通效果'), '认不出来源的 Buff 留在本体')
    })

    it('条件不变：声骸 / 套装仍是角色本体门，武器仍是原阶条件', () => {
        const calc = migrate()
        const byName = new Map(calc.buffSets.map((b) => [b.name, b]))
        assert.deepEqual(byName.get('甲-声骸X\\声骸效果')?.condition?.chains, [{ charIdx: 0, min: 0 }])
        assert.deepEqual(byName.get('甲-套装S-2件\\套装效果')?.condition?.chains, [{ charIdx: 0, min: 0 }])
        assert.deepEqual(byName.get('甲-武器A\\武器效果')?.condition?.refinements, [{ charIdx: 0, min: 1 }])
    })

    it('显式树同步改名并删掉被搬空的来源文件夹，新归属文件夹由树归一化补出', () => {
        const folders = folderNames(migrate().buffTree?.nonGlobal ?? [])
        assert.ok(folders.includes('甲-本体'))
        assert.ok(folders.includes('甲-2链'))
        assert.ok(folders.includes('甲-武器A'))
        assert.ok(folders.includes('甲-声骸X'))
        assert.ok(folders.includes('甲-套装S-2件'))
        assert.ok(folders.includes('  未知来源'), '留在本体的来源文件夹要保留')
        assert.ok(!folders.includes('  声骸X'))
        assert.ok(!folders.includes('  套装S'))
    })

    it('幂等：迁移后的工程再跑一遍不变', () => {
        const once = migrate()
        const twice = migrateProject(projectOf(once.buffSets, once.buffTree ?? tree)).encounter.calculation.data
        assert.deepEqual(
            twice?.buffSets.map((b) => b.name),
            once.buffSets.map((b) => b.name)
        )
        assert.deepEqual(twice?.buffTree, once.buffTree)
    })

    it('已是 v6 的工程不再重跑命名迁移（与版本绑定）', () => {
        const raw = projectOf(BUFFS)
        raw.version = 6
        const calc = migrateProject(raw).encounter.calculation.data
        assert.ok(calc)
        assert.ok(calc.buffSets.some((buff) => buff.name === '甲本体\\本体效果'))
        assert.ok(!calc.buffSets.some((buff) => buff.name.startsWith('甲-本体')))
    })
})
