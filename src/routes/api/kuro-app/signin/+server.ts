/** @desc 库街区：鸣潮每日签到（给账号下每个绑定角色各签一次；单个失败不影响其它） */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { fetchMine, fetchRoleList, signInWavesRoles } from '$lib/kuro-app/kuro-api.server'
import { readToken } from '$lib/kuro-app/kuro-session.server'

export const POST: RequestHandler = async ({ cookies }) => {
    const token = readToken(cookies)
    if (!token) return json({ ok: false, error: '未登录库街区' })
    try {
        const roles = await fetchRoleList(token)
        if (roles.length === 0) return json({ ok: false, error: '该账号下没有已绑定的鸣潮角色' })
        let userId = ''
        try {
            userId = (await fetchMine(token)).userId ?? ''
        } catch {
            // 取不到库洛 id 也照签：签到接口按游戏角色计
        }
        const results = await signInWavesRoles(token, roles, userId)
        return json({ ok: true, results })
    } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
}
