<script lang="ts">
    import { fade } from 'svelte/transition'
    import { popOut } from '$lib/utils/motion'
    import {
        getActiveId,
        getAppearance,
        getOverrides,
        getSurfaceStyle,
        getThemes,
        setActiveTheme,
        setBgImageEffect,
        setSurfaceStyle,
        updateOverride,
        defaultSurfaceStyle,
        SURFACE_GROUPS,
        type SurfaceKey,
        type SurfaceStyle,
        type ThemeMode
    } from '$lib/theme'
    import Icon from '@iconify/svelte'
    import {
        getKeyMapEntries,
        updateKeyMapEntry,
        resetKeyMap,
        physicalLabel,
        type KeyMapEntry
    } from '$lib/data/keymap.svelte'
    import {
        getUiBtnIcons,
        clearCacheCategory,
        clearCache,
        listCacheEntries,
        deleteCacheEntry,
        getWeaponIcons,
        getEchoIcons,
        getEchoSetIcons,
        type CacheCategory,
        type CacheEntry
    } from '$lib/api/data-cache'
    import { getCharIconMap } from '$lib/calc/timeline.store.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        getWorkshopInstances,
        getActiveWorkshopId,
        setActiveWorkshop,
        addWorkshop,
        removeWorkshop,
        resetWorkshop
    } from '$lib/data/workshop.svelte'
    import {
        getProviderOptions,
        getActiveProviderId,
        setActiveProvider,
        resetActiveProvider,
        getProviderVersions,
        loadProviderVersions
    } from '$lib/data/provider-prefs.svelte'
    import {
        getArchivedProjects,
        unarchiveProject,
        deleteProject,
        buildExportFile,
        getPhaseOrder
    } from '$lib/data/project.svelte'
    import { getShareLink } from '$lib/data/share.svelte'
    import { getGenPrefs, loadGenPrefs, updateGenPrefs, type DangerMode } from '$lib/data/ai-prefs.svelte'
    import { GAMEPAD_BUTTONS } from '$lib/calc/timeline.consts'
    import { getCalcViewMode, setCalcViewMode } from '$lib/data/calc-view.svelte'
    import {
        getGpuAccel,
        setGpuAccel,
        getReloadOnResultRefresh,
        setReloadOnResultRefresh,
        getReloadOnProfileChange,
        setReloadOnProfileChange,
        getMagneticPointer,
        setMagneticPointer
    } from '$lib/data/render-prefs.svelte'
    import { getSimplifyToolbar, setSimplifyToolbar } from '$lib/data/toolbar-prefs.svelte'
    import {
        DEFAULT_LOCK_WATERMARK_TEXT,
        LOCK_WATERMARK_TEXT_MAX,
        getConfirmDeletes,
        getLockWatermark,
        getLockWatermarkText,
        getModalClosePosition,
        getSidebarActions,
        getToastPosition,
        setConfirmDeletes,
        setLockWatermark,
        setLockWatermarkText,
        setModalClosePosition,
        setSidebarActions,
        setToastPosition,
        TOAST_POSITIONS,
        type ToastPosition
    } from '$lib/data/interaction-prefs.svelte'
    import {
        getKuroActiveRole,
        getKuroBusy,
        getKuroReason,
        getKuroSession,
        getKuroValid,
        kuroLogout,
        refreshKuroSession,
        setKuroLoginOpen,
        setKuroRoleId
    } from '$lib/kuro-app/kuro.svelte'
    import { getSimplifyContextMenu, setSimplifyContextMenu } from '$lib/data/context-menu-prefs.svelte'
    import {
        SHORTCUT_GROUPS,
        applyLockedMods,
        getShortcutDef,
        getShortcutKey,
        getShortcuts,
        normalizeShortcutEvent,
        resetShortcuts,
        shortcutLabel,
        updateShortcut
    } from '$lib/data/shortcuts.svelte'
    import {
        getAiProfiles,
        getActiveProfileId,
        loadAiConfig,
        setActiveProfile,
        addProfile,
        deleteProfile,
        type AiProfile
    } from '$lib/ai/config.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import ConfirmDeleteModal from '$lib/components/layout/confirm-delete-modal.svelte'
    import AiProfileEditModal from '$lib/components/layout/ai-profile-edit-modal.svelte'
    import AiPromptEditModal from '$lib/components/layout/ai-prompt-edit-modal.svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        open: boolean
        onclose: () => void
    }

    let { open, onclose, class: className, style: styleProp }: Props = $props()

    let tab = $state<
        | 'theme'
        | 'interaction'
        | 'keymap'
        | 'shortcuts'
        | 'performance'
        | 'connection'
        | 'kuro'
        | 'cache'
        | 'archive'
        | 'ai'
        | 'ai-conn'
    >('theme')

    // ── 库街区（实验性）：登录态管理（接口走应用自身的 /api/kuro-app 服务端路由，无需配置地址）──
    let kuroSession = $derived(getKuroSession())
    let kuroValid = $derived(getKuroValid())
    let kuroReason = $derived(getKuroReason())
    let kuroBusy = $derived(getKuroBusy())
    let kuroActiveRole = $derived(getKuroActiveRole())

    const handleKuroCheck = async () => {
        await refreshKuroSession(true)
        if (getKuroValid()) addToast('库街区登录状态有效', 'success')
        else addToast(`库街区登录状态无效：${getKuroReason() ?? '未知原因'}`, 'error')
    }

    const handleKuroLogout = async () => {
        try {
            await kuroLogout()
            addToast('已退出库街区登录', 'success')
        } catch (e) {
            addToast(`退出失败：${e instanceof Error ? e.message : String(e)}`, 'error')
        }
    }

    let currentTheme = $derived(getActiveId())

    const toggleTheme = () => {
        const next = currentTheme === 'dark' ? 'light' : 'dark'
        setActiveTheme(next).then(() => {
            const t = getThemes().find((th) => th.id === next)
            addToast(`已切换至「${t?.name ?? next}」`, 'success')
        })
    }

    /** @desc 设置栏目：按「界面 / 数据 / AI助手」三组重新规划归类 */
    const SETTING_TABS = [
        { group: '界面', key: 'theme', label: '外观主题', icon: 'mdi:palette-outline' },
        { group: '界面', key: 'interaction', label: '交互相关', icon: 'mdi:gesture-tap' },
        { group: '界面', key: 'keymap', label: '按键图标', icon: 'mdi:keyboard-outline' },
        { group: '界面', key: 'shortcuts', label: '快捷键位', icon: 'mdi:keyboard-settings-outline' },
        { group: '界面', key: 'performance', label: '性能相关', icon: 'mdi:speedometer' },
        { group: '数据', key: 'connection', label: '连接配置', icon: 'mdi:link-variant' },
        { group: '数据', key: 'kuro', label: '库街区', icon: 'mdi:account-key-outline' },
        { group: '数据', key: 'cache', label: '缓存清理', icon: 'mdi:database-outline' },
        { group: '数据', key: 'archive', label: '归档管理', icon: 'mdi:archive-outline' },
        { group: 'AI助手', key: 'ai-conn', label: '启用 / 接入配置', icon: 'mdi:connection' },
        { group: 'AI助手', key: 'ai', label: '权限 / 提示词', icon: 'mdi:shield-account-outline' }
    ] as const

    /** @desc 按 group 聚合栏目（保持声明顺序） */
    const SETTING_GROUPS = SETTING_TABS.reduce<{ group: string; items: (typeof SETTING_TABS)[number][] }[]>(
        (acc, t) => {
            const last = acc[acc.length - 1]
            if (last && last.group === t.group) last.items.push(t)
            else acc.push({ group: t.group, items: [t] })
            return acc
        },
        []
    )

    /** @desc Toast 位置按钮文案与说明（顺序取自 TOAST_POSITIONS） */
    const TOAST_POSITION_LABELS: Record<ToastPosition, string> = {
        'top-right': '右上角（默认）',
        none: '不弹出',
        'top-left': '左上角',
        'top-center': '正上方',
        'bottom-center': '正下方',
        'bottom-left': '左下角',
        'bottom-right': '右下角'
    }

    const TOAST_POSITION_HINTS: Record<ToastPosition, string> = {
        'top-right': '默认位置：屏幕右上角向下堆叠',
        none: '不显示任何操作反馈提示',
        'top-left': '屏幕左上角向下堆叠',
        'top-center': '屏幕正上方居中',
        'bottom-center': '屏幕正下方居中',
        'bottom-left': '屏幕左下角向上堆叠',
        'bottom-right': '屏幕右下角向上堆叠'
    }

    const COLOR_PRESETS = [
        { name: '默认', hue: 190 as number | 'mono' | null },
        { name: '靛蓝', hue: null as number | 'mono' | null },
        { name: '品红', hue: 345 as number | 'mono' | null },
        { name: '橘红', hue: 28 as number | 'mono' | null },
        { name: '橙黄', hue: 90 as number | 'mono' | null },
        { name: '墨绿', hue: 150 as number | 'mono' | null },
        { name: '黑白', hue: 'mono' as const }
    ]

    let fileInput: HTMLInputElement | undefined = $state()
    let bgUrl = $state('')
    /** @desc 背景图分白天/黑夜两张：当前正在编辑哪一张（打开设置时默认跟随当前主题） */
    let bgEditingLight = $state(false)

    let overrides = $derived(getOverrides())
    let isDark = $derived(getActiveId() !== 'light')
    let aiProfiles = $derived(getAiProfiles())
    let aiActiveId = $derived(getActiveProfileId())
    let aiEditTarget = $state<AiProfile | null>(null)
    let aiDeleteConfirm = $state<AiProfile | null>(null)
    let promptEditKind = $state<'naming' | 'persona' | 'slang' | null>(null)

    async function toggleAiEnabled() {
        await updateGenPrefs({ enabled: !getGenPrefs().enabled })
        addToast(getGenPrefs().enabled ? 'AI 助手已启用' : 'AI 助手已禁用', 'success')
    }

    const DANGER_MODE_OPTIONS: { value: DangerMode; label: string; desc: string }[] = [
        { value: 'ask', label: '每次都询问', desc: '每个危险操作都弹确认' },
        { value: 'ask_once', label: '批量只询问一次', desc: '一次指令内只确认一次，后续直接放行' },
        { value: 'trust', label: '无条件信任', desc: '危险操作直接执行，不再确认' }
    ]

    async function setDangerMode(mode: DangerMode) {
        await updateGenPrefs({ dangerMode: mode })
        addToast(
            mode === 'ask'
                ? '已设为：危险操作每次都询问'
                : mode === 'ask_once'
                  ? '已设为：批量只询问一次'
                  : '已设为：无条件信任（请谨慎使用）',
            'success'
        )
    }

    function switchCalcViewMode(mode: 'dropdown' | 'spread') {
        setCalcViewMode(mode)
        addToast(mode === 'spread' ? '已切换为 buff 平铺模式' : '已切换为 buff 下拉模式', 'success')
    }

    async function handleSelectAiProfile(id: string) {
        const ok = await setActiveProfile(id)
        if (ok) {
            const label = getAiProfiles().find((p) => p.id === id)?.label ?? ''
            addToast(`已切换到「${label}」`, 'success')
        }
    }

    async function handleAddAiProfile() {
        const profile = await addProfile('新配置')
        aiEditTarget = profile
        addToast('已新建配置文件，请填写 API Key 后保存', 'success')
    }

    function handleDeleteAiProfile(profile: AiProfile) {
        aiDeleteConfirm = profile
        if (!getConfirmDeletes()) void doDeleteAiProfile()
    }

    async function doDeleteAiProfile() {
        if (!aiDeleteConfirm) return
        await deleteProfile(aiDeleteConfirm.id)
        aiDeleteConfirm = null
        addToast('配置文件已删除', 'info')
    }

    $effect(() => {
        if (open) {
            bgEditingLight = currentTheme === 'light'
            bgUrl = editingBg.startsWith('http') ? editingBg : ''
            void refreshCacheEntries()
            loadAiConfig()
            loadGenPrefs()
        }
    })

    /** @desc 正在编辑的那张背景图（黑夜=backgroundImage / 白天=backgroundImageLight） */
    let editingBgKey = $derived(bgEditingLight ? ('backgroundImageLight' as const) : ('backgroundImage' as const))
    let editingBg = $derived(overrides[editingBgKey])
    /** @desc 当前主题实际生效的背景图 */
    let activeThemeBg = $derived(currentTheme === 'light' ? overrides.backgroundImageLight : overrides.backgroundImage)

    // ── 背景图效果 / 背景质感（按昼夜分别保存，编辑的是当前生效的那一套）──
    const modeKey = $derived<ThemeMode>(currentTheme === 'light' ? 'light' : 'dark')
    const appearance = $derived(getAppearance(modeKey))
    let surfaceKey = $state<SurfaceKey>('card')
    const surfaceStyle = $derived(getSurfaceStyle(surfaceKey, modeKey))

    const updateSurface = (patch: Partial<SurfaceStyle>) => void setSurfaceStyle(surfaceKey, patch, modeKey)
    const resetSurface = () => void setSurfaceStyle(surfaceKey, defaultSurfaceStyle(surfaceKey, modeKey), modeKey)
    const updateBgEffect = (patch: { bgImageBlur?: number; bgImageMask?: number }) =>
        void setBgImageEffect(patch, modeKey)

    /** @desc 背景图遮罩预览色（与 :root 上 --theme-bg-mask 同口径） */
    const maskPreview = (v: number) =>
        v < 0
            ? `rgba(0,0,0,${(Math.abs(v) / 100) * 0.6})`
            : v > 0
              ? `rgba(255,255,255,${Math.min(0.8, (v / 100) * 0.35)})`
              : 'transparent'

    function getPresetStyle(hue: number | 'mono' | null): { bg: string; text: string } {
        if (hue === 'mono') {
            return isDark ? { bg: '#ffffff', text: '#000000' } : { bg: '#000000', text: '#ffffff' }
        } else if (typeof hue === 'number') {
            const l = isDark ? 55 : 42
            const c = isDark ? 0.15 : 0.18
            return { bg: `oklch(${l}% ${c} ${hue})`, text: '#ffffff' }
        }
        return { bg: '#6366f1', text: '#ffffff' }
    }

    function compressImage(file: File): Promise<string> {
        // 大图转 data URL 塞进 CSS 变量会静默失败（~9MB 就不生效），统一压缩后再存储
        const MAX_EDGE = 2560
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
                const dataUrl = reader.result as string
                const img = new Image()
                img.onload = () => {
                    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
                    if (scale >= 1 && dataUrl.length < 1_500_000) {
                        resolve(dataUrl)
                        return
                    }
                    const canvas = document.createElement('canvas')
                    canvas.width = Math.round(img.naturalWidth * scale)
                    canvas.height = Math.round(img.naturalHeight * scale)
                    const ctx = canvas.getContext('2d')
                    if (!ctx) {
                        resolve(dataUrl)
                        return
                    }
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
                    let out = canvas.toDataURL('image/webp', 0.85)
                    if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', 0.85)
                    if (out.length >= dataUrl.length) out = dataUrl
                    resolve(out)
                }
                img.onerror = () => reject(new Error('图片解码失败'))
                img.src = dataUrl
            }
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(file)
        })
    }

    function handleFileSelect(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        const key = editingBgKey
        compressImage(file)
            .then((dataUrl) => {
                updateOverride(key, dataUrl)
                bgUrl = ''
            })
            .catch((err) => {
                console.error('[bg] 压缩失败，改用原图', err)
                const reader = new FileReader()
                reader.onload = () => {
                    updateOverride(key, reader.result as string)
                    bgUrl = ''
                }
                reader.readAsDataURL(file)
            })
    }

    function handleUrlApply() {
        const url = bgUrl.trim()
        if (url) {
            updateOverride(editingBgKey, url)
        }
    }

    function clearBackground() {
        updateOverride(editingBgKey, '')
        if (fileInput) fileInput.value = ''
        bgUrl = ''
    }

    function handleUrlKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter') handleUrlApply()
    }

    // ── Key mapping ──
    let keymapEntries = $derived(getKeyMapEntries())
    let uiBtnIconList = $state<[string, string][]>([])
    let keyPickerFor = $state<string | null>(null)

    // ── 界面快捷键 ──
    let shortcutCapture = $state<string | null>(null)

    $effect(() => {
        if (shortcutCapture === null) return
        const onKey = (e: KeyboardEvent) => {
            e.preventDefault()
            e.stopPropagation()
            if (e.key === 'Escape') {
                shortcutCapture = null
                return
            }
            const key = normalizeShortcutEvent(e)
            if (!key) return
            const id = shortcutCapture
            if (id === null) return
            const def = getShortcutDef(id)
            if (!def) return
            // 锁定修饰键（如 Shift 固定）：按到被锁定的纯修饰键时继续等待主键
            if (def.lockedMods?.length && key.split('+').length === 1 && def.lockedMods.includes(key)) return
            const final = applyLockedMods(def, key)
            void updateShortcut(id, final).then((conflict) => {
                if (conflict) {
                    addToast(`「${def?.label}」与「${conflict.label}」冲突，未保存`, 'error')
                } else {
                    addToast(`「${def?.label}」已设为 ${shortcutLabel(final)}`, 'success')
                }
                shortcutCapture = null
            })
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    })

    $effect(() => {
        if (open && uiBtnIconList.length === 0) {
            getUiBtnIcons().then((map) => {
                uiBtnIconList = Object.entries(map)
            })
        }
    })

    function iconOf(blockKey: string): string | undefined {
        return uiBtnIconList.find(([n]) => n === blockKey)?.[1]
    }

    function gamepadIconOf(blockKey: string): string | undefined {
        return GAMEPAD_BUTTONS.find((b) => b.id === blockKey)?.icon ?? undefined
    }

    function entryById(id: string): KeyMapEntry | undefined {
        return keymapEntries.find((e) => e.id === id)
    }

    function updateEntry(id: string, patch: Partial<KeyMapEntry>) {
        const e = entryById(id)
        if (e) updateKeyMapEntry({ ...e, ...patch })
    }

    // ── Workshop settings ──
    let workshopInstances = $derived(getWorkshopInstances())
    let workshopActiveId = $derived(getActiveWorkshopId())
    let newWorkshopUrl = $state('')

    async function handleAddWorkshop() {
        const ok = await addWorkshop(newWorkshopUrl)
        if (ok) {
            addToast('已添加工坊实例', 'success')
            newWorkshopUrl = ''
        } else {
            addToast('地址无效或已存在', 'error')
        }
    }

    async function handleSwitchWorkshop(id: string) {
        await setActiveWorkshop(id)
        addToast('已切换工坊实例', 'success')
    }

    async function handleRemoveWorkshop(id: string) {
        await removeWorkshop(id)
        addToast('已删除工坊实例', 'info')
    }

    async function handleResetWorkshop() {
        await resetWorkshop()
        addToast('已恢复默认工坊实例', 'success')
    }

    // ── 上游数据源（连接配置） ──
    let providerOptions = $derived(getProviderOptions())
    let activeProviderId = $derived(getActiveProviderId())
    let providerVersions = $derived(getProviderVersions())

    // 进入“连接配置”页时加载各上游最新版本
    let loadedVersionTab = false
    $effect(() => {
        if (tab === 'connection' && !loadedVersionTab) {
            loadedVersionTab = true
            void loadProviderVersions()
        }
    })

    function handleSwitchProvider(id: string) {
        if (!setActiveProvider(id)) {
            addToast('未知的数据源', 'error')
            return
        }
        addToast('已切换数据源，列表/详情缓存将按新源重新加载', 'info')
        // 数据可能随上游不同，清空本地缓存以便重新拉取
        import('$lib/api/data-cache').then((m) => m.clearCache())
    }

    function handleResetProvider() {
        resetActiveProvider()
        addToast('已恢复默认数据源（nanoka）', 'success')
        import('$lib/api/data-cache').then((m) => m.clearCache())
    }

    // ── Archive management ──
    let archivedProjects = $derived(getArchivedProjects())

    // ── 归档卡片工程信息（角色/武器/声骸/套装 图标）──
    const charIconMap = $derived(getCharIconMap())
    let weaponIcons = $state<Record<string, string>>({})
    let echoIcons = $state<Record<string, string>>({})
    let setIcons = $state<Record<string, string>>({})
    let archiveIconsLoaded = false
    $effect(() => {
        if (archiveIconsLoaded) return
        archiveIconsLoaded = true
        void Promise.all([getWeaponIcons(), getEchoIcons(), getEchoSetIcons()]).then(([w, e, s]) => {
            weaponIcons = w
            echoIcons = e
            setIcons = s
        })
    })
    let confirmDelete = $state<{ id: string; name: string } | null>(null)

    async function handleUnarchive(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        await unarchiveProject(id)
        addToast(`工程「${p.name}」已取消归档`, 'success')
    }

    function openArchiveDelete(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        confirmDelete = { id, name: p.name }
        if (!getConfirmDeletes()) void doArchiveDelete()
    }

    function closeArchiveDelete() {
        confirmDelete = null
    }

    async function doArchiveDelete() {
        if (!confirmDelete) return
        await deleteProject(confirmDelete.id)
        addToast(`工程「${confirmDelete.name}」已永久删除`, 'info')
        closeArchiveDelete()
    }

    function handleArchiveExport(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        const file = buildExportFile(p, getPhaseOrder(), true)
        const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${p.name}.json`
        a.click()
        URL.revokeObjectURL(url)
        addToast(`工程「${p.name}」已导出`, 'success')
    }

    async function handleArchiveShare(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        addToast('正在生成分享链接...', 'info')
        const link = await getShareLink(p)
        if (!link) {
            addToast('分享失败', 'error')
            return
        }
        try {
            await navigator.clipboard.writeText(link)
            addToast('已分享(10分钟)，链接已复制到剪贴板', 'success')
        } catch {
            addToast('已分享(10分钟)，请在地址栏查看导入链接', 'success')
        }
    }

    async function handleArchiveDelete(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        await deleteProject(id)
        addToast(`工程「${p.name}」已永久删除`, 'info')
    }

    function formatArchiveDate(ts: number): string {
        return new Date(ts).toLocaleString()
    }

    // ── Cache management ──
    let cacheEntries = $state<CacheEntry[]>([])
    let cacheBusy = $state(false)
    /** 展开查看条目明细的分类（同一时刻只展开一个，避免面板过长） */
    let expandedCache = $state<CacheCategory | null>(null)

    async function refreshCacheEntries() {
        cacheEntries = await listCacheEntries()
    }

    const CACHE_LABELS: { key: CacheCategory; label: string; icon: string; desc: string }[] = [
        { key: 'list', label: '列表缓存', icon: 'mdi:file-document-outline', desc: '角色 / 武器 / 声骸 / 套装 名录' },
        { key: 'info', label: '详情缓存', icon: 'mdi:information-outline', desc: '技能、数值等词条详情' },
        { key: 'image', label: '图像缓存', icon: 'mdi:image-outline', desc: '图标批量表 + 浏览器图像桶' }
    ]

    /** @desc 实体标识 → 中文名（缓存条目明细用） */
    const CACHE_ENTITY_LABELS: Record<string, string> = {
        character: '角色',
        weapon: '武器',
        echo: '声骸',
        'echo-set': '声骸套装',
        'character-v2': '角色详情'
    }

    const entityLabel = (entity: string): string => CACHE_ENTITY_LABELS[entity] ?? entity

    /** @desc 某分类下的条目（含全部上游来源） */
    const entriesOf = (kind: CacheCategory): CacheEntry[] => cacheEntries.filter((e) => e.category === kind)

    const cacheCount = $derived(cacheEntries.length)

    /** @desc 统一包一层：执行清理 → 刷新计数 → 提示 */
    const runCacheClear = async (action: () => Promise<void>, message: string) => {
        cacheBusy = true
        try {
            await action()
            await refreshCacheEntries()
            addToast(message, 'success')
        } finally {
            cacheBusy = false
        }
    }

    const handleClearCache = (kind: CacheCategory) =>
        runCacheClear(() => clearCacheCategory(kind), `已清理${CACHE_LABELS.find((c) => c.key === kind)?.label ?? ''}`)

    const handleClearCacheAll = () =>
        runCacheClear(async () => {
            await Promise.all(CACHE_LABELS.map((c) => clearCacheCategory(c.key)))
            // 兜底：清掉命名空间内可能残留的历史/未知键
            clearCache()
        }, '已清空全部接口缓存')

    const handleClearCacheEntry = (entry: CacheEntry) => {
        const what = entry.name ?? entityLabel(entry.entity)
        return runCacheClear(() => deleteCacheEntry(entry.key), `已清理「${what}」缓存`)
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm {className}"
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5)); {styleProp || ''}"
        onkeydown={(e) => {
            if (e.key === 'Escape') onclose()
        }}
        out:fade={{ duration: 130 }}
    >
        <div
            data-sf="modal"
            class="animate-pop-in theme-glass-surface relative flex h-[min(90vh,940px)] w-[min(96vw,1240px)] flex-col overflow-hidden rounded-none shadow-2xl"
            style="color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
            role="dialog"
            aria-modal="true"
            out:popOut
        >
            <div
                class="flex shrink-0 items-center justify-between border-b px-6 py-4"
                style="border-color: var(--theme-divider-border);"
            >
                <div class="flex items-center gap-2.5">
                    <Icon icon="mdi:cog-outline" class="size-4.5" style="color: var(--theme-accent-text);" />
                    <h3 class="font-black tracking-tight">设置</h3>
                </div>
                <button
                    onclick={onclose}
                    class="rounded-none p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70 {getModalClosePosition() ===
                    'top-left'
                        ? 'order-first'
                        : ''}"
                    aria-label="关闭设置"
                >
                    <Icon icon="mdi:close" class="size-4.5" />
                </button>
            </div>

            <div class="flex min-h-0 flex-1 flex-row">
                <!-- Sidebar -->
                <div
                    class="theme-scrollbar flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r p-3"
                    style="border-color: var(--theme-divider-border);"
                >
                    {#each SETTING_GROUPS as g (g.group)}
                        <div class="flex flex-col gap-0.5">
                            <span class="px-3 pb-1 text-[10px] font-black tracking-[0.3em] text-(--theme-muted-text)"
                                >{g.group}</span
                            >
                            {#each g.items as t (t.key)}
                                <button
                                    onclick={() => (tab = t.key)}
                                    class="flex shrink-0 items-center gap-2.5 border-l-2 px-3 py-2 text-sm font-black tracking-tight transition-colors {tab ===
                                    t.key
                                        ? 'text-(--theme-accent-text)'
                                        : 'text-(--theme-modal-text)/55 hover:text-(--theme-modal-text)'}"
                                    style={tab === t.key
                                        ? 'border-color: var(--theme-accent-bg); background: color-mix(in srgb, var(--theme-accent-bg) 8%, transparent);'
                                        : 'border-color: transparent;'}
                                >
                                    <Icon icon={t.icon} class="size-4 shrink-0" />
                                    {t.label}
                                </button>
                            {/each}
                        </div>
                    {/each}
                </div>

                <!-- Content -->
                <div
                    class="min-h-0 min-w-0 flex-1 overflow-y-auto p-6 scrollbar-none [&::-webkit-scrollbar]:hidden [&>div+div]:border-t [&>div+div]:border-(--theme-divider-border) [&>div+div]:pt-4"
                >
                    {#if tab === 'theme'}
                        <div class="flex flex-col">
                            <!-- Accent color -->
                            <div class="mb-5">
                                <span
                                    class="mb-3 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                                >
                                    <Icon
                                        icon="mdi:palette-outline"
                                        class="size-4 shrink-0"
                                        style="color: var(--theme-accent-text);"
                                    />
                                    主色调
                                </span>
                                <div
                                    class="flex gap-1 rounded-none border p-1"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    {#each COLOR_PRESETS.slice(0, -1) as c}
                                        {@const style = getPresetStyle(c.hue)}
                                        <button
                                            onclick={() => updateOverride('accentHue', c.hue)}
                                            class="flex-1 rounded-none px-1 py-1.5 text-[11px] font-medium transition-colors"
                                            style="background: {overrides.accentHue === c.hue
                                                ? style.bg
                                                : 'transparent'}; color: {overrides.accentHue === c.hue
                                                ? style.text
                                                : 'var(--theme-modal-text)/60'};"
                                        >
                                            {c.name}
                                        </button>
                                    {/each}
                                    <div
                                        class="mx-1.5 my-1 w-px shrink-0"
                                        style="background: var(--theme-divider-border);"
                                    ></div>
                                    {#each COLOR_PRESETS.slice(-1) as c}
                                        {@const style = getPresetStyle(c.hue)}
                                        <button
                                            onclick={() => updateOverride('accentHue', c.hue)}
                                            class="flex-1 rounded-none px-1 py-1.5 text-[11px] font-medium transition-colors"
                                            style="background: {overrides.accentHue === c.hue
                                                ? style.bg
                                                : 'transparent'}; color: {overrides.accentHue === c.hue
                                                ? style.text
                                                : 'var(--theme-modal-text)/60'};"
                                        >
                                            {c.name}
                                        </button>
                                    {/each}
                                </div>
                            </div>

                            <!-- 昼夜切换 -->
                            <div class="mb-5">
                                <span
                                    class="mb-3 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                                >
                                    <Icon
                                        icon="mdi:theme-light-dark"
                                        class="size-4 shrink-0"
                                        style="color: var(--theme-accent-text);"
                                    />
                                    昼夜切换
                                </span>
                                <div
                                    class="flex items-center justify-between gap-3 rounded-none border px-2.5 py-2"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div class="min-w-0">
                                        <span class="block text-[11px] text-(--theme-modal-text)/60">深色主题</span>
                                        <span class="block text-[9px] text-(--theme-modal-text)/35"
                                            >与侧边栏按钮一致，全局明暗切换</span
                                        >
                                    </div>
                                    <button
                                        onclick={toggleTheme}
                                        class="relative h-4.5 w-8 shrink-0 rounded-full transition-colors"
                                        style="background: {currentTheme === 'dark'
                                            ? 'var(--theme-accent-bg)'
                                            : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                        title="点击切换昼夜"
                                    >
                                        <span
                                            class="absolute top-0.5 size-3.5 rounded-full transition-all"
                                            style="left: {currentTheme === 'dark'
                                                ? '16px'
                                                : '2px'}; background: var(--theme-modal-bg);"
                                        ></span>
                                    </button>
                                </div>
                            </div>

                            <hr class="mb-5" style="border-color: var(--theme-divider-border);" />

                            <!-- Background image -->
                            <div>
                                <div class="mb-3 flex items-center gap-2">
                                    <span
                                        class="flex size-7 items-center justify-center rounded-none bg-(--theme-accent-bg)/10 text-(--theme-accent-text)"
                                    >
                                        <Icon icon="mdi:image-outline" class="size-4" />
                                    </span>
                                    <div>
                                        <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                            >背景图</span
                                        >
                                        <span class="block text-[10px] text-(--theme-modal-text)/35"
                                            >白天与黑夜可各设一张；模糊/遮罩/暗度为两者共用</span
                                        >
                                    </div>
                                </div>

                                <!-- 白天 / 黑夜 切换：切换正在编辑的那张背景图 -->
                                <div
                                    class="mb-3 flex gap-1 rounded-none border p-1"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    {#each [{ light: false, label: '黑夜' }, { light: true, label: '白天' }] as mode (mode.label)}
                                        {@const active = bgEditingLight === mode.light}
                                        {@const isCurrent = (currentTheme === 'light') === mode.light}
                                        <button
                                            onclick={() => {
                                                bgEditingLight = mode.light
                                                if (fileInput) fileInput.value = ''
                                                const next = mode.light
                                                    ? overrides.backgroundImageLight
                                                    : overrides.backgroundImage
                                                bgUrl = next.startsWith('http') ? next : ''
                                            }}
                                            class="flex-1 rounded-none px-1 py-1.5 text-[11px] font-medium transition-colors {active
                                                ? ''
                                                : 'text-(--theme-modal-text)/60 hover:text-(--theme-modal-text)'}"
                                            style={active
                                                ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);'
                                                : ''}
                                        >
                                            {mode.label}{#if isCurrent}<span class="ml-1 opacity-60">当前</span>{/if}
                                        </button>
                                    {/each}
                                </div>

                                {#if editingBg}
                                    <div
                                        class="mb-3 overflow-hidden rounded-none border"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        <img src={editingBg} alt="背景预览" class="h-28 w-full object-cover" />
                                        <div
                                            class="flex items-center justify-end gap-2 px-3 py-2 bg-(--theme-modal-text)/5"
                                        >
                                            <button
                                                onclick={() => fileInput?.click()}
                                                class="flex items-center gap-1 text-xs text-(--theme-accent-text) transition-colors hover:brightness-125"
                                            >
                                                <Icon icon="mdi:reload" class="size-3.5" />
                                                换图
                                            </button>
                                            <button
                                                onclick={clearBackground}
                                                class="flex items-center gap-1 text-xs text-(--theme-modal-text)/50 transition-colors hover:text-red-500"
                                            >
                                                <Icon icon="mdi:delete-outline" class="size-3.5" />
                                                清除
                                            </button>
                                        </div>
                                    </div>
                                {:else}
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <div
                                        onclick={() => fileInput?.click()}
                                        class="mb-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-none border-2 border-dashed px-4 py-8 transition-colors hover:bg-(--theme-modal-text)/5"
                                        style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                                    >
                                        <Icon icon="mdi:image-outline" class="size-8 text-(--theme-modal-text)/20" />
                                        <span class="text-xs text-(--theme-modal-text)/40">点击选择本地图片</span>
                                    </div>
                                {/if}

                                <input
                                    type="file"
                                    accept="image/*"
                                    bind:this={fileInput}
                                    onchange={handleFileSelect}
                                    class="hidden"
                                />

                                <div
                                    class="flex items-center gap-2 rounded-none border px-3 py-2"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <input
                                        type="text"
                                        bind:value={bgUrl}
                                        onkeydown={handleUrlKeydown}
                                        placeholder="远程图片 URL"
                                        class="flex-1 min-w-0 text-xs outline-none bg-transparent text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30"
                                    />
                                    <button
                                        onclick={handleUrlApply}
                                        disabled={!bgUrl.trim()}
                                        class="shrink-0 rounded-none px-2.5 py-1 text-xs font-medium transition-all hover:brightness-125 disabled:opacity-40"
                                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                                    >
                                        加载
                                    </button>
                                </div>

                                <div
                                    class="mt-4 overflow-hidden rounded-none border"
                                    style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-input-bg) 70%, transparent);"
                                >
                                    <div
                                        class="relative h-40 overflow-hidden border-b"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        {#if editingBg}
                                            <!-- 背景图独立层（自身模糊，不影响上层的预览卡片） -->
                                            <div
                                                class="absolute inset-0"
                                                style="background-image: url('{editingBg}'); background-position: center; background-size: cover; filter: blur({appearance.bgImageBlur}px);"
                                            ></div>
                                            <!-- 背景图遮罩层（与工作区一致，由当前昼夜的背景图遮罩控制） -->
                                            <div
                                                class="absolute inset-0"
                                                style="background: {maskPreview(appearance.bgImageMask)};"
                                            ></div>
                                        {:else}
                                            <!-- 无背景图时的中性预览底：玻璃卡片效果仍可实时预览 -->
                                            <div
                                                class="absolute inset-0"
                                                style="background: linear-gradient(135deg, color-mix(in srgb, var(--theme-input-bg) 92%, var(--theme-accent-bg)), color-mix(in srgb, var(--theme-input-bg) 35%, var(--theme-modal-text)));"
                                            ></div>
                                        {/if}
                                        <div
                                            data-sf="modal"
                                            class="absolute inset-y-4 left-4 flex w-40 flex-col justify-between overflow-hidden rounded-none border p-3 shadow-2xl"
                                            style="border-color: color-mix(in srgb, var(--theme-modal-text) 18%, transparent);"
                                        >
                                            <div
                                                class="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-white/45 to-transparent"
                                            ></div>
                                            <div class="flex items-center gap-2">
                                                <span
                                                    class="flex size-6 items-center justify-center rounded-none bg-(--theme-accent-bg)/20 text-(--theme-accent-text)"
                                                >
                                                    <Icon icon="mdi:blur" class="size-3.5" />
                                                </span>
                                                <span class="text-[11px] font-medium">玻璃质感预览</span>
                                            </div>
                                            <div class="space-y-1.5">
                                                <div class="h-1.5 w-full rounded-full bg-(--theme-modal-text)/15"></div>
                                                <div class="h-1.5 w-2/3 rounded-full bg-(--theme-modal-text)/10"></div>
                                            </div>
                                        </div>
                                        <span
                                            class="absolute bottom-3 right-3 rounded-none bg-black/30 px-2 py-1 font-mono text-[9px] tracking-wide text-white/70 backdrop-blur-sm"
                                            >LIVE</span
                                        >
                                    </div>

                                    <div class="p-4">
                                        <div class="mb-4 flex items-start gap-2.5">
                                            <span
                                                class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-none bg-(--theme-modal-text)/5 text-(--theme-modal-text)/45"
                                            >
                                                <Icon icon="mdi:layers-triple-outline" class="size-4" />
                                            </span>
                                            <div>
                                                <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                    >背景质感</span
                                                >
                                                <span class="block text-[10px] leading-4 text-(--theme-modal-text)/35"
                                                    >预览与工作区同步更新</span
                                                >
                                            </div>
                                        </div>

                                        <p class="mb-3 text-[10px] leading-4 text-(--theme-modal-text)/35">
                                            按昼夜分别保存；当前编辑「{modeKey === 'light' ? '白天' : '黑夜'}
                                            」主题。五类区域可各自设置不透明度 / 毛玻璃强度 / 背景深度
                                        </p>

                                        <!-- 区域选择 -->
                                        <div class="mb-2 flex flex-wrap gap-1.5">
                                            {#each SURFACE_GROUPS[0].items as item (item.key)}
                                                <button
                                                    onclick={() => (surfaceKey = item.key)}
                                                    class="rounded-none border px-2.5 py-1 text-[11px] transition-colors {surfaceKey ===
                                                    item.key
                                                        ? 'font-black text-(--theme-accent-text)'
                                                        : 'text-(--theme-modal-text)/55 hover:text-(--theme-modal-text)'}"
                                                    style="border-color: {surfaceKey === item.key
                                                        ? 'var(--theme-accent-bg)'
                                                        : 'var(--theme-divider-border)'};{surfaceKey === item.key
                                                        ? 'background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent);'
                                                        : ''}"
                                                    title={item.hint}
                                                >
                                                    {item.label}
                                                </button>
                                            {/each}
                                        </div>
                                        <p class="mb-3 text-[10px] leading-4 text-(--theme-modal-text)/35">
                                            {SURFACE_GROUPS[0].items.find((i) => i.key === surfaceKey)?.hint}
                                        </p>

                                        <div class="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-x-6">
                                            <div>
                                                <span
                                                    class="mb-2 flex items-center justify-between text-[11px] text-(--theme-modal-text)/55"
                                                >
                                                    <span>不透明度</span>
                                                    <span class="font-mono text-(--theme-accent-text)"
                                                        >{surfaceStyle.opacity}%</span
                                                    >
                                                </span>
                                                <input
                                                    aria-label="不透明度"
                                                    type="range"
                                                    min="0"
                                                    max="100"
                                                    step="1"
                                                    value={surfaceStyle.opacity}
                                                    oninput={(e) =>
                                                        updateSurface({
                                                            opacity: Number((e.target as HTMLInputElement).value)
                                                        })}
                                                    class="h-1.5 w-full cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)"
                                                />
                                                <div
                                                    class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25"
                                                >
                                                    <span>全透</span><span>不透明</span>
                                                </div>
                                            </div>

                                            <div>
                                                <span
                                                    class="mb-2 flex items-center justify-between text-[11px] text-(--theme-modal-text)/55"
                                                >
                                                    <span class="flex items-center gap-1.5"
                                                        ><Icon icon="mdi:blur" class="size-3.5" />毛玻璃强度</span
                                                    >
                                                    <span class="font-mono text-(--theme-accent-text)"
                                                        >{surfaceStyle.blur}px</span
                                                    >
                                                </span>
                                                <input
                                                    aria-label="毛玻璃强度"
                                                    type="range"
                                                    min="0"
                                                    max="32"
                                                    step="1"
                                                    value={surfaceStyle.blur}
                                                    oninput={(e) =>
                                                        updateSurface({
                                                            blur: Number((e.target as HTMLInputElement).value)
                                                        })}
                                                    class="h-1.5 w-full cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)"
                                                />
                                                <div
                                                    class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25"
                                                >
                                                    <span>无</span><span>朦胧</span>
                                                </div>
                                            </div>

                                            <div>
                                                <span
                                                    class="mb-2 flex items-center justify-between text-[11px] text-(--theme-modal-text)/55"
                                                >
                                                    <span class="flex items-center gap-1.5"
                                                        ><Icon icon="mdi:brightness-4" class="size-3.5" />背景深度</span
                                                    >
                                                    <span class="font-mono text-(--theme-accent-text)"
                                                        >{surfaceStyle.depth}%</span
                                                    >
                                                </span>
                                                <input
                                                    aria-label="背景深度"
                                                    type="range"
                                                    min="0"
                                                    max="100"
                                                    step="1"
                                                    value={surfaceStyle.depth}
                                                    oninput={(e) =>
                                                        updateSurface({
                                                            depth: Number((e.target as HTMLInputElement).value)
                                                        })}
                                                    class="h-1.5 w-full cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)"
                                                />
                                                <div
                                                    class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25"
                                                >
                                                    <span>原色</span><span>{modeKey === 'light' ? '更白' : '更黑'}</span
                                                    >
                                                </div>
                                            </div>
                                        </div>

                                        <div class="mt-3 flex flex-wrap items-center gap-2">
                                            <button
                                                onclick={resetSurface}
                                                class="inline-flex items-center gap-1 rounded-none border px-2 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                <Icon icon="mdi:restore" class="size-3" />
                                                重置「{SURFACE_GROUPS[0].items.find((i) => i.key === surfaceKey)
                                                    ?.label}」
                                            </button>
                                            <span class="text-[10px] leading-4 text-(--theme-modal-text)/35">
                                                背景深度越大越接近{modeKey === 'light' ? '白' : '黑'}
                                                ；同时作用于毛玻璃背面明暗
                                            </span>
                                        </div>

                                        {#if activeThemeBg}
                                            <div
                                                class="border-t pt-4"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                <div class="mb-3 flex items-start gap-2.5">
                                                    <span
                                                        class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-none bg-(--theme-modal-text)/5 text-(--theme-modal-text)/45"
                                                    >
                                                        <Icon icon="mdi:image-outline" class="size-4" />
                                                    </span>
                                                    <div>
                                                        <span
                                                            class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                            >背景图效果</span
                                                        >
                                                        <span
                                                            class="block text-[10px] leading-4 text-(--theme-modal-text)/35"
                                                            >按昼夜分别保存，仅作用于背景图本身，与区域质感互不影响</span
                                                        >
                                                    </div>
                                                </div>
                                                <div class="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-x-6">
                                                    <div>
                                                        <span
                                                            class="mb-2 flex items-center justify-between text-[11px] text-(--theme-modal-text)/55"
                                                        >
                                                            <span class="flex items-center gap-1.5"
                                                                ><Icon
                                                                    icon="mdi:blur"
                                                                    class="size-3.5"
                                                                />背景图模糊</span
                                                            >
                                                            <span class="font-mono text-(--theme-accent-text)"
                                                                >{appearance.bgImageBlur}px</span
                                                            >
                                                        </span>
                                                        <input
                                                            aria-label="背景图模糊"
                                                            type="range"
                                                            min="0"
                                                            max="32"
                                                            step="1"
                                                            value={appearance.bgImageBlur}
                                                            oninput={(e) =>
                                                                updateBgEffect({
                                                                    bgImageBlur: Number(
                                                                        (e.target as HTMLInputElement).value
                                                                    )
                                                                })}
                                                            class="h-1.5 w-full cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)"
                                                        />
                                                        <div
                                                            class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25"
                                                        >
                                                            <span>清晰</span><span>朦胧</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <span
                                                            class="mb-2 flex items-center justify-between text-[11px] text-(--theme-modal-text)/55"
                                                        >
                                                            <span class="flex items-center gap-1.5"
                                                                ><Icon
                                                                    icon="mdi:brightness-4"
                                                                    class="size-3.5"
                                                                />背景图遮罩</span
                                                            >
                                                            <span class="font-mono text-(--theme-accent-text)"
                                                                >{appearance.bgImageMask === 0
                                                                    ? '原图'
                                                                    : appearance.bgImageMask > 100
                                                                      ? `更白 ${appearance.bgImageMask - 100}%`
                                                                      : appearance.bgImageMask > 0
                                                                        ? `偏白 ${appearance.bgImageMask}%`
                                                                        : `压暗 ${Math.abs(
                                                                              appearance.bgImageMask
                                                                          )}%`}</span
                                                            >
                                                        </span>
                                                        <input
                                                            aria-label="背景图遮罩"
                                                            type="range"
                                                            min="-100"
                                                            max="200"
                                                            step="1"
                                                            value={appearance.bgImageMask}
                                                            oninput={(e) =>
                                                                updateBgEffect({
                                                                    bgImageMask: Number(
                                                                        (e.target as HTMLInputElement).value
                                                                    )
                                                                })}
                                                            class="h-1.5 w-full cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)"
                                                        />
                                                        <div
                                                            class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25"
                                                        >
                                                            <span>压暗</span><span>原图</span><span>偏白</span><span
                                                                >更白</span
                                                            >
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        {/if}
                                    </div>
                                </div>

                                <div class="mt-4">
                                    <div class="mb-3 flex items-center gap-2">
                                        <span
                                            class="flex size-7 items-center justify-center rounded-none bg-(--theme-accent-bg)/10 text-(--theme-accent-text)"
                                        >
                                            <Icon icon="mdi:monitor" class="size-4" />
                                        </span>
                                        <div>
                                            <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                >标题栏颜色</span
                                            >
                                            <span class="block text-[10px] text-(--theme-modal-text)/35"
                                                >跟随主题自动适配（昼夜 / 黑白特例），同步 PWA theme-color</span
                                            >
                                        </div>
                                    </div>
                                    <div
                                        class="flex items-center gap-2 rounded-none border p-1.5 px-2.5"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <span
                                            class="size-5 shrink-0 rounded-none border"
                                            style="background: var(--theme-titlebar-bg); border-color: var(--theme-divider-border);"
                                        ></span>
                                        <span class="text-[11px] font-medium text-(--theme-modal-text)/60"
                                            >跟随当前主题（{getActiveId() === 'light' ? '浅色' : '深色'}）</span
                                        >
                                    </div>
                                </div>

                                <div class="mt-4">
                                    <div class="mb-3 flex items-center gap-2">
                                        <span
                                            class="flex size-7 items-center justify-center rounded-none bg-(--theme-accent-bg)/10 text-(--theme-accent-text)"
                                        >
                                            <Icon icon="mdi:star" class="size-4" />
                                        </span>
                                        <div>
                                            <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                >霓虹灯字体</span
                                            >
                                            <span class="block text-[10px] text-(--theme-modal-text)/35"
                                                >所有文本与图标以当前颜色发光</span
                                            >
                                        </div>
                                    </div>
                                    <div
                                        class="rounded-none border p-3"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <div>
                                            <span
                                                class="mb-2 flex items-center justify-between text-[11px] text-(--theme-modal-text)/55"
                                            >
                                                <span>发光强度</span>
                                                <span class="font-mono text-(--theme-accent-text)"
                                                    >{overrides.neonText}%</span
                                                >
                                            </span>
                                            <input
                                                aria-label="霓虹灯强度"
                                                type="range"
                                                min="0"
                                                max="100"
                                                step="1"
                                                value={overrides.neonText}
                                                oninput={(e) =>
                                                    updateOverride(
                                                        'neonText',
                                                        Number((e.target as HTMLInputElement).value)
                                                    )}
                                                class="h-1.5 w-full cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)"
                                            />
                                            <div
                                                class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25"
                                            >
                                                <span>关</span><span>强烈</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    {:else if tab === 'keymap'}
                        <!-- Key mapping -->
                        <div>
                            <span
                                class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                            >
                                <Icon
                                    icon="mdi:keyboard-outline"
                                    class="size-4 shrink-0"
                                    style="color: var(--theme-accent-text);"
                                />
                                按键图标
                            </span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                每行决定排轴时操作块显示的按键图标（键盘或手柄）；快速排轴输入键与界面快捷键可在「交互相关」中配置
                            </p>
                            <div class="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-4">
                                {#each keymapEntries as entry}
                                    <div
                                        class="flex items-center gap-2 rounded-none border px-2.5 py-2"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <span class="flex size-9 shrink-0 items-center justify-center">
                                            {#if iconOf(entry.blockKey)}
                                                <img
                                                    src={iconOf(entry.blockKey)}
                                                    alt={entry.blockKey}
                                                    draggable="false"
                                                    class="size-8 object-contain"
                                                />
                                            {:else}
                                                {@const gIcon = gamepadIconOf(entry.blockKey)}
                                                {#if gIcon}
                                                    <img
                                                        src={gIcon}
                                                        alt={entry.blockKey}
                                                        draggable="false"
                                                        class="size-7 object-contain"
                                                    />
                                                {:else}
                                                    <span class="text-[10px] font-bold text-(--theme-modal-text)/60"
                                                        >{entry.blockKey}</span
                                                    >
                                                {/if}
                                            {/if}
                                        </span>
                                        <input
                                            value={entry.label}
                                            onchange={(e) =>
                                                updateEntry(entry.id, { label: (e.target as HTMLInputElement).value })}
                                            class="min-w-0 flex-1 bg-transparent text-xs text-(--theme-modal-text) outline-none placeholder:text-(--theme-modal-text)/30"
                                        />
                                        <span
                                            class="shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] text-(--theme-modal-text)/60"
                                            style="border-color: var(--theme-divider-border);"
                                            title="快捷键"
                                        >
                                            {physicalLabel(entry.physical)}
                                        </span>
                                        <button
                                            onclick={() => (keyPickerFor = entry.id)}
                                            class="shrink-0 rounded-none px-2 py-0.5 text-[10px] font-medium transition-all hover:brightness-125"
                                            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                                        >
                                            选择自定义key
                                        </button>
                                    </div>
                                {/each}
                            </div>
                            <div class="mt-3 flex items-center gap-2">
                                <button
                                    onclick={() => (tab = 'shortcuts')}
                                    class="flex items-center gap-1 rounded-none border px-2.5 py-1 text-xs text-(--theme-accent-text) transition-colors hover:brightness-125"
                                    style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent);"
                                    title="跳转到「快捷键位」页配置界面快捷键"
                                >
                                    <Icon icon="mdi:keyboard-settings-outline" class="size-3.5" />
                                    界面快捷键设置
                                    <Icon icon="mdi:arrow-right" class="size-3" />
                                </button>
                                <button
                                    onclick={() => resetKeyMap()}
                                    class="flex items-center gap-1 rounded-none border px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:restore" class="size-3.5" />
                                    恢复默认
                                </button>
                            </div>
                        </div>
                    {:else if tab === 'interaction'}
                        <div class="flex flex-col">
                            <span
                                class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                            >
                                <Icon
                                    icon="mdi:table-large"
                                    class="size-4 shrink-0"
                                    style="color: var(--theme-accent-text);"
                                />
                                拉表视图
                            </span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                选择拉表页面的 Buff 编辑方式；后续拉表/排轴等快捷键设置也将集中在此区域
                            </p>
                            <div
                                class="flex gap-1 rounded-none border p-1"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                role="tablist"
                            >
                                <button
                                    role="tab"
                                    aria-selected={getCalcViewMode() === 'dropdown'}
                                    onclick={() => switchCalcViewMode('dropdown')}
                                    class="flex-1 rounded-none px-1 py-1.5 text-xs font-medium transition-colors"
                                    style={getCalcViewMode() === 'dropdown'
                                        ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                        : 'color: var(--theme-modal-text)/60;'}
                                >
                                    buff 下拉模式
                                </button>
                                <button
                                    role="tab"
                                    aria-selected={getCalcViewMode() === 'spread'}
                                    onclick={() => switchCalcViewMode('spread')}
                                    class="flex-1 rounded-none px-1 py-1.5 text-xs font-medium transition-colors"
                                    style={getCalcViewMode() === 'spread'
                                        ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                        : 'color: var(--theme-modal-text)/60;'}
                                >
                                    buff 平铺模式
                                </button>
                            </div>

                            <div class="mt-5">
                                <span
                                    class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                                >
                                    <Icon
                                        icon="mdi:widgets-outline"
                                        class="size-4 shrink-0"
                                        style="color: var(--theme-accent-text);"
                                    />
                                    界面显示
                                </span>
                                <div
                                    class="flex items-center justify-between gap-3 rounded-none border px-3 py-2"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div class="min-w-0">
                                        <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                            >简化底部工具栏</span
                                        >
                                        <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                            开启后底部工具栏变为可拖动的圆角胶囊（仅图标按钮），拖动时可吸附到侧栏右侧或屏幕右缘
                                        </span>
                                    </div>
                                    <button
                                        onclick={() => setSimplifyToolbar(!getSimplifyToolbar())}
                                        class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                        style="background: {getSimplifyToolbar()
                                            ? 'var(--theme-accent-bg)'
                                            : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                        title="点击切换"
                                    >
                                        <span
                                            class="absolute top-0.5 size-4 rounded-full transition-all"
                                            style="left: {getSimplifyToolbar()
                                                ? '18px'
                                                : '2px'}; background: var(--theme-modal-bg);"
                                        ></span>
                                    </button>
                                </div>
                                <div
                                    class="mt-2 flex items-center justify-between gap-3 rounded-none border px-3 py-2"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div class="min-w-0">
                                        <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                            >侧边栏显示新建 / 导入按钮</span
                                        >
                                        <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                            在侧边栏底部显示「新建工程 / 从本地导入 /
                                            从工坊下载」操作区；默认开启（关闭后仍可从欢迎页使用）
                                        </span>
                                    </div>
                                    <button
                                        onclick={() => setSidebarActions(!getSidebarActions())}
                                        class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                        style="background: {getSidebarActions()
                                            ? 'var(--theme-accent-bg)'
                                            : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                        title="点击切换"
                                    >
                                        <span
                                            class="absolute top-0.5 size-4 rounded-full transition-all"
                                            style="left: {getSidebarActions()
                                                ? '18px'
                                                : '2px'}; background: var(--theme-modal-bg);"
                                        ></span>
                                    </button>
                                </div>
                                <div
                                    class="mt-2 flex items-center justify-between gap-3 rounded-none border px-3 py-2"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <span class="min-w-0 text-xs font-medium text-(--theme-modal-text)/70"
                                        >弹窗关闭按钮位置</span
                                    >
                                    <div class="flex shrink-0 gap-1">
                                        {#each [{ v: 'top-left' as const, l: '左上角' }, { v: 'top-right' as const, l: '右上角' }] as opt (opt.v)}
                                            <button
                                                onclick={() => setModalClosePosition(opt.v)}
                                                class="rounded-none border px-2.5 py-1 text-[10px] transition-colors {getModalClosePosition() ===
                                                opt.v
                                                    ? 'font-black text-(--theme-accent-text)'
                                                    : 'text-(--theme-modal-text)/55 hover:text-(--theme-modal-text)'}"
                                                style="border-color: {getModalClosePosition() === opt.v
                                                    ? 'var(--theme-accent-bg)'
                                                    : 'var(--theme-divider-border)'};{getModalClosePosition() === opt.v
                                                    ? 'background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent);'
                                                    : ''}"
                                            >
                                                {opt.l}
                                            </button>
                                        {/each}
                                    </div>
                                </div>
                            </div>

                            <div class="mt-5">
                                <span
                                    class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                                >
                                    <Icon
                                        icon="mdi:gesture-tap"
                                        class="size-4 shrink-0"
                                        style="color: var(--theme-accent-text);"
                                    />
                                    交互效果
                                </span>
                                <div
                                    class="flex items-center justify-between gap-3 rounded-none border px-3 py-2"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div class="min-w-0">
                                        <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                            >磁力光标</span
                                        >
                                        <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                            开启后鼠标移至按钮/链接等可点击元素上时，光标变形框住元素并带磁力吸附
                                        </span>
                                    </div>
                                    <button
                                        onclick={() => setMagneticPointer(!getMagneticPointer())}
                                        class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                        style="background: {getMagneticPointer()
                                            ? 'var(--theme-accent-bg)'
                                            : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                        title="点击切换"
                                    >
                                        <span
                                            class="absolute top-0.5 size-4 rounded-full transition-all"
                                            style="left: {getMagneticPointer()
                                                ? '18px'
                                                : '2px'}; background: var(--theme-modal-bg);"
                                        ></span>
                                    </button>
                                </div>
                            </div>

                            <div class="mt-5">
                                <span
                                    class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                                >
                                    <Icon
                                        icon="mdi:trash-can-outline"
                                        class="size-4 shrink-0"
                                        style="color: var(--theme-accent-text);"
                                    />
                                    删除行为
                                </span>
                                <div
                                    class="flex items-center justify-between gap-3 rounded-none border px-3 py-2"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div class="min-w-0">
                                        <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                            >删除前二次确认</span
                                        >
                                        <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                            关闭后删除工程、Buff、排轴等对象时跳过二次确认弹窗，直接删除；默认开启
                                        </span>
                                    </div>
                                    <button
                                        onclick={() => setConfirmDeletes(!getConfirmDeletes())}
                                        class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                        style="background: {getConfirmDeletes()
                                            ? 'var(--theme-accent-bg)'
                                            : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                        title="点击切换"
                                    >
                                        <span
                                            class="absolute top-0.5 size-4 rounded-full transition-all"
                                            style="left: {getConfirmDeletes()
                                                ? '18px'
                                                : '2px'}; background: var(--theme-modal-bg);"
                                        ></span>
                                    </button>
                                </div>
                            </div>

                            <div class="mt-5">
                                <span
                                    class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                                >
                                    <Icon
                                        icon="mdi:cursor-default-click-outline"
                                        class="size-4 shrink-0"
                                        style="color: var(--theme-accent-text);"
                                    />
                                    右键菜单
                                </span>
                                <div
                                    class="flex items-center justify-between gap-3 rounded-none border px-3 py-2"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div class="min-w-0">
                                        <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                            >简化右键菜单</span
                                        >
                                        <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                            开启后排轴页的操作块/参考线右键菜单仅保留重命名、伤害绑定与删除；多选菜单不受影响。默认开启
                                        </span>
                                    </div>
                                    <button
                                        onclick={() => setSimplifyContextMenu(!getSimplifyContextMenu())}
                                        class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                        style="background: {getSimplifyContextMenu()
                                            ? 'var(--theme-accent-bg)'
                                            : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                        title="点击切换"
                                    >
                                        <span
                                            class="absolute top-0.5 size-4 rounded-full transition-all"
                                            style="left: {getSimplifyContextMenu()
                                                ? '18px'
                                                : '2px'}; background: var(--theme-modal-bg);"
                                        ></span>
                                    </button>
                                </div>
                            </div>

                            <div class="mt-5">
                                <span
                                    class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                                >
                                    <Icon
                                        icon="mdi:bell-outline"
                                        class="size-4 shrink-0"
                                        style="color: var(--theme-accent-text);"
                                    />
                                    消息提示位置
                                </span>
                                <div
                                    class="flex gap-1 rounded-none border p-1"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    {#each TOAST_POSITIONS as p (p)}
                                        {@const active = getToastPosition() === p}
                                        <button
                                            onclick={() => setToastPosition(p)}
                                            class="flex-1 rounded-none px-1 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors {active
                                                ? ''
                                                : 'text-(--theme-modal-text)/60 hover:text-(--theme-modal-text)'}"
                                            style={active
                                                ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);'
                                                : ''}
                                            title={TOAST_POSITION_HINTS[p as ToastPosition]}
                                        >
                                            {TOAST_POSITION_LABELS[p as ToastPosition]}
                                        </button>
                                    {/each}
                                </div>
                                <span class="mt-1.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                    操作反馈（Toast）的弹出位置，默认右上角；选「不弹出」后所有操作反馈都不再显示
                                </span>
                            </div>

                            <div class="mt-5">
                                <span
                                    class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                                >
                                    <Icon
                                        icon="mdi:watermark"
                                        class="size-4 shrink-0"
                                        style="color: var(--theme-accent-text);"
                                    />
                                    锁定水印
                                </span>
                                <div
                                    class="flex items-center justify-between gap-3 rounded-none border px-3 py-2"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div class="min-w-0">
                                        <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                            >显示锁定水印</span
                                        >
                                        <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                            排轴页阶段锁定时，在画面上平铺显示自定义文字；默认开启
                                        </span>
                                    </div>
                                    <button
                                        onclick={() => setLockWatermark(!getLockWatermark())}
                                        class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                        style="background: {getLockWatermark()
                                            ? 'var(--theme-accent-bg)'
                                            : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                        title="点击切换"
                                    >
                                        <span
                                            class="absolute top-0.5 size-4 rounded-full transition-all"
                                            style="left: {getLockWatermark()
                                                ? '18px'
                                                : '2px'}; background: var(--theme-modal-bg);"
                                        ></span>
                                    </button>
                                </div>
                                <div class="mt-2 flex items-center gap-2">
                                    <input
                                        value={getLockWatermarkText()}
                                        oninput={(e) => setLockWatermarkText(e.currentTarget.value)}
                                        maxlength={LOCK_WATERMARK_TEXT_MAX}
                                        placeholder={DEFAULT_LOCK_WATERMARK_TEXT}
                                        class="min-w-0 flex-1 rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none transition-colors placeholder:text-(--theme-modal-text)/35 focus:border-(--theme-accent-bg)/50"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                        title="锁定水印文本"
                                    />
                                    <span class="shrink-0 text-[10px] tracking-[0.18em] text-(--theme-modal-text)/40">
                                        {getLockWatermarkText().length}/{LOCK_WATERMARK_TEXT_MAX}
                                    </span>
                                </div>
                                <span class="mt-1.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                    留空则使用「{DEFAULT_LOCK_WATERMARK_TEXT}」
                                </span>
                            </div>
                        </div>
                    {:else if tab === 'shortcuts'}
                        <div class="flex flex-col">
                            <div class="mt-5">
                                <span
                                    class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                                >
                                    <Icon
                                        icon="mdi:keyboard-settings-outline"
                                        class="size-4 shrink-0"
                                        style="color: var(--theme-accent-text);"
                                    />
                                    界面快捷键
                                </span>
                                <p class="mb-3 text-[10px] leading-4 text-(--theme-modal-text)/40">
                                    点击「记录」后按下新键即时绑定（ESC 取消）；同组冲突会被拒绝。弹窗关闭与 Ctrl+A/Z/Y
                                    等固定不可改
                                </p>
                                {#each SHORTCUT_GROUPS as g}
                                    <div class="mt-3">
                                        <span class="text-[11px] font-medium text-(--theme-modal-text)/45"
                                            >{g.label}</span
                                        >
                                        <div class="mt-1 grid grid-cols-1 gap-1.5 xl:grid-cols-2 xl:gap-x-4">
                                            {#each getShortcuts().filter((s) => s.group === g.key) as s}
                                                <div
                                                    class="flex items-center gap-2 rounded-none border px-2.5 py-1.5"
                                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                                >
                                                    <div class="min-w-0 flex-1">
                                                        <span class="block text-xs text-(--theme-modal-text)"
                                                            >{s.label}</span
                                                        >
                                                        <span
                                                            class="block truncate text-[10px] leading-4 text-(--theme-modal-text)/35"
                                                            title={s.desc}>{s.desc}</span
                                                        >
                                                    </div>
                                                    <span
                                                        class="shrink-0 rounded-none border px-1.5 py-0.5 font-mono text-[10px] text-(--theme-modal-text)/70"
                                                        style="border-color: var(--theme-divider-border);"
                                                        >{shortcutLabel(getShortcutKey(s.id))}</span
                                                    >
                                                    <button
                                                        onclick={() =>
                                                            (shortcutCapture = shortcutCapture === s.id ? null : s.id)}
                                                        class="shrink-0 rounded-none px-2 py-0.5 text-[10px] font-medium transition-all"
                                                        style={shortcutCapture === s.id
                                                            ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                                            : 'background: var(--theme-modal-text)/8; color: var(--theme-modal-text)/70;'}
                                                        >{shortcutCapture === s.id
                                                            ? s.lockedMods?.length
                                                                ? `按下新键…（${s.lockedMods
                                                                      .map(shortcutLabel)
                                                                      .join('+')} 固定）`
                                                                : '按下新键…'
                                                            : '记录'}</button
                                                    >
                                                </div>
                                            {/each}
                                        </div>
                                    </div>
                                {/each}
                                <div class="mt-3 flex items-center gap-2">
                                    <button
                                        onclick={() => resetShortcuts()}
                                        class="flex items-center gap-1 rounded-none border px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        <Icon icon="mdi:restore" class="size-3.5" />
                                        恢复默认
                                    </button>
                                </div>
                            </div>
                        </div>
                    {:else if tab === 'performance'}
                        <!-- 性能相关 -->
                        <div>
                            <span
                                class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                            >
                                <Icon
                                    icon="mdi:speedometer"
                                    class="size-4 shrink-0"
                                    style="color: var(--theme-accent-text);"
                                />
                                性能设置
                            </span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                控制交互渲染方式与刷新结果时的数据加载行为
                            </p>
                            <!-- 渲染加速（GPU）：拖拽/动画走合成层 -->
                            <div
                                class="flex items-center justify-between gap-3 rounded-none border px-3 py-2"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <div class="min-w-0">
                                    <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                        >渲染加速（GPU）</span
                                    >
                                    <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                        开启后排轴拖拽/框选/悬浮窗使用 GPU 合成（transform
                                        定位），帧率更高；关闭回退传统布局定位
                                    </span>
                                </div>
                                <button
                                    onclick={() => setGpuAccel(!getGpuAccel())}
                                    class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                    style="background: {getGpuAccel()
                                        ? 'var(--theme-accent-bg)'
                                        : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                    title="点击切换"
                                >
                                    <span
                                        class="absolute top-0.5 size-4 rounded-full transition-all"
                                        style="left: {getGpuAccel()
                                            ? '18px'
                                            : '2px'}; background: var(--theme-modal-bg);"
                                    ></span>
                                </button>
                            </div>
                            <!-- 刷新结果重载数据：开启后刷新结果时重新加载本工程全部阶段数据 -->
                            <div
                                class="mt-2 flex items-center justify-between gap-3 rounded-none border px-3 py-2"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <div class="min-w-0">
                                    <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                        >刷新结果重载数据</span
                                    >
                                    <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                        开启后点击「刷新结果」会重新加载本工程全部阶段数据及角色/声骸信息（更准确，耗时更长）；关闭仅重算结果（更快）
                                    </span>
                                </div>
                                <button
                                    onclick={() => setReloadOnResultRefresh(!getReloadOnResultRefresh())}
                                    class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                    style="background: {getReloadOnResultRefresh()
                                        ? 'var(--theme-accent-bg)'
                                        : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                    title="点击切换"
                                >
                                    <span
                                        class="absolute top-0.5 size-4 rounded-full transition-all"
                                        style="left: {getReloadOnResultRefresh()
                                            ? '18px'
                                            : '2px'}; background: var(--theme-modal-bg);"
                                    ></span>
                                </button>
                            </div>
                            <!-- 链/阶变动重载数据：开启后调整共鸣链/精炼档位时自动重载本工程全部阶段数据 -->
                            <div
                                class="mt-2 flex items-center justify-between gap-3 rounded-none border px-3 py-2"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <div class="min-w-0">
                                    <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                        >链/阶变动重载数据</span
                                    >
                                    <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                        开启后调整角色共鸣链/武器精炼档位时，自动重载本工程全部阶段数据并重新锁定（更准确，耗时更长）；关闭仅更新档位配置
                                    </span>
                                </div>
                                <button
                                    onclick={() => setReloadOnProfileChange(!getReloadOnProfileChange())}
                                    class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                    style="background: {getReloadOnProfileChange()
                                        ? 'var(--theme-accent-bg)'
                                        : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                    title="点击切换"
                                >
                                    <span
                                        class="absolute top-0.5 size-4 rounded-full transition-all"
                                        style="left: {getReloadOnProfileChange()
                                            ? '18px'
                                            : '2px'}; background: var(--theme-modal-bg);"
                                    ></span>
                                </button>
                            </div>
                        </div>
                    {:else if tab === 'connection'}
                        <!-- Connection settings: 上游数据源 + 工坊/分享源 -->
                        <div class="flex flex-col">
                            <span
                                class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                            >
                                <Icon
                                    icon="mdi:cloud-download-outline"
                                    class="size-4 shrink-0"
                                    style="color: var(--theme-accent-text);"
                                />
                                上游数据源
                            </span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                选择角色/武器/声骸等数据的来源；切换后列表与详情缓存会按新源重新加载
                            </p>
                            <div class="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-4">
                                {#each providerOptions as opt}
                                    <div
                                        class={[
                                            'flex min-w-0 cursor-pointer items-center gap-2 rounded-none border px-2.5 py-2 transition-colors',
                                            opt.id === activeProviderId
                                                ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10'
                                                : 'border-(--theme-divider-border) bg-(--theme-input-bg) hover:bg-(--theme-modal-text)/5'
                                        ].join(' ')}
                                        onclick={() => handleSwitchProvider(opt.id)}
                                        title="点击切换该数据源"
                                    >
                                        <Icon
                                            icon={opt.id === activeProviderId
                                                ? 'mdi:radiobox-marked'
                                                : 'mdi:radiobox-blank'}
                                            class="size-4 shrink-0 text-(--theme-accent-text)"
                                        />
                                        <span class="min-w-0 flex-1 truncate text-xs text-(--theme-modal-text)"
                                            >{opt.label}</span
                                        >
                                        <span
                                            class="shrink-0 rounded-none bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] text-(--theme-accent-text)"
                                            title="最新数据版本"
                                        >
                                            {providerVersions[opt.id] || opt.id}
                                        </span>
                                    </div>
                                {/each}
                            </div>
                            <div class="mt-3 mb-2">
                                <button
                                    onclick={handleResetProvider}
                                    class="flex items-center gap-1 rounded-none border px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:restore" class="size-3.5" />
                                    恢复默认
                                </button>
                            </div>

                            <div
                                class="my-4 border-t xl:hidden"
                                style="border-color: var(--theme-divider-border);"
                            ></div>

                            <span
                                class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                            >
                                <Icon
                                    icon="mdi:storefront-outline"
                                    class="size-4 shrink-0"
                                    style="color: var(--theme-accent-text);"
                                />
                                工坊 / 分享源
                            </span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                配置椰果工坊实例；单选使用，可删除或新增，分享与工坊列表将使用当前选中实例
                            </p>
                            <div class="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-4">
                                {#each workshopInstances as inst}
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <div
                                        class={[
                                            'flex min-w-0 cursor-pointer items-center gap-2 rounded-none border px-2.5 py-2 transition-colors',
                                            inst.id === workshopActiveId
                                                ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10'
                                                : 'border-(--theme-divider-border) bg-(--theme-input-bg) hover:bg-(--theme-modal-text)/5'
                                        ].join(' ')}
                                        onclick={() => handleSwitchWorkshop(inst.id)}
                                        title="点击选中该实例"
                                    >
                                        <Icon
                                            icon={inst.id === workshopActiveId
                                                ? 'mdi:radiobox-marked'
                                                : 'mdi:radiobox-blank'}
                                            class="size-4 shrink-0 text-(--theme-accent-text)"
                                        />
                                        <span class="min-w-0 flex-1 truncate text-xs text-(--theme-modal-text)"
                                            >{inst.url}</span
                                        >
                                        {#if workshopInstances.length > 1}
                                            <button
                                                onclick={(e) => {
                                                    e.stopPropagation()
                                                    handleRemoveWorkshop(inst.id)
                                                }}
                                                class="shrink-0 rounded-none p-1 text-(--theme-modal-text)/40 transition-colors hover:text-red-500"
                                                title="删除"
                                            >
                                                <Icon icon="mdi:close" class="size-3.5" />
                                            </button>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                            <div class="mt-3 flex gap-2">
                                <input
                                    bind:value={newWorkshopUrl}
                                    onkeydown={(e) => e.key === 'Enter' && handleAddWorkshop()}
                                    placeholder="https://example.com 工坊地址"
                                    class="min-w-0 flex-1 rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none placeholder:text-(--theme-modal-text)/30"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                />
                                <button
                                    onclick={handleAddWorkshop}
                                    class="flex shrink-0 items-center gap-1 rounded-none px-2.5 py-1.5 text-xs font-medium transition-all hover:brightness-125"
                                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                                >
                                    <Icon icon="mdi:plus" class="size-3.5" />
                                    添加
                                </button>
                            </div>
                            <div class="mt-3">
                                <button
                                    onclick={handleResetWorkshop}
                                    class="flex items-center gap-1 rounded-none border px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:restore" class="size-3.5" />
                                    恢复默认
                                </button>
                            </div>
                        </div>
                    {:else if tab === 'archive'}
                        <!-- Archive management -->
                        <div>
                            <span
                                class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                            >
                                <Icon
                                    icon="mdi:archive-outline"
                                    class="size-4 shrink-0"
                                    style="color: var(--theme-accent-text);"
                                />
                                归档管理
                            </span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                已归档的工程不会出现在侧边栏，可取消归档恢复、全量导出、分享或永久删除
                            </p>
                            {#if archivedProjects.length === 0}
                                <div
                                    class="flex flex-col items-center justify-center gap-2 rounded-none border-2 border-dashed px-4 py-10"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:archive-outline" class="size-8 text-(--theme-modal-text)/20" />
                                    <span class="text-xs text-(--theme-modal-text)/40">暂无归档的工程</span>
                                </div>
                            {:else}
                                <div class="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
                                    {#each archivedProjects as p (p.id)}
                                        {@const avatars = p.team.map((s) =>
                                            s.character ? charIconMap[s.character] : undefined
                                        )}
                                        <div
                                            class="group relative overflow-hidden border-2 p-4 transition-colors hover:border-(--theme-accent-bg) hover:bg-(--theme-card-bg-focused)"
                                            style="border-color: var(--theme-card-border); background: var(--theme-card-bg);"
                                        >
                                            <!-- 角色头像叠底（右下：1号大→3号小，向右递减；半透明 + 边缘淡出） -->
                                            {#if avatars[2]}
                                                <div
                                                    class="pointer-events-none absolute -bottom-3 right-36 z-0 size-16 opacity-40"
                                                    style="-webkit-mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); -webkit-mask-composite: source-in; mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); mask-composite: intersect;"
                                                >
                                                    <img src={avatars[2]} alt="" class="size-full object-cover" />
                                                </div>
                                            {/if}
                                            {#if avatars[1]}
                                                <div
                                                    class="pointer-events-none absolute -bottom-3 right-[4.5rem] z-0 size-24 opacity-40"
                                                    style="-webkit-mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); -webkit-mask-composite: source-in; mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); mask-composite: intersect;"
                                                >
                                                    <img src={avatars[1]} alt="" class="size-full object-cover" />
                                                </div>
                                            {/if}
                                            {#if avatars[0]}
                                                <div
                                                    class="pointer-events-none absolute -bottom-3 right-0 z-0 size-32 opacity-40"
                                                    style="-webkit-mask-image: linear-gradient(to bottom, transparent, #000 40%); mask-image: linear-gradient(to bottom, transparent, #000 40%);"
                                                >
                                                    <img src={avatars[0]} alt="" class="size-full object-cover" />
                                                </div>
                                            {/if}

                                            <div class="relative z-10 flex items-baseline gap-2">
                                                <h4
                                                    class="min-w-0 flex-1 truncate text-base font-black leading-tight tracking-tight text-(--theme-modal-text) [text-shadow:0_0_3px_var(--theme-halo-color)]"
                                                >
                                                    {p.name}
                                                </h4>
                                                <span
                                                    class="shrink-0 text-[10px] tracking-[0.22em] text-(--theme-muted-text)"
                                                    >{formatArchiveDate(p.createdAt)}</span
                                                >
                                            </div>

                                            <!-- 工程信息：三角色配装（武器 / 首位声骸 / 套装 图标）-->
                                            <div
                                                class="relative z-10 mt-3 flex flex-col gap-1.5 border-t pt-3"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                {#each p.team as slot}
                                                    {#if slot.character}
                                                        <div
                                                            class="flex flex-wrap items-center gap-1.5 text-[10px]"
                                                            title={slot.character}
                                                        >
                                                            {#if slot.weapon}
                                                                <span
                                                                    class="inline-flex items-center gap-1 border px-1.5 py-0.5 text-(--theme-modal-text)/65"
                                                                    style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-text) 5%, transparent);"
                                                                >
                                                                    {#if weaponIcons[slot.weapon]}
                                                                        <img
                                                                            src={weaponIcons[slot.weapon]}
                                                                            alt=""
                                                                            class="size-3.5 object-contain"
                                                                        />
                                                                    {/if}
                                                                    {slot.weapon}
                                                                </span>
                                                            {/if}
                                                            {#if slot.echoes?.[0]?.name}
                                                                <span
                                                                    class="inline-flex items-center gap-1 border px-1.5 py-0.5 text-(--theme-modal-text)/65"
                                                                    style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-text) 5%, transparent);"
                                                                    title="首位声骸"
                                                                >
                                                                    {#if echoIcons[slot.echoes[0].name]}
                                                                        <img
                                                                            src={echoIcons[slot.echoes[0].name]}
                                                                            alt=""
                                                                            class="size-3.5 rounded-full object-cover"
                                                                        />
                                                                    {/if}
                                                                    {slot.echoes[0].name}
                                                                </span>
                                                            {/if}
                                                            {#each slot.triggerSets as ts}
                                                                <span
                                                                    class="inline-flex items-center gap-1 border px-1.5 py-0.5 text-(--theme-modal-text)/65"
                                                                    style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-text) 5%, transparent);"
                                                                >
                                                                    {#if setIcons[ts.name]}
                                                                        <img
                                                                            src={setIcons[ts.name]}
                                                                            alt=""
                                                                            class="size-3.5 rounded-full object-cover"
                                                                        />
                                                                    {/if}
                                                                    {ts.pieces}件
                                                                </span>
                                                            {/each}
                                                        </div>
                                                    {/if}
                                                {/each}
                                            </div>

                                            <div
                                                class="relative z-10 mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2.5"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                <button
                                                    onclick={() => handleUnarchive(p.id)}
                                                    class="flex items-center gap-1 rounded-none px-2 py-0.5 text-[10px] transition-colors text-(--theme-accent-text) hover:brightness-125"
                                                    style="background: color-mix(in srgb, var(--theme-accent-bg) 14%, transparent);"
                                                >
                                                    <Icon icon="mdi:archive-arrow-up-outline" class="size-3" />
                                                    取消归档
                                                </button>
                                                <button
                                                    onclick={() => handleArchiveExport(p.id)}
                                                    class="flex items-center gap-1 rounded-none border px-2 py-0.5 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                                    style="border-color: var(--theme-divider-border);"
                                                >
                                                    <Icon icon="mdi:file-export" class="size-3" />
                                                    导出
                                                </button>
                                                <button
                                                    onclick={() => handleArchiveShare(p.id)}
                                                    class="flex items-center gap-1 rounded-none border px-2 py-0.5 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                                    style="border-color: var(--theme-divider-border);"
                                                >
                                                    <Icon icon="mdi:share-variant" class="size-3" />
                                                    分享(10分钟)
                                                </button>
                                                <button
                                                    onclick={() => openArchiveDelete(p.id)}
                                                    class="flex items-center gap-1 rounded-none border px-2 py-0.5 text-[10px] text-(--theme-modal-text)/40 transition-colors hover:border-red-500/50 hover:text-red-500"
                                                    style="border-color: var(--theme-divider-border);"
                                                    title="永久删除，不可恢复"
                                                >
                                                    <Icon icon="mdi:delete-outline" class="size-3" />
                                                    永久删除
                                                </button>
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {:else if tab === 'kuro'}
                        <!-- 库街区（实验性）：登录态管理；接口由应用自身 /api/kuro-app 服务端路由代发 -->
                        <div class="flex flex-col">
                            <span
                                class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                            >
                                <Icon
                                    icon="mdi:account-key-outline"
                                    class="size-4 shrink-0"
                                    style="color: var(--theme-accent-text);"
                                />
                                库街区账号
                                <span
                                    class="rounded-none bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] text-(--theme-accent-text)"
                                    >实验性</span
                                >
                            </span>
                            <p class="mb-3 text-[10px] leading-relaxed text-(--theme-modal-text)/40">
                                登录库街区后，可在「词条集 / 快速词条方案」里把账号下鸣潮角色<b>当前装配的声骸</b
                                >同步成词条方案。登录凭据由应用自身的服务端路由持有（httpOnly
                                cookie），浏览器脚本读不到。
                            </p>

                            <!-- 登录状态 -->
                            <div
                                class="mt-3 flex flex-wrap items-center gap-2 rounded-none border px-2.5 py-2 text-xs"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <Icon
                                    icon={kuroSession.loggedIn
                                        ? kuroValid === false
                                            ? 'mdi:shield-alert-outline'
                                            : 'mdi:shield-check-outline'
                                        : 'mdi:shield-off-outline'}
                                    class="size-4 shrink-0 {kuroSession.loggedIn && kuroValid !== false
                                        ? 'text-(--theme-accent-text)'
                                        : 'text-(--theme-modal-text)/40'}"
                                />
                                <span class="font-black text-(--theme-modal-text)">
                                    {kuroSession.loggedIn ? (kuroSession.account?.userName ?? '已登录') : '未登录'}
                                </span>
                                {#if kuroSession.loggedIn}
                                    {#if kuroSession.account?.phone}
                                        <span class="text-[10px] text-(--theme-modal-text)/40"
                                            >{kuroSession.account.phone.replace(
                                                /^(\d{3})\d+(\d{2,4})$/,
                                                '$1****$2'
                                            )}</span
                                        >
                                    {/if}
                                    <span class="text-[10px] text-(--theme-modal-text)/40">
                                        · 绑定角色 {kuroSession.roles.length} 个 · 有效性：{kuroValid === null
                                            ? '未校验'
                                            : kuroValid
                                              ? '有效'
                                              : `无效（${kuroReason ?? '未知'}）`}
                                    </span>
                                {/if}
                            </div>

                            <!-- 操作 -->
                            <div class="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                    onclick={() => setKuroLoginOpen(true)}
                                    class="flex items-center gap-1 rounded-none border px-2.5 py-1.5 text-xs font-black text-(--theme-accent-text) transition-colors hover:border-(--theme-accent-bg)"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:login-variant" class="size-4" />
                                    {kuroSession.loggedIn ? '登录窗口 / 重新登录' : '登录'}
                                </button>
                                {#if kuroSession.loggedIn}
                                    <button
                                        onclick={handleKuroCheck}
                                        disabled={kuroBusy}
                                        class="flex items-center gap-1 rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text) disabled:opacity-40"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        <Icon icon="mdi:shield-refresh-outline" class="size-4" />
                                        检验有效性
                                    </button>
                                    <button
                                        onclick={handleKuroLogout}
                                        disabled={kuroBusy}
                                        class="flex items-center gap-1 rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-red-400 disabled:opacity-40"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        <Icon icon="mdi:logout-variant" class="size-4" />
                                        退出登录
                                    </button>
                                {/if}
                            </div>

                            <!-- 绑定角色：同步时使用选中的这个 -->
                            {#if kuroSession.roles.length > 0}
                                <div class="mt-4">
                                    <span class="mb-1 block text-[10px] text-(--theme-modal-text)/40"
                                        >同步使用的绑定角色</span
                                    >
                                    <div class="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-4">
                                        {#each kuroSession.roles as role (role.roleId)}
                                            <div
                                                class={[
                                                    'flex min-w-0 cursor-pointer items-center gap-2 rounded-none border px-2.5 py-2 transition-colors',
                                                    kuroActiveRole?.roleId === role.roleId
                                                        ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10'
                                                        : 'border-(--theme-divider-border) bg-(--theme-input-bg) hover:bg-(--theme-modal-text)/5'
                                                ].join(' ')}
                                                onclick={() => setKuroRoleId(role.roleId)}
                                            >
                                                <Icon
                                                    icon={kuroActiveRole?.roleId === role.roleId
                                                        ? 'mdi:radiobox-marked'
                                                        : 'mdi:radiobox-blank'}
                                                    class="size-4 shrink-0 text-(--theme-accent-text)"
                                                />
                                                <span
                                                    class="min-w-0 flex-1 truncate text-xs font-black text-(--theme-modal-text)"
                                                    >{role.nickname || role.roleId}</span
                                                >
                                                <span class="shrink-0 text-[10px] text-(--theme-modal-text)/40"
                                                    >{role.serverName ?? role.serverId}{role.level
                                                        ? ` · Lv.${role.level}`
                                                        : ''}</span
                                                >
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                        </div>
                    {:else if tab === 'cache'}
                        <!-- Cache management：按类型浏览 + 逐条清理 -->
                        <div>
                            <span
                                class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                            >
                                <Icon
                                    icon="mdi:database-off-outline"
                                    class="size-4 shrink-0"
                                    style="color: var(--theme-accent-text);"
                                />
                                缓存清理
                            </span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                仅清理接口数据缓存（列表 / 详情 / 图像），不影响你的工程与本地数据；展开分类可逐条清理
                            </p>

                            <!-- 汇总条：总数 + 全部清理 -->
                            <div
                                class="mb-3 flex items-center justify-between gap-3 border px-3 py-2"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <span class="min-w-0 truncate text-[10px] text-(--theme-modal-text)/45">
                                    当前共 <span
                                        class="text-base font-black text-(--theme-modal-text)"
                                        style="text-shadow: 0 0 3px var(--theme-halo-color);">{cacheCount}</span
                                    >
                                    条缓存{cacheBusy ? ' · 处理中…' : ''}
                                </span>
                                <button
                                    onclick={handleClearCacheAll}
                                    disabled={cacheBusy || cacheCount === 0}
                                    class="flex shrink-0 items-center gap-1 rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/50 transition-colors hover:border-red-500/50 hover:text-red-500 disabled:pointer-events-none disabled:opacity-35"
                                    style="border-color: var(--theme-divider-border);"
                                    title="清空全部接口缓存（不可恢复，但会随使用自动重建）"
                                >
                                    <Icon icon="mdi:delete-sweep-outline" class="size-3" />
                                    全部清理
                                </button>
                            </div>

                            <div class="flex flex-col gap-2">
                                {#each CACHE_LABELS as item (item.key)}
                                    {@const entries = entriesOf(item.key)}
                                    {@const expanded = expandedCache === item.key}
                                    {@const showProvider = new Set(entries.map((e) => e.provider)).size > 1}
                                    <div
                                        class="rounded-none border"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <!-- 分类行 -->
                                        <div class="flex items-center gap-2.5 px-3 py-2">
                                            <Icon icon={item.icon} class="size-4 shrink-0 text-(--theme-accent-text)" />
                                            <div class="min-w-0 flex-1">
                                                <span
                                                    class="flex items-center gap-2 text-xs font-medium text-(--theme-modal-text)"
                                                >
                                                    {item.label}
                                                    <span class="text-[10px] font-normal text-(--theme-modal-text)/40"
                                                        >{entries.length} 条</span
                                                    >
                                                </span>
                                                <span
                                                    class="mt-0.5 block truncate text-[10px] text-(--theme-modal-text)/35"
                                                    >{item.desc}</span
                                                >
                                            </div>
                                            <button
                                                onclick={() => (expandedCache = expanded ? null : item.key)}
                                                disabled={entries.length === 0}
                                                class="flex shrink-0 items-center gap-1 rounded-none border px-2 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text) disabled:pointer-events-none disabled:opacity-35"
                                                style="border-color: var(--theme-divider-border);"
                                                title="展开逐条清理"
                                            >
                                                <Icon
                                                    icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                                                    class="size-3"
                                                />
                                                {expanded ? '收起' : '明细'}
                                            </button>
                                            <button
                                                onclick={() => handleClearCache(item.key)}
                                                disabled={cacheBusy || entries.length === 0}
                                                class="flex shrink-0 items-center gap-1 rounded-none px-2 py-1 text-[10px] font-medium transition-all hover:brightness-125 disabled:pointer-events-none disabled:opacity-35"
                                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                                                title="清理该类型全部缓存"
                                            >
                                                <Icon icon="mdi:delete-sweep-outline" class="size-3" />
                                                清理本类
                                            </button>
                                        </div>

                                        <!-- 条目明细：逐条清理 -->
                                        {#if expanded}
                                            <div
                                                class="border-t px-2 py-2"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                {#if entries.length === 0}
                                                    <p class="px-1 py-1 text-[10px] text-(--theme-modal-text)/35">
                                                        暂无缓存条目
                                                    </p>
                                                {:else}
                                                    <div
                                                        class="theme-scrollbar grid max-h-52 grid-cols-1 gap-1 overflow-y-auto pr-1 xl:grid-cols-2 xl:gap-x-3"
                                                    >
                                                        {#each entries as entry (entry.key)}
                                                            <div
                                                                class="flex min-w-0 items-center gap-2 rounded-none border px-2 py-1"
                                                                style="border-color: var(--theme-divider-border);"
                                                            >
                                                                <span
                                                                    class="min-w-0 flex-1 truncate text-[10px] text-(--theme-modal-text)/70"
                                                                    title={entry.key}
                                                                >
                                                                    <span class="text-(--theme-modal-text)/35"
                                                                        >{entityLabel(entry.entity)}</span
                                                                    >
                                                                    {#if entry.name}
                                                                        · {entry.name}
                                                                    {/if}
                                                                    {#if showProvider}
                                                                        <span class="ml-1 opacity-40"
                                                                            >[{entry.provider}]</span
                                                                        >
                                                                    {/if}
                                                                </span>
                                                                <button
                                                                    onclick={() => handleClearCacheEntry(entry)}
                                                                    disabled={cacheBusy}
                                                                    class="shrink-0 rounded-none text-(--theme-modal-text)/35 transition-colors hover:text-red-500 disabled:pointer-events-none disabled:opacity-35"
                                                                    title="清理该条目"
                                                                >
                                                                    <Icon icon="mdi:close" class="size-3.5" />
                                                                </button>
                                                            </div>
                                                        {/each}
                                                    </div>
                                                {/if}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {:else if tab === 'ai' || tab === 'ai-conn'}
                        <!-- AI 助手设置（权限 / 提示词 与 接入配置 分页） -->
                        <div>
                            <span
                                class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)"
                            >
                                <Icon
                                    icon={tab === 'ai-conn' ? 'mdi:connection' : 'mdi:shield-account-outline'}
                                    class="size-4 shrink-0"
                                    style="color: var(--theme-accent-text);"
                                />
                                {tab === 'ai-conn' ? '启用 / 接入配置' : '权限 / 提示词'}
                            </span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                {tab === 'ai-conn'
                                    ? '开关 AI 助手悬浮窗，并配置多组「提供商 / 模型 / API Key」一键切换，每组独立保存；API Key 仅存本机。点击配置文件即可切换，点「编辑」打开独立弹窗修改'
                                    : '控制 AI 助手的危险操作权限与角色提示词；提示词为空时使用内置默认人设'}
                            </p>
                            <div class="flex flex-col gap-2">
                                {#if tab === 'ai-conn'}
                                    <!-- 启用 AI 助手（独立开关，立即保存） -->
                                    <div
                                        class="flex items-center justify-between gap-3 rounded-none border px-3 py-2"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <div class="min-w-0">
                                            <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                >启用 AI 助手</span
                                            >
                                            <span class="mt-0.5 block text-[10px] text-(--theme-modal-text)/40">
                                                开启后页面右下角显示 AI 助手悬浮窗；关闭后悬浮窗隐藏，所有 AI 功能不可用
                                            </span>
                                        </div>
                                        <button
                                            onclick={() => toggleAiEnabled()}
                                            class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                            style="background: {getGenPrefs().enabled
                                                ? 'var(--theme-accent-bg)'
                                                : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                            title="点击切换"
                                        >
                                            <span
                                                class="absolute top-0.5 size-4 rounded-full transition-all"
                                                style="left: {getGenPrefs().enabled
                                                    ? '18px'
                                                    : '2px'}; background: var(--theme-modal-bg);"
                                            ></span>
                                        </button>
                                    </div>
                                {/if}
                                <div class="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-4">
                                    {#if tab === 'ai'}
                                        <!-- 危险操作权限（独立设置，立即保存） -->
                                        <div
                                            class="rounded-none border px-3 py-2.5"
                                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                        >
                                            <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                >危险操作权限</span
                                            >
                                            <p class="mt-1 mb-2 text-[10px] text-(--theme-modal-text)/40">
                                                AI 执行危险操作（删除工程、清空数据等）时的确认策略；「批量」=
                                                一次指令内的多次调用只询问一次
                                            </p>
                                            <div class="flex flex-col gap-1">
                                                {#each DANGER_MODE_OPTIONS as opt}
                                                    {@const active = getGenPrefs().dangerMode === opt.value}
                                                    <button
                                                        onclick={() => setDangerMode(opt.value)}
                                                        class={[
                                                            'flex items-center gap-2 rounded-none border px-2.5 py-1.5 text-left transition-colors',
                                                            active
                                                                ? 'border-(--theme-accent-bg)'
                                                                : 'hover:bg-(--theme-modal-text)/5'
                                                        ].join(' ')}
                                                        style={active
                                                            ? 'background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent);'
                                                            : 'border-color: var(--theme-divider-border);'}
                                                    >
                                                        <Icon
                                                            icon={active ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}
                                                            class={active
                                                                ? 'size-3.5 shrink-0 text-(--theme-accent-text)'
                                                                : 'size-3.5 shrink-0 text-(--theme-modal-text)/30'}
                                                        />
                                                        <span class="min-w-0 flex-1">
                                                            <span
                                                                class="block text-xs font-medium text-(--theme-modal-text)/80"
                                                                >{opt.label}</span
                                                            >
                                                            <span class="block text-[10px] text-(--theme-modal-text)/40"
                                                                >{opt.desc}</span
                                                            >
                                                        </span>
                                                    </button>
                                                {/each}
                                            </div>
                                        </div>
                                    {/if}
                                    {#if tab === 'ai-conn'}
                                        <!-- AI配置文件设置：独占整行，内部列表双列 -->
                                        <div
                                            class="rounded-none border px-3 py-2.5 xl:col-span-2"
                                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                        >
                                            <div class="mb-2 flex items-center justify-between">
                                                <span class="text-xs font-medium text-(--theme-modal-text)/70"
                                                    >AI配置文件设置</span
                                                >
                                                <button
                                                    onclick={handleAddAiProfile}
                                                    class="inline-flex items-center gap-1 rounded-none px-2.5 py-1 text-[10px] font-medium transition-all hover:brightness-110"
                                                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                                >
                                                    <Icon icon="mdi:plus" class="size-3" />
                                                    新建
                                                </button>
                                            </div>
                                            <p class="mb-2 text-[10px] text-(--theme-modal-text)/40">
                                                点击配置文件即可切换；编辑、删除请使用右侧按钮
                                            </p>
                                            <div class="mb-1.5 grid grid-cols-1 gap-1 xl:grid-cols-2 xl:gap-x-4">
                                                {#each aiProfiles as p}
                                                    {@const isActive = p.id === aiActiveId}
                                                    <div
                                                        class="flex items-center gap-2 rounded-none border px-2.5 py-1.5 transition-colors"
                                                        style="border-color: {isActive
                                                            ? 'color-mix(in srgb, var(--theme-accent-bg) 45%, transparent)'
                                                            : 'var(--theme-divider-border)'}; background: color-mix(in srgb, var(--theme-accent-bg) {isActive
                                                            ? '10%'
                                                            : '0%'}, transparent);"
                                                    >
                                                        <button
                                                            onclick={() => handleSelectAiProfile(p.id)}
                                                            class="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                                                            title="切换到该配置"
                                                        >
                                                            <span
                                                                class="flex w-full items-center gap-1.5 text-xs font-medium text-(--theme-modal-text)"
                                                            >
                                                                <Icon
                                                                    icon={isActive
                                                                        ? 'mdi:radiobox-marked'
                                                                        : 'mdi:radiobox-blank'}
                                                                    class={isActive
                                                                        ? 'size-3.5 shrink-0 text-(--theme-accent-text)'
                                                                        : 'size-3.5 shrink-0 text-(--theme-modal-text)/30'}
                                                                />
                                                                <span class="truncate">{p.label}</span>
                                                                {#if isActive}
                                                                    <span
                                                                        class="shrink-0 rounded-none bg-(--theme-accent-bg)/20 px-1 py-px text-[9px] text-(--theme-accent-text)"
                                                                        >当前</span
                                                                    >
                                                                {/if}
                                                            </span>
                                                            <span
                                                                class="w-full truncate pl-5 text-[10px] text-(--theme-modal-text)/40"
                                                            >
                                                                {p.model} · {p.baseUrl}
                                                            </span>
                                                        </button>
                                                        <div class="flex shrink-0 items-center gap-0.5">
                                                            <button
                                                                onclick={() => (aiEditTarget = p)}
                                                                class="rounded-none p-1 text-(--theme-modal-text)/35 transition-colors hover:text-(--theme-accent-text)"
                                                                title="编辑此配置"
                                                            >
                                                                <Icon icon="mdi:pencil-outline" class="size-3.5" />
                                                            </button>
                                                            <button
                                                                onclick={() => handleDeleteAiProfile(p)}
                                                                class="rounded-none p-1 text-(--theme-modal-text)/35 transition-colors hover:text-red-400"
                                                                title="删除此配置"
                                                            >
                                                                <Icon icon="mdi:trash-can-outline" class="size-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                {/each}
                                            </div>
                                        </div>
                                    {/if}
                                    {#if tab === 'ai'}
                                        <!-- 提示词设置 -->
                                        <div
                                            class="rounded-none border px-3 py-2.5"
                                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                        >
                                            <span class="text-xs font-medium text-(--theme-modal-text)/70"
                                                >提示词设置</span
                                            >
                                            <p class="mb-2 mt-1 text-[10px] text-(--theme-modal-text)/40">
                                                命名规则与人设提示词，与模型配置分开保存
                                            </p>
                                            <div class="flex flex-col gap-1">
                                                <div
                                                    class="flex items-center gap-2 rounded-none border px-2.5 py-1.5"
                                                    style="border-color: var(--theme-divider-border);"
                                                >
                                                    <div class="min-w-0 flex-1">
                                                        <span
                                                            class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                            >Buff 命名规则</span
                                                        >
                                                        <span
                                                            class="mt-0.5 block truncate text-[10px] text-(--theme-modal-text)/40"
                                                        >
                                                            生成 Buff 时的命名规范；清空则每次由 AI 询问
                                                        </span>
                                                    </div>
                                                    <button
                                                        onclick={() => (promptEditKind = 'naming')}
                                                        class="inline-flex shrink-0 items-center gap-1 rounded-none px-2.5 py-1 text-[10px] font-medium transition-all hover:brightness-110"
                                                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                                    >
                                                        <Icon icon="mdi:pencil-outline" class="size-3" />
                                                        编辑
                                                    </button>
                                                </div>
                                                <div
                                                    class="flex items-center gap-2 rounded-none border px-2.5 py-1.5"
                                                    style="border-color: var(--theme-divider-border);"
                                                >
                                                    <div class="min-w-0 flex-1">
                                                        <span
                                                            class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                            >黑话词典</span
                                                        >
                                                        <span
                                                            class="mt-0.5 block truncate text-[10px] text-(--theme-modal-text)/40"
                                                        >
                                                            官方/生僻叫法 → 玩家黑话；
                                                        </span>
                                                    </div>
                                                    <button
                                                        onclick={() => (promptEditKind = 'slang')}
                                                        class="inline-flex shrink-0 items-center gap-1 rounded-none px-2.5 py-1 text-[10px] font-medium transition-all hover:brightness-110"
                                                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                                    >
                                                        <Icon icon="mdi:pencil-outline" class="size-3" />
                                                        编辑
                                                    </button>
                                                </div>
                                                <div
                                                    class="flex items-center gap-2 rounded-none border px-2.5 py-1.5"
                                                    style="border-color: var(--theme-divider-border);"
                                                >
                                                    <div class="min-w-0 flex-1">
                                                        <span
                                                            class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                            >人设提示词</span
                                                        >
                                                        <span
                                                            class="mt-0.5 block truncate text-[10px] text-(--theme-modal-text)/40"
                                                        >
                                                            AI 助手的角色与行为规则（system prompt）
                                                        </span>
                                                    </div>
                                                    <button
                                                        onclick={() => (promptEditKind = 'persona')}
                                                        class="inline-flex shrink-0 items-center gap-1 rounded-none px-2.5 py-1 text-[10px] font-medium transition-all hover:brightness-110"
                                                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                                    >
                                                        <Icon icon="mdi:pencil-outline" class="size-3" />
                                                        编辑
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>

    <!-- Archive delete confirm -->
    {#if confirmDelete}
        {@const target = confirmDelete}
        <ConfirmDeleteModal
            open
            title="永久删除归档工程"
            confirmText={`删除${target.name}`}
            onclose={closeArchiveDelete}
            onconfirm={doArchiveDelete}
        />
    {/if}

    <!-- AI profile delete confirm -->
    {#if aiDeleteConfirm}
        <ConfirmDeleteModal
            open
            title="删除 AI 配置文件"
            confirmText={`删除「${aiDeleteConfirm.label}」`}
            onclose={() => (aiDeleteConfirm = null)}
            onconfirm={doDeleteAiProfile}
        />
    {/if}

    <!-- AI profile edit -->
    {#if aiEditTarget}
        <AiProfileEditModal
            open
            profile={aiEditTarget}
            onclose={() => (aiEditTarget = null)}
            onsaved={() => (aiEditTarget = null)}
        />
    {/if}

    <!-- AI prompt edit -->
    {#if promptEditKind}
        <AiPromptEditModal
            open
            kind={promptEditKind}
            onclose={() => (promptEditKind = null)}
            onsaved={() => (promptEditKind = null)}
        />
    {/if}

    <!-- Key picker（键盘图标 + 手柄键位） -->
    {#if keyPickerFor}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="animate-fade-in fixed inset-0 z-70 flex items-center justify-center backdrop-blur-sm"
            style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        >
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                data-sf="modal"
                class="theme-scrollbar animate-pop-in max-h-[75vh] w-[92vw] max-w-lg overflow-y-auto rounded-none border p-4"
                style="color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                onclick={(e) => e.stopPropagation()}
            >
                <div class="mb-3 flex items-center justify-between">
                    <span class="text-sm font-semibold">选择按键与手柄键位</span>
                    <button
                        onclick={() => (keyPickerFor = null)}
                        class="rounded-none p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70 {getModalClosePosition() ===
                        'top-left'
                            ? 'order-first'
                            : ''}"
                    >
                        <Icon icon="mdi:close" class="size-4.5" />
                    </button>
                </div>
                <div class="mb-2 flex items-center gap-2 text-[10px] font-medium text-(--theme-modal-text)/60">
                    <Icon icon="mdi:keyboard-outline" class="size-3.5" />
                    键盘
                </div>
                <div class="flex flex-wrap gap-1.5">
                    {#each uiBtnIconList as [name, url]}
                        <button
                            onclick={() => {
                                updateEntry(keyPickerFor!, { blockKey: name })
                                keyPickerFor = null
                            }}
                            class="flex size-10 items-center justify-center rounded-none border transition-colors {keyPickerFor &&
                            entryById(keyPickerFor)?.blockKey === name
                                ? 'border-(--theme-accent-bg)'
                                : 'hover:bg-(--theme-modal-text)/10'}"
                            style="border-color: {keyPickerFor && entryById(keyPickerFor)?.blockKey === name
                                ? 'var(--theme-accent-bg)'
                                : 'var(--theme-divider-border)'};"
                            title={name}
                        >
                            <img
                                src={url}
                                alt={name}
                                draggable="false"
                                class="size-6 object-contain pointer-events-none"
                            />
                        </button>
                    {/each}
                </div>
                <div class="my-3 border-t" style="border-color: var(--theme-divider-border);"></div>
                <div class="mb-2 flex items-center gap-2 text-[10px] font-medium text-(--theme-modal-text)/60">
                    <Icon icon="mdi:gamepad-variant-outline" class="size-3.5" />
                    手柄图标
                </div>
                <div class="flex flex-wrap gap-1.5">
                    {#each GAMEPAD_BUTTONS as btn}
                        <button
                            onclick={() => {
                                updateEntry(keyPickerFor!, { blockKey: btn.id })
                                keyPickerFor = null
                            }}
                            class="flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-none border px-2 transition-colors {keyPickerFor &&
                            entryById(keyPickerFor)?.blockKey === btn.id
                                ? 'border-(--theme-accent-bg)'
                                : 'hover:bg-(--theme-modal-text)/10'}"
                            style="border-color: {keyPickerFor && entryById(keyPickerFor)?.blockKey === btn.id
                                ? 'var(--theme-accent-bg)'
                                : 'var(--theme-divider-border)'};"
                            title={btn.label}
                        >
                            {#if btn.icon}
                                <img
                                    src={btn.icon}
                                    alt={btn.label}
                                    draggable="false"
                                    class="size-5 object-contain pointer-events-none"
                                />
                            {:else}
                                <span class="text-[10px] font-bold text-(--theme-modal-text)/80">{btn.label}</span>
                            {/if}
                        </button>
                    {/each}
                </div>
            </div>
        </div>
    {/if}
{/if}
