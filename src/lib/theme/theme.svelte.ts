import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import type { Theme, ComponentTheme, ThemeComponentKey, ThemeOverrides } from './types'
import darkPreset from './preset/dark.json'
import lightPreset from './preset/light.json'

const ACTIVE_KEY = 'theme-active'
const OVERRIDES_KEY = 'theme-overrides'

const PRESETS: Theme[] = [darkPreset as Theme, lightPreset as Theme]

let themes = $state<Theme[]>([])
let activeId = $state<string>('')
let overrides = $state<ThemeOverrides>({ accentHue: null, backgroundImage: '', bgOpacity: 85, bgBlur: 4 })

let bgOriginals = new Map<string, string>()

function applyThemeCSS() {
    if (!browser) return
    const root = document.documentElement
    const theme = themes.find((t) => t.id === activeId)
    if (!theme) return

    bgOriginals.clear()

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
    root.style.setProperty('--theme-num', theme.id === 'light' ? '#a16207' : '#ca8a04')

    applyOverridesCSS(root)
}

function applyAccentOverride(root: HTMLElement) {
    const isDark = activeId !== 'light'
    const themeObj = themes.find((t) => t.id === activeId)

    function restoreElementColors() {
        if (themeObj?.elementColors) {
            for (const [name, color] of Object.entries(themeObj.elementColors)) {
                root.style.setProperty(`--theme-element-${name}`, color)
            }
        }
    }

    if (overrides.accentHue === 'mono') {
        restoreElementColors()

        root.style.setProperty('--theme-accent-bg', isDark ? '#ffffff' : '#000000')
        root.style.setProperty('--theme-accent-text', isDark ? '#e4e4e7' : '#18181b')
        root.style.setProperty('--theme-accent-text-on-bg', isDark ? '#000000' : '#ffffff')
        root.style.setProperty('--theme-accent-bg-focused', isDark ? '#e4e4e7' : '#1a1a1a')
        root.style.setProperty('--theme-accent-text-focused', isDark ? '#e4e4e7' : '#18181b')
        root.style.setProperty('--theme-accent-border', isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)')

        root.style.setProperty('--theme-track-1', isDark ? '#555' : '#aaa')
        root.style.setProperty('--theme-track-2', isDark ? '#666' : '#999')
        root.style.setProperty('--theme-track-3', isDark ? '#777' : '#888')
        root.style.setProperty('--theme-track-4', isDark ? '#888' : '#777')
    } else if (typeof overrides.accentHue === 'number') {
        restoreElementColors()

        const l = isDark ? 55 : 42
        const lFocused = isDark ? 60 : 47
        const c = isDark ? 0.15 : 0.18
        const h = overrides.accentHue
        const accentText = isDark ? `oklch(70% 0.12 ${h})` : `oklch(40% 0.18 ${h})`

        root.style.setProperty('--theme-accent-bg', `oklch(${l}% ${c} ${h})`)
        root.style.setProperty('--theme-accent-text', accentText)
        root.style.setProperty('--theme-accent-text-on-bg', '#ffffff')
        root.style.setProperty('--theme-accent-bg-focused', `oklch(${lFocused}% ${c} ${h})`)
        root.style.setProperty('--theme-accent-text-focused', accentText)
        root.style.setProperty('--theme-accent-border', `oklch(${l}% ${c} ${h} / 0.3)`)

        root.style.setProperty('--theme-track-1', `oklch(60% 0.12 ${h - 20})`)
        root.style.setProperty('--theme-track-2', `oklch(55% 0.15 ${h})`)
        root.style.setProperty('--theme-track-3', `oklch(55% 0.12 ${h + 20})`)
        root.style.setProperty('--theme-track-4', `oklch(55% 0.10 ${h + 40})`)
    } else if (themeObj) {
        restoreElementColors()

        const accent = themeObj.components.accent
        if (accent) {
            setCSSVar(root, 'accent', 'bg', accent.backgroundImage)
            setCSSVar(root, 'accent', 'text', accent.textColor)
            setCSSVar(root, 'accent', 'bg-focused', accent.backgroundImageFocused)
            setCSSVar(root, 'accent', 'text-focused', accent.textColor)
            setCSSVar(root, 'accent', 'border', accent.borderColor)
        }
        root.style.setProperty('--theme-accent-text-on-bg', '#ffffff')

        root.style.setProperty('--theme-track-1', '#3b82f6')
        root.style.setProperty('--theme-track-2', '#7c3aed')
        root.style.setProperty('--theme-track-3', '#db2777')
        root.style.setProperty('--theme-track-4', '#16a34a')
    }
}

function applyBgBlend(root: HTMLElement) {
    root.style.setProperty('--theme-bg-blur', `${overrides.bgBlur}px`)
    if (overrides.backgroundImage) {
        root.style.setProperty('--theme-bg-image', `url("${overrides.backgroundImage}")`)
        const theme = themes.find((t) => t.id === activeId)
        if (theme) {
            for (const key of Object.keys(theme.components)) {
                const varName = `--theme-${key}-bg`
                if (!bgOriginals.has(varName)) {
                    const val = root.style.getPropertyValue(varName)
                    if (val) bgOriginals.set(varName, val)
                }
                const orig = bgOriginals.get(varName)
                if (
                    orig &&
                    !orig.startsWith('linear-gradient') &&
                    !orig.startsWith('radial-gradient') &&
                    !orig.startsWith('repeating-linear-gradient') &&
                    !orig.startsWith('repeating-radial-gradient')
                ) {
                    root.style.setProperty(varName, `color-mix(in srgb, ${orig} ${overrides.bgOpacity}%, transparent)`)
                }
            }
        }
    } else if (bgOriginals.size > 0) {
        for (const [varName, val] of bgOriginals) {
            root.style.setProperty(varName, val)
        }
        root.style.removeProperty('--theme-bg-image')
        bgOriginals.clear()
    } else {
        root.style.removeProperty('--theme-bg-image')
    }
}

function applyOverridesCSS(root: HTMLElement) {
    applyAccentOverride(root)
    applyBgBlend(root)
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

    const ov = await dbGet<ThemeOverrides>(OVERRIDES_KEY)
    if (ov) overrides = ov.data

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

export function getOverrides(): ThemeOverrides {
    return overrides
}

export async function updateOverride<K extends keyof ThemeOverrides>(key: K, value: ThemeOverrides[K]) {
    overrides = { ...overrides, [key]: value }
    await dbSet(OVERRIDES_KEY, overrides)
    const root = document.documentElement
    applyAccentOverride(root)
    if (key === 'backgroundImage' || key === 'bgOpacity' || key === 'bgBlur') applyBgBlend(root)
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
