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

/** @desc 新版 akiBox 最简三件套：source + token + devCode（随机即可） */
const akiHeaders = (token: string): Record<string, string> => ({
    source: 'android',
    token,
    devCode: randomDevCode(),
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9'
})

interface UpstreamEnvelope {
    code?: number
    msg?: string
    success?: boolean
    /** @desc 新版 akiBox 的 data 是「字符串化 JSON」 */
    data?: unknown
    traceId?: string
}

const post = async (
    path: string,
    headers: Record<string, string>,
    body: Record<string, string | number>
): Promise<UpstreamEnvelope> => {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers,
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

/** @desc 发短信验证码；极验要求时明确报错（不伪造通过） */
export async function sendSmsCode(phone: string): Promise<void> {
    const json = await post('/user/getSmsCode', oldHeaders(null, { sms: true }), { mobile: phone, geeTestData: '' })
    if ((json?.data as { geeTest?: boolean } | undefined)?.geeTest === true) {
        throw new Error('库街区要求先通过极验（geetest）；请先在库街区 App/网页登录一次后再试')
    }
    if (Number(json?.code) !== 200) throw upstreamError(json, '发送验证码失败')
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

/** @desc 账号下角色列表（roleData）：roleId 字段其实是「角色 id」 */
async function fetchOwnedRoles(token: string, roleId: string, serverId: string): Promise<UpstreamOwnedRole[]> {
    const json = await post('/aki/roleBox/akiBox/roleData', akiHeaders(token), { gameId: 3, roleId, serverId })
    if (Number(json?.code) !== 200) throw upstreamError(json, '取角色列表失败')
    return parseData<{ roleList?: UpstreamOwnedRole[] }>(json)?.roleList ?? []
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
async function fetchCharacterDetail(token: string, roleId: string, serverId: string, charId: string) {
    const codes = countryCodeHit
        ? [countryCodeHit, ...COUNTRY_CODES.filter((c) => c !== countryCodeHit)]
        : COUNTRY_CODES
    let lastErr: unknown
    for (const countryCode of codes) {
        try {
            const json = await post('/aki/roleBox/akiBox/getRoleDetail', akiHeaders(token), {
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

/** @desc 角色 + 当前装配声骸（同步词条方案用） */
export async function fetchRoleEchoes(
    token: string,
    { roleId, serverId }: { roleId: string; serverId: string }
): Promise<{ characters: KuroCharacterEchoes[]; stats: { characters: number; withEchoes: number } }> {
    const owned = await fetchOwnedRoles(token, roleId, serverId)
    if (owned.length === 0) throw new Error('该账号下没有查询到角色数据（请确认已绑定角色、游戏数据已同步）')
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
            const detail = await fetchCharacterDetail(token, roleId, serverId, charId)
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
        stats: { characters: characters.length, withEchoes: characters.filter((c) => c.echoes.length > 0).length }
    }
}
