<script lang="ts">
    import CharacterConfigCard from '$lib/.test/components/shared/CharacterConfigCard.svelte'
    import {
        getCharacterList,
        getWeaponList,
        getEchoList,
        getCharacterIcons,
        getWeaponIcons,
        getEchoIcons,
        getElementIcons,
        getWeaponTypeIcons,
        getEchoSetIcons,
        getEchoSetList
    } from '$lib/data/api'
    import { getTeam, resetTeam } from './store.svelte'
    import type { Character, Weapon, Echo } from '$lib/types'

    let team = getTeam()
    let characters = $state<Character[]>([])
    let weapons = $state<Weapon[]>([])
    let echoes = $state<Echo[]>([])
    let charIconMap = $state<Record<string, string>>({})
    let weaponIconMap = $state<Record<string, string>>({})
    let echoIconMap = $state<Record<string, string>>({})
    let elementIconMap = $state<Record<string, string>>({})
    let weaponTypeIconMap = $state<Record<string, string>>({})
    let echoSetIconMap = $state<Record<string, string>>({})
    let echoSetPiecesMap = $state<Record<string, number[]>>({})
    let loading = $state(true)

    $effect(() => {
        Promise.all([getCharacterList(), getWeaponList(), getEchoList(), getEchoSetList()]).then(
            ([c, w, e, setList]) => {
                characters = c as unknown as Character[]
                weapons = w as unknown as Weapon[]
                echoes = e as unknown as Echo[]
                const epMap: Record<string, number[]> = {}
                for (const s of setList) epMap[s.name] = s.pieces
                echoSetPiecesMap = epMap
                loading = false
            }
        )
        Promise.all([
            getCharacterIcons(),
            getWeaponIcons(),
            getEchoIcons(),
            getElementIcons(),
            getWeaponTypeIcons(),
            getEchoSetIcons()
        ]).then(([cMap, wMap, eMap, elMap, wtMap, esMap]) => {
            charIconMap = cMap
            weaponIconMap = wMap
            echoIconMap = eMap
            elementIconMap = elMap
            weaponTypeIconMap = wtMap
            echoSetIconMap = esMap
        })
    })
</script>

<div class="mx-auto max-w-6xl p-6">
    <div class="mb-6 flex items-center justify-between">
        <div class="flex items-center gap-3">
            <h1 class="text-xl font-bold text-zinc-100">队伍配置</h1>
            {#if loading}
                <span class="text-sm text-zinc-500">加载中…</span>
            {/if}
        </div>
        <div class="flex items-center gap-2">
            <button
                class="h-7 rounded-lg bg-zinc-800 px-3 text-[11px] text-zinc-400 transition-colors hover:bg-red-900/60 hover:text-red-400"
                onclick={() => {
                    if (confirm('重置所有配置？')) resetTeam()
                }}>重置</button
            >
        </div>
    </div>
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {#if loading}
            {#each { length: 3 } as _}
                <div class="animate-pulse rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                    <div class="mb-4 h-24 rounded-md bg-zinc-800/60"></div>
                    <div class="mb-3 h-14 rounded-md bg-zinc-800/40"></div>
                    <div class="h-32 rounded-md bg-zinc-800/60"></div>
                </div>
            {/each}
        {:else}
            {#each team.characters as config, i}
                <CharacterConfigCard
                    index={i + 1}
                    {config}
                    {characters}
                    {weapons}
                    {echoes}
                    {charIconMap}
                    {weaponIconMap}
                    {echoIconMap}
                    {elementIconMap}
                    {weaponTypeIconMap}
                    {echoSetIconMap}
                    {echoSetPiecesMap}
                />
            {/each}
        {/if}
    </div>
</div>
