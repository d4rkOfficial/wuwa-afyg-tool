/** @desc 库街区：Token 登录（用户粘贴 token → 服务端校验后写入 httpOnly cookie，不下发浏览器） */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { checkToken, fetchMine, fetchRoleList } from '$lib/kuro-app/kuro-api.server'
import { writeToken, type KuroSessionPayload } from '$lib/kuro-app/kuro-session.server'
import { normalizeKuroToken } from '$lib/kuro-app/kuro-token'

export const POST: RequestHandler = async ({ request, cookies }) => {
    const body = (await request.json().catch(() => ({}))) as { token?: string }
    const token = normalizeKuroToken(String(body.token ?? ''))
    if (!token) return json({ ok: false, error: '缺少 token（请粘贴库街区登录凭据）' })
    try {
        // 先向上游确认 token 有效：无效的直接拒绝，不覆盖已有的登录 cookie
        if (!(await checkToken(token))) return json({ ok: false, error: 'Token 无效或已过期，请重新获取' })
        writeToken(cookies, token)
        // 登录后顺手把账号与绑定角色取回来（失败不影响登录，UI 可再校验）
        let roles: KuroSessionPayload['roles'] = []
        let account: KuroSessionPayload['account'] = null
        try {
            roles = await fetchRoleList(token)
        } catch {
            roles = []
        }
        try {
            account = await fetchMine(token)
        } catch {
            // 取个人信息失败不影响登录（角色列表已能支撑同步）
        }
        return json({
            ok: true,
            session: { loggedIn: true, account, roles, savedAt: Date.now() } satisfies KuroSessionPayload
        })
    } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
}
