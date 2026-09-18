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
    /** @desc 黑夜（dark 主题）背景图 */
    backgroundImage: string
    /** @desc 白天（light 主题）背景图；留空则白天不显示背景图 */
    backgroundImageLight: string
    bgOpacity: number
    /** @desc 弹窗（对话框）表面不透明度；与卡片透明度各自独立，明暗切换时不自动取反 */
    modalOpacity: number
    bgBlur: number
    bgDim: number
    // 背景图自身的独立控制（与玻璃表面分开）：背景图模糊、背景图遮罩强度
    bgImageBlur: number
    bgImageMask: number // -100(压暗) ~ 0(原图) ~ 100(明亮)
    neonText: number // 0=关, 1-100=霓虹灯强度
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
