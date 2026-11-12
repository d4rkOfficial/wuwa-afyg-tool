// Buff 级规则（BuffInstance.rules）：求值 / 归一化 / 旧条件升级 / 依赖（成环与级联删除）。
//
// 口径来源：.tmp/buff-modal-redesign/requirements.md 的「已对齐的决定」——
// 规则之间全部 AND；链与阶可以并存；`buffActive` 依赖按最小不动点求值；
// 创建期禁止直接自引用与间接循环；删除被引用项时按 all/any 语义级联。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { BuffInstance, BuffRule } from '$lib/calc/calculation.types'
import {
    cascadeDeleteIdsOf,
    cyclePathOf,
    describeRule,
    describeRules,
    evaluateRules,
    hasDraftRule,
    isRuleDraft,
    normalizeRule,
    normalizeRules,
    pruneRuleDependencies,
    resolveActiveBuffIds,
    rulesFromLegacyCondition,
    type RuleContext
} from '$lib/calc/rules'

const buff = (id: string, rules?: BuffRule[]): BuffInstance => ({
    id,
    name: id,
    zones: [],
    scope: 'all',
    ...(rules ? { rules } : {})
})

const ctx = (patch: Partial<RuleContext> = {}): RuleContext => ({
    chains: [0, 0, 0],
    refinements: [1, 1, 1],
    activeCharIdx: 0,
    ...patch
})

describe('规则求值：链 / 阶 / 敌人 / 伤害名', () => {
    it('链与阶可以并存（全部 AND）', () => {
        const rules: BuffRule[] = [
            { kind: 'chain', charIdx: 0, min: 3 },
            { kind: 'refinement', charIdx: 1, min: 2 }
        ]
        assert.equal(evaluateRules(rules, ctx({ chains: [3, 0, 0], refinements: [1, 2, 1] })), true)
        assert.equal(evaluateRules(rules, ctx({ chains: [2, 0, 0], refinements: [1, 2, 1] })), false)
        assert.equal(evaluateRules(rules, ctx({ chains: [3, 0, 0], refinements: [1, 1, 1] })), false)
    })

    it('0 链 = 角色本体门恒成立', () => {
        assert.equal(evaluateRules([{ kind: 'chain', charIdx: 2, min: 0 }], ctx()), true)
    })

    it('敌人类型按工程配置字面量比较', () => {
        const rule: BuffRule[] = [{ kind: 'enemyType', type: '精英怪' }]
        assert.equal(evaluateRules(rule, ctx({ enemyType: '精英怪' })), true)
        assert.equal(evaluateRules(rule, ctx({ enemyType: 'BOSS' })), false)
        assert.equal(evaluateRules(rule, ctx()), true, '没有敌人上下文时不构成否定')
    })

    it('伤害名：包含正则 / 全等', () => {
        assert.equal(
            evaluateRules([{ kind: 'damageNameRegex', pattern: '共鸣解放' }], ctx({ damageName: '共鸣解放·终曲' })),
            true
        )
        assert.equal(
            evaluateRules([{ kind: 'damageNameRegex', pattern: '^共鸣解放$' }], ctx({ damageName: '共鸣解放·终曲' })),
            false
        )
        assert.equal(
            evaluateRules([{ kind: 'damageNameEquals', value: '共鸣解放·终曲' }], ctx({ damageName: '共鸣解放·终曲' })),
            true
        )
        assert.equal(
            evaluateRules([{ kind: 'damageNameEquals', value: '共鸣解放' }], ctx({ damageName: '共鸣解放·终曲' })),
            false
        )
    })

    it('面板数值：按面板显示单位比较；charIdx=-1 取伤害条目的角色', () => {
        const stats = {
            atk: 2500,
            hp: 10000,
            def: 500,
            recharge: 120,
            offTuneBuildupRate: 40,
            tuneBreakBoost: 60,
            unisonBoonLayer: 2,
            critRate: 70,
            critDmg: 280
        }
        const of = () => stats
        assert.equal(
            evaluateRules(
                [{ kind: 'zoneCompare', charIdx: -1, zone: 'atk', op: 'ge', value: 2500 }],
                ctx({ statsOf: of })
            ),
            true
        )
        assert.equal(
            evaluateRules(
                [{ kind: 'zoneCompare', charIdx: -1, zone: 'atk', op: 'gt', value: 2500 }],
                ctx({ statsOf: of })
            ),
            false
        )
        assert.equal(
            evaluateRules(
                [{ kind: 'zoneCompare', charIdx: 1, zone: 'critDmg', op: 'ge', value: 280 }],
                ctx({ statsOf: of, activeCharIdx: 0 })
            ),
            true,
            'charrIdx=1 固定读 1 号位面板'
        )
        assert.equal(
            evaluateRules([{ kind: 'zoneCompare', charIdx: -1, zone: 'atk', op: 'ge', value: 1 }], ctx()),
            true,
            '拿不到面板时不构成否定'
        )
    })
})

describe('buffActive：最小不动点求值', () => {
    const A = buff('a')
    const B = buff('b', [{ kind: 'buffActive', mode: 'all', buffIds: ['a'] }])
    const C = buff('c', [{ kind: 'buffActive', mode: 'any', buffIds: ['a', 'b'] }])

    it('all：被引用项生效后才生效', () => {
        assert.deepEqual([...resolveActiveBuffIds([A, B], () => true, ctx())], ['a', 'b'])
    })

    it('被引用项被作用域挡掉 → 依赖方也不生效', () => {
        const active = resolveActiveBuffIds([A, B], (item) => item.id !== 'a', ctx())
        assert.equal(active.has('a'), false)
        assert.equal(active.has('b'), false)
    })

    it('any：至少一个生效即生效', () => {
        const active = resolveActiveBuffIds([A, B, C], (item) => item.id !== 'a', ctx())
        assert.equal(active.has('b'), false)
        assert.equal(active.has('c'), false, 'c 的 any 引用 a/b 都不生效')

        const active2 = resolveActiveBuffIds([A, B, C], () => true, ctx())
        assert.equal(active2.has('c'), true)
    })

    it('循环引用（脏数据）稳定落在「都不生效」而不是崩溃', () => {
        const x = buff('x', [{ kind: 'buffActive', mode: 'all', buffIds: ['y'] }])
        const y = buff('y', [{ kind: 'buffActive', mode: 'all', buffIds: ['x'] }])
        assert.equal(resolveActiveBuffIds([x, y], () => true, ctx()).size, 0)
    })

    it('链式依赖按拓扑顺序求值（多轮迭代）', () => {
        const a = buff('a')
        const b = buff('b', [{ kind: 'buffActive', mode: 'all', buffIds: ['a'] }])
        const c = buff('c', [{ kind: 'buffActive', mode: 'all', buffIds: ['b'] }])
        assert.deepEqual([...resolveActiveBuffIds([c, b, a], () => true, ctx())].sort(), ['a', 'b', 'c'])
    })
})

describe('归一化与旧条件升级', () => {
    it('越界槽位 / 未知枚举被丢弃；草稿形态保留（求值恒不满足）', () => {
        assert.deepEqual(normalizeRule({ kind: 'damageNameRegex', pattern: '(' }), {
            kind: 'damageNameRegex',
            pattern: '('
        })
        assert.deepEqual(normalizeRule({ kind: 'buffActive', mode: 'all', buffIds: [] }), {
            kind: 'buffActive',
            mode: 'all',
            buffIds: []
        })
        assert.equal(normalizeRule({ kind: 'chain', charIdx: 5, min: 1 }), null)
        assert.equal(normalizeRule({ kind: 'refinement', charIdx: 0, min: 0 }), null, '阶最小是 1')
        assert.equal(normalizeRule({ kind: 'enemyType', type: 'boss' }), null, '敌人类型取工程字面量')
    })

    it('草稿规则一律不满足（新建后还没填值的条件不能让 Buff 意外生效）', () => {
        assert.equal(evaluateRules([{ kind: 'damageNameRegex', pattern: '' }], ctx({ damageName: '任意' })), false)
        assert.equal(evaluateRules([{ kind: 'damageNameRegex', pattern: '(' }], ctx({ damageName: '任意' })), false)
        assert.equal(evaluateRules([{ kind: 'damageNameEquals', value: '  ' }], ctx({ damageName: '任意' })), false)
        assert.equal(evaluateRules([{ kind: 'buffActive', mode: 'all', buffIds: [] }], ctx()), false)
        assert.equal(isRuleDraft({ kind: 'chain', charIdx: 0, min: 1 }), false)
        assert.equal(hasDraftRule([{ kind: 'chain', charIdx: 0, min: 1 }]), false)
        assert.equal(hasDraftRule([{ kind: 'damageNameEquals', value: '' }]), true)
    })

    it('normalizeRules 去重并保持顺序', () => {
        const rules = normalizeRules([
            { kind: 'chain', charIdx: 0, min: 1 },
            { kind: 'chain', charIdx: 0, min: 1 },
            { kind: 'enemyType', type: 'BOSS' }
        ])
        assert.deepEqual(rules, [
            { kind: 'chain', charIdx: 0, min: 1 },
            { kind: 'enemyType', type: 'BOSS' }
        ])
    })

    it('旧 instance condition 的链/阶升级为规则（可并存，不互斥）', () => {
        assert.deepEqual(rulesFromLegacyCondition({ chains: [{ charIdx: 1, min: 2 }] }, 0), [
            { kind: 'chain', charIdx: 1, min: 2 }
        ])
        assert.deepEqual(
            rulesFromLegacyCondition({ chains: [{ charIdx: 0, min: 1 }], refinements: [{ charIdx: 0, min: 2 }] }, 0),
            [
                { kind: 'chain', charIdx: 0, min: 1 },
                { kind: 'refinement', charIdx: 0, min: 2 }
            ]
        )
        assert.deepEqual(rulesFromLegacyCondition({ chain: 3, refinement: 2 }, 1), [
            { kind: 'chain', charIdx: 1, min: 3 },
            { kind: 'refinement', charIdx: 1, min: 2 }
        ])
        assert.equal(rulesFromLegacyCondition(undefined, 0), undefined)
    })
})

describe('依赖关系：成环检测与级联删除', () => {
    const A = buff('a')
    const B = buff('b', [{ kind: 'buffActive', mode: 'all', buffIds: ['a'] }])
    const C = buff('c', [{ kind: 'buffActive', mode: 'all', buffIds: ['b'] }])

    it('直接自引用被拒', () => {
        assert.deepEqual(cyclePathOf([A], 'a', [{ kind: 'buffActive', mode: 'all', buffIds: ['a'] }]), ['a', 'a'])
    })

    it('间接循环被拒并给出环路径', () => {
        const path = cyclePathOf([A, B], 'a', [{ kind: 'buffActive', mode: 'all', buffIds: ['b'] }])
        assert.ok(path, 'a → b → a 应被识别为环')
        assert.equal(path![0], 'a')
        assert.ok(path!.includes('b'))
    })

    it('无环时返回 null', () => {
        assert.equal(cyclePathOf([A, B], 'c', [{ kind: 'buffActive', mode: 'all', buffIds: ['a'] }]), null)
    })

    it('all 规则：引用项被删 → 依赖方级联删除（多级）', () => {
        assert.deepEqual(cascadeDeleteIdsOf([A, B, C], ['a']).sort(), ['a', 'b', 'c'])
    })

    it('any 规则：引用集合仍有存活项时保留依赖方', () => {
        const anyBuff = buff('any', [{ kind: 'buffActive', mode: 'any', buffIds: ['a', 'x'] }])
        const x = buff('x')
        const ids = cascadeDeleteIdsOf([anyBuff, x], ['a'])
        assert.deepEqual(ids, ['a'], 'any 还有存活的 x，不应级联删除')
    })

    it('any 规则：引用集合全部消失才删除依赖方', () => {
        const anyBuff = buff('any', [{ kind: 'buffActive', mode: 'any', buffIds: ['a', 'x'] }])
        const x = buff('x')
        assert.deepEqual(cascadeDeleteIdsOf([anyBuff, x], ['a', 'x']).sort(), ['a', 'any', 'x'])
    })

    it('剪引用：被删项从 buffActive 里移除，剪空则整条规则消失', () => {
        assert.deepEqual(pruneRuleDependencies([{ kind: 'buffActive', mode: 'any', buffIds: ['a', 'b'] }], ['a']), [
            { kind: 'buffActive', mode: 'any', buffIds: ['b'] }
        ])
        assert.equal(pruneRuleDependencies([{ kind: 'buffActive', mode: 'all', buffIds: ['a'] }], ['a']), undefined)
        assert.deepEqual(pruneRuleDependencies([{ kind: 'chain', charIdx: 0, min: 1 }], ['a']), [
            { kind: 'chain', charIdx: 0, min: 1 }
        ])
    })
})

describe('文案', () => {
    it('单条与整组规则可读', () => {
        assert.equal(describeRule({ kind: 'chain', charIdx: 0, min: 0 }), '角色1 本体（0 链）')
        assert.equal(describeRule({ kind: 'chain', charIdx: 0, min: 2 }), '角色1 共鸣链 ≥ 2')
        assert.equal(
            describeRule({ kind: 'refinement', charIdx: 1, min: 3 }, { slotName: () => '乙' }),
            '乙 武器精炼 ≥ 3 阶'
        )
        assert.equal(describeRule({ kind: 'enemyType', type: 'BOSS' }), '敌人类型 = BOSS')
        assert.equal(
            describeRule(
                { kind: 'buffActive', mode: 'any', buffIds: ['a', 'b'] },
                { buffName: (id) => id.toUpperCase() }
            ),
            '以下 BUFF 至少一个生效：A、B'
        )
        assert.equal(
            describeRules([
                { kind: 'enemyType', type: '小怪' },
                { kind: 'damageNameEquals', value: 'X' }
            ]),
            '敌人类型 = 小怪 且 伤害名 = X'
        )
    })
})
