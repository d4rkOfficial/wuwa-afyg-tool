<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import { getNamingRule, getSystemPrompt, loadGenPrefs, updateGenPrefs } from '$lib/data/ai-prefs.svelte'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props extends ComponentsProps {
        open: boolean
        kind: 'naming' | 'persona'
        onclose?: () => void
        onsaved?: () => void
    }

    let {
        open,
        kind,
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

    let draft = $state('')

    $effect(() => {
        if (open) {
            loadGenPrefs().then(() => {
                draft = kind === 'naming' ? getNamingRule() : getSystemPrompt()
            })
        }
    })

    const isNaming = $derived(kind === 'naming')

    async function handleSave() {
        if (isNaming) {
            await updateGenPrefs({ namingRule: draft })
        } else {
            await updateGenPrefs({ systemPrompt: draft })
        }
        addToast('提示词设置已保存', 'success')
        onsaved?.()
        onclose?.()
    }
</script>

<Modal {open} {onclose} backdropClose={false} class={className} style="width: min(92vw, 560px); {mergedStyle}">
    {#snippet title()}
        {isNaming ? '编辑 Buff 命名规则' : '编辑人设提示词'}
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
                class="inline-flex h-7 items-center gap-1.5 rounded-md px-4 text-xs font-medium transition-all hover:brightness-125"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
            >
                <Icon icon="mdi:content-save-outline" class="size-3.5" />
                保存
            </button>
        </div>
    {/snippet}

    <div class="flex flex-col gap-2">
        {#if isNaming}
            <textarea
                value={draft}
                oninput={(e) => (draft = (e.currentTarget as HTMLTextAreaElement).value)}
                rows="14"
                placeholder="生成 Buff 时按此规则命名；清空则每次生成前由 AI 询问你"
                class="w-full resize-y rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors"
                style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
            ></textarea>
            <p class="text-[10px] text-(--theme-modal-text)/40">
                默认采用工坊（share）端的命名风格；可自由改成你自己的规则
            </p>
        {:else}
            <textarea
                value={draft}
                oninput={(e) => (draft = (e.currentTarget as HTMLTextAreaElement).value)}
                rows="14"
                class="w-full resize-y rounded-lg border px-2.5 py-1.5 text-xs leading-relaxed outline-none transition-colors"
                style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
            ></textarea>
            <p class="text-[10px] text-(--theme-modal-text)/40">
                AI 助手的角色与行为规则（system prompt）；清空则使用默认人设
            </p>
        {/if}
    </div>
</Modal>
