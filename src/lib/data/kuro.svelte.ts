import { browser } from '$app/environment'

/**
 * @desc 库街区（实验性）同步：应用侧只与本机简易代理服务器（默认 .tmp/kuro-server）通信，
 *  token 由服务器持有并落盘，浏览器侧只拿到「是否登录 / 是否有效 / 绑定角色」。
 *  - 服务器地址可在「设置 → 库街区」里改（默认 http://127.0.0.1:8791）
 *  - 所有调用失败都只返回错误信息，不抛异常，由 UI 决定如何提示
 */

const BASE_KEY = 'wuwa-afyg:kuro:base'
const ROLE_KEY = 'wuwa-afyg:kuro:role'
export const DEFAULT_KURO_BASE = 'http://127.0.0.1:8791'

/** @desc 绑定的游戏角色（鸣潮）：roleId/serverId 用于后续拉取角色与声骸数据 */
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
    phone: string
    account: KuroAccount | null
    roles: KuroRole[]
    savedAt: number
}

const EMPTY_SESSION: KuroSessionInfo = { loggedIn: false, phone: '', account: null, roles: [], savedAt: 0 }

let _base = $state(DEFAULT_KURO_BASE)
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

export const getKuroBase = () => _base
export const getKuroSession = () => _session
export const getKuroValid = () => _valid
export const getKuroReason = () => _reason
export const getKuroBusy = () => _busy
export const isKuroLoggedIn = () => _session.loggedIn

const normalizeBase = (url: string) => url.trim().replace(/\/+$/, '')

export function setKuroBase(url: string): void {
    _base = normalizeBase(url) || DEFAULT_KURO_BASE
    _valid = null
    _reason = null
    if (browser) localStorage.setItem(BASE_KEY, _base)
}

export function loadKuroPrefs(): void {
    if (!browser || _loaded) return
    _loaded = true
    const stored = localStorage.getItem(BASE_KEY)
    if (stored) _base = normalizeBase(stored)
    _roleId = localStorage.getItem(ROLE_KEY) ?? ''
}

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

interface CallOptions {
    method?: 'GET' | 'POST'
    body?: unknown
    /** @desc 毫秒；代理服务器不可用时不要卡住界面 */
    timeout?: number
}

/** @desc 调用本机代理；非 2xx 或 ok:false 一律抛出带后端 message 的 Error */
async function call<T extends Record<string, unknown>>(path: string, opts: CallOptions = {}): Promise<T> {
    const { method = 'GET', body, timeout = 20000 } = opts
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    try {
        const res = await fetch(`${_base}${path}`, {
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
            throw new Error(`代理返回了非 JSON 内容（HTTP ${res.status}）`)
        }
        if (!res.ok || json.ok === false) throw new Error(String(json.error ?? `HTTP ${res.status}`))
        return json as T
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw new Error('请求超时：代理服务器没响应')
        throw e instanceof Error ? e : new Error(String(e))
    } finally {
        clearTimeout(timer)
    }
}

/** @desc 探测代理服务器是否在跑（设置页显示用） */
export async function kuroPing(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
        const res = await call<{ version?: string }>('/health', { timeout: 4000 })
        return { ok: true, version: res.version }
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
}

/** @desc 发送短信验证码 */
export async function kuroSendSms(phone: string): Promise<void> {
    await call('/login/sms', { method: 'POST', body: { phone } })
}

/** @desc 验证码登录（成功后 token 留在服务器，本地只拿会话概览） */
export async function kuroVerifyLogin(phone: string, code: string): Promise<void> {
    const res = await call<{ session: KuroSessionInfo }>('/login/verify', { method: 'POST', body: { phone, code } })
    _session = res.session ?? EMPTY_SESSION
    _valid = true
    _reason = null
}

/**
 * @desc 刷新会话状态；check=true 时顺带调上游校验 token 是否仍有效（设置页「检验有效性」用）
 *  未登录时也返回 ok（valid=false, reason='未登录'）
 */
export async function refreshKuroSession(check = true): Promise<void> {
    _busy = true
    try {
        const res = await call<{ session: KuroSessionInfo; valid: boolean; reason?: string }>(
            check ? '/session?check=1' : '/session',
            { timeout: 25000 }
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

/** @desc 退出登录（清掉服务器上的 token） */
export async function kuroLogout(): Promise<void> {
    await call('/logout', { method: 'POST' })
    _session = EMPTY_SESSION
    _valid = false
    _reason = null
}

/** @desc 拉取某绑定角色的全部角色 + 当前装配声骸（原始数据，标签映射由前端做） */
export async function kuroFetchRoleEchoes(role: KuroRole): Promise<KuroRoleEchoes> {
    const q = new URLSearchParams({ serverId: role.serverId ?? '', userId: role.userId ?? '' })
    const res = await call<{ role?: KuroRole; characters?: KuroCharacterEchoes[] }>(
        `/roles/${encodeURIComponent(role.roleId)}/echoes?${q.toString()}`,
        { timeout: 60000 }
    )
    return { role: res.role ?? role, characters: res.characters ?? [] }
}

/** @desc 服务器返回的单个声骸（保持上游命名，未做标签归一） */
export interface KuroEcho {
    cost: number
    mainStatName: string
    mainStatValue: number
    substats: { name: string; value: number }[]
}

/** @desc 服务器返回的单角色数据 */
export interface KuroCharacterEchoes {
    id: string
    name: string
    level?: number
    chain?: number
    weapon?: string
    echoes: KuroEcho[]
}

export interface KuroRoleEchoes {
    role: KuroRole
    characters: KuroCharacterEchoes[]
}
