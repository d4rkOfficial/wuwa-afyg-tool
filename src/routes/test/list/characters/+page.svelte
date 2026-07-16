<script lang="ts">
    import TestListLayout from '$lib/components/shared/TestListLayout.svelte'
    import { resources } from '$lib/data/resources.svelte'
    import CharacterDetailModal from '$lib/components/shared/CharacterDetailModal.svelte'

    interface Item {
        name: string
        star: number
        element: string
        weaponType: string
        headIcon: string
        weaponTypeIcon: string
    }

    const ELEMENT_ORDER = ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭']

    let selectedChar = $state<string | null>(null)
    let charIconMap = $state<Record<string, string>>({})
    let elementIconMap = $state<Record<string, string>>({})
    let weaponTypeIconMap = $state<Record<string, string>>({})
    let groups = $state<any[]>([])
    let search = $state('')
    let filterValues = $state<string[]>(['长刃', '迅刀', '佩枪', '臂铠', '音感仪'])
    const filterOptions = [
        { label: '长刃', value: '长刃' },
        { label: '迅刀', value: '迅刀' },
        { label: '佩枪', value: '佩枪' },
        { label: '臂铠', value: '臂铠' },
        { label: '音感仪', value: '音感仪' }
    ]
    const filterFn = (item: Item, values: string[]) => values.includes(item.weaponType)

    const hideImg = (e: Event) => {
        ;(e.currentTarget as HTMLElement).style.display = 'none'
    }

    const starColor = (star: number): string => {
        const map: Record<number, string> = {
            5: '#fbbf24',
            4: '#a78bfa',
            3: '#60a5fa',
            2: '#4ade80',
            1: '#71717a'
        }
        return map[star] || '#71717a'
    }

    const img = (path: string) => resources.icons[path] || ''

    $effect(() => {
        loadData()
    })

    $effect(() => {
        const map = resources.icons
        for (const g of groups) {
            if (g.icon && map[g.icon]) {
                g.icon = map[g.icon]
            }
        }
    })

    async function loadData() {
        const list = await resources.getList<any>('character')
        const [iconMap, elementMap, weaponTypeMap] = await Promise.all([
            resources.getIconMap('character'),
            resources.getIconMap('element'),
            resources.getIconMap('weapon-type')
        ])

        const items: Item[] = list.map((item: any) => ({
            name: item.name,
            star: item.star,
            element: item.element,
            weaponType: item.weaponType,
            headIcon: iconMap[item.name] ?? '',
            weaponTypeIcon: weaponTypeMap[item.weaponType] ?? ''
        }))
        charIconMap = iconMap
        elementIconMap = elementMap
        weaponTypeIconMap = weaponTypeMap

        const sortCharacters = (a: Item, b: Item) => {
            const aIsRover = a.name.startsWith('漂泊者') ? 0 : 1
            const bIsRover = b.name.startsWith('漂泊者') ? 0 : 1
            if (aIsRover !== bIsRover) return aIsRover - bIsRover
            if (b.star !== a.star) return b.star - a.star
            return a.name.localeCompare(b.name)
        }

        groups = ELEMENT_ORDER.map((label) => ({
            label,
            items: items.filter((item) => item.element === label).sort(sortCharacters),
            icon: elementMap[label] ?? ''
        })).filter((g) => g.items.length > 0)

        const paths = [...Object.values(iconMap), ...Object.values(elementMap), ...Object.values(weaponTypeMap)]
        resources.loadIcons(paths)
    }
</script>

<TestListLayout title="角色列表" {groups} bind:search bind:filterValues {filterOptions} {filterFn}>
    {#snippet card(item: Item, _groupLabel: string)}
        {@const c = starColor(item.star)}
        <div
            class="rounded-lg overflow-hidden flex items-center gap-2.5 p-3 cursor-pointer"
            style="background-image: linear-gradient(135deg, transparent 30%, {c}25 100%);"
            role="button"
            tabindex="0"
            onclick={() => (selectedChar = item.name)}
            onkeydown={(e) => e.key === 'Enter' && (selectedChar = item.name)}
        >
            <div class="size-10 shrink-0 rounded-md bg-zinc-800/40 flex items-center justify-center overflow-hidden">
                {#if img(item.headIcon)}
                    <img src={img(item.headIcon)} alt={item.name} class="size-full object-contain" />
                {/if}
            </div>
            <div class="min-w-0 flex-1">
                <div class="flex justify-between items-center gap-1">
                    <span class="text-xs font-semibold text-zinc-200 truncate">{item.name}</span>
                </div>
            </div>
            {#if item.weaponTypeIcon}
                <div
                    class="size-10 shrink-0 rounded-md bg-zinc-800/40 flex items-center justify-center overflow-hidden"
                >
                    {#if img(item.weaponTypeIcon)}
                        <img src={img(item.weaponTypeIcon)} alt="" class="size-full object-contain" />
                    {/if}
                </div>
            {/if}
        </div>
    {/snippet}
</TestListLayout>

<CharacterDetailModal
    show={selectedChar !== null}
    name={selectedChar}
    onClose={() => (selectedChar = null)}
    {charIconMap}
    {elementIconMap}
    {weaponTypeIconMap}
/>
