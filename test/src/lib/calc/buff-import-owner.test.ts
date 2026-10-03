// 导入 Buff 集的归属分批回归：
// 「同一套装 / 武器 / 首位声骸被多名角色装备时，buff 只导入给了一个角色」。
//
// 根因：`buildEntityImportItems` 会为**每个主人**各生成一条 self 条目（同名、同内容、只有归属槽位不同），
// 而 `detectImportConflicts` 的批次内去重只按**名字**去重 → 除第一个主人外的条目全被丢弃。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buildEntityImportItems, detectImportConflicts } from '$lib/calc/buff-import-utils'
import { getAllBuffSets, importBuffSetsWithDecisions, mapImportedScope } from '$lib/calc/calculation.store.svelte'
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

    it('detectImportConflicts 不能把「同名不同主人」当成批次内重复丢掉', () => {
        const items = buildEntityImportItems(entityWith('echo', '声骸X', '首位声骸效果A', 'self'), TEAM)
        const { deduped } = detectImportConflicts(items, [])
        assert.equal(deduped.length, 2, '同名但归属不同 → 两条都要留下（这就是曾经的 bug）')
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
        const { deduped } = detectImportConflicts(dup, [])
        assert.equal(deduped.length, 1, '同名同主人确实是重复项')
    })

    it('非 self 作用域（如全队）仍然只导入一条，归属取第一主人', () => {
        const items = buildEntityImportItems(entityWith('2set', '套装S', '套装全队效果', 'team'), TEAM)
        assert.equal(items.length, 1, '全队效果一条足够，避免重复叠加')
        assert.equal(items[0].ownerIdx, 0)
    })

    it('端到端：两条条目落库后分别作用到 0 号位与 1 号位', () => {
        const items = buildEntityImportItems(entityWith('echo', '声骸X', '首位声骸效果E2E', 'self'), TEAM)
        const { deduped } = detectImportConflicts(items, [])
        const report = importBuffSetsWithDecisions(deduped, {}, -1, TEAM.length)

        assert.equal(report.added, 2, '两个主人都应写入')
        const written = getAllBuffSets().filter((s) => s.name === '首位声骸效果E2E')
        assert.equal(written.length, 2, '库中应有两条同名但归属不同的 buff')
        assert.deepEqual(
            written.map((s) => s.scope),
            [[0], [1]],
            'scope 应分别指向 0/1 号位'
        )
        assert.deepEqual(
            written.map((s) => s.condition?.chains?.[0]?.charIdx),
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
    it('mapImportedScope：effect_only（效应专属）必须落成空数组，不能变全队', () => {
        assert.deepEqual(mapImportedScope('effect_only', -1, 3), [], '无归属时同样是效应专属')
        assert.deepEqual(mapImportedScope('effect_only', 0, 3), [], '归属槽位不影响效应专属')
        assert.deepEqual(mapImportedScope('team', 0, 3), 'all', 'team 才是全队')
    })

    it('端到端：效应专属条目落库后 scope 为空数组（不再变成全队）', () => {
        const entity = entityWith('echo', '声骸X', '效应专属加深E2E', 'effect_only')
        const items = buildEntityImportItems(entity, TEAM)
        const { deduped } = detectImportConflicts(items, [])
        importBuffSetsWithDecisions(deduped, {}, -1, TEAM.length)

        const written = getAllBuffSets().filter((s) => s.name === '效应专属加深E2E')
        assert.equal(written.length, 1)
        assert.deepEqual(written[0].scope, [], '导入后必须仍是「效应专属」（scope 空数组）')
        assert.equal(classifyBuffScope(written[0].scope).kind, 'effect', '徽标也应显示「效应专属」')
    })
})
