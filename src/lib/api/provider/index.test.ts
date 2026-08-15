// ── provider 选择/查询参数逻辑单测 ────────────────────────────────────────
// 验证注册表、显式选择、?provider= 查询参数与 providerQuery() 拼接等纯逻辑。

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
    REGISTRY,
    listProviders,
    getProvider,
    getCurrentProviderId,
    providerQuery,
    providerIdFromUrl,
    setProvider,
    resetProvider
} from './index.ts'

beforeEach(() => {
    // 避免测试间相互污染选择状态
    resetProvider()
})

describe('provider registry', () => {
    it('registers nanoka as the production provider', () => {
        const ids = REGISTRY.map((r) => r.id)
        assert.deepEqual(ids, ['nanoka'])
    })

    it('listProviders returns id + label pairs', () => {
        const list = listProviders()
        assert.deepEqual(list, [{ id: 'nanoka', label: 'Nanoka (nanoka.cc)' }])
    })

    it('getProvider returns a DataProvider with an id', () => {
        const p = getProvider()
        assert.equal(p.id, 'nanoka')
        assert.equal(typeof p.getCharacterList, 'function')
    })

    it('getProvider(id) yields the requested provider; unknown id falls back to default', () => {
        assert.equal(getProvider('nanoka').id, 'nanoka')
        assert.equal(getProvider('does-not-exist').id, 'nanoka')
    })
})

describe('provider selection state', () => {
    it('defaults current id to nanoka', () => {
        assert.equal(getCurrentProviderId(), 'nanoka')
    })

    it('setProvider then resetProvider toggles the current id', () => {
        setProvider('nanoka')
        assert.equal(getCurrentProviderId(), 'nanoka')
        resetProvider()
        assert.equal(getCurrentProviderId(), 'nanoka')
    })

    it('setProvider throws for unknown ids', () => {
        assert.throws(() => setProvider('nope'), /Unknown data provider/)
    })
})

describe('provider query wiring', () => {
    it('providerQuery() is empty for default nanoka (no param attached)', () => {
        resetProvider()
        assert.equal(getCurrentProviderId(), 'nanoka')
        assert.equal(providerQuery(), '')
    })

    it('providerIdFromUrl extracts a registered provider id and ignores unknown', () => {
        const withNanoka = new URL('http://localhost/api/v1/list/character?provider=nanoka')
        assert.equal(providerIdFromUrl(withNanoka), 'nanoka')
        const withUnknown = new URL('http://localhost/api/v1/list/character?provider=nope')
        assert.equal(providerIdFromUrl(withUnknown), undefined)
        const none = new URL('http://localhost/api/v1/list/character')
        assert.equal(providerIdFromUrl(none), undefined)
    })
})
