/**
 * 库街区上游调用（服务端专用）：只能被 src/routes/api/kuro-app/ 下的 +server.ts 引用。
 *
 * 接口依据：
 *  - TomyJan/Kuro-API-Collection（登录/校验/绑定角色）
 *  - eventhorizonsky/WuwaWebTool（角色装配声骸：akiBox/roleData + akiBox/getRoleDetail）
 * 详见各函数注释；token 由路由层放在 httpOnly cookie 里，本模块不关心存储。
 */

const BASE = 'https://api.kurobbs.com'

/** @desc 旧 APP 端固定 devCode（文档值） */
const DEV_CODE_OLD = '2fba3859fe9bfe9099f2696b8648c2c6'
const DEV_CODE_SMS = '073A9EFAC18FC50616DD15808DAE719DBCB904B7'
/** @desc akiBox 系列用的 iOS UA（与参考实现一致，库街区 App 社区端） */
const AKI_USER_AGENT =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)  KuroGameBox/3.0.3'
/** @desc 渠道号与服务器区域：countryCode 逐个试（隍陇=1 / 黑海岸=900 / 黎那汐塔=3） */
const CHANNEL_ID = process.env.KURO_CHANNEL_ID || '19'
const COUNTRY_CODES = (process.env.KURO_COUNTRY_CODES || '1,3,900')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const distinctId = () => globalThis.crypto.randomUUID()
const randomDevCode = () => globalThis.crypto.randomUUID().replace(/-/g, '').toUpperCase()

/** @desc 旧 APP 端公共头；findRoleList / gamer/role/list 不要带 distinct_id（文档明确） */
const oldHeaders = (token: string | null, { sms = false, withDistinct = true } = {}): Record<string, string> => ({
    osversion: 'Android',
    countrycode: 'CN',
    ip: '10.0.2.233',
    model: '2211133C',
    source: 'android',
    lang: 'zh-Hans',
    version: '1.0.9',
    versioncode: '1090',
    'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    'accept-encoding': 'gzip',
    'user-agent': sms ? 'okhttp/3.11.0' : 'okhttp/3.10.0',
    devCode: sms ? DEV_CODE_SMS : DEV_CODE_OLD,
    ...(withDistinct ? { distinct_id: distinctId() } : {}),
    ...(token ? { token } : {})
})

/**
 * @desc akiBox 数据接口的 devCode：参考实现是 `"{公网IP}, {IOS UA}"`（IP 走 event.kurobbs.com/event/ip），
 *  取不到时退化为随机串。IP 在进程内缓存（Serverless 复用实例时省一次请求）。
 */
let publicIpCache = ''
async function akiDevCode(): Promise<string> {
    if (!publicIpCache) {
        try {
            const res = await fetch('https://event.kurobbs.com/event/ip', {
                signal: AbortSignal.timeout(4000)
            })
            const text = (await res.text()).trim()
            publicIpCache = /^[0-9a-fA-F.:]+$/.test(text) ? text : ''
        } catch {
            publicIpCache = ''
        }
    }
    return publicIpCache ? `${publicIpCache}, ${AKI_USER_AGENT}` : randomDevCode()
}

/**
 * @desc akiBox「取数据」系列接口请求头：source/UA/devCode + `did`（设备号）+ `b-at`（数据令牌）。
 *  **不能带 `token`**：参考实现明确注明 token 会导致上游返回「参数错误」（未解析出参数时的误报），
 *  这也是本项目此前报「取角色列表失败，参数错误」的原因。
 */
const akiDataHeaders = async (did: string, bat: string): Promise<Record<string, string>> => ({
    source: 'ios',
    did,
    'b-at': bat,
    devCode: await akiDevCode(),
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'user-agent': AKI_USER_AGENT
})

interface UpstreamEnvelope {
    code?: number
    msg?: string
    success?: boolean
    /** @desc 新版 akiBox 的 data 是「字符串化 JSON」 */
    data?: unknown
    traceId?: string
}

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded; charset=utf-8'

const post = async (
    path: string,
    headers: Record<string, string>,
    body: Record<string, string | number>
): Promise<UpstreamEnvelope> => {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        // ⚠️ 必须显式给表单 Content-Type：fetch 对字符串 body 默认发 text/plain，
        // 上游会因此解析不到参数（表现为「服务器id不能为空」这类误报）
        headers: { 'content-type': FORM_CONTENT_TYPE, ...headers },
        body: new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString()
    })
    const text = await res.text()
    try {
        return JSON.parse(text) as UpstreamEnvelope
    } catch {
        throw new Error(`${path} 返回了非 JSON 内容（HTTP ${res.status}）`)
    }
}

/** @desc 统一上游错误整理：220 = token 失效 */
const upstreamError = (json: UpstreamEnvelope, fallback = '上游返回异常'): Error => {
    const code = Number(json?.code)
    if (code === 220) return new Error('库街区登录已过期（code 220），请重新登录')
    if (code === 10903) return new Error('数据令牌已失效（code 10903），请重新登录后再同步')
    if (code === 242) return new Error('验证码发送过于频繁（code 242），请稍后再试')
    if (code === -130) return new Error('验证码错误或已过期（code -130）')
    if (code === 6001) return new Error('暂无数据：请先在库街区绑定鸣潮角色（code 6001）')
    return new Error(`${fallback}：code=${json?.code ?? '?'} ${json?.msg ?? ''}`.trim())
}

/** @desc 解析 akiBox 的 data（字符串化 JSON 时二次 parse） */
const parseData = <T>(json: UpstreamEnvelope): T | undefined => {
    const raw = json?.data
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw) as T
        } catch {
            return undefined
        }
    }
    return raw as T | undefined
}

/**
 * @desc 从 akiBox 返回里挖出角色数组：data 可能是字符串化 JSON、数组本身，或再套一层
 *  （参考实现前端同样兼容 `data.roleList` / `data.list` / `data` 是数组三种形态）。
 */
const pickRoleList = (value: unknown, depth = 0): UpstreamOwnedRole[] => {
    if (depth > 3 || value == null) return []
    if (Array.isArray(value)) return value as UpstreamOwnedRole[]
    if (typeof value === 'string') {
        try {
            return pickRoleList(JSON.parse(value), depth + 1)
        } catch {
            return []
        }
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        for (const key of ['roleList', 'list', 'data']) {
            const found = pickRoleList(record[key], depth + 1)
            if (found.length > 0) return found
        }
    }
    return []
}

/** @desc data 的短预览，用于把「空列表」这类可疑响应带回给用户/日志 */
const previewData = (json: UpstreamEnvelope): string => {
    const raw = typeof json?.data === 'string' ? json.data : JSON.stringify(json?.data ?? null)
    return (raw ?? 'null').slice(0, 200)
}

const parseNum = (v: unknown): number => {
    const n = parseFloat(String(v ?? '').replace(/[%％]/g, ''))
    return Number.isFinite(n) ? n : 0
}

/** @desc 带并发上限的遍历（对上游礼貌一点，避免风控） */
const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> => {
    const out: R[] = new Array(items.length)
    let cursor = 0
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (cursor < items.length) {
            const i = cursor++
            out[i] = await fn(items[i], i)
        }
    })
    await Promise.all(workers)
    return out
}

export interface KuroRole {
    roleId: string
    serverId: string
    serverName?: string
    nickname?: string
    level?: number
    userId?: string
    phantomPercent?: number
}

export interface KuroEcho {
    cost: number
    /** @desc 声骸名（前端方案不用，便于排查/展示） */
    name: string
    mainStatName: string
    mainStatValue: number
    substats: { name: string; value: number }[]
}

export interface KuroCharacterEchoes {
    id: string
    name: string
    level?: number
    chain?: number
    weapon?: string
    echoes: KuroEcho[]
    error?: string
}

/** @desc 极验（geetest v4）参数：与库街区 H5 端一致；可用环境变量覆盖 */
export const KURO_GEETEST = {
    captchaId: process.env.KURO_GEETEST_CAPTCHA_ID || 'ec4aa4174277d822d73f2442a165a2cd',
    product: process.env.KURO_GEETEST_PRODUCT || 'bind'
} as const

/** @desc H5/社区端请求头（发验证码用，与极验 captchaId 配套；UA 与参考实现一致） */
const H5_USER_AGENT =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)  KuroGameBox/3.0.3'
const randomDevCode32 = () => globalThis.crypto.randomUUID().replace(/-/g, '')
const h5Headers = (): Record<string, string> => ({
    source: 'h5',
    version: '3.0.3',
    'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    'user-agent': H5_USER_AGENT,
    devCode: randomDevCode32()
})

export interface SmsSendResult {
    /** @desc true = 上游要求先过极验（此时短信并未真正发出） */
    geetestRequired: boolean
}

/**
 * @desc 发送短信验证码（H5 端接口 /user/getSmsCodeForH5，与极验 captchaId 配套）。
 *  geeTestData = 极验数据 JSON **字符串**（含 captcha_id / lot_number / pass_token / gen_time / captcha_output）：
 *  参考实现就是把 captcha.getValidate() 的结果补上 captcha_id 后 JSON.stringify 直接作为表单字段。
 *  不带它时上游若要求极验，会以 data.geeTest === true 告知（code 仍是 200，但短信没发出去）。
 */
export async function sendSmsCode(phone: string, geeTestData?: string): Promise<SmsSendResult> {
    const body: Record<string, string> = { mobile: phone }
    if (geeTestData) body.geeTestData = geeTestData
    const json = await post('/user/getSmsCodeForH5', h5Headers(), body)
    if ((json?.data as { geeTest?: boolean } | undefined)?.geeTest === true) return { geetestRequired: true }
    const code = Number(json?.code)
    if (code === 0 || code === 200) return { geetestRequired: false }
    throw upstreamError(json, '发送验证码失败')
}

interface LoginData {
    token?: string
    userId?: number | string
    userName?: string
}

/** @desc 验证码登录：返回 token 与账号信息（token 由路由层放进 httpOnly cookie） */
export async function loginBySms(
    phone: string,
    code: string
): Promise<{ token: string; userId: string; userName: string; phone: string }> {
    const json = await post('/user/sdkLogin', oldHeaders(null), {
        code,
        devCode: DEV_CODE_OLD,
        gameList: '',
        mobile: phone
    })
    const data = (json?.data ?? {}) as LoginData
    if (Number(json?.code) !== 200 || !data.token) throw upstreamError(json, '登录失败')
    return {
        token: String(data.token),
        userId: data.userId != null ? String(data.userId) : '',
        userName: data.userName ?? '',
        phone
    }
}

/** @desc 校验 token 是否有效（文档推荐 findRoleList：220 = 失效，且 220 时没有 success 字段） */
export async function checkToken(token: string): Promise<boolean> {
    const json = await post('/user/role/findRoleList', oldHeaders(token, { withDistinct: false }), { gameId: 3 })
    if (Number(json?.code) === 220) return false
    return Number(json?.code) === 200 && json?.success === true
}

interface UpstreamGameRole {
    roleId?: string | number
    serverId?: string
    serverName?: string
    roleName?: string
    gameLevel?: string | number
    userId?: string | number
    gameId?: number
    phantomPercent?: number
}

/** @desc 取绑定的鸣潮角色（gameId=3）：roleId / serverId 是后续所有接口的必需参数 */
export async function fetchRoleList(token: string): Promise<KuroRole[]> {
    const json = await post('/gamer/role/list', oldHeaders(token, { withDistinct: false }), { gameId: 3 })
    if (Number(json?.code) !== 200 || json?.success !== true) throw upstreamError(json, '取绑定角色失败')
    const list = Array.isArray(json?.data) ? (json.data as UpstreamGameRole[]) : []
    return list
        .filter((r) => Number(r?.gameId) === 3)
        .map((r) => ({
            roleId: String(r.roleId),
            serverId: String(r.serverId ?? ''),
            serverName: r.serverName ?? undefined,
            nickname: r.roleName ?? undefined,
            level: r.gameLevel ? Number(r.gameLevel) : undefined,
            userId: r.userId != null ? String(r.userId) : undefined,
            phantomPercent: typeof r.phantomPercent === 'number' ? r.phantomPercent : undefined
        }))
}

/** @desc 取个人信息（登录态展示用；失败不影响有效性结论） */
export async function fetchMine(token: string): Promise<{ userId?: string; userName?: string; phone?: string }> {
    const json = await post('/user/mineV2', oldHeaders(token), { otherUserId: 0 })
    if (Number(json?.code) !== 200 || json?.success !== true) throw upstreamError(json, '取个人信息失败')
    const mine = ((json?.data as { mine?: { userId?: string | number; userName?: string; mobile?: string } })?.mine ??
        {}) as { userId?: string | number; userName?: string; mobile?: string }
    return {
        userId: mine.userId != null ? String(mine.userId) : undefined,
        userName: mine.userName ?? undefined,
        phone: mine.mobile ?? undefined
    }
}

interface UpstreamOwnedRole {
    roleId?: string | number
    roleName?: string
    level?: string | number
    chainUnlockNum?: number
    weaponTypeName?: string
}

/**
 * @desc 服务器 id 兜底（与参考实现 eventhorizonsky/WuwaWebTool 的 get_server_id 一致）：
 *  角色列表（gamer/role/list）没带回 serverId 时，akiBox 系列接口会直接报「服务器id不能为空」。
 *  国服是固定 hash；国际服按 roleId 段位（>= 2e8 视为国际服）映射。
 *  可用 KURO_SERVER_ID 覆盖（临时排查/新服务器上线时不用改代码）。
 */
const SERVER_ID_CN = '76402e5b20be2c39f095a152090afddc'
const SERVER_ID_NET = '919752ae5ea09c1ced910dd668a63ffb'
const NET_SERVER_ID_MAP: Record<number, string> = {
    5: '591d6af3a3090d8ea00d8f86cf6d7501',
    6: '6eb2a235b30d05efd77bedb5cf60999e',
    7: '86d52186155b148b5c138ceb41be9650',
    8: '919752ae5ea09c1ced910dd668a63ffb',
    9: '10cd7254d57e58ae560b15d51e34b4c'
}

/** @desc 实际使用的 serverId：优先角色列表返回值，缺失时按国服/国际服兜底 */
export const resolveServerId = (roleId: string, serverId?: string): string => {
    if (serverId) return serverId
    if (process.env.KURO_SERVER_ID) return process.env.KURO_SERVER_ID
    const numeric = Number(roleId)
    if (Number.isFinite(numeric) && numeric >= 200000000) {
        return NET_SERVER_ID_MAP[Math.floor(numeric / 100000000)] ?? SERVER_ID_NET
    }
    return SERVER_ID_CN
}

/**
 * @desc 换取 akiBox 的「数据令牌」：POST /aki/roleBox/requestToken（body 只有 serverId/roleId，
 *  头带 token + did + 空的 b-at）→ data.accessToken，后续 akiBox 调用放在 `b-at` 头里。
 */
async function fetchBatToken(token: string, did: string, roleId: string, serverId: string): Promise<string> {
    const json = await post(
        '/aki/roleBox/requestToken',
        {
            source: 'ios',
            token,
            did,
            'b-at': '',
            devCode: await akiDevCode(),
            accept: 'application/json, text/plain, */*',
            'user-agent': AKI_USER_AGENT
        },
        { serverId, roleId }
    )
    if (Number(json?.code) !== 200) throw upstreamError(json, '换取数据令牌失败')
    // data 可能是对象，也可能是字符串化 JSON（akiBox 常见），统一用 parseData 解
    const data = parseData<{ accessToken?: string; token?: string }>(json)
    const accessToken = data?.accessToken ?? data?.token
    if (!accessToken) {
        const preview = typeof json?.data === 'string' ? json.data.slice(0, 240) : JSON.stringify(data ?? json?.data)
        throw new Error(`换取数据令牌失败：上游未返回 accessToken（data=${preview ?? '空'}）`)
    }
    return accessToken
}

/** @desc 账号下角色列表（roleData）：roleId 字段其实是「角色 id」 */
async function fetchOwnedRoles(
    did: string,
    bat: string,
    roleId: string,
    serverId: string
): Promise<{ list: UpstreamOwnedRole[]; preview: string }> {
    const json = await post('/aki/roleBox/akiBox/roleData', await akiDataHeaders(did, bat), {
        gameId: 3,
        roleId,
        serverId
    })
    // 失败信息带上实际使用的 serverId：再出「服务器id不能为空」时能直接看出兜底是否生效
    if (Number(json?.code) !== 200) throw upstreamError(json, `取角色列表失败（serverId=${serverId || '空'}）`)
    return { list: pickRoleList(parseData<unknown>(json) ?? json), preview: previewData(json) }
}

/**
 * @desc 刷新角色盒数据（refreshData）：库街区的角色盒是**官方快照**，账号从未在 App 里刷新过时
 *  roleData 会返回空 roleList（参考实现因此在每次读取前都会先刷新）。官方有频率限制，
 *  失败时如实抛出上游 msg（例如「刷新过于频繁」）。
 */
async function refreshRoleBox(did: string, bat: string, roleId: string, serverId: string): Promise<void> {
    const json = await post('/aki/roleBox/akiBox/refreshData', await akiDataHeaders(did, bat), {
        gameId: 3,
        roleId,
        serverId
    })
    if (Number(json?.code) !== 200) throw upstreamError(json, '刷新角色盒数据失败')
}

interface UpstreamProp {
    attributeName?: string
    attributeValue?: string | number
}
interface UpstreamPhantom {
    cost?: number
    phantomProp?: { name?: string; cost?: number }
    mainProps?: UpstreamProp[]
    subProps?: UpstreamProp[]
}
interface UpstreamRoleDetail {
    chainList?: { unlocked?: boolean }[]
    weaponData?: { weapon?: { weaponName?: string } }
    phantomData?: { cost?: number; equipPhantomList?: (UpstreamPhantom | null)[] }
}

/**
 * @desc 单角色详情（含装配声骸）：countryCode 逐个试并记住成功值（模块级缓存，Serverless 复用实例时生效）
 *  body 需 channelId=19 / countryCode / id=角色id
 */
let countryCodeHit = ''
async function fetchCharacterDetail(did: string, bat: string, roleId: string, serverId: string, charId: string) {
    const codes = countryCodeHit
        ? [countryCodeHit, ...COUNTRY_CODES.filter((c) => c !== countryCodeHit)]
        : COUNTRY_CODES
    let lastErr: unknown
    for (const countryCode of codes) {
        try {
            const json = await post('/aki/roleBox/akiBox/getRoleDetail', await akiDataHeaders(did, bat), {
                gameId: 3,
                roleId,
                serverId,
                channelId: CHANNEL_ID,
                countryCode,
                id: charId
            })
            if (Number(json?.code) !== 200) throw upstreamError(json, `取角色详情失败（countryCode=${countryCode}）`)
            countryCodeHit = countryCode
            return parseData<UpstreamRoleDetail>(json)
        } catch (e) {
            lastErr = e
            if (String((e as Error)?.message ?? '').includes('登录已过期')) throw e
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error('取角色详情失败')
}

/** @desc 角色 + 当前装配声骸（同步词条方案用）：did 由路由层从 cookie 提供（与 token 同样的生命周期） */
export async function fetchRoleEchoes(
    token: string,
    { roleId, serverId, did }: { roleId: string; serverId: string; did: string }
): Promise<{
    characters: KuroCharacterEchoes[]
    stats: { characters: number; withEchoes: number; serverId: string; countryCode: string }
}> {
    // 角色列表没带 serverId 时兜底（否则上游直接报「服务器id不能为空」）
    const resolvedServerId = resolveServerId(roleId, serverId)
    // akiBox 调用前必须先换数据令牌（b-at），否则上游会拒（典型表现就是「服务器id不能为空」这类误报）
    const bat = await fetchBatToken(token, did, roleId, resolvedServerId)
    let ownedResult = await fetchOwnedRoles(did, bat, roleId, resolvedServerId)
    if (ownedResult.list.length === 0) {
        // 官方快照未刷新（或从未在 App 里打开过角色盒）时 roleList 为空：先刷新再读一次。
        // 刷新本身可能被频率限制，此时把上游原因一并带上，避免只剩一句「没有角色数据」。
        let refreshNote = ''
        try {
            await refreshRoleBox(did, bat, roleId, resolvedServerId)
            ownedResult = await fetchOwnedRoles(did, bat, roleId, resolvedServerId)
        } catch (e) {
            refreshNote = `；刷新角色盒失败：${e instanceof Error ? e.message : String(e)}`
        }
        if (ownedResult.list.length === 0) {
            throw new Error(
                `该账号下没有查询到角色数据（serverId=${resolvedServerId}）：` +
                    `请先在库街区 App 打开「鸣潮 → 角色盒」刷新一次数据` +
                    `${refreshNote}；响应=${ownedResult.preview}`
            )
        }
    }
    const owned = ownedResult.list
    const characters = await mapLimit(owned, 4, async (ch): Promise<KuroCharacterEchoes> => {
        const charId = String(ch.roleId)
        const base: KuroCharacterEchoes = {
            id: charId,
            name: ch.roleName ?? '',
            level: Number(ch.level) || undefined,
            chain: ch.chainUnlockNum != null ? Number(ch.chainUnlockNum) : undefined,
            weapon: ch.weaponTypeName ?? undefined,
            echoes: []
        }
        try {
            const detail = await fetchCharacterDetail(did, bat, roleId, resolvedServerId, charId)
            const phantoms = (detail?.phantomData?.equipPhantomList ?? []).filter(Boolean) as UpstreamPhantom[]
            return {
                ...base,
                weapon: detail?.weaponData?.weapon?.weaponName ?? base.weapon,
                chain: detail?.chainList ? detail.chainList.filter((c) => c?.unlocked).length : base.chain,
                echoes: phantoms.map((p) => {
                    const main = (p.mainProps ?? [])[0]
                    return {
                        cost: Number(p.cost ?? p.phantomProp?.cost) || 0,
                        name: p.phantomProp?.name ?? '',
                        mainStatName: main?.attributeName ?? '',
                        mainStatValue: parseNum(main?.attributeValue),
                        substats: (p.subProps ?? []).map((s) => ({
                            name: s?.attributeName ?? '',
                            value: parseNum(s?.attributeValue)
                        }))
                    }
                })
            }
        } catch (e) {
            // 单角色失败不影响整体：返回空声骸，由前端按「不足 5 个」跳过并提示原因
            return { ...base, error: e instanceof Error ? e.message : String(e) }
        }
    })
    return {
        characters,
        stats: {
            characters: characters.length,
            withEchoes: characters.filter((c) => c.echoes.length > 0).length,
            serverId: resolvedServerId,
            countryCode: countryCodeHit || COUNTRY_CODES[0]
        }
    }
}
