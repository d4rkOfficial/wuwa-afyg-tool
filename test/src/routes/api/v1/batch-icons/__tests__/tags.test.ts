// ── /api/v1/batch-icons/tags 路由级回归 ──────────────────────────────────
// 验证 tags 实体已接入 batch-icons，并返回「短标识 → 完整 URL」映射。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { GET } from '$src/routes/api/v1/batch-icons/[entity]/+server'
import { characterList } from '../../../../../lib/api/provider/nanoka/__fixtures__.ts'
import { characterDetail } from '../../../../../lib/api/provider/nanoka/__fixtures__.ts'

const realFetch = globalThis.fetch

const installFetch = (): void => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input)
        if (/manifest\.json$/.test(url)) {
            return new Response(JSON.stringify({ ww: { latest: '3.5', available: ['3.5'] } }), {
                headers: { 'Content-Type': 'application/json' }
            })
        }
        if (/\/ww\/.+\/character\.json$/.test(url)) {
            return new Response(JSON.stringify(characterList), { headers: { 'Content-Type': 'application/json' } })
        }
        if (/\/ww\/.+\/zh\/character\/.+\.json$/.test(url)) {
            return new Response(JSON.stringify(characterDetail), { headers: { 'Content-Type': 'application/json' } })
        }
        throw new Error('Unhandled fetch URL in test: ' + url)
    }
}

describe('batch-icons/tags', () => {
    it('returns tag icon key → URL map', async () => {
        installFetch()
        try {
            const res = await GET({
                params: { entity: 'tags' },
                url: new URL('http://localhost/api/v1/batch-icons/tags')
            })
            assert.equal(res.status, 200)
            const icons = (await res.json()) as Record<string, string>
            assert.equal(
                icons['SP_RoleLabelI2'],
                'https://static.nanoka.cc/assets/ww/UIResources/Common/Atlas/RoleLabel/SP_RoleLabelI2.webp'
            )
        } finally {
            globalThis.fetch = realFetch
        }
    })

    it('rejects unknown entities', async () => {
        const res = await GET({
            params: { entity: 'nope' },
            url: new URL('http://localhost/api/v1/batch-icons/nope')
        })
        assert.equal(res.status, 400)
    })
})
