/**
 * @desc 库街区：某绑定角色下「所有角色 + 当前装配声骸」（服务端调用上游，返回原始结构供前端映射）。
 *  GET  ?roleId=&serverId=  — 普通取数
 *  POST { roleId, serverId, geeTestData } — 上游要求人机验证（data.geeTest === true）时，
 *       前端解完极验把校验数据带上来重发；仍是验证桩则返回 geetest.required 让前端再弹一次。
 */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { fetchRoleEchoes, KuroGeetestError } from '$lib/kuro-app/kuro-api.server'
import { readOrCreateDid, readToken } from '$lib/kuro-app/kuro-session.server'

interface EchoesBody {
    roleId?: string
    serverId?: string
    geeTestData?: string
}

const run = async (
    token: string,
    did: string,
    { roleId = '', serverId = '', geeTestData }: EchoesBody
): Promise<Response> => {
    if (!roleId) return json({ ok: false, error: '缺少 roleId' })
    try {
        const data = await fetchRoleEchoes(token, { roleId, serverId, did, geeTestData })
        return json({ ok: true, geetest: { required: false }, ...data })
    } catch (e) {
        if (e instanceof KuroGeetestError) {
            // 注意：必须是 ok:true —— 客户端 call() 见到 ok:false 会直接抛错，
            // 只有 ok:true + geetest.required 才能让前端走到「弹极验再重试」那条分支
            // （与 /login/sms 的约定一致）
            return json({
                ok: true,
                geetest: { required: true, captchaId: e.captchaId, product: e.product },
                characters: [],
                error: '库街区要求完成人机验证后才能读取角色数据'
            })
        }
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
}

export const GET: RequestHandler = async ({ url, cookies }) => {
    const token = readToken(cookies)
    if (!token) return json({ ok: false, error: '未登录库街区，请先登录' })
    return run(token, readOrCreateDid(cookies), {
        roleId: url.searchParams.get('roleId') ?? '',
        serverId: url.searchParams.get('serverId') ?? '',
        geeTestData: url.searchParams.get('geeTestData') ?? undefined
    })
}

export const POST: RequestHandler = async ({ request, cookies }) => {
    const token = readToken(cookies)
    if (!token) return json({ ok: false, error: '未登录库街区，请先登录' })
    const body = (await request.json().catch(() => ({}))) as EchoesBody
    return run(token, readOrCreateDid(cookies), body)
}
