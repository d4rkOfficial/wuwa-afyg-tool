<script lang="ts">
    import { getActiveId, getOverrides, updateOverride } from '$lib/theme'
    import Icon from '@iconify/svelte'

    interface Props {
        open: boolean
        onclose: () => void
    }

    let { open, onclose }: Props = $props()

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
            class="relative w-full max-w-sm rounded-xl p-6 shadow-2xl"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
            role="dialog"
            aria-modal="true"
        >
            <button
                onclick={onclose}
                class="absolute right-3 top-3 rounded p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70"
            >
                <Icon icon="mdi:close" class="size-4.5" />
            </button>

            <h3 class="mb-5 pr-6 text-base font-semibold">主题定制</h3>

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
                            <span class="text-[10px] font-medium" style="color: {style.text};">{c.name}</span>
                        </button>
                    {/each}
                </div>
            </div>

            <hr class="mb-5" style="border-color: var(--theme-divider-border);" />

            <!-- Background opacity slider -->
            <div class="mb-5">
                <span class="mb-3 flex items-center justify-between text-xs font-medium text-(--theme-modal-text)/60">
                    <span>背景透明度</span>
                    <span class="font-mono text-(--theme-accent-text)">{overrides.bgOpacity}%</span>
                </span>
                <input
                    type="range"
                    min="50"
                    max="100"
                    value={overrides.bgOpacity}
                    oninput={(e) => updateOverride('bgOpacity', Number((e.target as HTMLInputElement).value))}
                    class="w-full h-2 rounded-full appearance-none cursor-pointer touch-none bg-(--theme-modal-text)/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white/80 [&::-webkit-slider-thumb]:bg-(--theme-accent-bg) [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white/80 [&::-moz-range-thumb]:bg-(--theme-accent-bg) [&::-moz-range-thumb]:shadow-md"
                />
                <div class="mt-1 flex justify-between text-[10px] text-(--theme-modal-text)/30">
                    <span>半透明</span>
                    <span>不透明</span>
                </div>
            </div>

            <!-- Background blur slider -->
            <div class="mb-5">
                <span class="mb-3 flex items-center justify-between text-xs font-medium text-(--theme-modal-text)/60">
                    <span>背景模糊</span>
                    <span class="font-mono text-(--theme-accent-text)">{overrides.bgBlur}px</span>
                </span>
                <input
                    type="range"
                    min="0"
                    max="20"
                    step="1"
                    value={overrides.bgBlur}
                    oninput={(e) => updateOverride('bgBlur', Number((e.target as HTMLInputElement).value))}
                    class="w-full h-2 rounded-full appearance-none cursor-pointer touch-none bg-(--theme-modal-text)/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white/80 [&::-webkit-slider-thumb]:bg-(--theme-accent-bg) [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white/80 [&::-moz-range-thumb]:bg-(--theme-accent-bg) [&::-moz-range-thumb]:shadow-md"
                />
                <div class="mt-1 flex justify-between text-[10px] text-(--theme-modal-text)/30">
                    <span>无</span>
                    <span>强</span>
                </div>
            </div>

            <hr class="mb-5" style="border-color: var(--theme-divider-border);" />

            <!-- Background image -->
            <div>
                <span class="mb-3 block text-xs font-medium text-(--theme-modal-text)/60">背景图</span>

                {#if overrides.backgroundImage}
                    <div class="mb-3 overflow-hidden rounded-lg border" style="border-color: var(--theme-divider-border);">
                        <img src={overrides.backgroundImage} alt="背景预览" class="h-32 w-full object-cover" />
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
                        style="background: var(--theme-btn-bg); color: var(--theme-btn-text);"
                    >
                        加载
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}
