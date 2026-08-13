// 设置域工具：AI/WS 可修改的设置白名单（外观主题 / 交互-拉表视图+工具栏简化 / 工坊 / 性能相关），
// 其余设置（按键图标、界面快捷键、归档、缓存、助手设置等）一律拒绝并引导用户手动打开「设置」修改。
import { defineTool } from './registry'
import { getActiveId, getOverrides, setActiveTheme, updateOverride } from '$lib/theme'
import { getCalcViewMode, setCalcViewMode } from '$lib/data/calc-view.svelte'
import { getSimplifyToolbar, setSimplifyToolbar } from '$lib/data/toolbar-prefs.svelte'
import {
    getGpuAccel,
    getReloadOnProfileChange,
    getReloadOnResultRefresh,
    setGpuAccel,
    setReloadOnProfileChange,
    setReloadOnResultRefresh
} from '$lib/data/render-prefs.svelte'
import {
    addWorkshop,
    getActiveWorkshopId,
    getWorkshopInstances,
    removeWorkshop,
    resetWorkshop,
    setActiveWorkshop
} from '$lib/data/workshop.svelte'

const str = (v: unknown): string => String(v ?? '').trim()

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
                default: null,
                orange: 28,
                magenta: 330,
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
                    throw new Error('theme_accent_hue 须为 0-360 的整数，或 default/orange/magenta/green/mono')
            }
            await updateOverride('accentHue', hue)
            return hue
        }
    },
    theme_background_image: {
        label: '背景图',
        apply: async (v) => {
            const url = str(v)
            if (url && !/^(https?:\/\/|data:image\/)/i.test(url))
                throw new Error('theme_background_image 须为 http(s):// 图片地址、data:image 数据或空字符串（清除）')
            await updateOverride('backgroundImage', url)
            return url ? '已设置' : '已清除'
        }
    },
    theme_bg_opacity: {
        label: '卡片透明度',
        apply: async (v) => {
            const n = clampNum(v, 'theme_bg_opacity', 30, 100)
            await updateOverride('bgOpacity', n)
            return n
        }
    },
    theme_bg_blur: {
        label: '毛玻璃强度',
        apply: async (v) => {
            const n = clampNum(v, 'theme_bg_blur', 0, 32)
            await updateOverride('bgBlur', n)
            return n
        }
    },
    theme_bg_dim: {
        label: '背景暗度',
        apply: async (v) => {
            const n = clampNum(v, 'theme_bg_dim', 0, 100)
            await updateOverride('bgDim', n)
            return n
        }
    },
    theme_bg_image_blur: {
        label: '背景图模糊',
        apply: async (v) => {
            const n = clampNum(v, 'theme_bg_image_blur', 0, 32)
            await updateOverride('bgImageBlur', n)
            return n
        }
    },
    theme_bg_image_mask: {
        label: '背景图遮罩',
        apply: async (v) => {
            const n = clampNum(v, 'theme_bg_image_mask', 0, 100)
            await updateOverride('bgImageMask', n)
            return n
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
    }
}

/** 已知但禁止修改的 key → 设置面板位置提示 */
const DENIED_HINTS: Record<string, string> = {
    keymap: '按键图标',
    theme_add: '外观主题（自定义主题需手动创建）',
    theme_remove: '外观主题（自定义主题需手动删除）',
    shortcut: '交互相关 → 界面快捷键',
    shortcuts: '交互相关 → 界面快捷键',
    archive: '归档管理',
    cache: '缓存清理',
    ai_enabled: '助手设置',
    ai_danger_mode: '助手设置',
    ai_profile: '助手设置',
    ai_prompt: '助手设置',
    ai_slang: '助手设置'
}

defineTool('get_settings_state', {
    description:
        '读取当前允许 AI 修改的设置状态（外观主题/交互-拉表视图与工具栏/工坊实例/性能相关）。其余设置（按键图标、界面快捷键、归档、缓存、助手设置等）不允许 AI 修改，需用户手动打开「设置」面板调整。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const overrides = getOverrides()
        return {
            theme: {
                mode: getActiveId(),
                accentHue: overrides.accentHue,
                backgroundImage: overrides.backgroundImage ? '已设置' : '未设置',
                bgOpacity: overrides.bgOpacity,
                bgBlur: overrides.bgBlur,
                bgDim: overrides.bgDim,
                bgImageBlur: overrides.bgImageBlur,
                bgImageMask: overrides.bgImageMask
            },
            interaction: { calcView: getCalcViewMode(), simplifyToolbar: getSimplifyToolbar() },
            performance: {
                gpuAccel: getGpuAccel(),
                reloadOnResultRefresh: getReloadOnResultRefresh(),
                reloadOnProfileChange: getReloadOnProfileChange()
            },
            workshop: { activeId: getActiveWorkshopId(), instances: getWorkshopInstances() },
            modifiableKeys: Object.entries(KEY_APPLYERS).map(([key, def]) => `${key}（${def.label}）`),
            hint: '可用 set_setting 修改上述 key；工坊实例操作请用 manage_workshop。按键图标/界面快捷键/归档/缓存/助手设置等不允许 AI 修改，请让用户打开「设置」面板手动调整。'
        }
    }
})

defineTool('set_setting', {
    description:
        '修改允许 AI 控制的设置。key 白名单：theme_mode(dark/light)、theme_accent_hue(default/orange/magenta/green/mono 或 0-360 整数)、theme_background_image(http(s)/data:image 地址或空串清除)、theme_bg_opacity(30-100)、theme_bg_blur(0-32)、theme_bg_dim(0-100)、theme_bg_image_blur(0-32)、theme_bg_image_mask(0-100)、calc_view(dropdown/spread)、simplify_toolbar、gpu_accel、reload_on_result_refresh、reload_on_profile_change。其它设置一律拒绝。',
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
