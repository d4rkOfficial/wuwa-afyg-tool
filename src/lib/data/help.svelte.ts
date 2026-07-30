export interface HelpItem {
    name: string
    description: string
    content: string
}

interface HelpState {
    open: boolean
    title: string
    items: HelpItem[]
}

let state = $state<HelpState>({ open: false, title: '', items: [] })

export function openHelp(title: string, items: HelpItem[]) {
    state = { open: true, title, items }
}

export function closeHelp() {
    state = { ...state, open: false }
}

export function getHelpState() {
    return state
}
