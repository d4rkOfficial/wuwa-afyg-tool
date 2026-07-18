<script lang="ts">
    import { getCharacterInfo } from '$lib/data/api'

    let {
        show,
        name,
        onClose,
        charIconMap = {},
        elementIconMap = {},
        weaponTypeIconMap = {}
    }: {
        show: boolean
        name: string | null
        onClose: () => void
        charIconMap?: Record<string, string>
        elementIconMap?: Record<string, string>
        weaponTypeIconMap?: Record<string, string>
    } = $props()

    interface SkillEntry {
        name: string
        type: string
        desc: string
        values: [name: string, value: string, element: string][]
    }

    interface CharInfo {
        rarity: number
        element: string
        weaponType: string
        lv90BaseStats: { hp: number; atk: number; def: number; tune: number }
        skills: SkillEntry[]
        statNodes: { name: string; desc: string }[]
        chains: { name: string; desc: string }[]
    }

    let data = $state<CharInfo | null>(null)
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
            const info = await getCharacterInfo(name!)
            data = info as unknown as CharInfo
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
            class="mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        >
            <div class="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
                <h2 class="text-base font-semibold text-zinc-100">
                    {name}
                </h2>
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
                        <!-- Header info -->
                        <div class="flex items-center gap-3">
                            {#if name && img(charIconMap[name])}
                                <img
                                    src={img(charIconMap[name])}
                                    alt={name}
                                    class="size-10 rounded-md bg-zinc-800/40 object-contain"
                                />
                            {/if}
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="text-base font-semibold text-zinc-100">{name}</span>
                                <span class="text-xs text-zinc-400">{'★'.repeat(data.rarity)}</span>
                                {#if img(elementIconMap[data.element])}
                                    <img
                                        src={img(elementIconMap[data.element])}
                                        alt={data.element}
                                        class="size-5"
                                        title={data.element}
                                    />
                                {:else}
                                    <span class="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400"
                                        >{data.element}</span
                                    >
                                {/if}
                                {#if img(weaponTypeIconMap[data.weaponType])}
                                    <img
                                        src={img(weaponTypeIconMap[data.weaponType])}
                                        alt={data.weaponType}
                                        class="size-5"
                                        title={data.weaponType}
                                    />
                                {:else}
                                    <span class="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400"
                                        >{data.weaponType}</span
                                    >
                                {/if}
                            </div>
                        </div>

                        <!-- Base stats -->
                        <section>
                            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                基础属性 (Lv90)
                            </h3>
                            <div class="grid grid-cols-4 gap-3">
                                <div class="rounded-lg bg-zinc-800/60 p-3 text-center">
                                    <div class="text-[11px] text-zinc-500">生命值白值</div>
                                    <div class="mt-1 text-sm font-semibold text-zinc-200">{data.lv90BaseStats.hp}</div>
                                </div>
                                <div class="rounded-lg bg-zinc-800/60 p-3 text-center">
                                    <div class="text-[11px] text-zinc-500">攻击力白值</div>
                                    <div class="mt-1 text-sm font-semibold text-zinc-200">{data.lv90BaseStats.atk}</div>
                                </div>
                                <div class="rounded-lg bg-zinc-800/60 p-3 text-center">
                                    <div class="text-[11px] text-zinc-500">防御力白值</div>
                                    <div class="mt-1 text-sm font-semibold text-zinc-200">{data.lv90BaseStats.def}</div>
                                </div>
                                <div class="rounded-lg bg-zinc-800/60 p-3 text-center">
                                    <div class="text-[11px] text-zinc-500">谐度破坏增幅</div>
                                    <div class="mt-1 text-sm font-semibold text-zinc-200">
                                        {data.lv90BaseStats.tune}
                                    </div>
                                </div>
                            </div>
                        </section>

                        <!-- Skills -->
                        <section>
                            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">技能</h3>
                            <div class="space-y-3">
                                {#each data.skills as skill}
                                    <details class="group rounded-lg border border-zinc-800 bg-zinc-900/60">
                                        <summary
                                            class="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-zinc-200 [&::-webkit-details-marker]:hidden"
                                        >
                                            <span class="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400"
                                                >{skill.type}</span
                                            >
                                            <span>{skill.name}</span>
                                            <svg
                                                class="ml-auto size-4 text-zinc-500 transition-transform group-open:rotate-90"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                            >
                                                <path d="M9 18l6-6-6-6" />
                                            </svg>
                                        </summary>
                                        <div
                                            class="border-t border-zinc-800 px-4 py-3 text-xs text-zinc-400 leading-relaxed"
                                        >
                                            {@html renderDesc(skill.desc)}
                                        </div>
                                        {#if skill.values.length > 0}
                                            <div class="border-t border-zinc-800 px-4 py-3">
                                                {#each skill.values as [vname, vvalue, velement]}
                                                    <div
                                                        class="flex justify-between gap-2 py-1 text-xs text-zinc-300 even:bg-zinc-800/30"
                                                    >
                                                        <span class="text-zinc-400">{vname}</span>
                                                        <span class="tabular-nums whitespace-nowrap"
                                                            ><span>{vvalue}</span>{#if velement}<span
                                                                    class="text-zinc-600"
                                                                >
                                                                    {velement}</span
                                                                >{/if}</span
                                                        >
                                                    </div>
                                                {/each}
                                            </div>
                                        {/if}
                                    </details>
                                {/each}
                            </div>
                        </section>

                        <!-- Chains -->
                        {#if data.chains.length > 0}
                            <section>
                                <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                    共鸣链
                                </h3>
                                <div class="space-y-2">
                                    {#each data.chains as chain, i}
                                        <div class="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                                            <div class="flex items-center gap-2 text-sm font-medium text-zinc-200">
                                                <span class="text-[10px] text-zinc-500">C{i + 1}</span>
                                                <span>{chain.name}</span>
                                            </div>
                                            <div class="mt-1 text-xs text-zinc-400 leading-relaxed">
                                                {@html renderDesc(chain.desc)}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </section>
                        {/if}

                        <!-- Stat Nodes -->
                        {#if data.statNodes.length > 0}
                            <section>
                                <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                    固有能力
                                </h3>
                                <div class="space-y-2">
                                    {#each data.statNodes as node}
                                        <div class="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                                            <div class="text-sm font-medium text-zinc-200">{node.name}</div>
                                            <div class="mt-1 text-xs text-zinc-400 leading-relaxed">
                                                {@html renderDesc(node.desc)}
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
