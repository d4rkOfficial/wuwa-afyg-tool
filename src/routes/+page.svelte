<script lang="ts">
    import { onMount, tick } from 'svelte'
    import { registerPanel, unregisterPanel } from '$lib/ai/panels.svelte'
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
        parseProjectFile,
        archiveProject,
        updateConditionProfile,
        ProjectParseError
    } from '$lib/data/project.svelte'
    import { checkShare, importFromShareUrl, getShareLink } from '$lib/data/share.svelte'
    import { getWWVersion, ensureVersion, resetVersionPromise } from '$lib/api/client-version'
    import { clearCache, getCharacterInfo, getEchoInfo } from '$lib/api/data-cache'
    import { browser } from '$app/environment'
    import type { PhaseKey, CharSlot } from '$lib/types/project'
    import type { TimelineData } from '$lib/calc/timeline.types'
    import type { CalcState } from '$lib/calc/calculation.types'
    import type { ConfigState } from '$lib/calc/config.types'
    import { PHASE_LABELS } from '$lib/consts/game-terms'
    import { addToast } from '$lib/data/toast.svelte'
    import { preloadCharElements } from '$lib/data/char-elements.svelte'
    import { loadIcons, loadCustomHits, init as initTimeline } from '$lib/calc/timeline.store.svelte'
    import { loadKeyMap } from '$lib/data/keymap.svelte'
    import { loadShortcuts } from '$lib/data/shortcuts.svelte'
    import { loadWorkshop } from '$lib/data/workshop.svelte'
    import { initToyProfileBridge } from '$lib/bilibili-toy/profile.svelte'
    import {
        setShowBuffModal,
        setConditionProfile,
        setProfileChangeListener,
        syncGlobalBuffs,
        getCalcState,
        createBuffSet,
        init as initCalculation
    } from '$lib/calc/calculation.store.svelte'
    import { setCalcViewMode } from '$lib/data/calc-view.svelte'
    import { getConfig, init as initConfig } from '$lib/calc/config.store.svelte'
    import { hideSplash } from '$lib/utils/splash'
    import {
        getReloadOnResultRefresh,
        getReloadOnProfileChange,
        setMagneticPointer
    } from '$lib/data/render-prefs.svelte'
    import { loadGenPrefs, setAiEnabledSession, updateGenPrefs } from '$lib/data/ai-prefs.svelte'
    import { initToyEnvironmentBridge, onToyEnter, isToyMobile } from '$lib/bilibili-toy/environment.svelte'
    import { isFirstVisit, markVisited, isMagneticToySet, markMagneticToySet } from '$lib/data/toy-prefs.svelte'
    import { setWsHost } from '$lib/ws-remote/ws-remote.svelte'
    import { registerHashAction, runHashActions } from '$lib/utils/hash-actions.svelte'
    import { getSimplifyToolbar } from '$lib/data/toolbar-prefs.svelte'
    import { getConfirmDeletes, getSidebarLookup } from '$lib/data/interaction-prefs.svelte'
    import ProjectSidebar from '$lib/components/page/home/project-sidebar.svelte'
    import WorkshopModal from '$lib/components/layout/workshop-modal.svelte'
    import BuffLibraryModal from '$lib/components/layout/buff-library-modal.svelte'
    import SettingsModal from '$lib/components/layout/settings-modal.svelte'
    import CharacterDetailModal from '$lib/components/page/home/config/character-detail-modal.svelte'
    import AiAssistant from '$lib/components/layout/ai-assistant.svelte'
    import TeamConfig from '$lib/components/page/home/team/team-config.svelte'
    import Timeline from '$lib/components/page/home/timeline/timeline.svelte'
    import Calculation from '$lib/components/page/home/calculation/calculation.svelte'
    import Config from '$lib/components/page/home/config/config.svelte'
    import Result from '$lib/components/page/home/result/result.svelte'
    import PhaseTabs from '$lib/components/page/home/phase-tabs.svelte'
    import QuickLookup from '$lib/components/layout/quick-lookup.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import ConfirmDeleteModal from '$lib/components/layout/confirm-delete-modal.svelte'
    import Icon from '@iconify/svelte'
    import WelcomeScreen from '$lib/components/page/home/welcome-screen.svelte'
    import Toolbar from '$lib/components/page/home/toolbar.svelte'
    import WorkshopFrameModal from '$lib/components/layout/workshop-frame-modal.svelte'

    let showNewModal = $state(false)
    let newName = $state('')
    let showResult = $state(false)
    let showBuffLibrary = $state(false)
    let showSettings = $state(false)
    let showWorkshopFrame = $state(false)

    // 阶段切换加载反馈：activePhase/showResult 变化时显示遮罩 spinner，同步初始化完成后最短 200ms 隐藏
    let phaseLoading = $state(false)
    let phaseLoadingTimer: ReturnType<typeof setTimeout> | null = null

    $effect(() => {
        activePhase
        showResult
        phaseLoading = true
        if (phaseLoadingTimer !== null) {
            clearTimeout(phaseLoadingTimer)
            phaseLoadingTimer = null
        }
        void tick().then(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    phaseLoadingTimer = setTimeout(() => {
                        phaseLoadingTimer = null
                        phaseLoading = false
                    }, 200)
                })
            })
        })
    })

    let sidebarWidth = $state(240)
    let sidebarDragging = $state(false)
    let sidebarDividerHover = $state(false)

    $effect(() => {
        if (!sidebarDragging) return
        // rAF 节流：mousemove 只记录目标值，每帧合并一次写入（高刷屏避免每 mousemove 一次 layout）
        let pending: number | null = null
        let target = sidebarWidth
        const onMove = (e: MouseEvent) => {
            target = e.clientX <= 144 ? 52 : Math.max(200, Math.min(sidebarLookupEnabled ? 600 : 400, e.clientX))
            if (pending !== null) return
            pending = requestAnimationFrame(() => {
                pending = null
                sidebarWidth = target
            })
        }
        const onUp = () => {
            if (pending !== null) {
                cancelAnimationFrame(pending)
                pending = null
            }
            sidebarWidth = target
            sidebarDragging = false
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            if (pending !== null) {
                cancelAnimationFrame(pending)
                pending = null
            }
        }
    })

    // ── 简化底部工具栏：fixed 圆角矩形，仅水平拖动，磁吸侧栏右缘 / 屏幕右缘（拖拽状态机见 toolbar.svelte）──
    const simplifyToolbar = $derived(getSimplifyToolbar())
    // 侧边栏速查：开启后底部工具栏速查按钮隐藏，速查改由侧边栏承载（无活动工程或关闭功能时同步收起）
    const sidebarLookupEnabled = $derived(getSidebarLookup())

    // 侧栏展开宽度档位：较短（常规工程目录）与最长（功能开启 600 / 关闭 400，速查舒适浏览）
    const sidebarShortExpanded = 240
    const sidebarMaxExpanded = $derived(sidebarLookupEnabled ? 600 : 400)
    const sidebarWide = $derived(sidebarWidth >= sidebarMaxExpanded - 1)
    function toggleSidebarWidth() {
        sidebarWidth = sidebarWide ? sidebarShortExpanded : sidebarMaxExpanded
    }

    let showLookup = $state(false)
    let sidebarLookupOpen = $state(false)

    $effect(() => {
        // 无活动工程：侧边栏速查收起（顶部 toggle 按钮也依赖活动工程隐藏）
        if (!activeProject && sidebarLookupOpen) sidebarLookupOpen = false
    })
    $effect(() => {
        // 关闭侧边栏速查功能：同步收起侧边栏速查
        if (!sidebarLookupEnabled && sidebarLookupOpen) sidebarLookupOpen = false
    })
    $effect(() => {
        // 开启侧边栏速查功能：关闭弹窗式速查（避免残留态在关闭功能后弹出）
        if (sidebarLookupEnabled && showLookup) showLookup = false
    })
    let showCharDetail = $state(false)
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

    let importInput = $state<HTMLInputElement | undefined>()

    let activePhase = $state<PhaseKey>('team')

    // 注册本地弹窗状态供 AI 查看/开关（同步 onMount，卸载时注销）
    onMount(() => {
        // WS 远程接管宿主桥：切视图与 AI 同逻辑，视图名供状态推送
        setWsHost({
            requestView: (phase) => {
                if (phase === 'result') {
                    showResult = true
                } else {
                    activePhase = phase as PhaseKey
                    showResult = false
                }
            },
            view: () => (showResult ? 'result' : activePhase)
        })
        // 链/阶档位任何改动（弹窗/AI 工具）都写回当前工程，保证 init/重载 restore 恒为最新值
        setProfileChangeListener(() => {
            void updateConditionProfile()
        })
        const panels: Array<[string, string, () => boolean, (v: boolean) => void]> = [
            [
                'quick-lookup',
                '速查',
                () => (sidebarLookupEnabled ? sidebarLookupOpen : showLookup),
                (v) => (sidebarLookupEnabled ? (sidebarLookupOpen = v) : (showLookup = v))
            ],
            ['buff-library', 'Buff 集', () => showBuffLibrary, (v) => (showBuffLibrary = v)],
            ['settings', '设置', () => showSettings, (v) => (showSettings = v)],
            ['workshop', '工坊', () => showWorkshop, (v) => (showWorkshop = v)],
            ['workshop-frame', '工坊页', () => showWorkshopFrame, (v) => (showWorkshopFrame = v)],
            ['character-detail', '角色详情配置', () => showCharDetail, (v) => (showCharDetail = v)],
            ['new-project', '新建工程', () => showNewModal, (v) => (showNewModal = v)],
            ['rename-project', '重命名工程', () => renameModal, (v) => (renameModal = v)],
            ['clone-project', '克隆工程', () => cloneModal, (v) => (cloneModal = v)],
            ['delete-project', '删除工程', () => deleteModal, (v) => (deleteModal = v)],
            ['export-project', '导出工程', () => exportModal, (v) => (exportModal = v)]
        ]
        for (const [name, label, get, set] of panels) registerPanel(name, label, get, set)
        return () => {
            for (const [name] of panels) unregisterPanel(name)
        }
    })

    onMount(async () => {
        hideSplash()
        initToyProfileBridge()
        initToyEnvironmentBridge()
        // 首次进入（任意端）：拉表默认平铺模式；禁用磁力光标；禁用 AI 助手（一次性持久设定，用户可在设置中重新开启）
        if (isFirstVisit()) {
            setCalcViewMode('spread')
            setMagneticPointer(false)
            void loadGenPrefs().then(() => updateGenPrefs({ enabled: false }))
            markVisited()
        }
        // 进入 Toy 环境（消息异步到达，每会话首次触发）：
        // - 关闭 AI 助手（会话级，不持久化）
        // - 首次在 Toy 手机环境进入 → 关闭磁力光标（一次性持久设定）
        onToyEnter(() => {
            void loadGenPrefs().then(() => setAiEnabledSession(false))
            if (isToyMobile() && !isMagneticToySet()) {
                setMagneticPointer(false)
                markMagneticToySet()
            }
        })
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
        loadKeyMap()
        loadShortcuts()
        loadWorkshop()
        checkShare()
        // 分享导入：#import_project=<url>（一次性，执行后清 hash）
        registerHashAction({
            key: 'import_project',
            once: true,
            run: async (url) => {
                if (!url) return
                const res = await importFromShareUrl(url)
                if (res.ok && res.project) {
                    await setActiveProject(res.project.id)
                    initForActiveProject()
                    addToast(`已从工坊导入「${res.project.name}」`, 'success')
                } else {
                    addToast(res.error ?? '分享已失效', 'error')
                }
            }
        })
        await runHashActions()
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
        if (!getConfirmDeletes()) {
            deleteId = id
            handleDelete()
            return
        }
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
        const file = buildExportFile(p, selected, true)
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
                const normalized = parseProjectFile(reader.result as string)
                importProjects(normalized)
                addToast(`成功导入 ${normalized.length} 个项目`, 'success')
            } catch (e) {
                addToast(e instanceof ProjectParseError ? `导入失败：${e.message}` : '导入失败：文件格式错误', 'error')
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
        addToast('正在生成分享链接...', 'info')
        const link = await getShareLink(p)
        if (!link) {
            addToast('分享失败', 'error')
            return
        }
        try {
            await navigator.clipboard.writeText(link)
            addToast('已分享(10分钟)，链接已复制到剪贴板', 'success')
        } catch {
            addToast('已分享(10分钟)，请在地址栏查看导入链接', 'success')
        }
    }

    async function handleArchive(id: string) {
        const p = projects.find((pr) => pr.id === id)
        if (!p) return
        await archiveProject(id)
        if (id === activeId) {
            activePhase = 'team'
            initForActiveProject()
        }
        addToast(`工程「${p.name}」已归档`, 'success')
    }

    /** @desc 重载当前工程全部阶段数据（不改变视图状态）；initForActiveProject 与「链/阶变动重载数据」共用 */
    function reloadActiveProjectStores() {
        setShowBuffModal(false)
        const p = getActiveProject()
        if (!p) return
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
        // 预热角色与声骸数据（IndexedDB 缓存）：减少排轴/拉表等阶段首次挂载的异步等待
        for (const slot of p.team) {
            if (slot.character) void getCharacterInfo(slot.character)
            if (slot.echoes?.[0]?.name) void getEchoInfo(slot.echoes[0].name)
        }
        // 恢复工程携带的链/阶配置（导入/分享下载的工程；档位改动已由 updateConditionProfile 写回，恒为最新）
        setConditionProfile(p.conditionProfile ?? undefined)
    }

    function initForActiveProject() {
        reloadActiveProjectStores()
        const p = getActiveProject()
        if (!p) {
            activePhase = 'team'
            return
        }
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

    // 刷新结果（开启重载数据）时：先重解锁全部环节，再按原锁定状态逐个重锁——
    // 重锁 timeline/config 会重新同步全局 buff 并把当前内存态写回工程，修复换工程后残留旧数据的问题
    async function handleRelockAll() {
        if (!activeProject) return
        const order = getPhaseOrder()
        const wasLocked = order.map((p) => activeProject!.phases[p]?.locked === true)
        for (const phase of order) await unlockPhase(activeProject.id, phase)
        for (let i = 0; i < order.length; i++) {
            const phase = order[i]
            if (!wasLocked[i]) continue
            await lockPhase(phase)
            if (phase === 'timeline') {
                syncGlobalBuffs(activeProject.team.map((s) => s.character))
                updateCalculation(getCalcState())
            }
            if (phase === 'config') {
                updateConfig(getConfig())
            }
        }
    }

    /** @desc 重载数据并重新锁定全部环节（「刷新结果」与「链/阶变动」共用） */
    async function handleReloadAllPhases() {
        initForActiveProject()
        await handleRelockAll()
        addToast('已重载数据并重新锁定全部环节', 'info')
    }

    /** @desc 链/阶档位变动回调：开启「链/阶变动重载数据」时重载全部阶段数据（不跳转视图，结果页若已打开会自动重算） */
    async function handleProfileReload() {
        if (!getReloadOnProfileChange()) return
        reloadActiveProjectStores()
        await handleRelockAll()
        addToast('链/阶变动，已重载数据并重新锁定全部环节', 'info')
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

    // 上次刷新时的工程数据指纹：数据未变时跳过逐阶段重挂（init 幂等短路，重挂只是重渲染+重测量）
    let _lastRefreshFp = ''

    function projectDataFingerprint(): string {
        const p = getActiveProject()
        if (!p) return 'null'
        const tl = p.phases.timeline.data as TimelineData | null
        const tlFp = tl
            ? `${tl.refLines.length}:${tl.opBlocks.length}:${tl.damageBlocks.length}:${tl.damageBlocks[0]?.id ?? ''}:${
                  tl.damageBlocks[tl.damageBlocks.length - 1]?.id ?? ''
              }`
            : 'null'
        return JSON.stringify([
            p.team,
            tlFp,
            JSON.stringify(p.phases.calculation.data ?? null),
            JSON.stringify(p.phases.config.data ?? null)
        ])
    }

    // 刷新结果（开启重载数据时先重解锁全部环节再按原锁定状态重锁）：数据有变才逐阶段重挂载，随后刷新结果页
    async function handleRefreshResult() {
        if (getReloadOnResultRefresh()) {
            await handleReloadAllPhases()
        }
        const fp = projectDataFingerprint()
        const dataUnchanged = fp === _lastRefreshFp
        _lastRefreshFp = fp
        showResult = false
        if (!dataUnchanged) {
            activePhase = 'team'
            await tick()
            activePhase = 'timeline'
            await tick()
            activePhase = 'calculation'
            await tick()
            activePhase = 'config'
            await tick()
        }
        showResult = true
        resultRefreshKey++
    }
</script>

<div class="flex h-dvh overflow-hidden bg-(--theme-layout-bg) text-(--theme-layout-text)">
    <ProjectSidebar
        {projects}
        {activeId}
        width={sidebarWidth}
        dragging={sidebarDragging}
        {sidebarLookupEnabled}
        {sidebarLookupOpen}
        {sidebarWide}
        onToggleSidebarLookup={() => (sidebarLookupOpen = !sidebarLookupOpen)}
        onToggleSidebarWidth={toggleSidebarWidth}
        team={activeProject?.team}
        onCreateBuff={(name) => {
            createBuffSet(name)
            sidebarLookupOpen = false
            setShowBuffModal(true)
        }}
        showBuffOption={activePhase === 'calculation'}
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
        onarchive={handleArchive}
        ondelete={openDelete}
        onselect={handleSelectProject}
    />
    <button
        aria-label="调整侧栏宽度"
        class="shrink-0 w-1 cursor-col-resize"
        style="background: {sidebarDragging
            ? 'var(--theme-accent-bg)'
            : sidebarDividerHover
              ? 'color-mix(in srgb, var(--theme-accent-bg) 45%, transparent)'
              : 'color-mix(in srgb, var(--theme-sidebar-bg) 80%, transparent)'};{sidebarDragging
            ? ' box-shadow: 0 0 10px color-mix(in srgb, var(--theme-accent-bg) 55%, transparent);'
            : sidebarDividerHover
              ? ' box-shadow: 0 0 8px color-mix(in srgb, var(--theme-accent-bg) 30%, transparent);'
              : ''}"
        onmouseenter={() => (sidebarDividerHover = true)}
        onmouseleave={() => (sidebarDividerHover = false)}
        onmousedown={(e) => {
            e.preventDefault()
            if (sidebarWidth === 52) {
                // 先以展开态渲染一帧（宽度过渡动画生效），下一帧再进入拖拽态
                sidebarWidth = 200
                requestAnimationFrame(() => {
                    sidebarDragging = true
                })
                return
            }
            sidebarDragging = true
        }}
        ondblclick={() => {
            if (sidebarWidth !== 52) sidebarWidth = 52
        }}
    ></button>
    <input type="file" accept=".json" class="hidden" bind:this={importInput} onchange={handleImport} />

    <div class="flex flex-1 flex-col overflow-hidden">
        {#if !activeProject}
            <WelcomeScreen
                onWorkshopFrame={() => (showWorkshopFrame = true)}
                onBuffLibrary={() => (showBuffLibrary = true)}
                onSettings={() => (showSettings = true)}
            />
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
                {#if phaseLoading}
                    <!-- 阶段切换加载反馈：遮罩 + spinner（不拦截交互） -->
                    <div
                        class="absolute inset-0 z-30 flex items-center justify-center pointer-events-none select-none"
                        style="background: color-mix(in srgb, var(--theme-timeline-bg) 45%, transparent);"
                    >
                        <Icon icon="mdi:loading" class="size-7 animate-spin" style="color: var(--theme-accent-text);" />
                    </div>
                {/if}
                {#key activeProject?.id}
                    {#if showResult}
                        <div class="h-full animate-shrink-in">
                            <Result
                                team={activeProject.team}
                                calcState={activeProject.phases.calculation.data as CalcState | null}
                                configState={activeProject.phases.config.data as ConfigState | null}
                                refreshKey={resultRefreshKey}
                            />
                        </div>
                    {:else if activePhase === 'team'}
                        <div class="h-full animate-shrink-in">
                            <TeamConfig
                                team={activeProject.team}
                                onupdate={handleUpdateTeam}
                                onreset={handleResetTeam}
                                locked={teamPhaseLocked}
                            />
                        </div>
                    {:else if activePhase === 'timeline'}
                        <div class="h-full animate-shrink-in">
                            <Timeline
                                team={activeProject.team}
                                locked={phaseLocked}
                                data={activeProject.phases.timeline.data as TimelineData | null}
                                onupdate={updateTimeline}
                            />
                        </div>
                    {:else if activePhase === 'calculation'}
                        <div class="h-full animate-shrink-in">
                            <Calculation
                                team={activeProject.team}
                                timelineData={activeProject.phases.timeline.data as TimelineData | null}
                                calcState={activeProject.phases.calculation.data as CalcState | null}
                                locked={phaseLocked}
                                onupdate={(state) => updateCalculation(state)}
                            />
                        </div>
                    {:else}
                        <div class="h-full animate-shrink-in">
                            <Config
                                team={activeProject.team}
                                data={activeProject.phases.config.data as ConfigState | null}
                                locked={phaseLocked}
                                onupdate={(state) => updateConfig(state)}
                            />
                        </div>
                    {/if}
                {/key}
                {#if !showResult && phaseLocked}
                    <!-- 已锁定遮罩：纯透明背景 + SVG pattern 平铺小字「已锁定」。整层 opacity-10 封顶，
                         文字取 currentColor（主题文本色），保证任何主题/任何变量解析下都只弱显示、不遮挡内容 -->
                    <div class="absolute inset-0 z-40 pointer-events-none select-none opacity-10">
                        <svg
                            class="absolute inset-0 size-full"
                            aria-hidden="true"
                            style="color: var(--theme-modal-text);"
                        >
                            <defs>
                                <pattern
                                    id="lockWatermark"
                                    patternUnits="userSpaceOnUse"
                                    width="170"
                                    height="120"
                                    patternTransform="rotate(-30)"
                                >
                                    <text
                                        x="16"
                                        y="74"
                                        fill="currentColor"
                                        font-size="26"
                                        font-weight="700"
                                        letter-spacing="4">已锁定</text
                                    >
                                </pattern>
                            </defs>
                            <rect width="100%" height="100%" fill="url(#lockWatermark)" />
                        </svg>
                    </div>
                {/if}
            </div>

            <Toolbar
                {simplifyToolbar}
                {activePhase}
                {showResult}
                {teamPhaseLocked}
                {phaseLocked}
                {canLock}
                {sidebarLookupEnabled}
                onLookup={() => (showLookup = true)}
                onCharDetail={() => (showCharDetail = true)}
                onRefresh={handleRefreshResult}
                onLockToggle={() => (phaseLocked ? handleUnlockPhase() : handleLockPhase())}
            />
        {/if}
    </div>
</div>

{#if activeProject && !sidebarLookupEnabled}
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

<BuffLibraryModal open={showBuffLibrary} onclose={() => (showBuffLibrary = false)} />

{#if activeProject}
    <CharacterDetailModal
        open={showCharDetail}
        team={activeProject.team}
        configState={activeProject.phases.config.data as ConfigState | null}
        calcState={activeProject.phases.calculation.data as CalcState | null}
        onclose={() => (showCharDetail = false)}
        onProfileReload={() => {
            void handleProfileReload()
        }}
    />
{/if}

<SettingsModal open={showSettings} onclose={() => (showSettings = false)} />

<AiAssistant
    viewPhase={activePhase}
    viewShowResult={showResult}
    onRequestView={(phase) => {
        if (phase === 'result') {
            showResult = true
        } else {
            activePhase = phase as PhaseKey
            showResult = false
        }
    }}
/>

<WorkshopFrameModal open={showWorkshopFrame} onclose={() => (showWorkshopFrame = false)} />

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
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-700 focus:border-(--theme-accent-bg)/50 theme-glass-surface"
                    style="background: var(--theme-search-box-bg); color: var(--theme-search-box-text)"
                    onkeydown={(e) => e.key === 'Enter' && handleCreate(newName)}
                />
            </div>
            {@render modalFooter(
                !newName.trim(),
                '确认',
                () => (showNewModal = false),
                () => handleCreate(newName)
            )}
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
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-700 focus:border-(--theme-accent-bg)/50 theme-glass-surface"
                    style="background: var(--theme-search-box-bg); color: var(--theme-search-box-text)"
                    onkeydown={(e) => e.key === 'Enter' && handleRename()}
                />
            </div>
            {@render modalFooter(!renameValue.trim(), '确认', () => (renameModal = false), handleRename)}
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
            {@render phaseChecklist(exportSelections, toggleExportPhase)}
            {@render modalFooter(false, '导出', () => (exportModal = false), handleExport)}
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
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-700 focus:border-(--theme-accent-bg)/50 theme-glass-surface"
                    style="background: var(--theme-search-box-bg); color: var(--theme-search-box-text)"
                    onkeydown={(e) => e.key === 'Enter' && handleClone()}
                />
            </div>
            <div>
                <p class="mb-2 text-xs text-zinc-500">选择要保留的部分（勾选的部分将被复制并锁定）</p>
                {@render phaseChecklist(cloneSelections, toggleClonePhase)}
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
            {@render modalFooter(!cloneName.trim(), '复制', () => (cloneModal = false), handleClone)}
        </div>
    </Modal>
{/if}

<!-- Delete Modal -->
{#if deleteModal}
    <ConfirmDeleteModal
        open
        title="删除项目"
        confirmText={`删除${deleteName}`}
        confirmLabel="删除"
        onclose={() => (deleteModal = false)}
        onconfirm={handleDelete}
    />
{/if}

{#snippet modalFooter(disabled: boolean, confirmLabel: string, onCancel: () => void, onConfirm: () => void)}
    <div class="flex justify-end gap-2">
        <button
            onclick={onCancel}
            class="theme-glass-surface h-7 rounded-md bg-(--theme-card-bg) px-3 text-xs text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
            >取消</button
        >
        <button
            {disabled}
            onclick={onConfirm}
            class="h-7 rounded-md px-3 text-xs transition-all hover:brightness-125 disabled:opacity-40 disabled:pointer-events-none"
            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
            >{confirmLabel}</button
        >
    </div>
{/snippet}

{#snippet phaseChecklist(selections: Record<PhaseKey, boolean>, onToggle: (phase: PhaseKey) => void)}
    <div class="space-y-1.5">
        {#each getPhaseOrder() as phase}
            <label
                class="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5"
            >
                <input
                    type="checkbox"
                    checked={selections[phase]}
                    onchange={() => onToggle(phase)}
                    class="size-4"
                    style="accent-color: var(--theme-accent-bg, #6366f1)"
                />
                <span>{PHASE_LABELS[phase]}</span>
            </label>
        {/each}
    </div>
{/snippet}
