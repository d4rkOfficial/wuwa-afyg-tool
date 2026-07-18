<script lang="ts">
    import { getEchoInfo, getEchoSetInfo } from '$lib/data/api'

    let {
        show,
        name,
        onClose,
        echoIconMap = {},
        setIconMap = {},
        setName = null
    }: {
        show: boolean
        name: string | null
        onClose: () => void
        echoIconMap?: Record<string, string>
        setIconMap?: Record<string, string>
        setName?: string | null
    } = $props()

    let data = $state<{
        cost: number
        skill: { desc: string; values: [string, string, string][] }
        groups: string[]
    } | null>(null)
    let setBonus = $state<{ name: string; bonuses: Record<string, string> } | null>(null)
    let loading = $state(false)
    let error = $state('')

    $effect(() => {
        if (show && name) fetchDetail()
    })

    async function fetchDetail() {
        loading = true
        error = ''
        data = null
        setBonus = null
        try {
            const info = await getEchoInfo(name!)
            data = info

            if (setName) {
                try {
                    const b = await getEchoSetInfo(setName)
                    if (b) setBonus = { name: setName, bonuses: b.bonuses }
                } catch {
                    // ignore
                }
            }
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

    const img = (path: string) => path || ''
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
                            {#if name && img(echoIconMap[name])}
                                <img
                                    src={img(echoIconMap[name])}
                                    alt={name}
                                    class="size-10 rounded-md bg-zinc-800/40 object-contain"
                                />
                            {/if}
                            <span
                                class="rounded px-2.5 py-1 text-xs font-bold"
                                style="background: {costColor(data.cost)}20; color: {costColor(data.cost)}"
                            >
                                COST {data.cost}
                            </span>
                            {#if setName && img(setIconMap[setName])}
                                <img src={img(setIconMap[setName])} alt={setName} class="size-5" title={setName} />
                            {/if}
                        </div>

                        <section>
                            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">技能描述</h3>
                            <div
                                class="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-xs text-zinc-400 leading-relaxed"
                            >
                                {@html renderDesc(data.skill.desc)}
                            </div>
                        </section>

                        {#if data.skill.values.length > 0}
                            <section>
                                <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                    倍率数据
                                </h3>
                                <div class="space-y-1.5">
                                    {#each data.skill.values as [name, value, element]}
                                        <div
                                            class="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 flex items-center gap-3 text-xs"
                                        >
                                            <span class="text-zinc-400 min-w-[3rem]">{name}</span>
                                            <span class="text-zinc-200 font-medium">{value}</span>
                                            {#if element}
                                                <span class="ml-auto text-zinc-500 text-[10px] font-medium">
                                                    {element}
                                                </span>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            </section>
                        {/if}

                        {#if setBonus}
                            <section>
                                <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                    {setBonus.name}
                                </h3>
                                <div class="space-y-1.5">
                                    {#each Object.entries(setBonus.bonuses) as [pieces, desc]}
                                        <div class="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                                            <div class="text-[10px] font-semibold text-zinc-500 mb-1">{pieces}件套</div>
                                            <div class="text-xs text-zinc-400 leading-relaxed">
                                                {@html renderDesc(desc)}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </section>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}
