/**
 * @desc /shell-page 的 HTML 产物构造器：拼出一份原生 HTML 壳页。
 *
 * 独立成模块（而非写在 +server.ts 里）是因为 SvelteKit 的 +server.ts 只允许导出
 * GET/POST/.../prerender 等固定名字，多导出任何一个都会 500（Invalid export）。
 *
 * 壳页做两件配套的事：
 *   1. 桌面视口适配：iframe 固定 1280px 宽渲染桌面布局，再等比缩放到屏幕宽度
 *      （窄屏缩小、宽屏 1:1），与参考项目 bilibili-toy-shell-page 的 applyViewport 一致。
 *   2. 竖屏遮罩层：竖屏时盖一层刊头式引导（仿 welcome-screen 的杂志排版：品牌图标 +
 *      细字距眉标 + 描边衬线大标题 + 双线分隔），主行动按钮「切换至横屏开始使用」。
 *      两者是配套的 —— 遮罩层承诺的「横屏后得到完整桌面布局」正是靠上面的 1280px 缩放兑现；
 *      没有缩放，横屏也只是窄屏布局，按钮就成了空头支票。
 *
 * 参考项目里还有横屏提示层的「切换横屏」按钮、身份透传等，其中强制横屏用的是 B 站 Toy SDK
 * （setContainerMode）。本壳页不用该 SDK，改为原生 Fullscreen API + Screen Orientation API；
 * 身份透传与壳页无关，不做。
 *
 * iframe 地址用相对路径 './'，同源指向本应用主路由（部署到哪就指向哪，无需硬编码域名）。
 */

/** @desc 桌面布局的设计宽度（px）：iframe 按它渲染，再缩放到实际屏幕 */
const DESKTOP_WIDTH = 1280

/**
 * @desc 品牌图标：src/lib/assets/favicon-mono.svg 的路径数据与原始配色，原样内联。
 *   内联而不是引文件：壳页是独立文档，内联可省一次请求、也不受跨文档路径影响；
 *   fill 保留原色（米白 + 棕）不做单色化，深色底上靠 CSS 白色光晕保证轮廓可见。
 */
const BRAND_MARK_PATHS = `<path d="M769 887.9c-245.9 154.5-571.7 80-726.1-165.9C10.3 670.1 0.8 613.4 14.6 553.6 55.1 378.1 287.7 226 333.8 197l1.1-0.6 1.4-0.9c1-0.6 1.9-1.3 2.9-1.9 68.3-42.9 288.3-169 456.2-131 59.9 13.6 106.9 47 139.7 99.2 154.4 246 79.8 571.7-166.1 726.1z m-424-667C295 252.4 77.6 397 40 559.5 27.8 612.2 36.3 662.2 65 708c146.8 233.7 456.3 304.4 690 157.7 233.7-146.8 304.6-456.3 157.8-690-28.9-46.1-70.5-75.5-123.3-87.5C624.9 50.9 395 189.7 350.3 217.7l-1.4 0.9-1.1 0.8c-1 0.5-1.9 1-2.8 1.5z" fill="#806e60"/>
<path d="M923.9 168.8C1074.7 409 1002.4 726 762 876.8 521.7 1027.7 204.8 955.3 54 715-96.8 474.7 325.5 217.7 341.7 207.4c20.2-12.4 431.4-278.8 582.2-38.6z" fill="#b8a494"/>
<path d="M86.6 619c32.3 51.4 132.3 54.9 262.5 9 130.1-45.8 270.5-134 368.4-231.3 97.8-97.3 138.2-188.9 105.9-240.3-32.3-51.4-132.4-54.9-262.5-9-130.1 45.8-270.5 134-368.4 231.3C94.6 476 54.3 567.6 86.6 619z" fill="#d9c8b9"/>`

/**
 * @desc 生成壳页样式表（纯 CSS，注入响应 HTML 的内联 <style>）。
 *   遮罩层配色固定为纯黑白，不读主应用主题变量（壳页是独立文档，也取不到），
 *   避免出现蓝/紫等与封面无关的强调色。
 */
const buildShellStyle = () => `
:root {
    color-scheme: dark;
    --shell-bg: #000000;
    --shell-fg: #ffffff;
    --shell-muted: rgba(255, 255, 255, 0.6);
    --shell-border: rgba(255, 255, 255, 0.22);
}

* {
    box-sizing: border-box;
}

html,
body {
    margin: 0;
    height: 100%;
    overflow: hidden;
    background: var(--shell-bg);
    color: var(--shell-fg);
    font-family: 'FangXinShu', system-ui, sans-serif;
}

/* 杂志衬线：大标题与眉标走衬线（Georgia / 宋体系），正文仍用应用无衬线体 */
.shell-serif {
    font-family: Georgia, 'Times New Roman', 'Songti SC', 'Noto Serif SC', 'SimSun', serif;
}

/* ── 桌面视口容器 ──
   iframe 按 1280px 宽渲染桌面布局，缩放适配当前屏幕（JS 计算 scale） */
#shell-frame-wrap {
    position: fixed;
    top: 0;
    left: 0;
    transform-origin: top left;
}

#shell-frame-wrap iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
}

/* 加载层与横屏遮罩层共用的满屏居中布局 */
#shell-loader,
#shell-hint {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 28px;
    text-align: center;
    background: var(--shell-bg);
}

#shell-loader[hidden],
#shell-hint[hidden],
#shell-hint-rotate[hidden],
#shell-hint-extra[hidden] {
    display: none;
}

#shell-loader {
    gap: 12px;
    font-size: 13px;
    color: var(--shell-muted);
}

.shell-spinner {
    width: 30px;
    height: 30px;
    border: 2px solid var(--shell-border);
    border-top-color: var(--shell-fg);
    border-radius: 50%;
    animation: shell-spin 0.9s linear infinite;
}

@keyframes shell-spin {
    to {
        transform: rotate(360deg);
    }
}

/* ── 横屏遮罩层：仿 welcome 页刊头（品牌图标 + 细字距眉标 + 描边衬线大标题 + 双线分隔） ── */
#shell-hint {
    z-index: 2;
}

.shell-brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100%;
    max-width: 40rem;
}

/* 原始配色的品牌图标：深色底上补一圈白色光晕，保证米白部分不糊进背景 */
.shell-brand-mark {
    display: block;
    width: 64px;
    height: 64px;
    filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.45));
}

.shell-brand-label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.42em;
    text-transform: uppercase;
    color: var(--shell-fg);
    opacity: 0.8;
}

.shell-brand-main {
    width: 100%;
    padding: 18px 0;
    border-top: 1px solid var(--shell-border);
    border-bottom: 1px solid var(--shell-border);
}

.shell-brand-title,
.shell-brand-sub {
    display: block;
    margin: 0;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.02;
    -webkit-text-stroke: 2px #000000;
    paint-order: stroke fill;
}

.shell-brand-title {
    font-size: clamp(2rem, 6.5vw, 3.25rem);
    color: var(--shell-fg);
}

.shell-brand-sub {
    margin-top: 6px;
    font-size: clamp(1.15rem, 3.6vw, 1.9rem);
    color: var(--shell-fg);
    opacity: 0.82;
}

/* 主行动：切换至横屏开始使用（黑底白字里的反转按钮） */
.shell-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 24px;
    border: 1px solid var(--shell-fg);
    border-radius: 0;
    background: var(--shell-fg);
    color: #000000;
    font-family: inherit;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition:
        background 0.2s ease,
        color 0.2s ease,
        opacity 0.2s ease;
}

.shell-btn:hover:not(:disabled) {
    background: transparent;
    color: var(--shell-fg);
}

.shell-btn:disabled {
    cursor: default;
    opacity: 0.5;
}

.shell-hint-extra {
    margin: 0;
    max-width: 26rem;
    font-size: 12px;
    line-height: 1.7;
    color: var(--shell-muted);
}
`

/**
 * @desc 生成壳页脚本（内联普通脚本，不参与应用打包，无框架依赖）。
 */
const buildShellScript = () => `
/* ── DOM 引用 ── */
const frame = document.getElementById('shell-frame')
const wrap = document.getElementById('shell-frame-wrap')
const loader = document.getElementById('shell-loader')
const hint = document.getElementById('shell-hint')
const rotateBtn = document.getElementById('shell-rotate-btn')
const rotateActions = document.getElementById('shell-hint-rotate')
const extraHint = document.getElementById('shell-hint-extra')

/* ── 原生能力探测 ──
   原生强制横屏需要：Screen Orientation API 的 lock 可调用，且已处于全屏上下文
   （非全屏时浏览器以 NotAllowedError 拒绝锁方向；iOS Safari 无此能力）。
   注：Firefox for Android 从 144 起才实现 lock()，更早版本这里探测为不支持。 */
const orientationApi = screen.orientation
const canLockOrientation = Boolean(orientationApi && typeof orientationApi.lock === 'function')
const canFullscreen = typeof document.documentElement.requestFullscreen === 'function'

/* ── 桌面视口适配 ──
   手机等窄屏：iframe 固定 1280px 宽渲染桌面布局，等比缩放到屏幕宽度；
   桌面（>= 1280px）：不缩放，全屏。 */
function applyViewport() {
    const scale = Math.min(1, window.innerWidth / ${DESKTOP_WIDTH})
    wrap.style.width = '${DESKTOP_WIDTH}px'
    wrap.style.height = Math.ceil(window.innerHeight / scale) + 'px'
    wrap.style.transform = scale < 1 ? 'scale(' + scale + ')' : 'none'
}

function isFullscreen() {
    return document.fullscreenElement !== null
}

/*
 * 设备是否已经横过来。
 *
 * ⚠️ 不能用「视口宽度大于高度」判断：容器被缩放到 1280px 宽后，竖屏手机的
 * 视口宽度依然大于高度，宽高比会把竖屏误判成横屏。必须取设备真实方向：
 *   1. screen.orientation.type（标准，Chrome/Firefox 均可用）；
 *   2. window.orientation（旧 iOS Safari 的 -90/90 表示横屏）；
 *   3. 兜底才退回宽高比。
 */
function isLandscapeScreen() {
    if (orientationApi && typeof orientationApi.type === 'string' && orientationApi.type) {
        return orientationApi.type.indexOf('landscape') === 0
    }
    if (typeof window.orientation === 'number') {
        return Math.abs(window.orientation) === 90
    }
    return window.innerWidth > window.innerHeight
}

/* 竖屏 + 触摸设备才盖遮罩（桌面窄窗口竖屏不打扰用户） */
function isTouchPortrait() {
    return !isLandscapeScreen() && window.matchMedia('(pointer: coarse)').matches
}

/* ── 横竖屏切换 ──
   只要回到竖屏就重新盖遮罩，用户随时能再点一次按钮切回去。 */

/* 遮罩层主行动：横屏时整块收起；竖屏时恒定可用可点 */
function updateRotateAction() {
    const landscape = isLandscapeScreen()
    rotateActions.hidden = landscape
    extraHint.hidden = landscape
    if (landscape) return
    rotateBtn.disabled = false
    rotateBtn.textContent = '切换至横屏开始使用'
}

/* ── 遮罩层显隐 ── */
function updateControls() {
    const hintVisible = isTouchPortrait()
    hint.hidden = !hintVisible
    updateRotateAction()
}

/* ── 强制横屏 ── */
async function enterFullscreen() {
    if (isFullscreen() || !canFullscreen) return false
    try {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
        return true
    } catch {
        /* 用户拒绝 / 浏览器策略拒绝：静默降级，交给遮罩层 */
        return false
    }
}

/*
 * 请求全屏 + 锁 landscape。
 *
 * 每次调用都真的发起一次请求，绝不按「上次锁成功过」短路：
 * 方向锁会随「退出全屏」「切到后台」「系统旋转」自动失效，缓存一个「已锁」布尔值
 * 会变成永远为真的脏状态 —— 表现就是第二次点按钮毫无反应。
 * 是否已经横屏只用于早退判断，判据取当前真实方向，不取历史状态。
 */
async function requestLandscape() {
    if (!canLockOrientation) return false
    if (isLandscapeScreen()) return true
    await enterFullscreen()
    try {
        await orientationApi.lock('landscape')
        return true
    } catch {
        return false
    }
}

/* ── hash 透传 ──
   壳页 URL 的 hash（#import_project= / #websocket= 等）随首次加载一并带给同源 iframe，
   由主路由的 hash 动作系统分发。 */
function syncFrameHash() {
    if (!location.hash || !frame.contentWindow) return
    try {
        if (frame.contentWindow.location.hash !== location.hash) {
            frame.contentWindow.location.hash = location.hash
        }
    } catch {
        /* 非同源（理论上不会发生）：放弃 hash 透传，不阻塞主体功能 */
    }
}

/* ── 事件绑定 ── */
window.addEventListener('resize', () => {
    applyViewport()
    updateControls()
})

window.addEventListener('orientationchange', () => {
    /* 旋转动画结束后视口尺寸才稳定，延后一帧级别重算 */
    setTimeout(() => {
        applyViewport()
        updateControls()
    }, 200)
})

window.addEventListener('hashchange', syncFrameHash)
document.addEventListener('fullscreenchange', updateControls)

/* 遮罩层主行动：进全屏 + 锁横屏。禁用态只是点击期间的瞬时反馈，
   文案与可用性统一由 updateRotateAction 决定。 */
rotateBtn.addEventListener('click', async () => {
    rotateBtn.disabled = true
    await requestLandscape()
    updateControls()
})

/* ── 初始化 ── */
frame.addEventListener('load', () => {
    loader.hidden = true
})
/* 网络异常时兜底收起加载层，避免永久白屏 */
setTimeout(() => {
    loader.hidden = true
}, 12000)

applyViewport()
updateControls()
/* 壳页 URL 的 hash 随首次加载一并带上 */
frame.src = './' + location.hash

/* 进来自动请求横屏，无需用户先点按钮（真锁不上时遮罩层仍在，用户可手动再试） */
if (isTouchPortrait() && canLockOrientation) {
    void requestLandscape().then(updateControls)
}
`

/**
 * @desc 生成壳页完整 HTML 文档。
 * @returns 可直接作为响应体写出的 HTML 字符串
 */
export const buildShellHtml = () => {
    const style = buildShellStyle()
    const script = buildShellScript()

    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=yes" />
<meta name="color-scheme" content="dark" />
<title>椰果工具箱</title>
<style>${style}</style>
</head>
<body>
<div id="shell-loader">
<span class="shell-spinner"></span>
<span>正在加载椰果工具箱…</span>
</div>

<div id="shell-hint" hidden>
<div class="shell-brand">
<svg class="shell-brand-mark" viewBox="0 0 1024 1024" aria-hidden="true">${BRAND_MARK_PATHS}</svg>
<span class="shell-brand-label shell-serif">Wuthering Waves Coconut Toolbox</span>
<div class="shell-brand-main">
<span class="shell-brand-title shell-serif">椰果工具箱</span>
<span class="shell-brand-sub shell-serif">鸣潮社区公益工具</span>
</div>
<div id="shell-hint-rotate">
<button type="button" class="shell-btn" id="shell-rotate-btn">切换至横屏开始使用</button>
</div>
<p class="shell-hint-extra" id="shell-hint-extra">排轴 / 拉表 / 配装 / 伤害计算，横屏获得完整桌面布局</p>
</div>
</div>

<div id="shell-frame-wrap">
<iframe id="shell-frame" title="椰果工具箱" allow="fullscreen; autoplay; clipboard-write"></iframe>
</div>

<script>${script}</script>
</body>
</html>
`
}

/** @desc 壳页 HTML 在模块加载时生成一次，每次响应直接复用 */
export const SHELL_HTML = buildShellHtml()
