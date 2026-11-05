// ── 独立静态包（STANDALONE=1）的数据通道 ─────────────────────────────────────
// `src/lib/api/local-api.ts` 把 `/api/**` 在浏览器里就地解析。这里锁住两件事：
//   1. 常规构建下 isOfflineBuild() === false（走真 fetch，行为与改造前一致）；
//   2. 离线解析的路由表与 `src/routes/api/**` 对齐：只读数据接口可解析，
//      必须服务端出网的接口（库街区 / AI 转发 / 工坊标题）必须**明确报不支持**，
//      绝不能悄悄返回一个空对象让上层当成「成功」。
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { ApiError, fetchApiJson, isOfflineBuild } from '$lib/api/local-api'

const setOffline = (value: boolean): void => {
    ;(globalThis as unknown as Record<string, unknown>).__OFFLINE_BUILD__ = value
}

let restore = false

before(() => {
    restore = (globalThis as unknown as Record<string, unknown>).__OFFLINE_BUILD__ === true
})

after(() => {
    setOffline(restore)
})

/** @desc 以「离线构建」运行一次，用完恢复，避免污染其它测试文件 */
const offlineCall = async (path: string): Promise<unknown> => {
    setOffline(true)
    try {
        return await fetchApiJson(path)
    } finally {
        setOffline(false)
    }
}

const catchOffline = async (path: string): Promise<unknown> => {
    try {
        await offlineCall(path)
        return null
    } catch (e) {
        return e
    }
}

describe('isOfflineBuild', () => {
    it('常规构建下为 false（有服务端，走同源 fetch）', () => {
        setOffline(false)
        assert.equal(isOfflineBuild(), false)
    })
})

describe('离线解析：必须服务端的接口一律明确拒绝', () => {
    const unsupported = [
        '/api/v1/workshop/title?url=https%3A%2F%2Fexample.com',
        '/api/ai/stream',
        '/api/ai/fetch',
        '/api/kuro-app/session',
        '/api/kuro-app/echoes?roleId=1'
    ]
    for (const path of unsupported) {
        it(`拒绝 ${path}`, async () => {
            const err = await catchOffline(path)
            assert.ok(err instanceof ApiError, `应抛 ApiError，实际 ${String(err)}`)
            assert.equal(err.status, 404)
            assert.match(err.message, /静态版不支持该接口/)
        })
    }
})

describe('离线解析：路由表对齐 src/routes/api', () => {
    it('未知实体是 400（不是 404，也不打网络）', async () => {
        const err = await catchOffline('/api/v1/list/nope')
        assert.ok(err instanceof ApiError)
        assert.equal(err.status, 400)
    })

    it('batch-icons 未知实体是 400', async () => {
        const err = await catchOffline('/api/v1/batch-icons/nope')
        assert.ok(err instanceof ApiError)
        assert.equal(err.status, 400)
    })

    it('非 api 路径直接拒绝', async () => {
        const err = await catchOffline('/not-api/x')
        assert.ok(err instanceof ApiError)
        assert.equal(err.status, 404)
    })
})
