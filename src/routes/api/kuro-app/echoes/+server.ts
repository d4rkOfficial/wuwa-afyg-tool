/**
 * @desc 库街区：某绑定角色下「所有角色 + 当前装配声骸」（服务端调用上游，返回原始结构供前端映射）。
 *  参数：roleId、serverId（均来自 /session 返回的绑定角色列表）。
 */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { fetchRoleEchoes } from '$lib/kuro-app/kuro-api.server'
import { readToken } from '$lib/kuro-app/kuro-session.server'

export const GET: RequestHandler = async ({ url, cookies }) => {
    const token = readToken(cookies)
    if (!token) return json({ ok: false, error: '未登录库街区，请先登录' })
    const roleId = url.searchParams.get('roleId') ?? ''
    const serverId = url.searchParams.get('serverId') ?? ''
    if (!roleId) return json({ ok: false, error: '缺少 roleId' })
    try {
        const data = await fetchRoleEchoes(token, { roleId, serverId })
        return json({ ok: true, ...data })
    } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
}
