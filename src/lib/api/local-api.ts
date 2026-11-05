/**
 * @desc 客户端访问「本站 API」的唯一入口。
 *
 * 两种部署形态走同一批路径与同一套返回结构：
 *   - **有服务端**（Vercel / Cloudflare Pages / Tauri 本地服务）：同源 `fetch('/api/...')`；
 *   - **无服务端的独立静态包**（`STANDALONE=1` 构建）：在浏览器里**就地**解析这些路径，
 *     直接调用 provider 适配器（数据上游 `static.nanoka.cc` 已开放 `Access-Control-Allow-Origin: *`），
 *     于是上层业务代码完全不必区分两种部署。
 *
 * 这里只覆盖「纯数据读取」的只读接口，与 `src/routes/api/v1|v2|v3/**` 的路由表一一对应：
 * `?provider=` 选上游、`?lang=` 选语言、返回结构全同。必须服务端出网才能做的能力
 * （库街区登录、AI 转发、工坊站点标题抓取）在静态包里会明确报错，而不是假装可用 ——
 * 各自的调用方另有专门的提示文案。
 */
import { langFromUrl } from './lang'
import { getProvider } from './provider'
import type { DataProvider } from './provider/types'

/** @desc 是否「无服务端独立静态包」构建；由 vite 的 define 注入（见 vite.config.ts） */
export const isOfflineBuild = (): boolean => __OFFLINE_BUILD__

/** @desc 本站 API 的错误：带上 HTTP 状态，便于调用方还原「404 = 找不到」这类语义 */
export class ApiError extends Error {
    status: number

    constructor(status: number, message: string) {
        super(message)
        this.name = 'ApiError'
        this.status = status
    }
}

const LIST_METHODS: Record<
    string,
    keyof Pick<DataProvider, 'getCharacterList' | 'getWeaponList' | 'getEchoList' | 'getEchoSetList'>
> = {
    character: 'getCharacterList',
    weapon: 'getWeaponList',
    echo: 'getEchoList',
    'echo-set': 'getEchoSetList'
}

const INFO_METHODS: Record<
    string,
    keyof Pick<DataProvider, 'getCharacterInfo' | 'getWeaponInfo' | 'getEchoInfo' | 'getEchoSetInfo'>
> = {
    character: 'getCharacterInfo',
    weapon: 'getWeaponInfo',
    echo: 'getEchoInfo',
    'echo-set': 'getEchoSetInfo'
}

const ICON_METHODS: Record<
    string,
    keyof Pick<
        DataProvider,
        'getCharacterIcons' | 'getWeaponIcons' | 'getEchoIcons' | 'getEchoSetIcons' | 'getTagIcons'
    >
> = {
    character: 'getCharacterIcons',
    weapon: 'getWeaponIcons',
    echo: 'getEchoIcons',
    'echo-set': 'getEchoSetIcons',
    tags: 'getTagIcons'
}

/** @desc 把 `/api/v1/info/character/漂泊者` 这类路径在浏览器里解析成 provider 调用 */
const resolveOffline = async (rawPath: string): Promise<unknown> => {
    const url = new URL(rawPath, 'http://offline.invalid')
    // ['', 'api', 'v1', 'info', 'character', '<name>']
    const [, area, version, kind, entity = '', rawName = ''] = url.pathname.split('/')
    if (area !== 'api') throw new ApiError(404, `不是本站接口：${url.pathname}`)

    const provider = getProvider(url.searchParams.get('provider') ?? undefined)
    const lang = langFromUrl(url)
    const name = decodeURIComponent(rawName)

    if (version === 'v1' && kind === 'list') {
        const method = LIST_METHODS[entity]
        if (!method) throw new ApiError(400, 'Invalid entity')
        return provider[method]({ lang })
    }
    if (version === 'v1' && kind === 'batch-icons') {
        const method = ICON_METHODS[entity]
        if (!method) throw new ApiError(400, 'Invalid entity')
        return provider[method]()
    }
    if (version === 'v1' && kind === 'info') {
        const method = INFO_METHODS[entity]
        if (!method) throw new ApiError(400, 'Invalid entity')
        if (!name) throw new ApiError(400, 'Missing name parameter')
        return provider[method](name, { lang })
    }
    // v3 = 富文本角色详情；v2 在服务端是 308 到 v3（见 src/routes/api/v2/**）
    if ((version === 'v3' || version === 'v2') && kind === 'info' && entity === 'character') {
        if (!name) throw new ApiError(400, 'Missing name parameter')
        return provider.getCharacterInfo(name, { rich: true, lang })
    }
    if (version === 'v1' && kind === 'recommend-weapon') {
        if (!entity) throw new ApiError(400, 'Missing character name')
        return provider.getRecommendedWeapons(decodeURIComponent(entity))
    }
    if (version === 'v1' && kind === 'version' && entity === 'latest') return provider.getLatestVersion()
    if (version === 'v1' && kind === 'version' && entity === 'available') return provider.getAvailableVersions()

    throw new ApiError(404, `静态版不支持该接口：${url.pathname}`)
}

export interface ApiRequestInit {
    /** @desc 仅在线部署生效（离线解析是本地计算，无法中断） */
    signal?: AbortSignal
}

/**
 * @desc 取本站 API 的 JSON。在线部署直接 `fetch`，静态包在本地解析（同一个返回结构）。
 * 非 2xx 一律抛 `ApiError`（在线）或 provider 的原始错误（离线）。
 */
export const fetchApiJson = async <T>(path: string, init: ApiRequestInit = {}): Promise<T> => {
    if (__OFFLINE_BUILD__) return (await resolveOffline(path)) as T
    const res = await fetch(path, init.signal ? { signal: init.signal } : undefined)
    if (!res.ok) throw new ApiError(res.status, `API ${res.status}: ${path}`)
    return (await res.json()) as T
}
