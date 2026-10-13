// WS 远程接管连接偏好（持久化到 localStorage）：连接开关 + 服务地址。
//
// 与 hash `#websocket=` 的关系：hash 是**临时**指定（当次访问有效，移除即断开），
// 这里是**持久**意图（开启后刷新/重进仍按该地址自动连接）。两者同时存在时 hash 优先，
// 由宿主 `+layout.svelte` 决定（见 `autoConnectWs`）。
import { browser } from '$app/environment'

const ENABLED_KEY = 'wuwa-afyg:ws-prefs:enabled'
const URL_KEY = 'wuwa-afyg:ws-prefs:url'

/** @desc 是否启用 WS 远程接管（默认关闭：带 hash 访问仍是「当次授权」，不写偏好） */
let _enabled = $state(false)
/** @desc 保存的服务地址（原样保存用户输入，`host:port` 或完整 ws(s):// 地址） */
let _url = $state('')

if (browser) {
    try {
        const saved = localStorage.getItem(ENABLED_KEY)
        if (saved === '0' || saved === '1') _enabled = saved === '1'
    } catch {
        /* ignore */
    }
    try {
        const saved = localStorage.getItem(URL_KEY)
        if (saved !== null) _url = saved.trim()
    } catch {
        /* ignore */
    }
}

/** @desc 连接开关（设置-连接配置） */
export function getWsEnabled(): boolean {
    return _enabled
}

export function setWsEnabled(v: boolean): void {
    _enabled = v
    if (browser) localStorage.setItem(ENABLED_KEY, v ? '1' : '0')
}

/**
 * @desc 保存的 WS 服务地址。
 * **不做合法性校验**：输入框允许停在半成品（未点「应用」不落盘，见设置面板的草稿）。
 */
export function getWsServerUrl(): string {
    return _url
}

export function setWsServerUrl(v: string): void {
    _url = v.trim()
    if (browser) localStorage.setItem(URL_KEY, _url)
}
