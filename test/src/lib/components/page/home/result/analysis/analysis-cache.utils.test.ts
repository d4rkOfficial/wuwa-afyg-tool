// 数据分析「贡献」结果的缓存判定（纯函数）：打开弹窗时该不该重算、重算后哪些部分仍有效。
//
// 背景：整套贡献分析约 130ms 且分片占主线程，以前每次打开弹窗都无条件重算一遍。
// 这里钉住三条口径：
// 1. 输入指纹逐项比较（引用项按 `===`，其余按值）；
// 2. Buff 与副词条算法无关 —— 换算法只让副词条失效；
// 3. 输入一变，旧的「已算过」记录整体作废，不能拿旧结果冒充新结果。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    analysisFresh,
    analysisNeeded,
    nextAnalysisCache,
    sameAnalysisInputs,
    type AnalysisCache,
    type AnalysisInputs
} from '$lib/components/page/home/result/analysis/analysis-cache.utils'

const team = [{ character: '甲', weapon: null }] as unknown as AnalysisInputs['teamRef']
const configRef = { characters: [] } as unknown as AnalysisInputs['configRef']
const otherConfigRef = { characters: [] } as unknown as AnalysisInputs['configRef']
const charInfoRef = { 甲: {} } as unknown as AnalysisInputs['charInfoRef']
const weaponInfoRef = {} as AnalysisInputs['weaponInfoRef']
const echoTextRef = { 甲: '视为普攻伤害' } as AnalysisInputs['echoTextRef']

const inputs = (overrides: Partial<AnalysisInputs> = {}): AnalysisInputs => ({
    table: 7,
    entries: '120:9300',
    profile: '1,0,2|1,1,1',
    teamRef: team,
    configRef,
    charInfoRef,
    weaponInfoRef,
    echoTextRef,
    crit: 'e1| | ',
    refresh: 0,
    ...overrides
})

const cache = (overrides: Partial<AnalysisCache> = {}): AnalysisCache => ({
    inputs: inputs(),
    parts: ['substat', 'buff'],
    algorithm: 'single-loss',
    ...overrides
})

describe('sameAnalysisInputs', () => {
    it('逐项相同 → true；引用项是同一对象才算相同', () => {
        assert.equal(sameAnalysisInputs(inputs(), inputs()), true)
        assert.equal(sameAnalysisInputs(inputs(), inputs({ teamRef: [...team] })), false, '新数组不算同一队')
        assert.equal(sameAnalysisInputs(inputs(), inputs({ configRef: otherConfigRef })), false)
    })

    it('版本号 / 指纹 / 算法外的字符串 / 刷新计数任一变化都算不同', () => {
        for (const patch of [
            { table: 8 },
            { entries: '120:9301' },
            { profile: '1,0,2|1,1,2' },
            { crit: 'e1|e2| ' },
            { refresh: 1 }
        ] as Partial<AnalysisInputs>[]) {
            assert.equal(sameAnalysisInputs(inputs(), inputs(patch)), false, JSON.stringify(patch))
        }
    })
})

describe('analysisFresh：哪几部分可以直接复用', () => {
    it('没有缓存 → 都不算新', () => {
        for (const part of ['substat', 'buff'] as const) {
            assert.equal(analysisFresh(null, part, inputs(), 'single-loss'), false)
        }
    })

    it('输入与算法都没变 → 两部分都新', () => {
        assert.equal(analysisFresh(cache(), 'substat', inputs(), 'single-loss'), true)
        assert.equal(analysisFresh(cache(), 'buff', inputs(), 'single-loss'), true)
    })

    it('换算法 → 只有副词条失效（Buff 与算法无关）', () => {
        assert.equal(analysisFresh(cache(), 'substat', inputs(), 'shapley'), false)
        assert.equal(analysisFresh(cache(), 'buff', inputs(), 'shapley'), true)
    })

    it('输入变了 → 两部分都失效，哪怕算法没变', () => {
        const changed = inputs({ table: 8 })
        assert.equal(analysisFresh(cache(), 'substat', changed, 'single-loss'), false)
        assert.equal(analysisFresh(cache(), 'buff', changed, 'single-loss'), false)
    })

    it('缓存里没算过那一半 → 那一半不算新', () => {
        const onlyBuff = cache({ parts: ['buff'] })
        assert.equal(analysisFresh(onlyBuff, 'substat', inputs(), 'single-loss'), false)
        assert.equal(analysisFresh(onlyBuff, 'buff', inputs(), 'single-loss'), true)
    })
})

describe('analysisNeeded：本次真正要算的部分', () => {
    it('全部是新的 → 返回空数组（打开弹窗秒开）', () => {
        assert.deepEqual(analysisNeeded(cache(), ['substat', 'buff'], inputs(), 'single-loss'), [])
    })

    it('只有请求里失效的部分才算', () => {
        assert.deepEqual(analysisNeeded(cache(), ['substat'], inputs(), 'shapley'), ['substat'])
        assert.deepEqual(analysisNeeded(cache(), ['substat', 'buff'], inputs({ table: 9 }), 'single-loss'), [
            'substat',
            'buff'
        ])
    })
})

describe('nextAnalysisCache：一次重算后的登记', () => {
    it('输入没变 → 保留已算过的部分（只重算副词条后 Buff 仍然有效）', () => {
        const next = nextAnalysisCache(cache({ parts: ['buff'] }), inputs(), ['substat'], 'shapley')
        assert.deepEqual(next.parts, ['buff', 'substat'])
        assert.equal(next.algorithm, 'shapley')
    })

    it('输入变了 → 只留本次算出来的部分，旧结果作废', () => {
        const changed = inputs({ entries: '130:9900' })
        const next = nextAnalysisCache(cache(), changed, ['substat'], 'single-loss')
        assert.deepEqual(next.parts, ['substat'], '旧 Buff 结果是上一份输入的，不能留下')
        assert.equal(next.algorithm, 'single-loss')
        assert.equal(sameAnalysisInputs(next.inputs, changed), true)
    })

    it('本次没算副词条 → 沿用上一次的算法标记', () => {
        const next = nextAnalysisCache(cache({ algorithm: 'shapley', parts: ['buff'] }), inputs(), ['buff'], 'shapley')
        assert.equal(next.algorithm, 'shapley')
        assert.deepEqual(next.parts, ['buff'])
    })

    it('parts 去重（重复请求不会堆出重复项）', () => {
        const next = nextAnalysisCache(cache(), inputs(), ['buff', 'buff'], 'single-loss')
        assert.deepEqual(next.parts, ['substat', 'buff'])
    })
})
