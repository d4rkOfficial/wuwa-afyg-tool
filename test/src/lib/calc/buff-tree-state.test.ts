// 显式 Buff 树：粗分类、迁移数字压平、导入追加、图标派生。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { BuffInstance, BuffTreeState } from '$lib/calc/calculation.types'
import type { CharSlot } from '$lib/types/project'
import {
    appendBuffToTree,
    coarsePathOf,
    deriveFolderIcon,
    emptyBuffTree,
    findBuffPlacement,
    importedBuffName,
    migrateLegacyBuffTree,
    normalizeBuffTree,
    pathNamesOf
} from '$lib/calc/buff-tree-state'

const TEAM = [
    { character: '甲', weapon: '武器甲' },
    { character: '乙', weapon: '武器乙' },
    { character: '丙', weapon: null }
] as unknown as CharSlot[]

const buff = (id: string, patch: Partial<BuffInstance> = {}): BuffInstance => ({
    id,
    name: id,
    zones: [],
    scope: 'all',
    ...patch
})

const chain = (charIdx: number, min: number): BuffInstance['condition'] => ({ chains: [{ charIdx, min }] })
const refine = (charIdx: number, min: number): BuffInstance['condition'] => ({ refinements: [{ charIdx, min }] })

describe('粗分类落点', () => {
    it('本体 / 单链 / 单阶武器 / 其它', () => {
        assert.deepEqual(coarsePathOf(buff('a', { condition: chain(1, 0) }), TEAM), {
            tab: 'nonGlobal',
            folder: '乙本体'
        })
        assert.deepEqual(coarsePathOf(buff('b', { condition: chain(1, 2) }), TEAM), {
            tab: 'nonGlobal',
            folder: '乙2链'
        })
        assert.deepEqual(coarsePathOf(buff('c', { condition: refine(0, 1) }), TEAM), {
            tab: 'nonGlobal',
            folder: '甲的武器甲'
        })
        assert.deepEqual(
            coarsePathOf(
                buff('d', {
                    condition: {
                        chains: [
                            { charIdx: 0, min: 1 },
                            { charIdx: 1, min: 2 }
                        ]
                    }
                }),
                TEAM
            ),
            {
                tab: 'nonGlobal',
                folder: null
            }
        )
        assert.deepEqual(coarsePathOf(buff('e', { scope: [], global: true }), TEAM), {
            tab: 'global',
            folder: null
        })
    })
})

describe('迁移：数字前后缀建二级文件夹并改短名', () => {
    it('同前缀数字成员收进数字文件夹、升序、改短名', () => {
        const buffs = [
            buff('a1', { name: '火光1层', condition: chain(0, 0) }),
            buff('b', { name: '普通Buff', condition: chain(0, 0) }),
            buff('a10', { name: '火光10层', condition: chain(0, 0) }),
            buff('a2', { name: '火光2层', condition: chain(0, 0) })
        ]
        const migrated = migrateLegacyBuffTree(buffs, TEAM)
        assert.equal(migrated.tree.nonGlobal.length, 1)
        const bodyFolder = migrated.tree.nonGlobal[0]
        assert.equal(bodyFolder.kind, 'folder')
        if (bodyFolder.kind !== 'folder') return
        assert.equal(bodyFolder.name, '甲本体')
        const numericFolder = bodyFolder.children.find((node) => node.kind === 'folder')
        assert.ok(numericFolder && numericFolder.kind === 'folder')
        if (numericFolder.kind !== 'folder') return
        assert.equal(numericFolder.name, '火光')
        assert.deepEqual(
            numericFolder.children.map((node) => (node.kind === 'buff' ? node.buffId : '')),
            ['a1', 'a2', 'a10']
        )
        assert.deepEqual(
            migrated.buffs.map((item) => item.name),
            ['甲本体\\火光\\1层', '甲本体\\普通Buff', '甲本体\\火光\\10层', '甲本体\\火光\\2层']
        )
    })

    it('单条数字命名不建文件夹、不改名', () => {
        const buffs = [buff('x', { name: '火光1层' }), buff('y', { name: '普通' })]
        const migrated = migrateLegacyBuffTree(buffs, TEAM)
        assert.deepEqual(
            migrated.buffs.map((b) => b.name),
            ['火光1层', '普通']
        )
        assert.equal(
            migrated.tree.nonGlobal.every((node) => node.kind === 'buff'),
            true
        )
    })

    it('前缀相同但后缀不同不合并；全名带条件路径', () => {
        const buffs = [
            buff('a', { name: '锁3链 共鸣解放时 增伤', condition: chain(0, 0) }),
            buff('b', { name: '锁3链 同奏增益', condition: chain(0, 0) }),
            buff('c', { name: '火光1层', condition: chain(0, 0) }),
            buff('d', { name: '火光2层', condition: chain(0, 0) })
        ]
        const migrated = migrateLegacyBuffTree(buffs, TEAM)
        assert.deepEqual(
            migrated.buffs.map((b) => b.name),
            ['甲本体\\锁3链 共鸣解放时 增伤', '甲本体\\锁3链 同奏增益', '甲本体\\火光\\1层', '甲本体\\火光\\2层']
        )
        const body = migrated.tree.nonGlobal[0]
        if (body.kind !== 'folder') return
        assert.equal(body.name, '甲本体')
        const folder = body.children.find((node) => node.kind === 'folder')
        assert.ok(folder && folder.kind === 'folder')
        if (folder.kind !== 'folder') return
        assert.equal(folder.name, '火光')
    })

    it('同前缀不同后缀两组都 ≥2 时用 （后缀） 区分文件夹', () => {
        const buffs = [
            buff('a', { name: '火光1层', condition: chain(0, 0) }),
            buff('b', { name: '火光2层', condition: chain(0, 0) }),
            buff('c', { name: '火光1阶', condition: chain(0, 0) }),
            buff('d', { name: '火光2阶', condition: chain(0, 0) })
        ]
        const migrated = migrateLegacyBuffTree(buffs, TEAM)
        const body = migrated.tree.nonGlobal[0]
        if (body.kind !== 'folder') return
        const names = body.children.filter((node) => node.kind === 'folder').map((node) => node.name)
        assert.equal(names.length, 2)
        assert.ok(names.includes('火光'))
        assert.ok(names.some((name) => name.startsWith('火光（')))
    })
})

describe('树归一化', () => {
    it('按全名归位、去超深文件夹、补缺失 Buff', () => {
        const buffs = [
            buff('a', { name: '根A' }),
            buff('g', { name: '全局\\超深\\g', global: true }),
            buff('new', { name: '新Buff' })
        ]
        const tree: BuffTreeState = {
            global: [
                {
                    kind: 'folder',
                    id: 'f1',
                    name: '全局',
                    children: [
                        {
                            kind: 'folder',
                            id: 'f2',
                            name: '超深',
                            children: [{ kind: 'folder', id: 'f3', name: '更深', children: [] }]
                        }
                    ]
                }
            ],
            nonGlobal: [
                { kind: 'buff', id: 'g', buffId: 'g' },
                { kind: 'buff', id: 'a', buffId: 'a' }
            ]
        }
        const next = normalizeBuffTree(tree, buffs, ['g'])
        assert.deepEqual(
            next.nonGlobal.map((n) => (n.kind === 'buff' ? n.buffId : n.name)),
            ['a', 'new']
        )
        assert.deepEqual(next.global[0].kind, 'folder')
        const folder = next.global[0]
        if (folder.kind === 'folder') {
            assert.equal(folder.children.length, 1, '超过两级的文件夹被压掉')
            const sub = folder.children[0]
            assert.equal(sub.kind, 'folder')
            if (sub.kind === 'folder') {
                assert.equal(sub.name, '超深')
                assert.deepEqual(
                    sub.children.map((n) => (n.kind === 'buff' ? n.buffId : '')),
                    ['g']
                )
            }
        }
    })
})

describe('导入追加与撞名 #', () => {
    it('本体/单链建一级文件夹，同路径追加，撞名 Buff 加 #', () => {
        const buffs = new Map<string, BuffInstance>()
        let tree = emptyBuffTree()
        const b1 = buff('a', { name: '甲本体\\暴击', condition: chain(0, 0) })
        buffs.set(b1.id, b1)
        tree = appendBuffToTree(tree, b1, TEAM, buffs)

        const b2 = buff('b', { name: '暴击', condition: chain(0, 0) })
        buffs.set(b2.id, b2)
        const name = importedBuffName('暴击', tree.nonGlobal, '甲本体', buffs)
        assert.equal(name, '甲本体\\暴击#')
        b2.name = name
        tree = appendBuffToTree(tree, b2, TEAM, buffs)

        assert.equal(tree.nonGlobal.length, 1)
        const folder = tree.nonGlobal[0]
        assert.equal(folder.kind, 'folder')
        if (folder.kind === 'folder') {
            assert.equal(folder.name, '甲本体')
            assert.equal(folder.children.length, 2)
        }
    })

    it('无文件夹 Buff 进根，路径名可由 pathNamesOf 还原', () => {
        const buffs = new Map<string, BuffInstance>()
        const b = buff('x', { name: '通用', scope: [] })
        buffs.set(b.id, b)
        const tree = appendBuffToTree(emptyBuffTree(), b, TEAM, buffs)
        assert.equal(tree.nonGlobal[0].kind, 'buff')
        assert.deepEqual(pathNamesOf(tree, 'x', buffs), ['通用'])
    })
})

describe('复制落点', () => {
    it('返回所在容器与下标；非全局优先，全局兜底', () => {
        const tree: BuffTreeState = {
            global: [{ kind: 'buff', id: 'g', buffId: 'g' }],
            nonGlobal: [
                { kind: 'buff', id: 'root', buffId: 'root' },
                {
                    kind: 'folder',
                    id: 'f',
                    name: 'F',
                    children: [
                        { kind: 'buff', id: 'a', buffId: 'a' },
                        { kind: 'buff', id: 'b', buffId: 'b' }
                    ]
                }
            ]
        }
        assert.deepEqual(findBuffPlacement(tree, 'a'), { tab: 'nonGlobal', folderId: 'f', index: 0 })
        assert.deepEqual(findBuffPlacement(tree, 'b'), { tab: 'nonGlobal', folderId: 'f', index: 1 })
        assert.deepEqual(findBuffPlacement(tree, 'root'), { tab: 'nonGlobal', folderId: null, index: 0 })
        assert.deepEqual(findBuffPlacement(tree, 'g'), { tab: 'global', folderId: null, index: 0 })
        assert.equal(findBuffPlacement(tree, 'missing'), null)
    })
})

describe('文件夹图标', () => {
    const treeWith = (children: BuffInstance[]): { tree: BuffTreeState; map: Map<string, BuffInstance> } => {
        const named = children.map((buff) => ({ ...buff, name: `文件夹\\${buff.name}` }))
        const map = new Map(named.map((b) => [b.id, b]))
        const tree = normalizeBuffTree(
            {
                global: [],
                nonGlobal: [
                    {
                        kind: 'folder',
                        id: 'f',
                        name: '文件夹',
                        children: named.map((b) => ({ kind: 'buff', id: b.id, buffId: b.id }))
                    }
                ]
            },
            named,
            []
        )
        return { tree, map }
    }
    const iconOf = (children: BuffInstance[]) => {
        const { tree, map } = treeWith(children)
        const folder = tree.nonGlobal[0]
        if (folder.kind !== 'folder') throw new Error('not folder')
        return deriveFolderIcon(folder, map, TEAM)
    }

    it('同角色纯链：头像 + 范围（本体 0 不出现在角标）', () => {
        const icon = iconOf([
            buff('a', { condition: chain(1, 0) }),
            buff('b', { condition: chain(1, 1) }),
            buff('c', { condition: chain(1, 2) }),
            buff('d', { condition: chain(1, 4) })
        ])
        assert.equal(icon.kind, 'character')
        assert.equal(icon.charIdx, 1)
        assert.deepEqual(icon.chainRanges, [
            { from: 1, to: 2 },
            { from: 4, to: 4 }
        ])
    })

    it('同角色纯阶：武器图标 + 阶范围', () => {
        const icon = iconOf([buff('a', { condition: refine(0, 1) }), buff('b', { condition: refine(0, 2) })])
        assert.equal(icon.kind, 'weapon')
        assert.equal(icon.weapon, '武器甲')
        assert.deepEqual(icon.refineRanges, [{ from: 1, to: 2 }])
    })

    it('跨角色 / 链阶混合 → generic；空 → empty；纯效应 → effect', () => {
        assert.equal(
            iconOf([buff('a', { condition: chain(0, 1) }), buff('b', { condition: chain(1, 1) })]).kind,
            'generic'
        )
        assert.equal(
            iconOf([buff('a', { condition: chain(0, 1) }), buff('b', { condition: refine(0, 1) })]).kind,
            'generic'
        )
        assert.equal(iconOf([]).kind, 'empty')
        assert.equal(iconOf([buff('a', { scope: [] })]).kind, 'effect')
    })
})
