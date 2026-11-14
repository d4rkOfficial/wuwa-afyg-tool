// 「工坊 → 工具箱」端到端契约测试。
//
// 夹具 `__fixtures__/share-buff-sets.json` 不是手写的：它由**工坊自己的清洗函数**
// （`wuwa-afyg-share/src/lib/consts/buff-zones.ts` 的 `sanitizeCondition` / `sanitizeZoneCondition`）
// 跑一遍后落盘，形状就是 `GET /api/buff-sets` 的响应体。于是本测试覆盖的是：
//   工坊写库 → API 响应 → 工具箱 `fetchBuffSetsFromShare` → 本地库 → 导入工程
// 这条真实链路，而不是各自仓库内部的形状假设。
//
// 关注点：
// - `condition.rules`（5 种 kind 白名单、buffActive/越界属性/超长正则被工坊丢弃）能过到工程；
// - `condition.chains/refinements` 与 `rules` **并存**时两者都保留（工坊把两套字段放同一个 condition）；
// - 归属轴：`zoneCompare.charIdx 0` → 实体归属槽位、`-1` → 出伤者；
// - 引用归属：`refOwner: 'active'` → `characterIdx = -1`，`'owner'` → 实体归属槽位。
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { fetchBuffSetsFromShare, getBuffEntities } from '$lib/data/buff-library.svelte'
import { buildEntityImportItems } from '$lib/calc/buff-import-utils'
import { getAllBuffConfs, importBuffSetsWithDecisions } from '$lib/calc/calculation.store.svelte'
import type { CharSlot } from '$lib/types/project'

const PAYLOAD = readFileSync('test/src/lib/data/__fixtures__/share-buff-sets.json', 'utf8')

/** 契约角色在 1 号位：这样「本角色」= 1、「出伤者」= -1 才能区分开 */
const TEAM = [
    { character: '甲', weapon: null, echoes: [] },
    { character: '契约角色', weapon: null, echoes: [] },
    { character: '丙', weapon: null, echoes: [] }
] as unknown as [CharSlot, CharSlot, CharSlot]

const originalFetch = globalThis.fetch

/** @desc 用夹具替掉真实网络：`fetchBuffSetsFromShare` 只读 `/api/buff-sets` */
const stubShare = () => {
    globalThis.fetch = (async () =>
        new Response(PAYLOAD, {
            status: 200,
            headers: { 'content-type': 'application/json' }
        })) as unknown as typeof fetch
}

after(() => {
    globalThis.fetch = originalFetch
})

describe('端到端：工坊 buff_sets → 工具箱库', () => {
    it('同步一次后本地库拿到该实体，且条件已折算成 rules', async () => {
        stubShare()
        const result = await fetchBuffSetsFromShare()
        assert.equal(result.ok, true, '同步应成功')

        const entity = getBuffEntities().find((e) => e.entityName === '契约角色')
        assert.ok(entity, '应写入契约角色实体')
        assert.equal(entity?.source, 'share')
        assert.deepEqual(
            entity?.folders.map((f) => f.name),
            ['契约文件夹'],
            '工坊的一级文件夹结构要保留'
        )

        const buff = entity?.buffs[0]
        assert.equal(buff?.buffName, '契约文件夹\\联调效果', '全名保留工坊路径')
        assert.deepEqual(
            buff?.rules,
            [
                { kind: 'damageNameRegex', pattern: '共鸣解放|处决' },
                { kind: 'zoneCompare', charIdx: -1, zone: 'critRate', op: 'ge', value: 60 },
                { kind: 'enemyType', types: ['BOSS', '精英怪'] },
                // chains / refinements 与 rules 并存 → 两者都折算进来
                { kind: 'chain', charIdx: 0, min: 3 },
                { kind: 'refinement', charIdx: 0, min: 2 }
            ],
            '工坊丢掉的四条（buffActive / 同奏层数面板 / 同类第二条 enemyType / 超长正则）不该出现'
        )
    })

    it('引用归属原样带到库里（active / owner）', async () => {
        stubShare()
        await fetchBuffSetsFromShare()
        const zones = getBuffEntities().find((e) => e.entityName === '契约角色')?.buffs[0]?.zones ?? []
        const activeRef = zones.find((z) => z.zoneId === 'extraRatio')?.ref
        const ownerRef = zones.find((z) => z.zoneId === 'critRate')?.ref
        assert.equal(activeRef?.refOwner, 'active', '出伤者档不能被洗成 owner')
        assert.equal(ownerRef?.refOwner, 'owner')
    })
})

describe('端到端：本地库 → 工程 Buff 配置', () => {
    it('导入后规则按归属重指，出伤者档保持 -1', async () => {
        stubShare()
        await fetchBuffSetsFromShare()
        const entity = getBuffEntities().find((e) => e.entityName === '契约角色')
        assert.ok(entity)

        const items = buildEntityImportItems(entity, TEAM)
        assert.equal(items.length, 1)
        assert.equal(
            items[0].targetName,
            '契约文件夹\\联调效果',
            '链阶混合的 Buff 不落条件文件夹（coarsePathOf 只认纯链/纯阶），只保留工坊来源文件夹'
        )

        importBuffSetsWithDecisions(items, {}, -1, TEAM.length)
        const written = getAllBuffConfs().find((s) => s.name.endsWith('联调效果'))
        assert.ok(written, '应写入工程')

        assert.deepEqual(
            written?.rules,
            [
                { kind: 'damageNameRegex', pattern: '共鸣解放|处决' },
                { kind: 'zoneCompare', charIdx: -1, zone: 'critRate', op: 'ge', value: 60 },
                { kind: 'enemyType', types: ['BOSS', '精英怪'] },
                { kind: 'chain', charIdx: 1, min: 3 },
                { kind: 'refinement', charIdx: 1, min: 2 }
            ],
            '「本角色」档重指到 1 号位，出伤者档保持 -1'
        )

        const zones = written?.zones ?? []
        assert.equal(zones.find((z) => z.zoneId === 'extraRatio')?.ref?.characterIdx, -1, '出伤者引用 = 本条目所属角色')
        assert.equal(zones.find((z) => z.zoneId === 'critRate')?.ref?.characterIdx, 1, '本角色引用 = 实体归属槽位')
        assert.deepEqual(
            zones.find((z) => z.zoneId === 'bonusDmg')?.condition,
            { damageTypes: ['共鸣解放伤害'] },
            '乘区级条件随条目一起过到工程'
        )
        assert.equal(written?.scope, 'all', '工坊 scope=team 映射为「通用」')
    })
})
