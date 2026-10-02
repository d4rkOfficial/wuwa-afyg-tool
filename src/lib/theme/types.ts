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
    /**
     * @desc 组件配色覆盖。键受 `ThemeComponentKey` 约束，故 preset 里写错/漏配命名空间会被类型检查拦住；
     * 允许部分提供（用户自建主题经 `addTheme` 只有 `{}`）。
     */
    components: Partial<Record<ThemeComponentKey, ComponentTheme>>
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

/** @desc 可独立配置透明度/毛玻璃/深度的六类区域 */
export type SurfaceKey = 'card' | 'modal' | 'sidebar' | 'content' | 'toolbar' | 'widget'

/** @desc 六类区域说明（顺序即设置面板顺序；labels 供 UI 与 AI 工具复用） */
export const SURFACE_GROUPS: { label: string; items: { key: SurfaceKey; label: string; hint: string }[] }[] = [
    {
        label: '外观质感',
        items: [
            {
                key: 'card',
                label: '卡片',
                hint: '卡片类容器：声骸/套装/方案卡、结果页伤害行、下拉拉表与平铺拉表的行与单元格'
            },
            { key: 'modal', label: '弹窗', hint: '所有弹窗外壳（设置、工坊、各类 picker、确认框）的面板本体' },
            { key: 'sidebar', label: '侧边栏', hint: '工程列表侧边栏，含其顶部标题栏与列表项' },
            {
                key: 'content',
                label: '主内容区',
                hint: '欢迎页、队伍配置、排轴、拉表、词条/环境配置、结果页各自的主内容区底色'
            },
            { key: 'toolbar', label: '工具栏', hint: '顶部工具栏、底部工具栏、底部悬浮工具栏、阶段页签栏' },
            {
                key: 'widget',
                label: '小部件',
                hint: '小控件，可出现在任意容器内部（故与上面五项正交）：卡片式小块及其行/格、图标按钮、picker 卡、声骸槽卡、词条卡、操作块、属性/抗性输入框等。成片逐行/逐格元素请叠加 data-sf-flat，避免每个元素都重算一次背景模糊。注：开关与滑块用语义色、下拉与菜单项走 --theme-context-menu-* 组件命名空间，均不归本区域'
            }
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
    /** @desc 背景图遮罩：-200 全黑 ~ -100 压暗 ~ 0 原图 ~ 100 偏白 ~ 200 极白 */
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

/**
 * @desc 可被主题预设覆盖配色的组件命名空间。
 * 每一项对应 preset JSON 的 `components[key]`，由 `theme.svelte.ts` 发射为 `--theme-{key}-{prop}`。
 * 必须与 `theme/preset/{dark,light}.json` 的 `components` 键**完全一致**（`pnpm run check:surfaces` 校验）。
 * 新增命名空间时三处同步改：types 此处 + dark.json + light.json。
 */
export type ThemeComponentKey =
    // ── 通用元件 ──
    | 'btn'
    | 'search-box'
    | 'avatar'
    | 'tabs'
    // ── 容器与外壳 ──
    | 'modal'
    | 'context-menu'
    | 'toast'
    | 'titlebar'
    | 'sidebar'
    | 'layout'
    | 'card'
    | 'timeline'
    // ── 中性色与线条 ──
    | 'input'
    | 'accent'
    | 'divider'
    | 'overlay'
    | 'muted'
