// 导入 Buff 集的归属分批回归：
// 「同一套装 / 武器 / 首位声骸被多名角色装备时，buff 只导入给了一个角色」。
//
// 根因：`buildEntityImportItems` 会为**每个主人**各生成一条 self 条目（同名、同内容、只有归属槽位不同），
// 而 `dedupeImportItems` 的批次内去重只按**名字**去重 → 除第一个主人外的条目全被丢弃。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buildEntityImportItems, dedupeImportItems, toImportItem } from '$lib/calc/buff-import-utils'
import { resolveImportTarget } from '$lib/calc/buff-import-target'
import { getAllBuffConfs, importBuffSetsWithDecisions, mapImportedScope } from '$lib/calc/calculation.store.svelte'
import { classifyBuffScope } from '$lib/calc/calculation.consts'
import type { BuffLibraryEntity } from '$lib/data/buff-library.svelte'
import type { CharSlot } from '$lib/types/project'

const echoSlot = (name: string) => ({ name, cost: 4 })

/** 0/1 号位共用同一把武器、同一个首位声骸、同一套套装；2 号位完全不同 */
const TEAM = [
    {
        character: '甲',
        weapon: '武器A',
        triggerSets: [{ name: '套装S', pieces: 2 }],
        echoes: [
            echoSlot('声骸X'),
            echoSlot(null as never),
            echoSlot(null as never),
            echoSlot(null as never),
            echoSlot(null as never)
        ]
    },
    {
        character: '乙',
        weapon: '武器A',
        triggerSets: [{ name: '套装S', pieces: 2 }],
        echoes: [
            echoSlot('声骸X'),
            echoSlot(null as never),
            echoSlot(null as never),
            echoSlot(null as never),
            echoSlot(null as never)
        ]
    },
    { character: '丙', weapon: '武器B', triggerSets: [], echoes: [] }
] as unknown as [CharSlot, CharSlot, CharSlot]

const entityWith = (entityType: string, entityName: string, buffName: string, scope: string): BuffLibraryEntity =>
    ({
        entityType,
        entityName,
        source: 'share',
        buffs: [{ buffName, scope, zones: [{ zoneId: 'bonusDmg', value: 20 }] }]
    }) as unknown as BuffLibraryEntity

describe('共享实体的导入批次：每个主人都要拿到条目', () => {
    it('共享首位声骸：self 条目按主人拆成 2 条，归属分别为 0 / 1 号位', () => {
        const items = buildEntityImportItems(entityWith('echo', '声骸X', '首位声骸效果', 'self'), TEAM)
        assert.equal(items.length, 2, '两个主人应各有一条')
        assert.deepEqual(
            items.map((i) => i.ownerIdx),
            [0, 1],
            '归属槽位必须是真实主人，而不是只有第一个'
        )
    })

    it('共享武器 / 共享套装同样按主人拆分', () => {
        assert.equal(buildEntityImportItems(entityWith('weapon', '武器A', '武器效果', 'self'), TEAM).length, 2)
        assert.equal(buildEntityImportItems(entityWith('2set', '套装S', '套装效果', 'self'), TEAM).length, 2)
    })

    it('dedupeImportItems 不能把「同名不同主人」当成批次内重复丢掉', () => {
        const items = buildEntityImportItems(entityWith('echo', '声骸X', '首位声骸效果A', 'self'), TEAM)
        const deduped = dedupeImportItems(items)
        assert.equal(deduped.length, 2, '同名但归属不同 → 两条都要留下（去重键含归属）')
        assert.deepEqual(
            deduped.map((i) => i.ownerIdx),
            [0, 1]
        )
    })

    it('同一主人的重复条目仍然会被去重（去重键是 名字+归属）', () => {
        const dup = [
            { name: '重复效果', scope: 'self' as const, ownerIdx: 0, zones: [] },
            { name: '重复效果', scope: 'self' as const, ownerIdx: 0, zones: [] }
        ]
        const deduped = dedupeImportItems(dup)
        assert.equal(deduped.length, 1, '同名同主人确实是重复项')
    })

    it('非 self 作用域（如全队）仍然只导入一条，归属取第一主人', () => {
        const items = buildEntityImportItems(entityWith('2set', '套装S', '套装全队效果', 'team'), TEAM)
        assert.equal(items.length, 1, '全队效果一条足够，避免重复叠加')
        assert.equal(items[0].ownerIdx, 0)
    })

    it('端到端：两条条目落库后分别作用到 0 号位与 1 号位', () => {
        const items = buildEntityImportItems(entityWith('echo', '声骸X', '首位声骸效果E2E', 'self'), TEAM)
        const deduped = dedupeImportItems(items)
        const report = importBuffSetsWithDecisions(deduped, {}, -1, TEAM.length)

        assert.equal(report.added, 2, '两个主人都应写入')
        const written = getAllBuffConfs().filter((s) => s.name.endsWith('首位声骸效果E2E'))
        assert.equal(written.length, 2, '库中应有两条同名但归属不同的 buff')
        assert.deepEqual(
            written
                .map((s) => s.scope)
                .sort((a, b) => (Array.isArray(a) ? (a[0] ?? 0) : -1) - (Array.isArray(b) ? (b[0] ?? 0) : -1)),
            [[0], [1]],
            'scope 应分别指向 0/1 号位'
        )
        assert.deepEqual(
            written
                .map((s) => s.rules?.find((rule) => rule.kind === 'chain')?.charIdx)
                .sort((a, b) => (a ?? 0) - (b ?? 0)),
            [0, 1],
            '角色本体门也要落到各自的主人身上'
        )
    })

    it('mapImportedScope：self 跟随主人，self_except 排除主人', () => {
        assert.deepEqual(mapImportedScope('self', 1, 3), [1])
        assert.deepEqual(mapImportedScope('self_except', 1, 3), [0, 2])
    })

    // 回归：工坊 / 本地 Buff 库里的「效应专属」导入工程后变成「全队共享」。
    // 根因是 mapImportedScope 把 effect_only 和 team 一起落到了 'all' —— 不只是显示错，
    // 而是这条 buff 真的会对全部角色的条目生效。
    it('mapImportedScope：effect_only（效应专属）必须落成空数组，不能变通用', () => {
        assert.deepEqual(mapImportedScope('effect_only', -1, 3), [], '无归属时同样是效应专属')
        assert.deepEqual(mapImportedScope('effect_only', 0, 3), [], '归属槽位不影响效应专属')
        assert.equal(mapImportedScope('team', 0, 3), 'all', 'team = 通用（三名角色 + 效应）')
    })

    // 「全队」与「通用」不是一个东西：team_only 只对三名角色生效（[0,1,2]），效应条目不吃。
    it('mapImportedScope：team_only 是「全队」（[0,1,2]），与 team 的「通用」区分', () => {
        assert.deepEqual(mapImportedScope('team_only', 0, 3), [0, 1, 2])
        assert.deepEqual(mapImportedScope('team_only', -1, 3), [0, 1, 2], '与归属槽位无关')
        assert.notEqual(mapImportedScope('team_only', 0, 3), 'all')
    })

    it('端到端：效应专属条目落库后 scope 为空数组（保持仅效应）', () => {
        const entity = entityWith('echo', '声骸X', '效应专属加深E2E', 'effect_only')
        const items = buildEntityImportItems(entity, TEAM)
        const deduped = dedupeImportItems(items)
        importBuffSetsWithDecisions(deduped, {}, -1, TEAM.length)

        const written = getAllBuffConfs().filter((s) => s.name.endsWith('效应专属加深E2E'))
        assert.equal(written.length, 1)
        assert.deepEqual(written[0].scope, [], '导入后必须仍是「效应专属」（scope 空数组）')
        assert.equal(classifyBuffScope(written[0].scope).kind, 'effect', '徽标也应显示「效应专属」')
    })
})

describe('导入落点：条件文件夹在外，来源文件夹在内', () => {
    it('按真实主人重指条件；工坊文件夹作为二级保留', () => {
        const target = resolveImportTarget(
            '千古洑流 共技时 攻击1层\\1阶',
            { chains: [{ charIdx: 0, min: 0 }] },
            1,
            TEAM
        )
        assert.equal(target.conditionFolder, '乙-本体')
        assert.equal(target.sourceFolder, '千古洑流 共技时 攻击1层')
        assert.equal(target.fullName, '乙-本体\\千古洑流 共技时 攻击1层\\1阶')
    })

    it('无条件 self Buff 补本体门后落角色本体文件夹', () => {
        const target = resolveImportTarget('普通效果', undefined, 0, TEAM)
        assert.equal(target.conditionFolder, '甲-本体')
        assert.equal(target.fullName, '甲-本体\\普通效果')
    })

    it('工坊根 Buff 没有来源文件夹时只拼条件文件夹', () => {
        const target = resolveImportTarget('普通效果', { chains: [{ charIdx: 0, min: 2 }] }, 0, TEAM)
        assert.equal(target.sourceFolder, null)
        assert.equal(target.fullName, '甲-2链\\普通效果')
    })
})

describe('导入落点：实体来源决定归属文件夹', () => {
    it('首位声骸：进 角色-声骸名，条件仍是角色本体门', () => {
        const items = buildEntityImportItems(entityWith('echo', '声骸X', '首位声骸效果', 'self'), TEAM)
        const item = items[0]
        assert.equal(item.targetName, '甲-声骸X\\首位声骸效果')
        assert.deepEqual(item.rules, [{ kind: 'chain', charIdx: 0, min: 0 }], '规则仍是角色本体门，不是声骸条件')
    })

    it('套装：进 角色-套装名-x件', () => {
        const items = buildEntityImportItems(entityWith('2set', '套装S', '套装效果', 'self'), TEAM)
        assert.equal(items[0].targetName, '甲-套装S-2件\\套装效果')
    })

    it('武器：进 角色-武器名', () => {
        const items = buildEntityImportItems(entityWith('weapon', '武器A', '武器效果', 'self'), TEAM)
        assert.equal(items[0].targetName, '甲-武器A\\武器效果')
    })

    it('来源文件夹与实体同名时只保留一层；不同名则保留为二级', () => {
        const same = buildEntityImportItems(entityWith('echo', '声骸X', '声骸X\\子效果', 'self'), TEAM)
        assert.equal(same[0].targetName, '甲-声骸X\\子效果')
        const nested = buildEntityImportItems(entityWith('echo', '声骸X', '子文件夹\\效果', 'self'), TEAM)
        assert.equal(nested[0].targetName, '甲-声骸X\\子文件夹\\效果')
    })

    it('角色本体 / 链：沿用条件文件夹的新命名', () => {
        assert.equal(resolveImportTarget('普通', undefined, 0, TEAM).fullName, '甲-本体\\普通')
        assert.equal(
            resolveImportTarget('链效果', { chains: [{ charIdx: 0, min: 2 }] }, 0, TEAM).fullName,
            '甲-2链\\链效果'
        )
    })
})

// ── 归属轴：本角色（实体归属槽位）/ 出伤者（-1）──
describe('归属轴：出伤者档与归属槽位无关', () => {
    const cmp = (charIdx: number) => ({ kind: 'zoneCompare', charIdx, zone: 'critRate', op: 'ge', value: 60 }) as const
    const importRules = (charIdx: number, owner: number) =>
        (toImportItem({ name: '单档', rules: [cmp(charIdx)], zones: [] }, owner, TEAM).rules ?? []).filter(
            (rule) => rule.kind === 'zoneCompare'
        )

    it('本角色档重指到主人在配队里的槽位', () => {
        assert.deepEqual(importRules(0, 1), [cmp(1)], '「本角色」跟着主人走')
    })

    it('出伤者档保持 -1（与主人槽位无关）', () => {
        assert.deepEqual(importRules(-1, 1), [cmp(-1)])
    })

    it('实体不在配队里：本角色档丢弃，出伤者档照常保留', () => {
        assert.deepEqual(importRules(0, -1), [], '没有归属就不留「本角色」档')
        assert.deepEqual(importRules(-1, -1), [cmp(-1)], '出伤者与实体归属无关，不能跟着一起丢')
    })

    it('引用归属：refOwner=active 导入成 characterIdx=-1，本角色落实体归属槽位', () => {
        const entity = {
            entityType: '2set',
            entityName: '套装S',
            source: 'share',
            buffs: [
                {
                    buffName: '转模出伤者',
                    scope: 'team',
                    zones: [
                        {
                            zoneId: 'extraRatio',
                            value: 0,
                            ref: { targetZoneId: 'baseAtk', pct: 10, refOwner: 'active' }
                        }
                    ]
                }
            ]
        } as unknown as BuffLibraryEntity
        importBuffSetsWithDecisions(buildEntityImportItems(entity, TEAM), {}, -1, TEAM.length)
        const written = getAllBuffConfs().find((s) => s.name.endsWith('转模出伤者'))
        assert.equal(written?.zones[0]?.ref?.characterIdx, -1, '出伤者 = 本条目所属角色')
    })

    it('引用归属：refOwner=owner（本角色）导入成实体归属槽位', () => {
        const entity = {
            entityType: '2set',
            entityName: '套装S',
            source: 'share',
            buffs: [
                {
                    buffName: '转模本角色',
                    scope: 'team',
                    zones: [
                        {
                            zoneId: 'extraRatio',
                            value: 0,
                            ref: { targetZoneId: 'baseAtk', pct: 10, refOwner: 'owner' }
                        }
                    ]
                }
            ]
        } as unknown as BuffLibraryEntity
        importBuffSetsWithDecisions(buildEntityImportItems(entity, TEAM), {}, -1, TEAM.length)
        const written = getAllBuffConfs().find((s) => s.name.endsWith('转模本角色'))
        assert.equal(written?.zones[0]?.ref?.characterIdx, 0, '本角色 = 该套装在配队里的首个主人')
    })
})
