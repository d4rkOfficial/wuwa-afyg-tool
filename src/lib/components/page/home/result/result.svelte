<script lang="ts">
    import type { CharSlot, ResultAnalysisData } from '$lib/types/project'
    import type { CalcState } from '$lib/calc/calculation.types'
    import type { ConfigState } from '$lib/calc/config.types'
    import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
    import { getCharacterInfo, getWeaponInfo, getCharacterIcons, getWeaponIcons } from '$lib/api/data-cache'
    import { ensureEchoSkillText, getEchoSkillText } from '$lib/data/char-info.svelte'
    import { getCharElementMap } from '$lib/calc/timeline.store.svelte'
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
    import { ALGORITHMS_INFO } from '$lib/calc/substat-algorithms'
    import type { AlgorithmId, AlgorithmInfo } from '$lib/calc/substat-algorithms/types'
    import { createSubstatAnalysisRunner } from '$lib/calc/substat-algorithms/analysis-runner.svelte'
    import type { SubstatAnalysisRequest } from '$lib/calc/substat-algorithms/analysis'
    import { tick, untrack, onMount, onDestroy } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { registerPanel, unregisterPanel } from '$lib/ai/panels.svelte'
    import { slide } from 'svelte/transition'
    import Icon from '@iconify/svelte'
    import { getComparisonEligibility } from '$lib/calc/comparison'
    import DataAnalysisModal from './data-analysis-modal.svelte'
    import ComparisonModal from './comparison-modal.svelte'
    import DamageTraceView from './damage-trace-view.svelte'
    import type { DamageTraceCtx, CritDisplayMode } from '$lib/calc/damage-trace'

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

    /** @desc 条目的暴击展示口径：按用户勾选（凹暴/不暴）判定，不看数值——
     *  暴击率≥100% 时期望值天然等于全暴击值，用数值反推会把「必暴」误显示成「凹暴」 */
    const critModeOf = (entryId: string): CritDisplayMode =>
        rigCritEntryIds.includes(entryId) ? 'rig' : noCritEntryIds.includes(entryId) ? 'noCrit' : 'expected'

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

            // 声骸技能文案（伤害类型规则2）：先补齐再计算，避免首次结果缺「视为/为 XX 伤害」推导
            const echoNames = team.map((s) => s.echoes?.[0]?.name).filter((n): n is string => !!n)
            await Promise.all(echoNames.map((n) => ensureEchoSkillText(n)))
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

    /** @desc 词条贡献分析执行器：优先 Worker 线程（Shapley/偏导这类重算不阻塞界面），开不了 Worker 时由它回退主线程 */
    const analysisRunner = createSubstatAnalysisRunner()
    /** @desc 请求序号：只接受最新一次的结果，避免快速切换算法时旧结果覆盖新结果 */
    let analysisSeq = 0
    onDestroy(() => {
        analysisRunner.dispose()
        if (analysisTimeoutId) clearTimeout(analysisTimeoutId)
    })

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
            const seq = ++analysisSeq
            // 入参直接用 store 里的对象；runner 发往 Worker 前会自己 $state.snapshot 成纯数据
            const req: SubstatAnalysisRequest = {
                algorithm: selectedAlgorithm,
                damageEntries: dmgEntries,
                buffSets: calc.buffSets,
                damageEntryBuffSetIds: calc.damageEntryBuffSetIds,
                damageEntryDamageTypes: calc.damageEntryDamageTypes,
                configState: config,
                team,
                charInfoMap,
                weaponInfoMap,
                rigCritEntryIds,
                noCritEntryIds,
                missEntryIds,
                conditionProfile: getConditionProfile(),
                echoSkillText: getEchoSkillText()
            }
            analysisRunner.run(req).then(
                (res) => {
                    if (seq !== analysisSeq) return
                    substatAnalysis = res
                    analysisComputing = false
                },
                (err) => {
                    if (seq !== analysisSeq) return
                    analysisComputing = false
                    console.warn('[substat-analysis] 词条贡献分析失败', err)
                }
            )
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
    data-sf="content"
    class="flex h-full flex-col {className}"
    style="color: var(--theme-modal-text); {styleProp || ''}"
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
                    <div class="mb-1 text-[10px] text-(--theme-modal-text)/40">总伤害</div>
                    <div
                        class="text-2xl font-black tabular-nums text-(--theme-accent-text) [text-shadow:0_0_3px_var(--theme-halo-color)]"
                    >
                        {Math.round(totalDamage).toLocaleString()}
                    </div>
                </div>
                {#each charSummaries as cs}
                    <div>
                        <div
                            class="mb-1 text-[10px]"
                            style="color: {cs.character
                                ? `var(--theme-element-${charElements[cs.character]}, #888)`
                                : 'var(--theme-modal-text)'}"
                        >
                            {cs.character || '—'}
                        </div>
                        <div class="text-sm font-black tabular-nums">
                            {Math.round(cs.totalDamage).toLocaleString()}
                        </div>
                    </div>
                {/each}
                <div class="ml-auto flex items-center gap-2">
                    <button
                        onclick={handleOpenAnalysis}
                        class="flex items-center gap-1.5 rounded-none border px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
                        style="background: color-mix(in srgb, var(--theme-accent-bg) 18%, transparent); color: var(--theme-accent-text); border-color: var(--theme-accent-bg);"
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
                        data-sf="card"
                        class="text-(--theme-modal-text)/50 sticky top-0"
                        style="--sf-base: var(--theme-modal-bg); border-bottom: 1px solid var(--theme-divider-border);"
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
                <tbody data-sf="card" style="--sf-base: var(--theme-modal-bg);">
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
                                        class="ml-1 rounded-none px-1 text-[9px] font-medium align-middle"
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
                                class="py-1.5 px-3 text-right tabular-nums font-black"
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
                                            <div class="font-black font-sans text-(--theme-accent-text)">
                                                固定值为 {entry.baseValue.toLocaleString()}
                                            </div>
                                            <div class="font-black font-sans text-(--theme-accent-text)">
                                                最终 = {entry.baseValue.toLocaleString()}
                                            </div>
                                        {:else if entry.baseUnit.startsWith('偏谐系数') || entry.baseUnit === '效应系数'}
                                            <DamageTraceView
                                                {entry}
                                                ctx={traceCtx}
                                                missed={missEntryIds.includes(entry.id)}
                                                critMode={critModeOf(entry.id)}
                                            />
                                            <div
                                                class="shrink-0 self-start inline-flex items-center rounded-none border overflow-hidden"
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
                                                critMode={critModeOf(entry.id)}
                                            />
                                            <div class="flex items-start gap-4">
                                                <div
                                                    class="shrink-0 self-start inline-flex items-center rounded-none border overflow-hidden"
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
