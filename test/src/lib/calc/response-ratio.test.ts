// 偏谐响应（震谐/骇破）倍率回归：进工程首帧建设伤害条目时，技能缓存（排轴页异步预热）往往还是空的，
// 倍率会算成 0 —— 而且条目只在 init 时建一次，不补一次重建就会整场会话停在 0。
//
// 这里用「冷缓存 init → 等缓存补齐 → 再读条目」复现原路径：修复前第二条断言拿到的是 0。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { init as initTimeline } from '$lib/calc/timeline.store.svelte'
import { init as initCalculation, getAllDamageEntries } from '$lib/calc/calculation.store.svelte'
import type { CharSlot } from '$lib/types/project'
import type { TimelineData } from '$lib/calc/timeline.types'
import type { CharacterInfo } from '$lib/api/types'
import { getCharElementMap } from '$lib/data/char-elements.svelte'

/**
 * @desc 用一个**静态元素表里就有**的真实角色：元素齐全时 `init` 不会走「元素图补齐后重建条目」
 * 那条路，才能真正复现「技能缓存冷 → 倍率 0 且永不重建」的原始路径。
 */
const RESPONDER = '莫宁'

const TEAM = [{ character: RESPONDER }, {}, {}] as unknown as [CharSlot, CharSlot, CharSlot]

const TIMELINE: TimelineData = {
    refLines: [],
    opBlocks: [{ id: 'resp-op', trackIndex: 0, pos: 120, key: '共鸣解放', desc: '', intro: false, switchback: false }],
    damageBlocks: [
        {
            id: 'resp-db',
            trackIndex: 3,
            sourceType: 'op',
            sourceId: 'resp-op',
            skillHits: [],
            nonDirectEntries: [{ name: '震谐响应', category: '响应', layers: 0, responders: [RESPONDER] }]
        }
    ]
}

/**
 * @desc 上游角色详情：震谐响应落在「共鸣回路」技能组里，行名是 `震谐响应·粒子射流伤害`、
 * 倍率形如 `298.22%偏谐系数`（真值取自 nanoka `ww/3.7` 莫宁，此处写死以免用例联网）。
 */
const CHARACTER_INFO: CharacterInfo = {
    rarity: 5,
    element: '热熔',
    weaponType: '音感仪',
    tags: [],
    lv90BaseStats: { hp: 1, atk: 1, def: 1, tuneBreakBoost: 10 },
    skills: [
        {
            name: '质能等价',
            type: '共鸣回路',
            desc: '',
            values: [['震谐响应·粒子射流伤害', '298.22%偏谐系数', '热熔']]
        }
    ],
    statNodes: [],
    chains: []
} as unknown as CharacterInfo

const responseEntryOf = () => getAllDamageEntries().find((e) => e.isTuneResponse)

describe('偏谐响应倍率：技能缓存补齐后要重建条目', () => {
    it('进工程首帧建设条目（缓存冷）后，缓存补齐时倍率不再是 0', async () => {
        assert.ok(getCharElementMap()[RESPONDER], `静态元素表应含 ${RESPONDER}（否则本用例走的是元素补齐路径）`)
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input)
            return {
                ok: true,
                status: 200,
                json: async () => (url.includes('/info/character/') ? CHARACTER_INFO : {})
            }
        }) as typeof globalThis.fetch

        try {
            // 与真实启动序列同序：先排轴（异步预热角色/技能），再拉表建条目
            initTimeline(TIMELINE, () => {}, TEAM, false)
            initCalculation(TEAM, TIMELINE, null, false, () => {})

            // 等首帧建设 + 缓存补齐后的那次重建
            for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5))

            const entry = responseEntryOf()
            assert.ok(entry, '应建设出偏谐响应条目')
            assert.equal(entry!.character, RESPONDER)
            assert.equal(entry!.ratioValue, 298.22, '倍率取自技能表（修复前恒为 0）')
            assert.equal(entry!.damageElement, '热熔', '元素取自技能表该行')
        } finally {
            globalThis.fetch = originalFetch
        }
    })
})
