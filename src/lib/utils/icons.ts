import { addCollection } from '@iconify/svelte/dist/functions'
import { MDI_ICONS } from './mdi-icons.generated'

export function registerIcons() {
    addCollection(MDI_ICONS)
}

export function fallbackIcon(node: HTMLImageElement, placeholder: string) {
    const orig = node.onerror
    function handler() {
        node.src = placeholder
        node.onerror = null
    }
    node.onerror = handler
    return {
        destroy() {
            if (node.onerror === handler) node.onerror = orig
        }
    }
}
