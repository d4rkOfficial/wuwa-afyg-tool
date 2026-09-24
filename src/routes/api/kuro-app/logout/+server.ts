/** @desc 库街区：退出登录（清掉 httpOnly cookie 里的 token） */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { clearToken } from '$lib/kuro-app/kuro-session.server'

export const POST: RequestHandler = async ({ cookies }) => {
    clearToken(cookies)
    return json({ ok: true })
}
