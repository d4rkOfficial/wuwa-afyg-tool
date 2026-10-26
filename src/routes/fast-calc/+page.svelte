<script lang="ts">
    import Icon from '@iconify/svelte'
    import { onDestroy, onMount } from 'svelte'
    import { computeAll as computeAllDamage, type ConditionProfile } from '$lib/calc/compute'
    import { getAllDamageEntries, getCalcState, getConditionProfile, setConditionProfile } from '$lib/calc/calculation.store.svelte'
    import { getConfig } from '$lib/calc/config.store.svelte'
    import type { ResultEntry } from '$lib/calc/result.types'
    import type { CharSlot, Project } from '$lib/types/project'
    import { getCharacterInfo, getWeaponInfo } from '$lib/api/data-cache'
    import { ensureEchoSkillText } from '$lib/data/char-info.svelte'
    import { ensureCharElements } from '$lib/data/char-elements.svelte'
    import { ensureSkillCache } from '$lib/calc/timeline.store.svelte'
    import { autoConfigureTimings } from '$lib/calc/ref-line-timing'
    import {
        getActiveProject,
        getProjects,
        importProjects,
        loadProjects,
        parseProjectFile,
        setActiveProject
    } from '$lib/data/project.svelte'
    import { reloadActiveProjectStores } from '$lib/data/project-reload'
    import { hideSplash } from '$lib/utils/splash'

    interface SegmentView {
        key: string
        time: string
        start: number
        end: number
        total: number
        dps: number | null
        seconds: number
        entries: ResultEntry[]
    }

    interface ZoneCell {
        value: number
        detail: string
    }

    let project = $state<Project | null>(null)
    let profile = $state<ConditionProfile>({ chains: [0, 0, 0], refinements: [1, 1, 1] })
    let segments = $state<SegmentView[]>([])
    let total = $state(0)
    let loading = $state(false)
    let error = $state('')
    let dragging = $state(false)
    let fileInput: HTMLInputElement | undefined = $state()
    let importMs = $state(0)
    let timings = $state<{ refLineId: string; label: string; seconds: number | null }[]>([])
    let bootPromise: Promise<void> | null = null
    let importingUrl = ''
    let importing = $state(false)

    /** 无导入计时点时，走工具箱原生「参考线记点」自动启用 */
    const resolveTimings = (
        refLines: any[],
        blocks: any[],
        opBlocks: any[],
        imported: { refLineId: string; seconds: number | null }[]
    ) => {
        const refById = new Map(refLines.map((ref) => [ref.id, ref]))
        const posById = new Map<string, number>()
        for (const block of opBlocks) posById.set(block.id, block.pos)
        for (const ref of refLines) posById.set(ref.id, ref.pos)
        const labelOf = (id: string, index: number) => {
            const round = /^round(\d+)$/.exec(id)
            if (round) return `第 ${round[1]} 轮结束`
            if (id === 'end') return '结束'
            const ref = refById.get(id)
            return ref?.time || `参考线 ${index + 1}`
        }
        // 原工程有 analysis.timings 就原样保留；没有时才自动启用参考线记点
        const source = imported.length
            ? imported
            : autoConfigureTimings(refLines, (pos) =>
                blocks.some((block) => (posById.get(block.sourceId) ?? -1) > pos)
            )
        return source.map((timing, index) => ({
            refLineId: timing.refLineId,
            label: labelOf(timing.refLineId, index),
            seconds: timing.seconds
        }))
    }

    /** 双爆区的期望乘子：1 + 暴击率 × (暴伤 - 1) */
    const critZoneValue = (result: ResultEntry): number =>
        result.canCrit ? 1 + result.critRate * (result.critDmg - 1) : 1

    const critZoneDetail = (result: ResultEntry): string =>
        result.canCrit
            ? `暴击 ${(result.critRate * 100).toFixed(1)}% / 暴伤 ${(result.critDmg * 100).toFixed(1)}%`
            : '不可暴击'

    /** 一条伤害的全部乘区；双爆区插在增伤区之后 */
    const zonesOf = (result: ResultEntry): { key: string; cell: ZoneCell }[] => {
        const base = result.multiplierZones.map((zone) => ({
            key: zone.label,
            cell: { value: zone.value, detail: zone.detail }
        }))
        const crit = {
            key: '双爆区',
            cell: { value: critZoneValue(result), detail: critZoneDetail(result) }
        }
        return [...base.slice(0, 2), crit, ...base.slice(2)]
    }

    const zoneCell = (result: ResultEntry, key: string): ZoneCell =>
        zonesOf(result).find((zone) => zone.key === key)?.cell ?? { value: 1, detail: '—' }

    /** 乘区列的展示顺序（与计算式一致） */
    const ZONE_ORDER = [
        '加深区',
        '增伤区',
        '双爆区',
        '易伤区',
        '抗性区',
        '免伤区',
        '防御区',
        '谐度区',
        '集谐区',
        '同奏区',
        '终伤区',
        '特殊区'
    ]

    /** 只保留至少有一条伤害不为 1 的乘区列；列集合取所有条目的并集 */
    const zoneColumns = (entries: ResultEntry[]): { key: string; label: string }[] => {
        if (!entries.length) return []
        const keys: string[] = []
        for (const entry of entries) {
            for (const zone of zonesOf(entry)) {
                if (!keys.includes(zone.key)) keys.push(zone.key)
            }
        }
        return keys
            .filter((key) =>
                entries.some((entry) => Math.abs(zoneCell(entry, key).value - 1) > 1e-9)
            )
            .sort((a, b) => {
                const ai = ZONE_ORDER.indexOf(a)
                const bi = ZONE_ORDER.indexOf(b)
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
            })
            .map((key) => ({ key, label: key }))
    }

    const segmentId = (refLineId: string): string =>
        'segment-' + refLineId.replace(/[^\w-]/g, '_')

    const jumpToSegment = (refLineId: string) => {
        document.getElementById(segmentId(refLineId))?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        })
    }

    const normalizeCondition = (profileValue: ConditionProfile): ConditionProfile => ({
        chains: profileValue.chains.slice(0, 3),
        refinements: profileValue.refinements.slice(0, 3)
    })

    async function recalc() {
        if (!project) return
        loading = true
        error = ''
        try {
            const team = project.team as [CharSlot, CharSlot, CharSlot]
            const charInfoMap: Record<string, any> = {}
            const weaponInfoMap: Record<string, any> = {}
            await Promise.all(
                team.map(async (slot) => {
                    if (slot.character) {
                        const info = await getCharacterInfo(slot.character).catch(() => null)
                        if (info) charInfoMap[slot.character] = info
                    }
                    if (slot.weapon) {
                        const info = await getWeaponInfo(slot.weapon).catch(() => null)
                        if (info) weaponInfoMap[slot.weapon] = info
                    }
                    await Promise.all(
                        (slot.echoes ?? [])
                            .map((echo) => echo.name)
                            .filter((name): name is string => !!name)
                            .map((name) => ensureEchoSkillText(name).catch(() => {}))
                    )
                })
            )
            const entries = getAllDamageEntries()
            const calc = getCalcState()
            const config = getConfig()
            const computeStarted = performance.now()
            const computed = computeAllDamage(
                entries,
                calc.buffSets,
                calc.damageEntryBuffSetIds,
                calc.damageEntryDamageTypes,
                config,
                team,
                charInfoMap,
                weaponInfoMap,
                normalizeCondition(profile)
            )
            const computeMs = performance.now() - computeStarted
            const timeline = project.phases.timeline.data as any
            const blocks = timeline?.damageBlocks ?? []
            const blockById = new Map<string, any>(blocks.map((block: any) => [block.id, block]))
            const refs = new Map<string, any>((timeline?.refLines ?? []).map((ref: any) => [ref.id, ref]))
            const blockToRef = new Map<string, string>(blocks.map((block: any) => [block.id, block.sourceId]))
            // 与工具箱数据分析一致：参考线和操作块都参与位置映射
            const posById = new Map<string, number>()
            for (const block of timeline?.opBlocks ?? []) posById.set(block.id, block.pos)
            for (const ref of refs.values()) posById.set(ref.id, ref.pos)
            const posOf = (entry: ResultEntry): number | null => {
                const target = blockToRef.get(entry.sourceTimelineBlockId) ?? entry.sourceTimelineBlockId
                const pos = posById.get(target)
                return typeof pos === 'number' ? pos : null
            }
            // 与工具箱「数据分析 → 时段 DPS」同口径：按参考线位置窗口切分
            const anchors: { refLineId: string; seconds: number; pos: number }[] = []
            for (const timing of timings) {
                const pos = refs.get(timing.refLineId)?.pos
                if (timing.seconds === null || timing.seconds <= 0 || typeof pos !== 'number') continue
                anchors.push({ refLineId: timing.refLineId, seconds: timing.seconds, pos })
            }
            anchors.sort((a, b) => a.pos - b.pos)
            const built: SegmentView[] = []
            let prevPos = 0
            let prevSeconds = 0
            for (const anchor of anchors) {
                const span = anchor.seconds - prevSeconds
                if (span <= 0) continue
                const list = computed.filter((entry) => {
                    const pos = posOf(entry)
                    return pos !== null && pos >= prevPos && pos < anchor.pos
                })
                const segmentTotal = list.reduce((sum, entry) => sum + entry.totalDamage, 0)
                built.push({
                    key: anchor.refLineId,
                    time: `${prevSeconds.toFixed(1)}s — ${anchor.seconds.toFixed(1)}s`,
                    start: prevSeconds,
                    end: anchor.seconds,
                    total: segmentTotal,
                    dps: segmentTotal / span,
                    seconds: span,
                    entries: list
                })
                prevPos = anchor.pos
                prevSeconds = anchor.seconds
            }
            segments = built
            const duration = anchors.length
                ? anchors[anchors.length - 1].seconds
                : 0
            total = computed.reduce((sum, entry) => sum + entry.totalDamage, 0)
            // 报告页按「同一伤害块」聚合，块 id 与 catalogId 用来和鸣算屋逐技能对齐
            const catalogOf = (result: ResultEntry): string | null => {
                const byId = blockById.get(result.id.split('-')[0])
                const bySource = blockById.get(result.sourceTimelineBlockId) ??
                    blocks.find((block: any) => block.sourceId === result.sourceTimelineBlockId)
                const block = byId ?? bySource
                const catalogId = block?.skillHits?.find((hit: any) => hit.catalogId)?.catalogId
                return catalogId ? String(catalogId) : null
            }
            const reportEntry = (result: ResultEntry) => ({
                id: result.id,
                blockId: result.sourceTimelineBlockId,
                catalogId: catalogOf(result),
                character: result.character,
                name: result.displayName,
                damage: result.totalDamage,
                hits: result.hits,
                fixed: result.baseUnit === '固定',
                zones: {
                    baseMult: result.ratioNum * result.hits,
                    dmgBonus: 1 + result.dmgBonus,
                    deepen: 1 + result.deepen,
                    vulnerability: 1 + result.vulnerability,
                    resistance: result.resMulti,
                    defense: result.defMulti,
                    critRate: result.critRate * 100,
                    critDmg: result.critDmg * 100,
                    critExpect: 1 + result.critRate * (result.critDmg - 1),
                    multBoost: result.customMult,
                    multAdd: result.extraRatio || 0,
                    attack: result.totalAtk,
                    hp: result.totalHp,
                    def: result.totalDef
                }
            })
            const payload = JSON.parse(JSON.stringify({
                type: 'fast-calc:result',
                total,
                duration,
                computeMs,
                entries: computed.map(reportEntry),
                segments: segments.map((segment) => ({
                    time: segment.time,
                    start: segment.start,
                    end: segment.end,
                    total: segment.total,
                    dps: segment.dps,
                    entries: segment.entries.map(reportEntry)
                }))
            }))
            parent.postMessage(payload, '*')
            ;(window as any).__FAST_CALC_RESULT__ = payload
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        } finally {
            loading = false
        }
    }

    async function loadProjectText(text: string) {
        const started = performance.now()
        try {
            error = ''
            await (bootPromise ?? (bootPromise = loadProjects()))
            const parsed = parseProjectFile(text)
            if (!parsed.length) throw new Error('没有识别到工程')
            importProjects(parsed)
            const all = getProjects()
            const active = all[all.length - 1]
            await setActiveProject(active.id)
            const names = active.team
                .map((slot) => slot.character)
                .filter((name): name is string => !!name)
            await Promise.allSettled([ensureCharElements(names), ensureSkillCache(names)])
            reloadActiveProjectStores()
            const loaded = getActiveProject()
            if (!loaded) throw new Error('工程加载失败')
            project = loaded
            // 工程自带的链/阶是准的；store 里可能还留着上一个工程的档位
            const initial = loaded.conditionProfile ?? getConditionProfile()
            profile = normalizeCondition(initial)
            setConditionProfile(profile)
            const timeline = loaded.phases.timeline.data as any
            const refLines = timeline?.refLines ?? []
            const blocks = timeline?.damageBlocks ?? []
            const opBlocks = timeline?.opBlocks ?? []
            timings = resolveTimings(refLines, blocks, opBlocks, loaded.analysis?.timings ?? [])
            await recalc()
            importMs = performance.now() - started
            parent.postMessage({ type: 'fast-calc:project-loaded', name: project?.name ?? '' }, '*')
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
            loading = false
        }
    }

    async function readFile(file: File) {
        await loadProjectText(await file.text())
    }

    async function onDrop(event: DragEvent) {
        event.preventDefault()
        dragging = false
        const file = event.dataTransfer?.files?.[0]
        if (file) await readFile(file)
    }

    async function onMessage(event: MessageEvent) {
        const data = event.data
        if (!data) return
        if (typeof data === 'string') await loadProjectText(data)
        else if (data.type === 'fast-calc:load' && data.project) {
            await loadProjectText(typeof data.project === 'string' ? data.project : JSON.stringify(data.project))
        } else if (data.type === 'fast-calc:recompute') {
            await recalc()
        } else if (data.version && data.project) {
            await loadProjectText(JSON.stringify(data))
        }
    }

    function setChain(index: number, value: number) {
        profile = { ...profile, chains: profile.chains.map((n, i) => i === index ? value : n) }
        setConditionProfile(profile)
        void recalc()
    }

    function setRefinement(index: number, value: number) {
        profile = { ...profile, refinements: profile.refinements.map((n, i) => i === index ? value : n) }
        setConditionProfile(profile)
        void recalc()
    }

    function setTiming(refLineId: string, value: string) {
        const seconds = value === '' ? null : Number(value)
        if (seconds !== null && !Number.isFinite(seconds)) return
        timings = timings.map((timing) =>
            timing.refLineId === refLineId ? { ...timing, seconds } : timing
        )
        if (!project) return
        project = {
            ...project,
            analysis: {
                timings: timings.map((timing) => ({
                    refLineId: timing.refLineId,
                    seconds: timing.seconds
                })),
                ...project.analysis,
                rigCritEntryIds: project.analysis?.rigCritEntryIds,
                noCritEntryIds: project.analysis?.noCritEntryIds,
                missEntryIds: project.analysis?.missEntryIds
            }
        }
        void recalc()
    }

    /** 支持 ?import_project=url；无 URL 值时退回文件选择 */
    function importTarget(): string {
        const query = new URLSearchParams(location.search)
        return query.has('import_project') ? query.get('import_project') ?? '' : ''
    }

    async function openImporter() {
        const target = importTarget()
        if (target) {
            if (target === importingUrl) return
            importingUrl = target
            importing = true
            loading = true
            error = ''
            try {
                const response = await fetch(target, { cache: 'no-store' })
                if (!response.ok) throw new Error(`导入失败：HTTP ${response.status}`)
                await loadProjectText(await response.text())
            } catch (cause) {
                importingUrl = ''
                error = cause instanceof Error ? cause.message : String(cause)
                loading = false
            } finally {
                importing = false
            }
            return
        }
        if (new URLSearchParams(location.search).has('import_project')) {
            setTimeout(() => fileInput?.click(), 50)
        }
    }

    const onHashChange = () => void openImporter()

    onMount(() => {
        hideSplash()
        bootPromise ??= loadProjects()
        window.addEventListener('message', onMessage)
        window.addEventListener('hashchange', onHashChange)
        parent.postMessage({ type: 'fast-calc:ready' }, '*')
        void openImporter()
    })
    onDestroy(() => {
        window.removeEventListener('message', onMessage)
        window.removeEventListener('hashchange', onHashChange)
    })
</script>

<svelte:head>
    <title>{project ? `${project.name} · 快速计算` : '快速计算'} · 椰果工具箱</title>
</svelte:head>

<div class="fast-calc">
    <input
        bind:this={fileInput}
        class="file-input"
        type="file"
        accept=".json,application/json"
        onchange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) void readFile(file)
        }}
    />
    {#if !project}
        {#if importing}
            <div class="import-mask" role="status" aria-live="polite">
                <span class="import-spinner"><Icon icon="mdi:loading" /></span>
                <span>正在导入工程…</span>
            </div>
        {:else}
        <div
            class:active={dragging}
            class="drop-zone"
            role="button"
            tabindex="0"
            onclick={() => fileInput?.click()}
            onkeydown={(event) => event.key === 'Enter' && fileInput?.click()}
            ondragover={(event) => { event.preventDefault(); dragging = true }}
            ondragleave={() => (dragging = false)}
            ondrop={onDrop}
        >
            <span class="eyebrow">FAST CALC</span>
            <strong>拖入工程</strong>
            <span>或点击导入椰果工具箱工程 JSON</span>
            {#if error}<em>{error}</em>{/if}
            {#if loading}<em>正在计算…</em>{/if}
        </div>
        {/if}
    {:else}
        <header class="fast-head">
            <div>
                <span class="eyebrow">FAST CALC / 快速计算</span>
                <h1>{project.name}</h1>
                <p>{loading ? '正在重算…' : `总伤 ${Math.round(total).toLocaleString()}`} {#if importMs > 0}<small>· 导入 {(importMs / 1000).toFixed(2)}s</small>{/if}</p>
            </div>
            <div class="head-actions">
                <button onclick={() => {
                    project = null
                    segments = []
                    timings = []
                    total = 0
                    error = ''
                    setTimeout(() => fileInput?.click(), 0)
                }}>导入另一个工程</button>
            </div>
        </header>

        <section class="profile">
            {#each project.team as slot, index (index)}
                {#if slot.character}
                    <div class="profile-card">
                        <div class="profile-name">{slot.character}</div>
                        <div class="pill-row">
                            <span>链</span>
                            {#each [0, 1, 2, 3, 4, 5, 6] as value}
                                <button class:active={profile.chains[index] === value} onclick={() => setChain(index, value)}>{value}</button>
                            {/each}
                        </div>
                        <div class="pill-row">
                            <span>阶</span>
                            {#each [0, 1, 2, 3, 4, 5] as value}
                                <button class:active={profile.refinements[index] === value} onclick={() => setRefinement(index, value)}>{value}</button>
                            {/each}
                        </div>
                    </div>
                {/if}
            {/each}
        </section>

        <details class="timing-panel" open={!timings.length || timings.some((timing) => timing.seconds === null)}>
            <summary>
                <span>参考线计时</span>
                <small>椰果工具箱以参考线切分时间段；未填写时间的段不计算 DPS</small>
            </summary>
            {#if timings.length}
                <div class="timing-grid">
                    {#each timings as timing, index (timing.refLineId)}
                        <label class="timing-row">
                            <span class="timing-index">{String(index + 1).padStart(2, '0')}</span>
                            <a
                                class="timing-name"
                                href={`#${segmentId(timing.refLineId)}`}
                                title="跳到对应时间段表格"
                                onclick={(event) => {
                                    event.preventDefault()
                                    jumpToSegment(timing.refLineId)
                                }}
                            >{timing.label || `参考线 ${index + 1}`}</a>
                            <span class="timing-input">
                                <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    placeholder="—"
                                    value={timing.seconds ?? ''}
                                    oninput={(event) => setTiming(timing.refLineId, event.currentTarget.value)}
                                />
                                <em>s</em>
                            </span>
                        </label>
                    {/each}
                </div>
            {:else}
                <p class="timing-empty">工程没有参考线，无法切分时间段。</p>
            {/if}
        </details>

        {#if error}<div class="error">{error}</div>{/if}

        <section class="segments">
            {#if !segments.length}<p class="segments-empty">没有可切分的时间段：请在上方填写至少一个晚于 0s 的参考线计时。</p>{/if}
            {#each segments as segment (segment.key)}
                {@const columns = zoneColumns(segment.entries)}
                <article class="segment" id={segmentId(segment.key)}>
                    <header>
                        <div>
                            <span class="eyebrow">{segment.time}</span>
                            <h2>总伤 {Math.round(segment.total).toLocaleString()}</h2>
                        </div>
                        <div class="segment-meta">
                            <b>DPS {segment.dps === null ? '—' : Math.round(segment.dps).toLocaleString()}</b>
                            <small>{segment.seconds.toFixed(2)}s</small>
                        </div>
                    </header>
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>来源</th>
                                    <th>条目</th>
                                    <th>倍率</th>
                                    <th>命中</th>
                                    <th>期望伤害</th>
                                    <th class="num" title="按当前暴击率/暴击伤害计算的单次暴击伤害">暴击伤害</th>
                                    <th class="num" title="不暴击时的单次伤害">不暴击伤害</th>
                                    {#each columns as column (column.key)}
                                        <th class="num">{column.label}</th>
                                    {/each}
                                </tr>
                            </thead>
                            <tbody>
                                {#each segment.entries as result (result.id)}
                                    <tr>
                                        <td>{result.character || '—'}</td>
                                        <td>
                                            <strong>{result.displayName}</strong>
                                            <small>{result.skillType} · {result.damageTypes.join(' / ') || '—'}</small>
                                        </td>
                                        <td class="num">{((result.ratioNum / result.hits) * 100).toFixed(2)}%{#if result.hits > 1} ×{result.hits}{/if}</td>
                                        <td class="num">{result.hits}</td>
                                        <td class="num strong">{Math.round(result.expectedPerHit).toLocaleString()}</td>
                                        <td class="num">{result.canCrit ? Math.round(result.critPerHit).toLocaleString() : '—'}</td>
                                        <td class="num">{Math.round(result.nonCritPerHit).toLocaleString()}</td>
                                        {#each columns as column (column.key)}
                                            {@const cell = zoneCell(result, column.key)}
                                            <td class="num zone-cell">
                                                {#if cell.detail === '—'}
                                                    —
                                                {:else}
                                                    <b>×{cell.value.toFixed(3)}</b>
                                                    <small>{cell.detail}</small>
                                                {/if}
                                            </td>
                                        {/each}
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                </article>
            {/each}
        </section>

    {/if}
</div>

<style>
    .fast-calc { min-height: 100vh; padding: 28px; background: var(--theme-modal-bg, #111418); color: var(--theme-modal-text, #e7edf5); font-family: var(--font-sans, ui-sans-serif, sans-serif); box-sizing: border-box; }
    .drop-zone { max-width: 720px; min-height: 380px; margin: 10vh auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; border: 1.5px dashed var(--theme-divider-border, #39414d); background: var(--theme-input-bg, #1a1e24); cursor: pointer; transition: .2s ease; }
    .drop-zone.active, .drop-zone:hover { border-color: var(--theme-accent-text, #8fd0d7); background: color-mix(in srgb, var(--theme-accent-text, #8fd0d7) 8%, var(--theme-input-bg, #1a1e24)); }
    .file-input { display: none; }
    .import-mask { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: color-mix(in srgb, var(--theme-modal-bg, #111418) 82%, transparent); backdrop-filter: blur(6px); color: var(--theme-modal-text, #e7edf5); font-size: 13px; }
    .import-spinner { width: 30px; height: 30px; color: var(--theme-accent-text, #8fd0d7); animation: import-spin .9s linear infinite; }
    @keyframes import-spin { to { transform: rotate(360deg); } }
    .eyebrow { font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: var(--theme-accent-text, #8fd0d7); }
    .drop-zone strong { font-size: 34px; font-weight: 800; }
    .drop-zone span:not(.eyebrow) { color: var(--theme-modal-text, #e7edf5); opacity: .6; }
    .drop-zone em, .error { color: #f08a80; font-style: normal; font-size: 13px; }
    .fast-head { display: flex; justify-content: space-between; gap: 20px; align-items: flex-end; border-bottom: 2px solid var(--theme-accent-bg, #2a6b72); padding-bottom: 16px; }
    .fast-head h1 { margin: 4px 0; font-size: clamp(34px, 5vw, 58px); line-height: 1; }
    .fast-head p { margin: 0; color: var(--theme-modal-text, #e7edf5); opacity: .65; }
    .fast-head small { opacity: .7; }
    .head-actions button, .pill-row button { border: 1px solid var(--theme-divider-border, #39414d); background: var(--theme-input-bg, #1a1e24); color: inherit; cursor: pointer; }
    .head-actions button { padding: 8px 12px; font-size: 12px; }
    .profile { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 18px 0; }
    .profile-card { padding: 12px; border: 1px solid var(--theme-divider-border, #39414d); background: var(--theme-input-bg, #1a1e24); }
    .profile-name { font-weight: 700; margin-bottom: 8px; }
    .pill-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 6px; }
    .pill-row > span { width: 22px; font-size: 11px; opacity: .5; }
    .pill-row button { min-width: 26px; padding: 3px 6px; font-size: 11px; }
    .pill-row button.active { background: var(--theme-accent-bg, #2a6b72); color: var(--theme-accent-text-on-bg, #fff); border-color: var(--theme-accent-bg, #2a6b72); }
    .timing-panel { margin: 0 0 18px; border: 1px solid var(--theme-divider-border, #39414d); background: var(--theme-input-bg, #1a1e24); }
    .timing-panel summary { display: flex; align-items: baseline; gap: 10px; padding: 10px 14px; cursor: pointer; list-style: none; }
    .timing-panel summary::-webkit-details-marker { display: none; }
    .timing-panel summary > span { font-size: 13px; font-weight: 700; }
    .timing-panel summary > small { font-size: 11px; opacity: .5; }
    .timing-panel summary::after { content: '▾'; margin-left: auto; opacity: .5; font-size: 11px; }
    .timing-panel[open] summary::after { content: '▴'; }
    .timing-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1px; border-top: 1px solid var(--theme-divider-border, #39414d); background: var(--theme-divider-border, #39414d); }
    .timing-row { display: grid; grid-template-columns: 26px minmax(0, 1fr) 76px; align-items: center; gap: 8px; padding: 7px 12px; background: var(--theme-input-bg, #1a1e24); }
    .timing-index { font-size: 10px; opacity: .35; font-variant-numeric: tabular-nums; }
    .timing-name { display: block; font-size: 12px; color: inherit; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px dashed transparent; }
    .timing-name:hover { color: var(--theme-accent-text, #8fd0d7); border-bottom-color: currentColor; }
    .timing-input { display: flex; align-items: center; gap: 2px; }
    .timing-input input { width: 100%; min-width: 0; padding: 3px 6px; border: 1px solid var(--theme-divider-border, #39414d); background: transparent; color: inherit; font: inherit; font-size: 12px; font-variant-numeric: tabular-nums; }
    .timing-input input:focus { outline: none; border-color: var(--theme-accent-bg, #2a6b72); }
    .timing-input em { font-size: 10px; font-style: normal; opacity: .4; }
    .timing-empty { margin: 0; padding: 10px 14px; border-top: 1px solid var(--theme-divider-border, #39414d); font-size: 12px; opacity: .5; }
    .segments { display: flex; flex-direction: column; gap: 18px; }
    .segments-empty { margin: 0; padding: 18px; border: 1px dashed var(--theme-divider-border, #39414d); font-size: 12px; opacity: .6; }
    .segment { border: 1px solid var(--theme-divider-border, #39414d); background: var(--theme-input-bg, #1a1e24); scroll-margin-top: 20px; }
    .segment > header { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; padding: 14px 16px; border-bottom: 1px solid var(--theme-divider-border, #39414d); }
    .segment h2 { margin: 4px 0 0; font-size: 22px; }
    .segment-meta { text-align: right; }
    .segment-meta b { display: block; color: var(--theme-accent-text, #8fd0d7); font-size: 18px; }
    .segment-meta small { opacity: .5; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 1080px; font-size: 12px; }
    th { padding: 8px 10px; text-align: left; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; opacity: .5; border-bottom: 1px solid var(--theme-divider-border, #39414d); white-space: nowrap; }
    td { padding: 8px 10px; border-bottom: 1px solid var(--theme-divider-border, #39414d); vertical-align: top; }
    td small { display: block; opacity: .5; margin-top: 2px; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .strong { color: var(--theme-accent-text, #8fd0d7); font-weight: 700; }
    .zone-cell b { color: var(--theme-accent-text, #8fd0d7); font-weight: 600; }
    .zone-cell small { max-width: 180px; white-space: normal; line-height: 1.25; }
    @media (max-width: 800px) { .fast-calc { padding: 14px; } .fast-head { align-items: flex-start; flex-direction: column; } .profile { grid-template-columns: 1fr; } }
</style>
