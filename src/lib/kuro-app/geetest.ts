/**
 * @desc 极验（geetest v4）客户端封装：按需加载 gt4.js，弹出验证并返回校验数据。
 *  只在「上游要求极验」时才会加载第三方脚本（https://static.geetest.com/v4/gt4.js），避免无谓的外链请求。
 */

export interface GeetestValidate {
    lot_number: string
    captcha_output: string
    pass_token: string
    gen_time: string
}

interface GeetestInstance {
    showBox: () => void
    hideBox?: () => void
    onSuccess: (cb: () => void) => GeetestInstance
    onError: (cb: (e: unknown) => void) => GeetestInstance
    onClose?: (cb: () => void) => GeetestInstance
    getValidate: () => GeetestValidate | null
}

type InitGeetest4 = (
    opts: { captchaId: string; product: string; language?: string },
    cb: (captcha: GeetestInstance) => void
) => void

const SCRIPT_SRC = 'https://static.geetest.com/v4/gt4.js'

const getInitFn = (): InitGeetest4 | undefined => (window as unknown as { initGeetest4?: InitGeetest4 }).initGeetest4

let loading: Promise<InitGeetest4> | null = null

/** @desc 懒加载极验脚本（并发只加载一次；失败后允许重试） */
const loadInitFn = (): Promise<InitGeetest4> => {
    const ready = getInitFn()
    if (ready) return Promise.resolve(ready)
    if (loading) return loading
    loading = new Promise<InitGeetest4>((resolve, reject) => {
        const el = document.createElement('script')
        el.src = SCRIPT_SRC
        el.async = true
        el.onload = () => {
            const fn = getInitFn()
            if (fn) resolve(fn)
            else reject(new Error('极验脚本已加载但未就绪，请重试'))
        }
        el.onerror = () => {
            loading = null
            reject(new Error('极验脚本加载失败（网络不通或被内容安全策略拦截）'))
        }
        document.head.appendChild(el)
    })
    return loading
}

/** @desc 弹出极验并等待用户完成；成功后返回 getValidate() 的四个字段 */
export const solveGeetest = async (captchaId: string, product: string): Promise<GeetestValidate> => {
    if (!captchaId) throw new Error('缺少极验 captchaId')
    const init = await loadInitFn()
    return new Promise<GeetestValidate>((resolve, reject) => {
        init({ captchaId, product, language: 'zh-cn' }, (captcha) => {
            captcha
                .onSuccess(() => {
                    const validate = captcha.getValidate()
                    if (!validate) {
                        reject(new Error('极验未返回校验数据，请重试'))
                        return
                    }
                    resolve(validate)
                })
                .onError((e) => {
                    reject(new Error(`极验出错：${e instanceof Error ? e.message : String(e ?? '未知原因')}`))
                })
            // 用户关掉验证框：视为取消（成功后 promise 已结算，这里自然无效）
            captcha.onClose?.(() => reject(new Error('已取消人机验证')))
            captcha.showBox()
        })
    })
}
