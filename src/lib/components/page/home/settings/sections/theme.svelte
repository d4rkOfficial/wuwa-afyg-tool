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
     */
    import Icon from '@iconify/svelte'
    import Slider from '$lib/components/ui/slider.svelte'
    import FieldLabel from '$lib/components/ui/field-label.svelte'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import {
        bgMaskCss,
        bgMaskLabel,
        BG_MASK_MAX,
        BG_MASK_MIN,
        defaultSurfaceStyle,
        getActiveId,
        getAppearance,
        getOverrides,
        getSurfaceStyle,
        getThemes,
        setActiveTheme,
        setBgImageEffect,
        setSurfaceStyle,
        SURFACE_GROUPS,
        updateOverride,
        type SurfaceStyle,
        type ThemeMode
    } from '$lib/theme'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        getBgEditingLight,
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

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    let currentTheme = $derived(getActiveId())
    let overrides = $derived(getOverrides())
    let isDark = $derived(getActiveId() !== 'light')

    let bgEditingLight = $derived(getBgEditingLight())
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

    /** @desc 背景图「黑夜 / 白天」两段（编辑目标，不是主题本身）；顺序与改造前一致 */
    const BG_MODE_TABS = [
        { value: 'dark', label: '黑夜' },
        { value: 'light', label: '白天' }
    ]
    /** @desc 「当前正在生效的那张」标记：改成分段 `suffix`（原来的小字 + 60% 不透明度原样保留） */
    const bgModeTabs = $derived(
        BG_MODE_TABS.map((m) => ((currentTheme === 'light') === (m.value === 'light') ? { ...m, suffix: '当前' } : m))
    )
    const pickBgMode = (value: string) => {
        const light = value === 'light'
        setBgEditingLight(light)
        if (fileInput) fileInput.value = ''
        const next = light ? overrides.backgroundImageLight : overrides.backgroundImage
        setBgUrl(next.startsWith('http') ? next : '')
    }

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

    let fileInput: HTMLInputElement | undefined = $state()

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
    <div class="mb-5">
        <span class="mb-3 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)">
            <Icon icon="mdi:palette-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            主色调
        </span>
        <!-- T15：7 段等宽文字 tab；指示块底色 / 选中项文字取当前预设自身的颜色（与改造前选中按钮同色） -->
        <Tabs
            items={ACCENT_TABS}
            value={accentKey}
            onchange={pickAccent}
            compact
            backgroundImage={accentStyle.bg}
            textColor={accentStyle.text}
        />
    </div>

    <!-- 昼夜切换 -->
    <div class="mb-5">
        <span class="mb-3 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)">
            <Icon icon="mdi:theme-light-dark" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            昼夜切换
        </span>
        <div
            class="flex items-center justify-between gap-3 rounded-none border px-2.5 py-2"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <div class="min-w-0">
                <span class="block text-[11px] text-(--theme-modal-text)/60">主题模式</span>
                <span class="block text-[9px] text-(--theme-modal-text)/35">与侧边栏按钮一致，全局明暗切换</span>
            </div>
            <!-- T15：原来的手搓小号 switch 只能「翻转」，两段说不出各自是什么；改为等宽文字 tab -->
            <Tabs
                items={THEME_MODE_TABS}
                value={currentTheme}
                onchange={pickThemeMode}
                compact
                class="w-44 shrink-0"
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg)"
            />
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
                <FieldLabel label="背景图" />
                <span class="block text-[10px] text-(--theme-modal-text)/35"
                    >白天与黑夜可各设一张；模糊/遮罩/暗度为两者共用</span
                >
            </div>
        </div>

        <!-- 白天 / 黑夜 切换：切换正在编辑的那张背景图（T15：两段文字 tab，「当前」标记为分段 suffix） -->
        <Tabs
            items={bgModeTabs}
            value={bgEditingLight ? 'light' : 'dark'}
            onchange={pickBgMode}
            compact
            class="mb-3"
            backgroundImage="var(--theme-accent-bg)"
            textColor="var(--theme-accent-text-on-bg)"
        />

        {#if editingBg}
            <div class="mb-3 overflow-hidden rounded-none border" style="border-color: var(--theme-divider-border);">
                <img src={editingBg} alt="背景预览" class="h-28 w-full object-cover" />
                <div class="flex items-center justify-end gap-2 px-3 py-2 bg-(--theme-modal-text)/5">
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

        <input type="file" accept="image/*" bind:this={fileInput} onchange={handleFileSelect} class="hidden" />

        <div
            class="flex items-center gap-2 rounded-none border px-3 py-2"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <input
                type="text"
                value={bgUrl}
                oninput={(e) => setBgUrl((e.target as HTMLInputElement).value)}
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
            <div class="relative h-40 overflow-hidden border-b" style="border-color: var(--theme-divider-border);">
                {#if editingBg}
                    <!-- 背景图独立层（自身模糊，不影响上层的预览卡片） -->
                    <div
                        class="absolute inset-0"
                        style="background-image: url('{editingBg}'); background-position: center; background-size: cover; filter: blur({appearance.bgImageBlur}px);"
                    ></div>
                    <!-- 背景图遮罩层（与工作区一致，由当前昼夜的背景图遮罩控制） -->
                    <div class="absolute inset-0" style="background: {maskPreview(appearance.bgImageMask)};"></div>
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
                        <FieldLabel label="背景质感" />
                        <span class="block text-[10px] leading-4 text-(--theme-modal-text)/35"
                            >预览与工作区同步更新</span
                        >
                    </div>
                </div>

                <p class="mb-3 text-[10px] leading-4 text-(--theme-modal-text)/35">
                    按昼夜分别保存；当前编辑「{modeKey === 'light' ? '白天' : '黑夜'}
                    」主题。六类区域可各自设置不透明度 / 毛玻璃强度 / 背景深度
                </p>

                <!-- 区域选择（T15：六段等宽文字 tab，逐段 title 保留原来的区域说明） -->
                <Tabs
                    items={SURFACE_TABS}
                    value={surfaceKey}
                    onchange={pickSurface}
                    compact
                    class="mb-2"
                    backgroundImage="var(--theme-accent-bg)"
                    textColor="var(--theme-accent-text-on-bg)"
                />
                <p class="mb-3 text-[10px] leading-4 text-(--theme-modal-text)/35">
                    {SURFACE_GROUPS[0].items.find((i) => i.key === surfaceKey)?.hint}
                </p>

                <div class="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-x-6">
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
                        {#snippet captions()}<span>原色</span><span>{modeKey === 'light' ? '更白' : '更黑'}</span
                            >{/snippet}
                    </Slider>
                </div>

                <div class="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        onclick={resetSurface}
                        class="inline-flex items-center gap-1 rounded-none border px-2 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <Icon icon="mdi:restore" class="size-3" />
                        重置「{SURFACE_GROUPS[0].items.find((i) => i.key === surfaceKey)?.label}」
                    </button>
                    <span class="text-[10px] leading-4 text-(--theme-modal-text)/35">
                        背景深度越大越接近{modeKey === 'light' ? '白' : '黑'}
                        ；同时作用于毛玻璃背面明暗
                    </span>
                </div>

                {#if activeThemeBg}
                    <div class="border-t pt-4" style="border-color: var(--theme-divider-border);">
                        <div class="mb-3 flex items-start gap-2.5">
                            <span
                                class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-none bg-(--theme-modal-text)/5 text-(--theme-modal-text)/45"
                            >
                                <Icon icon="mdi:image-outline" class="size-4" />
                            </span>
                            <div>
                                <FieldLabel label="背景图效果" />
                                <span class="block text-[10px] leading-4 text-(--theme-modal-text)/35"
                                    >按昼夜分别保存，仅作用于背景图本身，与区域质感互不影响</span
                                >
                            </div>
                        </div>
                        <div class="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-x-6">
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
                                {#snippet captions()}<span>全黑</span><span>压暗</span><span>原图</span><span>偏白</span
                                    ><span>极白</span>{/snippet}
                            </Slider>
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
                    <FieldLabel label="标题栏颜色" />
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
                    <FieldLabel label="霓虹灯字体" />
                    <span class="block text-[10px] text-(--theme-modal-text)/35">所有文本与图标以当前颜色发光</span>
                </div>
            </div>
            <div
                class="rounded-none border p-3"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                <Slider
                    label="发光强度"
                    ariaLabel="霓虹灯强度"
                    value={overrides.neonText}
                    min={0}
                    max={100}
                    step={1}
                    valueText="{overrides.neonText}%"
                    oninput={(v) => updateOverride('neonText', v)}
                >
                    {#snippet labelSnippet()}<span>发光强度</span>{/snippet}
                    {#snippet captions()}<span>关</span><span>强烈</span>{/snippet}
                </Slider>
            </div>
        </div>
    </div>
</div>
