/** @desc 库街区：发送短信验证码 */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { sendSmsCode } from '$lib/kuro-app/kuro-api.server'

export const POST: RequestHandler = async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { phone?: string }
    const phone = String(body.phone ?? '').trim()
    if (!/^\d{6,15}$/.test(phone)) return json({ ok: false, error: '手机号格式不正确' })
    try {
        await sendSmsCode(phone)
        return json({ ok: true })
    } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
}
