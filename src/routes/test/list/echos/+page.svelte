<script lang="ts">
    import TestListLayout from '$lib/components/shared/TestListLayout.svelte'
    import { getEchoList, getEchoIcons, getEchoSetIcons, getEchoSetList } from '$lib/data/api'
    import EchoDetailModal from '$lib/components/shared/EchoDetailModal.svelte'

    interface Item {
        name: string
        sets: string[]
        cost: number
        icon: string
    }

    let selectedEcho = $state<string | null>(null)
    let selectedSet = $state<string | null>(null)
    let echoIconMap = $state<Record<string, string>>({})
    let setIconMap = $state<Record<string, string>>({})
    let groups = $state<any[]>([])
    let search = $state('')
    let filterValues = $state<string[]>(['4', '3', '1'])
    const filterOptions = [
        { label: 'COST 4', value: '4' },
        { label: 'COST 3', value: '3' },
        { label: 'COST 1', value: '1' }
    ]
    const filterFn = (item: Item, values: string[]) => values.includes(String(item.cost))

    const costColor = (cost: number): string => {
        const map: Record<number, string> = { 4: '#f87171', 3: '#fbbf24', 1: '#4ade80' }
        return map[cost] || '#71717a'
    }

    $effect(() => {
        loadData()
    })

    async function loadData() {
        const [list, iconMap, setIconMapRaw, setList] = await Promise.all([
            getEchoList(),
            getEchoIcons(),
            getEchoSetIcons(),
            getEchoSetList()
        ])

        const piecesMap = {} as Record<string, number[]>
        for (const s of setList) {
            piecesMap[s.name] = s.pieces
        }

        const items: Item[] = list.map((item: any) => ({
            name: item.name,
            sets: item.sets,
            cost: item.cost,
            icon: iconMap[item.name] ?? ''
        }))

        setIconMap = setIconMapRaw

        const groupMap = new Map<string, typeof items>()
        for (const item of items) {
            for (const set of item.sets) {
                if (!groupMap.has(set)) groupMap.set(set, [])
                groupMap.get(set)!.push(item)
            }
        }

        groups = Array.from(groupMap.entries())
            .map(([label, grpItems]) => ({
                label,
                items: grpItems.sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name)),
                icon: setIconMapRaw[label] ?? '',
                pieces: piecesMap[label] ?? []
            }))
            .sort((a, b) => b.items.length - a.items.length)

        echoIconMap = iconMap
    }
</script>

<TestListLayout title="声骸列表" {groups} bind:search bind:filterValues {filterOptions} {filterFn}>
    {#snippet card(item: Item, groupLabel: string)}
        {@const c = costColor(item.cost)}
        <div
            class="rounded-lg overflow-hidden flex items-center gap-2.5 p-3 cursor-pointer"
            style="background-image: linear-gradient(135deg, transparent 30%, {c}25 100%);"
            role="button"
            tabindex="0"
            onclick={() => {
                selectedEcho = item.name
                selectedSet = groupLabel
            }}
            onkeydown={(e) => e.key === 'Enter' && (selectedEcho = item.name)}
        >
            <div class="size-10 shrink-0 rounded-md bg-zinc-800/40 flex items-center justify-center overflow-hidden">
                {#if item.icon}
                    <img src={item.icon} alt={item.name} class="size-full object-contain" />
                {/if}
            </div>
            <div class="min-w-0 flex-1">
                <div class="flex justify-between items-center gap-1">
                    <span class="text-xs font-semibold text-zinc-200 truncate">{item.name}</span>
                    <span
                        class="shrink-0 text-[9px] font-bold px-1 rounded leading-none {item.cost === 4
                            ? 'bg-red-500/20 text-red-400'
                            : item.cost === 3
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : 'bg-green-500/20 text-green-400'}"
                    >
                        COST {item.cost}
                    </span>
                </div>
                <span class="flex justify-between items-center gap-1 text-[11px] text-zinc-500 leading-none mt-0.5">
                    <span class="flex items-center gap-1">
                        {#each item.sets as set}
                            {#if setIconMap[set]}
                                <img src={setIconMap[set]} alt="" class="size-3 object-contain" title={set} />
                            {/if}
                        {/each}
                    </span>
                    <span></span>
                </span>
            </div>
        </div>
    {/snippet}
</TestListLayout>

<EchoDetailModal
    show={selectedEcho !== null}
    name={selectedEcho}
    setName={selectedSet}
    {echoIconMap}
    {setIconMap}
    onClose={() => (selectedEcho = null)}
/>
