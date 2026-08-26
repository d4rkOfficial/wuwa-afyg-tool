<script lang="ts">
    import type { CharSlot, ResultAnalysisData } from '$lib/types/project'
    import type { CalcState, DamageEntry } from '$lib/calc/calculation.types'
    import type { ConfigState } from '$lib/calc/config.types'
    import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
    import { getCharacterInfo, getWeaponInfo, getCharacterIcons, getWeaponIcons } from '$lib/api/data-cache'
    import { getCharElementMap, getRefLines, getOpBlocks } from '$lib/calc/timeline.store.svelte'
    import { buildLoopIntervals, expandDamageEntries } from '$lib/calc/loop-expand'
    import { getActiveProject, updateResultAnalysis, updateComparisonPoints } from '$lib/data/project.svelte'
    import { computeAll as computeAllDamage } from '$lib/calc/compute'
    import {
        getAllDamageEntries,
        getCalcState,
        getConditionProfile,
        getGlobalBuffSetIds
    } from '$lib/calc/calculation.store.svelte'
    import { getConfig } from '$lib/calc/config.store.svelte'
    import type { ResultEntry, CharSummary, CharSubstatAnalysis } from '$lib/calc/result.types'
    import { DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'
    import { getAlgorithm, ALGORITHMS_INFO } from '$lib/calc/substat-algorithms'
    import type { AlgorithmId, AlgorithmInfo } from '$lib/calc/substat-algorithms/types'
    import { tick, untrack, onMount } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { registerPanel, unregisterPanel } from '$lib/ai/panels.svelte'
    import { slide } from 'svelte/transition'
    import Icon from '@iconify/svelte'
    import { getComparisonEligibility } from '$lib/calc/comparison'
    import DataAnalysisModal from './data-analysis-modal.svelte'
    import ComparisonModal from './comparison-modal.svelte'
    import DamageTraceView from './damage-trace-view.svelte'
    import type { DamageTraceCtx } from '$lib/calc/damage-trace'

    interface Props extends ComponentsProps {
        team: [CharSlot, CharSlot, CharSlot]
        calcState: CalcState | null
        configState: ConfigState | null
        refreshKey?: number
    }

    let { team, calcState, configState, refreshKey = 0, class: className, style: styleProp }: Props = $props()

    const RIG_GRAD_TEXT =
        'background: var(--theme-rigcrit-grad); -webkit-background-clip: text; background-clip: text; color: transparent;'
    const NOCRIT_GRAD_TEXT =
        'background: var(--theme-nocrit-grad); -webkit-background-clip: text; background-clip: text; color: transparent;'
    const MISS_TEXT = 'color: var(--theme-modal-text); opacity: 0.45; text-decoration: line-through;'

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
    let noCritEntryIds = $state<string[]>([])
    let missEntryIds = $state<string[]>([])

    // 分段还原/乘区溯源上下文：与 computeAll 同源（拉表/配置 store），保证口径一致
    let traceCtx = $derived<DamageTraceCtx>({
        buffSets: getCalcState().buffSets,
        damageEntryBuffSetIds: getCalcState().damageEntryBuffSetIds,
        damageEntryDamageTypes: getCalcState().damageEntryDamageTypes,
        configState: getConfig(),
        team,
        charInfoMap,
        weaponInfoMap,
        conditionProfile: getConditionProfile()
    })

    $effect(() => {
        calcState
        configState
        loadData()
    })

    $effect(() => {
        if (refreshKey > 0) untrack(() => computeAll())
    })

    // 链/阶档位变化（含从数据分析弹窗打开角色详情配置修改）→ 轻量重算 entries；
    // 数据分析弹窗打开时同步刷新词条贡献分析；指纹避免挂载期与 loadData 重复计算
    let _profileFp = ''
    $effect(() => {
        const p = getConditionProfile()
        const fp = `${p.chains.join(',')}|${p.refinements.join(',')}`
        if (fp === _profileFp) return
        _profileFp = fp
        if (loading) return
        untrack(() => {
            computeAll()
            if (showDataAnalysis) scheduleAnalysis()
        })
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
        noCritEntryIds = getActiveProject()?.resultAnalysis?.noCritEntryIds ?? []
        missEntryIds = getActiveProject()?.resultAnalysis?.missEntryIds ?? []
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
            weaponInfoMap,
            getConditionProfile()
        )
        applyModes(cleanEntries)
    }

    function applyModes(sourceEntries: ResultEntry[]) {
        const rigIds = new Set(rigCritEntryIds)
        const noCritIds = new Set(noCritEntryIds)
        const missIds = new Set(missEntryIds)
        entries = sourceEntries.map((e) => {
            // 未命中优先：该段伤害恒为 0（暴击/不暴击列保留理论值，期望/总伤/基准归零）
            if (missIds.has(e.id)) {
                return { ...e, expectedPerHit: 0, totalDamage: 0, totalDamageRaw: 0 }
            }
            if (rigIds.has(e.id)) {
                return { ...e, expectedPerHit: e.critPerHit, totalDamage: e.critPerHit }
            }
            if (noCritIds.has(e.id)) {
                return { ...e, expectedPerHit: e.nonCritPerHit, totalDamage: e.nonCritPerHit }
            }
            return e
        })
    }

    function setEntryMode(id: string, mode: 'expect' | 'crit' | 'nocrit' | 'miss') {
        let rig = rigCritEntryIds.includes(id) ? rigCritEntryIds.filter((i) => i !== id) : rigCritEntryIds
        let noCrit = noCritEntryIds.includes(id) ? noCritEntryIds.filter((i) => i !== id) : noCritEntryIds
        let miss = missEntryIds.includes(id) ? missEntryIds.filter((i) => i !== id) : missEntryIds
        if (mode === 'crit' && !rig.includes(id)) rig = [...rig, id]
        if (mode === 'nocrit' && !noCrit.includes(id)) noCrit = [...noCrit, id]
        if (mode === 'miss' && !miss.includes(id)) miss = [...miss, id]
        rigCritEntryIds = rig
        noCritEntryIds = noCrit
        missEntryIds = miss
        updateResultAnalysis({
            timings: resultAnalysis?.timings ?? [],
            rigCritEntryIds: rig,
            noCritEntryIds: noCrit,
            missEntryIds: miss
        })
        applyModes(cleanEntries)
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

    // ── 链/阶对比：资格判定 + 复算（取期望 totalDamageRaw，不套凹暴/不暴/未命中模式）──
    let showComparison = $state(false)
    let comparisonPoints = $state<{ chains: number[]; refinements: number[] }[]>(
        getActiveProject()?.comparisonPoints ?? []
    )
    let comparisonEligibility = $derived(
        getComparisonEligibility(
            getCalcState().buffSets,
            getGlobalBuffSetIds(),
            getAllDamageEntries(),
            getCalcState().damageEntryBuffSetIds
        )
    )

    /** @desc 按期望（totalDamageRaw）聚合原始（未套模式）条目为对比口径 */
    function aggregateExpectation(raw: ResultEntry[]): {
        entries: ResultEntry[]
        charSummaries: CharSummary[]
        totalDamage: number
    } {
        const map = new Map<string, { total: number; count: number }>()
        let total = 0
        for (const e of raw) {
            const d = e.totalDamageRaw
            total += d
            const cur = map.get(e.character) ?? { total: 0, count: 0 }
            cur.total += d
            cur.count++
            map.set(e.character, cur)
        }
        return {
            entries: raw,
            charSummaries: [...map.entries()].map(([character, d]) => ({
                character,
                totalDamage: d.total,
                entryCount: d.count
            })),
            totalDamage: total
        }
    }

    /** @desc 对比复算：给定完整队伍链/阶 profile，复算原始期望（不套凹暴/不暴/未命中） */
    function recomputeComparison(chains: number[], refinements: number[]) {
        const calc = getCalcState()
        const config = getConfig()
        const dmgEntries = getAllDamageEntries()
        const modified = {
            chains: [chains[0] ?? 0, chains[1] ?? 0, chains[2] ?? 0],
            refinements: [refinements[0] ?? 0, refinements[1] ?? 0, refinements[2] ?? 0]
        }
        const raw = computeAllDamage(
            dmgEntries,
            calc.buffSets,
            calc.damageEntryBuffSetIds,
            calc.damageEntryDamageTypes,
            config,
            team,
            charInfoMap,
            weaponInfoMap,
            modified
        )
        return aggregateExpectation(raw)
    }

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
                expandDamageEntriesForLoop(dmgEntries),
                calc.buffSets,
                calc.damageEntryBuffSetIds,
                calc.damageEntryDamageTypes,
                config,
                team,
                charInfoMap,
                weaponInfoMap,
                new Set(rigCritEntryIds),
                new Set(noCritEntryIds),
                new Set(missEntryIds),
                getConditionProfile()
            )
            analysisComputing = false
        }, 0)
    }

    /** @desc 按轴循环配置展开伤害条目（循环段条目复制 K 份，与数据分析弹窗同口径；无循环时原样返回） */
    function expandDamageEntriesForLoop(entries: DamageEntry[]): DamageEntry[] {
        const loopCounts = resultAnalysis?.loopCounts ?? {}
        if (!Object.values(loopCounts).some((k) => (k ?? 1) >= 2)) return entries
        const refLines = getRefLines().filter((rl) => rl.id !== 'left')
        const intervals = buildLoopIntervals(resultAnalysis?.timings ?? [], refLines, loopCounts)
        const posMap = new Map<string, number>()
        for (const b of getOpBlocks()) posMap.set(b.id, b.pos)
        for (const rl of refLines) posMap.set(rl.id, rl.pos)
        return expandDamageEntries(entries, posMap, intervals)
    }

    function handleOpenAnalysis() {
        scheduleAnalysis()
        showDataAnalysis = true
    }

    $effect(() => {
        const _ = selectedAlgorithm
        resultAnalysis?.loopCounts
        if (showDataAnalysis) untrack(() => scheduleAnalysis())
    })

    let expandedEntry = $state<string | null>(null)
    let showDataAnalysis = $state(false)

    onMount(() => {
        registerPanel(
            'data-analysis',
            '数据分析',
            () => showDataAnalysis,
            (v) => (showDataAnalysis = v)
        )
        return () => unregisterPanel('data-analysis')
    })
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

<div
    class="flex h-full flex-col {className}"
    style="background: var(--theme-modal-bg); color: var(--theme-modal-text); {styleProp || ''}"
>
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
                <div class="ml-auto flex items-center gap-2">
                    <button
                        onclick={handleOpenAnalysis}
                        class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
                        style="background: var(--theme-input-bg); color: var(--theme-accent-text);"
                    >
                        <Icon icon="mdi:chart-box-outline" class="size-3.5" />
                        数据分析
                    </button>
                </div>
            </div>
        </div>

        <!-- Detail table -->
        <div class="theme-scrollbar snap-scroll-y flex-1 overflow-y-auto pb-48" bind:this={tableContainer}>
            <table class="w-full text-xs">
                <thead>
                    <tr
                        class="text-(--theme-modal-text)/50 sticky top-0"
                        style="background: color-mix(in srgb, var(--theme-modal-bg) 92%, transparent) !important; backdrop-filter: blur(12px) !important; -webkit-backdrop-filter: blur(12px) !important; border-bottom: 1px solid var(--theme-divider-border);"
                    >
                        <th class="text-left font-medium py-2 px-3">来源</th>
                        <th class="text-left font-medium py-2 px-3">条目</th>
                        <th class="text-right font-medium py-2 px-3">倍率</th>
                        <th class="text-right font-medium py-2 px-3">单位</th>
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
                            class="snap-row cursor-pointer border-b transition-colors hover:bg-(--theme-modal-text)/3"
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
                                {#each entry.damageTypes as dt}
                                    <span
                                        class="ml-1 rounded px-1 text-[9px] font-medium align-middle"
                                        style="background: var(--theme-input-bg); color: var(--theme-modal-text)/60;"
                                        >{DAMAGE_TYPE_SHORT[dt] ?? dt}</span
                                    >
                                {/each}
                            </td>
                            <td class="py-1.5 px-3 text-right tabular-nums text-(--theme-modal-text)/60"
                                >{((entry.ratioNum / entry.hits) * 100).toFixed(2)}%{#if entry.hits > 1}
                                    ×{entry.hits}{/if}</td
                            >
                            <td class="py-1.5 px-3 text-right text-(--theme-modal-text)/60">{entry.baseUnit}</td>
                            <td class="py-1.5 px-3 text-right tabular-nums text-(--theme-modal-text)/60"
                                >{entry.canCrit ? entry.critPerHit.toLocaleString() : '—'}</td
                            >
                            <td class="py-1.5 px-3 text-right tabular-nums text-(--theme-modal-text)/60"
                                >{entry.canCrit ? entry.nonCritPerHit.toLocaleString() : '—'}</td
                            >
                            <td
                                class="py-1.5 px-3 text-right tabular-nums font-medium"
                                style={missEntryIds.includes(entry.id)
                                    ? MISS_TEXT
                                    : rigCritEntryIds.includes(entry.id)
                                      ? RIG_GRAD_TEXT
                                      : noCritEntryIds.includes(entry.id)
                                        ? NOCRIT_GRAD_TEXT
                                        : 'color: var(--theme-accent-text)'}>{entry.expectedPerHit.toLocaleString()}</td
                            >
                            <td class="py-1.5 w-8"></td>
                        </tr>
                        {#if expandedEntry === entry.id}
                            <tr style="background: var(--theme-input-bg);">
                                <td colspan="8" class="p-0">
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
                                        {:else if entry.baseUnit.startsWith('偏谐系数') || entry.baseUnit === '效应系数'}
                                            <DamageTraceView
                                                {entry}
                                                ctx={traceCtx}
                                                missed={missEntryIds.includes(entry.id)}
                                            />
                                            <div
                                                class="shrink-0 self-start inline-flex items-center rounded-lg border overflow-hidden"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        setEntryMode(entry.id, 'expect')
                                                    }}
                                                    class="px-3 py-2 text-sm font-medium transition-colors"
                                                    style="background: {!missEntryIds.includes(entry.id)
                                                        ? 'var(--theme-accent-bg)'
                                                        : 'transparent'}; color: {!missEntryIds.includes(entry.id)
                                                        ? 'var(--theme-accent-text-on-bg, #ffffff)'
                                                        : 'var(--theme-modal-text)/40'};"
                                                >
                                                    期望
                                                </button>
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        setEntryMode(entry.id, 'miss')
                                                    }}
                                                    class="px-3 py-2 text-sm font-medium transition-colors border-l"
                                                    title="该段伤害直接归零（未命中）"
                                                    style="background: {missEntryIds.includes(entry.id)
                                                        ? 'color-mix(in srgb, var(--theme-modal-text) 24%, transparent)'
                                                        : 'transparent'}; color: {missEntryIds.includes(entry.id)
                                                        ? 'var(--theme-modal-text)'
                                                        : 'var(--theme-modal-text)/40'}; border-color: var(--theme-divider-border);"
                                                >
                                                    未命中
                                                </button>
                                            </div>
                                        {:else}
                                            <!-- Direct damage entry -->
                                            <DamageTraceView
                                                {entry}
                                                ctx={traceCtx}
                                                missed={missEntryIds.includes(entry.id)}
                                            />
                                            <div class="flex items-start gap-4">
                                                <div
                                                    class="shrink-0 self-start inline-flex items-center rounded-lg border overflow-hidden"
                                                    style="border-color: var(--theme-divider-border);"
                                                >
                                                    <button
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            setEntryMode(entry.id, 'expect')
                                                        }}
                                                        class="px-3 py-2 text-sm font-medium transition-colors"
                                                        style="background: {!rigCritEntryIds.includes(entry.id) &&
                                                        !noCritEntryIds.includes(entry.id) &&
                                                        !missEntryIds.includes(entry.id)
                                                            ? 'var(--theme-accent-bg)'
                                                            : 'transparent'}; color: {!rigCritEntryIds.includes(
                                                            entry.id
                                                        ) &&
                                                        !noCritEntryIds.includes(entry.id) &&
                                                        !missEntryIds.includes(entry.id)
                                                            ? 'var(--theme-accent-text-on-bg, #ffffff)'
                                                            : 'var(--theme-modal-text)/40'};"
                                                    >
                                                        期望
                                                    </button>
                                                    <button
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            setEntryMode(entry.id, 'crit')
                                                        }}
                                                        class="px-3 py-2 text-sm font-medium transition-colors border-l"
                                                        style="background: {rigCritEntryIds.includes(entry.id)
                                                            ? 'var(--theme-rigcrit-grad)'
                                                            : 'transparent'}; color: {rigCritEntryIds.includes(entry.id)
                                                            ? '#ffffff'
                                                            : 'var(--theme-modal-text)/40'}; border-color: var(--theme-divider-border);"
                                                    >
                                                        凹暴
                                                    </button>
                                                    <button
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            setEntryMode(entry.id, 'nocrit')
                                                        }}
                                                        class="px-3 py-2 text-sm font-medium transition-colors border-l"
                                                        style="background: {noCritEntryIds.includes(entry.id)
                                                            ? 'var(--theme-nocrit-grad)'
                                                            : 'transparent'}; color: {noCritEntryIds.includes(entry.id)
                                                            ? '#ffffff'
                                                            : 'var(--theme-modal-text)/40'}; border-color: var(--theme-divider-border);"
                                                    >
                                                        不暴
                                                    </button>
                                                    <button
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            setEntryMode(entry.id, 'miss')
                                                        }}
                                                        class="px-3 py-2 text-sm font-medium transition-colors border-l"
                                                        title="该段伤害直接归零（未命中）"
                                                        style="background: {missEntryIds.includes(entry.id)
                                                            ? 'color-mix(in srgb, var(--theme-modal-text) 24%, transparent)'
                                                            : 'transparent'}; color: {missEntryIds.includes(entry.id)
                                                            ? 'var(--theme-modal-text)'
                                                            : 'var(--theme-modal-text)/40'}; border-color: var(--theme-divider-border);"
                                                    >
                                                        未命中
                                                    </button>
                                                </div>
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
        {rigCritEntryIds}
        {noCritEntryIds}
        comparisonEligible={comparisonEligibility.eligible}
        comparisonReason={comparisonEligibility.reason}
        onCompare={() => {
            // 兄弟弹窗互斥：从数据分析进入对比时关闭数据分析
            showDataAnalysis = false
            showComparison = true
        }}
        onSelectAlgorithm={(id: AlgorithmId) => (selectedAlgorithm = id)}
        onUpdateResultAnalysis={(data) => updateResultAnalysis(data)}
        onclose={() => (showDataAnalysis = false)}
    />
{/if}

{#if showComparison && entries.length}
    <ComparisonModal
        open={showComparison}
        {team}
        timings={resultAnalysis?.timings ?? []}
        loopCounts={resultAnalysis?.loopCounts ?? {}}
        eligibility={comparisonEligibility}
        recompute={recomputeComparison}
        initialPoints={comparisonPoints}
        onBack={(points) => {
            // 返回数据分析弹窗（兄弟互斥）+ 持久化对比配置
            comparisonPoints = points
            void updateComparisonPoints(points)
            showComparison = false
            showDataAnalysis = true
        }}
    />
{/if}
