export const sortChars = (a: { name: string; star: number }, b: { name: string; star: number }) => {
    const aIsRover = a.name.startsWith('漂泊者') ? 0 : 1
    const bIsRover = b.name.startsWith('漂泊者') ? 0 : 1
    if (aIsRover !== bIsRover) return aIsRover - bIsRover
    if (b.star !== a.star) return b.star - a.star
    return a.name.localeCompare(b.name)
}

export const starColor = (star: number): string => {
    const map: Record<number, string> = { 5: '#fbbf24', 4: '#a78bfa', 3: '#60a5fa', 2: '#4ade80', 1: '#71717a' }
    return map[star] || '#71717a'
}

export const isBoundary = (id: string) => id === 'left' || id === 'right'

export const canDelete = (id: string) => id !== 'left' && id !== 'right'

export const hideImg = (e: Event) => {
    ;(e.currentTarget as HTMLElement).style.display = 'none'
}

export function clampMenu(node: HTMLElement, pos: { x: number; y: number }) {
    node.style.left = `${pos.x}px`
    node.style.top = `${pos.y}px`
    requestAnimationFrame(() => {
        const r = node.getBoundingClientRect()
        const cw = document.documentElement.clientWidth
        const ch = document.documentElement.clientHeight
        if (r.right > cw - 8) node.style.left = `${cw - r.width - 8}px`
        if (r.bottom > ch - 8) node.style.top = `${ch - r.height - 8}px`
    })
}
