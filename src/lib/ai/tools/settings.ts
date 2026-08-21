// 设置域工具：AI/WS 可修改的设置白名单——覆盖「设置」弹窗全部可配置项
// （外观主题 / 按键图标 / 交互-拉表视图+工具栏简化+界面快捷键 / 工坊 / 性能 / 连接配置-数据源 / 缓存清理 / 助手设置）。
// 仅「自定义主题创建/删除」需用户手动操作。
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
import { getKeyMapEntries, updateKeyMapEntry } from '$lib/data/keymap.svelte'
import { getShortcutDef, getShortcutKey, getShortcuts, updateShortcut } from '$lib/data/shortcuts.svelte'
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
            const n = clampNum(v, 'theme_bg_image_mask', -100, 100)
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
    magnetic_pointer: {
        label: '磁力光标',
        apply: async (v) => {
            const b = toBool(v, 'magnetic_pointer')
            setMagneticPointer(b)
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
    ai_naming_rule: {
        label: 'Buff 命名规则',
        apply: async (v) => {
            const rule = str(v)
            await updateGenPrefs({ namingRule: rule })
            return rule ? '已设置' : '已清除（恢复默认）'
        }
    },
    ai_slang_dict: {
        label: '黑话词典',
        apply: async (v) => {
            const dict = str(v)
            await updateGenPrefs({ slangDict: dict })
            return dict ? '已设置' : '已清除（恢复默认）'
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
        '读取当前设置状态——覆盖「设置」弹窗全部可配置项：外观主题、按键图标、交互、性能、工坊、连接配置（数据源）、缓存、助手设置。具体子项可用专用工具查询（get_keymap/get_shortcuts/get_ai_profiles/get_cache_counts）。',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        const overrides = getOverrides()
        const prefs = getGenPrefs()
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
            interaction: {
                calcView: getCalcViewMode(),
                simplifyToolbar: getSimplifyToolbar(),
                magneticPointer: getMagneticPointer()
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
                namingRule: prefs.namingRule ? '已自定义' : '默认',
                slangDict: prefs.slangDict ? '已自定义' : '默认',
                personaPrompt: prefs.systemPrompt ? '已自定义' : '默认',
                profileCount: getAiProfiles().length,
                activeProfileId: getActiveProfileId()
            },
            keymap: { count: getKeyMapEntries().length, hint: '用 get_keymap 查看详情，set_keymap_entry 修改' },
            shortcuts: { count: getShortcuts().length, hint: '用 get_shortcuts 查看详情，set_shortcut 修改' },
            workshop: { activeId: getActiveWorkshopId(), instances: getWorkshopInstances() },
            modifiableKeys: Object.entries(KEY_APPLYERS).map(([key, def]) => `${key}（${def.label}）`),
            hint: '可用 set_setting 修改上述 key；工坊实例操作请用 manage_workshop；AI 配置文件操作请用 manage_ai_profile。'
        }
    }
})

defineTool('set_setting', {
    description:
        '修改允许 AI 控制的设置。key 白名单：theme_mode(dark/light)、theme_accent_hue(default=青色/orange=橘红/orangeyellow=橙黄/magenta=品红/cyan=青色别名/indigo=靛蓝/green=墨绿/mono=黑白 或 0-360 整数)、theme_background_image(http(s)/data:image 地址或空串清除)、theme_bg_opacity(30-100)、theme_bg_blur(0-32)、theme_bg_dim(0-100)、theme_bg_image_blur(0-32)、theme_bg_image_mask(-100~100: 负值压暗/0原图/正值明亮)、calc_view(dropdown/spread)、simplify_toolbar、magnetic_pointer、gpu_accel、reload_on_result_refresh、reload_on_profile_change、data_provider(数据源 id 或 default=重置)、clear_cache(list/info/image/all)、ai_enabled(布尔)、ai_danger_mode(ask/ask_once/trust)、ai_naming_rule(文本或空串=恢复默认)、ai_slang_dict(文本或空串=恢复默认)、ai_persona_prompt(文本或空串=恢复默认)。按键图标/界面快捷键/AI 配置文件请用专用工具 set_keymap_entry/set_shortcut/manage_ai_profile。',
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
        '修改单个按键图标映射。id 为操作动作 id（如 attack/dodge/q/e/r/f/t/space 等）；blockKey 为显示的图标 key（如 MouseLeft/MouseRight/Q/E/R/F/T/SpaceBar）；physical 为物理按键（单个小写字母 a-z 或空格 " "）。',
    parameters: {
        type: 'object',
        properties: {
            id: { type: 'string', description: '操作动作 id（见 get_keymap 返回）' },
            blockKey: { type: 'string', description: '图标 key（如 MouseLeft/Q/SpaceBar）' },
            physical: { type: 'string', description: '物理按键（单个小写字母 a-z 或空格 " "）' }
        },
        required: ['id']
    },
    handler: async (args) => {
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
        '修改单个界面快捷键绑定。id 为快捷键定义 id（见 get_shortcuts 返回）；key 为新的快捷键组合（如 "ctrl+s"、"shift+enter"、"a"）。修饰键（Ctrl/Shift/Alt）用 + 连接，主键小写。若与同组其他快捷键冲突将报错。',
    parameters: {
        type: 'object',
        properties: {
            id: { type: 'string', description: '快捷键定义 id' },
            key: { type: 'string', description: '新快捷键组合（如 ctrl+s、a、shift+enter）' }
        },
        required: ['id', 'key']
    },
    handler: async (args) => {
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
