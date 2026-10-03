// ── app.html 手机端重定向契约单测（node:test） ────────────────────────────
// 这段判定逻辑内联在 src/app.html 里（/ 是 prerender 静态页，服务端钩子对它无效，
// 只能放在 SvelteKit 启动前），常规单测覆盖不到。这里把**真实出厂的那段脚本**
// 抽出来，在受控的全局变量下执行，逐条验证「该跳的跳、不该跳的一条都不跳」。
//
// 重点防护三条会出人命的规则：
//   1. 已经在 /shell-page 不能再跳（自跳自 = 无限循环）；
//   2. iframe 内一律不跳（壳页 iframe 加载的正是同一个 /；这条同时覆盖 B 站 Toy 容器）；
//   3. 安装了 PWA 不跳。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** @desc 从 app.html 抽出那段重定向脚本（用 /shell-page 关键字定位，避免误取 splash 脚本） */
const extractRedirectScript = (): string => {
    const html = readFileSync('src/app.html', 'utf8')
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    const found = blocks.filter((b) => b.includes('/shell-page'))
    assert.equal(found.length, 1, `app.html 中应恰好有一段重定向脚本，实际 ${found.length} 段`)
    return found[0]
}

const REDIRECT_SCRIPT = extractRedirectScript()

/** @desc 一次执行的上下文，缺省值 = 普通桌面浏览器正常打开首页 */
interface Ctx {
    pathname?: string
    search?: string
    hash?: string
    inIframe?: boolean
    standalone?: boolean
    userAgent?: string
    viewportWidth?: number
    coarsePointer?: boolean
    canLockOrientation?: boolean
}

const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const DESKTOP_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** @desc 执行一段脚本，返回它请求跳转到的地址（未跳转则为 null） */
const run = (ctx: Ctx = {}): string | null => {
    const {
        pathname = '/',
        search = '',
        hash = '',
        inIframe = false,
        standalone = false,
        userAgent = DESKTOP_UA,
        viewportWidth = 1920,
        coarsePointer = false,
        canLockOrientation = true
    } = ctx

    let replaced: string | null = null
    const makeMedia = (matches: boolean) => ({ matches })

    const locationStub = {
        pathname,
        search,
        hash,
        href: `https://example.com${pathname}${search}${hash}`,
        replace: (url: string) => {
            replaced = url
        }
    }
    /** @desc 模拟 window：self !== top 表示处于 iframe 内（脚本用它区分宿主容器） */
    const windowStub: {
        self: unknown
        top: unknown
        innerWidth: number
        matchMedia: unknown
        navigator: unknown
    } = {
        self: undefined,
        top: undefined,
        innerWidth: viewportWidth,
        matchMedia: (q: string) => makeMedia(q.includes('display-mode: standalone') ? standalone : coarsePointer),
        navigator: { standalone, userAgent }
    }
    windowStub.self = inIframe ? {} : windowStub
    windowStub.top = windowStub

    const documentStub = {
        documentElement: { requestFullscreen: canLockOrientation ? () => {} : undefined }
    }
    const screenStub = {
        orientation: canLockOrientation ? { lock: () => {} } : undefined
    }

    new Function('window', 'document', 'screen', 'location', 'navigator', REDIRECT_SCRIPT)(
        windowStub,
        documentStub,
        screenStub,
        locationStub,
        windowStub.navigator
    )
    return replaced
}

describe('app.html 手机端重定向契约', () => {
    it('手机 + 竖屏窄屏 + 可锁方向 → 跳壳页', () => {
        for (const ua of [IPHONE_UA, ANDROID_UA]) {
            assert.equal(run({ userAgent: ua, viewportWidth: 390, coarsePointer: true }), '/shell-page', ua)
        }
    })

    it('已经在 /shell-page 不再跳（防自跳自循环）', () => {
        assert.equal(
            run({
                pathname: '/shell-page',
                userAgent: IPHONE_UA,
                viewportWidth: 390,
                coarsePointer: true
            }),
            null
        )
    })

    it('iframe 内一律不跳（壳页 iframe 与 B 站 Toy 容器都靠这条）', () => {
        assert.equal(
            run({
                inIframe: true,
                userAgent: IPHONE_UA,
                viewportWidth: 390,
                coarsePointer: true
            }),
            null
        )
    })

    it('已安装的 PWA（standalone）不跳', () => {
        assert.equal(
            run({
                standalone: true,
                userAgent: IPHONE_UA,
                viewportWidth: 390,
                coarsePointer: true
            }),
            null
        )
    })

    it('桌面 UA / 非粗指针 / 宽屏都不跳', () => {
        assert.equal(run({ userAgent: DESKTOP_UA }), null)
        assert.equal(run({ userAgent: IPHONE_UA, viewportWidth: 390, coarsePointer: false }), null)
        assert.equal(run({ userAgent: IPHONE_UA, viewportWidth: 1200, coarsePointer: true }), null)
    })

    it('切不了横屏的环境不跳（跳过去只会多一层遮罩）', () => {
        assert.equal(
            run({
                userAgent: IPHONE_UA,
                viewportWidth: 390,
                coarsePointer: true,
                canLockOrientation: false
            }),
            null
        )
    })

    it('viewport 宽度为 0（拿不到尺寸）不跳，避免误判', () => {
        assert.equal(run({ userAgent: IPHONE_UA, viewportWidth: 0, coarsePointer: true }), null)
    })

    it('跳转时带上原 URL 的 query 与 hash（分享链接等参数不丢）', () => {
        assert.equal(
            run({
                search: '?from=share',
                hash: '#import_project=abc',
                userAgent: IPHONE_UA,
                viewportWidth: 390,
                coarsePointer: true
            }),
            '/shell-page?from=share#import_project=abc'
        )
    })

    it('判定过程抛错时静默降级（绝不因此白屏）', () => {
        // matchMedia 首行就被调用（standalone 判定），传 undefined 制造必然异常：
        // 脚本必须自己 try/catch 吃掉，既不跳转也不把异常抛给宿主页面
        let replaced: string | null = null
        assert.doesNotThrow(() => {
            new Function('window', 'document', 'screen', 'location', 'navigator', REDIRECT_SCRIPT)(
                { self: {}, top: {}, innerWidth: 390, matchMedia: undefined, navigator: {} },
                { documentElement: {} },
                undefined,
                {
                    pathname: '/',
                    search: '',
                    hash: '',
                    replace: (url: string) => {
                        replaced = url
                    }
                },
                {}
            )
        })
        assert.equal(replaced, null, '异常路径下不应发生跳转')
    })
})
