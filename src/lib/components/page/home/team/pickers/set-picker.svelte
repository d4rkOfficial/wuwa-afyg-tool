<script lang="ts">
    import type { SelectedSet } from '$lib/types/project'
    import type { EchoSetItem } from '$lib/api/types'
    import type { ComponentsProps } from '$lib/types'
    import Icon from '@iconify/svelte'
    import { fallbackIcon } from '$lib/utils/icons'
    import { mergeClass } from '$lib/utils/component-style'
    import {
        MAX_SET_PIECES,
        canPickPiece,
        formatSetSelection,
        togglePieceSelection,
        totalPiecesOf
    } from '$lib/utils/set-selection'
    import EmptyState from '$lib/components/ui/empty-state.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import PickerFooter from './picker-footer.svelte'

    interface Props extends ComponentsProps {
        open: boolean
        onclose: () => void
        onconfirm: (sets: SelectedSet[]) => void
        echoSets: EchoSetItem[]
        pinnedSets: string[]
        initialSets: SelectedSet[]
        icons?: Record<string, string>
    }

    let {
        open,
        onclose,
        onconfirm,
        echoSets,
        pinnedSets,
        initialSets,
        icons = {},
        class: className,
        style: styleProp
    }: Props = $props()

    let selected = $state<SelectedSet[]>([])

    $effect(() => {
        if (open) selected = initialSets.map((s) => ({ ...s }))
    })

    /** @desc 有效件数 / 剩余部位 / 可点判定 / 切换 / 文案全部走 `$lib/utils/set-selection`（与 AI 工具同一口径） */
    let totalPieces = $derived(totalPiecesOf(selected))

    let pinnedList = $derived(
        pinnedSets.map((name) => echoSets.find((s) => s.name === name)).filter((s): s is EchoSetItem => s !== undefined)
    )
    let otherList = $derived(echoSets.filter((s) => !pinnedSets.includes(s.name)))

    function isSelected(name: string): SelectedSet | undefined {
        return selected.find((s) => s.name === name)
    }

    function isPieceSelected(name: string, pieces: number): boolean {
        return selected.some((s) => s.name === name && s.pieces === pieces)
    }

    function isPieceAvailable(name: string, pieces: number): boolean {
        return canPickPiece(selected, name, pieces)
    }

    function togglePiece(name: string, pieces: number) {
        selected = togglePieceSelection(selected, name, pieces)
    }

    function handleConfirm() {
        onconfirm(selected)
        onclose()
    }

    const formatSets = formatSetSelection
</script>

<Modal {open} {onclose} backdropClose class={mergeClass(['w-150 max-w-[90vw]', className])} style={styleProp}>
    {#snippet title()}
        <Icon icon="mdi:layers-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <h3>触发套装</h3>
    {/snippet}

    {#if pinnedList.length > 0}
        <div class="mb-2 text-xs font-black tracking-tight text-(--theme-modal-text)/70">首位声骸所属</div>
        <div class="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-4">
            {#each pinnedList as set (set.name)}
                <div
                    data-sf="widget"
                    data-sf-flat
                    class="flex flex-col gap-2 rounded-none border p-3"
                    style="--sf-base: var(--theme-input-bg); border-color: var(--theme-divider-border);"
                >
                    <div class="flex items-center gap-2 min-w-0">
                        {#if icons[set.name]}
                            <img
                                src={icons[set.name]}
                                alt={set.name}
                                class="size-8 shrink-0 rounded-none object-contain"
                            />
                        {/if}
                        <span class="min-w-0 truncate text-xs font-black">{set.name}</span>
                        <span
                            class="ml-auto shrink-0 rounded-none px-1.5 py-0.5 text-[10px] font-black"
                            style="background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent); color: var(--theme-accent-text);"
                            >首位所属</span
                        >
                    </div>
                    <div class="flex gap-1">
                        {#each set.pieces as piece (piece)}
                            <button
                                onclick={() => togglePiece(set.name, piece)}
                                disabled={!isPieceAvailable(set.name, piece)}
                                data-sf="widget"
                                data-sf-flat
                                class={mergeClass([
                                    'rounded-none border px-2.5 py-1 text-xs font-black transition-colors',
                                    isPieceSelected(set.name, piece)
                                        ? 'border-(--theme-accent-bg) bg-[color-mix(in_srgb,var(--theme-accent-bg)_15%,transparent)] text-(--theme-accent-text)'
                                        : 'border-(--theme-divider-border) text-(--theme-modal-text)/60 hover:border-(--theme-accent-bg) hover:text-(--theme-modal-text)',
                                    !isPieceAvailable(set.name, piece) && !isSelected(set.name)
                                        ? 'opacity-30 pointer-events-none'
                                        : ''
                                ])}
                                style="--sf-base: var(--theme-input-bg)"
                            >
                                {piece}件套
                            </button>
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
        <div class="my-3" style="border-top: 1px solid var(--theme-divider-border);"></div>
    {/if}

    {#if otherList.length === 0}
        <EmptyState size="md">无其他套装</EmptyState>
    {:else}
        <div class="mb-2 text-xs font-black tracking-tight text-(--theme-modal-text)/70">其它套装</div>
        <div class="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-4">
            {#each otherList as set (set.name)}
                <div
                    data-sf="widget"
                    data-sf-flat
                    class="flex flex-col gap-2 rounded-none border p-3"
                    style="--sf-base: var(--theme-input-bg); border-color: var(--theme-divider-border);"
                >
                    <div class="flex items-center gap-2 min-w-0">
                        {#if icons[set.name]}
                            <img
                                src={icons[set.name]}
                                alt={set.name}
                                use:fallbackIcon={'/icons/placeholder-echo-set.svg'}
                                class="size-8 shrink-0 rounded-none object-contain"
                            />
                        {/if}
                        <span class="min-w-0 truncate text-xs font-black">{set.name}</span>
                    </div>
                    <div class="flex gap-1">
                        {#each set.pieces as piece (piece)}
                            <button
                                onclick={() => togglePiece(set.name, piece)}
                                disabled={!isPieceAvailable(set.name, piece)}
                                data-sf="widget"
                                data-sf-flat
                                class={mergeClass([
                                    'rounded-none border px-2.5 py-1 text-xs font-black transition-colors',
                                    isPieceSelected(set.name, piece)
                                        ? 'border-(--theme-accent-bg) bg-[color-mix(in_srgb,var(--theme-accent-bg)_15%,transparent)] text-(--theme-accent-text)'
                                        : 'border-(--theme-divider-border) text-(--theme-modal-text)/60 hover:border-(--theme-accent-bg) hover:text-(--theme-modal-text)',
                                    !isPieceAvailable(set.name, piece) && !isSelected(set.name)
                                        ? 'opacity-30 pointer-events-none'
                                        : ''
                                ])}
                                style="--sf-base: var(--theme-input-bg)"
                            >
                                {piece}件套
                            </button>
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
    {#snippet footer()}
        <PickerFooter onconfirm={handleConfirm} center>
            {#snippet label()}确认 ({formatSets(selected)} = {totalPieces}/{MAX_SET_PIECES}){/snippet}
        </PickerFooter>
    {/snippet}
</Modal>
