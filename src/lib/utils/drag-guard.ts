// 全局拖动取消注册表：AI 悬浮窗等"拖动禁区"进入时取消进行中的拖动（不触发松开副作用）
const cancels = new Set<() => void>()

export function registerDragCancel(fn: () => void): () => void {
    cancels.add(fn)
    return () => cancels.delete(fn)
}

export function cancelActiveDrags() {
    for (const fn of [...cancels]) fn()
}
