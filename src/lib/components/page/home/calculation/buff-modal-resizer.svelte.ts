import { LEFT_WIDTH_DEFAULT, LEFT_WIDTH_MAX, LEFT_WIDTH_MIN } from './buff-modal.consts'

/**
 * @desc Buff 弹窗左栏宽度的**拖拽调节**（三态高亮 + rAF 节流）。
 *
 * 抽因（T2-followup）：这段状态 + `$effect` + 起手 handler 原本内联在
 * `buff-modal.svelte` 里约 35 行，是一套与弹窗其余部分无关的纯交互微件
 * （与主页 sidebar 的拖动条同构），抽出后宿主只需接线。
 *
 * rAF 节流的原因：`mousemove` 在高刷屏上可每帧触发多次，直接写 `$state` 会让
 * 依赖宽度的布局每事件重算一次。这里只记录目标值、每帧合并写一次；
 * `mouseup` 时无条件落最终值，避免丢掉最后一帧。
 */
export const createSidebarResizer = () => {
    let width = $state(LEFT_WIDTH_DEFAULT)
    let resizing = $state(false)
    let dividerHover = $state(false)
    let startX = 0
    let startWidth = LEFT_WIDTH_DEFAULT

    $effect(() => {
        if (!resizing) return
        let pending: number | null = null
        let target = width
        const onMove = (e: MouseEvent) => {
            target = Math.max(LEFT_WIDTH_MIN, Math.min(LEFT_WIDTH_MAX, startWidth + (e.clientX - startX)))
            if (pending !== null) return
            pending = requestAnimationFrame(() => {
                pending = null
                width = target
            })
        }
        const onUp = () => {
            if (pending !== null) {
                cancelAnimationFrame(pending)
                pending = null
            }
            width = target
            resizing = false
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
    })

    /** @desc 分隔条起手：记录起点与初始宽度，进入拖拽态 */
    const start = (e: MouseEvent) => {
        e.preventDefault()
        startX = e.clientX
        startWidth = width
        resizing = true
    }

    return {
        get width() {
            return width
        },
        get resizing() {
            return resizing
        },
        get dividerHover() {
            return dividerHover
        },
        set dividerHover(v: boolean) {
            dividerHover = v
        },
        start
    }
}
