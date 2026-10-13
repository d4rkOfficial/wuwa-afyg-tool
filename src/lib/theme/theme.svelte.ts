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
import { bgMaskCss } from './bg-mask'
import { TAG_INK_LIGHT_L } from './tag-ink'
import darkPreset from './preset/dark.json'
import lightPreset from './preset/light.json'

const ACTIVE_KEY = 'theme-active'
const OVERRIDES_KEY = 'theme-overrides'

/**
 * @desc 当前昼夜的 **localStorage 同步镜像**，只给 `app.html` 的开屏读。
 * 为什么需要它：主题本体存在 IndexedDB（`ACTIVE_KEY`，异步），而开屏必须在本 bundle 之前
 * 同步渲染 —— 没有这份镜像，开屏就只能按系统猜，用户手动切过昼夜后会「开屏深色 → App 浅色」。
 * 存的是 `'dark' | 'light'` 两个字符串值，与 `ThemeMode` 同口径。
 */
const THEME_MODE_KEY = 'wuwa-afyg:theme-mode'

/** @desc 把当前昼夜写进同步镜像（localStorage 在隐私模式 / 严格 iframe 下可能抛错，失败即忽略） */
function writeThemeModeMirror() {
    if (!browser) return
    try {
        localStorage.setItem(THEME_MODE_KEY, activeId === 'light' ? 'light' : 'dark')
    } catch {
        /* 写不进去也不影响 App 运行，只是开屏会退回按系统判断 */
    }
}

/** @desc 用户未选过昼夜主题时的默认主题（黑夜：与内置默认外观/背景图配套） */
const DEFAULT_ACTIVE_ID = 'dark'

/**
 * @desc 首次进入（没有存过主题）时按**系统**深浅色选默认昼夜。
 * 为什么必须与开屏同步：`app.html` 的开屏用 `prefers-color-scheme` 选深/浅两套配色，
 * 若 App 这边固定落 'dark'，浅色系统下就会「浅色开屏 → 深色 App」跳一次。
 * 判定失败（SSR / 老浏览器没有 matchMedia）时返回 null，由调用方回落到 `DEFAULT_ACTIVE_ID`。
 * 只影响**首次**：用户手动选过主题后一律以存值为准（`loadThemes` 里的 `savedId ?? …`）。
 */
function systemDefaultThemeId(): string | null {
    if (!browser || typeof window.matchMedia !== 'function') return null
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

const PRESETS: Theme[] = [darkPreset as Theme, lightPreset as Theme]

/** @desc 六类区域兜底外观（= 黑夜默认；仅用于缺项回落与旧数据归一化） */
export const DEFAULT_SURFACES: Record<SurfaceKey, SurfaceStyle> = {
    card: { opacity: 20, blur: 0, depth: 5 },
    modal: { opacity: 40, blur: 32, depth: 100 },
    sidebar: { opacity: 0, blur: 0, depth: 0 },
    content: { opacity: 0, blur: 0, depth: 0 },
    toolbar: { opacity: 0, blur: 0, depth: 0 },
    widget: { opacity: 20, blur: 32, depth: 100 }
}

/** @desc 首次进入时的默认外观（昼夜各一份）：白天更通透、黑夜更沉浸 */
export const DEFAULT_APPEARANCE: Record<ThemeMode, ThemeAppearance> = {
    light: {
        bgImageBlur: 0,
        bgImageMask: 200,
        surfaces: {
            card: { opacity: 15, blur: 5, depth: 15 },
            modal: { opacity: 60, blur: 32, depth: 100 },
            sidebar: { opacity: 0, blur: 0, depth: 10 },
            content: { opacity: 40, blur: 0, depth: 0 },
            toolbar: { opacity: 20, blur: 32, depth: 0 },
            widget: { opacity: 20, blur: 32, depth: 0 }
        }
    },
    dark: {
        bgImageBlur: 0,
        bgImageMask: -130,
        surfaces: {
            card: { opacity: 20, blur: 0, depth: 5 },
            modal: { opacity: 60, blur: 32, depth: 100 },
            sidebar: { opacity: 0, blur: 0, depth: 0 },
            content: { opacity: 0, blur: 0, depth: 0 },
            toolbar: { opacity: 0, blur: 0, depth: 0 },
            widget: { opacity: 20, blur: 32, depth: 100 }
        }
    }
}

/** @desc 卡片 / 弹窗 / 小部件 / 按钮 / 输入框的默认圆角（px）。刻意不是 0：默认就该是「微圆」而不是直角 */
export const DEFAULT_SURFACE_RADIUS = 2
/** @desc 圆角可调范围（px）；上限压住以免把卡片画成胶囊 */
export const SURFACE_RADIUS_MAX = 20

const DEFAULT_OVERRIDES: ThemeOverrides = {
    accentHue: 190,
    backgroundImage: '',
    backgroundImageLight: '',
    appearance: structuredClone(DEFAULT_APPEARANCE),
    neonTextGlow: 0,
    neonInsetGlow: 0,
    surfaceRadius: DEFAULT_SURFACE_RADIUS
}

/** @desc 霓虹灯两档发光的可调上限（px）；再大就糊成一团 */
export const NEON_GLOW_MAX = 10
/** @desc 霓虹灯两档发光的默认值（px）= 关闭 */
export const DEFAULT_NEON_GLOW = 0

/**
 * @desc 首次进入：把外观恢复为默认（昼夜两套默认质感 + 内置默认背景图），并落盘。
 * 默认背景图为 base64 内联，用户可在设置里替换或清空。
 *
 * ⚠️ 内置背景图（./default-backgrounds）必须**动态 import**，不能写成顶层静态 import。
 * 那两个常量合计约 280KB base64，而全项目只有本函数用它们、且本函数只在首次进入时被调用
 * （见 `$routes/store.svelte.ts` 的 `isFirstVisit()` 分支）。写成静态 import 会把
 * `default-backgrounds` 拉进模块图，被**根 layout（nodes/0）**静态引用而在首屏关键路径上整体下载
 * —— 每个用户、每次进入都付这 280KB，而它只在「首次进入」才用得上。
 * 动态 import 后它成为独立 chunk，只有走到这里才请求。改动后请用构建产物复核：
 * `nodes/0` 不再静态 import 该 chunk（.tmp 下有现成的可达性分析脚本思路）。
 */
export async function applyFirstRunAppearance() {
    const { DEFAULT_BACKGROUND_DARK, DEFAULT_BACKGROUND_LIGHT } = await import('./default-backgrounds')
    overrides = {
        ...structuredClone(DEFAULT_OVERRIDES),
        appearance: structuredClone(DEFAULT_APPEARANCE),
        backgroundImage: DEFAULT_BACKGROUND_DARK,
        backgroundImageLight: DEFAULT_BACKGROUND_LIGHT
    }
    await dbSet(OVERRIDES_KEY, toPlain(overrides))
    applyThemeCSS()
}

let themes = $state<Theme[]>([])
let activeId = $state<string>('')
let overrides = $state<ThemeOverrides>(structuredClone(DEFAULT_OVERRIDES))

const toPlain = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** @desc 当前昼夜主题（非 light 一律按 dark 处理） */
const activeMode = (): ThemeMode => (activeId === 'light' ? 'light' : 'dark')

/** @desc 归一化外观设置：缺项回落到默认值（旧的持久化数据不做迁移，缺项直接用默认） */
/** @desc 归一化外观设置：缺项按该昼夜的默认值回落 */
function normalizeAppearance(raw: unknown, mode: ThemeMode): ThemeAppearance {
    const src = (raw ?? {}) as Partial<ThemeAppearance>
    const base = DEFAULT_APPEARANCE[mode]
    const surfaces = structuredClone(base.surfaces)
    for (const key of SURFACE_KEYS) {
        const saved = (src.surfaces ?? {})[key]
        if (saved) surfaces[key] = { ...base.surfaces[key], ...saved }
    }
    return {
        bgImageBlur: typeof src.bgImageBlur === 'number' ? src.bgImageBlur : base.bgImageBlur,
        bgImageMask: typeof src.bgImageMask === 'number' ? src.bgImageMask : base.bgImageMask,
        surfaces
    }
}

/** @desc 某区域在指定昼夜下的默认外观（「重置该区域」用） */
export function defaultSurfaceStyle(key: SurfaceKey, mode: ThemeMode = activeMode()): SurfaceStyle {
    return DEFAULT_APPEARANCE[mode].surfaces[key]
}

/** @desc 当前昼夜下的外观设置（背景图效果 + 各表面） */
export function getAppearance(mode: ThemeMode = activeMode()): ThemeAppearance {
    return overrides.appearance[mode]
}

/** @desc 读取某个表面的外观设置（默认取当前昼夜） */
export function getSurfaceStyle(key: SurfaceKey, mode: ThemeMode = activeMode()): SurfaceStyle {
    return overrides.appearance[mode].surfaces[key] ?? DEFAULT_APPEARANCE[mode].surfaces[key]
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

/** @desc 把某一昼夜的外观恢复为默认（区域质感 + 背景图效果；不动背景图与主色调） */
export async function resetAppearance(mode: ThemeMode = activeMode()) {
    overrides = {
        ...overrides,
        appearance: { ...overrides.appearance, [mode]: structuredClone(DEFAULT_APPEARANCE[mode]) }
    }
    await dbSet(OVERRIDES_KEY, toPlain(overrides))
    applyBgBlend(document.documentElement)
}

function applyThemeCSS() {
    if (!browser) return
    const root = document.documentElement
    const theme = themes.find((t) => t.id === activeId)
    if (!theme) return

    for (const [key, comp] of Object.entries(theme.components)) {
        setCSSVar(root, key, 'bg', comp?.backgroundImage)
        setCSSVar(root, key, 'bg-focused', comp?.backgroundImageFocused)
        setCSSVar(root, key, 'text', comp?.textColor)
        setCSSVar(root, key, 'text-focused', comp?.textColorFocused)
        setCSSVar(root, key, 'border', comp?.borderColor)
        setCSSVar(root, key, 'border-focused', comp?.borderColorFocused)
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

    // 排轴操作块的「变奏 / 切回」角标：同样白天加深（原 yellow-400 / cyan-400 在近白底上只有 1.5:1 左右）
    root.style.setProperty('--theme-intro-text', isLight ? '#a16207' : '#facc15')
    root.style.setProperty('--theme-switchback-text', isLight ? '#0e7490' : '#22d3ee')

    // 角色标签「墨水色」：只给白天一个 OKLCh 明度，组件用 oklch(from 上游原色 var(--theme-tag-ink-l, l) c h)
    // 现算（保留色相/彩度）；黑夜清掉该变量 → CSS 回落 l 关键字，等价于上游原色
    if (isLight) root.style.setProperty('--theme-tag-ink-l', TAG_INK_LIGHT_L)
    else root.style.removeProperty('--theme-tag-ink-l')

    applyOverridesCSS(root)

    // 标题栏颜色同步到 PWA theme-color（原生标题栏着色，移动端地址栏 / 桌面标题栏联动）
    const titlebarBg =
        root.style.getPropertyValue('--theme-titlebar-bg')?.trim() || theme.components.titlebar?.backgroundImage
    if (titlebarBg) {
        /*
         * `app.html` 为了「开屏跟随系统」放了**两条** `meta[name=theme-color]`，各自带
         * `media="(prefers-color-scheme: dark|light)"`。JS 启动后颜色真相源变成用户选择的主题，
         * 而用户的选择未必等于系统档 —— 若只改第一条（原实现），浅色系统 + 手动选深色主题时
         * 浏览器会用另一条 media 命中的值，标题栏颜色就错了。
         * 故这里把整组收敛成一条无 media 的 meta：改第一条、摘掉它的 media、删掉其余。
         */
        const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
        let meta = metas[0]
        if (!meta) {
            meta = document.createElement('meta')
            meta.name = 'theme-color'
            document.head.appendChild(meta)
        }
        meta.removeAttribute('media')
        meta.content = titlebarBg
        for (const extra of metas.slice(1)) extra.remove()
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
    // 遮罩：负值压暗（可一路压到全黑），正值偏白；换算口径见 $lib/theme/bg-mask
    root.style.setProperty('--theme-bg-mask', bgMaskCss(appearance.bgImageMask))

    // ── 六类区域：透明度 / 毛玻璃强度 / 背景深度（由 layout.css 的 [data-sf] 规则消费）──
    for (const key of SURFACE_KEYS) {
        const style = appearance.surfaces[key] ?? DEFAULT_APPEARANCE[activeMode()].surfaces[key]
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
    applySurfaceRadius(root)
    applyNeonGlow(root)
}

/**
 * @desc 霓虹灯两档发光（字体 / 内阴影）——各自独立开关，默认都是 0px（关闭）。
 * 用**加类 + 写变量**而不是直接写内联样式：发光要作用到整棵子树（字体）或一类元素（内阴影），
 * 只能靠样式表里的 `.neon-text *` / `.neon-inset …` 规则；这里只负责开关与半径。
 * 关掉时必须把对应 class 摘掉 —— 否则会留下一条 0px 的 `box-shadow` 声明，
 * 那依然会覆盖元素原有的 `shadow-*`（内阴影那条规则会重排整条 box-shadow）。
 */
function applyNeonGlow(root: HTMLElement) {
    const textGlow = getNeonGlow('text')
    const insetGlow = getNeonGlow('inset')
    root.classList.toggle('neon-text', textGlow > 0)
    root.classList.toggle('neon-inset', insetGlow > 0)
    root.style.setProperty('--theme-neon-glow', `${textGlow}px`)
    root.style.setProperty('--theme-neon-inset-glow', `${insetGlow}px`)
    /**
     * @desc 内阴影颜色：**与主题明暗相反的一极** —— 浅色主题用白、深色主题用黑。
     * 刻意不用 `currentColor`：那是「按文字色发光」，而文字色在浅色主题下是深色、
     * 在深色主题下是浅色，正好与内阴影想要的明暗相反（用户实测点出「做反了」）。
     * 口径与 `--sf-{key}-target`（背景深度的极值色）一致，故复用它同一套判断。
     */
    root.style.setProperty('--theme-neon-inset-color', activeId === 'light' ? '#ffffff' : '#000000')
}

/** @desc 霓虹灯某一档的当前半径（px）；脏值/缺项一律回落默认（关闭） */
export function getNeonGlow(kind: 'text' | 'inset'): number {
    const raw = Number(kind === 'text' ? overrides.neonTextGlow : overrides.neonInsetGlow)
    if (!Number.isFinite(raw)) return DEFAULT_NEON_GLOW
    return clamp(raw, 0, NEON_GLOW_MAX)
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
    const savedId = activeSaved && themes.find((t) => t.id === activeSaved.data) ? activeSaved.data : null
    // 用户没选过主题时按系统深浅色落档（与开屏同一判定）；选过之后一律按保存值
    const fallbackId = systemDefaultThemeId() ?? DEFAULT_ACTIVE_ID
    activeId = savedId ?? themes.find((t) => t.id === fallbackId)?.id ?? themes[0]?.id ?? ''
    // 供开屏同步读取（见 THEME_MODE_KEY 的说明）
    writeThemeModeMirror()

    const ov = await dbGet<Partial<ThemeOverrides>>(OVERRIDES_KEY)
    if (ov) {
        // 外观设置按昼夜分别归一化（旧版扁平字段不再读取，缺项一律用默认值）
        overrides = {
            ...DEFAULT_OVERRIDES,
            ...ov.data,
            appearance: {
                dark: normalizeAppearance(ov.data.appearance?.dark, 'dark'),
                light: normalizeAppearance(ov.data.appearance?.light, 'light')
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
        // 圆角：旧数据没有这一项（回落默认），有但越界/非数的也一并夹回来
        const radius = clamp(Number(overrides.surfaceRadius), 0, SURFACE_RADIUS_MAX)
        if (!Number.isFinite(radius) || radius !== overrides.surfaceRadius) {
            overrides.surfaceRadius = Number.isFinite(radius) ? radius : DEFAULT_SURFACE_RADIUS
            trimmed = true
        }
        // 霓虹灯：旧字段是**百分比**强度 `neonText`（默认 1，即肉眼不可见的 0.1px），
        // 现已拆成「字体 / 边框」两档 px 值。转换口径：`neonText <= 1`（含历史默认值）
        // 视为「没开过」，直接落到新的 0px 默认；其余按原换算 强度/100*10 折成 px。
        const legacyNeon = Number((ov.data as { neonText?: unknown }).neonText)
        if (Number.isFinite(legacyNeon)) {
            overrides.neonTextGlow =
                legacyNeon > 1 ? clamp((legacyNeon / 100) * 10, 0, NEON_GLOW_MAX) : DEFAULT_NEON_GLOW
            overrides.neonInsetGlow = DEFAULT_NEON_GLOW
            trimmed = true
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
        writeThemeModeMirror()
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
    if (key === 'surfaceRadius') applySurfaceRadius(root)
    if (key === 'neonTextGlow' || key === 'neonInsetGlow') applyNeonGlow(root)
}

/**
 * @desc 当前统一圆角（px）。给**无法走 CSS 变量**的消费方用：SVG `<rect rx>` 是几何**属性**，
 * 属性值不接受 `var()`（只能靠 CSS `rx` 属性覆盖，而该属性的浏览器支持还不齐），
 * 故侧边栏占位图标这类 SVG 直接用脚本值绑定。普通 DOM 请用 `layout.css` 的 `sf-radius` / 未分层规则。
 */
export function getSurfaceRadius(): number {
    const raw = Number(overrides.surfaceRadius)
    // 旧持久化数据缺这一项 / 被写坏时回落默认，避免 NaN 让 `border-radius` 整条声明失效
    if (!Number.isFinite(raw)) return DEFAULT_SURFACE_RADIUS
    return clamp(raw, 0, SURFACE_RADIUS_MAX)
}

/**
 * @desc 把统一圆角写到 `--theme-surface-radius`（`layout.css` 的未分层规则消费它）。
 * 用 CSS 变量而不是逐个改组件 class：全项目 508 处 `rounded-none` 分属不同语义
 * （输入框 / 表格单元格 / 装饰线…），逐个替换既动不了「统一调节」这件事，也会误伤直角语义。
 * `layout.css` 的 `:root` 里另有一份同样的默认值，供 JS 尚未执行时兜底。
 */
function applySurfaceRadius(root: HTMLElement) {
    root.style.setProperty('--theme-surface-radius', `${getSurfaceRadius()}px`)
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
