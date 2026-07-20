<script lang="ts">
    import type { SelectedSet } from '$lib/data/types'
    import type { EchoSetItem } from '$lib/api/types'

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
        if (open) selected = structuredClone(initialSets)
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
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onclick={(e) => {
            if (e.target === e.currentTarget) onclose()
        }}
        onkeydown={(e) => {
            if (e.key === 'Escape') onclose()
        }}
    >
        <div
            class="relative flex max-h-[85vh] w-[600px] max-w-[90vw] flex-col rounded-xl p-4 shadow-2xl bg-[var(--theme-modal-bg)] text-[var(--theme-modal-text)]"
            role="dialog"
            aria-modal="true"
        >
            <div class="mb-3">
                <h3 class="text-sm font-semibold">触发套装</h3>
            </div>

            <div class="flex-1 overflow-y-auto">
                {#if pinnedList.length > 0}
                    <div class="mb-2 text-xs font-semibold tracking-wider text-zinc-500">首位声骸所属</div>
                    <div class="grid grid-cols-2 gap-3">
                        {#each pinnedList as set}
                            <div class="flex flex-col gap-2 rounded-lg bg-white/5 p-3">
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
                                        class="ml-auto shrink-0 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-400"
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
                                                    ? 'bg-indigo-500/30 text-indigo-300'
                                                    : 'bg-white/10 text-zinc-400 hover:bg-white/20',
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
                    <div class="my-3 border-t border-white/5"></div>
                {/if}

                {#if otherList.length === 0}
                    <div class="py-8 text-center text-sm text-zinc-600">无其他套装</div>
                {:else}
                    <div class="mb-2 text-xs font-semibold tracking-wider text-zinc-500">其它套装</div>
                    <div class="grid grid-cols-2 gap-3">
                        {#each otherList as set}
                            <div class="flex flex-col gap-2 rounded-lg bg-white/5 p-3">
                                <div class="flex items-center gap-2 min-w-0">
                                    {#if icons[set.name]}
                                        <img
                                            src={icons[set.name]}
                                            alt={set.name}
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
                                                    ? 'bg-indigo-500/30 text-indigo-300'
                                                    : 'bg-white/10 text-zinc-400 hover:bg-white/20',
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

            <div class="mt-4 flex items-center justify-end border-t border-white/5 pt-3">
                <button
                    onclick={handleConfirm}
                    class="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium text-[var(--theme-btn-text)] transition-colors hover:bg-white/5"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                        ><path
                            fill="currentColor"
                            d="M9 16.17L5.53 12.7a1 1 0 0 0-1.42 1.42l4.18 4.18a1 1 0 0 0 1.42 0L20.29 7.71a1 1 0 1 0-1.42-1.42z"
                        /></svg
                    >
                    确认 ({formatSets(selected)} = {totalPieces}/5)
                </button>
            </div>
        </div>
    </div>
{/if}
