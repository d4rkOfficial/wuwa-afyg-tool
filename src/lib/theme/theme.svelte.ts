import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import type {
    Theme,
    ComponentTheme,
    ThemeComponentKey,
    ThemeOverrides,
    ThemeAppearance,
    ThemeMode,
    SurfaceKey,
    SurfaceStyle
} from './types'
import { SURFACE_KEYS } from './types'
import darkPreset from './preset/dark.json'
import lightPreset from './preset/light.json'

const ACTIVE_KEY = 'theme-active'
const OVERRIDES_KEY = 'theme-overrides'

const PRESETS: Theme[] = [darkPreset as Theme, lightPreset as Theme]

/** @desc 五类区域默认外观；口径：尽量贴近改造前的整体观感 */
export const DEFAULT_SURFACES: Record<SurfaceKey, SurfaceStyle> = {
    card: { opacity: 100, blur: 0, depth: 0 },
    modal: { opacity: 75, blur: 4, depth: 0 },
    sidebar: { opacity: 85, blur: 0, depth: 0 },
    content: { opacity: 0, blur: 0, depth: 0 },
    toolbar: { opacity: 100, blur: 0, depth: 0 }
}

/** @desc 默认外观（昼夜各一份） */
export const DEFAULT_APPEARANCE: Record<ThemeMode, ThemeAppearance> = {
    dark: { bgImageBlur: 4, bgImageMask: 0, surfaces: structuredClone(DEFAULT_SURFACES) },
    light: { bgImageBlur: 4, bgImageMask: 0, surfaces: structuredClone(DEFAULT_SURFACES) }
}

const DEFAULT_OVERRIDES: ThemeOverrides = {
    accentHue: 190,
    backgroundImage: '',
    backgroundImageLight: '',
    appearance: structuredClone(DEFAULT_APPEARANCE),
    neonText: 0
}

let themes = $state<Theme[]>([])
let activeId = $state<string>('')
let overrides = $state<ThemeOverrides>(structuredClone(DEFAULT_OVERRIDES))

const toPlain = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** @desc 当前昼夜主题（非 light 一律按 dark 处理） */
const activeMode = (): ThemeMode => (activeId === 'light' ? 'light' : 'dark')

/** @desc 归一化外观设置：缺项回落到默认值（旧的持久化数据不做迁移，缺项直接用默认） */
function normalizeAppearance(raw: unknown): ThemeAppearance {
    const src = (raw ?? {}) as Partial<ThemeAppearance>
    const surfaces = { ...structuredClone(DEFAULT_SURFACES) }
    for (const key of SURFACE_KEYS) {
        const saved = (src.surfaces ?? {})[key]
        if (saved) surfaces[key] = { ...DEFAULT_SURFACES[key], ...saved }
    }
    return {
        bgImageBlur: typeof src.bgImageBlur === 'number' ? src.bgImageBlur : DEFAULT_APPEARANCE.dark.bgImageBlur,
        bgImageMask: typeof src.bgImageMask === 'number' ? src.bgImageMask : DEFAULT_APPEARANCE.dark.bgImageMask,
        surfaces
    }
}

/** @desc 当前昼夜下的外观设置（背景图效果 + 各表面） */
export function getAppearance(mode: ThemeMode = activeMode()): ThemeAppearance {
    return overrides.appearance[mode]
}

/** @desc 读取某个表面的外观设置（默认取当前昼夜） */
export function getSurfaceStyle(key: SurfaceKey, mode: ThemeMode = activeMode()): SurfaceStyle {
    return overrides.appearance[mode].surfaces[key] ?? DEFAULT_SURFACES[key]
}

/** @desc 修改某个表面的透明度/毛玻璃/背景深度（按昼夜分开保存） */
export async function setSurfaceStyle(key: SurfaceKey, patch: Partial<SurfaceStyle>, mode: ThemeMode = activeMode()) {
    const current = overrides.appearance[mode]
    const next: ThemeAppearance = {
        ...current,
        surfaces: { ...current.surfaces, [key]: { ...getSurfaceStyle(key, mode), ...patch } }
    }
    overrides = { ...overrides, appearance: { ...overrides.appearance, [mode]: next } }
    await dbSet(OVERRIDES_KEY, toPlain(overrides))
    applyBgBlend(document.documentElement)
}

/** @desc 修改背景图效果（模糊/遮罩），按昼夜分开保存 */
export async function setBgImageEffect(
    patch: Partial<Pick<ThemeAppearance, 'bgImageBlur' | 'bgImageMask'>>,
    mode: ThemeMode = activeMode()
) {
    const current = overrides.appearance[mode]
    const next: ThemeAppearance = { ...current, ...patch }
    overrides = { ...overrides, appearance: { ...overrides.appearance, [mode]: next } }
    await dbSet(OVERRIDES_KEY, toPlain(overrides))
    applyBgBlend(document.documentElement)
}

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

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v))

/**
 * @desc 计算某类区域的毛玻璃/背景明暗：blur=0 且 depth=0 时返回 none（不产生合成开销）。
 * 深度同时作用在背面（昼提亮/夜压暗），让「更白/更黑」在毛玻璃上成立。
 */
function computeSurfaceBackdrop(style: SurfaceStyle, isLight: boolean): string {
    const parts: string[] = []
    if (style.blur > 0) parts.push(`blur(${clamp(style.blur, 0, 32)}px)`, 'saturate(1.08)')
    const depth = clamp(style.depth, 0, 100)
    if (depth > 0) {
        const brightness = isLight ? 1 + (depth / 100) * 0.35 : 1 - (depth / 100) * 0.6
        parts.push(`brightness(${brightness.toFixed(3)})`)
    }
    return parts.length ? parts.join(' ') : 'none'
}

function applyBgBlend(root: HTMLElement) {
    const isLight = activeId === 'light'
    const appearance = getAppearance()

    // ── 背景图效果（按昼夜分别保存）──
    root.style.setProperty('--theme-bg-image-blur', `${clamp(appearance.bgImageBlur, 0, 32)}px`)
    // 遮罩：负值压暗（黑），正值偏白；上限 200 让遮罩能进一步压成更白
    const v = clamp(appearance.bgImageMask, -100, 200)
    const maskValue =
        v < 0
            ? `rgba(0, 0, 0, ${((Math.abs(v) / 100) * 0.6).toFixed(3)})`
            : v > 0
              ? `rgba(255, 255, 255, ${Math.min(0.8, (v / 100) * 0.35).toFixed(3)})`
              : 'transparent'
    root.style.setProperty('--theme-bg-mask', maskValue)

    // ── 五类区域：透明度 / 毛玻璃强度 / 背景深度（由 layout.css 的 [data-sf] 规则消费）──
    for (const key of SURFACE_KEYS) {
        const style = appearance.surfaces[key] ?? DEFAULT_SURFACES[key]
        const depth = clamp(style.depth, 0, 100)
        root.style.setProperty(`--sf-${key}-depth`, `${(depth * 0.9).toFixed(1)}%`)
        root.style.setProperty(`--sf-${key}-target`, isLight ? '#ffffff' : '#000000')
        root.style.setProperty(`--sf-${key}-opacity`, `${clamp(style.opacity, 0, 100)}%`)
        root.style.setProperty(`--sf-${key}-backdrop`, computeSurfaceBackdrop(style, isLight))
    }

    // 旧类名 .theme-glass-surface 兼容：跟随弹窗表面的毛玻璃强度
    root.style.setProperty('--theme-glass-blur', `${clamp(appearance.surfaces.modal.blur, 0, 32)}px`)

    // 遮罩同步变透：否则弹窗本身再透明，看到的也只是遮罩的暗底 + 模糊，观感上「透不动」。
    // 以默认 75 不透明度为 1.0 基准做线性缩放，默认观感保持不变。
    const activeTheme = themes.find((t) => t.id === activeId)
    const overlayBase = activeTheme?.components.overlay?.backgroundImage || 'rgba(0,0,0,0.5)'
    const overlayScale = clamp((appearance.surfaces.modal.opacity / 75) * 100, 0, 100)
    root.style.setProperty(
        '--theme-overlay-bg',
        `color-mix(in srgb, ${overlayBase} ${overlayScale.toFixed(1)}%, transparent)`
    )

    // 背景图分白天/黑夜两张：按当前主题取生效的那张（白天=backgroundImageLight，黑夜=backgroundImage）
    const bgImage = isLight ? overrides.backgroundImageLight : overrides.backgroundImage
    if (bgImage) {
        root.style.setProperty('--theme-bg-image', `url("${bgImage}")`)
        // 有背景图时主内容区底色让位给背景图（各页主内容区表面默认不额外铺色，用户可自行加透明度/深度）
        root.style.setProperty('--theme-layout-bg', 'transparent')
    } else {
        root.style.removeProperty('--theme-bg-image')
        root.style.removeProperty('--theme-layout-bg')
    }

    // 排轴/拉表/结果表格滚动条：白天白底、夜间黑底
    root.style.setProperty(
        '--theme-scrollbar-track',
        `color-mix(in srgb, ${isLight ? '#ffffff' : '#000000'} 85%, transparent)`
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
    if (ov) {
        // 外观设置按昼夜分别归一化（旧版扁平字段不再读取，缺项一律用默认值）
        overrides = {
            ...DEFAULT_OVERRIDES,
            ...ov.data,
            appearance: {
                dark: normalizeAppearance(ov.data.appearance?.dark),
                light: normalizeAppearance(ov.data.appearance?.light)
            }
        }
        // 未压缩的 data URL 会撑爆 CSS 变量导致背景图失效，直接丢弃（白天/黑夜两张各自校验）
        let trimmed = false
        for (const key of ['backgroundImage', 'backgroundImageLight'] as const) {
            const bg = overrides[key]
            if (bg && bg.startsWith('data:') && bg.length > 3_000_000) {
                overrides[key] = ''
                trimmed = true
            }
        }
        if (trimmed) await dbSet(OVERRIDES_KEY, toPlain(overrides))
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
        // 背景图效果与背景质感按昼夜分别保存，切主题即切到另一套设置，不再做正负反转
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
    await dbSet(OVERRIDES_KEY, toPlain(overrides))
    const root = document.documentElement
    applyAccentOverride(root)
    if (key === 'backgroundImage' || key === 'backgroundImageLight' || key === 'appearance') applyBgBlend(root)
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
