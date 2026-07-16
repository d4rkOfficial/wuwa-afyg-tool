<script lang="ts">
    import TestListLayout from '$lib/components/shared/TestListLayout.svelte'
    import { resources } from '$lib/data/resources.svelte'
    import WeaponDetailModal from '$lib/components/shared/WeaponDetailModal.svelte'

    interface Item {
        name: string
        star: number
        weaponType: string
        icon: string
    }

    const WEAPON_TYPE_ORDER = ['长刃', '迅刀', '佩枪', '臂铠', '音感仪']

    let selectedWeapon = $state<string | null>(null)
    let weaponIconMap = $state<Record<string, string>>({})
    let weaponTypeIconMap = $state<Record<string, string>>({})
    let groups = $state<any[]>([])
    let search = $state('')
    let filterValues = $state<string[]>(['5', '4', '3', '2', '1'])
    const filterOptions = [
        { label: '5☆', value: '5' },
        { label: '4☆', value: '4' },
        { label: '3☆', value: '3' },
        { label: '2☆', value: '2' },
        { label: '1☆', value: '1' }
    ]
    const filterFn = (item: Item, values: string[]) => values.includes(String(item.star))

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
        const [list, iconMap, weaponTypeMap] = await Promise.all([
            resources.getList<any>('weapon'),
            resources.getIconMap('weapon'),
            resources.getIconMap('weapon-type')
        ])

        const items: Item[] = list.map((item: any) => ({
            name: item.name,
            star: item.star,
            weaponType: item.weaponType,
            icon: iconMap[item.name] ?? ''
        }))

        weaponIconMap = iconMap
        weaponTypeIconMap = weaponTypeMap

        groups = WEAPON_TYPE_ORDER.map((label) => ({
            label,
            items: items
                .filter((item) => item.weaponType === label)
                .sort((a, b) => b.star - a.star || a.name.localeCompare(b.name)),
            icon: weaponTypeMap[label] ?? ''
        })).filter((g) => g.items.length > 0)

        resources.loadIcons([...Object.values(iconMap), ...Object.values(weaponTypeMap)])
    }
</script>

<TestListLayout title="武器列表" {groups} bind:search bind:filterValues {filterOptions} {filterFn}>
    {#snippet card(item: Item, _groupLabel: string)}
        {@const c = starColor(item.star)}
        <div
            class="rounded-lg overflow-hidden flex items-center gap-2.5 p-3 border-0 border-r-2 border-b-2 cursor-pointer"
            style="border-right-color: {c}; border-bottom-color: {c}; background-image: linear-gradient(135deg, transparent 30%, {c}25 100%);"
            role="button"
            tabindex="0"
            onclick={() => (selectedWeapon = item.name)}
            onkeydown={(e) => e.key === 'Enter' && (selectedWeapon = item.name)}
        >
            <div class="size-10 shrink-0 rounded-md bg-zinc-800/40 flex items-center justify-center overflow-hidden">
                {#if img(item.icon)}
                    <img src={img(item.icon)} alt={item.name} class="size-full object-contain" />
                {/if}
            </div>
            <div class="min-w-0 flex-1">
                <div class="flex justify-between items-center gap-1">
                    <span class="text-xs font-semibold text-zinc-200 truncate">{item.name}</span>
                </div>
            </div>
        </div>
    {/snippet}
</TestListLayout>

<WeaponDetailModal
    show={selectedWeapon !== null}
    name={selectedWeapon}
    {weaponIconMap}
    {weaponTypeIconMap}
    onClose={() => (selectedWeapon = null)}
/>
