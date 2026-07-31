<script lang="ts">
    import { onMount, tick } from 'svelte'
    import { goto } from '$app/navigation'
    import {
        loadProjects,
        getProjects,
        getActiveId,
        getActiveProject,
        createProject,
        cloneProject,
        renameProject,
        deleteProject,
        updateTeam,
        updateTimeline,
        updateCalculation,
        updateConfig,
        setActiveProject,
        getPhaseOrder,
        lockPhase,
        unlockPhase,
        importProjects,
        createProjectData,
        buildExportFile,
        parseImportFile
    } from '$lib/data/project.svelte'
    import { checkShare, shareProject } from '$lib/data/share.svelte'
    import { getWWVersion, ensureVersion, resetVersionPromise } from '$lib/api/consts'
    import { clearCache } from '$lib/data/api'
    import { browser } from '$app/environment'
    import type { PhaseKey, CharSlot } from '$lib/data/types'
    import type { TimelineData } from '$lib/components/page/home/timeline/timeline.types'
    import type { CalcState } from '$lib/components/page/home/calculation/calculation.types'
    import type { ConfigState } from '$lib/components/page/home/config/config.types'
    import { PHASE_LABELS } from '$lib/consts/game-terms'
    import { addToast } from '$lib/data/toast.svelte'
    import { preloadCharElements } from '$lib/data/char-elements.svelte'
    import {
        loadIcons,
        setShowDamageList,
        loadCustomHits,
        init as initTimeline
    } from '$lib/components/page/home/timeline/timeline.store.svelte'
    import {
        setShowBuffModal,
        getBuffDiffMode,
        toggleBuffDiffMode,
        syncGlobalBuffs,
        getCalcState,
        createBuffSet,
        init as initCalculation
    } from '$lib/components/page/home/calculation/calculation.store.svelte'
    import { getConfig, init as initConfig } from '$lib/components/page/home/config/config.store.svelte'
    import favicon from '$lib/assets/favicon.svg'
    import ProjectSidebar from '$lib/components/page/home/project-sidebar.svelte'
    import WorkshopModal from '$lib/components/page/home/workshop-modal.svelte'
    import TeamConfig from '$lib/components/page/home/team-config.svelte'
    import Timeline from '$lib/components/page/home/timeline/timeline.svelte'
    import Calculation from '$lib/components/page/home/calculation/calculation.svelte'
    import Config from '$lib/components/page/home/config/config.svelte'
    import StatOverview from '$lib/components/page/home/config/stat-overview.svelte'
    import Result from '$lib/components/page/home/result/result.svelte'
    import PhaseTabs from '$lib/components/page/home/phase-tabs.svelte'
    import QuickLookup from '$lib/components/page/home/calculation/quick-lookup.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import Icon from '@iconify/svelte'

    let showNewModal = $state(false)
    let newName = $state('')
    let showResult = $state(false)

    let sidebarWidth = $state(240)
    let sidebarDragging = $state(false)

    $effect(() => {
        if (!sidebarDragging) return
        const onMove = (e: MouseEvent) => {
            sidebarWidth = e.clientX <= 144 ? 52 : Math.max(200, Math.min(400, e.clientX))
        }
        const onUp = () => {
            sidebarDragging = false
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
    })

    let showLookup = $state(false)
    let showStatOverview = $state(false)
    let resultRefreshKey = $state(0)
    let renameModal = $state(false)
    let renameId = $state('')
    let renameValue = $state('')

    let cloneModal = $state(false)
    let cloneId = $state('')
    let cloneName = $state('')
    let cloneSelections = $state<Record<PhaseKey, boolean>>({
        team: true,
        timeline: false,
        calculation: false,
        config: false
    })
    let cloneResult = $state(false)

    let deleteModal = $state(false)
    let deleteId = $state('')
    let deleteName = $state('')

    let exportModal = $state(false)
    let exportId = $state('')
    let exportSelections = $state<Record<PhaseKey, boolean>>({
        team: true,
        timeline: false,
        calculation: false,
        config: false
    })
    let exportResult = $state(false)

    let importInput = $state<HTMLInputElement | undefined>()

    let activePhase = $state<PhaseKey>('team')

    onMount(async () => {
        await ensureVersion()
        if (browser) {
            const prev = localStorage.getItem('wuwa-afyg:version')
            if (prev && prev !== getWWVersion()) {
                clearCache()
            }
            localStorage.setItem('wuwa-afyg:version', getWWVersion())
        }
        loadProjects()
        loadIcons()
        checkShare()
    })

    let projects = $derived(getProjects())
    let activeId = $derived(getActiveId())
    let activeProject = $derived(getActiveProject())

    $effect(() => {
        if (activeProject) loadCustomHits(activeProject.customSkillHits ?? {})
    })

    $effect(() => {
        const names = new Set<string>()
        for (const p of projects) {
            for (const s of p.team) {
                if (s.character) names.add(s.character)
            }
            if (p.lockedTeamNames) {
                for (const n of p.lockedTeamNames) names.add(n)
            }
        }
        if (names.size > 0) {
            preloadCharElements([...names])
        }
    })

    function handleCreate(name: string) {
        if (!name.trim()) return
        createProject(name.trim())
        showNewModal = false
        newName = ''
        initForActiveProject()
        addToast(`项目「${name.trim()}」已创建`, 'success')
    }

    function openRename(id: string) {
        const p = projects.find((pr) => pr.id === id)
        if (!p) return
        renameId = id
        renameValue = p.name
        renameModal = true
    }

    function handleRename() {
        if (!renameValue.trim()) return
        renameProject(renameId, renameValue.trim())
        renameModal = false
        addToast('项目已重命名', 'success')
    }

    function openClone(id: string) {
        const p = projects.find((pr) => pr.id === id)
        if (!p) return
        cloneId = id
        cloneName = `${p.name} (副本)`

        const order = getPhaseOrder()
        const atIdx = order.indexOf(activePhase)
        const selections: Record<PhaseKey, boolean> = {
            team: false,
            timeline: false,
            calculation: false,
            config: false
        }
        for (let i = 0; i < order.length; i++) {
            selections[order[i]] = i <= atIdx
        }
        cloneSelections = selections

        cloneResult = false
        cloneModal = true
    }

    async function handleClone() {
        if (!cloneName.trim()) return
        const selected = (Object.entries(cloneSelections) as [PhaseKey, boolean][]).filter(([, v]) => v).map(([k]) => k)
        if (cloneResult) selected.push('result' as never)
        const p = await cloneProject(cloneId, cloneName.trim(), selected)
        if (p) {
            cloneModal = false
            const firstUnchecked = getPhaseOrder().find((ph) => !cloneSelections[ph]) ?? 'config'
            activePhase = firstUnchecked
            addToast(`已克隆为「${p.name}」`, 'success')
        }
    }

    function openDelete(id: string) {
        const p = projects.find((pr) => pr.id === id)
        if (!p) return
        deleteId = id
        deleteName = p.name
        deleteModal = true
    }

    function handleDelete() {
        deleteProject(deleteId)
        deleteModal = false
        addToast('项目已删除', 'info')
    }

    function goHome() {
        setActiveProject('')
        activePhase = 'team'
    }

    function openExport(id: string) {
        exportId = id
        const order = getPhaseOrder()
        const selections: Record<PhaseKey, boolean> = {
            team: false,
            timeline: false,
            calculation: false,
            config: false
        }
        for (let i = 0; i < order.length; i++) selections[order[i]] = i <= order.indexOf(activePhase)
        exportSelections = selections
        exportResult = false
        exportModal = true
    }

    function toggleExportPhase(phase: PhaseKey) {
        const order = getPhaseOrder()
        const idx = order.indexOf(phase)
        const next = !exportSelections[phase]
        const updated: Record<string, boolean> = {}
        for (const p of order) {
            const pidx = order.indexOf(p)
            if (next && pidx <= idx) updated[p] = true
            else if (!next && pidx >= idx) updated[p] = false
            else updated[p] = exportSelections[p]
        }
        exportSelections = updated as Record<PhaseKey, boolean>
    }

    function handleExport() {
        const p = projects.find((pr) => pr.id === exportId)
        if (!p) return
        const selected = (Object.entries(exportSelections) as [PhaseKey, boolean][])
            .filter(([, v]) => v)
            .map(([k]) => k)
        const file = buildExportFile(p, selected, exportResult)
        const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${p.name}.json`
        a.click()
        URL.revokeObjectURL(url)
        exportModal = false
        addToast(`项目「${p.name}」已导出`, 'success')
    }

    function handleImport() {
        const file = importInput?.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
            try {
                const normalized = parseImportFile(reader.result as string)
                importProjects(normalized)
                addToast(`成功导入 ${normalized.length} 个项目`, 'success')
            } catch {
                addToast('导入失败：文件格式错误', 'error')
            }
        }
        reader.readAsText(file)
        if (importInput) importInput.value = ''
    }

    function handleSelectProject(id: string) {
        setActiveProject(id)
        initForActiveProject()
    }

    let showWorkshop = $state(false)

    async function handleShare(id: string) {
        const p = projects.find((pr) => pr.id === id)
        if (!p) return
        const res = await shareProject(p)
        if (!res.ok || !res.url) {
            addToast(res.error ?? '分享失败', 'error')
            return
        }
        try {
            await navigator.clipboard.writeText(res.url)
            addToast(`已分享(10分钟)：${res.url}（链接已复制）`, 'success')
        } catch {
            addToast(`已分享(10分钟)：${res.url}`, 'success')
        }
    }

    function initForActiveProject() {
        setShowBuffModal(false)
        const p = getActiveProject()
        if (!p) {
            activePhase = 'team'
            return
        }
        initTimeline(
            p.phases.timeline.data as TimelineData | null,
            () => {},
            p.team,
            p.phases.timeline?.locked ?? false
        )
        initCalculation(
            p.team,
            p.phases.timeline.data as TimelineData | null,
            p.phases.calculation.data as CalcState | null,
            p.phases.calculation?.locked ?? false,
            (state) => updateCalculation(state)
        )
        initConfig(p.phases.config.data as ConfigState | null, p.phases.config?.locked ?? false)
        const order = getPhaseOrder()
        let lastLocked = -1
        for (let i = order.length - 1; i >= 0; i--) {
            if (p.phases[order[i]]?.locked === true) {
                lastLocked = i
                break
            }
        }
        if (lastLocked < 0) {
            activePhase = 'team'
        } else if (lastLocked === order.length - 1) {
            showResult = true
        } else {
            activePhase = order[lastLocked + 1]
        }
    }

    let teamPhaseLocked = $derived(activeProject?.phases.team?.locked ?? false)
    let allPhasesLocked = $derived(
        activeProject ? getPhaseOrder().every((p) => activeProject!.phases[p]?.locked === true) : false
    )

    function toggleClonePhase(phase: PhaseKey) {
        const order = getPhaseOrder()
        const idx = order.indexOf(phase)
        const next = !cloneSelections[phase]
        const updated: Record<string, boolean> = {}
        for (const p of order) {
            const pidx = order.indexOf(p)
            if (next && pidx <= idx) {
                updated[p] = true
            } else if (!next && pidx >= idx) {
                updated[p] = false
            } else {
                updated[p] = cloneSelections[p]
            }
        }
        cloneSelections = updated as Record<PhaseKey, boolean>
    }

    let phaseLocked = $derived(activeProject?.phases[activePhase]?.locked ?? false)
    let canLock = $derived.by(() => {
        if (phaseLocked) return false
        const idx = getPhaseOrder().indexOf(activePhase)
        if (idx === 0) return activeProject ? isTeamComplete(activeProject.team) : false
        return activeProject?.phases[getPhaseOrder()[idx - 1]]?.locked === true
    })

    function isTeamComplete(team: [CharSlot, CharSlot, CharSlot]): boolean {
        return team.some((s) => s.character !== null && s.weapon !== null)
    }

    function handleUpdateTeam(team: [CharSlot, CharSlot, CharSlot]) {
        updateTeam(team)
    }

    function handleResetTeam() {
        if (!activeProject) return
        unlockPhase(activeProject.id, 'team')
    }

    function handleLockPhase() {
        if (!activeProject) return
        lockPhase(activePhase)
        if (activePhase === 'timeline') {
            syncGlobalBuffs(activeProject.team.map((s) => s.character))
            updateCalculation(getCalcState())
        }
        if (activePhase === 'config') {
            updateConfig(getConfig())
        }
        addToast(`${PHASE_LABELS[activePhase]} 已锁定`, 'success')
    }

    function handleUnlockPhase() {
        if (!activeProject) return
        unlockPhase(activeProject.id, activePhase)
        addToast(`${PHASE_LABELS[activePhase]} 已解锁`, 'info')
    }

    function handleUnlockTab(phase: PhaseKey) {
        if (!activeProject) return
        unlockPhase(activeProject.id, phase)
        activePhase = phase
        showResult = false
        addToast(`${PHASE_LABELS[phase]} 已解锁`, 'info')
    }

    function handleLockTab(phase: PhaseKey) {
        if (!activeProject) return
        const idx = getPhaseOrder().indexOf(phase)
        if (idx === 0 && !isTeamComplete(activeProject.team)) return
        if (idx > 0 && !activeProject.phases[getPhaseOrder()[idx - 1]]?.locked) return
        lockPhase(phase)
        if (phase === 'timeline') {
            syncGlobalBuffs(activeProject.team.map((s) => s.character))
            updateCalculation(getCalcState())
        }
        if (phase === 'config') {
            updateConfig(getConfig())
        }
        addToast(`${PHASE_LABELS[phase]} 已锁定`, 'success')
    }
</script>

<div class="flex h-dvh overflow-hidden bg-(--theme-layout-bg) text-(--theme-layout-text)">
    <ProjectSidebar
        {projects}
        {activeId}
        width={sidebarWidth}
        dragging={sidebarDragging}
        oncreate={() => {
            newName = ''
            showNewModal = true
        }}
        onimport={() => importInput?.click()}
        onhome={goHome}
        onworkshop={() => (showWorkshop = true)}
        onshare={handleShare}
        onrename={openRename}
        onclone={openClone}
        onexport={openExport}
        ondelete={openDelete}
        onselect={handleSelectProject}
    />
    <button
        aria-label="调整侧栏宽度"
        class="shrink-0 w-1 cursor-col-resize transition-colors hover:bg-(--theme-accent-bg)/50"
        style="background: transparent;"
        onmousedown={(e) => {
            e.preventDefault()
            if (sidebarWidth === 52) sidebarWidth = 200
            sidebarDragging = true
        }}
    ></button>
    <input type="file" accept=".json" class="hidden" bind:this={importInput} onchange={handleImport} />

    <div class="flex flex-1 flex-col overflow-hidden">
        {#if !activeProject}
            <div class="flex flex-1 flex-col items-center justify-center gap-6 px-8">
                <div class="text-center">
                    <img src={favicon} alt="椰果工具箱" class="mx-auto mb-4 size-12" />
                    <h2 class="mb-2 text-lg font-semibold">椰果工具箱</h2>
                    <p class="text-sm text-(--theme-muted-text)">
                        鸣潮社区公益工具！ 游戏数据版本:{getWWVersion()}
                    </p>
                </div>
                <div class="grid w-full max-w-2xl gap-4 sm:grid-cols-3">
                    <button
                        onclick={() => {
                            newName = ''
                            showNewModal = true
                        }}
                        class="group flex flex-col items-start gap-3 rounded-2xl border border-(--theme-card-border) bg-(--theme-card-bg) p-6 text-left transition-all hover:-translate-y-0.5 hover:bg-(--theme-card-bg-focused)"
                    >
                        <Icon icon="mdi:plus" class="size-8 text-(--theme-accent-text)" />
                        <div class="flex flex-col gap-1">
                            <span class="text-base font-semibold text-(--theme-card-text)">创建工程</span>
                            <span class="text-sm text-(--theme-muted-text)">从空白开始，配置配队、排轴与伤害计算</span>
                        </div>
                    </button>
                    <button
                        onclick={() => goto('/api-test')}
                        class="group flex flex-col items-start gap-3 rounded-2xl border border-(--theme-card-border) bg-(--theme-card-bg) p-6 text-left transition-all hover:-translate-y-0.5 hover:bg-(--theme-card-bg-focused)"
                    >
                        <Icon icon="mdi:api" class="size-8 text-(--theme-accent-text)" />
                        <div class="flex flex-col gap-1">
                            <span class="text-base font-semibold text-(--theme-card-text)">接口测试</span>
                            <span class="text-sm text-(--theme-muted-text)">调试游戏数据接口与工具 API</span>
                        </div>
                    </button>
                    <button
                        onclick={() => (showWorkshop = true)}
                        class="group flex flex-col items-start gap-3 rounded-2xl border border-(--theme-card-border) bg-(--theme-card-bg) p-6 text-left transition-all hover:-translate-y-0.5 hover:bg-(--theme-card-bg-focused)"
                    >
                        <Icon icon="mdi:storefront-outline" class="size-8 text-(--theme-accent-text)" />
                        <div class="flex flex-col gap-1">
                            <span class="text-base font-semibold text-(--theme-card-text)">椰果工坊</span>
                            <span class="text-sm text-(--theme-muted-text)">浏览社区分享的拉表排轴工程并导入</span>
                        </div>
                    </button>
                </div>
            </div>
        {:else if activeProject}
            <PhaseTabs
                project={activeProject}
                active={activePhase}
                {showResult}
                onchange={(k) => {
                    activePhase = k
                    showResult = false
                }}
                resultEnabled={teamPhaseLocked}
                onresult={() => (showResult = true)}
                onunlock={handleUnlockTab}
                onlock={handleLockTab}
            />

            <div class="flex-1 overflow-hidden relative">
                {#if showResult}
                    <Result
                        team={activeProject.team}
                        calcState={activeProject.phases.calculation.data as CalcState | null}
                        configState={activeProject.phases.config.data as ConfigState | null}
                        refreshKey={resultRefreshKey}
                    />
                {:else if activePhase === 'team'}
                    <TeamConfig
                        team={activeProject.team}
                        onupdate={handleUpdateTeam}
                        onreset={handleResetTeam}
                        locked={teamPhaseLocked}
                    />
                {:else if activePhase === 'timeline'}
                    <Timeline
                        team={activeProject.team}
                        locked={phaseLocked}
                        data={activeProject.phases.timeline.data as TimelineData | null}
                        onupdate={(data) => updateTimeline(data)}
                    />
                {:else if activePhase === 'calculation'}
                    <Calculation
                        team={activeProject.team}
                        timelineData={activeProject.phases.timeline.data as TimelineData | null}
                        calcState={activeProject.phases.calculation.data as CalcState | null}
                        locked={phaseLocked}
                        onupdate={(state) => updateCalculation(state)}
                    />
                {:else}
                    <Config
                        team={activeProject.team}
                        data={activeProject.phases.config.data as ConfigState | null}
                        locked={phaseLocked}
                        onupdate={(state) => updateConfig(state)}
                    />
                {/if}
                {#if showStatOverview}
                    <StatOverview
                        team={activeProject.team}
                        configState={activeProject.phases.config.data as ConfigState | null}
                        calcState={activeProject.phases.calculation.data as CalcState | null}
                        onclose={() => (showStatOverview = false)}
                    />
                {/if}
                {#if !showResult && phaseLocked}
                    <div
                        class="absolute inset-0 z-40 flex items-center justify-center pointer-events-none select-none"
                        style="background: var(--theme-watermark-bg, rgba(0,0,0,0.1))"
                    >
                        <div
                            class="flex items-center gap-6 text-[7.5rem] font-bold tracking-widest"
                            style="transform: rotate(-30deg); color: var(--theme-watermark-text, rgba(255,255,255,0.1))"
                        >
                            <Icon icon="mdi:lock" class="size-32" />
                            已锁定
                        </div>
                    </div>
                {/if}
            </div>

            <div
                class="flex shrink-0 items-center gap-2 border-t border-white/5 px-4 py-2.5"
                style="background: var(--theme-sidebar-bg); color: var(--theme-sidebar-text)"
            >
                {#if !showResult}
                    <button
                        onclick={() => (showLookup = true)}
                        disabled={!teamPhaseLocked}
                        class="inline-flex items-center gap-1.5 rounded-lg border border-(--theme-sidebar-text)/20 px-3 py-1.5 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 disabled:opacity-40 disabled:pointer-events-none"
                    >
                        <Icon icon="mdi:book-search-outline" class="size-4 shrink-0" />
                        速查
                    </button>
                    {#if activePhase === 'timeline'}
                        <button
                            onclick={() => setShowDamageList(true)}
                            class="inline-flex items-center gap-1.5 rounded-lg border border-(--theme-sidebar-text)/20 px-3 py-1.5 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40"
                        >
                            <Icon icon="mdi:chart-box-outline" class="size-4 shrink-0" />
                            查看所有伤害
                        </button>
                    {/if}
                    {#if activePhase === 'calculation'}
                        <button
                            onclick={() => setShowBuffModal(true)}
                            class="inline-flex items-center gap-1.5 rounded-lg border border-(--theme-sidebar-text)/20 px-3 py-1.5 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40"
                        >
                            <Icon icon="mdi:tune-variant" class="size-4 shrink-0" />
                            BUFF配置
                        </button>
                        <button
                            onclick={toggleBuffDiffMode}
                            class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors {getBuffDiffMode()
                                ? 'border-(--theme-accent-bg)'
                                : 'border-(--theme-sidebar-text)/20'}"
                            style="color: {getBuffDiffMode()
                                ? 'var(--theme-accent-text)'
                                : 'var(--theme-sidebar-text)'}"
                        >
                            <Icon
                                icon={getBuffDiffMode() ? 'mdi:swap-vertical-bold' : 'mdi:swap-vertical'}
                                class="size-4 shrink-0"
                            />
                            {getBuffDiffMode() ? 'Buff: DIFF' : 'Buff: ALL'}
                        </button>
                    {/if}
                    {#if activePhase === 'config'}
                        <button
                            onclick={() => (showStatOverview = true)}
                            class="inline-flex items-center gap-1.5 rounded-lg border border-(--theme-sidebar-text)/20 px-3 py-1.5 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40"
                        >
                            <Icon icon="mdi:account-details" class="size-4 shrink-0" />
                            角色面板总览
                        </button>
                    {/if}
                {:else}
                    <button
                        onclick={async () => {
                            showResult = false
                            activePhase = 'team'
                            await tick()
                            activePhase = 'timeline'
                            await tick()
                            activePhase = 'calculation'
                            await tick()
                            activePhase = 'config'
                            await tick()
                            showResult = true
                            resultRefreshKey++
                        }}
                        class="inline-flex items-center gap-1.5 rounded-lg border border-(--theme-sidebar-text)/20 px-3 py-1.5 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40"
                    >
                        <Icon icon="mdi:refresh" class="size-4 shrink-0" />
                        刷新结果
                    </button>
                {/if}
                <div class="flex-1"></div>
                {#if !showResult}
                    <button
                        onclick={phaseLocked ? handleUnlockPhase : handleLockPhase}
                        disabled={!phaseLocked && !canLock}
                        class="inline-flex items-center gap-1.5 rounded-lg border border-(--theme-sidebar-text)/20 px-3 py-1.5 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 disabled:opacity-40 disabled:pointer-events-none"
                    >
                        <Icon
                            icon={phaseLocked ? 'mdi:lock-open-variant-outline' : 'mdi:lock-outline'}
                            class="size-4 shrink-0"
                        />
                        {phaseLocked ? '解锁' : '锁定'}
                    </button>
                {/if}
            </div>
        {/if}
    </div>
</div>

{#if activeProject}
    <QuickLookup
        open={showLookup}
        team={activeProject.team}
        showBuffOption={activePhase === 'calculation'}
        showCustomHitOption={false}
        onCreateBuff={(name) => {
            createBuffSet(name)
            showLookup = false
            setShowBuffModal(true)
        }}
        onclose={() => (showLookup = false)}
    />
{/if}

<svelte:head><title>椰果工具箱</title></svelte:head>

<WorkshopModal open={showWorkshop} onclose={() => (showWorkshop = false)} />

<svelte:window
    onkeydown={(e) => {
        if (e.key === 'Escape') {
            showNewModal = false
            renameModal = false
            cloneModal = false
            deleteModal = false
        }
    }}
/>

<!-- New Project Modal -->
{#if showNewModal}
    <Modal open={true} onclose={() => (showNewModal = false)}>
        {#snippet title()}
            新建项目
        {/snippet}
        <div class="space-y-4">
            <div>
                <label for="project-name" class="mb-1 block text-xs text-zinc-500">项目名称</label>
                <input
                    id="project-name"
                    bind:value={newName}
                    placeholder="输入项目名称"
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-700 focus:border-(--theme-accent-bg)/50"
                    style="background: var(--theme-search-box-bg); color: var(--theme-search-box-text)"
                    onkeydown={(e) => e.key === 'Enter' && handleCreate(newName)}
                />
            </div>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (showNewModal = false)}
                    class="h-7 rounded-md bg-(--theme-card-bg) px-3 text-xs text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
                    >取消</button
                >
                <button
                    disabled={!newName.trim()}
                    onclick={() => handleCreate(newName)}
                    class="h-7 rounded-md px-3 text-xs transition-all hover:brightness-125 disabled:opacity-40 disabled:pointer-events-none"
                    style="background: var(--theme-btn-bg); color: var(--theme-btn-text);">确认</button
                >
            </div>
        </div>
    </Modal>
{/if}

<!-- Rename Modal -->
{#if renameModal}
    <Modal open={true} onclose={() => (renameModal = false)}>
        {#snippet title()}
            重命名项目
        {/snippet}
        <div class="space-y-4">
            <div>
                <label for="rename-name" class="mb-1 block text-xs text-zinc-500">项目名称</label>
                <input
                    id="rename-name"
                    bind:value={renameValue}
                    placeholder="输入新名称"
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-700 focus:border-(--theme-accent-bg)/50"
                    style="background: var(--theme-search-box-bg); color: var(--theme-search-box-text)"
                    onkeydown={(e) => e.key === 'Enter' && handleRename()}
                />
            </div>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (renameModal = false)}
                    class="h-7 rounded-md bg-(--theme-card-bg) px-3 text-xs text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
                    >取消</button
                >
                <button
                    disabled={!renameValue.trim()}
                    onclick={handleRename}
                    class="h-7 rounded-md px-3 text-xs transition-all hover:brightness-125 disabled:opacity-40 disabled:pointer-events-none"
                    style="background: var(--theme-btn-bg); color: var(--theme-btn-text);">确认</button
                >
            </div>
        </div>
    </Modal>
{/if}

<!-- Export Modal -->
{#if exportModal}
    <Modal open={true} onclose={() => (exportModal = false)}>
        {#snippet title()}
            导出项目
        {/snippet}
        <div class="space-y-4">
            <p class="text-xs text-zinc-500 mb-2">选择要导出的部分（前置部分将自动勾选）</p>
            <div class="space-y-1.5">
                {#each getPhaseOrder() as phase}
                    <label
                        class="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5"
                    >
                        <input
                            type="checkbox"
                            checked={exportSelections[phase]}
                            onchange={() => toggleExportPhase(phase)}
                            class="size-4"
                            style="accent-color: var(--theme-accent-bg, #6366f1)"
                        />
                        <span>{PHASE_LABELS[phase]}</span>
                    </label>
                {/each}
            </div>
            <label
                class="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5"
            >
                <input
                    type="checkbox"
                    bind:checked={exportResult}
                    class="size-4"
                    style="accent-color: var(--theme-accent-bg, #6366f1)"
                />
                <span>结果页配置（不必需）</span>
            </label>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (exportModal = false)}
                    class="h-7 rounded-md bg-(--theme-card-bg) px-3 text-xs text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
                    >取消</button
                >
                <button
                    onclick={handleExport}
                    class="h-7 rounded-md px-3 text-xs transition-all hover:brightness-125"
                    style="background: var(--theme-btn-bg); color: var(--theme-btn-text);">导出</button
                >
            </div>
        </div>
    </Modal>
{/if}

<!-- Clone Modal -->
{#if cloneModal}
    <Modal open={true} onclose={() => (cloneModal = false)}>
        {#snippet title()}
            复制项目
        {/snippet}
        <div class="space-y-4">
            <div>
                <label for="clone-name" class="mb-1 block text-xs text-zinc-500">新项目名称</label>
                <input
                    id="clone-name"
                    bind:value={cloneName}
                    placeholder="输入新项目名称"
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-700 focus:border-(--theme-accent-bg)/50"
                    style="background: var(--theme-search-box-bg); color: var(--theme-search-box-text)"
                    onkeydown={(e) => e.key === 'Enter' && handleClone()}
                />
            </div>
            <div>
                <p class="mb-2 text-xs text-zinc-500">选择要保留的部分（勾选的部分将被复制并锁定）</p>
                <div class="space-y-1.5">
                    {#each getPhaseOrder() as phase}
                        <label
                            class="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5"
                        >
                            <input
                                type="checkbox"
                                checked={cloneSelections[phase]}
                                onchange={() => toggleClonePhase(phase)}
                                class="size-4"
                                style="accent-color: var(--theme-accent-bg, #6366f1)"
                            />
                            <span>{PHASE_LABELS[phase]}</span>
                        </label>
                    {/each}
                </div>
            </div>
            <label
                class="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5"
            >
                <input
                    type="checkbox"
                    bind:checked={cloneResult}
                    class="size-4"
                    style="accent-color: var(--theme-accent-bg, #6366f1)"
                />
                <span>结果页（凹暴击配置、时间记点、DPS 数据）</span>
            </label>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (cloneModal = false)}
                    class="h-7 rounded-md bg-(--theme-card-bg) px-3 text-xs text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
                    >取消</button
                >
                <button
                    disabled={!cloneName.trim()}
                    onclick={handleClone}
                    class="h-7 rounded-md px-3 text-xs transition-all hover:brightness-125 disabled:opacity-40 disabled:pointer-events-none"
                    style="background: var(--theme-btn-bg); color: var(--theme-btn-text);">复制</button
                >
            </div>
        </div>
    </Modal>
{/if}

<!-- Delete Modal -->
{#if deleteModal}
    <Modal open={true} onclose={() => (deleteModal = false)}>
        {#snippet title()}
            删除项目
        {/snippet}
        <div class="space-y-4">
            <p class="text-sm text-zinc-400">
                确认删除「<span class="font-semibold text-(--theme-layout-text)">{deleteName}</span>」？此操作不可撤销。
            </p>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (deleteModal = false)}
                    class="h-7 rounded-md bg-(--theme-card-bg) px-3 text-xs text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
                    >取消</button
                >
                <button
                    onclick={handleDelete}
                    class="h-7 rounded-md bg-red-600 px-3 text-xs text-white transition-all hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none"
                    >删除</button
                >
            </div>
        </div>
    </Modal>
{/if}
