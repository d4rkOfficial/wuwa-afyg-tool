import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import type { Theme, ComponentTheme, ThemeComponentKey, ThemeOverrides } from './types'
import darkPreset from './preset/dark.json'
import lightPreset from './preset/light.json'

const ACTIVE_KEY = 'theme-active'
const OVERRIDES_KEY = 'theme-overrides'
const MASK_MIGRATED_KEY = 'theme-bgmask-migrated-v2'

const PRESETS: Theme[] = [darkPreset as Theme, lightPreset as Theme]

const DEFAULT_OVERRIDES: ThemeOverrides = {
    accentHue: 190,
    backgroundImage: '',
    bgOpacity: 85,
    bgBlur: 4,
    bgDim: 0,
    bgImageBlur: 4,
    bgImageMask: 0,
    neonText: 0
}

const TRANSLUCENT_SURFACES = new Set([
    'avatar',
    'tabs',
    'sidebar',
    'search-box',
    'modal',
    'context-menu',
    'toast',
    'toast-top',
    'timeline',
    'card',
    'input',
    'watermark'
])

let themes = $state<Theme[]>([])
let activeId = $state<string>('')
let overrides = $state<ThemeOverrides>({ ...DEFAULT_OVERRIDES })

let bgOriginals = new Map<string, string>()

const toPlain = <T>(value: T): T => JSON.parse(JSON.stringify(value))

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
    root.style.setProperty('--theme-w-icon-filter', theme.id === 'light' ? 'invert(1)' : 'none')
    root.style.setProperty('--theme-num', theme.id === 'light' ? '#a16207' : '#ca8a04')
    root.style.setProperty(
        '--theme-card-shadow',
        theme.id === 'light' ? '0 0 24px -4px rgba(255,255,255,0.6)' : '0 2px 10px rgba(0,0,0,0.25)'
    )
    root.style.setProperty('--theme-halo-color', theme.id === 'light' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.8)')

    // 拉表页 buff 块背景/文字色（黄色=全局/差异新增、绿色=差异新增）：白天加深便于识别，夜间保持原色
    const isLight = theme.id === 'light'
    root.style.setProperty('--theme-buff-yellow-bg', isLight ? 'rgba(202,138,4,0.28)' : 'rgba(234,179,8,0.15)')
    root.style.setProperty('--theme-buff-yellow-text', isLight ? '#854d0e' : '#eab308')
    root.style.setProperty('--theme-buff-green-bg', isLight ? 'rgba(22,101,52,0.3)' : 'rgba(34,197,94,0.15)')
    root.style.setProperty('--theme-buff-green-text', isLight ? '#14532d' : '#22c55e')

    applyOverridesCSS(root)

    // 标题栏颜色同步到 PWA theme-color（原生标题栏着色，移动端地址栏 / 桌面标题栏联动）
    const titlebarBg =
        root.style.getPropertyValue('--theme-titlebar-bg')?.trim() || theme.components.titlebar?.backgroundImage
    if (titlebarBg) {
        let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        if (!meta) {
            meta = document.createElement('meta')
            meta.name = 'theme-color'
            document.head.appendChild(meta)
        }
        meta.content = titlebarBg
    }
}

function applyCritGradients(root: HTMLElement, hue: number | null) {
    if (hue === null) {
        root.style.setProperty('--theme-rigcrit-from', '#ef4444')
        root.style.setProperty('--theme-rigcrit-to', '#fb923c')
        root.style.setProperty('--theme-nocrit-from', '#22c55e')
        root.style.setProperty('--theme-nocrit-to', '#a3e635')
    } else {
        root.style.setProperty('--theme-rigcrit-from', `oklch(58% 0.15 ${hue + 120})`)
        root.style.setProperty('--theme-rigcrit-to', `oklch(68% 0.16 ${hue + 135})`)
        root.style.setProperty('--theme-nocrit-from', `oklch(58% 0.15 ${hue - 120})`)
        root.style.setProperty('--theme-nocrit-to', `oklch(68% 0.16 ${hue - 105})`)
    }
    root.style.setProperty(
        '--theme-rigcrit-grad',
        'linear-gradient(135deg, var(--theme-rigcrit-from) 0%, var(--theme-rigcrit-to) 100%)'
    )
    root.style.setProperty(
        '--theme-nocrit-grad',
        'linear-gradient(135deg, var(--theme-nocrit-from) 0%, var(--theme-nocrit-to) 100%)'
    )
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
        // 黑白特例：标题栏背景/文字同步为纯黑/纯白（对照昼夜）
        root.style.setProperty('--theme-titlebar-bg', isDark ? '#000000' : '#ffffff')
        root.style.setProperty('--theme-titlebar-text', isDark ? '#ffffff' : '#000000')
        applyCritGradients(root, null)
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
        applyCritGradients(root, h)
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
        applyCritGradients(root, null)
    }
}

function applyBgBlend(root: HTMLElement) {
    root.style.setProperty('--theme-glass-blur', `${overrides.bgBlur}px`)
    // 背景图自身的独立控制（遮罩层）：模糊与遮罩强度，与玻璃表面（毛玻璃强度/背景暗度）分开
    root.style.setProperty('--theme-bg-image-blur', `${overrides.bgImageBlur}px`)
    // 背景图遮罩：负值=压暗(黑半透)，正值=明亮(白半透)，0=原图
    const v = Math.max(-100, Math.min(100, overrides.bgImageMask))
    const maskValue =
        v < 0
            ? `rgba(0,0,0,${(Math.abs(v) / 100) * 0.6})`
            : v > 0
              ? `rgba(255,255,255,${(v / 100) * 0.35})`
              : 'transparent'
    root.style.setProperty('--theme-bg-mask', maskValue)
    // 暗度只压暗玻璃表面背后的区域（backdrop brightness），背景图本身保持原亮度形成对比；
    // 无背景图时复位为 1，避免先调暗度再删背景后玻璃表面被残留压暗（暗度滑块仅在有背景图时可见，用户无法自行复位）
    const glassBrightness = overrides.backgroundImage
        ? 1 - (Math.max(0, Math.min(100, overrides.bgDim)) / 100) * 0.6
        : 1
    root.style.setProperty('--theme-glass-brightness', String(glassBrightness))
    if (overrides.backgroundImage) {
        root.style.setProperty('--theme-bg-image', `url("${overrides.backgroundImage}")`)
        const theme = themes.find((t) => t.id === activeId)
        if (theme) {
            for (const key of Object.keys(theme.components)) {
                const varName = `--theme-${key}-bg`
                if (key !== 'layout' && !TRANSLUCENT_SURFACES.has(key)) continue
                if (!bgOriginals.has(varName)) {
                    const val = root.style.getPropertyValue(varName)
                    if (val) bgOriginals.set(varName, val)
                }
                const orig = bgOriginals.get(varName)
                if (key === 'layout') {
                    root.style.setProperty(varName, 'transparent')
                    continue
                }
                // 排轴（timeline）因子减半：容器更透，角色头像/伤害绑定粘性列能透出背景图（列自身再叠低透明底）
                const factor = key === 'timeline' ? overrides.bgOpacity * 0.5 : overrides.bgOpacity
                if (
                    orig &&
                    !orig.startsWith('linear-gradient') &&
                    !orig.startsWith('radial-gradient') &&
                    !orig.startsWith('repeating-linear-gradient') &&
                    !orig.startsWith('repeating-radial-gradient')
                ) {
                    root.style.setProperty(varName, `color-mix(in srgb, ${orig} ${factor}%, transparent)`)
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
    // 排轴/拉表/结果表格滚动条：白天白底、夜间黑底，透明度跟随「背景透明度」设置
    const isLight = activeId === 'light'
    root.style.setProperty(
        '--theme-scrollbar-track',
        `color-mix(in srgb, ${isLight ? '#ffffff' : '#000000'} ${overrides.bgOpacity}%, transparent)`
    )
    root.style.setProperty('--theme-scrollbar-thumb', isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)')
}

function applyOverridesCSS(root: HTMLElement) {
    applyAccentOverride(root)
    applyBgBlend(root)
    const neonOn = overrides.neonText > 0
    root.classList.toggle('neon-text', neonOn)
    root.style.setProperty('--theme-neon-glow', neonOn ? `${(overrides.neonText / 100) * 10}px` : '0px')
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

    const ov = await dbGet<Partial<ThemeOverrides>>(OVERRIDES_KEY)
    // 旧版 bgImageMask（0-100 仅压暗滑块）→ 新版 -100~100 双极滑块 的一次性迁移。
    // 用标记位保证只迁移一次：否则每次加载都会把新版「明亮」(正) 误判为旧版「压暗」取负，导致设置明亮后重进变成压暗
    const maskMigrated = await dbGet<boolean>(MASK_MIGRATED_KEY)
    if (!maskMigrated?.data) {
        if (ov && typeof ov.data.bgImageMask === 'number' && (ov.data as any).bgImageMask > 0) {
            ;(ov.data as any).bgImageMask = -(ov.data.bgImageMask as number)
        }
        await dbSet(MASK_MIGRATED_KEY, true)
    }
    if (ov) {
        overrides = { ...DEFAULT_OVERRIDES, ...ov.data }
        // 旧版未压缩的 data URL 会撑爆 CSS 变量导致背景图失效，直接丢弃
        const bg = overrides.backgroundImage
        if (bg && bg.startsWith('data:') && bg.length > 3_000_000) {
            overrides.backgroundImage = ''
            await dbSet(OVERRIDES_KEY, toPlain(overrides))
        }
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
    if (themes.find((t) => t.id === id) && id !== activeId) {
        const prevId = activeId
        activeId = id
        await dbSet(ACTIVE_KEY, id)
        // 白天↔黑夜互切：卡片透明度镜像对调；背景图遮罩正负反转（明亮↔压暗）
        if ((prevId === 'light' && id === 'dark') || (prevId === 'dark' && id === 'light')) {
            overrides = { ...overrides, bgOpacity: 130 - overrides.bgOpacity, bgImageMask: -overrides.bgImageMask }
            await dbSet(OVERRIDES_KEY, toPlain(overrides))
        }
        applyThemeCSS()
    }
}

export function getOverrides(): ThemeOverrides {
    return overrides
}

export async function updateOverride<K extends keyof ThemeOverrides>(key: K, value: ThemeOverrides[K]) {
    overrides = { ...overrides, [key]: value }
    await dbSet(OVERRIDES_KEY, toPlain(overrides))
    const root = document.documentElement
    applyAccentOverride(root)
    if (
        key === 'backgroundImage' ||
        key === 'bgOpacity' ||
        key === 'bgBlur' ||
        key === 'bgDim' ||
        key === 'bgImageBlur' ||
        key === 'bgImageMask'
    )
        applyBgBlend(root)
    if (key === 'neonText') {
        const on = overrides.neonText > 0
        root.classList.toggle('neon-text', on)
        root.style.setProperty('--theme-neon-glow', on ? `${(overrides.neonText / 100) * 10}px` : '0px')
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
