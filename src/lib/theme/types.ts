export interface ComponentTheme {
    backgroundImage?: string
    backgroundImageFocused?: string
    textColor?: string
    textColorFocused?: string
    borderColor?: string
    borderColorFocused?: string
}

export interface Theme {
    id: string
    name: string
    elementColors?: Record<string, string>
    components: Record<string, ComponentTheme>
}

export interface ThemeOverrides {
    accentHue: number | 'mono' | null
    backgroundImage: string
    bgOpacity: number
    bgBlur: number
}

export type ThemeComponentKey =
    | 'btn'
    | 'search-box'
    | 'avatar'
    | 'tabs'
    | 'modal'
    | 'context-menu'
    | 'toast'
    | 'toast-top'
    | 'timeline'
    | 'layout'
    | 'sidebar'
    | 'card'
    | 'input'
    | 'accent'
    | 'divider'
    | 'overlay'
    | 'muted'
    | 'watermark'
