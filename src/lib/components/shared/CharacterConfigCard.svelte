<script lang="ts">
    import type { ComponentsProps, CharacterConfig, Character, Weapon, Echo } from '$lib/types'
    import { resources } from '$lib/data/resources.svelte'
    import SelectorModal from './SelectorModal.svelte'
    import EchoConfigModal from './EchoConfigModal.svelte'
    import { SUBSTAT_OPTIONS } from '$lib/consts/stat-data'

    interface Props extends ComponentsProps {
        index: number
        config: CharacterConfig
        characters: Character[]
        weapons: Weapon[]
        echoes: Echo[]
        charIconMap: Record<string, string>
        weaponIconMap: Record<string, string>
        echoIconMap: Record<string, string>
        elementIconMap: Record<string, string>
        weaponTypeIconMap: Record<string, string>
        echoSetIconMap: Record<string, string>
        echoSetPiecesMap: Record<string, number[]>
    }

    let {
        index,
        config,
        characters,
        weapons,
        echoes,
        charIconMap,
        weaponIconMap,
        echoIconMap,
        elementIconMap,
        weaponTypeIconMap,
        echoSetIconMap,
        echoSetPiecesMap = {},
        class: className,
        style
    }: Props = $props()

    let activeModal = $state<'char' | 'weapon' | null>(null)
    let activeEchoSlot = $state<number | null>(null)

    let selectedChar = $derived(characters.find((c) => c.name === config.name) ?? null)
    let filteredWeapons = $derived(
        selectedChar ? weapons.filter((w) => w.weaponType === selectedChar.weaponType) : weapons
    )

    let totalCost = $derived(config.echoes.reduce((s, e) => s + (e?.cost ?? 0), 0))
    let costValid = $derived(totalCost <= 12)

    let weaponName = $derived(config.weapon?.name ?? null)
    let selectedWeapon = $derived(weaponName ? (filteredWeapons.find((w) => w.name === weaponName) ?? null) : null)

    const setWeapon = (item: { name: string } | null) => {
        const name = item?.name ?? null
        if (name) {
            if (!config.weapon) config.weapon = { name, refinement: 1 }
            else config.weapon.name = name
        } else {
            config.weapon = null
        }
    }

    const setEcho = (slot: number, name: string | null) => {
        const slotData = config.echoes[slot]
        if (name) {
            const found = echoes.find((e) => e.name === name)
            slotData.name = name
            slotData.cost = found?.cost ?? 0
            slotData.mainStat = null
            slotData.secondMainStat = null
            slotData.substats = []
        } else {
            slotData.name = null
            slotData.cost = 0
            slotData.mainStat = null
            slotData.secondMainStat = null
            slotData.substats = []
        }
    }

    const onCharSelect = (item: { name: string }) => {
        const name = item.name
        config.name = name
        if (config.weapon?.name) {
            const char = characters.find((c) => c.name === name)
            const wp = weapons.find((w) => w.name === config.weapon!.name)
            if (char && wp && wp.weaponType !== char.weaponType) {
                config.weapon = null
            }
        }
    }

    const setActiveModal = (modal: typeof activeModal) => {
        activeModal = modal
    }

    const STAR_COLORS: Record<number, string> = {
        5: '#fbbf24',
        4: '#a78bfa',
        3: '#60a5fa',
        2: '#4ade80',
        1: '#71717a'
    }
    const STAR_TEXT: Record<number, string> = {
        5: 'text-amber-400',
        4: 'text-purple-400',
        3: 'text-blue-400',
        2: 'text-green-400',
        1: 'text-zinc-400'
    }
    const STAR_BG: Record<number, string> = {
        5: 'bg-amber-950/40',
        4: 'bg-purple-950/40',
        3: 'bg-blue-950/40',
        2: 'bg-green-950/40',
        1: 'bg-zinc-800'
    }
    const starColor = (s: number) => STAR_COLORS[s] ?? '#71717a'
    const starText = (s: number) => STAR_TEXT[s] ?? 'text-zinc-400'
    const starBg = (s: number) => STAR_BG[s] ?? 'bg-zinc-800'

    const COST_COLORS: Record<number, string> = { 4: '#f87171', 3: '#fbbf24', 1: '#4ade80' }
    const COST_TEXT: Record<number, string> = {
        4: 'text-red-400',
        3: 'text-yellow-400',
        1: 'text-green-400'
    }
    const COST_BG: Record<number, string> = {
        4: 'bg-red-950/40',
        3: 'bg-yellow-950/40',
        1: 'bg-green-950/40'
    }
    const costColor = (c: number) => COST_COLORS[c] ?? '#71717a'
    const costText = (c: number) => COST_TEXT[c] ?? 'text-zinc-500'
    const costBg = (c: number) => COST_BG[c] ?? 'bg-zinc-800'

    const ELEMENT_COLORS: Record<string, string> = {
        冷凝: 'text-cyan-400',
        热熔: 'text-orange-400',
        导电: 'text-purple-400',
        气动: 'text-teal-400',
        衍射: 'text-yellow-300',
        湮灭: 'text-rose-400'
    }
    const ELEMENT_BADGE: Record<string, string> = {
        冷凝: 'bg-cyan-500/20 text-cyan-400',
        热熔: 'bg-orange-500/20 text-orange-400',
        导电: 'bg-purple-500/20 text-purple-400',
        气动: 'bg-teal-500/20 text-teal-400',
        衍射: 'bg-yellow-500/20 text-yellow-300',
        湮灭: 'bg-rose-500/20 text-rose-400'
    }

    let charIconPath = $derived(charIconMap[config.name ?? ''] ?? '')
    let charIcon = $derived(charIconPath ? (resources.icons[charIconPath] ?? '') : '')
    let weaponIconPath = $derived((config.weapon?.name ? weaponIconMap[config.weapon.name] : '') ?? '')
    let weaponIcon = $derived(weaponIconPath ? (resources.icons[weaponIconPath] ?? '') : '')

    const ELEMENT_ORDER = ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭']
    const WEAPON_TYPE_ORDER = ['长刃', '迅刀', '佩枪', '臂铠', '音感仪']

    const iconOrSrc = (path: string) => resources.icons[path] || path

    const SUBSTAT_BADGE_CLS = 'bg-gradient-to-br from-transparent to-white/30 border-white/40'

    const sortCharacters = (a: Character, b: Character) => {
        const aIsRover = a.name.startsWith('漂泊者') ? 0 : 1
        const bIsRover = b.name.startsWith('漂泊者') ? 0 : 1
        if (aIsRover !== bIsRover) return aIsRover - bIsRover
        if (b.star !== a.star) return b.star - a.star
        return a.name.localeCompare(b.name)
    }

    let charGroups = $derived(
        ELEMENT_ORDER.map((label) => ({
            label,
            icon: iconOrSrc(elementIconMap[label] ?? ''),
            items: characters
                .filter((c) => c.element === label)
                .sort(sortCharacters)
                .map((c) => ({
                    name: c.name,
                    subtitle: c.element,
                    badge: c.star + '★',
                    badgeColor: starText(c.star) + ' ' + starBg(c.star),
                    color: starColor(c.star),
                    icon: iconOrSrc(charIconMap[c.name] ?? ''),
                    meta: { weaponType: c.weaponType }
                }))
        })).filter((g) => g.items.length > 0)
    )
    let charFilterOptions = WEAPON_TYPE_ORDER.map((v) => ({ label: v, value: v }))
    let charFilterValues = $state([...WEAPON_TYPE_ORDER])
    let charFilterFn = (item: { meta?: Record<string, string> }, values: string[]) =>
        values.includes(item.meta?.weaponType ?? '')

    let weaponGroups = $derived(
        WEAPON_TYPE_ORDER.map((label) => ({
            label,
            icon: iconOrSrc(weaponTypeIconMap[label] ?? ''),
            items: filteredWeapons
                .filter((w) => w.weaponType === label)
                .sort((a, b) => b.star - a.star || a.name.localeCompare(b.name))
                .map((w) => ({
                    name: w.name,
                    subtitle: w.weaponType,
                    badge: w.star + '★',
                    badgeColor: starText(w.star) + ' ' + starBg(w.star),
                    color: starColor(w.star),
                    icon: iconOrSrc(weaponIconMap[w.name] ?? '')
                }))
        })).filter((g) => g.items.length > 0)
    )
    let weaponFilterOptions = [5, 4, 3, 2, 1].map((v) => ({
        label: v + '☆',
        value: String(v)
    }))
    let weaponFilterValues = $state(['5', '4', '3', '2', '1'])
    let weaponFilterFn = (item: { badge?: string | number }, values: string[]) =>
        values.includes(String(item.badge ?? '').replace('★', ''))

    let echoGroups = $derived.by(() => {
        const groupMap = new Map<string, typeof echoes>()
        for (const e of echoes) {
            for (const set of e.sets) {
                if (!groupMap.has(set)) groupMap.set(set, [])
                groupMap.get(set)!.push(e)
            }
        }
        return Array.from(groupMap.entries())
            .map(([label, items]) => ({
                label,
                icon: iconOrSrc(echoSetIconMap[label] ?? ''),
                items: items
                    .sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name))
                    .map((e) => ({
                        name: e.name,
                        badge: e.cost,
                        badgeColor: costText(e.cost) + ' ' + costBg(e.cost),
                        color: costColor(e.cost),
                        icon: iconOrSrc(echoIconMap[e.name] ?? ''),
                        meta: { group: label }
                    }))
            }))
            .sort((a, b) => b.items.length - a.items.length)
    })
    interface ActivatedSet {
        name: string
        activated: number[]
    }

    let activatedSets = $derived.by(() => {
        const setCount = new Map<string, Set<string>>()
        for (const slot of config.echoes) {
            if (!slot.name || !slot.set) continue
            if (!setCount.has(slot.set)) setCount.set(slot.set, new Set())
            setCount.get(slot.set)!.add(slot.name)
        }
        const result: ActivatedSet[] = []
        for (const [name, names] of setCount) {
            const count = names.size
            const pieces = echoSetPiecesMap[name] ?? []
            const activated = pieces.filter((p) => count >= p)
            if (activated.length > 0) result.push({ name, activated })
        }
        return result
    })

    let echoFilterOptions = [
        { label: 'COST 4', value: '4' },
        { label: 'COST 3', value: '3' },
        { label: 'COST 1', value: '1' }
    ]
    let echoFilterValues = $state(['4', '3', '1'])
    let echoFilterFn = (item: { badge?: string | number }, values: string[]) => values.includes(String(item.badge))
</script>

<SelectorModal
    show={activeModal === 'char'}
    title="选择角色"
    groups={charGroups}
    selected={config.name}
    onSelect={onCharSelect}
    onClose={() => (activeModal = null)}
    filterOptions={charFilterOptions}
    bind:filterValues={charFilterValues}
    filterFn={charFilterFn}
/>
<SelectorModal
    show={activeModal === 'weapon'}
    title="选择武器"
    groups={weaponGroups}
    selected={weaponName}
    onSelect={(n) => setWeapon(n)}
    onClose={() => (activeModal = null)}
    filterOptions={weaponFilterOptions}
    bind:filterValues={weaponFilterValues}
    filterFn={weaponFilterFn}
/>
<EchoConfigModal
    show={activeEchoSlot !== null}
    slotData={activeEchoSlot !== null ? config.echoes[activeEchoSlot] : config.echoes[0]}
    slotIndex={activeEchoSlot ?? 0}
    {echoes}
    {echoGroups}
    {echoFilterOptions}
    bind:echoFilterValues
    filterFn={echoFilterFn}
    {echoIconMap}
    {echoSetIconMap}
    onClose={() => (activeEchoSlot = null)}
/>

<div class="relative rounded-lg border border-zinc-700 bg-zinc-900 overflow-hidden {className ?? ''}" {style}>
    <!-- Star-colored top accent -->
    <div class="h-0.5" style="background: {selectedChar ? starColor(selectedChar.star) : '#3f3f46'}"></div>

    <div class="p-4">
        <!-- Character + Weapon row -->
        <div class="flex gap-3 mb-4">
            <button
                class="flex-1 rounded-lg border border-zinc-700/50 bg-zinc-800/40 px-3 py-3 text-left transition-all hover:border-zinc-500 hover:bg-zinc-800"
                onclick={() => setActiveModal('char')}
            >
                <div class="mb-2 flex items-center gap-2">
                    <span
                        class="flex size-5 items-center justify-center rounded-full bg-zinc-800 text-[10px] text-zinc-400"
                        >{index}</span
                    >
                    <span class="text-[10px] text-zinc-500">角色</span>
                    {#if selectedChar}
                        <span class="ml-auto flex items-center gap-0.5">
                            {#each { length: selectedChar.star } as _}
                                <span class="text-[9px]" style="color: {starColor(selectedChar.star)}">★</span>
                            {/each}
                        </span>
                    {/if}
                </div>
                {#if selectedChar}
                    <div class="flex items-center gap-2.5">
                        <div
                            class="size-10 shrink-0 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden ring-2 ring-zinc-700"
                        >
                            {#if charIcon}<img src={charIcon} alt="" class="size-full object-cover" />{/if}
                        </div>
                        <div class="min-w-0">
                            <div class="text-xs font-semibold text-zinc-100 truncate">
                                {selectedChar.name}
                            </div>
                            <div class="mt-0.5 flex items-center gap-1.5">
                                {#if iconOrSrc(elementIconMap[selectedChar.element] ?? '')}
                                    <img
                                        src={iconOrSrc(elementIconMap[selectedChar.element])}
                                        alt=""
                                        class="size-4 object-contain"
                                        title={selectedChar.element}
                                    />
                                {/if}
                                {#if iconOrSrc(weaponTypeIconMap[selectedChar.weaponType] ?? '')}
                                    <img
                                        src={iconOrSrc(weaponTypeIconMap[selectedChar.weaponType])}
                                        alt=""
                                        class="size-4 object-contain"
                                        title={selectedChar.weaponType}
                                    />
                                {/if}
                            </div>
                        </div>
                    </div>
                {:else}
                    <div class="flex items-center gap-2 text-zinc-500">
                        <div class="size-10 shrink-0 rounded-full bg-zinc-800 flex items-center justify-center">+</div>
                        <span class="text-xs">选择角色</span>
                    </div>
                {/if}
            </button>
            <button
                class="flex-1 rounded-lg border border-zinc-700/50 bg-zinc-800/40 px-3 py-3 text-left transition-all hover:border-zinc-500 hover:bg-zinc-800"
                onclick={() => {
                    if (selectedChar) setActiveModal('weapon')
                }}
            >
                <div class="mb-2 text-[10px] text-zinc-500">武器</div>
                {#if selectedChar}
                    {#if selectedWeapon}
                        <div class="flex items-center gap-2.5">
                            <div
                                class="size-10 shrink-0 rounded bg-zinc-800 flex items-center justify-center overflow-hidden"
                            >
                                {#if weaponIcon}<img src={weaponIcon} alt="" class="size-full object-contain" />{/if}
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="text-xs font-medium text-zinc-200 truncate">
                                    {selectedWeapon.name}
                                </div>
                                <div class="mt-0.5 flex items-center gap-1.5 text-[9px]">
                                    {#if iconOrSrc(weaponTypeIconMap[selectedWeapon.weaponType] ?? '')}
                                        <img
                                            src={iconOrSrc(weaponTypeIconMap[selectedWeapon.weaponType])}
                                            alt=""
                                            class="size-3.5 object-contain"
                                        />
                                    {/if}
                                    <span class="text-zinc-600">精炼</span>
                                    <input
                                        type="number"
                                        min="1"
                                        max="5"
                                        class="w-7 rounded border border-zinc-700 bg-zinc-800 px-0.5 py-0 text-center text-[9px] text-zinc-200 outline-none"
                                        bind:value={config.weapon!.refinement}
                                        onclick={(e) => e.stopPropagation()}
                                        oninput={(e) => e.stopPropagation()}
                                    />
                                </div>
                            </div>
                        </div>
                    {:else}
                        <div class="flex items-center gap-2 text-zinc-500">
                            <div class="size-10 shrink-0 rounded bg-zinc-800 flex items-center justify-center">+</div>
                            <span class="text-xs">选择武器</span>
                        </div>
                    {/if}
                {:else}
                    <div class="text-[11px] text-zinc-600">请先选择角色</div>
                {/if}
            </button>
        </div>

        <!-- Echoes section -->
        <div>
            <div class="mb-2 flex items-center justify-between">
                <span class="text-[11px] text-zinc-500">声骸</span>
                <span class="text-[11px] tabular-nums {costValid ? 'text-zinc-500' : 'text-red-400 font-medium'}"
                    >{totalCost}/12</span
                >
            </div>

            <div class="flex flex-col gap-2">
                {#each config.echoes as echoSlot, i}
                    <button
                        class="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden text-left transition-all hover:border-zinc-500"
                        style="border-left: 3px solid {echoSlot.cost ? costColor(echoSlot.cost) : '#3f3f46'}"
                        onclick={() => (activeEchoSlot = i)}
                    >
                        {#if echoSlot.name}
                            <div class="flex">
                                <div class="flex shrink-0 items-start p-2">
                                    {#if iconOrSrc(echoIconMap[echoSlot.name] ?? '')}
                                        <img
                                            src={iconOrSrc(echoIconMap[echoSlot.name])}
                                            alt=""
                                            class="size-14 rounded object-contain"
                                        />
                                    {/if}
                                </div>
                                <div class="flex-1 p-3 pl-0">
                                    <div class="flex items-center gap-1.5">
                                        {#if echoSlot.set && iconOrSrc(echoSetIconMap[echoSlot.set] ?? '')}
                                            <img
                                                src={iconOrSrc(echoSetIconMap[echoSlot.set])}
                                                alt=""
                                                class="size-4 shrink-0 rounded object-contain"
                                                title={echoSlot.set}
                                            />
                                        {/if}
                                        {#if echoSlot.mainStat}
                                            <span class="text-xs font-bold text-zinc-100 tabular-nums"
                                                >{echoSlot.mainStat.value}{echoSlot.mainStat.unit}
                                                {echoSlot.mainStat.type}</span
                                            >
                                        {:else}
                                            <span class="text-xs text-zinc-500">{echoSlot.name}</span>
                                        {/if}
                                        <span
                                            class="ml-auto rounded border border-zinc-600 px-1.5 py-0.5 text-[9px] font-bold {costText(
                                                echoSlot.cost
                                            )} {costBg(echoSlot.cost)}">{echoSlot.cost} COST</span
                                        >
                                    </div>
                                    {#if echoSlot.substats.length > 0}
                                        <div class="mt-2 grid grid-cols-2 gap-1">
                                            {#each echoSlot.substats as s}
                                                <span
                                                    class="inline-flex items-center rounded overflow-hidden text-[9px] leading-none border-r border-b {SUBSTAT_BADGE_CLS}"
                                                >
                                                    <span class="px-1.5 py-1 text-white font-bold text-xs"
                                                        >{s.value}{s.unit}</span
                                                    >
                                                    <span class="px-1.5 py-1 text-white">{s.type}</span>
                                                </span>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {:else}
                            <div class="p-3 flex items-center gap-2 text-zinc-500">
                                <div
                                    class="size-8 shrink-0 rounded bg-zinc-800 flex items-center justify-center text-sm"
                                >
                                    +
                                </div>
                                <span class="text-xs">{i === 0 ? '选择首位声骸' : '选择声骸'}</span>
                            </div>
                        {/if}
                    </button>
                {/each}
            </div>

            <!-- Activated set effects -->
            {#if activatedSets.length > 0}
                <div class="mt-3">
                    <div class="mb-1.5 text-[10px] text-zinc-500">已触发套装效果</div>
                    <div class="flex flex-wrap gap-1.5">
                        {#each activatedSets as set}
                            {#each set.activated as pieces}
                                <span
                                    class="inline-flex items-center gap-1 rounded-full bg-zinc-800/60 px-2.5 py-1 text-[10px] text-zinc-300"
                                >
                                    {#if echoSetIconMap[set.name] && iconOrSrc(echoSetIconMap[set.name])}
                                        <img
                                            src={iconOrSrc(echoSetIconMap[set.name])}
                                            alt=""
                                            class="size-3 object-contain"
                                        />
                                    {/if}
                                    {set.name}
                                    <span class="font-medium text-zinc-400">{pieces}件套</span>
                                </span>
                            {/each}
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>
