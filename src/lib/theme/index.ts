export {
    loadThemes,
    getThemes,
    getActiveTheme,
    getActiveId,
    setActiveTheme,
    getComponentTheme,
    updateComponentTheme,
    addTheme,
    removeTheme,
    getOverrides,
    updateOverride,
    getAppearance,
    getSurfaceStyle,
    setSurfaceStyle,
    setBgImageEffect,
    resetAppearance,
    DEFAULT_SURFACES,
    DEFAULT_APPEARANCE,
    defaultSurfaceStyle,
    applyFirstRunAppearance
} from './theme.svelte.js'

export { SURFACE_KEYS, SURFACE_GROUPS, SURFACE_LABELS } from './types.js'

export { BG_MASK_MIN, BG_MASK_MAX, bgMaskOf, bgMaskCss, bgMaskLabel } from './bg-mask.js'
export type { BgMaskColor } from './bg-mask.js'

export type {
    Theme,
    ComponentTheme,
    ThemeComponentKey,
    ThemeOverrides,
    ThemeAppearance,
    ThemeMode,
    SurfaceKey,
    SurfaceStyle
} from './types.js'
