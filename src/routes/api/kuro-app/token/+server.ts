/**
 * @desc 库街区：导出当前登录 token（从 httpOnly cookie 读回，供用户复制到其它工具使用）。
 *  只在已登录时返回；响应禁止任何缓存，避免 token 落到磁盘或中间代理。
 */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { readToken } from '$lib/kuro-app/kuro-session.server'

export const GET: RequestHandler = ({ cookies, setHeaders }) => {
    setHeaders({ 'cache-control': 'no-store' })
    const token = readToken(cookies)
    if (!token) return json({ ok: false, error: '未登录库街区，无法导出 Token' })
    return json({ ok: true, token })
}
