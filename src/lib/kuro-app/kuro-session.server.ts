/**
 * 库街区登录态的服务端承载：token 放 httpOnly cookie（浏览器脚本读不到、也不进 localStorage）。
 * 只在 src/routes/api/kuro-app/ 下的 +server.ts 中使用。
 */
import { dev } from '$app/environment'
import type { Cookies } from '@sveltejs/kit'

export const KURO_COOKIE = 'kuro_token'
/** @desc 上游未文档化有效期，保守给 30 天；失效时 UI 会提示重新登录 */
const MAX_AGE = 60 * 60 * 24 * 30

const opts = () =>
    ({
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: !dev,
        maxAge: MAX_AGE
    }) as const

export const readToken = (cookies: Cookies): string => cookies.get(KURO_COOKIE) ?? ''

export const writeToken = (cookies: Cookies, token: string): void => {
    cookies.set(KURO_COOKIE, token, opts())
}

export const clearToken = (cookies: Cookies): void => {
    cookies.delete(KURO_COOKIE, { path: '/' })
}

/** @desc 对外统一的会话概览（绝不含 token） */
export interface KuroSessionPayload {
    loggedIn: boolean
    account: { userId?: string; userName?: string; phone?: string } | null
    roles: {
        roleId: string
        serverId: string
        serverName?: string
        nickname?: string
        level?: number
        userId?: string
    }[]
    savedAt: number
}

export const emptySession = (): KuroSessionPayload => ({ loggedIn: false, account: null, roles: [], savedAt: 0 })
