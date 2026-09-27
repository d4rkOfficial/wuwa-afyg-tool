<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import { getSystemPrompt, loadGenPrefs, updateGenPrefs } from '$lib/data/ai-prefs.svelte'
    import { DEFAULT_SYSTEM_PROMPT } from '$lib/ai/persona'
    import { addToast } from '$lib/data/toast.svelte'
    import ToolPicker from '$lib/components/layout/tool-picker.svelte'
    import { insertTextAt } from '$lib/utils/text-insert'

    /** @desc 人设提示词编辑弹窗（Buff 命名规则 / 黑话词典已迁为内置技能卡，在「技能」里编辑）。 */
    interface Props extends ComponentsProps {
        open: boolean
        onclose?: () => void
        onsaved?: () => void
    }

    let { open, onclose, onsaved, backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

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
    let textareaEl = $state<HTMLTextAreaElement | null>(null)

    const hintText = 'AI 助手的角色与行为规则（system prompt）；清空则使用默认人设'

    $effect(() => {
        if (open) {
            loadGenPrefs().then(() => {
                draft = getSystemPrompt()
            })
        }
    })

    async function handleSave() {
        await updateGenPrefs({ systemPrompt: draft })
        addToast('提示词设置已保存', 'success')
        onsaved?.()
        onclose?.()
    }

    function insertTool(name: string) {
        const ta = textareaEl
        const start = ta?.selectionStart
        const end = ta?.selectionEnd
        const next = insertTextAt(draft, name, start, end)
        draft = next.text
        requestAnimationFrame(() => {
            ta?.focus()
            ta?.setSelectionRange(next.cursor, next.cursor)
        })
    }
</script>

<Modal {open} {onclose} backdropClose={false} class={className} style="width: min(96vw, 1180px); {mergedStyle}">
    {#snippet title()}
        <Icon icon="mdi:toolbox-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span class="font-black tracking-tight">编辑人设提示词</span>
    {/snippet}

    {#snippet footer()}
        <div
            class="flex items-center justify-between gap-2 border-t pt-3"
            style="border-color: var(--theme-divider-border);"
        >
            <button
                onclick={() => (draft = DEFAULT_SYSTEM_PROMPT)}
                title="恢复为默认内容（保存后生效）"
                class="inline-flex h-7 items-center gap-1.5 rounded-none border px-2.5 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                style="border-color: var(--theme-divider-border);"
            >
                <Icon icon="mdi:restore" class="size-3" />
                恢复默认
            </button>
            <div class="flex items-center gap-2">
                <button
                    onclick={onclose}
                    class="inline-flex h-7 items-center rounded-none border px-2.5 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                    style="border-color: var(--theme-divider-border);"
                >
                    取消
                </button>
                <button
                    onclick={handleSave}
                    class="inline-flex h-7 items-center gap-1.5 rounded-none px-2.5 text-[10px] font-medium transition-all hover:brightness-110"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                >
                    <Icon icon="mdi:content-save-outline" class="size-3" />
                    保存
                </button>
            </div>
        </div>
    {/snippet}

    <div class="flex gap-3">
        <div class="flex min-w-0 flex-1 flex-col gap-2">
            <textarea
                bind:this={textareaEl}
                value={draft}
                oninput={(e) => (draft = (e.currentTarget as HTMLTextAreaElement).value)}
                rows="22"
                placeholder={hintText}
                class="theme-scrollbar w-full flex-1 resize-y rounded-none border px-2.5 py-1.5 text-xs leading-relaxed outline-none transition-colors"
                style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
            ></textarea>
            <p class="text-[10px] text-(--theme-modal-text)/40">{hintText}</p>
        </div>

        <!-- 可调用工具列表（与技能编辑弹窗共用 ToolPicker） -->
        <ToolPicker onpick={insertTool} />
    </div>
</Modal>
