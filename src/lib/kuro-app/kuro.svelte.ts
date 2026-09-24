import { browser } from '$app/environment'

/**
 * @desc 库街区（实验性）同步：前端只调用应用自身的服务端路由 `/api/kuro-app/*`，
 *  由服务端去请求库街区 APP 端接口（避免浏览器直连的 CORS 问题），token 存 httpOnly cookie、不下发浏览器。
 *  所有调用失败只返回错误信息，不抛异常，由 UI 决定如何提示。
 */

const ROLE_KEY = 'wuwa-afyg:kuro:role'
/** @desc 本地登录标记：只有它存在时，启动才去问服务端要会话（未登录过的用户零请求） */
const LOGGED_KEY = 'wuwa-afyg:kuro:logged'
/** @desc 开机签到日期（YYYY-MM-DD）：同一天只自动签一次 */
const SIGNED_KEY = 'wuwa-afyg:kuro:signed-on'

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
/** @desc 选用的绑定角色 roleId（持久化） */
let _roleId = $state('')
/** @desc 请求「打开设置并跳到连接配置」的标记：登录已内联在设置里，不再有独立登录窗口 */
let _settingsRequest = $state(false)

export const getKuroSettingsRequest = () => _settingsRequest
export const requestKuroSettings = () => {
    _settingsRequest = true
}
export const consumeKuroSettingsRequest = () => {
    _settingsRequest = false
}

/** @desc 等待登录结果的回调集合：登录成功 → true；超时 → false */
const loginWaiters = new Set<(ok: boolean) => void>()
const settleLoginWaiters = (ok: boolean) => {
    for (const resolve of [...loginWaiters]) resolve(ok)
    loginWaiters.clear()
}

/**
 * @desc 等待库街区登录完成（「从库街区同步」这类流程用）：已登录立即返回 true；
 *  否则等用户在设置里登录成功（true）或超时（false）。
 */
export function waitForKuroLogin(timeoutMs = 10 * 60 * 1000): Promise<boolean> {
    if (_session.loggedIn) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
        const done = (ok: boolean) => {
            clearTimeout(timer)
            loginWaiters.delete(done)
            resolve(ok)
        }
        const timer = setTimeout(() => done(false), timeoutMs)
        loginWaiters.add(done)
    })
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

/** @desc 维护本地登录标记（登录成功/退出/会话失效时更新） */
const setLoggedMark = (on: boolean): void => {
    if (!browser) return
    if (on) localStorage.setItem(LOGGED_KEY, '1')
    else localStorage.removeItem(LOGGED_KEY)
}

/**
 * @desc 打开工具箱时自动恢复库街区登录态：只有本地存过登录标记才去问服务端
 *  （token 在 httpOnly cookie 里前端读不到，只能让服务端按 cookie 回话）。
 *  顺带静默校验一次（不弹任何窗口）：已失效则由服务端清 cookie，本地标记也跟着清掉。
 */
export async function restoreKuroSession(): Promise<void> {
    if (!browser) return
    if (localStorage.getItem(LOGGED_KEY) !== '1') return
    await refreshKuroSession(true)
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

/** @desc 上游要求先过极验：由调用方弹极验、拿到验证数据后带 geeTestData 重发 */
export class KuroGeetestRequiredError extends Error {
    captchaId: string
    product: string
    constructor(captchaId: string, product: string) {
        super('需要完成人机验证')
        this.name = 'KuroGeetestRequiredError'
        this.captchaId = captchaId
        this.product = product
    }
}

/** @desc 发送短信验证码；geeTestData 为极验校验数据 JSON 字符串（可选） */
export async function kuroSendSms(phone: string, geeTestData?: string): Promise<void> {
    const res = await call<{ geetest?: { required?: boolean; captchaId?: string; product?: string } }>('/login/sms', {
        method: 'POST',
        body: { phone, geeTestData },
        timeout: 30000
    })
    if (res.geetest?.required) {
        throw new KuroGeetestRequiredError(res.geetest.captchaId ?? '', res.geetest.product ?? 'bind')
    }
}

/** @desc 验证码登录（成功后 token 由服务端写进 httpOnly cookie，前端只拿会话概览）；服务端会顺手做鸣潮签到 */
export async function kuroVerifyLogin(phone: string, code: string): Promise<{ signIn: KuroSignInResult[] }> {
    const res = await call<{ session: KuroSessionInfo; signIn?: KuroSignInResult[] }>('/login/verify', {
        method: 'POST',
        body: { phone, code },
        timeout: 40000
    })
    _session = res.session ?? EMPTY_SESSION
    _valid = true
    _reason = null
    setLoggedMark(true)
    settleLoginWaiters(true)
    return { signIn: res.signIn ?? [] }
}

/** @desc 鸣潮每日签到的单角色结果 */
export interface KuroSignInResult {
    roleId: string
    status: 'signed' | 'already' | 'failed'
    message: string
}

/** @desc 鸣潮每日签到（服务端给每个绑定角色各签一次） */
export async function kuroSignIn(): Promise<KuroSignInResult[]> {
    const res = await call<{ results?: KuroSignInResult[] }>('/signin', { method: 'POST', timeout: 60000 })
    return res.results ?? []
}

/** @desc 签到结果 → 一句人话（登录窗口/开机提示共用） */
export function formatKuroSignIn(results: KuroSignInResult[]): string {
    if (results.length === 0) return ''
    const signed = results.filter((r) => r.status === 'signed').length
    const already = results.filter((r) => r.status === 'already').length
    const failed = results.filter((r) => r.status === 'failed')
    if (failed.length > 0) {
        return `鸣潮签到：成功 ${signed} 个、已签到 ${already} 个、失败 ${failed.length} 个（${failed[0].message}）`
    }
    if (signed > 0) return `鸣潮签到完成（${signed} 个角色）`
    return '鸣潮签到：今天已经签过了'
}

/**
 * @desc 开机自动签到：同一天只尝试一次（本地记日期），会话失效或当天签过就直接跳过。
 *  返回可读提示（没有动作时返回 null），由 UI 决定是否弹 toast。
 */
export async function signInWavesDaily(): Promise<string | null> {
    if (!browser || !_session.loggedIn) return null
    const today = new Date().toLocaleDateString('sv-SE')
    if (localStorage.getItem(SIGNED_KEY) === today) return null
    try {
        const results = await kuroSignIn()
        localStorage.setItem(SIGNED_KEY, today)
        return formatKuroSignIn(results) || null
    } catch (e) {
        return `鸣潮签到失败：${e instanceof Error ? e.message : String(e)}`
    }
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
        setLoggedMark(_session.loggedIn && _valid !== false)
        // cookie 里其实还有登录态（store 之前是空的）时，等待中的流程也能直接继续
        if (_session.loggedIn) settleLoginWaiters(true)
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
    setLoggedMark(false)
    if (browser) localStorage.removeItem(SIGNED_KEY)
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
