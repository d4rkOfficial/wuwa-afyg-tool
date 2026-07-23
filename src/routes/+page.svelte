<script lang="ts">
    import { onMount, tick } from 'svelte'
    import { goto } from '$app/navigation'
    import { loadThemes } from '$lib/theme'
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
        createProjectData
    } from '$lib/data/project.svelte'
    import type { PhaseKey, CharSlot, Project } from '$lib/data/types'
    import type { TimelineData } from '$lib/components/page/home/timeline/timeline.types'
    import type { CalcState } from '$lib/components/page/home/calculation/calculation.types'
    import type { ConfigState } from '$lib/components/page/home/config/config.types'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        loadIcons,
        setShowDamageList,
        loadCustomHits,
        init as initTimeline
    } from '$lib/components/page/home/timeline/timeline.store.svelte'
    import {
        setShowBuffModal,
        syncGlobalBuffs,
        getCalcState,
        init as initCalculation
    } from '$lib/components/page/home/calculation/calculation.store.svelte'
    import { getConfig, init as initConfig } from '$lib/components/page/home/config/config.store.svelte'
    import ProjectSidebar from '$lib/components/page/home/project-sidebar.svelte'
    import TeamConfig from '$lib/components/page/home/team-config.svelte'
    import Timeline from '$lib/components/page/home/timeline/timeline.svelte'
    import Calculation from '$lib/components/page/home/calculation/calculation.svelte'
    import Config from '$lib/components/page/home/config/config.svelte'
    import StatOverview from '$lib/components/page/home/config/stat-overview.svelte'
    import Result from '$lib/components/page/home/result/result.svelte'
    import PhaseTabs from '$lib/components/page/home/phase-tabs.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import Icon from '@iconify/svelte'

    const PHASE_LABELS: Record<PhaseKey, string> = {
        team: '队伍配置',
        timeline: '排轴',
        calculation: '拉表',
        config: '词条/环境配置'
    }

    let showNewModal = $state(false)
    let newName = $state('')
    let showResult = $state(false)

    let sidebarWidth = $state(240)
    let sidebarDragging = $state(false)

    $effect(() => {
        if (!sidebarDragging) return
        const onMove = (e: MouseEvent) => {
            sidebarWidth = Math.max(160, Math.min(400, e.clientX))
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

    let importInput = $state<HTMLInputElement | undefined>()

    let activePhase = $state<PhaseKey>('team')

    onMount(() => {
        loadThemes()
        loadProjects()
        loadIcons()
    })

    let projects = $derived(getProjects())
    let activeId = $derived(getActiveId())
    let activeProject = $derived(getActiveProject())

    $effect(() => {
        if (activeProject) loadCustomHits(activeProject.customSkillHits ?? {})
    })

    function handleCreate(name: string) {
        if (!name.trim()) return
        createProject(name.trim())
        showNewModal = false
        newName = ''
        activePhase = 'team'
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

        cloneModal = true
    }

    async function handleClone() {
        if (!cloneName.trim()) return
        const selected = (Object.entries(cloneSelections) as [PhaseKey, boolean][]).filter(([, v]) => v).map(([k]) => k)
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
        const data: Record<string, unknown> = { id: p.id, name: p.name, createdAt: p.createdAt }
        if (selected.includes('team')) data.team = p.team
        data.customSkillHits = p.customSkillHits ?? {}
        data.phases = {}
        for (const ph of getPhaseOrder()) {
            if (selected.includes(ph)) {
                data.phases[ph] = { locked: p.phases[ph]?.locked ?? false, data: p.phases[ph]?.data ?? null }
            }
        }
        const blob = new Blob([JSON.stringify({ version: 1, exportedAt: Date.now(), project: data }, null, 2)], {
            type: 'application/json'
        })
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
                const raw = JSON.parse(reader.result as string)
                const rawProjects = raw?.version
                    ? Array.isArray(raw.project)
                        ? raw.project
                        : [raw.project]
                    : Array.isArray(raw)
                      ? raw
                      : [raw]
                const normalized = rawProjects.map((item: Record<string, unknown>) => ({
                    id: (item.id as string) || crypto.randomUUID(),
                    name: (item.name as string) || '导入的项目',
                    createdAt: (item.createdAt as number) || Date.now(),
                    team: (item.team as never) || [
                        {
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
                    ],
                    phases: {
                        team: (item.phases as Record<string, unknown>)?.team ?? { locked: false, data: null },
                        timeline: (item.phases as Record<string, unknown>)?.timeline ?? { locked: false, data: null },
                        calculation: (item.phases as Record<string, unknown>)?.calculation ?? {
                            locked: false,
                            data: null
                        },
                        config: (item.phases as Record<string, unknown>)?.config ?? { locked: false, data: null }
                    },
                    customSkillHits: (item.customSkillHits as Record<string, unknown[]>) ?? {}
                })) as Project[]
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
            p.phases.calculation?.locked ?? false
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
        return team.every(
            (s) => s.character !== null && s.weapon !== null && s.echoes[0].name !== null && s.triggerSets.length > 0
        )
    }

    function handleUpdateTeam(team: [CharSlot, CharSlot, CharSlot]) {
        updateTeam(team)
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
</script>

<div class="flex h-dvh overflow-hidden bg-[var(--theme-layout-bg)] text-[var(--theme-layout-text)]">
    <ProjectSidebar
        {projects}
        {activeId}
        width={sidebarWidth}
        oncreate={() => {
            newName = ''
            showNewModal = true
        }}
        onimport={() => importInput?.click()}
        onhome={goHome}
        onrename={openRename}
        onclone={openClone}
        onexport={openExport}
        ondelete={openDelete}
        onselect={handleSelectProject}
    />
    <button
        class="shrink-0 w-1 cursor-col-resize transition-colors hover:bg-indigo-500/50"
        style="background: transparent;"
        onmousedown={(e) => {
            e.preventDefault()
            sidebarDragging = true
        }}
    ></button>
    <input type="file" accept=".json" class="hidden" bind:this={importInput} onchange={handleImport} />

    <div class="flex flex-1 flex-col overflow-hidden">
        {#if !activeProject}
            <div class="flex flex-1 items-center justify-center">
                <div class="text-center">
                    <svg viewBox="0 0 1024 1024" class="mx-auto mb-4 size-12 text-zinc-700" fill="currentColor">
                        <path
                            d="M769 887.9c-245.9 154.5-571.7 80-726.1-165.9C10.3 670.1 0.8 613.4 14.6 553.6 55.1 378.1 287.7 226 333.8 197l1.1-0.6 1.4-0.9c1-0.6 1.9-1.3 2.9-1.9 68.3-42.9 288.3-169 456.2-131 59.9 13.6 106.9 47 139.7 99.2 154.4 246 79.8 571.7-166.1 726.1z m-424-667C295 252.4 77.6 397 40 559.5 27.8 612.2 36.3 662.2 65 708c146.8 233.7 456.3 304.4 690 157.7 233.7-146.8 304.6-456.3 157.8-690-28.9-46.1-70.5-75.5-123.3-87.5C624.9 50.9 395 189.7 350.3 217.7l-1.4 0.9-1.1 0.8c-1 0.5-1.9 1-2.8 1.5z"
                        />
                        <path
                            d="M923.9 168.8C1074.7 409 1002.4 726 762 876.8 521.7 1027.7 204.8 955.3 54 715-96.8 474.7 325.5 217.7 341.7 207.4c20.2-12.4 431.4-278.8 582.2-38.6z"
                        />
                        <path
                            d="M86.6 619c32.3 51.4 132.3 54.9 262.5 9 130.1-45.8 270.5-134 368.4-231.3 97.8-97.3 138.2-188.9 105.9-240.3-32.3-51.4-132.4-54.9-262.5-9-130.1 45.8-270.5 134-368.4 231.3C94.6 476 54.3 567.6 86.6 619z"
                        />
                    </svg>
                    <h2 class="mb-2 text-lg font-semibold">椰果工具箱</h2>
                    <p class="mb-6 text-sm text-zinc-500">鸣潮社区公益工具喵~ 公测中，即将开源！</p>
                    <button
                        onclick={() => {
                            newName = ''
                            showNewModal = true
                        }}
                        class="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
                        style="background: linear-gradient(135deg, #6366f1, #8b5cf6)"
                    >
                        <Icon icon="mdi:plus" class="size-4" />
                        新建项目
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
                resultEnabled={allPhasesLocked}
                onresult={() => (showResult = true)}
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
                    <TeamConfig team={activeProject.team} onupdate={handleUpdateTeam} locked={teamPhaseLocked} />
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
                <button
                    onclick={() => goto('/api-test')}
                    class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--theme-sidebar-text)]/20 px-3 py-1.5 text-sm text-[var(--theme-sidebar-text)] transition-colors hover:border-[var(--theme-sidebar-text)]/40"
                >
                    <Icon icon="mdi:api" class="size-4 shrink-0" />
                    API测试
                </button>
                {#if !showResult}
                    {#if activePhase === 'timeline'}
                        <button
                            onclick={() => setShowDamageList(true)}
                            class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--theme-sidebar-text)]/20 px-3 py-1.5 text-sm text-[var(--theme-sidebar-text)] transition-colors hover:border-[var(--theme-sidebar-text)]/40"
                        >
                            <Icon icon="mdi:chart-box-outline" class="size-4 shrink-0" />
                            查看所有伤害
                        </button>
                    {/if}
                    {#if activePhase === 'calculation'}
                        <button
                            onclick={() => setShowBuffModal(true)}
                            class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--theme-sidebar-text)]/20 px-3 py-1.5 text-sm text-[var(--theme-sidebar-text)] transition-colors hover:border-[var(--theme-sidebar-text)]/40"
                        >
                            <Icon icon="mdi:tune-variant" class="size-4 shrink-0" />
                            BUFF配置
                        </button>
                    {/if}
                    {#if activePhase === 'config'}
                        <button
                            onclick={() => (showStatOverview = true)}
                            class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--theme-sidebar-text)]/20 px-3 py-1.5 text-sm text-[var(--theme-sidebar-text)] transition-colors hover:border-[var(--theme-sidebar-text)]/40"
                        >
                            <Icon icon="mdi:account-details" class="size-4 shrink-0" />
                            角色面板总览
                        </button>
                    {/if}
                {:else}
                    <button
                        onclick={async () => {
                            showResult = false
                            activePhase = 'team';       await tick()
                            activePhase = 'timeline';   await tick()
                            activePhase = 'calculation'; await tick()
                            activePhase = 'config';     await tick()
                            showResult = true
                            resultRefreshKey++
                        }}
                        class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--theme-sidebar-text)]/20 px-3 py-1.5 text-sm text-[var(--theme-sidebar-text)] transition-colors hover:border-[var(--theme-sidebar-text)]/40"
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
                        class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--theme-sidebar-text)]/20 px-3 py-1.5 text-sm text-[var(--theme-sidebar-text)] transition-colors hover:border-[var(--theme-sidebar-text)]/40 disabled:opacity-40 disabled:pointer-events-none"
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
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-700 focus:border-indigo-500/50"
                    style="background: var(--theme-search-box-bg); color: var(--theme-search-box-text)"
                    onkeydown={(e) => e.key === 'Enter' && handleCreate(newName)}
                />
            </div>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (showNewModal = false)}
                    class="h-7 rounded-md bg-white/5 px-3 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-white/10"
                    >取消</button
                >
                <button
                    disabled={!newName.trim()}
                    onclick={() => handleCreate(newName)}
                    class="h-7 rounded-md bg-indigo-600 px-3 text-xs text-white transition-colors hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none"
                    >确认</button
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
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-700 focus:border-indigo-500/50"
                    style="background: var(--theme-search-box-bg); color: var(--theme-search-box-text)"
                    onkeydown={(e) => e.key === 'Enter' && handleRename()}
                />
            </div>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (renameModal = false)}
                    class="h-7 rounded-md bg-white/5 px-3 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-white/10"
                    >取消</button
                >
                <button
                    disabled={!renameValue.trim()}
                    onclick={handleRename}
                    class="h-7 rounded-md bg-indigo-600 px-3 text-xs text-white transition-colors hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none"
                    >确认</button
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
                            class="size-4 accent-indigo-500"
                        />
                        <span>{PHASE_LABELS[phase]}</span>
                    </label>
                {/each}
            </div>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (exportModal = false)}
                    class="h-7 rounded-md bg-white/5 px-3 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-white/10"
                    >取消</button
                >
                <button
                    onclick={handleExport}
                    class="h-7 rounded-md bg-indigo-600 px-3 text-xs text-white transition-colors hover:bg-indigo-500"
                    >导出</button
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
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-700 focus:border-indigo-500/50"
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
                                class="size-4 accent-indigo-500"
                            />
                            <span>{PHASE_LABELS[phase]}</span>
                        </label>
                    {/each}
                </div>
            </div>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (cloneModal = false)}
                    class="h-7 rounded-md bg-white/5 px-3 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-white/10"
                    >取消</button
                >
                <button
                    disabled={!cloneName.trim()}
                    onclick={handleClone}
                    class="h-7 rounded-md bg-indigo-600 px-3 text-xs text-white transition-colors hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none"
                    >复制</button
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
                确认删除「<span class="text-zinc-200">{deleteName}</span>」？此操作不可撤销。
            </p>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (deleteModal = false)}
                    class="h-7 rounded-md bg-white/5 px-3 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-white/10"
                    >取消</button
                >
                <button
                    onclick={handleDelete}
                    class="h-7 rounded-md bg-red-600 px-3 text-xs text-white transition-colors hover:bg-red-500 disabled:opacity-40 disabled:pointer-events-none"
                    >删除</button
                >
            </div>
        </div>
    </Modal>
{/if}
