<script lang="ts">
    import type { ComponentsProps } from '$lib/types'
    import { getHelpState, closeHelp } from '$lib/data/help.svelte'
    import Icon from '@iconify/svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {}

    let { class: className, style: styleProp }: Props = $props()

    let state = $derived(getHelpState())
</script>

<Modal
    open={state.open}
    onclose={closeHelp}
    backdropClose
    layer="nested"
    class={mergeClass(['w-[90vw] max-w-4xl', className])}
    style={styleProp}
>
    {#snippet title()}
        {#if state.title}
            <Icon icon="mdi:help-circle-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <span>{state.title}</span>
        {/if}
    {/snippet}
    {#each state.items as item (item.name)}
        <div
            class="mb-3 rounded-none border p-3 last:mb-0"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <div class="text-sm font-black tracking-tight text-(--theme-modal-text)">{item.name}</div>
            <div class="mt-0.5 mb-1 text-xs text-(--theme-modal-text)/70">{item.description}</div>
            <div class="text-xs leading-relaxed text-(--theme-modal-text)/40">{item.content}</div>
        </div>
    {/each}
</Modal>
