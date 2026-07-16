<script lang="ts">
    let { show, name, onClose }: { show: boolean; name: string | null; onClose: () => void } = $props()

    let data = $state<{ cost: number; desc: string; groups: string[] } | null>(null)
    let loading = $state(false)
    let error = $state('')

    $effect(() => {
        if (show && name) fetchDetail()
    })

    async function fetchDetail() {
        loading = true
        error = ''
        data = null
        try {
            const res = await fetch(`/api/v1/echo-info/${encodeURIComponent(name!)}`)
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || 'Failed to fetch')
            }
            data = await res.json()
        } catch (e) {
            error = String(e)
        } finally {
            loading = false
        }
    }

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose()
    }

    const handleBackdrop = (e: MouseEvent) => {
        if ((e.target as HTMLElement).dataset?.modal === 'backdrop') onClose()
    }

    const costColor = (cost: number): string => {
        const map: Record<number, string> = { 4: '#f87171', 3: '#fbbf24', 1: '#4ade80' }
        return map[cost] || '#71717a'
    }

    const renderDesc = (s: string) => s.replace(/\n/g, '<br>')
</script>

<svelte:window onkeydown={handleKeydown} />

{#if show}
    <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
        role="button"
        tabindex="-1"
        data-modal="backdrop"
        onclick={handleBackdrop}
        onkeydown={handleKeydown}
    >
        <div
            class="mx-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        >
            <div class="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
                <h2 class="text-base font-semibold text-zinc-100">{name}</h2>
                <button
                    class="flex size-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                    onclick={onClose}
                >
                    ✕
                </button>
            </div>

            <div class="flex-1 overflow-y-auto px-5 py-4">
                {#if loading}
                    <div class="flex items-center justify-center py-16 text-zinc-400">
                        <svg class="mr-3 size-5 animate-spin" viewBox="0 0 24 24">
                            <circle
                                class="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                stroke-width="4"
                                fill="none"
                            />
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        <span class="text-sm">加载中...</span>
                    </div>
                {:else if error}
                    <div class="py-16 text-center text-sm text-red-400">{error}</div>
                {:else if data}
                    <div class="space-y-6">
                        <div class="flex items-center gap-3">
                            <span
                                class="rounded px-2.5 py-1 text-xs font-bold"
                                style="background: {costColor(data.cost)}20; color: {costColor(data.cost)}"
                            >
                                COST {data.cost}
                            </span>
                        </div>

                        {#if data.groups.length > 0}
                            <section>
                                <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">套装</h3>
                                <div class="flex flex-wrap gap-2">
                                    {#each data.groups as group}
                                        <span class="rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300"
                                            >{group}</span
                                        >
                                    {/each}
                                </div>
                            </section>
                        {/if}

                        <section>
                            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">技能描述</h3>
                            <div
                                class="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-xs text-zinc-400 leading-relaxed"
                            >
                                {@html renderDesc(data.desc)}
                            </div>
                        </section>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}
