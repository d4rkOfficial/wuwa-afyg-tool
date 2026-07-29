<script lang="ts">
    import type { SelectedSet } from '$lib/data/types'
    import type { EchoSetItem } from '$lib/api/types'
    import Icon from '@iconify/svelte'
    import { fallbackIcon } from '$lib/utils/icons'

    interface Props {
        open: boolean
        onclose: () => void
        onconfirm: (sets: SelectedSet[]) => void
        echoSets: EchoSetItem[]
        pinnedSets: string[]
        initialSets: SelectedSet[]
        icons?: Record<string, string>
    }

    let { open, onclose, onconfirm, echoSets, pinnedSets, initialSets, icons = {} }: Props = $props()

    let selected = $state<SelectedSet[]>([])

    $effect(() => {
        if (open) selected = initialSets.map((s) => ({ ...s }))
    })

    let totalPieces = $derived.by(() => {
        const byName = new Map<string, number>()
        for (const s of selected) {
            const cur = byName.get(s.name) ?? 0
            if (s.pieces > cur) byName.set(s.name, s.pieces)
        }
        return [...byName.values()].reduce((a, b) => a + b, 0)
    })
    let remaining = $derived(5 - totalPieces)

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

    function isPieceAvailable(_name: string, pieces: number): boolean {
        const sel = isSelected(_name)
        if (sel) return true
        if (pieces === 5) return true
        return pieces <= remaining
    }

    function togglePiece(name: string, pieces: number) {
        const existing = selected.find((s) => s.name === name)
        if (existing) {
            if (existing.pieces === pieces) {
                selected = selected.filter((s) => s.name !== name)
            } else {
                const rest = selected.filter((s) => s.name !== name)
                selected =
                    pieces === 5 ? [...rest, { name, pieces: 5 }, { name, pieces: 2 }] : [...rest, { name, pieces }]
            }
            return
        }
        if (pieces === 5) {
            selected = [
                { name, pieces: 5 },
                { name, pieces: 2 }
            ]
            return
        }
        if (pieces <= remaining) {
            selected = [...selected, { name, pieces }]
        }
    }

    function handleConfirm() {
        onconfirm(selected)
        onclose()
    }

    function formatSets(sets: SelectedSet[]): string {
        if (sets.length === 0) return '无'
        const byName = new Map<string, number>()
        for (const s of sets) {
            const cur = byName.get(s.name) ?? 0
            if (s.pieces > cur) byName.set(s.name, s.pieces)
        }
        return [...byName.entries()].map(([name, pieces]) => `${name}(${pieces})`).join(' + ')
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
        onclick={(e) => {
            if (e.target === e.currentTarget) onclose()
        }}
        onkeydown={(e) => {
            if (e.key === 'Escape') onclose()
        }}
    >
        <div
            class="relative flex max-h-[85vh] w-150 max-w-[90vw] flex-col rounded-xl p-4 shadow-2xl text-(--theme-modal-text)"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent);"
            role="dialog"
            aria-modal="true"
        >
            <div class="mb-3">
                <h3 class="text-sm font-semibold">触发套装</h3>
            </div>

            <div class="flex-1 overflow-y-auto">
                {#if pinnedList.length > 0}
                    <div class="mb-2 text-xs font-semibold tracking-wider text-(--theme-muted-text)">首位声骸所属</div>
                    <div class="grid grid-cols-2 gap-3">
                        {#each pinnedList as set}
                            <div class="flex flex-col gap-2 rounded-lg p-3" style="background: var(--theme-input-bg);">
                                <div class="flex items-center gap-2 min-w-0">
                                    {#if icons[set.name]}
                                        <img
                                            src={icons[set.name]}
                                            alt={set.name}
                                            class="size-8 shrink-0 rounded object-contain"
                                        />
                                    {/if}
                                    <span class="min-w-0 truncate text-sm font-medium">{set.name}</span>
                                    <span
                                        class="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                                        style="background: var(--theme-accent-bg)/15; color: var(--theme-accent-text);"
                                        >首位所属</span
                                    >
                                </div>
                                <div class="flex gap-1">
                                    {#each set.pieces as piece}
                                        <button
                                            onclick={() => togglePiece(set.name, piece)}
                                            disabled={!isPieceAvailable(set.name, piece)}
                                            class={[
                                                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                                                isPieceSelected(set.name, piece)
                                                    ? 'bg-(--theme-accent-bg)/30 text-(--theme-accent-text)'
                                                    : 'bg-(--theme-input-bg) text-(--theme-muted-text) hover:bg-(--theme-modal-text)/10',
                                                !isPieceAvailable(set.name, piece) && !isSelected(set.name)
                                                    ? 'opacity-30 pointer-events-none'
                                                    : ''
                                            ]
                                                .filter(Boolean)
                                                .join(' ')}
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
                    <div class="py-8 text-center text-sm text-(--theme-muted-text)">无其他套装</div>
                {:else}
                    <div class="mb-2 text-xs font-semibold tracking-wider text-(--theme-muted-text)">其它套装</div>
                    <div class="grid grid-cols-2 gap-3">
                        {#each otherList as set}
                            <div class="flex flex-col gap-2 rounded-lg p-3" style="background: var(--theme-input-bg);">
                                <div class="flex items-center gap-2 min-w-0">
                                    {#if icons[set.name]}
                                        <img
                                            src={icons[set.name]}
                                            alt={set.name}
                                            use:fallbackIcon={'/icons/placeholder-echo-set.svg'}
                                            class="size-8 shrink-0 rounded object-contain"
                                        />
                                    {/if}
                                    <span class="min-w-0 truncate text-sm font-medium">{set.name}</span>
                                </div>
                                <div class="flex gap-1">
                                    {#each set.pieces as piece}
                                        <button
                                            onclick={() => togglePiece(set.name, piece)}
                                            disabled={!isPieceAvailable(set.name, piece)}
                                            class={[
                                                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                                                isPieceSelected(set.name, piece)
                                                    ? 'bg-(--theme-accent-bg)/30 text-(--theme-accent-text)'
                                                    : 'bg-(--theme-input-bg) text-(--theme-muted-text) hover:bg-(--theme-modal-text)/10',
                                                !isPieceAvailable(set.name, piece) && !isSelected(set.name)
                                                    ? 'opacity-30 pointer-events-none'
                                                    : ''
                                            ]
                                                .filter(Boolean)
                                                .join(' ')}
                                        >
                                            {piece}件套
                                        </button>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>

            <div
                class="mt-4 flex items-center justify-end pt-3"
                style="border-top: 1px solid var(--theme-divider-border);"
            >
                <button
                    onclick={handleConfirm}
                    class="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all hover:brightness-125"
                    style="background: var(--theme-btn-bg); color: var(--theme-btn-text);"
                >
                    <Icon icon="mdi:check" class="size-4" />
                    确认 ({formatSets(selected)} = {totalPieces}/5)
                </button>
            </div>
        </div>
    </div>
{/if}
