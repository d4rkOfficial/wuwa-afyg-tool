<script lang="ts">
    import type { CharSlot, ResultAnalysisData } from '$lib/data/types'
    import type { CalcState } from '../calculation/calculation.types'
    import type { ConfigState } from '../config/config.types'
    import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
    import { getCharacterInfo, getWeaponInfo, getCharacterIcons, getWeaponIcons } from '$lib/data/api'
    import { getCharElementMap } from '../timeline/timeline.store.svelte'
    import { getAllDamageEntries, getCalcState } from '../calculation/calculation.store.svelte'
    import { getConfig } from '../config/config.store.svelte'
    import { getActiveProject, updateResultAnalysis } from '$lib/data/project.svelte'
    import { computeAll as computeAllDamage } from './compute'
    import type { ResultEntry, CharSubstatAnalysis } from './result.types'
    import { getAlgorithm, ALGORITHMS_INFO } from './substat-algorithms'
    import type { AlgorithmId, AlgorithmInfo } from './substat-algorithms/types'
    import { tick, untrack } from 'svelte'
    import { slide } from 'svelte/transition'
    import Icon from '@iconify/svelte'
    import DataAnalysisModal from './data-analysis-modal.svelte'

    interface Props {
        team: [CharSlot, CharSlot, CharSlot]
        calcState: CalcState | null
        configState: ConfigState | null
        refreshKey?: number
    }

    let { team, calcState, configState, refreshKey = 0 }: Props = $props()

    let charInfoMap = $state<Record<string, CharacterInfo>>({})
    let weaponInfoMap = $state<Record<string, WeaponInfo>>({})
    let charIcons = $state<Record<string, string>>({})
    let weaponIcons = $state<Record<string, string>>({})
    let cleanEntries = $state<ResultEntry[]>([])
    let entries = $state<ResultEntry[]>([])
    let loading = $state(true)
    let charElements = $derived(getCharElementMap())
    let resultAnalysis = $derived(getActiveProject()?.resultAnalysis)
    let rigCritEntryIds = $state<string[]>([])

    $effect(() => {
        calcState
        configState
        loadData()
    })

    $effect(() => {
        if (refreshKey > 0) untrack(() => computeAll())
    })

    async function loadData() {
        loading = true
        try {
            const charNames = team.map((s) => s.character).filter((c): c is string => c !== null)
            const iconResults = await Promise.allSettled([getCharacterIcons(), getWeaponIcons()])
            if (iconResults[0].status === 'fulfilled') charIcons = iconResults[0].value
            if (iconResults[1].status === 'fulfilled') weaponIcons = iconResults[1].value

            const infoPromises = charNames.map((n) => getCharacterInfo(n).catch(() => null))
            const infos = await Promise.all(infoPromises)
            const cmap: Record<string, CharacterInfo> = {}
            for (let i = 0; i < charNames.length; i++) {
                if (infos[i]) cmap[charNames[i]] = infos[i]!
            }
            charInfoMap = cmap

            const weaponNames = team.map((s) => s.weapon).filter((w): w is string => w !== null)
            const wpPromises = weaponNames.map((n) => getWeaponInfo(n).catch(() => null))
            const wpInfos = await Promise.all(wpPromises)
            const wmap: Record<string, WeaponInfo> = {}
            for (let i = 0; i < weaponNames.length; i++) {
                if (wpInfos[i]) wmap[weaponNames[i]] = wpInfos[i]!
            }
            weaponInfoMap = wmap
        } catch {
            /* ignore */
        }
        rigCritEntryIds = getActiveProject()?.resultAnalysis?.rigCritEntryIds ?? []
        computeAll()
        loading = false
    }

    function computeAll() {
        const calc = getCalcState()
        const config = getConfig()
        const dmgEntries = getAllDamageEntries()
        if (dmgEntries.length === 0) {
            cleanEntries = []
            entries = []
            return
        }
        cleanEntries = computeAllDamage(
            dmgEntries,
            calc.buffSets,
            calc.damageEntryBuffSetIds,
            calc.damageEntryDamageTypes,
            config,
            team,
            charInfoMap,
            weaponInfoMap
        )
        applyRigCrit(cleanEntries)
    }

    function applyRigCrit(sourceEntries: ResultEntry[]) {
        const ids = new Set(rigCritEntryIds)
        entries = sourceEntries.map((e) => {
            if (ids.has(e.id)) {
                return { ...e, expectedPerHit: e.critPerHit, totalDamage: e.critPerHit }
            }
            return e
        })
    }

    function toggleRigCrit(id: string) {
        const next = rigCritEntryIds.includes(id) ? rigCritEntryIds.filter((i) => i !== id) : [...rigCritEntryIds, id]
        rigCritEntryIds = next
        updateResultAnalysis({ timings: resultAnalysis?.timings ?? [], rigCritEntryIds: next })
        applyRigCrit(cleanEntries)
    }

    let charSummaries = $derived.by(() => {
        const map = new Map<string, { total: number; count: number }>()
        for (const e of entries) {
            const cur = map.get(e.character) ?? { total: 0, count: 0 }
            cur.total += e.totalDamage
            cur.count++
            map.set(e.character, cur)
        }
        return [...map.entries()].map(([character, d]) => ({ character, totalDamage: d.total, entryCount: d.count }))
    })

    let totalDamage = $derived(charSummaries.reduce((s, c) => s + c.totalDamage, 0))

    let selectedAlgorithm = $state<AlgorithmId>('single-loss')
    let substatAnalysis = $state<CharSubstatAnalysis[]>([])
    let analysisComputing = $state(false)
    let analysisTimeoutId: ReturnType<typeof setTimeout> | null = null

    function scheduleAnalysis() {
        if (analysisTimeoutId) clearTimeout(analysisTimeoutId)
        analysisComputing = true
        analysisTimeoutId = setTimeout(() => {
            const calc = getCalcState()
            const config = getConfig()
            const dmgEntries = getAllDamageEntries()
            if (dmgEntries.length === 0) {
                analysisComputing = false
                return
            }
            const algo = getAlgorithm(selectedAlgorithm)
            substatAnalysis = algo(
                dmgEntries,
                calc.buffSets,
                calc.damageEntryBuffSetIds,
                calc.damageEntryDamageTypes,
                config,
                team,
                charInfoMap,
                weaponInfoMap,
                new Set(rigCritEntryIds)
            )
            analysisComputing = false
        }, 0)
    }

    function handleOpenAnalysis() {
        scheduleAnalysis()
        showDataAnalysis = true
    }

    $effect(() => {
        const _ = selectedAlgorithm
        if (showDataAnalysis) untrack(() => scheduleAnalysis())
    })

    let expandedEntry = $state<string | null>(null)
    let showDataAnalysis = $state(false)
    let tableContainer = $state<HTMLDivElement | undefined>()

    function toggleExpand(id: string, _index: number) {
        const expanding = expandedEntry !== id
        expandedEntry = expanding ? id : null
        if (expanding) {
            tick().then(() => {
                tableContainer
                    ?.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)
                    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            })
        }
    }
</script>

<div class="flex h-full flex-col" style="background: var(--theme-modal-bg); color: var(--theme-modal-text)">
    {#if loading}
        <div class="flex items-center justify-center py-20 text-xs text-(--theme-modal-text)/40">计算中…</div>
    {:else if entries.length === 0}
        <div class="flex items-center justify-center py-20 text-xs text-(--theme-modal-text)/40">暂无伤害数据</div>
    {:else}
        <!-- Summary -->
        <div class="shrink-0 border-b px-5 py-4" style="border-color: var(--theme-divider-border);">
            <div class="flex items-end gap-6">
                <div>
                    <div class="text-[10px] text-(--theme-modal-text)/40 mb-1">总伤害</div>
                    <div class="text-2xl font-bold tabular-nums text-(--theme-accent-text)">
                        {Math.round(totalDamage).toLocaleString()}
                    </div>
                </div>
                {#each charSummaries as cs}
                    <div>
                        <div
                            class="text-[10px] text-(--theme-modal-text)/40 mb-1"
                            style="color: {cs.character
                                ? `var(--theme-element-${charElements[cs.character]}, #888)`
                                : 'var(--theme-modal-text)'}"
                        >
                            {cs.character || '—'}
                        </div>
                        <div class="text-sm font-semibold tabular-nums">
                            {Math.round(cs.totalDamage).toLocaleString()}
                        </div>
                    </div>
                {/each}
                <button
                    onclick={handleOpenAnalysis}
                    class="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
                    style="background: var(--theme-input-bg); color: var(--theme-accent-text);"
                >
                    <Icon icon="mdi:chart-box-outline" class="size-3.5" />
                    数据分析
                </button>
            </div>
        </div>

        <!-- Detail table -->
        <div class="flex-1 overflow-y-auto pb-48" bind:this={tableContainer}>
            <table class="w-full text-xs">
                <thead>
                    <tr
                        class="text-(--theme-modal-text)/50 sticky top-0"
                        style="background: var(--theme-modal-bg); border-bottom: 1px solid var(--theme-divider-border);"
                    >
                        <th class="text-left font-medium py-2 px-3">来源</th>
                        <th class="text-left font-medium py-2 px-3">条目</th>
                        <th class="text-right font-medium py-2 px-3">基础值</th>
                        <th class="text-right font-medium py-2 px-3">单位</th>
                        <th class="text-right font-medium py-2 px-3">倍率</th>
                        <th class="text-right font-medium py-2 px-3">暴击</th>
                        <th class="text-right font-medium py-2 px-3">不暴击</th>
                        <th class="text-right font-medium py-2 px-3">期望</th>
                        <th class="text-right font-medium py-2 px-3 w-8"></th>
                    </tr>
                </thead>
                <tbody>
                    {#each entries as entry, i}
                        <tr
                            onclick={() => toggleExpand(entry.id, i)}
                            data-entry-id={entry.id}
                            class="cursor-pointer border-b transition-colors hover:bg-(--theme-modal-text)/3"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <td
                                class="py-1.5 px-3"
                                style="color: {entry.character
                                    ? `var(--theme-element-${charElements[entry.character]}, #888)`
                                    : 'var(--theme-modal-text)'}">{entry.character || '—'}</td
                            >
                            <td
                                class="py-1.5 px-3 max-w-48 truncate"
                                title={entry.displayName}
                                style="color: var(--theme-element-{entry.element}, #888)"
                            >
                                {entry.displayName}
                            </td>
                            <td class="py-1.5 px-3 text-right tabular-nums text-(--theme-modal-text)/60"
                                >{Math.round(entry.baseValue).toLocaleString()}</td
                            >
                            <td class="py-1.5 px-3 text-right text-(--theme-modal-text)/60">{entry.baseUnit}</td>
                            <td class="py-1.5 px-3 text-right tabular-nums text-(--theme-modal-text)/60"
                                >{((entry.ratioNum / entry.hits) * 100).toFixed(2)}%{#if entry.hits > 1}
                                    ×{entry.hits}{/if}</td
                            >
                            <td class="py-1.5 px-3 text-right tabular-nums text-(--theme-modal-text)/60"
                                >{entry.canCrit ? entry.critPerHit.toLocaleString() : '—'}</td
                            >
                            <td class="py-1.5 px-3 text-right tabular-nums text-(--theme-modal-text)/60"
                                >{entry.canCrit ? entry.nonCritPerHit.toLocaleString() : '—'}</td
                            >
                            <td
                                class="py-1.5 px-3 text-right tabular-nums font-medium"
                                style="color: {rigCritEntryIds.includes(entry.id)
                                    ? 'var(--theme-rigcrit-text)'
                                    : 'var(--theme-accent-text)'}">{entry.expectedPerHit.toLocaleString()}</td
                            >
                            <td class="py-1.5 w-8"></td>
                        </tr>
                        {#if expandedEntry === entry.id}
                            <tr style="background: var(--theme-input-bg);">
                                <td colspan="9" class="p-0">
                                    <div
                                        transition:slide|local={{ duration: 200 }}
                                        class="border-b px-6 py-3 space-y-3 text-xs text-(--theme-modal-text)/60"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        {#if entry.baseUnit === '固定'}
                                            <div class="font-semibold font-sans text-(--theme-accent-text)">
                                                固定值为 {entry.baseValue.toLocaleString()}
                                            </div>
                                            <div class="font-bold font-sans text-(--theme-accent-text)">
                                                最终 = {entry.baseValue.toLocaleString()}
                                            </div>
                                        {:else if entry.baseUnit.startsWith('偏谐系数')}
                                            <div class="font-semibold font-sans text-(--theme-accent-text)">
                                                基础值 = {entry.baseValue.toLocaleString()}
                                            </div>
                                            <div class="font-mono space-y-0.5 pl-3 text-(--theme-modal-text)/60">
                                                <div>
                                                    偏谐系数 {entry.baseAtk.toLocaleString()}
                                                </div>
                                                {#if entry.extraRatio > 0}
                                                    <div>
                                                        × 倍率 ({((entry.ratioNum / entry.hits) * 100).toFixed(2)}% + {entry.extraRatio}%(额外)){#if entry.hits > 1}
                                                            × {entry.hits}
                                                        {/if}
                                                        = {(
                                                            entry.ratioNum * 100 +
                                                            entry.extraRatio * entry.hits
                                                        ).toFixed(2)}% = {entry.baseValue.toLocaleString()}
                                                    </div>
                                                {:else}
                                                    <div>
                                                        × 倍率 {((entry.ratioNum / entry.hits) * 100).toFixed(
                                                            2
                                                        )}%{#if entry.hits > 1}
                                                            × {entry.hits}
                                                        {/if}
                                                        = {entry.baseValue.toLocaleString()}
                                                    </div>
                                                {/if}
                                            </div>
                                            {#if entry.multiplierZones.length}
                                                <div
                                                    class="grid gap-x-6 gap-y-1"
                                                    style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));"
                                                >
                                                    {#each entry.multiplierZones as zone}
                                                        <div
                                                            class="grid grid-cols-[auto_1fr_auto] gap-x-1 items-center"
                                                        >
                                                            <span
                                                                class="font-sans text-right text-(--theme-modal-text)/40"
                                                                >{zone.label}</span
                                                            >
                                                            <span class="text-center font-mono">{zone.detail}</span>
                                                            <span
                                                                class="text-right font-mono text-(--theme-accent-text)"
                                                                >= {zone.value.toFixed(4)}</span
                                                            >
                                                        </div>
                                                    {/each}
                                                </div>
                                            {/if}
                                            <div
                                                class="text-center font-mono text-(--theme-accent-text) pt-1 border-t border-(--theme-divider-border)/30"
                                            >
                                                {entry.baseValue.toLocaleString()}
                                                {#each entry.multiplierZones as zone}
                                                    × {zone.value.toFixed(4)}
                                                {/each}
                                                = {entry.expectedPerHit.toLocaleString()}
                                            </div>
                                            <div class="font-bold font-sans text-(--theme-accent-text)">
                                                最终 = {entry.expectedPerHit.toLocaleString()}
                                            </div>
                                        {:else if entry.baseUnit === '效应系数'}
                                            <div class="font-semibold font-sans text-(--theme-accent-text)">
                                                基础值 = {entry.baseValue.toLocaleString()}
                                            </div>
                                            <div class="font-mono space-y-0.5 pl-3 text-(--theme-modal-text)/60">
                                                <div>
                                                    效应系数 {entry.baseAtk.toLocaleString()}
                                                </div>
                                                {#if entry.extraRatio > 0}
                                                    <div>
                                                        × 倍率 ({((entry.ratioNum / entry.hits) * 100).toFixed(2)}% + {entry.extraRatio}%(额外)){#if entry.hits > 1}
                                                            × {entry.hits}
                                                        {/if}
                                                        = {(
                                                            entry.ratioNum * 100 +
                                                            entry.extraRatio * entry.hits
                                                        ).toFixed(2)}% = {entry.baseValue.toLocaleString()}
                                                    </div>
                                                {:else}
                                                    <div>
                                                        × 倍率 {((entry.ratioNum / entry.hits) * 100).toFixed(
                                                            2
                                                        )}%{#if entry.hits > 1}
                                                            × {entry.hits}
                                                        {/if}
                                                        = {entry.baseValue.toLocaleString()}
                                                    </div>
                                                {/if}
                                            </div>
                                            {#if entry.multiplierZones.length}
                                                <div
                                                    class="grid gap-x-6 gap-y-1"
                                                    style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));"
                                                >
                                                    {#each entry.multiplierZones as zone}
                                                        <div
                                                            class="grid grid-cols-[auto_1fr_auto] gap-x-1 items-center"
                                                        >
                                                            <span
                                                                class="font-sans text-right text-(--theme-modal-text)/40"
                                                                >{zone.label}</span
                                                            >
                                                            <span class="text-center font-mono">{zone.detail}</span>
                                                            <span
                                                                class="text-right font-mono text-(--theme-accent-text)"
                                                                >= {zone.value.toFixed(4)}</span
                                                            >
                                                        </div>
                                                    {/each}
                                                </div>
                                            {/if}
                                            <div
                                                class="text-center font-mono text-(--theme-accent-text) pt-1 border-t border-(--theme-divider-border)/30"
                                            >
                                                {entry.baseValue.toLocaleString()}
                                                {#each entry.multiplierZones as zone}
                                                    × {zone.value.toFixed(4)}
                                                {/each}
                                                = {entry.expectedPerHit.toLocaleString()}
                                            </div>
                                            <div class="font-bold font-sans text-(--theme-accent-text)">
                                                最终 = {entry.expectedPerHit.toLocaleString()}
                                            </div>
                                        {:else}
                                            <!-- Direct damage entry -->
                                            <div class="font-semibold font-sans text-(--theme-accent-text)">
                                                基础值 = {entry.baseValue.toLocaleString()}
                                            </div>
                                            <div class="font-mono space-y-0.5 pl-3 text-(--theme-modal-text)/60">
                                                {#if entry.baseUnit === '攻击'}
                                                    <div>
                                                        基础ATK {entry.baseAtk.toLocaleString()} × (1 + {entry.atkPctSum.toFixed(
                                                            1
                                                        )}%) + {entry.atkFlatSum.toLocaleString()} = {entry.totalAtk.toLocaleString()}
                                                    </div>
                                                {:else if entry.baseUnit === '生命'}
                                                    <div>
                                                        基础HP {entry.baseHp.toLocaleString()} × (1 + {entry.hpPctSum.toFixed(
                                                            1
                                                        )}%) + {entry.hpFlatSum.toLocaleString()} = {entry.totalHp.toLocaleString()}
                                                    </div>
                                                {:else if entry.baseUnit === '防御'}
                                                    <div>
                                                        基础DEF {entry.baseDef.toLocaleString()} × (1 + {entry.defPctSum.toFixed(
                                                            1
                                                        )}%) + {entry.defFlatSum.toLocaleString()} = {entry.totalDef.toLocaleString()}
                                                    </div>
                                                {/if}
                                                {#if entry.extraRatio > 0}
                                                    <div>
                                                        × 倍率 ({((entry.ratioNum / entry.hits) * 100).toFixed(2)}% + {entry.extraRatio}%(额外)){#if entry.hits > 1}
                                                            × {entry.hits}
                                                        {/if}
                                                        = {(
                                                            entry.ratioNum * 100 +
                                                            entry.extraRatio * entry.hits
                                                        ).toFixed(2)}% = {entry.baseValue.toLocaleString()}
                                                    </div>
                                                {:else}
                                                    <div>
                                                        × 倍率 {((entry.ratioNum / entry.hits) * 100).toFixed(
                                                            2
                                                        )}%{#if entry.hits > 1}
                                                            × {entry.hits}
                                                        {/if}
                                                        = {entry.baseValue.toLocaleString()}
                                                    </div>
                                                {/if}
                                            </div>
                                            {#if entry.multiplierZones.length}
                                                <div
                                                    class="grid gap-x-6 gap-y-1"
                                                    style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));"
                                                >
                                                    {#each entry.multiplierZones as zone}
                                                        <div
                                                            class="grid grid-cols-[auto_1fr_auto] gap-x-1 items-center"
                                                        >
                                                            <span
                                                                class="font-sans text-right text-(--theme-modal-text)/40"
                                                                >{zone.label}</span
                                                            >
                                                            <span class="text-center font-mono">{zone.detail}</span>
                                                            <span
                                                                class="text-right font-mono text-(--theme-accent-text)"
                                                                >= {zone.value.toFixed(4)}</span
                                                            >
                                                        </div>
                                                    {/each}
                                                </div>
                                            {/if}
                                            <div
                                                class="text-center font-mono text-(--theme-accent-text) pt-1 border-t border-(--theme-divider-border)/30"
                                            >
                                                {entry.baseValue.toLocaleString()}
                                                {#each entry.multiplierZones as zone}
                                                    × {zone.value.toFixed(4)}
                                                {/each}
                                                = {entry.nonCritPerHit.toLocaleString()}
                                            </div>
                                            <div class="flex items-start gap-4">
                                                <div class="font-sans space-y-0.5 flex-1">
                                                    {#if rigCritEntryIds.includes(entry.id)}
                                                        <div class="font-bold" style="color: var(--theme-rigcrit-text)">
                                                            期望 = 暴击 = {entry.critPerHit.toLocaleString()}
                                                        </div>
                                                    {:else}
                                                        <div>不暴击 = {entry.nonCritPerHit.toLocaleString()}</div>
                                                        <div>
                                                            暴击 = {entry.nonCritPerHit.toLocaleString()} × {(
                                                                entry.critDmg * 100
                                                            ).toFixed(1)}% = {entry.critPerHit.toLocaleString()}
                                                        </div>
                                                        <div class="font-bold" style="color: var(--theme-accent-text)">
                                                            期望 = {entry.nonCritPerHit.toLocaleString()} × (1 + {(
                                                                entry.critRate * 100
                                                            ).toFixed(1)}% × {((entry.critDmg - 1) * 100).toFixed(1)}%)
                                                            = {entry.expectedPerHit.toLocaleString()}
                                                        </div>
                                                    {/if}
                                                </div>
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        toggleRigCrit(entry.id)
                                                    }}
                                                    class="shrink-0 self-start inline-flex items-center gap-1 rounded px-3 py-2 text-sm font-medium transition-colors"
                                                    style="background: {rigCritEntryIds.includes(entry.id)
                                                        ? 'var(--theme-accent-bg)'
                                                        : 'transparent'}; color: {rigCritEntryIds.includes(entry.id)
                                                        ? 'white'
                                                        : 'var(--theme-modal-text)/40'}; border: 1px solid {rigCritEntryIds.includes(
                                                        entry.id
                                                    )
                                                        ? 'transparent'
                                                        : 'var(--theme-divider-border)'}"
                                                >
                                                    <Icon icon="mdi:target" class="size-4" />
                                                    凹暴
                                                </button>
                                            </div>
                                        {/if}
                                    </div>
                                </td>
                            </tr>
                        {/if}
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>

{#if showDataAnalysis && entries.length}
    <DataAnalysisModal
        {entries}
        {charSummaries}
        {team}
        {totalDamage}
        {resultAnalysis}
        {substatAnalysis}
        {analysisComputing}
        algorithmsInfo={ALGORITHMS_INFO}
        {selectedAlgorithm}
        onSelectAlgorithm={(id: AlgorithmId) => (selectedAlgorithm = id)}
        onUpdateResultAnalysis={(data) => updateResultAnalysis(data)}
        onclose={() => (showDataAnalysis = false)}
    />
{/if}
