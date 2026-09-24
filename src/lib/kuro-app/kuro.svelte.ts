import { browser } from '$app/environment'

/**
 * @desc 库街区（实验性）同步：前端只调用应用自身的服务端路由 `/api/kuro-app/*`，
 *  由服务端去请求库街区 APP 端接口（避免浏览器直连的 CORS 问题），token 存 httpOnly cookie、不下发浏览器。
 *  所有调用失败只返回错误信息，不抛异常，由 UI 决定如何提示。
 */

const ROLE_KEY = 'wuwa-afyg:kuro:role'

/** @desc 绑定的游戏角色（鸣潮）：roleId/serverId 用于拉取角色与声骸数据 */
export interface KuroRole {
    roleId: string
    serverId: string
    serverName?: string
    nickname?: string
    level?: number
    userId?: string
}

export interface KuroAccount {
    userId?: string
    userName?: string
    phone?: string
}

export interface KuroSessionInfo {
    loggedIn: boolean
    account: KuroAccount | null
    roles: KuroRole[]
    savedAt: number
}

const EMPTY_SESSION: KuroSessionInfo = { loggedIn: false, account: null, roles: [], savedAt: 0 }

let _session = $state<KuroSessionInfo>(EMPTY_SESSION)
/** @desc 有效性校验结果：null=还没校验过，true/false=最近一次校验结论 */
let _valid = $state<boolean | null>(null)
let _reason = $state<string | null>(null)
let _busy = $state(false)
let _loaded = false
/** @desc 登录窗口开关（全局单例：设置页、词条集同步、AI/WS 工具共用一套入口） */
let _loginOpen = $state(false)
/** @desc 选用的绑定角色 roleId（持久化） */
let _roleId = $state('')

export const getKuroLoginOpen = () => _loginOpen
export const setKuroLoginOpen = (open: boolean) => {
    _loginOpen = open
}

export const getKuroSession = () => _session
export const getKuroValid = () => _valid
export const getKuroReason = () => _reason
export const getKuroBusy = () => _busy
export const isKuroLoggedIn = () => _session.loggedIn

/** @desc 当前选用的绑定角色：优先用户选定，未选/已失效时回落到第一个 */
export function getKuroActiveRole(): KuroRole | null {
    const roles = _session.roles
    if (roles.length === 0) return null
    return roles.find((r) => r.roleId === _roleId) ?? roles[0]
}

export function getKuroRoleId(): string {
    return _roleId
}

export function setKuroRoleId(roleId: string): void {
    _roleId = roleId
    if (browser) localStorage.setItem(ROLE_KEY, roleId)
}

/** @desc 读取本地偏好（选用的绑定角色）；库街区无需配置服务器地址——走应用自身的服务端路由 */
export function loadKuroPrefs(): void {
    if (!browser || _loaded) return
    _loaded = true
    _roleId = localStorage.getItem(ROLE_KEY) ?? ''
}

interface CallOptions {
    method?: 'GET' | 'POST'
    body?: unknown
    /** @desc 毫秒：上游较慢时不要一直转圈 */
    timeout?: number
}

/** @desc 调用应用自身的库街区服务端路由；非 2xx 或 ok:false 一律抛出带后端 message 的 Error */
async function call<T extends Record<string, unknown>>(path: string, opts: CallOptions = {}): Promise<T> {
    const { method = 'GET', body, timeout = 60000 } = opts
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    try {
        const res = await fetch(`/api/kuro-app${path}`, {
            method,
            ...(body === undefined
                ? {}
                : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
            signal: ctrl.signal
        })
        const text = await res.text()
        let json: Record<string, unknown> = {}
        try {
            json = text ? JSON.parse(text) : {}
        } catch {
            throw new Error(`服务端返回了非 JSON 内容（HTTP ${res.status}）`)
        }
        if (!res.ok || json.ok === false) throw new Error(String(json.error ?? `HTTP ${res.status}`))
        return json as T
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw new Error('请求超时：库街区接口响应过慢')
        throw e instanceof Error ? e : new Error(String(e))
    } finally {
        clearTimeout(timer)
    }
}

/** @desc 发送短信验证码 */
export async function kuroSendSms(phone: string): Promise<void> {
    await call('/login/sms', { method: 'POST', body: { phone }, timeout: 25000 })
}

/** @desc 验证码登录（成功后 token 由服务端写进 httpOnly cookie，前端只拿会话概览） */
export async function kuroVerifyLogin(phone: string, code: string): Promise<void> {
    const res = await call<{ session: KuroSessionInfo }>('/login/verify', {
        method: 'POST',
        body: { phone, code },
        timeout: 25000
    })
    _session = res.session ?? EMPTY_SESSION
    _valid = true
    _reason = null
}

/**
 * @desc 刷新会话状态；check=true 时顺带让服务端校验 token 是否仍有效（设置页「检验有效性」用）。
 *  未登录时也返回 ok（valid=false, reason='未登录'）
 */
export async function refreshKuroSession(check = true): Promise<void> {
    _busy = true
    try {
        const res = await call<{ session: KuroSessionInfo; valid: boolean; reason?: string }>(
            check ? '/session?check=1' : '/session',
            { timeout: 30000 }
        )
        _session = res.session ?? EMPTY_SESSION
        _valid = res.valid ?? false
        _reason = res.reason ?? null
    } catch (e) {
        _reason = e instanceof Error ? e.message : String(e)
        _valid = false
    } finally {
        _busy = false
    }
}

/** @desc 退出登录（服务端清掉 cookie 里的 token） */
export async function kuroLogout(): Promise<void> {
    await call('/logout', { method: 'POST' })
    _session = EMPTY_SESSION
    _valid = false
    _reason = null
}

/** @desc 拉取某绑定角色的全部角色 + 当前装配声骸（原始数据，标签映射由前端做） */
export async function kuroFetchRoleEchoes(role: KuroRole): Promise<KuroRoleEchoes> {
    const q = new URLSearchParams({ roleId: role.roleId, serverId: role.serverId ?? '' })
    const res = await call<{ characters?: KuroCharacterEchoes[] }>(`/echoes?${q.toString()}`, { timeout: 120000 })
    return { role, characters: res.characters ?? [] }
}

/** @desc 服务端返回的单个声骸（保持上游命名，未做标签归一） */
export interface KuroEcho {
    cost: number
    name?: string
    mainStatName: string
    mainStatValue: number
    substats: { name: string; value: number }[]
}

/** @desc 服务端返回的单角色数据 */
export interface KuroCharacterEchoes {
    id: string
    name: string
    level?: number
    chain?: number
    weapon?: string
    echoes: KuroEcho[]
    /** @desc 该角色详情拉取失败时的原因（整体同步不受影响） */
    error?: string
}

export interface KuroRoleEchoes {
    role: KuroRole
    characters: KuroCharacterEchoes[]
}
