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

/** @desc 单个表面的外观：透明度 / 毛玻璃强度 / 背景深度 */
export interface SurfaceStyle {
    /** @desc 表面不透明度 0-100（在主题底色自带的 alpha 之上再乘一层） */
    opacity: number
    /** @desc 毛玻璃强度（backdrop-filter blur 半径，px；0 = 关闭，不产生合成开销） */
    blur: number
    /** @desc 背景深度 0-100：0=主题原底色，越大越接近主题极值（昼主题更白、夜主题更黑） */
    depth: number
}

/** @desc 可独立配置透明度/毛玻璃/深度的五类区域 */
export type SurfaceKey = 'card' | 'modal' | 'sidebar' | 'content' | 'toolbar'

/** @desc 五类区域说明（顺序即设置面板顺序；labels 供 UI 与 AI 工具复用） */
export const SURFACE_GROUPS: { label: string; items: { key: SurfaceKey; label: string; hint: string }[] }[] = [
    {
        label: '外观质感',
        items: [
            {
                key: 'card',
                label: '卡片',
                hint: '声骸/套装/方案等一般卡片、排轴操作块、下拉拉表与结果页的行、平铺拉表单元格'
            },
            { key: 'modal', label: '弹窗', hint: '所有对话框（设置、工坊、选择器、确认框等）' },
            { key: 'sidebar', label: '侧边栏', hint: '工程列表侧边栏、顶部标题栏' },
            {
                key: 'content',
                label: '主内容区',
                hint: '欢迎页、队伍配置、排轴、平铺拉表、下拉拉表、词条/环境配置、结果'
            },
            { key: 'toolbar', label: '工具栏', hint: '顶部工具栏、底部工具栏、底部悬浮工具栏' }
        ]
    }
]

/** @desc 全部区域 key（顺序与设置面板一致） */
export const SURFACE_KEYS: SurfaceKey[] = SURFACE_GROUPS.flatMap((g) => g.items.map((i) => i.key))

/** @desc 区域中文名（AI 工具返回与提示用） */
export const SURFACE_LABELS: Record<SurfaceKey, string> = Object.fromEntries(
    SURFACE_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label]))
) as Record<SurfaceKey, string>

/** @desc 一个昼夜主题下与应用外观相关的设置（背景图效果 + 各表面外观） */
export interface ThemeAppearance {
    /** @desc 背景图自身的模糊半径 px */
    bgImageBlur: number
    /** @desc 背景图遮罩：-100 压暗 ~ 0 原图 ~ 100 偏白 ~ 200 更白 */
    bgImageMask: number
    /** @desc 各表面的透明度 / 毛玻璃强度 / 背景深度 */
    surfaces: Record<SurfaceKey, SurfaceStyle>
}

export type ThemeMode = 'dark' | 'light'

export interface ThemeOverrides {
    accentHue: number | 'mono' | null
    /** @desc 黑夜（dark 主题）背景图 */
    backgroundImage: string
    /** @desc 白天（light 主题）背景图；留空则白天不显示背景图 */
    backgroundImageLight: string
    /** @desc 背景图效果与背景质感：按昼夜分别保存 */
    appearance: Record<ThemeMode, ThemeAppearance>
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
