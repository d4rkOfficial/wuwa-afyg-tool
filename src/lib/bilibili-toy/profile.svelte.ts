import { browser } from '$app/environment'

/**
 * @desc Bilibili Toy 宿主桥：父页（Toy 壳）通过 postMessage 传入的 B 站用户资料。
 *   仅用于 sidebar 头像/昵称展示与工坊署名透传，纯展示数据，非鉴权来源。
 */

export interface ToyProfile {
    avatar: string
    nickname: string
    toyOpenId?: string
}

const profile = $state<{ data: ToyProfile | null }>({ data: null })

export function getToyProfile() {
    return profile
}

function isTrustedOrigin(origin: string): boolean {
    if (!origin) return false
    if (origin === 'http://localhost' || /^http:\/\/localhost:\d+$/.test(origin)) return true
    // Toy 壳页真实域为 www.bilibilitoy.com（B站 Toy 独立内容域），同认 bilibili.com
    return /^https:\/\/([\w-]+\.)*(bilibili|bilibilitoy)\.com$/.test(origin)
}

/** 监听宿主页 postMessage 的 toy-profile 消息；无宿主时静默无操作 */
export function initToyProfileBridge() {
    if (!browser) return
    window.addEventListener('message', (e) => {
        const msg = e.data as { type?: string; profile?: ToyProfile } | null
        // 非可信域直接忽略（不发日志）；可信域内非 toy-profile 消息（如 toy-environment）静默，避免误报
        if (!isTrustedOrigin(e.origin)) return
        if (!msg || msg.type !== 'toy-profile') return
        const incoming = msg.profile
        if (incoming) {
            // 头像 URL 规范化：SDK 可能返回协议相对（//i0.hdslb.com/...），
            // 统一转 https://，否则 http 页面（localhost dev）加载失败，
            // 且透传给工坊时会被其 https:// 校验拒绝
            incoming.avatar = incoming.avatar.replace(/^\/\//, 'https:')
        }
        profile.data = incoming ?? null
    })
}
