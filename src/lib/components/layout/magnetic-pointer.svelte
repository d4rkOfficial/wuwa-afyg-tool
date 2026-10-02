<script lang="ts">
    import { browser } from '$app/environment'
    import { getMagneticForcedOff, getMagneticPointer } from '$lib/data/render-prefs.svelte'
    import { getActiveId, getOverrides } from '$lib/theme'
    import {
        BORDER_W,
        DRAG_MODES,
        EXCLUDE_SELECTOR,
        FOLLOW_MS,
        SENSITIVITY,
        SPIN_S,
        WOBBLE,
        cursorToken,
        findDragMode,
        findMagneticTarget,
        modeForCursor,
        type PointerMode
    } from './magnetic-pointer.utils'

    /* ── Tailwind 类名（整改前这里是 514 行手写 `<style>`，逐条搬迁）──
       搬迁口径：
         · 根元素挂 `group` 当状态锚点，后代状态写 `group-data-[mode=…]:`（旧 `.magnetic-pointer[data-mode='…'] .mp-x`）；
         · 后代里的拖动态写 `group-[.mp-dragging]:`，根元素自身的拖动态写 `[&.mp-dragging]:`；
         · `:nth-child(n)` / `:nth-child(n)::before` 逐个 unroll 到对应子元素（见 CORNER_AT）；
         · 状态类（`mp-wobble` / `mp-dot-hidden` / `mp-dragging`）沿用组件已有的 class 标记，
           DOM 结构不变，故新旧可逐元素对照计算样式。 */

    /**
     * 旧 `.magnetic-pointer`（`--mp-w/--mp-h` 由 JS 覆盖，这里只是首帧默认值）+ 旧 `.magnetic-pointer.mp-dragging`。
     * `group` 是后代状态选择器的锚点（旧 `.magnetic-pointer[data-mode='…'] .mp-x` 的等价物）。
     * 层级刻意保留原值（999 / 1000）而**不**收进 `--z-*` token：光标必须压过包括最顶层气泡在内的
     * 全部界面，不属于「弹窗层级阶梯」，且 layout.css 的 token 说明里写明数列是与整改前逐一对齐的。
     */
    const ROOT_CLASS = [
        'group fixed top-[calc(var(--mp-h)/-2)] left-[calc(var(--mp-w)/-2)] h-(--mp-h) w-(--mp-w) z-[999]',
        'pointer-events-none [--mp-w:28px] [--mp-h:28px] [--mp-follow:0.2s]',
        'transition-[width,height,transform] duration-[var(--mp-follow,0.2s)] ease-[ease-out]',
        // 拖动中：固定 28px 圆环 + 主题亮化描边 + accent 发光，不随吸附目标/容器放大
        '[&.mp-dragging]:top-[-14px] [&.mp-dragging]:left-[-14px] [&.mp-dragging]:h-[28px] [&.mp-dragging]:w-[28px]',
        '[&.mp-dragging]:rounded-[9999px] [&.mp-dragging]:border-2 [&.mp-dragging]:border-(--mp-border,#ffffff)',
        '[&.mp-dragging]:bg-transparent [&.mp-dragging]:animate-none',
        '[&.mp-dragging]:shadow-[0_0_10px_color-mix(in_srgb,var(--theme-accent-bg)_45%,transparent)]'
    ].join(' ')

    /** 旧 `.mp-corners` + `[data-mode='default']` 正/反向旋转 + `[data-mode='pointer'] .mp-wobble` 晃动 */
    const CORNERS_CLASS = [
        'absolute inset-0',
        // 平时（default）四角缓慢旋转；时长来自 `--mp-spin`（JS 写入 SPIN_S），见 layout.css 的 --animate-mp-spin
        'group-data-[mode=default]:animate-mp-spin',
        // 按住拖动时按位移主轴反向：右/下 → 逆时针
        'group-data-[mode=default]:group-[.mp-spin-ccw]:animate-mp-spin-reverse',
        // 吸附晃动：`mp-wobble` 本身只在 pointer 模式挂上（class:mp-wobble 已含该条件），故无需再判 mode
        '[&.mp-wobble]:animate-mp-wobble',
        // 旧 `.magnetic-pointer.mp-dragging .mp-corners { display: none !important }`
        'group-[.mp-dragging]:hidden!'
    ].join(' ')

    /** 四角位置即身份（1 左上 / 2 右上 / 3 左下 / 4 右下） */
    type CornerIndex = 1 | 2 | 3 | 4

    /**
     * 旧 `.mp-corner`（10×10 L 形边框）+ 旧 `.mp-corner::before`（1px 昼夜/黑白描边）+ 显示开关。
     * 边框用 `border-width: 2px 0 0 2px` 这类四值简写表达「只亮两条边」——与整改前的
     * `border-top-width/border-left-width` 两条声明等价（其余两侧保持 0）。
     */
    const CORNER_BASE = [
        'mp-corner absolute hidden h-[10px] w-[10px] border-0 border-(--theme-accent-bg,#6366f1)',
        'drop-shadow-[0_0_3px_color-mix(in_srgb,var(--theme-accent-bg,#6366f1)_45%,transparent)]',
        // 旧 `[data-mode='default'] .mp-corner, [data-mode='pointer'] .mp-corner { display: block }`
        // 与旧 `:not([data-mode='default']):not([data-mode='pointer']) .mp-corner { display: none }` 互补
        'group-data-[mode=default]:block group-data-[mode=pointer]:block',
        // 旧 `.magnetic-pointer.mp-dragging .mp-corner { display: none !important }`
        'group-[.mp-dragging]:hidden!',
        // 旧 `.mp-corner::before`：复刻 L 形描边，避免 outline 画成矩形
        "[&::before]:absolute [&::before]:inset-0 [&::before]:border-0 [&::before]:border-(--mp-border,#ffffff) [&::before]:content-['']"
    ].join(' ')

    /** 旧 `.mp-corner:nth-child(n)` + `.mp-corner:nth-child(n)::before`（逐个 unroll，位置即身份） */
    const CORNER_AT: Record<CornerIndex, string> = {
        1: '[&:nth-child(1)]:top-0 [&:nth-child(1)]:left-0 [&:nth-child(1)]:rounded-tl-[3px] [&:nth-child(1)]:[border-width:2px_0_0_2px] [&:nth-child(1)::before]:[border-width:1px_0_0_1px]',
        2: '[&:nth-child(2)]:top-0 [&:nth-child(2)]:right-0 [&:nth-child(2)]:rounded-tr-[3px] [&:nth-child(2)]:[border-width:2px_2px_0_0] [&:nth-child(2)::before]:[border-width:1px_1px_0_0]',
        3: '[&:nth-child(3)]:bottom-0 [&:nth-child(3)]:left-0 [&:nth-child(3)]:rounded-bl-[3px] [&:nth-child(3)]:[border-width:0_0_2px_2px] [&:nth-child(3)::before]:[border-width:0_0_1px_1px]',
        4: '[&:nth-child(4)]:bottom-0 [&:nth-child(4)]:right-0 [&:nth-child(4)]:rounded-br-[3px] [&:nth-child(4)]:[border-width:0_2px_2px_0] [&:nth-child(4)::before]:[border-width:0_1px_1px_0]'
    }

    /** 旧 `.mp-glyph`：8 个动作模式（default/pointer 之外的全体）显示字形并居中，颜色取主题主色 */
    const GLYPH_CLASS = [
        'absolute inset-0 hidden items-center justify-center text-(--theme-accent-bg,#6366f1)',
        'group-data-[mode=text]:flex group-data-[mode=grab]:flex group-data-[mode=move]:flex',
        'group-data-[mode=resize-h]:flex group-data-[mode=resize-v]:flex group-data-[mode=resize-diag]:flex',
        'group-data-[mode=crosshair]:flex group-data-[mode=range]:flex',
        // 旧 `.magnetic-pointer.mp-dragging .mp-glyph { display: none !important }`
        'group-[.mp-dragging]:hidden!'
    ].join(' ')

    /** 旧 `.mp-glyph-text, .mp-glyph-cross i, .mp-glyph-h/v/diag .line, .mp-glyph-grab i { outline: 1px solid … }` */
    const GLYPH_OUTLINE = 'outline-1 outline-solid outline-(--mp-border,#ffffff)'

    /** 旧 `.mp-glyph-text`：文本 I-beam（`::before`/`::after` 是上下两条 8×2 的横杠） */
    const GLYPH_TEXT_CLASS = [
        'relative hidden h-[14px] w-(--mp-border-w,1px) rounded-[1px] bg-current',
        'group-data-[mode=text]:block',
        GLYPH_OUTLINE,
        '[&::before]:absolute [&::after]:absolute [&::before]:left-1/2 [&::after]:left-1/2',
        '[&::before]:-translate-x-1/2 [&::after]:-translate-x-1/2 [&::before]:h-[2px] [&::after]:h-[2px]',
        '[&::before]:w-[8px] [&::after]:w-[8px] [&::before]:rounded-[1px] [&::after]:rounded-[1px]',
        '[&::before]:bg-current [&::after]:bg-current',
        "[&::before]:-top-[2px] [&::after]:-bottom-[2px] [&::before]:content-[''] [&::after]:content-['']"
    ].join(' ')

    /** 旧 `.mp-glyph-grab`：2×2 圆点抓手 */
    const GLYPH_GRAB_CLASS = 'hidden h-[13px] w-[13px] flex-wrap gap-[3px] group-data-[mode=grab]:flex'
    /** 旧 `.mp-glyph-grab i` */
    const GRAB_DOT_CLASS = `h-[4px] w-[4px] rounded-[50%] bg-current shadow-[0_0_4px_color-mix(in_srgb,currentColor_50%,transparent)] ${GLYPH_OUTLINE}`

    /** 旧 `.mp-glyph-h/-v/-diag` 的公共部分（显示开关 + 居中 + 1px 间距） */
    const ARROW_BASE = 'hidden items-center justify-center gap-[1px]'
    /** 旧 `.mp-glyph-h` */
    const GLYPH_H_CLASS = `${ARROW_BASE} group-data-[mode=resize-h]:flex`
    /** 旧 `.mp-glyph-v`（多一条 flex-direction: column） */
    const GLYPH_V_CLASS = `${ARROW_BASE} flex-col group-data-[mode=resize-v]:flex`
    /** 旧 `.mp-glyph-diag`（多一条 transform: rotate(45deg)，改为 Tailwind 的 rotate 独立属性，几何等价） */
    const GLYPH_DIAG_CLASS = `${ARROW_BASE} rotate-45 group-data-[mode=resize-diag]:flex`

    /** 旧 `.mp-glyph-h/v/diag .line { background: currentColor; border-radius: 1px }` */
    const ARROW_LINE_BASE = `bg-current rounded-[1px] ${GLYPH_OUTLINE}`
    /** 旧 `.mp-glyph-h .line` */
    const ARROW_H_LINE_CLASS = `${ARROW_LINE_BASE} h-[14px] w-(--mp-border-w,1px)`
    /** 旧 `.mp-glyph-v .line` */
    const ARROW_V_LINE_CLASS = `${ARROW_LINE_BASE} h-[12px] w-(--mp-border-w,1px)`
    /** 旧 `.mp-glyph-diag .line` */
    const ARROW_DIAG_LINE_CLASS = `${ARROW_LINE_BASE} h-(--mp-border-w,1px) w-[12px]`

    /* 双向箭头：本质是「宽高为 0 + 四条 border」的三角形（边框宽随 --mp-border-w 成比例，故用 calc 乘法）。
       旧 CSS 对每个三角形各写 3 条 border-* 声明，这里对应的工具类逐条照搬。 */
    /** 旧 `.mp-glyph-h .tri-l/.tri-r` 的公共部分 */
    const TRI_H_BASE = 'h-0 w-0 border-y-[calc(var(--mp-border-w,1px)*3)] border-y-transparent'
    /** 旧 `.mp-glyph-h .tri-l` */
    const TRI_H_L = `${TRI_H_BASE} border-r-[calc(var(--mp-border-w,1px)*4)] border-r-current`
    /** 旧 `.mp-glyph-h .tri-r` */
    const TRI_H_R = `${TRI_H_BASE} border-l-[calc(var(--mp-border-w,1px)*4)] border-l-current`
    /** 旧 `.mp-glyph-v .tri-u` */
    const TRI_V_U = `h-0 w-0 border-x-[calc(var(--mp-border-w,1px)*3)] border-x-transparent border-b-[calc(var(--mp-border-w,1px)*4)] border-b-current`
    /** 旧 `.mp-glyph-v .tri-d` */
    const TRI_V_D = `h-0 w-0 border-x-[calc(var(--mp-border-w,1px)*3)] border-x-transparent border-t-[calc(var(--mp-border-w,1px)*4)] border-t-current`
    /** 旧 `.mp-glyph-diag .tri-ul/.tri-dr` 的公共部分 */
    const TRI_DIAG_BASE = 'h-0 w-0 border-y-[calc(var(--mp-border-w,1px)*2.5)] border-y-transparent'
    /** 旧 `.mp-glyph-diag .tri-ul` */
    const TRI_DIAG_UL = `${TRI_DIAG_BASE} border-r-[calc(var(--mp-border-w,1px)*3.5)] border-r-current`
    /** 旧 `.mp-glyph-diag .tri-dr` */
    const TRI_DIAG_DR = `${TRI_DIAG_BASE} border-l-[calc(var(--mp-border-w,1px)*3.5)] border-l-current`

    /** 旧 `.mp-glyph-move`：四向箭头（20×20 容器 + 四个绝对定位三角形） */
    const GLYPH_MOVE_CLASS = 'relative hidden h-[20px] w-[20px] group-data-[mode=move]:block'
    /** 旧 `.mp-glyph-move .tri-u/-d/-l/-r` 的公共部分 */
    const MOVE_TRI_BASE = 'absolute h-0 w-0'
    /** 旧 `.mp-glyph-move .tri-u` */
    const MOVE_TRI_U = `${MOVE_TRI_BASE} top-0 left-1/2 -translate-x-1/2 border-x-[calc(var(--mp-border-w,1px)*2.5)] border-x-transparent border-b-[calc(var(--mp-border-w,1px)*3.5)] border-b-current`
    /** 旧 `.mp-glyph-move .tri-d` */
    const MOVE_TRI_D = `${MOVE_TRI_BASE} bottom-0 left-1/2 -translate-x-1/2 border-x-[calc(var(--mp-border-w,1px)*2.5)] border-x-transparent border-t-[calc(var(--mp-border-w,1px)*3.5)] border-t-current`
    /** 旧 `.mp-glyph-move .tri-l` */
    const MOVE_TRI_L = `${MOVE_TRI_BASE} top-1/2 left-0 -translate-y-1/2 border-y-[calc(var(--mp-border-w,1px)*2.5)] border-y-transparent border-r-[calc(var(--mp-border-w,1px)*3.5)] border-r-current`
    /** 旧 `.mp-glyph-move .tri-r` */
    const MOVE_TRI_R = `${MOVE_TRI_BASE} top-1/2 right-0 -translate-y-1/2 border-y-[calc(var(--mp-border-w,1px)*2.5)] border-y-transparent border-l-[calc(var(--mp-border-w,1px)*3.5)] border-l-current`

    /** 旧 `.mp-glyph-cross`：空心十字准星（crosshair/range 显示，且整体跟着 --mp-spin 旋转） */
    const GLYPH_CROSS_CLASS = [
        'relative hidden h-[20px] w-[20px]',
        'group-data-[mode=crosshair]:block group-data-[mode=range]:block',
        'group-data-[mode=crosshair]:animate-mp-spin group-data-[mode=range]:animate-mp-spin',
        'group-data-[mode=crosshair]:group-[.mp-spin-ccw]:animate-mp-spin-reverse',
        'group-data-[mode=range]:group-[.mp-spin-ccw]:animate-mp-spin-reverse'
    ].join(' ')

    /** 旧 `.mp-cross-inner`：呼吸（内层缩放，与旋转分离） */
    const CROSS_INNER_CLASS = 'absolute inset-0 animate-mp-breathe'
    /** 旧 `.mp-glyph-cross i`：4 段短线，中心镂空 8px */
    const CROSS_BAR_BASE = `absolute rounded-[1px] bg-current ${GLYPH_OUTLINE}`
    /** 旧 `.mp-glyph-cross i:nth-child(1..4)` */
    const CROSS_AT: Record<1 | 2 | 3 | 4, string> = {
        1: '[&:nth-child(1)]:top-0 [&:nth-child(1)]:left-1/2 [&:nth-child(1)]:-translate-x-1/2 [&:nth-child(1)]:h-[6px] [&:nth-child(1)]:w-(--mp-border-w,1px)',
        2: '[&:nth-child(2)]:bottom-0 [&:nth-child(2)]:left-1/2 [&:nth-child(2)]:-translate-x-1/2 [&:nth-child(2)]:h-[6px] [&:nth-child(2)]:w-(--mp-border-w,1px)',
        3: '[&:nth-child(3)]:top-1/2 [&:nth-child(3)]:left-0 [&:nth-child(3)]:-translate-y-1/2 [&:nth-child(3)]:h-(--mp-border-w,1px) [&:nth-child(3)]:w-[6px]',
        4: '[&:nth-child(4)]:top-1/2 [&:nth-child(4)]:right-0 [&:nth-child(4)]:-translate-y-1/2 [&:nth-child(4)]:h-(--mp-border-w,1px) [&:nth-child(4)]:w-[6px]'
    }

    /** 旧 `.mp-dot`（中心点：钉在鼠标实时位置）+ `.mp-dot-hidden` + `.mp-dot.mp-dragging` */
    const DOT_CLASS = [
        'pointer-events-none fixed top-[-2px] left-[-2px] z-[1000] h-[4px] w-[4px]',
        'rounded-[9999px] bg-(--theme-accent-bg,#6366f1)',
        'outline-1 outline-solid outline-(--mp-border,#ffffff)',
        'shadow-[0_0_6px_color-mix(in_srgb,var(--theme-accent-bg,#6366f1)_60%,transparent)]',
        'motion-reduce:hidden',
        // 十字/拖动条/文本/横向拖拽模式隐藏（保证空心准星视觉）
        '[&.mp-dot-hidden]:hidden',
        // 旧 `.mp-dot.mp-dragging { display: block !important }`：拖动中恒显示，压过上面的隐藏
        '[&.mp-dragging]:block!'
    ].join(' ')

    let enabled = $derived(getMagneticPointer())
    // 瞬时抑制（工坊 iframe 弹窗等）：强制恢复系统光标
    let forcedOff = $derived(getMagneticForcedOff())

    // 触摸主指针设备（手机/平板）：磁力光标对触摸无意义，自动禁用（含运行中切换检测）
    let coarsePointer = $state(false)
    // 减弱动态效果：跟随系统设置实时变化（CSS 兜底 + JS 状态同步）
    let reducedMotion = $state(false)

    $effect(() => {
        if (!browser) return
        const coarse = window.matchMedia('(pointer: coarse)')
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
        coarsePointer = coarse.matches
        reducedMotion = motion.matches
        const onCoarse = (e: MediaQueryListEvent) => (coarsePointer = e.matches)
        const onMotion = (e: MediaQueryListEvent) => (reducedMotion = e.matches)
        coarse.addEventListener('change', onCoarse)
        motion.addEventListener('change', onMotion)
        return () => {
            coarse.removeEventListener('change', onCoarse)
            motion.removeEventListener('change', onMotion)
        }
    })

    // 实际生效条件：开关开启 + 未强制关闭 + 非触摸设备 + 未减弱动态效果
    let active = $derived(enabled && !forcedOff && !coarsePointer && !reducedMotion)

    let pointerEl = $state<HTMLDivElement | null>(null)
    let dotEl = $state<HTMLDivElement | null>(null)
    let currentTarget: HTMLElement | null = null
    let mode = $state<PointerMode>('default')
    // 左键按住：外框过渡 0ms、跳过磁吸，保持按下瞬间的相对偏移"接近"中心点（拖拽模式除外，需精确对准）
    let pressed = $state(false)
    let pressOffset = $state<{ x: number; y: number } | null>(null)
    // 拖动中（按下后位移超过阈值）：隐藏磁力光标并恢复系统光标，松手后重新显示。
    // 阈值避免单纯点击（按下即松开）导致光标闪烁。
    let dragging = $state(false)
    let dragStart = $state({ x: 0, y: 0 })
    let framePos = $state({ x: 0, y: 0 })
    // 吸附晃动：每次框选新目标时递增，触发 #key 重建让晃动动画重播
    let attachKey = $state(0)
    // 旋转方向：按住拖动时按位移主轴判定（右/下→逆时针，左/上→顺时针）
    let spinCcw = $state(false)
    let lastPointer = $state({ x: 0, y: 0 })
    // 最近一次鼠标位置（scroll/尺寸变化时复用重算吸附位置）
    let lastMouse = $state({ x: 0, y: 0 })
    // rAF 节流：高频 pointermove 合并到每帧一次，避免磁吸时每事件强制 reflow
    let moveRaf: number | null = null
    let follow = $derived(DRAG_MODES.has(mode) || pressed ? 0 : FOLLOW_MS)

    function setSize(rect: DOMRect) {
        const pad = Math.max(8, innerWidth / 100)
        pointerEl?.style.setProperty('--mp-w', `${Math.max(28, rect.width + pad)}px`)
        pointerEl?.style.setProperty('--mp-h', `${Math.max(28, rect.height + pad)}px`)
    }

    function resetSize() {
        pointerEl?.style.setProperty('--mp-w', '28px')
        pointerEl?.style.setProperty('--mp-h', '28px')
    }

    function attachTarget(el: Element) {
        if (currentTarget === el) return
        currentTarget = el as HTMLElement
        setSize((el as HTMLElement).getBoundingClientRect())
        if (WOBBLE > 0) attachKey++
    }

    function detachTarget() {
        if (!currentTarget) return
        currentTarget = null
        resetSize()
    }

    /** 钳制外框中心坐标：外框任何部分都不离开屏幕边界 */
    function clampFrame(x: number, y: number): { x: number; y: number } {
        if (!pointerEl) return { x, y }
        const w = parseFloat(pointerEl.style.getPropertyValue('--mp-w')) || 28
        const h = parseFloat(pointerEl.style.getPropertyValue('--mp-h')) || 28
        const vw = document.documentElement.clientWidth
        const vh = document.documentElement.clientHeight
        if (w >= vw) x = vw / 2
        else x = Math.min(Math.max(x, w / 2), vw - w / 2)
        if (h >= vh) y = vh / 2
        else y = Math.min(Math.max(y, h / 2), vh - h / 2)
        return { x, y }
    }

    /** 计算并应用外框位置（rAF 帧内执行一次；scroll/resize/目标尺寸变化时复用） */
    function updateFrame(mx: number, my: number) {
        if (!pointerEl) return
        let x = mx
        let y = my
        // 拖动中：圆环中心钉在鼠标位置（与 mp-dot 中心点重合），忽略按下偏移与磁吸
        if (dragging) {
            x = mx
            y = my
            // 磁力吸附（仅 pointer 模式，即真正可点击目标）：目标上时光标向目标中心 lerp，
            // 鼠标在按钮内移动时光标钉在按钮上。resize/grab/move 等拖拽光标（如 sidebar 拖拽线）
            // 不放大吸附——外框保持固定大小，避免拖拽线上出现放大边框。
        } else if (!pressed && !dragging && mode === 'pointer' && currentTarget && currentTarget.isConnected) {
            // 磁力吸附：目标上时光标向目标中心 lerp（灵敏度 = 跟手系数），鼠标在按钮内移动时光标钉在按钮上
            const rect = currentTarget.getBoundingClientRect()
            // 目标尺寸变化（hover 缩放/布局变化）时刷新外框尺寸，避免框与目标脱节
            const pad = Math.max(8, innerWidth / 100)
            const wantW = Math.max(28, rect.width + pad)
            const wantH = Math.max(28, rect.height + pad)
            const curW = parseFloat(pointerEl.style.getPropertyValue('--mp-w')) || 28
            const curH = parseFloat(pointerEl.style.getPropertyValue('--mp-h')) || 28
            if (Math.abs(wantW - curW) > 1 || Math.abs(wantH - curH) > 1) setSize(rect)
            const cx = rect.left + rect.width / 2
            const cy = rect.top + rect.height / 2
            const k = SENSITIVITY
            x = cx + (x - cx) * k
            y = cy + (y - cy) * k
        } else if (pressed && pressOffset) {
            // 左键按住（未达拖动阈值）：按按下瞬间的相对偏移跟随（接近但不重合）
            x += pressOffset.x
            y += pressOffset.y
        }
        // 外框不离开屏幕边界
        const clamped = clampFrame(x, y)
        x = clamped.x
        y = clamped.y
        framePos = { x, y }
        pointerEl.style.transform = `translate(${x}px, ${y}px)`
        // 拖动中：中心点跟随 clamp 后的圆环中心，保证小圆点始终在圆形框正中（屏幕边缘也不脱心）
        if (dragging) dotEl?.style.setProperty('transform', `translate(${x}px, ${y}px)`)
    }

    function onMove(e: PointerEvent) {
        // 按住后位移超过阈值 → 判定为拖动（外框切换为圆形闭合边框样式）；单纯点击不触发
        if (pressed && !dragging && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 4) {
            dragging = true
            // 圆形闭合边框：固定 28px 圆（不受吸附目标尺寸影响）
            resetSize()
        }
        // 按住拖动时按位移主轴更新旋转方向：右/下→逆时针，左/上→顺时针
        if (pressed) {
            const dx = e.clientX - lastPointer.x
            const dy = e.clientY - lastPointer.y
            if (Math.abs(dx) >= Math.abs(dy)) {
                if (dx !== 0) spinCcw = dx > 0
            } else if (dy !== 0) {
                spinCcw = dy > 0
            }
            lastPointer = { x: e.clientX, y: e.clientY }
        }
        // 中心点：始终钉在鼠标实时位置（无过渡）
        dotEl?.style.setProperty('transform', `translate(${e.clientX}px, ${e.clientY}px)`)
        lastMouse = { x: e.clientX, y: e.clientY }
        // rAF 节流：高频 pointermove 合并到每帧一次，磁吸时的 getBoundingClientRect/reflow 不再每事件触发
        if (moveRaf === null) {
            moveRaf = requestAnimationFrame(() => {
                moveRaf = null
                updateFrame(lastMouse.x, lastMouse.y)
            })
        }
    }

    /** 滚动/目标位移时按最近鼠标位置重算吸附（滚动容器内滚动后外框仍跟随目标） */
    function onAnyScroll() {
        if (!pointerEl || !currentTarget || !currentTarget.isConnected) return
        if (moveRaf === null) {
            moveRaf = requestAnimationFrame(() => {
                moveRaf = null
                updateFrame(lastMouse.x, lastMouse.y)
            })
        }
    }

    function onOver(e: MouseEvent) {
        const target = e.target as Element | null
        if (!target) {
            mode = 'default'
            detachTarget()
            return
        }
        // 拖动条（range 滑块）：隐藏系统光标，显示空心十字准星，实时跟随
        if (target.closest('input[type="range"]')) {
            detachTarget()
            mode = 'range'
            return
        }
        // 文本输入类：I-beam 模式，不磁吸，实时跟随
        if (target.closest('input:not([type="range"]), textarea, [contenteditable]')) {
            detachTarget()
            mode = 'text'
            return
        }
        if (target.closest(EXCLUDE_SELECTOR)) {
            mode = 'default'
            detachTarget()
            return
        }
        // 能点又能拖：优先拖拽/滑动样式（覆盖可点子元素）
        const dragMode = findDragMode(target)
        if (dragMode) {
            detachTarget()
            mode = dragMode
            return
        }
        const cursor = cursorToken(target)
        const cursorMode = modeForCursor(cursor)
        if (cursorMode !== 'default' && cursorMode !== 'pointer') {
            // 拖拽/文本/移动等动作：展示对应光标样式，不框选不磁吸
            detachTarget()
            mode = cursorMode
            return
        }
        const hit = findMagneticTarget(target)
        if (hit) {
            attachTarget(hit)
            mode = 'pointer'
        } else {
            mode = 'default'
            detachTarget()
        }
    }

    function onOut(e: MouseEvent) {
        if (!currentTarget) return
        const related = e.relatedTarget as Node | null
        if (!related || !currentTarget.contains(related)) detachTarget()
    }

    // 跟手性/旋转速度/晃动幅度/边框宽度与颜色命令式同步（style 属性不含动态值，避免属性重写抹掉 transform/尺寸）
    $effect(() => {
        if (!pointerEl) return
        pointerEl.style.setProperty('--mp-follow', `${follow}ms`)
        // 旋转时长写在 <html> 上而不是本元素上：`--animate-mp-spin` 里的 `var(--mp-spin)` 是在
        // **声明该变量的元素**（:root，见 layout.css 的 @theme）上求值的，写在本元素上不会生效
        // （实测会永远停在兜底值 12s）。详见报告与 layout.css 该变量的注释。
        document.documentElement.style.setProperty('--mp-spin', `${SPIN_S}s`)
        pointerEl.style.setProperty('--mp-wobble-amp', `${WOBBLE * 0.6}px`)
        pointerEl.style.setProperty('--mp-border-w', `${BORDER_W}px`)
        // 边框色：非黑白配色 = 亮化的主题色（混白 55%）；黑白（mono）配色 昼白夜黑（反色）
        const isDark = getActiveId() !== 'light'
        const hue = getOverrides().accentHue
        let border: string
        if (hue === 'mono') {
            border = isDark ? '#000000' : '#ffffff'
        } else {
            const base =
                typeof hue === 'number'
                    ? `oklch(${isDark ? 55 : 42}% ${isDark ? 0.15 : 0.18} ${hue})`
                    : 'var(--theme-accent-bg, #6366f1)'
            border = `color-mix(in srgb, ${base} 45%, white)`
        }
        pointerEl.style.setProperty('--mp-border', border)
    })

    // 开启磁力光标时隐藏原生鼠标（input/textarea 由磁力光标的 text 模式接管）；reduced-motion 时不隐藏。
    // 拖动中磁力光标变为圆形闭合边框样式（不隐藏），系统光标保持隐藏。
    $effect(() => {
        const root = document.documentElement
        if (active) root.classList.add('magnetic-cursor')
        else root.classList.remove('magnetic-cursor')
        return () => root.classList.remove('magnetic-cursor')
    })

    $effect(() => {
        if (!active) return
        const onPointerDown = (e: PointerEvent) => {
            pressed = true
            dragging = false
            dragStart = { x: e.clientX, y: e.clientY }
            lastPointer = { x: e.clientX, y: e.clientY }
            // 拖拽模式精确对准拖动点，不记录偏移；其余模式记录按下瞬间外框与鼠标的相对偏移（接近不重合）
            if (!DRAG_MODES.has(mode) && !pressOffset) {
                pressOffset = { x: framePos.x - e.clientX, y: framePos.y - e.clientY }
            }
        }
        const onPointerUp = () => {
            pressed = false
            pressOffset = null
            dragging = false
        }
        // 捕获阶段监听：部分浮层对事件调用 stopPropagation / pointerdown preventDefault 会抑制兼容 mousemove，
        // pointermove 在 pointer capture 与 preventDefault 场景下始终派发，保证磁力光标始终跟随鼠标
        window.addEventListener('pointermove', onMove, true)
        window.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('pointerup', onPointerUp, true)
        window.addEventListener('pointercancel', onPointerUp, true)
        window.addEventListener('blur', onPointerUp)
        window.addEventListener('mouseover', onOver, true)
        window.addEventListener('mouseout', onOut, true)
        // 捕获阶段监听滚动：滚动容器内目标位移后仍保持吸附（timeline/spread-table 等横向滚动区域）
        window.addEventListener('scroll', onAnyScroll, true)
        // 目标元素被移除（弹窗/动态列表关闭）时立即解除吸附并复位模式，避免外框残留
        const removedObserver = new MutationObserver(() => {
            if (currentTarget && !currentTarget.isConnected) {
                detachTarget()
                mode = 'default'
            }
        })
        removedObserver.observe(document.body, { childList: true, subtree: true })
        // 窗口尺寸变化时重新钳制外框位置
        const onResize = () => {
            if (!pointerEl) return
            const c = clampFrame(framePos.x, framePos.y)
            framePos = { x: c.x, y: c.y }
            pointerEl.style.transform = `translate(${c.x}px, ${c.y}px)`
        }
        window.addEventListener('resize', onResize)
        return () => {
            window.removeEventListener('pointermove', onMove, true)
            window.removeEventListener('pointerdown', onPointerDown, true)
            window.removeEventListener('pointerup', onPointerUp, true)
            window.removeEventListener('pointercancel', onPointerUp, true)
            window.removeEventListener('blur', onPointerUp)
            window.removeEventListener('mouseover', onOver, true)
            window.removeEventListener('mouseout', onOut, true)
            window.removeEventListener('scroll', onAnyScroll, true)
            window.removeEventListener('resize', onResize)
            removedObserver.disconnect()
            if (moveRaf !== null) {
                cancelAnimationFrame(moveRaf)
                moveRaf = null
            }
            currentTarget = null
            mode = 'default'
            pressed = false
            pressOffset = null
            dragging = false
            spinCcw = false
        }
    })
</script>

{#if active}
    <!-- 拖动中切换为圆形闭合边框样式（mp-dragging），中心点保持显示 -->
    <div
        bind:this={pointerEl}
        class="magnetic-pointer {ROOT_CLASS}"
        class:mp-dragging={dragging}
        class:mp-spin-ccw={spinCcw}
        data-mode={mode}
        aria-hidden="true"
    >
        <span class="mp-corners {CORNERS_CLASS}" class:mp-wobble={mode === 'pointer' && WOBBLE > 0}>
            {#key attachKey}
                {@render corner(1)}{@render corner(2)}{@render corner(3)}{@render corner(4)}
            {/key}
        </span>
        <!-- 动作样式字形（非框选模式显示） -->
        <span class="mp-glyph {GLYPH_CLASS}">
            <span class="mp-glyph-text {GLYPH_TEXT_CLASS}"></span>
            <span class="mp-glyph-grab {GLYPH_GRAB_CLASS}"
                ><i class={GRAB_DOT_CLASS}></i><i class={GRAB_DOT_CLASS}></i><i class={GRAB_DOT_CLASS}></i><i
                    class={GRAB_DOT_CLASS}
                ></i></span
            >
            <span class="mp-glyph-h {GLYPH_H_CLASS}">
                <i class="tri-l {TRI_H_L}"></i><i class="line {ARROW_H_LINE_CLASS}"></i><i class="tri-r {TRI_H_R}"></i>
            </span>
            <span class="mp-glyph-v {GLYPH_V_CLASS}">
                <i class="tri-u {TRI_V_U}"></i><i class="line {ARROW_V_LINE_CLASS}"></i><i class="tri-d {TRI_V_D}"></i>
            </span>
            <span class="mp-glyph-diag {GLYPH_DIAG_CLASS}">
                <i class="tri-ul {TRI_DIAG_UL}"></i><i class="line {ARROW_DIAG_LINE_CLASS}"></i><i
                    class="tri-dr {TRI_DIAG_DR}"
                ></i>
            </span>
            <span class="mp-glyph-move {GLYPH_MOVE_CLASS}">
                <i class="tri-u {MOVE_TRI_U}"></i><i class="tri-d {MOVE_TRI_D}"></i><i class="tri-l {MOVE_TRI_L}"></i><i
                    class="tri-r {MOVE_TRI_R}"
                ></i>
            </span>
            <span class="mp-glyph-cross {GLYPH_CROSS_CLASS}">
                <span class="mp-cross-inner {CROSS_INNER_CLASS}"
                    ><i class={CROSS_BAR_BASE + ' ' + CROSS_AT[1]}></i><i class={CROSS_BAR_BASE + ' ' + CROSS_AT[2]}
                    ></i><i class={CROSS_BAR_BASE + ' ' + CROSS_AT[3]}></i><i class={CROSS_BAR_BASE + ' ' + CROSS_AT[4]}
                    ></i></span
                >
            </span>
        </span>
    </div>
    <div
        bind:this={dotEl}
        class="mp-dot {DOT_CLASS}"
        class:mp-dot-hidden={mode === 'crosshair' || mode === 'range' || mode === 'text' || mode === 'resize-h'}
        class:mp-dragging={dragging}
        aria-hidden="true"
    ></div>
{/if}

{#snippet corner(i: CornerIndex)}
    <span class="mp-corner {CORNER_BASE} {CORNER_AT[i]}"></span>
{/snippet}
