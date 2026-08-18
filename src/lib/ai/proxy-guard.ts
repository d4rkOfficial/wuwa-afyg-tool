// 转发代理的防 SSRF 校验（纯函数 + DNS 解析）：放行任意 https 公网地址，
// 拦截内网/回环/保留地址，避免部署在公网时被当作开放代理扫描私网或云元数据。
import { lookup } from 'node:dns/promises'

export const MAX_REDIRECTS = 5

/** 私有/回环/保留 IPv4 网段（含链路本地、CGNAT、TEST-NET、组播、未来保留） */
const PRIVATE_V4_SEGMENTS: [base: string, prefix: number][] = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
]

function ipv4ToInt(ip: string): number {
    return ip.split('.').reduce((acc, oct) => ((acc << 8) + Number.parseInt(oct, 10)) >>> 0, 0)
}

function isPrivateV4(ip: string): boolean {
    const n = ipv4ToInt(ip)
    return PRIVATE_V4_SEGMENTS.some(([base, prefix]) => {
        const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
        return (n & mask) === (ipv4ToInt(base) & mask)
    })
}

function isPrivateV6(ip: string): boolean {
    const lower = ip.toLowerCase().split('%')[0]
    if (lower === '::' || lower === '::1') return true
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7 唯一本地
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb'))
        return true // fe80::/10 链路本地
    if (lower.startsWith('ff')) return true // 组播
    if (lower.startsWith('::ffff:')) return isPrivateV4(lower.slice(7)) // IPv4 映射地址
    return false
}

/** 命中内网/回环/保留地址即返回 true（IP 可能带 %zone 接口后缀） */
export function isBlockedAddress(ip: string): boolean {
    const stripped = ip.split('%')[0]
    return stripped.includes(':') ? isPrivateV6(stripped) : isPrivateV4(stripped)
}

/** 校验目标地址：非 https 或解析到内网/保留地址时返回错误文案，否则返回 null（null 表示放行） */
export async function assertPublicHttps(u: URL): Promise<string | null> {
    if (u.protocol !== 'https:') return '仅支持 https 服务地址（本地服务请填 http://localhost:端口 由浏览器直连）'
    const host = u.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1')
        return '不允许代理到本机回环地址（本地服务请填 localhost 由浏览器直连）'
    let addrs: Array<{ address: string; family: number }>
    try {
        addrs = await lookup(host, { all: true })
    } catch {
        return '无法解析服务地址（DNS 失败）'
    }
    if (addrs.length === 0) return '无法解析服务地址（无解析结果）'
    for (const a of addrs) {
        if (isBlockedAddress(a.address)) return '服务地址解析到内网/保留地址，已拦截（防 SSRF）'
    }
    return null
}
