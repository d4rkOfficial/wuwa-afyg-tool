/**
 * @desc 库街区：某绑定角色下「所有角色 + 当前装配声骸」（服务端调用上游，返回原始结构供前端映射）。
 *  GET  ?roleId=&serverId=  或  POST { roleId, serverId }
 *
 *  取数接口被上游风控时（`data.geeTest === true`）不做人机验证——实测走极验这条路对取数接口无效，
 *  由服务端直接回明确的「被风控」错误，前端原样提示。
 */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { fetchRoleEchoes } from '$lib/kuro-app/kuro-api.server'
import { readOrCreateDid, readToken } from '$lib/kuro-app/kuro-session.server'

interface EchoesBody {
    roleId?: string
    serverId?: string
}

const run = async (token: string, did: string, { roleId = '', serverId = '' }: EchoesBody): Promise<Response> => {
    if (!roleId) return json({ ok: false, error: '缺少 roleId' })
    try {
        const data = await fetchRoleEchoes(token, { roleId, serverId, did })
        return json({ ok: true, ...data })
    } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
}

export const GET: RequestHandler = async ({ url, cookies }) => {
    const token = readToken(cookies)
    if (!token) return json({ ok: false, error: '未登录库街区，请先登录' })
    return run(token, readOrCreateDid(cookies), {
        roleId: url.searchParams.get('roleId') ?? '',
        serverId: url.searchParams.get('serverId') ?? ''
    })
}

export const POST: RequestHandler = async ({ request, cookies }) => {
    const token = readToken(cookies)
    if (!token) return json({ ok: false, error: '未登录库街区，请先登录' })
    const body = (await request.json().catch(() => ({}))) as EchoesBody
    return run(token, readOrCreateDid(cookies), body)
}
