/** @desc 库街区：发送短信验证码（上游要求极验时回 geetest.required，让前端弹验证后带验证数据重发） */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { KURO_GEETEST, sendSmsCode } from '$lib/kuro-app/kuro-api.server'

export const POST: RequestHandler = async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { phone?: string; geeTestData?: string }
    const phone = String(body.phone ?? '').trim()
    if (!/^\d{6,15}$/.test(phone)) return json({ ok: false, error: '手机号格式不正确' })
    try {
        const res = await sendSmsCode(phone, body.geeTestData ? String(body.geeTestData) : undefined)
        return json({
            ok: true,
            geetest: res.geetestRequired ? { required: true, ...KURO_GEETEST } : { required: false }
        })
    } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
}
