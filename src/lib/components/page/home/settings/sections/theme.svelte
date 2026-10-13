<script lang="ts">
    /**
     * @desc 设置 → 外观主题（Phase 5.1 第四增量：自 `settings-modal.svelte` 原样抽出，标记与行为未改）。
     * 迁移说明：
     *   - `bgEditingLight` / `bgUrl` / `surfaceKey` 落在 `settings-ui.svelte.ts`：抽取前它们都是外壳的 `$state`，
     *     而 `TabPanel` 的 `{#key active}` 会在切换栏目时重挂载本组件 —— 留在组件里会被重置（行为变化）。
     *     其中 `bgEditingLight` / `bgUrl` 还被外壳「打开设置」的 `$effect` 写，故写入口只有
     *     `syncThemeEditing()` 一份，外壳调用它，本组件只读写 store 的访问器。
     *   - `editingBgKey` / `editingBg` 两个派生同样留在 store：外壳那个 `$effect` 的依赖语义建在
     *     `editingBg` 的派生值上（理由见 store 里 `syncThemeEditing` 的注释）。
     *   - `currentTheme` / `isDark` / `overrides` / `activeThemeBg` / `modeKey` / `appearance` / `surfaceStyle`
     *     只是全局 `$lib/theme` store 的 `$derived` 视图（非自有状态），随本组件留下。
     *   - `COLOR_PRESETS` / `getPresetStyle` / `compressImage` / `maskPreview` 与各 `handle*` 是本 tab 的
     *     展示逻辑，留下；`fileInput` 是 `bind:this` 的 DOM 引用，只能留在本组件（重挂载时元素本身也是新的）。
     *
     * T15：本 tab 的 4 处手搓分段控件（主色调 7 段 / 昼夜切换小号 switch / 背景图 黑夜·白天 / 区域质感-区域 6 段）
     * 全部换成 `ui/tabs` 的文字 tab（等宽分段 + 单块滑动指示块）。取值语义与持久化键不变：
     * 主色调仍写 `accentHue`（含 `null` = 靛蓝这一历史取值）、昼夜仍走 `setActiveTheme('dark' | 'light')`、
     * 背景图编辑目标仍走 `setBgEditingLight`、区域仍走 `setSurfaceKey`。
     *
     * UI 整改（本次）：
     *   ① 标题一律走 `ui/section-title`（原先两处手写、且下边距比其他 tab 大一档）；
     *   ② **背景图不再渲染两遍**：原先「缩略图（h-28，带换图/清除）」与下方「预览框（h-40，带 LIVE 标）」
     *      是同一张图的两个副本，职能重复 —— 现在合并成一个预览框，换图 / 清除作为它的操作条，
     *      没有图时该框本身就是上传入口（虚线提示 + 点击选图，行为与原先的虚线框一致）；
     *   ③ 背景质感 / 背景图效果的滑块从预览框内部移出为独立分区（它们作用的是全工作区，不只是预览）；
     *   ④ 分段控件的宽度 / 配色 / 外边距统一走 `../utils`，不再往控件 `class` 里塞 `mb-*`。
     */
    import Icon from '@iconify/svelte'
    import Slider from '$lib/components/ui/slider.svelte'
    import FieldLabel from '$lib/components/ui/field-label.svelte'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import SettingRow from '$lib/components/ui/setting-row.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import {
        bgMaskCss,
        bgMaskLabel,
        BG_MASK_MAX,
        BG_MASK_MIN,
        DEFAULT_SURFACE_RADIUS,
        defaultSurfaceStyle,
        getActiveId,
        getAppearance,
        getOverrides,
        getSurfaceStyle,
        getThemes,
        NEON_GLOW_MAX,
        setActiveTheme,
        setBgImageEffect,
        setSurfaceStyle,
        SURFACE_GROUPS,
        SURFACE_RADIUS_MAX,
        updateOverride,
        type SurfaceStyle,
        type ThemeMode
    } from '$lib/theme'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        getBgUrl,
        getEditingBg,
        getEditingBgKey,
        getSurfaceKey,
        setBgEditingLight,
        setBgUrl,
        setSurfaceKey
    } from '../settings-ui.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import { ACTION_BTN, ACTION_BTN_ACCENT, ACTION_BTN_DANGER, ROW_TABS, TAB_ACCENT } from '../utils'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    let currentTheme = $derived(getActiveId())
    let overrides = $derived(getOverrides())
    let isDark = $derived(getActiveId() !== 'light')
    /** @desc 卡片 / 弹窗 / 小部件的统一圆角（px；由「圆角」分区的滑块写回 override） */
    let surfaceRadius = $derived(overrides.surfaceRadius ?? DEFAULT_SURFACE_RADIUS)

    /** @desc 卡片表面（本页多处卡片共用；原先每处各写一遍内联 border/background） */
    const CARD_SURFACE = 'sf-radius rounded-none border'
    const CARD_STYLE = 'border-color: var(--theme-divider-border); background: var(--theme-input-bg);'

    let bgUrl = $derived(getBgUrl())
    let surfaceKey = $derived(getSurfaceKey())

    /** @desc 正在编辑的那张背景图（黑夜=backgroundImage / 白天=backgroundImageLight） */
    let editingBgKey = $derived(getEditingBgKey())
    let editingBg = $derived(getEditingBg())
    /** @desc 当前主题实际生效的背景图 */
    let activeThemeBg = $derived(currentTheme === 'light' ? overrides.backgroundImageLight : overrides.backgroundImage)

    /**
     * @desc 昼夜切换（T15：原来是手搓的小号 switch —— 只能表达「翻转」，两个分段说不出各自是什么）。
     * 改成两段文字 tab 后按**目标值**直取，值域就是主题 id（`dark` / `light`）。
     */
    const pickThemeMode = (value: string) => {
        const next = value === 'light' ? 'light' : 'dark'
        if (next === currentTheme) return
        setActiveTheme(next).then(() => {
            const t = getThemes().find((th) => th.id === next)
            addToast(`已切换至「${t?.name ?? next}」`, 'success')
        })
    }

    /** @desc 昼夜主题的两段文字 tab（顺序：深色 → 浅色，与「深色为默认」一致） */
    const THEME_MODE_TABS = [
        { value: 'dark', label: '深色' },
        { value: 'light', label: '浅色' }
    ]

    /**
     * @desc 主色调预设（T15：原来是 7 个手搓分段按钮 + 黑白前的分隔线）。
     * `key` 是 `ui/tabs` 的分段值（须唯一，同时用作 `{#each}` 的 key），`hue` 才是写进 `accentHue` 的取值
     * ——持久化键与取值域完全不变（`null` = 靛蓝是历史取值，不是「未设置」）。
     */
    const COLOR_PRESETS = [
        { key: 'default', name: '默认', hue: 190 as number | 'mono' | null },
        { key: 'indigo', name: '靛蓝', hue: null as number | 'mono' | null },
        { key: 'magenta', name: '品红', hue: 345 as number | 'mono' | null },
        { key: 'vermilion', name: '橘红', hue: 28 as number | 'mono' | null },
        { key: 'amber', name: '橙黄', hue: 90 as number | 'mono' | null },
        { key: 'forest', name: '墨绿', hue: 150 as number | 'mono' | null },
        { key: 'mono', name: '黑白', hue: 'mono' as const }
    ]
    /** @desc 主色调分段清单（7 段；原来夹在「黑白」前的分隔线随等宽分段一并取消） */
    const ACCENT_TABS = COLOR_PRESETS.map((p) => ({ value: p.key, label: p.name }))
    /** @desc 当前 `accentHue` 反查到的预设 key（7 个 hue 取值互不重复，故可反查） */
    const accentKey = $derived(COLOR_PRESETS.find((p) => p.hue === overrides.accentHue)?.key ?? COLOR_PRESETS[0].key)
    /** @desc 当前预设的选中态配色：改造前直接写在选中按钮上，现在落到滑动指示块 + 选中项文字 */
    const accentStyle = $derived(getPresetStyle(COLOR_PRESETS.find((p) => p.key === accentKey)!.hue))
    const pickAccent = (value: string) => {
        const preset = COLOR_PRESETS.find((p) => p.key === value)
        if (preset) updateOverride('accentHue', preset.hue)
    }

    /**
     * @desc 编辑目标始终跟随当前主题（原先这里是「黑夜｜白天（当前）」两段分段控件，
     * 可以手动切换"正在编辑哪一张"，但它本质只是在复述当前昼夜，用户明确要求删掉）。
     * 现在的口径：**当前是黑夜就编辑黑夜那张，切成白天就编辑白天那张** —— 与下面
     * `modeKey`（背景质感/背景图效果的坐标系）完全同一套，不再有「编辑目标」这个独立状态。
     * 清理草稿（file input / URL 输入框）放在 `$effect` 里随主题变化做一次。
     */
    let fileInput: HTMLInputElement | undefined = $state()
    /** @desc 上一次同步到的昼夜（非响应式）：只是用来避免 `$effect` 里读自己写的状态而反复重跑 */
    let syncedEditingLight: boolean | null = null
    $effect(() => {
        const light = currentTheme === 'light'
        if (syncedEditingLight === light) return
        syncedEditingLight = light
        setBgEditingLight(light)
        if (fileInput) fileInput.value = ''
        const next = light ? overrides.backgroundImageLight : overrides.backgroundImage
        setBgUrl(next.startsWith('http') ? next : '')
    })

    /** @desc 背景质感「区域」六段（互斥取值；逐段 `title` 保留原来的区域说明，下方另有一行选中项说明） */
    const SURFACE_TABS = SURFACE_GROUPS[0].items.map((item) => ({
        value: item.key,
        label: item.label,
        title: item.hint
    }))
    const pickSurface = (value: string) => {
        const item = SURFACE_GROUPS[0].items.find((i) => i.key === value)
        if (item) setSurfaceKey(item.key)
    }

    // ── 背景图效果 / 背景质感（按昼夜分别保存，编辑的是当前生效的那一套）──
    const modeKey = $derived<ThemeMode>(currentTheme === 'light' ? 'light' : 'dark')
    const appearance = $derived(getAppearance(modeKey))
    const surfaceStyle = $derived(getSurfaceStyle(surfaceKey, modeKey))

    const updateSurface = (patch: Partial<SurfaceStyle>) => void setSurfaceStyle(surfaceKey, patch, modeKey)
    const resetSurface = () => void setSurfaceStyle(surfaceKey, defaultSurfaceStyle(surfaceKey, modeKey), modeKey)
    const updateBgEffect = (patch: { bgImageBlur?: number; bgImageMask?: number }) =>
        void setBgImageEffect(patch, modeKey)

    /** @desc 背景图遮罩预览色（与 :root 上 --theme-bg-mask 同口径） */
    const maskPreview = (v: number) => bgMaskCss(v)

    /** @desc 当前选中的区域（分段说明行与「重置」按钮文案都要用） */
    const surfaceItem = $derived(SURFACE_GROUPS[0].items.find((i) => i.key === surfaceKey))

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
                setBgUrl('')
            })
            .catch((err) => {
                console.error('[bg] 压缩失败，改用原图', err)
                const reader = new FileReader()
                reader.onload = () => {
                    updateOverride(key, reader.result as string)
                    setBgUrl('')
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
        setBgUrl('')
    }

    function handleUrlKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter') handleUrlApply()
    }
</script>

<div class={mergeClass(['flex flex-col', className])} style={styleProp}>
    <!-- Accent color -->
    <div>
        <SectionTitle>
            <Icon icon="mdi:palette-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            主色调
        </SectionTitle>
        <!-- T15：7 段等宽文字 tab；指示块底色 / 选中项文字取当前预设自身的颜色（与改造前选中按钮同色） -->
        <Tabs items={ACCENT_TABS} value={accentKey} onchange={pickAccent} compact {...TAB_ACCENT} />
    </div>

    <!-- 昼夜切换 -->
    <div class="mt-5">
        <SectionTitle>
            <Icon icon="mdi:theme-light-dark" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            昼夜切换
        </SectionTitle>
        <SettingRow>
            <div class="min-w-0">
                <FieldLabel label="主题模式" hint="全局明暗切换，与侧边栏按钮一致" />
            </div>
            <Tabs
                items={THEME_MODE_TABS}
                value={currentTheme}
                onchange={pickThemeMode}
                compact
                class={ROW_TABS}
                {...TAB_ACCENT}
            />
        </SettingRow>
    </div>

    <!-- Background image -->
    <div class="mt-5">
        <SectionTitle>
            <Icon icon="mdi:image-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            背景图
        </SectionTitle>
        <!-- 唯一的背景图预览/上传块（原先「缩略图 + 预览框」两个副本，职能重复） -->
        <div class={CARD_SURFACE} style={CARD_STYLE}>
            <!-- 卡片头：说明进卡片。原先这里还有一组「黑夜｜白天（当前）」分段控件（手动选编辑目标），
                 已按用户要求整块删除 —— 编辑目标现在跟随当前主题，见脚本里的 `syncEditingTarget`。 -->
            <div class="border-b px-3 py-2" style="border-color: var(--theme-divider-border);">
                <FieldLabel
                    label="预览"
                    hint="正在编辑当前主题（{modeKey === 'light'
                        ? '白天'
                        : '黑夜'}）的背景图，与上方主题模式同步；每个色块即该区域的实际质感"
                />
            </div>

            <div class="relative h-44 overflow-hidden">
                {#if editingBg}
                    <!-- 背景图独立层（自身模糊，不影响上层的预览卡片） -->
                    <div
                        class="absolute inset-0"
                        style="background-image: url('{editingBg}'); background-position: center; background-size: cover; filter: blur({appearance.bgImageBlur}px);"
                    ></div>
                    <!-- 背景图遮罩层（与工作区一致，由当前昼夜的背景图遮罩控制） -->
                    <div class="absolute inset-0" style="background: {maskPreview(appearance.bgImageMask)};"></div>
                {:else}
                    <!-- 无背景图时的中性预览底：玻璃卡片效果仍可实时预览，同时兼作上传入口 -->
                    <div
                        class="absolute inset-0"
                        style="background: linear-gradient(135deg, color-mix(in srgb, var(--theme-input-bg) 92%, var(--theme-accent-bg)), color-mix(in srgb, var(--theme-input-bg) 35%, var(--theme-modal-text)));"
                    ></div>
                {/if}
                <!-- @desc 页面缩略图：用**真实**的 data-sf 区域（侧边栏 / 工具栏 / 主内容 / 卡片 / 小部件 / 弹窗）
                     搭出工作区版式，而不是画一个假卡片 —— 每一块的透明度 / 毛玻璃 / 背景深度 / 圆角
                     都直接吃「背景质感」与「圆角」的设置，预览即所见 -->
                <div class="absolute inset-0 flex gap-1.5 p-3">
                    <!-- 侧边栏 -->
                    <div
                        data-sf="sidebar"
                        class="flex w-14 shrink-0 flex-col gap-1 border p-1.5"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <div class="h-1.5 w-7 rounded-full bg-(--theme-modal-text)/35"></div>
                        <div class="mt-1 h-1 w-full rounded-full bg-(--theme-modal-text)/20"></div>
                        <div class="h-1 w-3/4 rounded-full bg-(--theme-modal-text)/20"></div>
                        <div class="h-1 w-5/6 rounded-full bg-(--theme-modal-text)/20"></div>
                    </div>
                    <!-- 主内容区 -->
                    <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                        <!-- 工具栏 -->
                        <div
                            data-sf="toolbar"
                            class="flex h-5 shrink-0 items-center gap-1 border px-1.5"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <div class="h-1.5 w-6 rounded-full bg-(--theme-modal-text)/30"></div>
                            <div class="ml-auto h-1.5 w-4 rounded-full bg-(--theme-modal-text)/20"></div>
                        </div>
                        <!-- 卡片 + 小部件并排 -->
                        <div class="flex min-h-0 flex-1 gap-1.5">
                            <div
                                data-sf="card"
                                class="flex min-w-0 flex-1 flex-col justify-between border p-1.5"
                                style="border-color: var(--theme-card-border);"
                            >
                                <div class="flex items-center gap-1">
                                    <span class="size-3 shrink-0 bg-(--theme-accent-bg)/35"></span>
                                    <span class="h-1.5 w-8 rounded-full bg-(--theme-modal-text)/35"></span>
                                </div>
                                <div class="space-y-1">
                                    <div class="h-1 w-full rounded-full bg-(--theme-modal-text)/20"></div>
                                    <div class="h-1 w-2/3 rounded-full bg-(--theme-modal-text)/15"></div>
                                </div>
                            </div>
                            <div
                                data-sf="widget"
                                class="flex w-16 shrink-0 flex-col justify-between border p-1.5"
                                style="border-color: var(--theme-divider-border);"
                            >
                                <span class="h-1.5 w-6 rounded-full bg-(--theme-modal-text)/35"></span>
                                <div class="flex items-center gap-1">
                                    <span
                                        class="flex size-4 items-center justify-center bg-(--theme-accent-bg)/25 text-(--theme-accent-text)"
                                    >
                                        <Icon icon="mdi:blur" class="size-2.5" />
                                    </span>
                                    <span class="h-1.5 w-6 rounded-full bg-(--theme-modal-text)/25"></span>
                                </div>
                            </div>
                        </div>
                        <!-- 图标按钮族（小部件） -->
                        <div class="flex h-6 shrink-0 items-center gap-1">
                            {#each [0, 1, 2, 3] as i (i)}
                                <div
                                    data-sf="widget"
                                    data-sf-flat
                                    class="size-6 shrink-0 border"
                                    style="border-color: var(--theme-divider-border); --sf-base: var(--theme-input-bg);"
                                ></div>
                            {/each}
                        </div>
                    </div>
                </div>

                <!-- 弹窗浮层：盖在缩略图之上，预览弹窗类表面的毛玻璃与圆角 -->
                <div
                    data-sf="modal"
                    class="absolute left-1/2 top-1/2 flex w-36 -translate-x-1/2 -translate-y-1/2 flex-col gap-1.5 border p-2 shadow-2xl"
                    style="border-color: color-mix(in srgb, var(--theme-modal-text) 18%, transparent);"
                >
                    <div class="flex items-center gap-1">
                        <span class="size-3 shrink-0 bg-(--theme-accent-bg)/35"></span>
                        <span class="h-1.5 w-10 rounded-full bg-(--theme-modal-text)/40"></span>
                    </div>
                    <div class="h-1 w-full rounded-full bg-(--theme-modal-text)/20"></div>
                    <div class="h-1 w-4/5 rounded-full bg-(--theme-modal-text)/15"></div>
                    <div class="mt-0.5 flex items-center justify-end gap-1">
                        <span class="sf-radius h-3.5 w-8 border" style="border-color: var(--theme-divider-border);"
                        ></span>
                        <span class="h-3.5 w-8" style="background: var(--theme-accent-bg);"></span>
                    </div>
                </div>

                <span
                    class="absolute bottom-2 right-2 bg-black/30 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-white/70 backdrop-blur-sm"
                    >LIVE</span
                >
                {#if !editingBg}
                    <!-- 无图时整块即上传入口：一个铺满预览区的按钮，避免给容器挂点击/键盘两套监听 -->
                    <button
                        onclick={() => fileInput?.click()}
                        class="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-1.5 bg-black/30 text-white/90 transition-colors hover:bg-black/40"
                    >
                        <Icon icon="mdi:image-outline" class="size-6" />
                        <span class="text-[11px]">点击选择本地图片</span>
                    </button>
                {/if}
            </div>

            <!-- 操作条：远程加载 / 更换本地图片 / 清除 -->
            <div
                class="flex items-center gap-2 border-t px-3 py-2 bg-(--theme-modal-text)/5"
                style="border-color: var(--theme-divider-border);"
            >
                <input
                    type="text"
                    value={bgUrl}
                    oninput={(e) => setBgUrl((e.target as HTMLInputElement).value)}
                    onkeydown={handleUrlKeydown}
                    placeholder="输入远程图片地址从远程加载，如 https://.../xxx.png"
                    class="min-w-0 flex-1 bg-transparent text-xs text-(--theme-modal-text) outline-none placeholder:text-(--theme-modal-text)/30 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-(--theme-accent-bg)"
                />
                <Button
                    variant="text"
                    size="none"
                    bare
                    keepDisabled
                    onclick={handleUrlApply}
                    disabled={!bgUrl.trim()}
                    backgroundImage="var(--theme-accent-bg)"
                    textColor="var(--theme-accent-text-on-bg)"
                    class={ACTION_BTN_ACCENT}
                >
                    加载远程图片
                </Button>
                <Button
                    variant="icon-text"
                    size="none"
                    bare
                    onclick={() => fileInput?.click()}
                    backgroundImage="transparent"
                    textColor="var(--theme-accent-text)"
                    class={ACTION_BTN}
                >
                    <Icon icon="mdi:reload" class="size-3.5" />
                    更换本地图片
                </Button>
                {#if editingBg}
                    <Button variant="icon-text" size="none" bare onclick={clearBackground} class={ACTION_BTN_DANGER}>
                        <Icon icon="mdi:delete-outline" class="size-3.5" />
                        清除
                    </Button>
                {/if}
            </div>
        </div>

        <input type="file" accept="image/*" bind:this={fileInput} onchange={handleFileSelect} class="hidden" />
    </div>

    <!-- 背景质感 -->
    <div class="mt-5">
        <SectionTitle>
            <Icon icon="mdi:layers-triple-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            背景质感
        </SectionTitle>
        <div class={mergeClass([CARD_SURFACE, 'px-3 py-3'])} style={CARD_STYLE}>
            <!-- 说明与区域选择都放进卡片（说明原先是浮在卡片外的段落） -->
            <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <FieldLabel
                        label="按区域分别调整"
                        hint="按黑夜 / 白天分别保存，当前编辑「{modeKey === 'light'
                            ? '白天'
                            : '黑夜'}」；先选区域再调参数"
                    />
                </div>
            </div>
            <div class="mt-2">
                <Tabs items={SURFACE_TABS} value={surfaceKey} onchange={pickSurface} compact {...TAB_ACCENT} />
            </div>
            <p class="mt-2 text-[10px] leading-4 text-(--theme-modal-text)/40">{surfaceItem?.hint}</p>

            <div
                class="mt-3 grid grid-cols-1 gap-4 border-t pt-3 xl:grid-cols-3 xl:gap-x-6"
                style="border-color: var(--theme-divider-border);"
            >
                <Slider
                    label="不透明度"
                    value={surfaceStyle.opacity}
                    min={0}
                    max={100}
                    step={1}
                    valueText="{surfaceStyle.opacity}%"
                    oninput={(v) => updateSurface({ opacity: v })}
                >
                    {#snippet labelSnippet()}<span>不透明度</span>{/snippet}
                    {#snippet captions()}<span>全透</span><span>不透明</span>{/snippet}
                </Slider>

                <Slider
                    label="毛玻璃强度"
                    value={surfaceStyle.blur}
                    min={0}
                    max={32}
                    step={1}
                    valueText="{surfaceStyle.blur}px"
                    oninput={(v) => updateSurface({ blur: v })}
                >
                    {#snippet labelSnippet()}<span class="flex items-center gap-1.5"
                            ><Icon icon="mdi:blur" class="size-3.5" />毛玻璃强度</span
                        >{/snippet}
                    {#snippet captions()}<span>无</span><span>朦胧</span>{/snippet}
                </Slider>

                <Slider
                    label="背景深度"
                    value={surfaceStyle.depth}
                    min={0}
                    max={100}
                    step={1}
                    valueText="{surfaceStyle.depth}%"
                    oninput={(v) => updateSurface({ depth: v })}
                >
                    {#snippet labelSnippet()}<span class="flex items-center gap-1.5"
                            ><Icon icon="mdi:brightness-4" class="size-3.5" />背景深度</span
                        >{/snippet}
                    {#snippet captions()}<span>原色</span><span>{modeKey === 'light' ? '更白' : '更黑'}</span>{/snippet}
                </Slider>
            </div>

            <div
                class="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"
                style="border-color: var(--theme-divider-border);"
            >
                <Button variant="icon-text" size="none" bare onclick={resetSurface} class={ACTION_BTN}>
                    <Icon icon="mdi:restore" class="size-3.5" />
                    重置「{surfaceItem?.label}」
                </Button>
                <span class="text-[10px] leading-4 text-(--theme-modal-text)/40">
                    背景深度越大越接近{modeKey === 'light' ? '白' : '黑'}，毛玻璃背面同时变亮 / 变暗
                </span>
            </div>
        </div>
    </div>

    <!-- 背景图效果（无背景图时整块不出现） -->
    {#if activeThemeBg}
        <div class="mt-5">
            <SectionTitle>
                <Icon icon="mdi:image-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
                背景图效果
            </SectionTitle>
            <div class={mergeClass([CARD_SURFACE, 'px-3 py-3'])} style={CARD_STYLE}>
                <FieldLabel label="模糊与遮罩" hint="按黑夜 / 白天分别保存，只影响背景图本身，与区域质感互不影响" />
                <div
                    class="mt-3 grid grid-cols-1 gap-4 border-t pt-3 xl:grid-cols-2 xl:gap-x-6"
                    style="border-color: var(--theme-divider-border);"
                >
                    <Slider
                        label="背景图模糊"
                        value={appearance.bgImageBlur}
                        min={0}
                        max={32}
                        step={1}
                        valueText="{appearance.bgImageBlur}px"
                        oninput={(v) => updateBgEffect({ bgImageBlur: v })}
                    >
                        {#snippet labelSnippet()}<span class="flex items-center gap-1.5"
                                ><Icon icon="mdi:blur" class="size-3.5" />背景图模糊</span
                            >{/snippet}
                        {#snippet captions()}<span>清晰</span><span>朦胧</span>{/snippet}
                    </Slider>
                    <Slider
                        label="背景图遮罩"
                        value={appearance.bgImageMask}
                        min={BG_MASK_MIN}
                        max={BG_MASK_MAX}
                        step={1}
                        valueText={bgMaskLabel(appearance.bgImageMask)}
                        oninput={(v) => updateBgEffect({ bgImageMask: v })}
                    >
                        {#snippet labelSnippet()}<span class="flex items-center gap-1.5"
                                ><Icon icon="mdi:brightness-4" class="size-3.5" />背景图遮罩</span
                            >{/snippet}
                        {#snippet captions()}<span>全黑</span><span>压暗</span><span>原图</span><span>偏白</span><span
                                >极白</span
                            >{/snippet}
                    </Slider>
                </div>
            </div>
        </div>
    {/if}

    <!-- 标题栏颜色 -->
    <div class="mt-5">
        <SectionTitle>
            <Icon icon="mdi:monitor" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            标题栏颜色
        </SectionTitle>
        <SettingRow>
            <span
                class="sf-radius size-5 shrink-0 rounded-none border"
                style="background: var(--theme-titlebar-bg); border-color: var(--theme-divider-border);"
            ></span>
            <span class="min-w-0 flex-1 text-xs text-(--theme-modal-text)/70">
                跟随当前主题（{getActiveId() === 'light' ? '浅色' : '深色'}）自动适配，并同步浏览器标题栏颜色
            </span>
        </SettingRow>
    </div>

    <!-- 霓虹灯：字体 / 内阴影两档独立发光，默认都是 0px（关闭） -->
    <div class="mt-5">
        <SectionTitle>
            <Icon icon="mdi:star" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            霓虹灯
        </SectionTitle>
        <div class={mergeClass([CARD_SURFACE, 'px-3 py-3'])} style={CARD_STYLE}>
            <FieldLabel label="发光" hint="分别控制文字与内阴影的发光半径，都按当前配色发光；0 即关闭" />
            <div
                class="mt-3 grid grid-cols-1 gap-4 border-t pt-3 xl:grid-cols-2 xl:gap-x-6"
                style="border-color: var(--theme-divider-border);"
            >
                <Slider
                    label="霓虹灯字体"
                    ariaLabel="霓虹灯字体发光半径"
                    value={overrides.neonTextGlow}
                    min={0}
                    max={NEON_GLOW_MAX}
                    step={0.5}
                    valueText="{overrides.neonTextGlow}px"
                    oninput={(v) => void updateOverride('neonTextGlow', v)}
                >
                    {#snippet labelSnippet()}<span class="flex items-center gap-1.5"
                            ><Icon icon="mdi:format-text" class="size-3.5" />霓虹灯字体</span
                        >{/snippet}
                    {#snippet captions()}<span>关</span><span>{NEON_GLOW_MAX}px</span>{/snippet}
                </Slider>
                <Slider
                    label="霓虹灯内阴影"
                    ariaLabel="霓虹灯内阴影发光半径"
                    value={overrides.neonInsetGlow}
                    min={0}
                    max={NEON_GLOW_MAX}
                    step={0.5}
                    valueText="{overrides.neonInsetGlow}px"
                    oninput={(v) => void updateOverride('neonInsetGlow', v)}
                >
                    {#snippet labelSnippet()}<span class="flex items-center gap-1.5"
                            ><Icon icon="mdi:box-shadow" class="size-3.5" />霓虹灯内阴影</span
                        >{/snippet}
                    {#snippet captions()}<span>关</span><span>{NEON_GLOW_MAX}px</span>{/snippet}
                </Slider>
            </div>
        </div>
    </div>

    <!-- 圆角：统一作用于卡片 / 弹窗 / 小部件三类表面容器 -->
    <div class="mt-5">
        <SectionTitle>
            <Icon icon="mdi:rounded-corner" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            圆角
        </SectionTitle>
        <div class={mergeClass([CARD_SURFACE, 'px-3 py-3'])} style={CARD_STYLE}>
            <FieldLabel
                label="圆角程度"
                hint="统一作用于卡片、弹窗与小部件；表格的行与单元格始终保持直角，避免画成一排药丸"
            />
            <div class="mt-3 border-t pt-3" style="border-color: var(--theme-divider-border);">
                <Slider
                    label="圆角程度"
                    ariaLabel="表面圆角"
                    value={surfaceRadius}
                    min={0}
                    max={SURFACE_RADIUS_MAX}
                    step={1}
                    valueText="{surfaceRadius}px"
                    oninput={(v) => void updateOverride('surfaceRadius', v)}
                >
                    {#snippet labelSnippet()}<span>圆角程度</span>{/snippet}
                    {#snippet captions()}<span>直角</span><span>圆润</span>{/snippet}
                </Slider>
                <div class="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                        variant="icon-text"
                        size="none"
                        bare
                        keepDisabled
                        onclick={() => void updateOverride('surfaceRadius', DEFAULT_SURFACE_RADIUS)}
                        disabled={surfaceRadius === DEFAULT_SURFACE_RADIUS}
                        class={ACTION_BTN}
                    >
                        <Icon icon="mdi:restore" class="size-3.5" />
                        恢复默认（{DEFAULT_SURFACE_RADIUS}px）
                    </Button>
                    <span class="text-[10px] leading-4 text-(--theme-modal-text)/40">
                        默认 {DEFAULT_SURFACE_RADIUS}px；调成 0 即全部回到直角
                    </span>
                </div>
            </div>
        </div>
    </div>
</div>
