<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from './modal.svelte'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props extends ComponentsProps {
        open: boolean
        title: string
        confirmText: string
        confirmLabel?: string
        hintSuffix?: string
        onclose?: () => void
        onconfirm?: () => void
    }

    let {
        open,
        title,
        confirmText,
        confirmLabel = '确认删除',
        hintSuffix = '以确认删除：',
        onclose,
        onconfirm,
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

    let input = $state('')

    $effect(() => {
        if (open) input = ''
    })

    function submit() {
        if (input.trim() !== confirmText) return
        onconfirm?.()
    }
</script>

<Modal {open} {onclose} backdropClose={false} class={className} style="width: min(92vw, 420px); {mergedStyle}">
    {#snippet title()}
        <div class="flex items-center gap-2 text-red-400">
            <Icon icon="mdi:alert-circle" class="size-5" />
            {title}
        </div>
    {/snippet}

    <div class="space-y-3">
        <p class="text-xs text-(--theme-modal-text)/50">
            请输入
            <button
                onclick={async () => {
                    await navigator.clipboard.writeText(confirmText).catch(() => {})
                    addToast(`已复制「${confirmText}」`, 'success')
                }}
                class="inline-flex items-center gap-0.5 font-semibold text-(--theme-accent-text) transition-colors hover:brightness-125"
                title="点击复制"
            >
                {confirmText}
                <Icon icon="mdi:content-copy" class="size-3" />
            </button>
            {hintSuffix}
        </p>
        <input
            bind:value={input}
            onkeydown={(e) => e.key === 'Enter' && submit()}
            placeholder={confirmText}
            class="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-(--theme-accent-bg)/50"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg); color: var(--theme-modal-text);"
        />
    </div>

    <div
        class="mt-4 flex items-center justify-end gap-2 border-t pt-3"
        style="border-color: var(--theme-divider-border);"
    >
        <button
            onclick={onclose}
            class="h-7 rounded-md px-3 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
            style="background: var(--theme-input-bg);"
        >
            取消
        </button>
        <button
            onclick={submit}
            disabled={input.trim() !== confirmText}
            class="inline-flex h-7 items-center gap-1 rounded-md border border-red-400 px-3 text-xs font-medium text-red-400 transition-all hover:bg-red-400/10 disabled:opacity-40 disabled:pointer-events-none"
        >
            <Icon icon="mdi:delete-outline" class="size-3.5" />
            {confirmLabel}
        </button>
    </div>
</Modal>
