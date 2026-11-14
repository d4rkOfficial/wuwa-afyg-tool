// compute.ts 的 Buff 级规则门槛（`zoneCompare`）回归测试：**由 Buff 产出的面板值**（同奏增益层数）必须能被门槛读到。
//
// 口径：门槛读的「无条件部分」面板不能排除所有带 rules 的 Buff —— 同奏层数的每个产层源
// 都带自封顶规则（`unisonBoonLayer lt 4`），一律排除的话门槛读到的层数恒为 0：
// `ge` 永远不满足（一整套「每层同奏」增益全部不生效）、`lt` 永远满足（上限从不生效）。
// 因此面板按「除 zoneCompare 外的规则」筛 Buff，并把**正在判定的那个 Buff 自身**从面板里摘掉。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeOneEntry } from '$lib/calc/compute'
import type { BuffInstance, BuffRule, DamageEntry } from '$lib/calc/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'

const CHAR = '测试角色'
const ENTRY_ID = 'e1'

const charInfo: CharacterInfo = {
    rarity: 5,
    element: '导电',
    weaponType: '长刃',
    tags: [],
    lv90BaseStats: { hp: 10000, atk: 1000, def: 500, tuneBreakBoost: 0 },
    skills: [],
    statNodes: [],
    chains: []
}

const emptyEcho = (): EchoSlotConfig => ({ cost: 1, mainStat: null, secondMainStat: null, substats: [] })
type Echoes = ConfigState['characters'][number]['echoes']
const echoes = (): Echoes => [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()]

const configState: ConfigState = {
    characters: [{ echoes: echoes() }, { echoes: echoes() }, { echoes: echoes() }],
    enemy: { type: 'BOSS', level: 90, defense: 1000, resistances: {}, dmgReduction: 0 }
}
const team = [{ character: CHAR, weapon: null }] as unknown as CharSlot[]
const charInfoMap: Record<string, CharacterInfo> = { [CHAR]: charInfo }
const weaponInfoMap: Record<string, WeaponInfo> = {}

const entry: DamageEntry = {
    id: ENTRY_ID,
    character: CHAR,
    hitName: '测试伤害',
    displayName: '测试伤害',
    isEffect: false,
    isTuneBreak: false,
    isTuneResponse: false,
    ratioValue: 100,
    ratioUnit: '%',
    damageBaseType: '攻击',
    damageElement: '导电',
    sourceTimelineBlockId: 'b1',
    hits: 1
}

/** @desc 以给定 Buff 全部绑定到该条目算伤害（链档位可调） */
const damageWith = (buffs: BuffInstance[], chains: number[] = [0, 0, 0]): number =>
    computeOneEntry(
        entry,
        0,
        echoes(),
        buffs,
        buffs.length > 0 ? { [ENTRY_ID]: buffs.map((b) => b.id) } : {},
        {},
        configState,
        team,
        charInfoMap,
        weaponInfoMap,
        { chains, refinements: [1, 1, 1] }
    ).totalDamage

const buffOf = (id: string, zones: BuffInstance['zones'], rules?: BuffRule[]): BuffInstance =>
    ({ id, name: id, scope: [0], zones, ...(rules ? { rules } : {}) }) as unknown as BuffInstance

/** @desc 产层源：+1 层同奏；`cap` 给了就带上「至多 cap 层」的自封顶规则（与工程里的真实写法一致） */
const layerSource = (id: string, cap?: number, extraRules: BuffRule[] = []): BuffInstance =>
    buffOf(
        id,
        [{ zoneId: 'unisonBoonLayer', value: 1 }],
        cap === undefined
            ? extraRules.length > 0
                ? extraRules
                : undefined
            : [{ kind: 'zoneCompare', charIdx: -1, zone: 'unisonBoonLayer', op: 'lt', value: cap }, ...extraRules]
    )

/** @desc 读同奏层数的消费者：`ge min` 层时给 +15% 暴击伤害 */
const gatedCritDmg = (id: string, min: number): BuffInstance =>
    buffOf(
        id,
        [{ zoneId: 'critDmg', value: 15 }],
        [{ kind: 'zoneCompare', charIdx: -1, zone: 'unisonBoonLayer', op: 'ge', value: min }]
    )

const base = damageWith([])

describe('面板门槛：带自封顶规则的产层源也要被门槛读到', () => {
    it('0 层时门槛拒绝（ge 1 不满足）', () => {
        assert.equal(damageWith([gatedCritDmg('g0', 1)]), base, '没有层数时门槛应挡住')
    })

    it('4 个自封顶产层源：ge 1 / 2 / 3 / 4 逐层生效', () => {
        const sources = ['s1', 's2', 's3', 's4'].map((id) => layerSource(id, 4))
        const noGate = damageWith(sources)
        assert.ok(noGate > base, '4 层同奏本身应抬高伤害（同奏区 = 1 + 3% × 4）')
        for (const min of [1, 2, 3, 4]) {
            const withGate = damageWith([...sources, gatedCritDmg(`g${min}`, min)])
            assert.ok(withGate > noGate, `ge ${min} 门槛应满足（层数 4 ≥ ${min}）`)
            assert.equal(
                damageWith([...sources, gatedCritDmg(`g${min}`, min)]),
                withGate,
                `ge ${min} 门槛结果应稳定可复现`
            )
        }
    })

    it('ge 5 仍然拒绝（4 个源封顶 4 层）', () => {
        const sources = ['s1', 's2', 's3', 's4'].map((id) => layerSource(id, 4))
        assert.equal(damageWith([...sources, gatedCritDmg('g5', 5)]), damageWith(sources), '第 5 层不存在')
    })

    it('产层源多于上限时全部关闭（逐源自判的固有限制，不是按上限截断）', () => {
        // 5 个源各自 `lt 4`：每个源都看到「其它 4 个源已满」→ 全部不生效。真正的 clamp 需要引擎支持。
        const five = ['s1', 's2', 's3', 's4', 's5'].map((id) => layerSource(id, 4))
        assert.equal(damageWith(five), base, '超配时失败方向是「全部关闭」，请按上限数量配置产层源')
    })

    it('带链门槛的产层源也算进面板（链满足后门槛才满足）', () => {
        const chained = layerSource('s-chain', 4, [{ kind: 'chain', charIdx: 0, min: 3 }])
        const gated = gatedCritDmg('g-chain', 1)
        assert.equal(damageWith([chained, gated], [0, 0, 0]), base, '0 链时产层源不生效，门槛读 0 层')
        const on = damageWith([chained], [3, 0, 0])
        assert.ok(on > base, '3 链时产层源生效')
        assert.ok(damageWith([chained, gated], [3, 0, 0]) > on, '3 链时门槛应读到那 1 层')
    })
})

describe('面板门槛：本 Buff 自身的贡献不计入（自封顶的前提）', () => {
    it('自己写 1 层、门槛要求 lt 1：仍能生效（面板里看不到自己）', () => {
        const selfCap = layerSource('self', 1)
        assert.ok(damageWith([selfCap]) > base, '若把自己算进面板，1 < 1 不成立 → 该源永远不生效')
    })

    it('自己写 1 层、门槛要求 ge 2：不生效（自身贡献不参与判定）', () => {
        const selfGated = layerSource('self2', 4, [
            { kind: 'zoneCompare', charIdx: -1, zone: 'unisonBoonLayer', op: 'ge', value: 2 }
        ])
        assert.equal(damageWith([selfGated]), base, '只有自己那 1 层，够不到 2 层')
    })

    it('他人的层数照常可见：门槛 ge 2 + 另一个源 → 满足', () => {
        const other = layerSource('other', 4)
        const selfGated = layerSource('self3', 4, [
            { kind: 'zoneCompare', charIdx: -1, zone: 'unisonBoonLayer', op: 'ge', value: 1 }
        ])
        const layers = damageWith([other, selfGated])
        assert.ok(layers > damageWith([other]), '别的源提供的层数应能让它过关')
    })
})

describe('面板门槛：已登记的限制（不要误以为支持）', () => {
    it('依赖「某 BUFF 生效」的规则的产层源不进面板（它需要生效集合，与面板互递归）', () => {
        const dummy = buffOf('dummy', [{ zoneId: 'critRate', value: 0 }])
        const viaActive = layerSource('s-active', 4, [{ kind: 'buffActive', mode: 'all', buffIds: ['dummy'] }])
        // 该源本身确实生效（dummy 也在候选里且无条件），层数进了伤害 …
        assert.ok(damageWith([dummy, viaActive]) > base, '该产层源自身应生效')
        // … 但门槛看不到它 → ge 1 不满足
        assert.equal(
            damageWith([dummy, viaActive, gatedCritDmg('g-active', 1)]),
            damageWith([dummy, viaActive]),
            'buffActive 产层源对门槛不可见（文档化的限制）'
        )
    })
})
