export interface ToastItem {
    id: string
    message: string
    type: 'info' | 'success' | 'error'
    duration: number
}

let toasts = $state<ToastItem[]>([])

export function addToast(message: string, type: 'info' | 'success' | 'error' = 'info', duration = 3000): string {
    toasts = toasts.filter((t) => !(t.message === message && t.type === type))
    const id = crypto.randomUUID()
    toasts = [...toasts, { id, message, type, duration }]
    if (duration > 0) {
        setTimeout(() => removeToast(id), duration)
    }
    return id
}

export function removeToast(id: string) {
    toasts = toasts.filter((t) => t.id !== id)
}

export function getToasts() {
    return toasts
}
