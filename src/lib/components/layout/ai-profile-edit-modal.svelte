<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import { updateProfile, type AiProfile } from '$lib/ai/config.svelte'
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

    $effect(() => {
        if (open && profile) {
            draft = { ...profile }
        }
    })

    const canSave = $derived(Boolean(draft && draft.label.trim() && draft.baseUrl.trim() && draft.model.trim()))

    function isDeepSeekBaseUrl(url: string): boolean {
        try {
            return new URL(url).host === 'api.deepseek.com'
        } catch {
            return false
        }
    }

    function isOpencodeBaseUrl(url: string): boolean {
        try {
            return new URL(url).host === 'opencode.ai'
        } catch {
            return false
        }
    }

    function setDraft(patch: Partial<AiProfile>) {
        if (!draft) return
        draft = { ...draft, ...patch }
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
                <input
                    type="url"
                    value={draft.baseUrl}
                    oninput={(e) => setDraft({ baseUrl: (e.currentTarget as HTMLInputElement).value })}
                    placeholder="https://api.deepseek.com"
                    class="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors"
                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                />
            </label>
            <label class="block">
                <span class="mb-1 block text-xs text-(--theme-modal-text)/60">模型名</span>
                <input
                    type="text"
                    value={draft.model}
                    oninput={(e) => setDraft({ model: (e.currentTarget as HTMLInputElement).value })}
                    placeholder="deepseek-v4-flash"
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
                {#if isDeepSeekBaseUrl(draft.baseUrl)}
                    <p class="mt-1 text-[10px] text-(--theme-modal-text)/40">
                        API Key 在
                        <a
                            href="https://platform.deepseek.com"
                            target="_blank"
                            rel="noreferrer"
                            class="text-(--theme-accent-text) hover:underline">DeepSeek 开放平台</a
                        >
                        获取
                    </p>
                {:else if isOpencodeBaseUrl(draft.baseUrl)}
                    <p class="mt-1 text-[10px] text-(--theme-modal-text)/40">
                        API Key 在
                        <a
                            href="https://opencode.ai/auth"
                            target="_blank"
                            rel="noreferrer"
                            class="text-(--theme-accent-text) hover:underline">opencode Workspace</a
                        >
                        获取
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
