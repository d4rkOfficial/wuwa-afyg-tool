<script lang="ts">
    import type { CharSlot, SelectedSet } from '$lib/data/types'
    import type { Character, Weapon, Echo, EchoSetItem } from '$lib/api/types'
    import { addToast } from '$lib/data/toast.svelte'
    import Icon from '@iconify/svelte'
    import {
        getCharacterList,
        getWeaponList,
        getEchoList,
        getEchoSetList,
        getCharacterIcons,
        getWeaponIcons,
        getEchoIcons,
        getEchoSetIcons,
        getElementIcons,
        getWeaponTypeIcons
    } from '$lib/data/api'
    import CharacterPicker from './pickers/character-picker.svelte'
    import WeaponPicker from './pickers/weapon-picker.svelte'
    import EchoPicker from './pickers/echo-picker.svelte'
    import SetPicker from './set-picker.svelte'
    import { fallbackIcon } from '$lib/utils/icons'

    interface Props {
        team: [CharSlot, CharSlot, CharSlot]
        onupdate: (team: [CharSlot, CharSlot, CharSlot]) => void
        locked?: boolean
        onreset?: () => void
    }

    let { team: _team, onupdate, locked = false, onreset }: Props = $props()

    function makeSlot(): CharSlot {
        return {
            character: null,
            weapon: null,
            triggerSets: [],
            echoes: [
                { name: null, cost: 0 },
                { name: null, cost: 0 },
                { name: null, cost: 0 },
                { name: null, cost: 0 },
                { name: null, cost: 0 }
            ]
        }
    }

    let localTeam = $state<[CharSlot, CharSlot, CharSlot]>([makeSlot(), makeSlot(), makeSlot()])

    let characters: Character[] = $state([])
    let weapons: Weapon[] = $state([])
    let echoes: Echo[] = $state([])
    let echoSets: EchoSetItem[] = $state([])
    let characterIcons: Record<string, string> = $state({})
    let weaponIcons: Record<string, string> = $state({})
    let echoIcons: Record<string, string> = $state({})
    let echoSetIcons: Record<string, string> = $state({})
    let elementIcons: Record<string, string> = $state({})
    let weaponTypeIcons: Record<string, string> = $state({})
    let pickerSlot = $state<number | null>(null)
    let pickerType = $state<'character' | 'weapon' | 'echo' | 'sets' | null>(null)
    let autoRecommending: Record<number, boolean> = $state({ 0: false, 1: false, 2: false })
    let autoRecommendAbort: AbortController | null = null

    let characterMap = $derived(new Map(characters.map((c) => [c.name, c])))
    let echoMap = $derived(new Map(echoes.map((e) => [e.name, e])))
    let weaponMap = $derived(new Map(weapons.map((w) => [w.name, w])))

    $effect(() => {
        localTeam = JSON.parse(JSON.stringify(_team)) as [CharSlot, CharSlot, CharSlot]
    })

    $effect(() => {
        Promise.allSettled([
            getCharacterList(),
            getWeaponList(),
            getEchoList(),
            getEchoSetList(),
            getCharacterIcons(),
            getWeaponIcons(),
            getEchoIcons(),
            getEchoSetIcons(),
            getElementIcons(),
            getWeaponTypeIcons()
        ]).then((results) => {
            const [cl, wl, el, esl, ci, wi, ei, esi, eli, wti] = results
            if (cl.status === 'fulfilled') characters = cl.value
            if (wl.status === 'fulfilled') weapons = wl.value
            if (el.status === 'fulfilled') echoes = el.value
            if (esl.status === 'fulfilled') echoSets = esl.value
            if (ci.status === 'fulfilled') characterIcons = ci.value
            if (wi.status === 'fulfilled') weaponIcons = wi.value
            if (ei.status === 'fulfilled') echoIcons = ei.value
            if (esi.status === 'fulfilled') echoSetIcons = esi.value
            if (eli.status === 'fulfilled') elementIcons = eli.value
            if (wti.status === 'fulfilled') weaponTypeIcons = wti.value
        })
    })

    function openPicker(slot: number, type: 'character' | 'weapon' | 'echo' | 'sets') {
        if (locked) return
        if (type === 'weapon' && autoRecommending[slot]) {
            autoRecommendAbort?.abort()
            autoRecommendAbort = null
            autoRecommending[slot] = false
            addToast(`已阻止为 ${localTeam[slot].character} 自动推荐武器。`, 'info')
        }
        pickerSlot = slot
        pickerType = type
    }

    function closePicker() {
        pickerSlot = null
        pickerType = null
    }

    function resetSlot(idx: number) {
        const name = localTeam[idx].character
        localTeam[idx] = {
            character: null,
            weapon: null,
            triggerSets: [],
            echoes: [
                { name: null, cost: 0 },
                { name: null, cost: 0 },
                { name: null, cost: 0 },
                { name: null, cost: 0 },
                { name: null, cost: 0 }
            ]
        }
        if (name) addToast(`角色 ${name} 已重置`, 'success')
        onupdate(localTeam)
        onreset?.()
    }

    async function handleSelectCharacter(item: unknown) {
        if (pickerSlot === null) return
        const slot = pickerSlot
        const char = item as Character | null
        if (char) {
            const dupIdx = localTeam.findIndex((s, i) => i !== pickerSlot && s.character === char.name)
            if (dupIdx !== -1) {
                addToast(`已经在${dupIdx + 1}号位选择了${char.name}`, 'error')
                return
            }
        }
        localTeam[pickerSlot].character = char?.name ?? null
        if (char && localTeam[pickerSlot].weapon) {
            const wp = weaponMap.get(localTeam[pickerSlot].weapon!)
            if (wp && wp.weaponType !== char.weaponType) {
                localTeam[pickerSlot].weapon = null
                addToast('武器类型与角色不匹配，已清空武器', 'info')
            }
        }
        if (!char) {
            localTeam[pickerSlot].weapon = null
            localTeam[pickerSlot].echoes[0] = { name: null, cost: 0 }
            localTeam[pickerSlot].triggerSets = []
        }
        closePicker()
        onupdate(localTeam)

        if (char && !localTeam[slot].weapon) {
            autoRecommending[slot] = true
            const controller = new AbortController()
            autoRecommendAbort = controller
            try {
                const res = await fetch(`/api/v1/recommend-weapon/${encodeURIComponent(char.name)}`, {
                    signal: controller.signal
                })
                if (res.ok && !controller.signal.aborted) {
                    const weapons: string[] = await res.json()
                    const recommended = weapons[0]
                    if (recommended && weaponMap.get(recommended)?.weaponType === char.weaponType) {
                        localTeam[slot].weapon = recommended
                        addToast(`已自动为 ${char.name} 推荐 ${recommended}。`, 'success')
                        onupdate(localTeam)
                    }
                }
            } catch (e) {
                if (e instanceof DOMException && e.name === 'AbortError') return
            } finally {
                if (autoRecommendAbort === controller) autoRecommendAbort = null
                autoRecommending[slot] = false
            }
        }
    }

    function handleSelectWeapon(item: unknown) {
        if (pickerSlot === null) return
        localTeam[pickerSlot].weapon = (item as Weapon | null)?.name ?? null
        closePicker()
        onupdate(localTeam)
    }

    function handleSelectEcho(item: unknown) {
        if (pickerSlot === null) return
        const echo = item as Echo | null
        const slot = localTeam[pickerSlot]
        slot.echoes[0] = echo ? { name: echo.name, cost: echo.cost } : { name: null, cost: 0 }
        if (!echo) {
            slot.triggerSets = []
        } else if (getEffectiveTotal(slot.triggerSets) === 5) {
            // 赫卡忒特殊处理：该声骸可属于任何套装
            if (echo.name !== '赫卡忒') {
                const setNames = new Set(slot.triggerSets.map((s) => s.name))
                const echoData = echoMap.get(echo.name)
                if (echoData && !echoData.sets.some((sn) => setNames.has(sn))) {
                    slot.triggerSets = []
                    addToast('当前声骸不属于已选套装组合，已清空触发套装', 'info')
                }
            }
        }
        closePicker()
        onupdate(localTeam)
    }

    function handleConfirmSets(sets: SelectedSet[]) {
        if (pickerSlot !== null) {
            localTeam[pickerSlot].triggerSets = sets

            if (getEffectiveTotal(sets) === 5) {
                const slot = localTeam[pickerSlot]
                // 赫卡忒特殊处理：该声骸可属于任何套装
                if (slot.echoes[0].name !== '赫卡忒') {
                    const echoData = slot.echoes[0].name ? echoMap.get(slot.echoes[0].name) : null
                    if (echoData) {
                        const setNames = new Set(sets.map((s) => s.name))
                        if (!echoData.sets.some((sn) => setNames.has(sn))) {
                            slot.echoes[0] = { name: null, cost: 0 }
                            addToast('已选套装组合与首位声骸不匹配，已清空声骸', 'info')
                        }
                    }
                }
            }
        }
        closePicker()
        onupdate(localTeam)
    }

    function getTriggerSetSummary(slot: CharSlot): string {
        if (slot.triggerSets.length === 0) return ''
        return slot.triggerSets.map((s) => `${s.name}(${s.pieces})`).join(' + ')
    }

    function getEffectiveTotal(sets: SelectedSet[]): number {
        const byName = new Map<string, number>()
        for (const s of sets) {
            const cur = byName.get(s.name) ?? 0
            if (s.pieces > cur) byName.set(s.name, s.pieces)
        }
        return [...byName.values()].reduce((a, b) => a + b, 0)
    }

    let filteredWeapons = $derived.by(() => {
        if (pickerSlot === null) return []
        const slot = localTeam[pickerSlot]
        const charData = characterMap.get(slot.character ?? '')
        if (!charData) return weapons
        return weapons.filter((w) => w.weaponType === charData.weaponType)
    })

    let charPickerOpen = $derived(pickerSlot !== null && pickerType === 'character')
    let weaponPickerOpen = $derived(pickerSlot !== null && pickerType === 'weapon')
    let echoPickerOpen = $derived(pickerSlot !== null && pickerType === 'echo')
    let setPickerOpen = $derived(pickerSlot !== null && pickerType === 'sets')

    let pinnedSetNames = $derived.by(() => {
        if (pickerSlot === null) return []
        const slot = localTeam[pickerSlot]
        const echoData = echoMap.get(slot.echoes[0].name ?? '')
        return echoData?.sets ?? []
    })

    let activeSlot = $derived(pickerSlot !== null ? localTeam[pickerSlot] : null)

    let currentCharName = $derived(pickerSlot !== null ? (localTeam[pickerSlot].character ?? undefined) : undefined)
    let currentWeaponName = $derived(pickerSlot !== null ? (localTeam[pickerSlot].weapon ?? undefined) : undefined)
    let currentEchoName = $derived(
        pickerSlot !== null ? (localTeam[pickerSlot].echoes[0].name ?? undefined) : undefined
    )
</script>

<div class="flex h-full flex-col p-6" style="background: var(--theme-modal-bg); color: var(--theme-modal-text)">
    <div class="flex flex-1 gap-4">
        {#each localTeam as slot, i}
            {@const charData = characterMap.get(slot.character ?? '')}
            {@const eColor = charData ? `var(--theme-element-${charData.element})` : ''}
            <div
                class="group relative flex flex-1 flex-col overflow-hidden rounded-xl border p-6"
                style={slot.character && eColor
                    ? `background: linear-gradient(135deg, transparent 0%, color-mix(in srgb, ${eColor} 18%, transparent) 100%); border-color: color-mix(in srgb, ${eColor} 50%, transparent)`
                    : 'background: var(--theme-context-menu-bg); border-color: var(--theme-card-border)'}
            >
                <div class="pointer-events-none absolute inset-0 flex select-none items-center justify-center">
                    <span class="text-[280px] font-black leading-none opacity-[0.08] text-(--theme-accent-text)"
                        >{i + 1}</span
                    >
                </div>

                {#if slot.character}
                    <button
                        class="absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-(--theme-input-bg)/50 text-(--theme-muted-text) opacity-0 backdrop-blur-sm transition-all hover:text-(--theme-accent-text) group-hover:opacity-100"
                        onclick={(e) => {
                            e.stopPropagation()
                            resetSlot(i)
                        }}
                    >
                        <Icon icon="mdi:restore" class="size-4" />
                    </button>
                {/if}

                <div class="relative z-1 flex flex-1 flex-col gap-3">
                    <!-- Character -->
                    <div class="flex flex-1 flex-col">
                        <span class="mb-1 block text-sm text-(--theme-muted-text)">角色</span>
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div
                            class={[
                                'flex flex-1 cursor-pointer items-center gap-3 rounded-lg px-4 text-base transition-colors hover:bg-(--theme-input-bg)/80',
                                slot.character
                                    ? 'bg-(--theme-input-bg)/60 backdrop-blur-sm'
                                    : 'border-2 border-dashed border-(--theme-card-border)',
                                !slot.character && !locked ? 'border-2 border-dashed border-(--theme-card-border)' : ''
                            ].join(' ')}
                            onclick={() => openPicker(i, 'character')}
                        >
                            {#if slot.character && characterIcons[slot.character]}
                                <img
                                    src={characterIcons[slot.character]}
                                    alt={slot.character}
                                    use:fallbackIcon={'/icons/placeholder-character.svg'}
                                    class="size-14 shrink-0 rounded-full object-cover"
                                />
                            {/if}
                            <div class="flex flex-col min-w-0 flex-1">
                                <span
                                    class:opacity-40={!slot.character}
                                    class:text-[var(--theme-muted-text)]={!slot.character}
                                >
                                    {slot.character || (locked ? '未设置' : '点击选择')}
                                </span>
                                {#if slot.character}
                                    {@const charData = characterMap.get(slot.character)}
                                    {#if charData}
                                        <span class="flex items-center gap-1.5 text-sm text-(--theme-muted-text)">
                                            {#if elementIcons[charData.element]}
                                                <img
                                                    src={elementIcons[charData.element]}
                                                    alt={charData.element}
                                                    class="size-4 shrink-0"
                                                />
                                            {/if}
                                            {charData.element}
                                            {#if weaponTypeIcons[charData.weaponType]}
                                                <img
                                                    src={weaponTypeIcons[charData.weaponType]}
                                                    alt={charData.weaponType}
                                                    class="size-4 shrink-0 w-icon"
                                                />
                                            {/if}
                                            {charData.weaponType}
                                        </span>
                                    {/if}
                                {/if}
                            </div>
                        </div>
                    </div>

                    <!-- Weapon -->
                    <div class="flex flex-1 flex-col">
                        <span class="mb-1 block text-sm text-(--theme-muted-text)">武器</span>
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div
                            class={[
                                'flex flex-1 cursor-pointer items-center gap-3 rounded-lg px-4 text-base transition-colors hover:bg-(--theme-input-bg)/80',
                                slot.weapon
                                    ? 'bg-(--theme-input-bg)/60 backdrop-blur-sm'
                                    : 'border-2 border-dashed border-(--theme-card-border)',
                                !slot.character && !locked ? 'pointer-events-none opacity-40' : ''
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            onclick={() => openPicker(i, 'weapon')}
                        >
                            {#if slot.weapon && weaponIcons[slot.weapon]}
                                <img
                                    src={weaponIcons[slot.weapon]}
                                    alt={slot.weapon}
                                    use:fallbackIcon={'/icons/placeholder-weapon.svg'}
                                    class="size-14 shrink-0 rounded-lg object-contain bg-(--theme-card-bg)"
                                />
                            {/if}
                            <div class="flex flex-col min-w-0 flex-1">
                                {#if autoRecommending[i]}
                                    <span class="text-(--theme-muted-text)">自动推荐中...</span>
                                {:else}
                                    <span
                                        class:opacity-40={!slot.weapon}
                                        class:text-[var(--theme-muted-text)]={!slot.weapon}
                                    >
                                        {slot.weapon ||
                                            (slot.character ? '点击选择' : locked ? '未设置' : '请先选择角色')}
                                    </span>
                                {/if}
                                {#if slot.weapon}
                                    {@const wpData = weaponMap.get(slot.weapon)}
                                    {#if wpData}
                                        <span class="text-amber-600 text-sm tracking-wider">
                                            {'★'.repeat(wpData.star)}
                                        </span>
                                    {/if}
                                {/if}
                            </div>
                        </div>
                    </div>

                    <!-- First Echo -->
                    <div class="flex flex-1 flex-col">
                        <span class="mb-1 block text-sm text-(--theme-muted-text)">首位声骸</span>
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div
                            class={[
                                'flex flex-1 cursor-pointer items-center gap-3 rounded-lg px-4 text-base transition-colors hover:bg-(--theme-input-bg)/80',
                                slot.echoes[0].name
                                    ? 'bg-(--theme-input-bg)/60 backdrop-blur-sm'
                                    : 'border-2 border-dashed border-(--theme-card-border)',
                                !slot.character && !locked ? 'pointer-events-none opacity-40' : ''
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            onclick={() => openPicker(i, 'echo')}
                        >
                            {#if slot.echoes[0].name && echoIcons[slot.echoes[0].name]}
                                <img
                                    src={echoIcons[slot.echoes[0].name]}
                                    alt={slot.echoes[0].name}
                                    use:fallbackIcon={'/icons/placeholder-echo.svg'}
                                    class="size-14 shrink-0 rounded-lg object-contain bg-(--theme-card-bg)"
                                />
                            {/if}
                            <span
                                class="flex-1 text-base"
                                class:opacity-40={!slot.echoes[0].name}
                                class:text-[var(--theme-muted-text)]={!slot.echoes[0].name}
                            >
                                {slot.echoes[0].name
                                    ? `${slot.echoes[0].name} (C${slot.echoes[0].cost})`
                                    : slot.character
                                      ? '点击选择'
                                      : locked
                                        ? '未设置'
                                        : '请先选择角色'}
                            </span>
                        </div>
                    </div>

                    <!-- Trigger Sets -->
                    <div class="flex flex-1 flex-col">
                        <span class="mb-1 block text-sm text-(--theme-muted-text)">触发套装</span>
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div
                            class={[
                                'flex flex-1 cursor-pointer items-center gap-2 rounded-lg px-4 text-sm transition-colors hover:bg-(--theme-input-bg)/80',
                                slot.triggerSets.length > 0
                                    ? 'bg-(--theme-input-bg)/60 backdrop-blur-sm'
                                    : 'border-2 border-dashed border-(--theme-card-border)',
                                !slot.character && !locked ? 'pointer-events-none opacity-40' : ''
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            onclick={() => openPicker(i, 'sets')}
                        >
                            {#if slot.triggerSets.length > 0}
                                <div class="flex flex-wrap items-center gap-2">
                                    {#each slot.triggerSets as set}
                                        <span
                                            class="inline-flex items-center gap-1 rounded bg-(--theme-input-bg) px-2 py-1 text-sm"
                                        >
                                            {#if echoSetIcons[set.name]}
                                                <img
                                                    src={echoSetIcons[set.name]}
                                                    alt={set.name}
                                                    use:fallbackIcon={'/icons/placeholder-echo-set.svg'}
                                                    class="size-5 shrink-0 rounded"
                                                />
                                            {/if}
                                            {set.name}({set.pieces})
                                        </span>
                                    {/each}
                                </div>
                            {:else}
                                <span
                                    class="flex-1 truncate text-sm"
                                    class:opacity-40={slot.triggerSets.length === 0}
                                    class:text-[var(--theme-muted-text)]={slot.triggerSets.length === 0}
                                >
                                    {slot.character ? '点击选择' : locked ? '未设置' : '请先选择角色'}
                                </span>
                            {/if}
                        </div>
                    </div>
                </div>
            </div>
        {/each}
    </div>
</div>

<CharacterPicker
    open={charPickerOpen}
    onclose={closePicker}
    onselect={handleSelectCharacter}
    {characters}
    icons={characterIcons}
    {elementIcons}
    currentName={currentCharName}
/>

<WeaponPicker
    open={weaponPickerOpen}
    onclose={closePicker}
    onselect={handleSelectWeapon}
    weapons={filteredWeapons}
    icons={weaponIcons}
    currentName={currentWeaponName}
/>

<EchoPicker
    open={echoPickerOpen}
    onclose={closePicker}
    onselect={handleSelectEcho}
    {echoes}
    icons={echoIcons}
    currentName={currentEchoName}
/>

{#if activeSlot}
    <SetPicker
        open={setPickerOpen}
        onclose={closePicker}
        onconfirm={handleConfirmSets}
        {echoSets}
        pinnedSets={pinnedSetNames}
        initialSets={activeSlot.triggerSets}
        icons={echoSetIcons}
    />
{/if}
