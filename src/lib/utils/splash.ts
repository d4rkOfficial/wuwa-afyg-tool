declare global {
    interface Window {
        __splashStart?: number
    }
}

const FADE_MS = 500

export function hideSplash(minMs = 300): void {
    const el = document.getElementById('splash')
    if (!el) return
    const start = window.__splashStart ?? performance.now()
    const elapsed = performance.now() - start
    const delay = Math.max(0, minMs - elapsed)
    setTimeout(() => {
        el.classList.add('splash-hidden')
        setTimeout(() => el.remove(), FADE_MS)
    }, delay)
}
