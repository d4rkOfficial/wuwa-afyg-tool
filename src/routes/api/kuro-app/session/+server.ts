/**
 * @desc 库街区：会话状态。`?check=1` 时顺带校验 token 是否仍有效并刷新绑定角色。
 *  token 只在服务端 cookie 里，这里只回「是否登录 / 是否有效 / 账号 / 绑定角色」。
 */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { checkToken, fetchMine, fetchRoleList } from '$lib/kuro-app/kuro-api.server'
import { clearToken, emptySession, readToken, type KuroSessionPayload } from '$lib/kuro-app/kuro-session.server'

export const GET: RequestHandler = async ({ url, cookies }) => {
    const token = readToken(cookies)
    if (!token) return json({ ok: true, session: emptySession(), valid: false, reason: '未登录' })

    if (!url.searchParams.has('check')) {
        // 不校验有效性（省一次请求），但仍取一次绑定角色：设置页/登录窗口/同步都要用角色列表，
        // 之前留空会让 UI 误显示「没有绑定角色」
        let roles: KuroSessionPayload['roles'] = []
        try {
            roles = await fetchRoleList(token)
        } catch {
            roles = []
        }
        const session: KuroSessionPayload = { loggedIn: true, account: null, roles, savedAt: 0 }
        return json({ ok: true, session, valid: true })
    }

    try {
        const valid = await checkToken(token)
        if (!valid) {
            clearToken(cookies)
            return json({ ok: true, session: emptySession(), valid: false, reason: '登录已过期，请重新登录' })
        }
        const roles = await fetchRoleList(token)
        let account: KuroSessionPayload['account'] = null
        try {
            account = await fetchMine(token)
        } catch {
            // 取个人信息失败不影响有效性结论
        }
        return json({ ok: true, session: { loggedIn: true, account, roles, savedAt: Date.now() }, valid: true })
    } catch (e) {
        return json({
            ok: true,
            session: { loggedIn: true, account: null, roles: [], savedAt: 0 },
            valid: false,
            reason: e instanceof Error ? e.message : String(e)
        })
    }
}
