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
    updateOverride
} from './theme.svelte.js'

export type { Theme, ComponentTheme, ThemeComponentKey, ThemeOverrides } from './types.js'
