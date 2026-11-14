// 引用转模（ref）的读数回归：`resolveRefValue` 的取档与裁剪口径。
//
// 重点：**小数档长**（divisor 0.1 / 0.12 这类）不能因为浮点除算少给一档 —— 真实数据里有
// 「暴击率每超过 50% 的 0.1% 加 1 攻击」这种条目，excess / 0.1 会算成 2.9999999999999716，
// 朴素 Math.floor 直接少一档。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeOneEntry } from '$lib/calc/compute'
import type { BuffInstance, DamageEntry } from '$lib/calc/calculation.types'
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

const damageWith = (buffs: BuffInstance[]): number =>
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
        { chains: [0, 0, 0], refinements: [1, 1, 1] }
    ).totalDamage

/** @desc 普通 buff：`extraRatio += ref(攻击白值换算)`；用 extraRatio 让差值线性可读 */
const refBuffOf = (ref: {
    pct: number
    threshold: number
    lower?: number
    upper?: number
    discrete?: boolean
    divisor?: number
    multiplier?: number
}): BuffInstance =>
    ({
        id: 'ref',
        name: 'ref',
        scope: [0],
        // characterIdx 必填：缺省时引擎拿不到被引用角色的面板，转模恒读 0
        zones: [{ zoneId: 'extraRatio', value: 0, ref: { characterIdx: 0, zoneId: 'baseAtk', ...ref } }]
    }) as unknown as BuffInstance

const base = damageWith([])

describe('转模读数：离散档位', () => {
    it('整数档长按「每档倍增」累计', () => {
        // 攻击白值 1000：每 100 点转 +5%（threshold 0）→ 10 档 → extraRatio +50%
        const buff = refBuffOf({ pct: 0, threshold: 0, discrete: true, divisor: 100, multiplier: 5 })
        assert.ok(damageWith([buff]) > base, '应吃到 50% 额外倍率')
    })

    it('小数档长不会因浮点除算少给一档（divisor 0.1 恰好整档）', () => {
        // 攻击白值 1000：threshold 999.7、divisor 0.1 → 恰 3 档；浮点会算成 2.9999… 少一档
        const buff = refBuffOf({ pct: 0, threshold: 999.7, discrete: true, divisor: 0.1, multiplier: 5 })
        const threeSteps = damageWith([buff])
        const twoSteps = damageWith([
            refBuffOf({ pct: 0, threshold: 999.8, discrete: true, divisor: 0.1, multiplier: 5 })
        ])
        assert.ok(threeSteps > twoSteps, '整档必须算满 3 档，而不是被浮点截成 2 档')
    })

    it('门槛以下恒为 0', () => {
        const buff = refBuffOf({ pct: 0, threshold: 2000, discrete: true, divisor: 100, multiplier: 5 })
        assert.equal(damageWith([buff]), base)
    })
})

describe('转模读数：线性与上下限', () => {
    it('线性按超出部分的百分比换算', () => {
        // 攻击 1000：threshold 0、pct 5% → extraRatio +50%
        const buff = refBuffOf({ pct: 5, threshold: 0 })
        assert.ok(damageWith([buff]) > base)
    })

    it('上限截断', () => {
        const capped = refBuffOf({ pct: 50, threshold: 0, upper: 100 })
        const uncapped = refBuffOf({ pct: 50, threshold: 0 })
        assert.ok(damageWith([capped]) < damageWith([uncapped]), '上限 100% 应截断 500% 的换算结果')
    })

    it('下限兜底', () => {
        const floored = refBuffOf({ pct: 1, threshold: 0, lower: 200 })
        const unfloored = refBuffOf({ pct: 1, threshold: 0 })
        assert.ok(damageWith([floored]) > damageWith([unfloored]), '下限 200% 应抬高换算结果')
    })
})
