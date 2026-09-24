/**
 * @desc TEMP-DIAG：库街区「角色详情里没有声骸」排查用（定位后删除整个目录）。
 *  用当前 httpOnly cookie 里的登录态跑一次完整链路，把原始返回写到系统临时目录并回显路径。
 *  浏览器直接打开：/api/kuro-app/debug/echoes
 */
import { json } from '@sveltejs/kit'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { RequestHandler } from './$types'
import { debugRoleEchoes } from '$lib/kuro-app/kuro-api.server'
import { readOrCreateDid, readToken } from '$lib/kuro-app/kuro-session.server'

export const GET: RequestHandler = async ({ url, cookies }) => {
    const token = readToken(cookies)
    if (!token) return json({ ok: false, error: '未登录库街区（先到设置 → 连接配置 → 库街区账号登录）' })
    try {
        const report = await debugRoleEchoes(token, readOrCreateDid(cookies), {
            roleId: url.searchParams.get('roleId') ?? undefined,
            serverId: url.searchParams.get('serverId') ?? undefined
        })
        const file = join(tmpdir(), 'kuro-debug-echoes.json')
        await writeFile(file, JSON.stringify(report, null, 2), 'utf8')
        return json({ ok: true, file, report })
    } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
}
