// 公式注册表的静态闸门（决议 D35「注册严肃性」）。
//
// 三条硬断言，把「靠记忆/靠文档」变成「靠检查」：
//   ① **覆盖**：每个 Buff 作用要么被某个乘子读、要么参与三维派生、要么登记在 `DISPLAY_ONLY_ACTIONS`；
//   ② **顺序**：每条公式链必须是 `MULTIPLIER_ORDER` 的子序列（防止再出现两套乘区顺序）；
//   ③ **清单**：公式图（id / version / inputs / uses / chain）被钉在快照里，改结构必须显式承认。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { formatMultiplierDisplay } from '$lib/result/styles'
import {
    BUFF_ACTIONS,
    FORMULAS,
    MULTIPLIER_ORDER,
    MULTIPLIERS,
    REF_SOURCES,
    emptyPanel,
    emptyTargetPanel,
    formulaActionClosure
} from '$lib/calc/core-config'
import { DISPLAY_ONLY_ACTIONS, MULTIPLIER_META, formulaMetaOf } from '$lib/calc/display-meta'

const ALL_FORMULAS = ['direct', 'tune', 'effect', 'fixed'] as const

describe('公式注册表：作用覆盖', () => {
    it('每个作用都被某条公式链读到、或参与三维派生、或写目标侧、或登记为「仅展示」', () => {
        const consumed = new Set<string>()
        for (const id of ALL_FORMULAS) {
            for (const action of formulaActionClosure(id)) consumed.add(action)
        }
        // `charLevel` 由内核以 `const.charLevel` 读取（防御区用），不在乘子 inputs 里
        const KERNEL_CONST = new Set(['charLevel'])
        const missing = BUFF_ACTIONS.filter(
            (action) =>
                !consumed.has(String(action.id)) &&
                action.panel === undefined &&
                action.targetField === undefined &&
                !KERNEL_CONST.has(String(action.id)) &&
                !DISPLAY_ONLY_ACTIONS.has(String(action.id))
        ).map((action) => String(action.id))
        assert.deepEqual(missing, [], '这些作用既没被公式读、也不参与三维派生、也不写目标侧、也没登记仅展示 → 接线漏了')
    })

    it('「仅展示」登记的项都真实存在，且确实没被公式读', () => {
        const consumed = new Set<string>()
        for (const id of ALL_FORMULAS) {
            for (const action of formulaActionClosure(id)) consumed.add(action)
        }
        const known = new Set(BUFF_ACTIONS.map((a) => String(a.id)))
        for (const [id, reason] of DISPLAY_ONLY_ACTIONS) {
            assert.ok(known.has(id), `仅展示登记里有不存在的作用：${id}（理由：${reason}）`)
            assert.ok(!consumed.has(id), `${id} 已被公式读取，应从仅展示名单移除（理由：${reason}）`)
        }
    })

    it('公式里的输入名都指向真实作用或保留输入', () => {
        const known = new Set(BUFF_ACTIONS.map((a) => String(a.id)))
        const reserved = new Set(['const.charLevel', 'target.defense', 'v'])
        for (const id of ALL_FORMULAS) {
            for (const handle of FORMULAS[id].chain) {
                for (const input of handle.inputs) {
                    const bare =
                        typeof input === 'string'
                            ? input.startsWith('target.')
                                ? input.slice('target.'.length)
                                : input
                            : input
                    assert.ok(
                        known.has(String(bare)) || reserved.has(String(input)),
                        `公式 ${id} 的乘子 ${String(handle.id)} 声明了未知输入 ${String(input)}`
                    )
                }
            }
        }
    })

    it('引用来源都能真正读到值', () => {
        for (const source of REF_SOURCES) {
            assert.equal(typeof source.get, 'function', `${String(source.id)} 缺少 get`)
        }
    })
})

describe('公式注册表：乘区展示', () => {
    it('每个乘子的 display 在值 1 与非 1 时都能产出非空文案', () => {
        const ctx = {
            panel: emptyPanel(),
            target: emptyTargetPanel(),
            element: '冷凝',
            damageTypes: [],
            elementBonus: 0,
            typeBonus: 0,
            consts: { charLevel: 90 }
        }
        for (const id of MULTIPLIER_ORDER) {
            const meta = MULTIPLIER_META[id]
            for (const value of [1, 1.25]) {
                const text = formatMultiplierDisplay(value, meta.display(value, ctx))
                assert.ok(text.length > 0, `乘子 ${id} 在 value=${value} 时没有展示文案`)
            }
        }
    })
})

describe('公式注册表：链顺序与清单', () => {
    it('每条公式链都是 MULTIPLIER_ORDER 的子序列', () => {
        for (const id of ALL_FORMULAS) {
            let last = -1
            for (const handle of FORMULAS[id].chain) {
                const at = MULTIPLIER_ORDER.indexOf(String(handle.id) as (typeof MULTIPLIER_ORDER)[number])
                assert.ok(at >= 0, `${id} 的链里有未知乘子 ${String(handle.id)}`)
                assert.ok(at > last, `${id} 的链顺序与 MULTIPLIER_ORDER 不一致（${String(handle.id)}）`)
                last = at
            }
        }
    })

    it('MULTIPLIER_ORDER 覆盖全部乘子且无重复', () => {
        const ids = Object.keys(MULTIPLIERS)
        assert.deepEqual([...MULTIPLIER_ORDER].sort(), [...ids].sort(), 'MULTIPLIER_ORDER 与 MULTIPLIERS 必须一一对应')
        assert.equal(new Set(MULTIPLIER_ORDER).size, MULTIPLIER_ORDER.length, 'MULTIPLIER_ORDER 不能有重复项')
    })

    it('清单快照：公式图的结构变化必须显式承认', () => {
        const manifest = Object.fromEntries(
            ALL_FORMULAS.map((id) => {
                const def = FORMULAS[id]
                return [
                    id,
                    {
                        base: def.base.kind,
                        baseAttr:
                            def.base.kind === 'panelStat'
                                ? (def.base.dim ?? 'auto')
                                : def.base.kind === 'zone'
                                  ? String(def.base.id)
                                  : def.base.kind === 'targetStat'
                                    ? String(def.base.field)
                                    : null,
                        critBase: def.critBase,
                        reportsDamageTypes: formulaMetaOf(id)?.reportsDamageTypes ?? false,
                        chain: def.chain.map((handle) => String(handle.id))
                    }
                ]
            })
        )
        assert.deepEqual(manifest, FORMULA_MANIFEST)
    })
})

/**
 * @desc 公式图快照。改动公式的 `base` / `critBase` / 链成员或乘子输入时，先确认这是有意的，
 * 再把这里同步成新值（与 `compute-golden.test.ts` 的数值快照一起构成「结构 + 数值」双基线）。
 */
const FORMULA_MANIFEST = {
    direct: {
        base: 'panelStat',
        baseAttr: 'auto',
        critBase: 'panel',
        reportsDamageTypes: true,
        chain: ['deepen', 'bonus', 'vuln', 'resist', 'defense', 'tuneStrain', 'unison', 'final', 'special', 'crit']
    },
    tune: {
        base: 'targetStat',
        baseAttr: 'coefficient',
        critBase: 'coefficient',
        reportsDamageTypes: true,
        chain: ['deepen', 'vuln', 'resist', 'defense', 'tuneStrain', 'tuneBreak', 'unison', 'final', 'special', 'crit']
    },
    effect: {
        base: 'zone',
        baseAttr: 'effectCoeff',
        critBase: 'coefficient',
        reportsDamageTypes: true,
        chain: ['deepen', 'vuln', 'resist', 'defense', 'tuneStrain', 'tuneBreak', 'unison', 'final', 'special', 'crit']
    },
    fixed: {
        base: 'fixed',
        baseAttr: null,
        critBase: 'panel',
        reportsDamageTypes: true,
        chain: []
    }
}
