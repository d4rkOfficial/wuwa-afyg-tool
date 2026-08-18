<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import { updateProfile, type AiProfile } from '$lib/ai/config.svelte'
    import { AI_PROVIDER_PRESETS, type AiProviderPreset } from '$lib/consts/ai-providers'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props extends ComponentsProps {
        open: boolean
        profile: AiProfile | null
        onclose?: () => void
        onsaved?: () => void
    }

    let {
        open,
        profile,
        onclose,
        onsaved,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp
    }: Props = $props()

    let mergedStyle = $derived(
        [
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )

    let draft = $state<AiProfile | null>(null)
    let providerPickerOpen = $state(false)
    let providerPickerAnchor = $state<HTMLElement | undefined>()

    $effect(() => {
        if (open && profile) {
            draft = { ...profile }
        }
    })

    // 点击图标按钮以外的区域时收起提供商弹层
    $effect(() => {
        if (!providerPickerOpen) return
        const onDown = (e: PointerEvent) => {
            if (providerPickerAnchor && !providerPickerAnchor.contains(e.target as Node)) providerPickerOpen = false
        }
        window.addEventListener('pointerdown', onDown, true)
        return () => window.removeEventListener('pointerdown', onDown, true)
    })

    const canSave = $derived(Boolean(draft && draft.label.trim() && draft.baseUrl.trim() && draft.model.trim()))

    /** @desc 当前填写的服务地址命中的提供商预设（按 origin 匹配），用于快捷端点高亮与 API Key 指引 */
    const matchedPreset = $derived.by(() => {
        if (!draft?.baseUrl) return undefined
        try {
            const origin = new URL(draft.baseUrl).origin
            return AI_PROVIDER_PRESETS.find((p) => {
                try {
                    return new URL(p.baseUrl).origin === origin
                } catch {
                    return false
                }
            })
        } catch {
            return undefined
        }
    })

    function setDraft(patch: Partial<AiProfile>) {
        if (!draft) return
        draft = { ...draft, ...patch }
    }

    /** @desc 快捷选择主流提供商：自动填入服务地址与模型示例 */
    function applyPreset(preset: AiProviderPreset) {
        setDraft({ baseUrl: preset.baseUrl, model: preset.modelHint })
        providerPickerOpen = false
    }

    async function handleSave() {
        if (!draft) return
        await updateProfile(draft.id, { ...draft })
        addToast('配置文件已保存', 'success')
        onsaved?.()
        onclose?.()
    }
</script>

<Modal {open} {onclose} backdropClose={false} class={className} style="width: min(92vw, 480px); {mergedStyle}">
    {#snippet title()}
        编辑配置文件
    {/snippet}

    {#snippet footer()}
        <div
            class="flex items-center justify-end gap-2 border-t pt-3"
            style="border-color: var(--theme-divider-border);"
        >
            <button
                onclick={onclose}
                class="h-7 rounded-md px-4 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                style="background: var(--theme-input-bg);"
            >
                取消
            </button>
            <button
                onclick={handleSave}
                disabled={!canSave}
                class="inline-flex h-7 items-center gap-1.5 rounded-md px-4 text-xs font-medium transition-all hover:brightness-125 disabled:opacity-40 disabled:pointer-events-none"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
            >
                <Icon icon="mdi:content-save-outline" class="size-3.5" />
                保存
            </button>
        </div>
    {/snippet}

    {#if draft}
        <div class="flex flex-col gap-3">
            <label class="block">
                <span class="mb-1 block text-xs text-(--theme-modal-text)/60">配置名</span>
                <input
                    type="text"
                    value={draft.label}
                    oninput={(e) => setDraft({ label: (e.currentTarget as HTMLInputElement).value })}
                    placeholder="如 本地 Ollama"
                    class="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors"
                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                />
            </label>
            <label class="block">
                <span class="mb-1 block text-xs text-(--theme-modal-text)/60">AI 服务地址</span>
                <div class="relative flex items-stretch gap-1.5" bind:this={providerPickerAnchor}>
                    <input
                        type="url"
                        value={draft.baseUrl}
                        oninput={(e) => setDraft({ baseUrl: (e.currentTarget as HTMLInputElement).value })}
                        placeholder="https://api.deepseek.com"
                        class="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors"
                        style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                    />
                    <button
                        type="button"
                        title="选择主流提供商预设"
                        onclick={() => (providerPickerOpen = !providerPickerOpen)}
                        class={[
                            'flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors',
                            providerPickerOpen
                                ? 'text-(--theme-accent-text)'
                                : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                        ].join(' ')}
                        style="background: var(--theme-input-bg); border-color: {providerPickerOpen
                            ? 'color-mix(in srgb, var(--theme-accent-bg) 40%, transparent)'
                            : 'var(--theme-divider-border)'};"
                    >
                        <Icon icon="mdi:view-grid-outline" class="size-4" />
                    </button>
                    {#if providerPickerOpen}
                        <div
                            class="animate-pop-in theme-scrollbar absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border py-1 shadow-xl"
                            style="background: color-mix(in srgb, var(--theme-modal-bg) 94%, transparent); border-color: var(--theme-divider-border);"
                        >
                            <div class="px-2.5 py-1 text-[10px] text-(--theme-modal-text)/40">
                                主流提供商（点击自动填入服务地址与模型示例）
                            </div>
                            {#each AI_PROVIDER_PRESETS as preset}
                                <button
                                    type="button"
                                    onclick={() => applyPreset(preset)}
                                    title={preset.baseUrl}
                                    class={[
                                        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                                        matchedPreset?.id === preset.id
                                            ? 'bg-(--theme-accent-bg)/10 text-(--theme-accent-text)'
                                            : 'text-(--theme-modal-text)/80 hover:bg-(--theme-input-bg)'
                                    ].join(' ')}
                                >
                                    <span class="min-w-0 flex-1 truncate text-xs">{preset.label}</span>
                                    <span class="max-w-[55%] truncate text-[10px] text-(--theme-modal-text)/35">
                                        {preset.baseUrl}
                                    </span>
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
                {#if matchedPreset?.guide}
                    <p class="mt-1 text-[10px] leading-relaxed text-(--theme-modal-text)/40">
                        {matchedPreset.guide}
                    </p>
                {/if}
            </label>
            <label class="block">
                <span class="mb-1 block text-xs text-(--theme-modal-text)/60">模型名</span>
                <input
                    type="text"
                    value={draft.model}
                    oninput={(e) => setDraft({ model: (e.currentTarget as HTMLInputElement).value })}
                    placeholder={matchedPreset?.modelHint ?? 'deepseek-v4-flash'}
                    class="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors"
                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                />
            </label>
            <label class="block">
                <span class="mb-1 block text-xs text-(--theme-modal-text)/60">AI API Key</span>
                <input
                    type="password"
                    value={draft.apiKey}
                    oninput={(e) => setDraft({ apiKey: (e.currentTarget as HTMLInputElement).value })}
                    placeholder="sk-..."
                    class="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors"
                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                />
                {#if matchedPreset}
                    <p class="mt-1 text-[10px] text-(--theme-modal-text)/40">
                        {#if matchedPreset.apiKeyHref}
                            API Key 在
                            <a
                                href={matchedPreset.apiKeyHref}
                                target="_blank"
                                rel="noreferrer"
                                class="text-(--theme-accent-text) hover:underline">{matchedPreset.apiKeyLabel}</a
                            >
                            获取
                        {:else}
                            {matchedPreset.apiKeyLabel}
                        {/if}
                    </p>
                {/if}
            </label>
            <div>
                <span class="mb-1 block text-xs text-(--theme-modal-text)/60">思考强度</span>
                <div class="flex flex-wrap gap-1">
                    {#each ['low', 'medium', 'high'] as level}
                        <button
                            onclick={() => setDraft({ reasoningEffort: level as AiProfile['reasoningEffort'] })}
                            class="rounded-md px-2 py-1 text-[10px] transition-colors {draft.reasoningEffort === level
                                ? 'text-(--theme-accent-text)'
                                : 'text-(--theme-modal-text)/60'}"
                            style="background: color-mix(in srgb, var(--theme-accent-bg) {draft.reasoningEffort ===
                            level
                                ? '14%'
                                : '0%'}, transparent);"
                        >
                            {level === 'low' ? '低' : level === 'medium' ? '中' : '高'}
                        </button>
                    {/each}
                </div>
            </div>
        </div>
    {/if}
</Modal>
