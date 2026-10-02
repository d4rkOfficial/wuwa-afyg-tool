// 抓取代理路由级回归（**不联网、不出网**）：
// `$app/environment` 的测试 mock 把 `dev` 固定为 false，所以这里跑的是**生产分支** ——
// 正好用来钉住「web_fetch 不能借服务端代理去探内网 / 拿明文 http / 被畸形入参骗过去」。
// 每次调用都在 `fetch` 之前就被拦下，因此本文件不需要网络，也不会真的连任何地址。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { POST } from '../+server'

/** @desc 直接调用路由的 POST（SvelteKit 的 event 只需要 request） */
const call = async (body: unknown): Promise<{ status: number; body: { ok?: boolean; error?: string } }> => {
    const request = new Request('http://localhost/api/ai/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body)
    })
    const res = await POST({ request })
    return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string } }
}

describe('web_fetch 代理：生产分支的拦截与入参校验', () => {
    it('请求体不是合法 JSON → 400', async () => {
        const res = await call('{ 不是 json')
        assert.equal(res.status, 400)
        assert.match(res.body.error ?? '', /JSON/)
        assert.equal(res.body.ok, false)
    })

    it('缺 url / 空 url / 非 http(s) 协议 → 400，且给出可读原因', async () => {
        for (const [body, expected] of [
            [{}, /url/],
            [{ url: '   ' }, /url/],
            [{ url: 'ftp://a.test/x' }, /http/],
            [{ url: 'javascript:alert(1)' }, /http/]
        ] as const) {
            const res = await call(body)
            assert.equal(res.status, 400)
            assert.equal(res.body.ok, false)
            assert.match(res.body.error ?? '', expected)
        }
    })

    it('明文 http 目标在生产分支被拒（与 AI 端点代理同样只走 https）', async () => {
        const res = await call({ url: 'http://example.com/doc' })
        assert.equal(res.status, 400)
        assert.match(res.body.error ?? '', /https/)
    })

    it('内网 / 回环 / 云元数据地址一律被拦（防 SSRF，且**在出网之前**）', async () => {
        for (const [url, expected] of [
            ['http://127.0.0.1:8080/secret', /https/],
            ['https://127.0.0.1/secret', /内网|回环|保留/],
            ['https://localhost/secret', /回环/],
            ['https://10.0.0.5/admin', /内网|回环|保留/],
            ['https://192.168.1.1/router', /内网|回环|保留/],
            ['https://169.254.169.254/latest/meta-data/', /内网|回环|保留/],
            ['https://[::1]/secret', /内网|回环|保留/]
        ] as const) {
            const res = await call({ url })
            assert.equal(res.status, 400, `${url} 应当被拦截`)
            assert.match(res.body.error ?? '', expected)
            assert.equal(res.body.ok, false)
        }
    })
})
