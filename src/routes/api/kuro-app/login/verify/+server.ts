/** @desc 库街区：验证码登录（成功后 token 写入 httpOnly cookie，不下发浏览器）
 *  注意：这里**不**再顺手做鸣潮签到——签到属于游戏数据写操作，与角色盒取数共用上游风控额度，
 *  登录后立刻签到会让随后的「从库街区同步」被上游要求人机验证（实测踩过）。签到改为设置里的显式按钮。 */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { fetchMine, fetchRoleList, loginBySms } from '$lib/kuro-app/kuro-api.server'
import { writeToken, type KuroSessionPayload } from '$lib/kuro-app/kuro-session.server'

export const POST: RequestHandler = async ({ request, cookies }) => {
    const body = (await request.json().catch(() => ({}))) as { phone?: string; code?: string }
    const phone = String(body.phone ?? '').trim()
    const code = String(body.code ?? '').trim()
    if (!phone || !code) return json({ ok: false, error: '缺少手机号或验证码' })
    try {
        const login = await loginBySms(phone, code)
        writeToken(cookies, login.token)
        // 登录后顺手把账号与绑定角色取回来（失败不算登录失败，UI 可再校验）
        let roles: KuroSessionPayload['roles'] = []
        let account: KuroSessionPayload['account'] = { userId: login.userId, userName: login.userName, phone }
        try {
            roles = await fetchRoleList(login.token)
        } catch {
            roles = []
        }
        try {
            const mine = await fetchMine(login.token)
            account = {
                userId: mine.userId ?? login.userId,
                userName: mine.userName ?? login.userName,
                phone: mine.phone ?? phone
            }
        } catch {
            // 保留 sdkLogin 返回的账号信息
        }
        return json({
            ok: true,
            session: { loggedIn: true, account, roles, savedAt: Date.now() } satisfies KuroSessionPayload
        })
    } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
}
