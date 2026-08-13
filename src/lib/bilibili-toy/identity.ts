// Bilibili Toy 身份透传：构造传给椰果工坊 iframe 的 hash（#toy=<encodeURIComponent(json)>）
// 非 Toy 环境（profile 为空）返回空字符串，工坊侧一切保持原样。
import type { ToyProfile } from './profile.svelte'

export const TOY_HASH_KEY = 'toy'

/** @desc toyOpenId 的 SHA-256 hex（Web Crypto；仅哈希上送工坊，不暴露明文） */
export async function sha256Hex(text: string): Promise<string> {
    if (!text) return ''
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** @desc 构造工坊 iframe 的 #toy hash；无身份返回空串（纯函数） */
export function buildToyIdentityHash(profile: ToyProfile | null | undefined): string {
    if (!profile?.nickname || !profile.toyOpenId) return ''
    const payload = {
        nickname: profile.nickname.slice(0, 30),
        avatar: profile.avatar,
        toyOpenId: profile.toyOpenId
    }
    return `#${TOY_HASH_KEY}=${encodeURIComponent(JSON.stringify(payload))}`
}

/** @desc 拼装工坊 iframe 完整 src：<base> + #toy hash；无身份时原样返回 base（界面不变） */
export function buildWorkshopFrameSrc(base: string, profile: ToyProfile | null | undefined): string {
    const hash = buildToyIdentityHash(profile)
    return hash ? base + hash : base
}
