<script lang="ts">
    import { browser } from '$app/environment'
    import { getMagneticForcedOff, getMagneticPointer } from '$lib/data/render-prefs.svelte'
    import { getActiveId, getOverrides } from '$lib/theme'

    // 磁力光标参数已固定（不可在设置/工具中调整）
    const FOLLOW_MS = 50 // 跟手性：固定跟手
    const SENSITIVITY = 0.05 // 灵敏度：磁吸最强
    const SPIN_S = 4 // 旋转速度：最快
    const WOBBLE = 10 // 吸附晃动：最强
    const BORDER_W = 3 // 描边粗细：3px

    let enabled = $derived(getMagneticPointer())
    // 瞬时抑制（工坊 iframe 弹窗等）：强制恢复系统光标
    let forcedOff = $derived(getMagneticForcedOff())

    // 磁力目标：按钮类 = 有点击事件的元素（a/button/select/role=button/summary + 显式 cursor:pointer 的元素），
    // 动态渲染的元素由事件委托覆盖。注意：Svelte 5 的 onclick={} 编译为 addEventListener，
    // DOM 上不产生 onclick 属性，因此选择器不含 [onclick]；非标准交互元素用 [data-magnetic] 手动标记。
    const TARGET_SELECTOR = 'a, button, select, [role="button"], summary, [data-magnetic]'
    // 磁力光标自身除外（文本编辑类由 text 模式接管，不再整体豁免）。
    // 底部工具栏悬浮窗 / AI 悬浮窗整体豁免：它们是拖拽型浮层，hover 时保持默认
    // 四角+点（不显示 grab/move 字形），按住拖动时由 dragging 圆环接管。
    const EXCLUDE_SELECTOR = '.magnetic-pointer, .simplified-toolbar, .ai-assistant'
    // 拖拽/滑动类光标 → 展示对应光标样式，不框选不磁吸
    const RESIZE_H = new Set(['col-resize', 'ew-resize'])
    const RESIZE_V = new Set(['row-resize', 'ns-resize'])
    const RESIZE_DIAG = new Set(['nesw-resize', 'nwse-resize'])

    type PointerMode =
        | 'default'
        | 'pointer'
        | 'text'
        | 'grab'
        | 'move'
        | 'resize-h'
        | 'resize-v'
        | 'resize-diag'
        | 'crosshair'
        | 'range'

    // 拖动/滑动/文本输入类模式：过渡 0ms，光标实时贴手；按下时精确对准（text 不记录偏移，避免 I-beam 脱节）
    const DRAG_MODES: ReadonlySet<PointerMode> = new Set([
        'grab',
        'move',
        'resize-h',
        'resize-v',
        'resize-diag',
        'crosshair',
        'range',
        'text'
    ])

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

    function modeForCursor(cursor: string): PointerMode {
        if (cursor === 'text') return 'text'
        if (cursor === 'grab' || cursor === 'grabbing') return 'grab'
        if (cursor === 'move' || cursor === 'all-scroll') return 'move'
        if (cursor === 'crosshair') return 'crosshair'
        if (RESIZE_H.has(cursor)) return 'resize-h'
        if (RESIZE_V.has(cursor)) return 'resize-v'
        if (RESIZE_DIAG.has(cursor)) return 'resize-diag'
        return 'default'
    }

    /**
     * 解析元素声明的光标 token（如 col-resize / grab / pointer）。
     * 注意：磁力光标开启时 layout.css 会对全 DOM 施加 `cursor: none !important`，
     * getComputedStyle().cursor 恒为 none，无法用于光标语义检测——必须从
     * Tailwind cursor-* 类名或内联 style 解析，才能识别拖拽线/拖拽手柄等元素。
     */
    function cursorToken(el: Element): string {
        const cls = typeof el.className === 'string' ? el.className : ''
        const m = cls.match(/(?:^|\s)cursor-([a-z-]+)/)
        if (m) return m[1]
        const styleAttr = el.getAttribute('style') || ''
        const sm = styleAttr.match(/cursor\s*:\s*([a-z-]+)/i)
        return sm ? sm[1].toLowerCase() : ''
    }

    /**
     * 向上查找磁力目标：
     * - 命中标签/属性选择器 → 框选该元素
     * - cursor:pointer 仅认显式声明（Tailwind cursor-pointer 类或内联样式），排除继承（子元素穿透到父元素时框选父元素）
     * - 命中拖拽/滑动类光标 → 整条路径不磁吸
     * - disabled / aria-disabled / cursor:not-allowed → 不可交互，不磁吸
     */
    function findMagneticTarget(el: Element | null): HTMLElement | null {
        let cur: Element | null = el
        while (cur && cur !== document.body) {
            const token = cursorToken(cur)
            if (token === 'not-allowed') return null
            if (modeForCursor(token) !== 'default' && modeForCursor(token) !== 'pointer') return null
            if (cur.matches(TARGET_SELECTOR)) {
                if (cur.matches(':disabled, [aria-disabled="true"]')) return null
                return cur as HTMLElement
            }
            if (token === 'pointer') {
                if (cur.matches(':disabled, [aria-disabled="true"]')) return null
                return cur as HTMLElement
            }
            cur = cur.parentElement
        }
        return null
    }

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

    /**
     * 向上查找拖拽/滑动类光标：能点又能拖时优先显示拖的样式。
     * 返回非 default/pointer 的光标模式，找不到返回 null。
     */
    function findDragMode(el: Element | null): PointerMode | null {
        let cur: Element | null = el
        while (cur && cur !== document.body) {
            const m = modeForCursor(cursorToken(cur))
            if (m !== 'default' && m !== 'pointer') return m
            cur = cur.parentElement
        }
        return null
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
        pointerEl.style.setProperty('--mp-spin', `${SPIN_S}s`)
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
        class="magnetic-pointer"
        class:mp-dragging={dragging}
        data-mode={mode}
        class:mp-spin-ccw={spinCcw}
        aria-hidden="true"
    >
        <span class="mp-corners" class:mp-wobble={mode === 'pointer' && WOBBLE > 0}>
            {#key attachKey}
                <span class="mp-corner"></span><span class="mp-corner"></span><span class="mp-corner"></span><span
                    class="mp-corner"
                ></span>
            {/key}
        </span>
        <!-- 动作样式字形（非框选模式显示） -->
        <span class="mp-glyph">
            <span class="mp-glyph-text"></span>
            <span class="mp-glyph-grab"><i></i><i></i><i></i><i></i></span>
            <span class="mp-glyph-h">
                <i class="tri-l"></i><i class="line"></i><i class="tri-r"></i>
            </span>
            <span class="mp-glyph-v">
                <i class="tri-u"></i><i class="line"></i><i class="tri-d"></i>
            </span>
            <span class="mp-glyph-diag">
                <i class="tri-ul"></i><i class="line"></i><i class="tri-dr"></i>
            </span>
            <span class="mp-glyph-move">
                <i class="tri-u"></i><i class="tri-d"></i><i class="tri-l"></i><i class="tri-r"></i>
            </span>
            <span class="mp-glyph-cross"><span class="mp-cross-inner"><i></i><i></i><i></i><i></i></span></span>
        </span>
    </div>
    <div
        bind:this={dotEl}
        class="mp-dot"
        class:mp-dot-hidden={mode === 'crosshair' || mode === 'range' || mode === 'text' || mode === 'resize-h'}
        class:mp-dragging={dragging}
        aria-hidden="true"
    ></div>
{/if}

<style>
    .magnetic-pointer {
        --mp-w: 28px;
        --mp-h: 28px;
        --mp-follow: 0.2s;
        position: fixed;
        top: calc(var(--mp-h) / -2);
        left: calc(var(--mp-w) / -2);
        width: var(--mp-w);
        height: var(--mp-h);
        z-index: 999;
        pointer-events: none;
        transition:
            width var(--mp-follow, 0.2s) ease-out,
            height var(--mp-follow, 0.2s) ease-out,
            transform var(--mp-follow, 0.2s) ease-out;
    }

    /* 拖动中：外框变为固定 28px 圆形闭合边框（不随吸附目标/容器放大），
       颜色与磁力光标一致（主题亮化描边 + accent 发光），中心点由 mp-dot 呈现 */
    .magnetic-pointer.mp-dragging {
        width: 28px !important;
        height: 28px !important;
        top: -14px !important;
        left: -14px !important;
        border-radius: 9999px;
        border: 2px solid var(--mp-border, #ffffff);
        box-shadow: 0 0 10px color-mix(in srgb, var(--theme-accent-bg) 45%, transparent);
        background: transparent;
        animation: none;
    }

    .magnetic-pointer.mp-dragging .mp-corners,
    .magnetic-pointer.mp-dragging .mp-corner,
    .magnetic-pointer.mp-dragging .mp-glyph {
        display: none !important;
    }

    /* 拖动中中心点始终显示（覆盖 crosshair/range 的隐藏规则） */
    .mp-dot.mp-dragging {
        display: block !important;
    }

    /* 中心点：钉在鼠标实时位置（无过渡）；十字/拖动条模式隐藏（保证空心准星视觉） */
    .mp-dot {
        position: fixed;
        top: -2px;
        left: -2px;
        width: 4px;
        height: 4px;
        border-radius: 9999px;
        background: var(--theme-accent-bg, #6366f1);
        outline: 1px solid var(--mp-border, #ffffff);
        box-shadow: 0 0 6px color-mix(in srgb, var(--theme-accent-bg, #6366f1) 60%, transparent);
        z-index: 1000;
        pointer-events: none;
    }

    .mp-dot.mp-dot-hidden {
        display: none;
    }

    .mp-corners {
        position: absolute;
        inset: 0;
    }

    /* 平时（default 模式）四角缓慢旋转（速度可调）；选中/其它模式不旋转；
       按住拖动按位移方向切换旋转方向：右/下→逆时针，左/上→顺时针 */
    .magnetic-pointer[data-mode='default'] .mp-corners {
        animation: mp-spin var(--mp-spin, 12s) linear infinite;
    }

    .magnetic-pointer.mp-spin-ccw[data-mode='default'] .mp-corners {
        animation: mp-spin var(--mp-spin, 12s) linear infinite reverse;
    }

    @keyframes mp-spin {
        to {
            transform: rotate(360deg);
        }
    }

    /* 吸附晃动：框选新目标时四角小幅衰减晃动（幅度可调，0 关闭） */
    .magnetic-pointer[data-mode='pointer'] .mp-corners.mp-wobble {
        animation: mp-wobble 0.4s ease-out 1;
    }

    @keyframes mp-wobble {
        0% {
            transform: translate(0, 0);
        }

        25% {
            transform: translate(var(--mp-wobble-amp, 0px), 0);
        }

        50% {
            transform: translate(calc(var(--mp-wobble-amp, 0px) * -0.6), 0);
        }

        75% {
            transform: translate(calc(var(--mp-wobble-amp, 0px) * 0.25), 0);
        }

        100% {
            transform: translate(0, 0);
        }
    }

    /* 四角边框：主体主题主色，黑白描边沿 L 形走（::before 复刻 L 边框，避免 outline 画成矩形） */
    .mp-corner {
        position: absolute;
        width: 10px;
        height: 10px;
        border: 0 solid var(--theme-accent-bg, #6366f1);
        filter: drop-shadow(0 0 3px color-mix(in srgb, var(--theme-accent-bg, #6366f1) 45%, transparent));
    }

    .mp-corner::before {
        content: '';
        position: absolute;
        inset: 0;
        border: 0 solid var(--mp-border, #ffffff);
    }

    .mp-corner:nth-child(1)::before {
        border-top-width: 1px;
        border-left-width: 1px;
    }

    .mp-corner:nth-child(2)::before {
        border-top-width: 1px;
        border-right-width: 1px;
    }

    .mp-corner:nth-child(3)::before {
        border-bottom-width: 1px;
        border-left-width: 1px;
    }

    .mp-corner:nth-child(4)::before {
        border-bottom-width: 1px;
        border-right-width: 1px;
    }

    .magnetic-pointer[data-mode='default'] .mp-corner,
    .magnetic-pointer[data-mode='pointer'] .mp-corner {
        display: block;
    }

    /* input/拖动条等字形模式：不显示四角边框 */
    .magnetic-pointer:not([data-mode='default']):not([data-mode='pointer']) .mp-corner {
        display: none;
    }

    .mp-corner:nth-child(1) {
        top: 0;
        left: 0;
        border-top-width: 2px;
        border-left-width: 2px;
        border-top-left-radius: 3px;
    }

    .mp-corner:nth-child(2) {
        top: 0;
        right: 0;
        border-top-width: 2px;
        border-right-width: 2px;
        border-top-right-radius: 3px;
    }

    .mp-corner:nth-child(3) {
        bottom: 0;
        left: 0;
        border-bottom-width: 2px;
        border-left-width: 2px;
        border-bottom-left-radius: 3px;
    }

    .mp-corner:nth-child(4) {
        bottom: 0;
        right: 0;
        border-bottom-width: 2px;
        border-right-width: 2px;
        border-bottom-right-radius: 3px;
    }

    /* ── 动作样式字形（text/grab/move/resize/crosshair 模式）── */
    .mp-glyph {
        position: absolute;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        color: var(--theme-accent-bg, #6366f1);
    }

    .magnetic-pointer[data-mode='text'] .mp-glyph,
    .magnetic-pointer[data-mode='grab'] .mp-glyph,
    .magnetic-pointer[data-mode='move'] .mp-glyph,
    .magnetic-pointer[data-mode='resize-h'] .mp-glyph,
    .magnetic-pointer[data-mode='resize-v'] .mp-glyph,
    .magnetic-pointer[data-mode='resize-diag'] .mp-glyph,
    .magnetic-pointer[data-mode='crosshair'] .mp-glyph,
    .magnetic-pointer[data-mode='range'] .mp-glyph {
        display: flex;
    }

    /* 内部元素：主体主题色；描边走昼夜/黑白规则（非黑白：昼黑夜白；黑白：昼白夜黑） */
    .mp-glyph-text,
    .mp-glyph-cross i,
    .mp-glyph-h .line,
    .mp-glyph-v .line,
    .mp-glyph-diag .line,
    .mp-glyph-grab i {
        outline: 1px solid var(--mp-border, #ffffff);
    }

    /* 文本 I-beam */
    .mp-glyph-text {
        display: none;
        position: relative;
        width: var(--mp-border-w, 1px);
        height: 14px;
        background: currentColor;
        border-radius: 1px;
    }

    .mp-glyph-text::before,
    .mp-glyph-text::after {
        content: '';
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        width: 8px;
        height: 2px;
        background: currentColor;
        border-radius: 1px;
    }

    .mp-glyph-text::before {
        top: -2px;
    }

    .mp-glyph-text::after {
        bottom: -2px;
    }

    .magnetic-pointer[data-mode='text'] .mp-glyph-text {
        display: block;
    }

    /* 抓手（grab）：2×2 圆点 */
    .mp-glyph-grab {
        display: none;
        flex-wrap: wrap;
        gap: 3px;
        width: 13px;
        height: 13px;
    }

    .mp-glyph-grab i {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: currentColor;
        box-shadow: 0 0 4px color-mix(in srgb, currentColor 50%, transparent);
    }

    .magnetic-pointer[data-mode='grab'] .mp-glyph-grab {
        display: flex;
    }

    /* 水平/垂直/斜向 双向箭头 */
    .mp-glyph-h,
    .mp-glyph-v,
    .mp-glyph-diag {
        display: none;
        align-items: center;
        justify-content: center;
        gap: 1px;
    }

    .mp-glyph-h .line,
    .mp-glyph-v .line,
    .mp-glyph-diag .line {
        background: currentColor;
        border-radius: 1px;
    }

    /* 水平双向箭头（类似系统 col-resize：中间竖线 + 左右实心箭头） */
    .mp-glyph-h .line {
        width: var(--mp-border-w, 1px);
        height: 14px;
    }

    .mp-glyph-h .tri-l,
    .mp-glyph-h .tri-r {
        width: 0;
        height: 0;
        border-top: calc(var(--mp-border-w, 1px) * 3) solid transparent;
        border-bottom: calc(var(--mp-border-w, 1px) * 3) solid transparent;
    }

    .mp-glyph-h .tri-l {
        border-right: calc(var(--mp-border-w, 1px) * 4) solid currentColor;
    }

    .mp-glyph-h .tri-r {
        border-left: calc(var(--mp-border-w, 1px) * 4) solid currentColor;
    }

    .magnetic-pointer[data-mode='resize-h'] .mp-glyph-h {
        display: flex;
    }

    /* 垂直双向箭头 */
    .mp-glyph-v {
        flex-direction: column;
    }

    .mp-glyph-v .line {
        width: var(--mp-border-w, 1px);
        height: 12px;
    }

    .mp-glyph-v .tri-u {
        width: 0;
        height: 0;
        border-left: calc(var(--mp-border-w, 1px) * 3) solid transparent;
        border-right: calc(var(--mp-border-w, 1px) * 3) solid transparent;
        border-bottom: calc(var(--mp-border-w, 1px) * 4) solid currentColor;
    }

    .mp-glyph-v .tri-d {
        width: 0;
        height: 0;
        border-left: calc(var(--mp-border-w, 1px) * 3) solid transparent;
        border-right: calc(var(--mp-border-w, 1px) * 3) solid transparent;
        border-top: calc(var(--mp-border-w, 1px) * 4) solid currentColor;
    }

    .magnetic-pointer[data-mode='resize-v'] .mp-glyph-v {
        display: flex;
    }

    /* 斜向双向箭头 */
    .mp-glyph-diag {
        transform: rotate(45deg);
    }

    .mp-glyph-diag .line {
        width: 12px;
        height: var(--mp-border-w, 1px);
    }

    .mp-glyph-diag .tri-ul,
    .mp-glyph-diag .tri-dr {
        width: 0;
        height: 0;
        border-top: calc(var(--mp-border-w, 1px) * 2.5) solid transparent;
        border-bottom: calc(var(--mp-border-w, 1px) * 2.5) solid transparent;
    }

    .mp-glyph-diag .tri-ul {
        border-right: calc(var(--mp-border-w, 1px) * 3.5) solid currentColor;
    }

    .mp-glyph-diag .tri-dr {
        border-left: calc(var(--mp-border-w, 1px) * 3.5) solid currentColor;
    }

    .magnetic-pointer[data-mode='resize-diag'] .mp-glyph-diag {
        display: flex;
    }

    /* 移动：四向箭头 */
    .mp-glyph-move {
        display: none;
        position: relative;
        width: 20px;
        height: 20px;
    }

    .mp-glyph-move .tri-u,
    .mp-glyph-move .tri-d,
    .mp-glyph-move .tri-l,
    .mp-glyph-move .tri-r {
        position: absolute;
        width: 0;
        height: 0;
    }

    .mp-glyph-move .tri-u {
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        border-left: calc(var(--mp-border-w, 1px) * 2.5) solid transparent;
        border-right: calc(var(--mp-border-w, 1px) * 2.5) solid transparent;
        border-bottom: calc(var(--mp-border-w, 1px) * 3.5) solid currentColor;
    }

    .mp-glyph-move .tri-d {
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        border-left: calc(var(--mp-border-w, 1px) * 2.5) solid transparent;
        border-right: calc(var(--mp-border-w, 1px) * 2.5) solid transparent;
        border-top: calc(var(--mp-border-w, 1px) * 3.5) solid currentColor;
    }

    .mp-glyph-move .tri-l {
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        border-top: calc(var(--mp-border-w, 1px) * 2.5) solid transparent;
        border-bottom: calc(var(--mp-border-w, 1px) * 2.5) solid transparent;
        border-right: calc(var(--mp-border-w, 1px) * 3.5) solid currentColor;
    }

    .mp-glyph-move .tri-r {
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        border-top: calc(var(--mp-border-w, 1px) * 2.5) solid transparent;
        border-bottom: calc(var(--mp-border-w, 1px) * 2.5) solid transparent;
        border-left: calc(var(--mp-border-w, 1px) * 3.5) solid currentColor;
    }

    .magnetic-pointer[data-mode='move'] .mp-glyph-move {
        display: block;
    }

    /* 空心十字准星（拖动条/十字光标）：4 段短线，中心镂空 8px（保证空心视觉） */
    .mp-glyph-cross {
        display: none;
        position: relative;
        width: 20px;
        height: 20px;
    }

    /* 呼吸：内层整体缩放，四个横杠离中心时近时远（与旋转分离，互不干扰） */
    .mp-cross-inner {
        position: absolute;
        inset: 0;
        animation: mp-breathe 2.6s ease-in-out infinite;
    }

    @keyframes mp-breathe {
        0%,
        100% {
            transform: scale(1);
        }

        50% {
            transform: scale(1.3);
        }
    }

    .mp-glyph-cross i {
        position: absolute;
        background: currentColor;
        border-radius: 1px;
    }

    .mp-glyph-cross i:nth-child(1) {
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        width: var(--mp-border-w, 1px);
        height: 6px;
    }

    .mp-glyph-cross i:nth-child(2) {
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: var(--mp-border-w, 1px);
        height: 6px;
    }

    .mp-glyph-cross i:nth-child(3) {
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 6px;
        height: var(--mp-border-w, 1px);
    }

    .mp-glyph-cross i:nth-child(4) {
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 6px;
        height: var(--mp-border-w, 1px);
    }

    .magnetic-pointer[data-mode='crosshair'] .mp-glyph-cross,
    .magnetic-pointer[data-mode='range'] .mp-glyph-cross {
        display: block;
        animation: mp-spin var(--mp-spin, 12s) linear infinite;
    }

    .magnetic-pointer.mp-spin-ccw[data-mode='crosshair'] .mp-glyph-cross,
    .magnetic-pointer.mp-spin-ccw[data-mode='range'] .mp-glyph-cross {
        animation: mp-spin var(--mp-spin, 12s) linear infinite reverse;
    }

    @media (prefers-reduced-motion: reduce) {
        .magnetic-pointer,
        .mp-dot {
            display: none;
        }
    }
</style>
