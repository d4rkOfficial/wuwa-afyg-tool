// 设置域工具：AI/WS 可修改的设置白名单——覆盖「设置」弹窗全部可配置项
// （外观主题 / 按键图标 / 交互-拉表视图+工具栏简化+右键菜单简化+界面快捷键 / 工坊 / 性能 / 连接配置-数据源 / 缓存清理 / 助手设置）。
// 仅「自定义主题创建/删除」需用户手动操作。
import { defineTool } from './registry'
import {
    getActiveId,
    getAppearance,
    getOverrides,
    getSurfaceStyle,
    setActiveTheme,
    setBgImageEffect,
    resetAppearance,
    setSurfaceStyle,
    updateOverride,
    defaultSurfaceStyle,
    SURFACE_KEYS,
    SURFACE_LABELS,
    BG_MASK_MIN,
    BG_MASK_MAX,
    type SurfaceKey,
    type SurfaceStyle,
    type ThemeMode
} from '$lib/theme'
import { getCalcViewMode, setCalcViewMode } from '$lib/data/calc-view.svelte'
import { getSimplifyToolbar, setSimplifyToolbar } from '$lib/data/toolbar-prefs.svelte'
import { getSimplifyContextMenu, setSimplifyContextMenu } from '$lib/data/context-menu-prefs.svelte'
import {
    getGpuAccel,
    getReloadOnProfileChange,
    getReloadOnResultRefresh,
    setGpuAccel,
    setReloadOnProfileChange,
    setReloadOnResultRefresh,
    setMagneticPointer,
    getMagneticPointer
} from '$lib/data/render-prefs.svelte'
import {
    addWorkshop,
    getActiveWorkshopId,
    getWorkshopInstances,
    removeWorkshop,
    resetWorkshop,
    setActiveWorkshop
} from '$lib/data/workshop.svelte'
import {
    getActiveProviderId,
    getProviderOptions,
    resetActiveProvider,
    setActiveProvider
} from '$lib/data/provider-prefs.svelte'
import { clearCache, clearCacheCategory, countCacheCategory, type CacheCategory } from '$lib/api/data-cache'
import { getKeyMapEntries, resetKeyMap, updateKeyMapEntry } from '$lib/data/keymap.svelte'
import {
    getShortcutDef,
    getShortcutKey,
    getShortcuts,
    resetShortcuts,
    updateShortcut
} from '$lib/data/shortcuts.svelte'
import {
    addProfile,
    deleteProfile,
    getActiveProfileId,
    getAiProfiles,
    setActiveProfile,
    updateProfile,
    type AiProfile
} from '$lib/ai/config.svelte'
import { getGenPrefs, updateGenPrefs, type DangerMode } from '$lib/data/ai-prefs.svelte'
import {
    DEFAULT_LOCK_WATERMARK_TEXT,
    LOCK_WATERMARK_TEXT_MAX,
    TOAST_POSITIONS,
    getConfirmDeletes,
    getModalClosePosition,
    getMultiEntryExpand,
    getSidebarActions,
    getEffectiveLockWatermarkText,
    getLockWatermark,
    getToastPosition,
    setConfirmDeletes,
    setModalClosePosition,
    setMultiEntryExpand,
    setSidebarActions,
    setLockWatermark,
    setLockWatermarkText,
    setToastPosition,
    type ToastPosition
} from '$lib/data/interaction-prefs.svelte'
import {
    getKuroActiveRole,
    getKuroReason,
    getKuroSession,
    getKuroValid,
    setKuroRoleId
} from '$lib/kuro-app/kuro.svelte'

const str = (v: unknown): string => String(v ?? '').trim()

/** @desc 解析目标昼夜：'light'/'dark'（也接受 白天/黑夜），缺省取当前生效主题 */
function resolveMode(raw: unknown): ThemeMode {
    const v = str(raw).toLowerCase()
    if (v === 'light' || v === '白天') return 'light'
    if (v === 'dark' || v === '黑夜') return 'dark'
    return getActiveId() === 'light' ? 'light' : 'dark'
}

function toBool(v: unknown, key: string): boolean {
    if (typeof v === 'boolean') return v
    if (v === 'true' || v === 1 || v === '1') return true
    if (v === 'false' || v === 0 || v === '0') return false
    throw new Error(`key ${key} 的值须为布尔（true/false）`)
}

function toNum(v: unknown, key: string): number {
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error(`key ${key} 的值须为数字`)
    return n
}

function clampNum(v: unknown, key: string, min: number, max: number): number {
    const n = toNum(v, key)
    if (n < min || n > max) throw new Error(`key ${key} 的值须在 ${min}-${max} 之间`)
    return n
}

// ── 白名单：key → 中文名 + 应用函数 ──
const KEY_APPLYERS: Record<string, { label: string; apply: (v: unknown) => Promise<unknown> }> = {
    // ── 外观主题 ──
    theme_mode: {
        label: '明暗模式',
        apply: async (v) => {
            const mode = str(v)
            if (mode !== 'dark' && mode !== 'light') throw new Error('theme_mode 须为 dark/light')
            await setActiveTheme(mode)
            return mode
        }
    },
    theme_accent_hue: {
        label: '主色调',
        apply: async (v) => {
            const nameMap: Record<string, number | 'mono' | null> = {
                default: 190, // 默认 = 青色
                orange: 28,
                orangeyellow: 90, // 橙黄（偏黄）
                magenta: 345, // 品红（偏粉）
                cyan: 190, // 青色别名（与默认同色）
                indigo: null, // 靛蓝 = 主题内置色
                green: 150,
                mono: 'mono'
            }
            let hue: number | 'mono' | null
            if (v === null) {
                hue = null
            } else if (typeof v === 'string' && v in nameMap) {
                hue = nameMap[v]!
            } else {
                hue = toNum(v, 'theme_accent_hue')
                if (!Number.isInteger(hue) || hue! < 0 || hue! > 360)
                    throw new Error(
                        'theme_accent_hue 须为 0-360 的整数，或 default/orange/orangeyellow/magenta/cyan/indigo/green/mono'
                    )
            }
            await updateOverride('accentHue', hue)
            return hue
        }
    },
    theme_background_image: {
        label: '背景图',
        apply: async (v) => {
            // 两种写法：直接给图片地址（写入当前主题那张），或 { mode: 'light'|'dark', url } 指定昼夜
            const obj = v && typeof v === 'object' ? (v as Record<string, unknown>) : null
            const url = str(obj ? obj.url : v)
            if (url && !/^(https?:\/\/|data:image\/)/i.test(url))
                throw new Error('主题背景图须为 http(s):// 图片地址、data:image 数据，或空字符串（清除）')
            const MODES: Record<string, 'light' | 'dark'> = {
                light: 'light',
                dark: 'dark',
                白天: 'light',
                黑夜: 'dark'
            }
            const modeRaw = str(obj?.mode).toLowerCase()
            if (modeRaw && !MODES[modeRaw]) throw new Error('背景图的 mode 只能是 light/dark（白天/黑夜）')
            const mode: 'light' | 'dark' = modeRaw ? MODES[modeRaw]! : getActiveId() === 'light' ? 'light' : 'dark'
            await updateOverride(mode === 'light' ? 'backgroundImageLight' : 'backgroundImage', url)
            return { mode: mode === 'light' ? '白天' : '黑夜', value: url ? '已设置' : '已清除' }
        }
    },
    theme_bg_image_effect: {
        label: '背景图效果（模糊/遮罩）',
        apply: async (v) => {
            const obj = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
            const mode = resolveMode(obj.mode)
            const patch: { bgImageBlur?: number; bgImageMask?: number } = {}
            if (obj.blur !== undefined) patch.bgImageBlur = clampNum(obj.blur, 'theme_bg_image_effect.blur', 0, 32)
            if (obj.mask !== undefined)
                patch.bgImageMask = clampNum(obj.mask, 'theme_bg_image_effect.mask', BG_MASK_MIN, BG_MASK_MAX)
            if (!Object.keys(patch).length)
                throw new Error(`须提供 blur（0-32）或 mask（${BG_MASK_MIN} 全黑 ~ 0 原图 ~ ${BG_MASK_MAX} 极白）`)
            await setBgImageEffect(patch, mode)
            const now = getAppearance(mode)
            return { mode: mode === 'light' ? '白天' : '黑夜', blur: now.bgImageBlur, mask: now.bgImageMask }
        }
    },
    appearance_reset: {
        label: '恢复默认外观（当前昼夜）',
        apply: async (v) => {
            const mode = resolveMode(v)
            await resetAppearance(mode)
            const now = getAppearance(mode)
            return {
                mode: mode === 'light' ? '白天' : '黑夜',
                bgImageBlur: now.bgImageBlur,
                bgImageMask: now.bgImageMask,
                surfaces: Object.fromEntries(SURFACE_KEYS.map((k) => [SURFACE_LABELS[k], now.surfaces[k]]))
            }
        }
    },
    surface_style: {
        label: '区域质感（不透明度/毛玻璃/背景深度）',
        apply: async (v) => {
            const obj = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
            const key = str(obj.surface) as SurfaceKey
            if (!SURFACE_KEYS.includes(key))
                throw new Error(`surface 须为 ${SURFACE_KEYS.map((k) => `${k}（${SURFACE_LABELS[k]}）`).join(' / ')}`)
            const mode = resolveMode(obj.mode)
            if (obj.reset === true) {
                await setSurfaceStyle(key, defaultSurfaceStyle(key, mode), mode)
            } else {
                const patch: Partial<SurfaceStyle> = {}
                if (obj.opacity !== undefined) patch.opacity = clampNum(obj.opacity, 'surface_style.opacity', 0, 100)
                if (obj.blur !== undefined) patch.blur = clampNum(obj.blur, 'surface_style.blur', 0, 32)
                if (obj.depth !== undefined) patch.depth = clampNum(obj.depth, 'surface_style.depth', 0, 100)
                if (!Object.keys(patch).length)
                    throw new Error(
                        '须提供 opacity（0-100）/ blur（0-32）/ depth（0-100），或用 reset=true 恢复该类默认'
                    )
                await setSurfaceStyle(key, patch, mode)
            }
            return {
                surface: SURFACE_LABELS[key],
                mode: mode === 'light' ? '白天' : '黑夜',
                ...getSurfaceStyle(key, mode)
            }
        }
    },
    // ── 交互相关 ──
    calc_view: {
        label: '拉表视图',
        apply: async (v) => {
            const mode = str(v)
            if (mode !== 'dropdown' && mode !== 'spread') throw new Error('calc_view 须为 dropdown/spread')
            setCalcViewMode(mode)
            return mode
        }
    },
    simplify_toolbar: {
        label: '简化底部工具栏',
        apply: async (v) => {
            const b = toBool(v, 'simplify_toolbar')
            setSimplifyToolbar(b)
            return b
        }
    },
    magnetic_pointer: {
        label: '磁力光标',
        apply: async (v) => {
            const b = toBool(v, 'magnetic_pointer')
            setMagneticPointer(b)
            return b
        }
    },
    simplify_context_menu: {
        label: '简化右键菜单',
        apply: async (v) => {
            const b = toBool(v, 'simplify_context_menu')
            setSimplifyContextMenu(b)
            return b
        }
    },
    modal_close_position: {
        label: '弹窗关闭按钮位置',
        apply: async (v) => {
            const pos = str(v)
            if (pos !== 'top-left' && pos !== 'top-right')
                throw new Error('modal_close_position 须为 top-left 或 top-right')
            setModalClosePosition(pos)
            return pos
        }
    },
    sidebar_actions: {
        label: '侧边栏显示新建/导入按钮',
        apply: async (v) => {
            const b = toBool(v, 'sidebar_actions')
            setSidebarActions(b)
            return b
        }
    },
    confirm_deletes: {
        label: '删除前二次确认',
        apply: async (v) => {
            const b = toBool(v, 'confirm_deletes')
            setConfirmDeletes(b)
            return b
        }
    },
    toast_position: {
        label: '消息提示位置',
        apply: async (v) => {
            const pos = str(v) as ToastPosition
            if (!TOAST_POSITIONS.includes(pos)) throw new Error(`toast_position 须为 ${TOAST_POSITIONS.join('/')}`)
            setToastPosition(pos)
            return pos
        }
    },
    multi_entry_expand: {
        label: '结果页允许同时展开多个伤害条目',
        apply: async (v) => {
            const b = toBool(v, 'multi_entry_expand')
            setMultiEntryExpand(b)
            return b
        }
    },
    lock_watermark: {
        label: '显示锁定水印',
        apply: async (v) => {
            const b = toBool(v, 'lock_watermark')
            setLockWatermark(b)
            return b
        }
    },
    lock_watermark_text: {
        label: '锁定水印文本',
        apply: async (v) => {
            const text = str(v).slice(0, LOCK_WATERMARK_TEXT_MAX)
            setLockWatermarkText(text)
            return getEffectiveLockWatermarkText()
        }
    },

    // ── 库街区（实验性）──
    kuro_role: {
        label: '库街区同步使用的绑定角色 roleId',
        apply: async (v) => {
            const roleId = str(v)
            const hit = getKuroSession().roles.find((r) => r.roleId === roleId)
            if (!hit) {
                const list = getKuroSession()
                    .roles.map((r) => `${r.roleId}（${r.nickname ?? '未命名'}）`)
                    .join('、')
                throw new Error(`未找到该 roleId；当前可用：${list || '（未登录或没有绑定角色）'}`)
            }
            setKuroRoleId(roleId)
            return roleId
        }
    },

    // ── 性能相关 ──
    gpu_accel: {
        label: '渲染加速（GPU）',
        apply: async (v) => {
            const b = toBool(v, 'gpu_accel')
            setGpuAccel(b)
            return b
        }
    },
    reload_on_result_refresh: {
        label: '刷新结果重载数据',
        apply: async (v) => {
            const b = toBool(v, 'reload_on_result_refresh')
            setReloadOnResultRefresh(b)
            return b
        }
    },
    reload_on_profile_change: {
        label: '链/阶变动重载数据',
        apply: async (v) => {
            const b = toBool(v, 'reload_on_profile_change')
            setReloadOnProfileChange(b)
            return b
        }
    },
    // ── 连接配置 ──
    data_provider: {
        label: '上游数据源',
        apply: async (v) => {
            const id = str(v)
            if (id === 'default' || id === 'reset') {
                resetActiveProvider()
            } else {
                if (!getProviderOptions().some((o) => o.id === id))
                    throw new Error(`未知数据源 ${id}，可用 get_settings_state 查看可选项`)
                if (!setActiveProvider(id)) throw new Error(`数据源 ${id} 切换失败`)
            }
            clearCache()
            return getActiveProviderId()
        }
    },
    // ── 缓存清理 ──
    clear_cache: {
        label: '缓存清理',
        apply: async (v) => {
            const kind = str(v)
            if (kind === 'list' || kind === 'info' || kind === 'image') {
                await clearCacheCategory(kind as CacheCategory)
            } else if (kind === 'all') {
                clearCache()
            } else {
                throw new Error('clear_cache 须为 list/info/image/all')
            }
            return {
                kind,
                counts: {
                    list: await countCacheCategory('list'),
                    info: await countCacheCategory('info'),
                    image: await countCacheCategory('image')
                }
            }
        }
    },
    // ── 助手设置 ──
    ai_enabled: {
        label: 'AI 助手开关',
        apply: async (v) => {
            const b = toBool(v, 'ai_enabled')
            await updateGenPrefs({ enabled: b })
            return b
        }
    },
    ai_danger_mode: {
        label: '危险操作确认策略',
        apply: async (v) => {
            const mode = str(v)
            if (mode !== 'ask' && mode !== 'ask_once' && mode !== 'trust')
                throw new Error('ai_danger_mode 须为 ask/ask_once/trust')
            await updateGenPrefs({ dangerMode: mode as DangerMode })
            return mode
        }
    },
    ai_persona_prompt: {
        label: 'AI 助手人设提示词',
        apply: async (v) => {
            const prompt = str(v)
            await updateGenPrefs({ systemPrompt: prompt })
            return prompt ? '已设置' : '已清除（恢复默认）'
        }
    }
}

/** 已固定不可调的参数 key：set_setting 调用静默忽略（不报错） */
const FIXED_SETTING_KEYS = new Set([
    'magnetic_follow',
    'magnetic_sensitivity',
    'magnetic_spin',
    'magnetic_wobble',
    'magnetic_border'
])

/** 已知但禁止修改的 key → 设置面板位置提示 */
const DENIED_HINTS: Record<string, string> = {
    theme_add: '外观主题（自定义主题需手动创建）',
    theme_remove: '外观主题（自定义主题需手动删除）'
}

defineTool('get_settings_state', {
    description:
        '读取当前设置状态——覆盖「设置」弹窗全部可配置项：外观主题、按键图标、交互（含锁定水印）、性能、工坊、连接配置（数据源）、缓存、助手设置。具体子项可用专用工具查询（get_keymap/get_shortcuts/get_ai_profiles/get_cache_counts）。',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        const overrides = getOverrides()
        const appearanceNow = getAppearance()
        const prefs = getGenPrefs()
        return {
            theme: {
                mode: getActiveId(),
                accentHue: overrides.accentHue,
                backgroundImage: overrides.backgroundImage ? '已设置' : '未设置',
                backgroundImageLight: overrides.backgroundImageLight ? '已设置' : '未设置',
                hint: '背景图效果与区域质感按昼夜分别保存；下列 appearance 为当前生效主题那一套，另一套用 mode 参数指定后可读改',
                appearance: {
                    mode: getActiveId() === 'light' ? '白天' : '黑夜',
                    bgImageBlur: appearanceNow.bgImageBlur,
                    bgImageMask: appearanceNow.bgImageMask,
                    surfaces: Object.fromEntries(SURFACE_KEYS.map((k) => [SURFACE_LABELS[k], getSurfaceStyle(k)])),
                    surfaceKeys: SURFACE_KEYS.map((k) => `${k}（${SURFACE_LABELS[k]}）`)
                }
            },
            interaction: {
                calcView: getCalcViewMode(),
                simplifyToolbar: getSimplifyToolbar(),
                simplifyContextMenu: getSimplifyContextMenu(),
                magneticPointer: getMagneticPointer(),
                confirmDeletes: getConfirmDeletes(),
                sidebarActions: getSidebarActions(),
                modalClosePosition: getModalClosePosition(),
                toastPosition: getToastPosition(),
                multiEntryExpand: getMultiEntryExpand(),
                lockWatermark: getLockWatermark(),
                lockWatermarkText: getEffectiveLockWatermarkText(),
                lockWatermarkTextDefault: DEFAULT_LOCK_WATERMARK_TEXT
            },
            kuro: {
                loggedIn: getKuroSession().loggedIn,
                phone: getKuroSession().account?.phone ?? '',
                account: getKuroSession().account?.userName ?? null,
                valid: getKuroValid(),
                reason: getKuroReason(),
                roles: getKuroSession().roles.map((r) => ({
                    roleId: r.roleId,
                    nickname: r.nickname ?? null,
                    serverName: r.serverName ?? null,
                    level: r.level ?? null
                })),
                activeRoleId: getKuroActiveRole()?.roleId ?? null
            },
            performance: {
                gpuAccel: getGpuAccel(),
                reloadOnResultRefresh: getReloadOnResultRefresh(),
                reloadOnProfileChange: getReloadOnProfileChange()
            },
            connection: {
                dataProviderId: getActiveProviderId(),
                dataProviderOptions: getProviderOptions()
            },
            cache: {
                counts: {
                    list: await countCacheCategory('list'),
                    info: await countCacheCategory('info'),
                    image: await countCacheCategory('image')
                },
                hint: '用 set_setting key=clear_cache 清理（值 list/info/image/all）'
            },
            ai: {
                enabled: prefs.enabled,
                dangerMode: prefs.dangerMode,
                personaPrompt: prefs.systemPrompt ? '已自定义' : '默认',
                skillHint: '命名规则 / 黑话词典已是内置技能卡，用 list_skills / use_skill 查看（设置里可编辑正文）',
                profileCount: getAiProfiles().length,
                activeProfileId: getActiveProfileId()
            },
            keymap: {
                count: getKeyMapEntries().length,
                hint: '用 get_keymap 查看详情，set_keymap_entry 修改或 reset=true 恢复默认'
            },
            shortcuts: {
                count: getShortcuts().length,
                hint: '用 get_shortcuts 查看详情，set_shortcut 修改或 reset=true 恢复默认'
            },
            workshop: { activeId: getActiveWorkshopId(), instances: getWorkshopInstances() },
            modifiableKeys: Object.entries(KEY_APPLYERS).map(([key, def]) => `${key}（${def.label}）`),
            hint: '可用 set_setting 修改上述 key；工坊实例操作请用 manage_workshop；AI 配置文件操作请用 manage_ai_profile。'
        }
    }
})

/**
 * @desc `surface_style` 的说明片段，必须与 `$lib/theme` 的 `SURFACE_GROUPS[*].hint` 保持一致。
 * 之所以内联为字面量而不拼接 `SURFACE_DOC`：`scripts/generate-tools-doc.mjs` 的 `pickString`
 * 只取第一个 `'...'` 字面量，拼接会导致生成的 `docs/tools.md` 被静默截断。
 * 一致性由 `pnpm run check:surfaces` 断言（hint 改动未同步此处即失败）。
 */
defineTool('set_setting', {
    description:
        '修改允许 AI 控制的设置。key 白名单：theme_mode(dark/light)、theme_accent_hue(default=青色/orange=橘红/orangeyellow=橙黄/magenta=品红/cyan=青色别名/indigo=靛蓝/green=墨绿/mono=黑白 或 0-360 整数)、theme_background_image(http(s)/data:image 地址或空串清除；白天/黑夜各一张，写法为地址或 {mode:"light"|"dark", url}，缺省写当前主题那张)、theme_bg_image_effect(对象 {blur?:0-32, mask?:-200全黑~0原图~200极白, mode?:"light"|"dark"}，按昼夜分别保存)、appearance_reset(值可空，或 "light"/"dark"/"白天"/"黑夜" 指定昼夜；恢复该昼夜的区域质感与背景图效果默认值)、surface_style(对象 {surface:"card|modal|sidebar|content|toolbar|widget", opacity?:0-100（不透明度）, blur?:0-32, depth?:0-100(昼更白/夜更黑), reset?:true, mode?:"light"|"dark"}，按昼夜分别保存；card=卡片（卡片类容器：声骸/套装/方案卡、结果页伤害行、下拉拉表与平铺拉表的行与单元格）；modal=弹窗（所有弹窗外壳（设置、工坊、各类 picker、确认框）的面板本体）；sidebar=侧边栏（工程列表侧边栏，含其顶部标题栏与列表项）；content=主内容区（欢迎页、队伍配置、排轴、拉表、词条/环境配置、结果页各自的主内容区底色）；toolbar=工具栏（顶部工具栏、底部工具栏、底部悬浮工具栏、阶段页签栏）；widget=小部件（小控件，可出现在任意容器内部（故与上面五项正交）：卡片式小块及其行/格、图标按钮、picker 卡、声骸槽卡、词条卡、操作块、属性/抗性输入框等。成片逐行/逐格元素请叠加 data-sf-flat，避免每个元素都重算一次背景模糊。注：开关与滑块用语义色、下拉与菜单项走 --theme-context-menu-* 组件命名空间，均不归本区域）)、calc_view(dropdown/spread)、simplify_toolbar、simplify_context_menu、magnetic_pointer、confirm_deletes(删除前二次确认)、sidebar_actions(侧边栏新建/导入按钮开关)、modal_close_position(top-left/top-right 弹窗关闭按钮位置)、toast_position(top-right/none/top-left/top-center/bottom-center/bottom-left/bottom-right)、multi_entry_expand(结果页是否允许同时展开多个伤害条目，默认 false=同时只展开一个)、lock_watermark(排轴锁定水印开关)、lock_watermark_text(水印文本，最长 24 字，空串=回落「已锁定」)、gpu_accel、reload_on_result_refresh、reload_on_profile_change、data_provider(数据源 id 或 default=重置)、clear_cache(list/info/image/all)、ai_enabled(布尔)、ai_danger_mode(ask/ask_once/trust)、ai_persona_prompt(文本或空串=恢复默认)。按键图标/快捷键位/AI 配置文件/工坊实例请用专用工具 set_keymap_entry/set_shortcut/manage_ai_profile/manage_workshop，归档管理用 archive_project/unarchive_project/delete_project；Buff 命名规则与黑话词典是内置技能卡，正文用技能工具（list_skills / use_skill）查看、由用户在设置里编辑。',
    parameters: {
        type: 'object',
        properties: {
            key: { type: 'string', description: '设置项 key（见描述中的白名单）' },
            value: { type: ['string', 'number', 'boolean'], description: '目标值' }
        },
        required: ['key', 'value']
    },
    handler: async (args) => {
        const key = str(args.key)
        // 磁力光标参数已固定（跟手性/旋转/灵敏度/描边/晃动）：调用静默忽略，不报错
        if (FIXED_SETTING_KEYS.has(key)) {
            return { key, ignored: true, message: '该设置已固定，无法修改' }
        }
        const def = KEY_APPLYERS[key]
        if (!def) {
            // 已知被禁止的设置 → 给出具体位置；未知 key → 通用提示
            const hint = DENIED_HINTS[key] ?? '该设置项'
            throw new Error(`「${key}」属于${hint}，不允许 AI 修改，请让用户打开「设置」面板手动调整。`)
        }
        const applied = await def.apply(args.value)
        return { key, label: def.label, applied }
    }
})

defineTool('manage_workshop', {
    description:
        '管理工坊实例：switch=切换到指定实例（传 id）、add=添加实例（传 url）、remove=删除实例（传 id，至少保留 1 个）、reset=恢复默认实例列表。返回当前实例列表与选中 id。',
    parameters: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['switch', 'add', 'remove', 'reset'], description: '操作类型' },
            id: { type: 'string', description: '实例 id（switch/remove 用）' },
            url: { type: 'string', description: '实例地址（add 用）' }
        },
        required: ['action']
    },
    handler: async (args) => {
        const action = str(args.action)
        const id = str(args.id)
        const url = str(args.url)
        if (action === 'switch') {
            if (!id) throw new Error('switch 需要传 id')
            if (!getWorkshopInstances().some((i) => i.id === id))
                throw new Error(`实例 ${id} 不存在，可用 get_settings_state 查看可用 id`)
            await setActiveWorkshop(id)
        } else if (action === 'add') {
            if (!url) throw new Error('add 需要传 url')
            const ok = await addWorkshop(url)
            if (!ok) throw new Error('地址无效或已存在（须为 http(s):// 地址）')
        } else if (action === 'remove') {
            if (!id) throw new Error('remove 需要传 id')
            const instances = getWorkshopInstances()
            if (!instances.some((i) => i.id === id)) throw new Error(`实例 ${id} 不存在`)
            if (instances.length <= 1) throw new Error('至少保留 1 个工坊实例')
            await removeWorkshop(id)
        } else if (action === 'reset') {
            await resetWorkshop()
        } else {
            throw new Error('action 须为 switch/add/remove/reset')
        }
        return { action, activeId: getActiveWorkshopId(), instances: getWorkshopInstances() }
    }
})

// ── AI 配置文件输出时屏蔽 apiKey（仅返回是否已设置，不暴露明文密钥）──
const maskProfile = (p: AiProfile) => ({
    id: p.id,
    label: p.label,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKeySet: !!p.apiKey,
    reasoningEffort: p.reasoningEffort
})

// ── 按键图标 ──

defineTool('get_keymap', {
    description: '读取按键图标映射（每个操作动作 → 显示的键盘/鼠标图标 key）。返回所有按键映射条目。',
    parameters: { type: 'object', properties: {} },
    handler: () => ({
        entries: getKeyMapEntries().map((e) => ({
            id: e.id,
            blockKey: e.blockKey,
            physical: e.physical,
            label: e.label
        }))
    })
})

defineTool('set_keymap_entry', {
    description:
        '修改单个按键图标映射。id 为操作动作 id（如 attack/dodge/q/e/r/f/t/space 等）；blockKey 为显示的图标 key（如 MouseLeft/MouseRight/Q/E/R/F/T/SpaceBar）；physical 为物理按键（单个小写字母 a-z 或空格 " "）。传 reset=true 可恢复全部按键图标为默认（此时忽略 id 等其它参数）。',
    parameters: {
        type: 'object',
        properties: {
            id: { type: 'string', description: '操作动作 id（见 get_keymap 返回）' },
            blockKey: { type: 'string', description: '图标 key（如 MouseLeft/Q/SpaceBar）' },
            physical: { type: 'string', description: '物理按键（单个小写字母 a-z 或空格 " "）' },
            reset: { type: 'boolean', description: 'true = 恢复默认按键图标映射' }
        },
        required: []
    },
    handler: async (args) => {
        if (args.reset === true) {
            await resetKeyMap()
            return { reset: true, count: getKeyMapEntries().length }
        }
        const id = str(args.id)
        const existing = getKeyMapEntries().find((e) => e.id === id)
        if (!existing) throw new Error(`按键映射 ${id} 不存在，可用 get_keymap 查看可用 id`)
        const patch: { id: string; blockKey: string; physical: string; label: string } = { ...existing }
        if (args.blockKey !== undefined) {
            const bk = str(args.blockKey)
            if (!bk) throw new Error('blockKey 不能为空')
            patch.blockKey = bk
        }
        if (args.physical !== undefined) {
            const ph = str(args.physical)
            if (ph !== ' ' && !/^[a-z]$/.test(ph)) throw new Error('physical 须为单个小写字母 a-z 或空格 " "')
            patch.physical = ph
        }
        await updateKeyMapEntry(patch)
        return { id, blockKey: patch.blockKey, physical: patch.physical, label: patch.label }
    }
})

// ── 界面快捷键 ──

defineTool('get_shortcuts', {
    description: '读取界面快捷键映射（排轴/拉表各操作的快捷键）。返回所有快捷键定义及其当前绑定键。',
    parameters: { type: 'object', properties: {} },
    handler: () => ({
        shortcuts: getShortcuts().map((s) => ({
            id: s.id,
            group: s.group,
            label: s.label,
            desc: s.desc,
            defaultKey: s.defaultKey,
            currentKey: getShortcutKey(s.id),
            lockedMods: s.lockedMods ?? []
        }))
    })
})

defineTool('set_shortcut', {
    description:
        '修改单个界面快捷键绑定。id 为快捷键定义 id（见 get_shortcuts 返回）；key 为新的快捷键组合（如 "ctrl+s"、"shift+enter"、"a"）。修饰键（Ctrl/Shift/Alt）用 + 连接，主键小写。若与同组其他快捷键冲突将报错。传 reset=true 可恢复全部快捷键为默认（此时忽略 id/key）。',
    parameters: {
        type: 'object',
        properties: {
            id: { type: 'string', description: '快捷键定义 id' },
            key: { type: 'string', description: '新快捷键组合（如 ctrl+s、a、shift+enter）' },
            reset: { type: 'boolean', description: 'true = 恢复默认快捷键绑定' }
        },
        required: []
    },
    handler: async (args) => {
        if (args.reset === true) {
            await resetShortcuts()
            return { reset: true, count: getShortcuts().length }
        }
        const id = str(args.id)
        const key = str(args.key)
        if (!id) throw new Error('id 不能为空')
        if (!key) throw new Error('key 不能为空')
        const def = getShortcutDef(id)
        if (!def) throw new Error(`快捷键 ${id} 不存在，可用 get_shortcuts 查看可用 id`)
        const conflict = await updateShortcut(id, key)
        if (conflict) {
            throw new Error(`快捷键「${key}」与「${conflict.label}」冲突，未保存`)
        }
        return { id, key, label: def.label }
    }
})

// ── AI 配置文件 ──

defineTool('get_ai_profiles', {
    description:
        '读取 AI 配置文件列表（每个含服务地址/模型/思考强度，apiKey 仅返回是否已设置不暴露明文）及当前激活的配置 id。',
    parameters: { type: 'object', properties: {} },
    handler: () => ({
        activeId: getActiveProfileId(),
        profiles: getAiProfiles().map(maskProfile)
    })
})

defineTool('manage_ai_profile', {
    description:
        '管理 AI 配置文件：add=新建（传 label，可选 baseUrl/model/apiKey/reasoningEffort）、switch=切换激活（传 id）、update=修改（传 id + 可选字段）、delete=删除（传 id，至少保留 1 个）。reasoningEffort 须为 low/medium/high。返回操作结果（apiKey 永远不回显明文）。',
    parameters: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['add', 'switch', 'update', 'delete'], description: '操作类型' },
            id: { type: 'string', description: '配置 id（switch/update/delete 用）' },
            label: { type: 'string', description: '配置名称（add 用，update 可选）' },
            baseUrl: { type: 'string', description: '服务地址（add/update 可选，如 https://api.deepseek.com）' },
            model: { type: 'string', description: '模型名（add/update 可选）' },
            apiKey: { type: 'string', description: 'API Key（add/update 可选；空串=清除）' },
            reasoningEffort: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                description: '思考强度（add/update 可选）'
            }
        },
        required: ['action']
    },
    handler: async (args) => {
        const action = str(args.action)
        const id = str(args.id)
        const label = str(args.label)
        const effort = str(args.reasoningEffort)
        if (action === 'add') {
            if (!label) throw new Error('add 需要传 label')
            const patch: Partial<AiProfile> = {}
            if (args.baseUrl !== undefined) patch.baseUrl = str(args.baseUrl)
            if (args.model !== undefined) patch.model = str(args.model)
            if (args.apiKey !== undefined) patch.apiKey = str(args.apiKey)
            if (effort) {
                if (effort !== 'low' && effort !== 'medium' && effort !== 'high')
                    throw new Error('reasoningEffort 须为 low/medium/high')
                patch.reasoningEffort = effort
            }
            const profile = await addProfile(label, patch)
            return { action, profile: maskProfile(profile) }
        }
        if (action === 'switch') {
            if (!id) throw new Error('switch 需要传 id')
            const ok = await setActiveProfile(id)
            if (!ok) throw new Error(`配置 ${id} 不存在，可用 get_ai_profiles 查看可用 id`)
            return { action, activeId: getActiveProfileId() }
        }
        if (action === 'update') {
            if (!id) throw new Error('update 需要传 id')
            const patch: Partial<AiProfile> = {}
            if (args.label !== undefined) patch.label = str(args.label)
            if (args.baseUrl !== undefined) patch.baseUrl = str(args.baseUrl)
            if (args.model !== undefined) patch.model = str(args.model)
            if (args.apiKey !== undefined) patch.apiKey = str(args.apiKey)
            if (effort) {
                if (effort !== 'low' && effort !== 'medium' && effort !== 'high')
                    throw new Error('reasoningEffort 须为 low/medium/high')
                patch.reasoningEffort = effort
            }
            const ok = await updateProfile(id, patch)
            if (!ok) throw new Error(`配置 ${id} 不存在`)
            return { action, updated: id }
        }
        if (action === 'delete') {
            if (!id) throw new Error('delete 需要传 id')
            const profiles = getAiProfiles()
            if (!profiles.some((p) => p.id === id)) throw new Error(`配置 ${id} 不存在`)
            if (profiles.length <= 1) throw new Error('至少保留 1 个 AI 配置文件')
            await deleteProfile(id)
            return { action, deleted: id, activeId: getActiveProfileId() }
        }
        throw new Error('action 须为 add/switch/update/delete')
    }
})

// ── 缓存 ──

defineTool('get_cache_counts', {
    description:
        '读取各类缓存条目数（列表/详情/图像）。可用 set_setting key=clear_cache 清理（值 list/info/image/all）。',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({
        list: await countCacheCategory('list'),
        info: await countCacheCategory('info'),
        image: await countCacheCategory('image')
    })
})
