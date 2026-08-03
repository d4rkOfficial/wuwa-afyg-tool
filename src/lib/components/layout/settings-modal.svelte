<script lang="ts">
    import { getActiveId, getOverrides, updateOverride } from '$lib/theme'
    import Icon from '@iconify/svelte'
    import {
        getKeyMapEntries,
        updateKeyMapEntry,
        resetKeyMap,
        physicalLabel,
        type KeyMapEntry
    } from '$lib/data/keymap.svelte'
    import { getUiBtnIcons } from '$lib/data/api'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        getWorkshopInstances,
        getActiveWorkshopId,
        setActiveWorkshop,
        addWorkshop,
        removeWorkshop,
        resetWorkshop
    } from '$lib/data/workshop.svelte'

    interface Props {
        open: boolean
        onclose: () => void
    }

    let { open, onclose }: Props = $props()

    let tab = $state<'theme' | 'keymap' | 'workshop'>('theme')

    const SETTING_TABS = [
        { key: 'theme', label: '主题', icon: 'mdi:palette-outline' },
        { key: 'keymap', label: '按键绑定', icon: 'mdi:keyboard-outline' },
        { key: 'workshop', label: '工坊设置', icon: 'mdi:storefront-outline' }
    ] as const

    const COLOR_PRESETS = [
        { name: '默认', hue: null as number | 'mono' | null },
        { name: '品红', hue: 330 as number | 'mono' | null },
        { name: '黑白', hue: 'mono' as const }
    ]

    let fileInput: HTMLInputElement | undefined = $state()
    let bgUrl = $state('')

    let overrides = $derived(getOverrides())
    let isDark = $derived(getActiveId() !== 'light')

    $effect(() => {
        if (open) {
            bgUrl = overrides.backgroundImage.startsWith('http') ? overrides.backgroundImage : ''
        }
    })

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

    function handleFileSelect(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
            updateOverride('backgroundImage', reader.result as string)
            bgUrl = ''
        }
        reader.readAsDataURL(file)
    }

    function handleUrlApply() {
        const url = bgUrl.trim()
        if (url) {
            updateOverride('backgroundImage', url)
        }
    }

    function clearBackground() {
        updateOverride('backgroundImage', '')
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
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5))"
        onclick={(e) => {
            if (e.target === e.currentTarget) onclose()
        }}
        onkeydown={(e) => {
            if (e.key === 'Escape') onclose()
        }}
    >
        <div
            class="relative flex h-[560px] w-[640px] max-h-[90vh] max-w-[94vw] flex-col overflow-hidden rounded-xl shadow-2xl"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
            role="dialog"
            aria-modal="true"
        >
            <div
                class="flex shrink-0 items-center justify-between border-b px-6 py-4"
                style="border-color: var(--theme-divider-border);"
            >
                <h3 class="text-base font-semibold">设置</h3>
                <button
                    onclick={onclose}
                    class="rounded p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70"
                >
                    <Icon icon="mdi:close" class="size-4.5" />
                </button>
            </div>

            <div class="flex min-h-0 flex-1">
                <!-- Sidebar -->
                <div
                    class="flex w-40 shrink-0 flex-col gap-1 border-r p-3"
                    style="border-color: var(--theme-divider-border);"
                >
                    {#each SETTING_TABS as t}
                        <button
                            onclick={() => (tab = t.key)}
                            class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors {tab ===
                            t.key
                                ? 'text-[var(--theme-accent-text-on-bg)]'
                                : 'text-(--theme-modal-text)/60 hover:text-(--theme-modal-text)'}"
                            style={tab === t.key ? 'background: var(--theme-accent-bg);' : ''}
                        >
                            <Icon icon={t.icon} class="size-4 shrink-0" />
                            {t.label}
                        </button>
                    {/each}
                </div>

                <!-- Content -->
                <div class="min-w-0 flex-1 overflow-y-auto p-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {#if tab === 'theme'}
                        <!-- Accent color -->
                        <div class="mb-5">
                            <span class="mb-3 block text-xs font-medium text-(--theme-modal-text)/60">主色调</span>
                            <div class="grid grid-cols-3 gap-2">
                                {#each COLOR_PRESETS as c}
                                    {@const style = getPresetStyle(c.hue)}
                                    <button
                                        onclick={() => updateOverride('accentHue', c.hue)}
                                        class={`flex flex-col items-center gap-1 rounded-lg p-2 transition-all ${overrides.accentHue === c.hue ? (isDark ? 'ring-2 ring-white/60' : 'ring-2 ring-black/40') : ''}`}
                                        style="background: {style.bg};"
                                    >
                                        <span class="text-[10px] font-medium" style="color: {style.text};"
                                            >{c.name}</span
                                        >
                                    </button>
                                {/each}
                            </div>
                        </div>

                        <hr class="mb-5" style="border-color: var(--theme-divider-border);" />

                        <!-- Background opacity slider -->
                        <div class="mb-5">
                            <span
                                class="mb-3 flex items-center justify-between text-xs font-medium text-(--theme-modal-text)/60"
                            >
                                <span>背景透明度</span>
                                <span class="font-mono text-(--theme-accent-text)">{overrides.bgOpacity}%</span>
                            </span>
                            <input
                                type="range"
                                min="50"
                                max="100"
                                value={overrides.bgOpacity}
                                oninput={(e) =>
                                    updateOverride('bgOpacity', Number((e.target as HTMLInputElement).value))}
                                class="w-full h-2 rounded-full appearance-none cursor-pointer touch-none bg-(--theme-modal-text)/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white/80 [&::-webkit-slider-thumb]:bg-(--theme-accent-bg) [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white/80 [&::-moz-range-thumb]:bg-(--theme-accent-bg) [&::-moz-range-thumb]:shadow-md"
                            />
                            <div class="mt-1 flex justify-between text-[10px] text-(--theme-modal-text)/30">
                                <span>半透明</span>
                                <span>不透明</span>
                            </div>
                        </div>

                        <!-- Background blur slider -->
                        <div class="mb-5">
                            <span
                                class="mb-3 flex items-center justify-between text-xs font-medium text-(--theme-modal-text)/60"
                            >
                                <span>背景模糊</span>
                                <span class="font-mono text-(--theme-accent-text)">{overrides.bgBlur}px</span>
                            </span>
                            <input
                                type="range"
                                min="0"
                                max="20"
                                step="1"
                                value={overrides.bgBlur}
                                disabled={!overrides.backgroundImage}
                                oninput={(e) => updateOverride('bgBlur', Number((e.target as HTMLInputElement).value))}
                                class="w-full h-2 rounded-full appearance-none cursor-pointer touch-none bg-(--theme-modal-text)/10 disabled:cursor-not-allowed disabled:opacity-40 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white/80 [&::-webkit-slider-thumb]:bg-(--theme-accent-bg) [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white/80 [&::-moz-range-thumb]:bg-(--theme-accent-bg) [&::-moz-range-thumb]:shadow-md"
                            />
                            <div class="mt-1 flex justify-between text-[10px] text-(--theme-modal-text)/30">
                                <span>无</span>
                                <span>强</span>
                            </div>
                            {#if !overrides.backgroundImage}
                                <div class="mt-1 text-[10px] text-(--theme-modal-text)/40">需先设置背景图才能生效</div>
                            {/if}
                        </div>

                        <hr class="mb-5" style="border-color: var(--theme-divider-border);" />

                        <!-- Background image -->
                        <div>
                            <span class="mb-3 block text-xs font-medium text-(--theme-modal-text)/60">背景图</span>

                            {#if overrides.backgroundImage}
                                <div
                                    class="mb-3 overflow-hidden rounded-lg border"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <img
                                        src={overrides.backgroundImage}
                                        alt="背景预览"
                                        class="h-32 w-full object-cover"
                                    />
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
                                    class="mb-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 transition-colors hover:bg-(--theme-modal-text)/5"
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
                                class="flex items-center gap-2 rounded-lg border px-3 py-2"
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
                                    class="shrink-0 rounded px-2.5 py-1 text-xs font-medium transition-all hover:brightness-125 disabled:opacity-40"
                                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                                >
                                    加载
                                </button>
                            </div>
                        </div>
                    {:else if tab === 'keymap'}
                        <!-- Key mapping -->
                        <div>
                            <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60">按键绑定</span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                每行决定排轴时操作块显示的按键图标；快捷键固定（快速排轴 1/2/3 仍用于切换角色）
                            </p>
                            <div class="flex flex-col gap-2">
                                {#each keymapEntries as entry}
                                    <div
                                        class="flex items-center gap-2 rounded-lg border px-2.5 py-2"
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
                                                <span class="text-[10px] font-bold text-(--theme-modal-text)/60"
                                                    >{entry.blockKey}</span
                                                >
                                            {/if}
                                        </span>
                                        <input
                                            value={entry.label}
                                            onchange={(e) =>
                                                updateEntry(entry.id, { label: (e.target as HTMLInputElement).value })}
                                            class="min-w-0 flex-1 bg-transparent text-xs text-(--theme-modal-text) outline-none placeholder:text-(--theme-modal-text)/30"
                                        />
                                        <span
                                            class="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] text-(--theme-modal-text)/60"
                                            style="border-color: var(--theme-divider-border);"
                                            title="快捷键"
                                        >
                                            {physicalLabel(entry.physical)}
                                        </span>
                                        <button
                                            onclick={() => (keyPickerFor = entry.id)}
                                            class="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium transition-all hover:brightness-125"
                                            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                                        >
                                            选择自定义key
                                        </button>
                                    </div>
                                {/each}
                            </div>
                            <div class="mt-3 flex items-center gap-2">
                                <button
                                    onclick={() => resetKeyMap()}
                                    class="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:restore" class="size-3.5" />
                                    恢复默认
                                </button>
                            </div>
                        </div>
                    {:else}
                        <!-- Workshop settings -->
                        <div>
                            <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60">工坊设置</span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                配置椰果工坊实例；单选使用，可删除或新增，分享与工坊列表将使用当前选中实例
                            </p>
                            <div class="flex flex-col gap-2">
                                {#each workshopInstances as inst}
                                    <div
                                        class="flex items-center gap-2 rounded-lg border px-2.5 py-2"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <button
                                            onclick={() => handleSwitchWorkshop(inst.id)}
                                            class="flex min-w-0 flex-1 items-center gap-2 text-left"
                                            title="选中该实例"
                                        >
                                            <Icon
                                                icon={inst.id === workshopActiveId
                                                    ? 'mdi:radiobox-marked'
                                                    : 'mdi:radiobox-blank'}
                                                class="size-4 shrink-0 text-(--theme-accent-text)"
                                            />
                                            <span class="truncate text-xs text-(--theme-modal-text)">{inst.url}</span>
                                        </button>
                                        {#if workshopInstances.length > 1}
                                            <button
                                                onclick={() => handleRemoveWorkshop(inst.id)}
                                                class="shrink-0 rounded p-1 text-(--theme-modal-text)/40 transition-colors hover:text-red-500"
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
                                    class="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none placeholder:text-(--theme-modal-text)/30"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                />
                                <button
                                    onclick={handleAddWorkshop}
                                    class="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all hover:brightness-125"
                                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                                >
                                    <Icon icon="mdi:plus" class="size-3.5" />
                                    添加
                                </button>
                            </div>
                            <div class="mt-3">
                                <button
                                    onclick={handleResetWorkshop}
                                    class="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:restore" class="size-3.5" />
                                    恢复默认
                                </button>
                            </div>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>

    <!-- Key picker -->
    {#if keyPickerFor}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="fixed inset-0 z-[70] flex items-center justify-center backdrop-blur-sm"
            style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
            onclick={() => (keyPickerFor = null)}
        >
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="max-h-[75vh] w-[92vw] max-w-lg overflow-y-auto rounded-xl border p-4"
                style="background: var(--theme-modal-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                onclick={(e) => e.stopPropagation()}
            >
                <div class="mb-3 flex items-center justify-between">
                    <span class="text-sm font-semibold">选择按键</span>
                    <button
                        onclick={() => (keyPickerFor = null)}
                        class="rounded p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70"
                    >
                        <Icon icon="mdi:close" class="size-4.5" />
                    </button>
                </div>
                <div class="flex flex-wrap gap-1.5">
                    {#each uiBtnIconList as [name, url]}
                        <button
                            onclick={() => {
                                updateEntry(keyPickerFor!, { blockKey: name })
                                keyPickerFor = null
                            }}
                            class="flex size-10 items-center justify-center rounded-md border transition-colors {keyPickerFor &&
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
            </div>
        </div>
    {/if}
{/if}
