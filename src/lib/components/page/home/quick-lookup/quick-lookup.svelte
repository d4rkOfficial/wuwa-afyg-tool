<script lang="ts">
    /** @desc 速查弹窗：内容复用 QuickLookupContent，外壳（遮罩/关闭/层级/Esc）走 layout/modal.svelte */
    import type { CharSlot } from '$lib/types/project'
    import Icon from '@iconify/svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import QuickLookupContent from './quick-lookup-content.svelte'

    interface Props extends ComponentsProps {
        locked?: boolean
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        onCreateBuff?: (name: string) => void
        onCreateCustomHit?: (name: string) => void
        showBuffOption?: boolean
        showCustomHitOption?: boolean
        onclose: () => void
    }

    let {
        locked = false,
        open,
        team,
        onCreateBuff,
        onCreateCustomHit,
        showBuffOption = true,
        showCustomHitOption = true,
        onclose,
        class: className,
        style: styleProp
    }: Props = $props()
</script>

<!-- @desc 速查弹窗：外壳（遮罩/关闭按钮/Esc/层级）由 layout/modal.svelte 提供 -->
<Modal {open} {onclose} layer="deep" noScroll class={mergeClass(['w-full max-w-3xl', className])} style={styleProp}>
    {#snippet title()}
        <Icon icon="mdi:magnify" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>速查</span>
    {/snippet}
    <QuickLookupContent
        {locked}
        {team}
        {onCreateBuff}
        {onCreateCustomHit}
        {showBuffOption}
        {showCustomHitOption}
        {onclose}
    />
</Modal>
