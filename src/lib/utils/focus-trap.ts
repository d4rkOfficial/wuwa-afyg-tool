const FOCUSABLE_SELECTOR = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'

const getFocusables = (container: HTMLElement): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0
    )

interface FocusTrapOptions {
    /** 初始聚焦选择器（默认容器内第一个可聚焦元素） */
    initial?: string
}

/**
 * 焦点陷阱：挂载时聚焦弹窗内元素，Tab/Shift+Tab 只能在容器内循环；
 * 卸载时把焦点归还给打开弹窗前的元素。容器需 tabindex="-1" 以便无可用元素时承接焦点。
 */
export const focusTrap = (node: HTMLElement, options?: FocusTrapOptions) => {
    const restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const onKeydown = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return
        const items = getFocusables(node)
        if (items.length === 0) {
            e.preventDefault()
            node.focus()
            return
        }
        const active = document.activeElement
        if (e.shiftKey) {
            if (active === items[0] || !node.contains(active)) {
                e.preventDefault()
                items[items.length - 1].focus()
            }
        } else {
            if (active === items[items.length - 1] || !node.contains(active)) {
                e.preventDefault()
                items[0].focus()
            }
        }
    }

    const initial = options?.initial ? node.querySelector<HTMLElement>(options.initial) : null
    if (initial instanceof HTMLElement) initial.focus()
    else (getFocusables(node)[0] ?? node).focus()

    node.addEventListener('keydown', onKeydown)

    return {
        destroy() {
            node.removeEventListener('keydown', onKeydown)
            if (restoreTarget && document.contains(restoreTarget)) restoreTarget.focus()
        }
    }
}
