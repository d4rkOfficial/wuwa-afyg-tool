import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import type { Theme, ComponentTheme, ThemeComponentKey } from './types'
import darkPreset from './preset/dark.json'
import lightPreset from './preset/light.json'

const ACTIVE_KEY = 'theme-active'

const PRESETS: Theme[] = [darkPreset as Theme, lightPreset as Theme]

let themes = $state<Theme[]>([])
let activeId = $state<string>('')

function applyThemeCSS() {
    if (!browser) return
    const root = document.documentElement
    const theme = themes.find((t) => t.id === activeId)
    if (!theme) return

    for (const [key, comp] of Object.entries(theme.components)) {
        setCSSVar(root, key, 'bg', comp.backgroundImage)
        setCSSVar(root, key, 'bg-focused', comp.backgroundImageFocused)
        setCSSVar(root, key, 'text', comp.textColor)
        setCSSVar(root, key, 'text-focused', comp.textColorFocused)
        setCSSVar(root, key, 'border', comp.borderColor)
        setCSSVar(root, key, 'border-focused', comp.borderColorFocused)
    }

    if (theme.elementColors) {
        for (const [name, color] of Object.entries(theme.elementColors)) {
            root.style.setProperty(`--theme-element-${name}`, color)
        }
    }

    root.style.setProperty('--theme-layout-scheme', theme.id === 'light' ? 'light' : 'dark')
    root.style.setProperty('--theme-rigcrit-text', theme.id === 'light' ? '#dc2626' : '#ef4444')
    root.style.setProperty('--theme-rigcrit-bg', theme.id === 'light' ? '#dc2626' : '#ef4444')
    root.style.setProperty('--theme-w-icon-filter', theme.id === 'light' ? 'invert(1)' : 'none')
}

function setCSSVar(root: HTMLElement, key: string, prop: string, value?: string) {
    const name = `--theme-${key}-${prop}`
    if (value) {
        root.style.setProperty(name, value)
    } else {
        root.style.removeProperty(name)
    }
}

export async function loadThemes() {
    if (!browser) return

    themes = structuredClone(PRESETS)

    const activeSaved = await dbGet<string>(ACTIVE_KEY)
    if (activeSaved && themes.find((t) => t.id === activeSaved.data)) {
        activeId = activeSaved.data
    } else {
        activeId = themes[0]?.id ?? ''
    }

    applyThemeCSS()
}

export function getThemes(): Theme[] {
    return themes
}

export function getActiveTheme(): Theme | undefined {
    return themes.find((t) => t.id === activeId)
}

export function getActiveId(): string {
    return activeId
}

export async function setActiveTheme(id: string) {
    if (themes.find((t) => t.id === id)) {
        activeId = id
        await dbSet(ACTIVE_KEY, id)
        applyThemeCSS()
    }
}

export function getComponentTheme(key: ThemeComponentKey): ComponentTheme {
    const active = themes.find((t) => t.id === activeId)
    return active?.components[key] ?? {}
}

export async function updateComponentTheme(key: ThemeComponentKey, patch: Partial<ComponentTheme>) {
    const active = themes.find((t) => t.id === activeId)
    if (!active) return

    active.components[key] = { ...active.components[key], ...patch }
    applyThemeCSS()
}

export async function addTheme(name: string): Promise<Theme> {
    const id = `theme-${Date.now()}`
    const theme: Theme = { id, name, components: {} }
    themes = [...themes, theme]
    return theme
}

export async function removeTheme(id: string) {
    if (themes.length <= 1) return
    themes = themes.filter((t) => t.id !== id)
    if (activeId === id) {
        activeId = themes[0].id
        await dbSet(ACTIVE_KEY, activeId)
    }
}
