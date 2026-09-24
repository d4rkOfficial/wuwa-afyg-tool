/** @desc 库街区：验证码登录（成功后 token 写入 httpOnly cookie，不下发浏览器）；登录后顺手做鸣潮签到 */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
    fetchMine,
    fetchRoleList,
    loginBySms,
    signInWavesRoles,
    type KuroSignInResult
} from '$lib/kuro-app/kuro-api.server'
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
        // 每次登录都签到：失败不影响登录结果，只把结果带回去给 UI 提示
        let signIn: KuroSignInResult[] = []
        if (roles.length > 0) {
            try {
                signIn = await signInWavesRoles(login.token, roles, account?.userId ?? login.userId)
            } catch {
                signIn = []
            }
        }
        return json({
            ok: true,
            session: { loggedIn: true, account, roles, savedAt: Date.now() } satisfies KuroSessionPayload,
            signIn
        })
    } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
}
