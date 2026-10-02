/**
 * @desc 时间轴渲染用的**纯**样式函数（无副作用、不读组件状态）。
 *
 * 抽因：这些函数原本内联在 `timeline.svelte` 里，但它们的入参已完整描述所需信息
 * （只有 `gpuAccel` 一项来自偏好设置），因此属于 AGENTS §1 要求拆出的「复杂功能里的
 * 无副作用成分」—— 拿出来后即可脱离组件单测，且组件脚本只剩接线。
 *
 * `gpuAccel` 刻意作为**参数**而不是在这里 `import getGpuAccel()`：
 * 保持函数纯净（同入参同出参），也避免 utils 层隐式读 store。
 */

/**
 * @desc 操作块的定位样式。
 * @param blockPos 块的逻辑位置（px）
 * @param visualPos 拖拽中的视觉位置（未拖拽时同 `blockPos`）
 * @param highlighted 高亮（悬停/选中）→ 抬升 4px + z-index 提高
 * @param dimmed 变暗（正在拖别人）→ opacity 0.4
 * @param isDragTarget 是否作为拖拽目标（GPU 模式下加 will-change）
 * @param gpuAccel 是否用 transform 定位（合成层）
 */
export const blockStyle = (
    blockPos: number,
    visualPos: number,
    highlighted: boolean,
    dimmed: boolean,
    isDragTarget: boolean,
    gpuAccel: boolean
): string => {
    const rest = `z-index: ${highlighted ? 20 : 5}; opacity: ${dimmed ? 0.4 : 1}; transition: opacity 150ms ease;`
    if (gpuAccel) {
        const dx = visualPos - blockPos
        return `left: ${blockPos}px; transform: translateX(${dx}px) translateX(-50%) ${
            highlighted ? 'translateY(-4px)' : ''
        }; ${rest}${isDragTarget ? ' will-change: transform;' : ''}`
    }
    return `left: ${visualPos}px; transform: translateX(-50%) ${highlighted ? 'translateY(-4px)' : ''}; ${rest}`
}

/**
 * @desc 参考线左偏移样式。
 * @param visualX 拖拽中的视觉位置（未拖拽时同 `pos`）
 */
export const refLineLeft = (visualX: number, pos: number, gpuAccel: boolean): string => {
    if (gpuAccel) return `left: ${pos}px; transform: translateX(${visualX - pos}px);`
    return `left: ${visualX}px;`
}

/**
 * @desc 伤害块叠层的定位/缩放样式。
 * @param dragging 是否正在拖拽（拖拽时只过渡 opacity，避免 transform 被拖拽帧补间拖后腿）
 */
export const damageStackStyle = (
    left: number,
    top: number,
    scale: number,
    dimmed: boolean,
    dragging: boolean,
    gpuAccel: boolean
): string => {
    const rest = `opacity: ${dimmed ? 0.4 : 1}; transform-origin: left center; transition: ${
        dragging ? 'opacity 150ms ease' : 'transform 150ms ease, opacity 150ms ease'
    };`
    if (gpuAccel) return `left:0;top:0;transform: translate(${left}px, ${top}px) scale(${scale}); ${rest}`
    return `left: ${left}px; top: ${top}px; transform: scale(${scale}); ${rest}`
}

/** @desc 非直伤条目的展示排序权重：处决 → 响应 → 效应（未知类别排最后） */
const NON_DIRECT_SORT_WEIGHT: Record<string, number> = { 处决: 0, 响应: 1, 效应: 2 }

export const nonDirectSortWeight = (category: string): number => NON_DIRECT_SORT_WEIGHT[category] ?? 3
