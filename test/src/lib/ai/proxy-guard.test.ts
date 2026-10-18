// 防 SSRF 校验单测：覆盖 IP 网段判定与 URL 校验（IP 字面量无需网络即可解析）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBlockedAddress, assertFetchTarget, assertPublicHttps, isLoopbackHost } from '$lib/ai/proxy-guard'

const cases: [ip: string, blocked: boolean][] = [
    // 回环/内网/保留：应拦截
    ['127.0.0.1', true],
    ['10.0.0.1', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.1.100', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['192.0.2.1', true],
    ['198.51.100.1', true],
    ['203.0.113.1', true],
    ['224.0.0.1', true],
    ['240.0.0.1', true],
    ['0.0.0.0', true],
    ['::1', true],
    ['fe80::1', true],
    ['fc00::1', true],
    ['fd12:3456::1', true],
    ['ff02::1', true],
    ['::ffff:10.0.0.1', true],
    ['::ffff:192.168.1.1', true],
    // 公网：应放行
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['114.114.114.114', false],
    ['2001:4860:4860::8888', false],
    ['2606:4700:4700::1111', false],
    ['::ffff:8.8.8.8', false]
]

for (const [ip, blocked] of cases) {
    test(`isBlockedAddress(${ip}) = ${blocked}`, () => {
        assert.equal(isBlockedAddress(ip), blocked)
    })
}

test('非 https 地址被拒绝', async () => {
    const msg = await assertPublicHttps(new URL('http://api.example.com'))
    assert.ok(msg?.includes('https'))
})

test('回环地址被拒绝（无需网络）', async () => {
    const msg = await assertPublicHttps(new URL('https://127.0.0.1'))
    assert.ok(msg?.includes('回环'))
})

test('私网 IP 字面量被拒绝（无需网络）', async () => {
    const msg = await assertPublicHttps(new URL('https://192.168.1.5'))
    assert.ok(msg?.includes('内网'))
})

test('公网 IP 字面量放行（无需网络）', async () => {
    const msg = await assertPublicHttps(new URL('https://8.8.8.8'))
    assert.equal(msg, null)
})

test('isLoopbackHost：localhost / 127.0.0.0/8 / ::1 以及带点/方括号写法', () => {
    for (const host of ['localhost', 'LOCALHOST', 'localhost.', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) {
        assert.equal(isLoopbackHost(host), true, `${host} 应视为回环`)
    }
    for (const host of ['10.0.0.1', '192.168.1.1', 'localhost.evil', '127.0.0.1.example.com', '::2']) {
        assert.equal(isLoopbackHost(host), false, `${host} 不应视为回环`)
    }
})

test('assertFetchTarget：本机地址（含明文 http）放行，其余仍按 https 公网校验', async () => {
    for (const url of ['http://localhost:3000/doc', 'http://127.0.0.1:8080/doc', 'https://[::1]/doc']) {
        assert.equal(await assertFetchTarget(new URL(url)), null, `${url} 应放行`)
    }
    // 非回环的明文 http 仍拒绝
    assert.match((await assertFetchTarget(new URL('http://api.example.com'))) ?? '', /https/)
    // 私网/元数据地址仍拒绝
    assert.match((await assertFetchTarget(new URL('https://192.168.1.5'))) ?? '', /内网|保留/)
    assert.match((await assertFetchTarget(new URL('https://169.254.169.254/'))) ?? '', /内网|保留/)
})
