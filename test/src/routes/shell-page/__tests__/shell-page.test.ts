// ── 壳页契约单测（node:test） ─────────────────────────────────────────────
// 壳页是一段直接返回的原生 HTML + 内联脚本（无框架、无水合），常规单测覆盖不到，
// 故用「契约校验」兜住关键不变量：
//   1. 视口适配几何与参考项目一致（容器固定 1280px 宽 + 等比缩放）；
//   2. 衬线遮罩层：刊头结构、黑白配色、品牌图标原色、文案；
//   3. 方向判定必须取设备真实方向（不能按视口宽高比 —— 容器被撑成 1280px 后，
//      竖屏手机的 innerWidth 也大于 innerHeight，宽高比会把竖屏误判成横屏）；
//   4. 每次点击都真的重新请求横屏（不缓存「已锁」脏状态）。
// 通过 test/preload.mjs 解析 TS 与相对导入。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildShellHtml, SHELL_HTML } from '$src/routes/shell-page/page-html'

const STYLE = SHELL_HTML.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
const SCRIPT = SHELL_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''

/**
 * @desc 在受控环境下跑一遍壳页脚本，返回容器几何与遮罩层状态。
 * @param windowWidth 视口宽（CSS px）
 * @param windowHeight 视口高
 * @param landscape 设备是否已横屏（供 screen.orientation.type 使用）
 * @param coarse 是否触摸设备
 * @param canLock 是否提供可用的 orientation.lock
 */
const runShell = (
    windowWidth: number,
    windowHeight: number,
    { landscape = true, coarse = true, canLock = true } = {}
) => {
    const wrap: { style: Record<string, string> } = { style: {} }
    const frame = { addEventListener: () => {}, src: '' }
    const make = (id: string) => ({ id, hidden: false, disabled: false, textContent: '', addEventListener: () => {} })
    const els: Record<string, ReturnType<typeof make>> = {
        'shell-frame-wrap': wrap as unknown as ReturnType<typeof make>,
        'shell-loader': make('shell-loader'),
        'shell-hint': make('shell-hint'),
        'shell-rotate-btn': make('shell-rotate-btn'),
        'shell-hint-rotate': make('shell-hint-rotate'),
        'shell-hint-extra': make('shell-hint-extra')
    }
    const windowStub = {
        innerWidth: windowWidth,
        innerHeight: windowHeight,
        orientation: landscape ? 90 : 0,
        matchMedia: () => ({ matches: coarse }),
        addEventListener: () => {}
    }
    const documentStub = {
        fullscreenElement: null,
        documentElement: { requestFullscreen: canLock ? () => {} : undefined },
        addEventListener: () => {},
        getElementById: (id: string) => (id === 'shell-frame' ? frame : (els[id] ?? null))
    }
    const screenStub = {
        orientation: canLock
            ? { type: landscape ? 'landscape-primary' : 'portrait-primary', lock: () => {} }
            : undefined
    }

    new Function('window', 'document', 'screen', 'location', 'setTimeout', SCRIPT)(
        windowStub,
        documentStub,
        screenStub,
        { hash: '' },
        () => 0
    )
    return { style: wrap.style, frameSrc: frame.src, els }
}

describe('shell-page 视口适配契约', () => {
    it('窄屏：容器固定 1280px 宽并等比缩放', () => {
        const { style } = runShell(390, 844)
        assert.equal(style.width, '1280px', '容器应固定为桌面设计宽度')
        const scale = 390 / 1280
        assert.equal(style.transform, `scale(${scale})`, '窄屏应等比缩放')
        assert.equal(style.height, `${Math.ceil(844 / scale)}px`, '高度应按缩放比换算')
    })

    it('宽屏（≥1280px）：1:1 不缩放', () => {
        const { style } = runShell(1920, 1080)
        assert.equal(style.width, '1280px')
        assert.equal(style.transform, 'none', '宽屏不应缩放')
        assert.equal(style.height, '1080px')
    })

    it('iframe 指向同源主路由（相对路径，不硬编码域名）', () => {
        const { frameSrc } = runShell(390, 844)
        assert.equal(frameSrc, './')
        const frameTag = SHELL_HTML.match(/<iframe id="shell-frame"[^>]*>/)?.[0] ?? ''
        assert.ok(frameTag.length > 0, '未找到 shell-frame 标签')
        assert.ok(!/\ssrc=/.test(frameTag), 'iframe 不应带静态 src')
    })

    it('骨架挂点齐全，且没有多余的常驻控件', () => {
        for (const id of [
            'shell-loader',
            'shell-hint',
            'shell-hint-rotate',
            'shell-hint-extra',
            'shell-rotate-btn',
            'shell-frame-wrap',
            'shell-frame'
        ]) {
            assert.ok(SHELL_HTML.includes(`id="${id}"`), `缺少挂点 ${id}`)
        }
        // 曾按用户要求移除：右上角常驻全屏/切换按钮
        assert.ok(!SHELL_HTML.includes('shell-fs-toggle'), '不应有右上角全屏切换按钮')
        // 脚本引用的 DOM 必须都存在
        const ids = [...SCRIPT.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1])
        for (const id of ids) assert.ok(SHELL_HTML.includes(`id="${id}"`), `脚本引用了不存在的挂点 ${id}`)
    })

    it('构造器幂等：重复调用产出同一份文档', () => {
        assert.equal(buildShellHtml(), SHELL_HTML)
    })
})

describe('shell-page 衬线遮罩层契约', () => {
    it('刊头结构：品牌图标 + 眉标 + 主副标题 + 主行动按钮', () => {
        assert.ok(SHELL_HTML.includes('class="shell-brand-mark"'), '缺少品牌图标')
        assert.ok(SHELL_HTML.includes('shell-brand-label shell-serif'), '眉标未套用衬线类')
        assert.ok(SHELL_HTML.includes('shell-brand-title shell-serif'), '主标题未套用衬线类')
        assert.ok(SHELL_HTML.includes('shell-brand-sub shell-serif'), '副标题未套用衬线类')
        assert.ok(SHELL_HTML.includes('>切换至横屏开始使用</button>'), '缺少主行动按钮文案')
    })

    it('文案：品牌名 + 「鸣潮社区公益工具」副标题，无旧提示语与页脚', () => {
        assert.ok(SHELL_HTML.includes('椰果工具箱'), '缺少品牌名')
        assert.ok(SHELL_HTML.includes('鸣潮社区公益工具'), '副标题应为「鸣潮社区公益工具」')
        assert.ok(!SHELL_HTML.includes('鸣潮拉表工具'), '不应再有旧副标题')
        assert.ok(!SHELL_HTML.includes('建议横屏使用'), '不应出现旧提示语「建议横屏使用」')
        assert.ok(!SHELL_HTML.includes('当前环境不支持自动横屏'), '不应动态覆写按钮文案')
        // 页脚已按要求移除：整页只出现一次（即副标题那处）
        assert.equal(SHELL_HTML.match(/鸣潮社区公益工具/g)?.length, 1, '页脚应已移除')
        assert.ok(!SHELL_HTML.includes('shell-brand-foot'), '不应残留页脚样式或节点')
    })

    it('杂志衬线排版生效（衬线字体族 + 描边）', () => {
        assert.ok(/\.shell-serif\s*\{[^}]*serif/.test(STYLE), '缺少 .shell-serif 衬线字体族')
        assert.ok(STYLE.includes('-webkit-text-stroke'), '缺少描边（仿 welcome 页大标题）')
    })

    it('配色只有黑白（不跟随主题出现蓝/紫强调色）', () => {
        const themeVars = [...STYLE.matchAll(/var\((--theme-[\w-]+)/g)].map((m) => m[1])
        assert.deepEqual(themeVars, [], `遮罩层不应引用主题变量：${themeVars.join(', ')}`)
        const colors = [...STYLE.matchAll(/#[0-9a-fA-F]{6}\b|rgba?\([^)]*\)/g)].map((m) => m[0])
        assert.ok(colors.length > 0, '未解析到颜色字面量')
        const offenders = colors.filter((c) => {
            const hex = c.match(/^#([0-9a-fA-F]{6})$/)
            if (hex) return !['000000', 'ffffff'].includes(hex[1].toLowerCase())
            const rgb = c.match(/rgba?\(([^)]*)\)/)
            if (!rgb) return true
            const parts = rgb[1].split(',').map((s) => s.trim())
            return !(parts[0] === parts[1] && parts[1] === parts[2])
        })
        assert.deepEqual(offenders, [], `出现非黑白颜色：${offenders.join(', ')}`)
    })

    it('品牌图标保留 favicon-mono.svg 的原始配色（不单色化）', () => {
        const asset = readFileSync('src/lib/assets/favicon-mono.svg', 'utf8')
        const assetPaths = [...asset.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, ''))
        assert.ok(assetPaths.length > 0, 'favicon-mono.svg 未解析到路径')

        const markTag = SHELL_HTML.match(/<svg class="shell-brand-mark"[\s\S]*?<\/svg>/)?.[0] ?? ''
        assert.ok(markTag.length > 0, '未找到 shell-brand-mark 图标')
        const markPaths = [...markTag.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, ''))
        // 图标是 favicon 的前 N 条轮廓路径（末尾那条内圈细节在高对比小尺寸下是噪点，故不内联）
        assert.ok(markPaths.length > 0 && markPaths.length <= assetPaths.length)
        assert.deepEqual(markPaths, assetPaths.slice(0, markPaths.length), '品牌图标与 favicon 路径不一致')

        const fills = [...markTag.matchAll(/fill="([^"]+)"/g)].map((m) => m[1])
        assert.equal(fills.length, markPaths.length, '每条路径都应保留自己的 fill')
        assert.ok(!markTag.includes('currentColor'), '品牌图标不应改为 currentColor')
    })

    it('允许手机捏合缩放（viewport 未设禁令、未拦 touch-action）', () => {
        const viewport = SHELL_HTML.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? ''
        assert.ok(viewport.includes('user-scalable=yes'), 'viewport 应显式允许缩放')
        assert.ok(!/user-scalable=no/.test(viewport), '不应禁止缩放')
        assert.ok(!/maximum-scale=1(\D|$)/.test(viewport), '不应把最大缩放钉在 1')
        assert.ok(!/touch-action\s*:/.test(STYLE), '不应设置 touch-action 拦截缩放手势')
    })
})

describe('shell-page 横竖屏行为契约', () => {
    it('竖屏盖遮罩、横屏收起', () => {
        const portrait = runShell(390, 844, { landscape: false })
        assert.equal(portrait.els['shell-hint'].hidden, false, '竖屏应显示遮罩')
        assert.equal(portrait.els['shell-hint-rotate'].hidden, false, '竖屏应显示主行动按钮')

        const landscape = runShell(844, 390, { landscape: true })
        assert.equal(landscape.els['shell-hint'].hidden, true, '横屏应收起遮罩')
        assert.equal(landscape.els['shell-hint-rotate'].hidden, true, '横屏应收起主行动按钮')
    })

    it('桌面窄窗口（非触摸）不打扰', () => {
        const { els } = runShell(800, 1000, { landscape: false, coarse: false })
        assert.equal(els['shell-hint'].hidden, true, '非触摸设备不应盖遮罩')
    })

    it('方向必须取设备真实方向，不能按视口宽高比判断', () => {
        // 关键陷阱：容器被撑成 1280px 宽后，竖屏手机的 innerWidth 也大于 innerHeight，
        // 用宽高比判方向会让遮罩显隐整个反过来。这里直接断言竖屏时遮罩确实显示。
        const { els } = runShell(390, 844, { landscape: false })
        assert.equal(els['shell-hint'].hidden, false, '竖屏（宽<高）必须显示遮罩')
        // 且方向判定集中在一个函数里，别处不再各判一套
        const fn = SCRIPT.match(/function isLandscapeScreen\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
        assert.ok(fn.length > 0, '缺少统一的横屏判定函数')
        assert.ok(/orientationApi\.type/.test(fn), '应优先取 Screen Orientation API 的实际方向')
        assert.ok(/window\.orientation/.test(fn), '应保留旧 iOS 的 window.orientation 兜底')
        const outside = SCRIPT.split(fn).join('')
        // 两种写法都算：内联脚本里可能写 window.innerWidth 也可能写裸 innerWidth
        assert.ok(
            !/(?:window\.)?innerWidth\s*>\s*(?:window\.)?innerHeight/.test(outside),
            '宽高比判断只应出现在兜底分支'
        )
    })

    it('每次点击都真的重新请求横屏（不按「锁过」短路）', () => {
        const fn = SCRIPT.match(/async function requestLandscape\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
        assert.ok(fn.length > 0, '未找到 requestLandscape')
        // 方向锁会随退出全屏/切后台/系统旋转失效，缓存布尔值会变脏 →
        // 第二次点按钮毫无反应。
        assert.ok(!/landscapeLocked/.test(SCRIPT), '不应缓存「已锁定」状态')
        assert.ok(fn.includes('isLandscapeScreen()'), '应按当前真实方向早退')
        assert.ok(fn.includes('await enterFullscreen()'), '每次都应请求全屏')
        assert.ok(/orientationApi\.lock\('landscape'\)/.test(fn), '每次都应交出锁横屏请求')
    })
})
