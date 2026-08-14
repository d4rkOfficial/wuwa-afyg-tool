<script lang="ts">
    import { onMount, tick } from 'svelte'
    import { fade } from 'svelte/transition'
    import { popOut } from '$lib/utils/motion'
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
    import { getWWVersion, ensureVersion, resetVersionPromise } from '$lib/api/consts'
    import { clearCache, getCharacterInfo, getEchoInfo } from '$lib/data/api'
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
        getQuickMode,
        getQuickSpecial,
        toggleQuickMode,
        formatTimeline,
        init as initTimeline
    } from '$lib/components/page/home/timeline/timeline.store.svelte'
    import { loadKeyMap } from '$lib/data/keymap.svelte'
    import { loadShortcuts } from '$lib/data/shortcuts.svelte'
    import { getShareBase, loadWorkshop } from '$lib/data/workshop.svelte'
    import { getToyProfile, initToyProfileBridge } from '$lib/bilibili-toy/profile.svelte'
    import { buildWorkshopFrameSrc } from '$lib/bilibili-toy/identity'
    import {
        setShowBuffModal,
        getBuffDiffMode,
        toggleBuffDiffMode,
        getHideConditionMismatch,
        toggleHideConditionMismatch,
        setConditionProfile,
        setProfileChangeListener,
        syncGlobalBuffs,
        getCalcState,
        createBuffSet,
        init as initCalculation
    } from '$lib/components/page/home/calculation/calculation.store.svelte'
    import {
        getCalcViewMode,
        setCalcViewMode,
        getDamageTypeEditMode,
        setDamageTypeEditMode,
        getScrollAxisDefault,
        setScrollAxisDefault
    } from '$lib/data/calc-view.svelte'
    import { getConfig, init as initConfig } from '$lib/components/page/home/config/config.store.svelte'
    import { hideSplash } from '$lib/utils/splash'
    import favicon from '$lib/assets/favicon.svg'
    import {
        getGpuAccel,
        getReloadOnResultRefresh,
        getReloadOnProfileChange,
        setMagneticForcedOff,
        setMagneticPointer
    } from '$lib/data/render-prefs.svelte'
    import { loadGenPrefs, setAiEnabledSession } from '$lib/data/ai-prefs.svelte'
    import {
        initToyEnvironmentBridge,
        onToyEnter,
        isFirstVisit,
        markVisited,
        isToyMobile,
        isMagneticToySet,
        markMagneticToySet
    } from '$lib/bilibili-toy/environment.svelte'
    import { setWsHost } from '$lib/ws-remote/ws-remote.svelte'
    import { registerHashAction, runHashActions } from '$lib/utils/hash-actions.svelte'
    import { getSimplifyToolbar } from '$lib/data/toolbar-prefs.svelte'
    import ProjectSidebar from '$lib/components/page/home/project-sidebar.svelte'
    import WorkshopModal from '$lib/components/page/home/workshop-modal.svelte'
    import BuffLibraryModal from '$lib/components/page/home/buff-library-modal.svelte'
    import SettingsModal from '$lib/components/layout/settings-modal.svelte'
    import CharacterDetailModal from '$lib/components/page/home/config/character-detail-modal.svelte'
    import AiAssistant from '$lib/ai/components/ai-assistant.svelte'
    import TeamConfig from '$lib/components/page/home/team-config.svelte'
    import Timeline from '$lib/components/page/home/timeline/timeline.svelte'
    import Calculation from '$lib/components/page/home/calculation/calculation.svelte'
    import Config from '$lib/components/page/home/config/config.svelte'
    import Result from '$lib/components/page/home/result/result.svelte'
    import PhaseTabs from '$lib/components/page/home/phase-tabs.svelte'
    import QuickLookup from '$lib/components/page/home/calculation/quick-lookup.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import ConfirmDeleteModal from '$lib/components/layout/confirm-delete-modal.svelte'
    import Icon from '@iconify/svelte'

    let showNewModal = $state(false)
    let newName = $state('')
    let showResult = $state(false)
    let showBuffLibrary = $state(false)
    let showSettings = $state(false)
    let showWorkshopFrame = $state(false)
    let workshopFrameKey = $state(0)

    let toyProfile = $derived(getToyProfile())

    // 工坊 iframe 地址：非 Toy 环境无身份 hash，src 与原先完全一致（界面不变）；
    // 身份（postMessage 手势后）到达时 src 变化，iframe 自动重新导航带上 #toy hash
    let workshopFrameSrc = $derived(buildWorkshopFrameSrc(getShareBase(), getToyProfile().data))

    // 工坊 iframe 弹窗打开时强制恢复系统光标（磁力光标瞬时抑制）
    $effect(() => {
        setMagneticForcedOff(showWorkshopFrame)
    })

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
            target = e.clientX <= 144 ? 52 : Math.max(200, Math.min(400, e.clientX))
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

    // ── 简化底部工具栏：fixed 圆角矩形，仅水平拖动，磁吸侧栏右缘 / 屏幕右缘 ──
    const simplifyToolbar = $derived(getSimplifyToolbar())
    let toolbarEl = $state<HTMLElement | null>(null)
    let toolbarX = $state<number | null>(null)
    let toolbarDrag = $state(false)
    let toolbarDragMoved = $state(false)
    let toolbarHover = $state(false)
    let toolbarStart = $state({ mx: 0, x: 0 })
    // 仅真正拖动（>4px）时整体放大 1.15；普通点击不触发整体缩放（按钮自身 :active 放大）
    const toolbarScale = $derived(toolbarDrag && toolbarDragMoved ? 1.15 : 1)
    // GPU 合成加速（设置 → 性能）：拖动定位用 transform 走合成层
    const gpuAccel = $derived(getGpuAccel())

    function toolbarDown(e: PointerEvent) {
        if (!simplifyToolbar) return
        e.preventDefault()
        toolbarDrag = true
        toolbarDragMoved = false
        const curLeft = toolbarEl?.getBoundingClientRect().left ?? toolbarX ?? window.innerWidth - 140
        toolbarStart = { mx: e.clientX, x: curLeft }
        // 不用 setPointerCapture（会把合成 click 重定向到容器导致按钮无法点击），改 window 级监听
        window.addEventListener('pointermove', toolbarMove)
        window.addEventListener('pointerup', toolbarUp)
        window.addEventListener('pointercancel', toolbarUp)
    }

    function toolbarMove(e: PointerEvent) {
        if (!toolbarDrag) return
        if (Math.abs(e.clientX - toolbarStart.mx) > 4) toolbarDragMoved = true
        const w = toolbarEl?.offsetWidth ?? 0
        const vw = window.innerWidth
        let nx = toolbarStart.x + (e.clientX - toolbarStart.mx)
        nx = Math.max(16, Math.min(nx, vw - w - 16))
        const leftAnchor = 16
        const rightAnchor = vw - w - 20
        if (Math.abs(nx - leftAnchor) < 48) nx = leftAnchor
        else if (Math.abs(nx - rightAnchor) < 48) nx = rightAnchor
        toolbarX = nx
    }

    function toolbarUp() {
        toolbarDrag = false
        window.removeEventListener('pointermove', toolbarMove)
        window.removeEventListener('pointerup', toolbarUp)
        window.removeEventListener('pointercancel', toolbarUp)
    }

    // 拖动超过阈值后抑制本次按钮 click（capture 阶段拦截）
    function toolbarClickCapture(e: MouseEvent) {
        if (toolbarDragMoved) {
            e.stopPropagation()
            toolbarDragMoved = false
        }
    }

    $effect(() => {
        if (!simplifyToolbar) return
        const onResize = () => {
            if (toolbarX !== null && toolbarEl) {
                toolbarX = Math.max(16, Math.min(toolbarX, window.innerWidth - toolbarEl.offsetWidth - 16))
            }
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    })

    let showLookup = $state(false)
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
            ['quick-lookup', '速查', () => showLookup, (v) => (showLookup = v)],
            ['buff-library', 'Buff 库', () => showBuffLibrary, (v) => (showBuffLibrary = v)],
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
        // 首次进入（任意端）：拉表默认平铺模式
        if (isFirstVisit()) {
            setCalcViewMode('spread')
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
            <div
                class="flex flex-1 flex-col items-center justify-center gap-8 px-8 portrait:items-start portrait:justify-start portrait:overflow-x-auto"
            >
                <div class="flex flex-col items-center text-center">
                    <div class="relative mb-4">
                        <div
                            class="absolute inset-0 rounded-full bg-(--theme-accent-bg)/25 blur-2xl"
                            aria-hidden="true"
                        ></div>
                        <img
                            src={favicon}
                            alt="椰果工具箱"
                            class="relative size-20 rounded-2xl object-contain drop-shadow-[0_0_10px_var(--theme-halo-color)]"
                        />
                    </div>
                    <h2
                        class="mb-2 text-3xl font-bold tracking-tight text-(--theme-card-text) [text-shadow:_0_0_8px_var(--theme-halo-color)]"
                    >
                        椰果工具箱
                    </h2>
                    <div class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                        {#if toyProfile.data}
                            <span
                                class="flex items-center gap-1.5 text-sm text-(--theme-card-text) [text-shadow:_0_0_2px_var(--theme-halo-color)]"
                            >
                                <img
                                    src={toyProfile.data.avatar}
                                    alt={toyProfile.data.nickname}
                                    class="size-5 rounded-full object-cover"
                                    referrerpolicy="no-referrer"
                                />
                                你好，{toyProfile.data.nickname}
                            </span>
                        {:else}
                            <span
                                class="text-sm text-(--theme-card-text) [text-shadow:_0_0_2px_var(--theme-halo-color)]"
                            >
                                鸣潮社区公益工具
                            </span>
                        {/if}
                        <span
                            class="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-(--theme-accent-text)"
                            style="background: color-mix(in srgb, var(--theme-accent-bg) 14%, transparent);"
                        >
                            数据版本 {getWWVersion()}
                        </span>
                    </div>
                </div>
                <div
                    class="grid w-full max-w-5xl grid-cols-4 gap-4 portrait:grid-cols-2 portrait:max-sm:grid-cols-1 portrait:gap-3 portrait:min-w-[560px] portrait:max-sm:min-w-[320px]"
                >
                    <button
                        onclick={() => {
                            newName = ''
                            showNewModal = true
                        }}
                        class="card-pop-in group flex flex-col items-start gap-3 rounded-2xl border border-(--theme-card-border) bg-(--theme-card-bg) p-6 text-left theme-glass-surface shadow-[var(--theme-card-shadow)] transition-all hover:-translate-y-0.5 hover:bg-(--theme-card-bg-focused) portrait:p-4 portrait:gap-2"
                        style="animation-delay: 0ms"
                    >
                        <Icon
                            icon="mdi:plus"
                            class="icon-pop size-9 text-(--theme-accent-text) drop-shadow-[0_0_3px_var(--theme-halo-color)] portrait:size-7"
                            style="animation-delay: 90ms"
                        />
                        <div class="flex flex-col gap-1">
                            <span
                                class="text-lg font-semibold text-(--theme-card-text) [text-shadow:_0_0_3px_var(--theme-halo-color)] portrait:text-base"
                                >创建工程</span
                            >
                            <span
                                class="portrait:hidden text-[15px] text-(--theme-muted-text) [text-shadow:_0_0_2px_var(--theme-halo-color)]"
                                >从空白开始，配置配队、排轴与伤害计算</span
                            >
                        </div>
                    </button>
                    <button
                        onclick={() => (showWorkshopFrame = true)}
                        class="card-pop-in group flex flex-col items-start gap-3 rounded-2xl border border-(--theme-card-border) bg-(--theme-card-bg) p-6 text-left theme-glass-surface shadow-[var(--theme-card-shadow)] transition-all hover:-translate-y-0.5 hover:bg-(--theme-card-bg-focused) portrait:p-4 portrait:gap-2"
                        style="animation-delay: 55ms"
                    >
                        <Icon
                            icon="mdi:storefront-outline"
                            class="icon-pop size-9 text-(--theme-accent-text) drop-shadow-[0_0_3px_var(--theme-halo-color)] portrait:size-7"
                            style="animation-delay: 145ms"
                        />
                        <div class="flex flex-col gap-1">
                            <span
                                class="text-lg font-semibold text-(--theme-card-text) [text-shadow:_0_0_3px_var(--theme-halo-color)] portrait:text-base"
                                >椰果工坊</span
                            >
                            <span
                                class="portrait:hidden text-[15px] text-(--theme-muted-text) [text-shadow:_0_0_2px_var(--theme-halo-color)]"
                                >前往社区站点浏览、分享与下载工程</span
                            >
                        </div>
                    </button>
                    <button
                        onclick={() => (showBuffLibrary = true)}
                        class="card-pop-in group flex flex-col items-start gap-3 rounded-2xl border border-(--theme-card-border) bg-(--theme-card-bg) p-6 text-left theme-glass-surface shadow-[var(--theme-card-shadow)] transition-all hover:-translate-y-0.5 hover:bg-(--theme-card-bg-focused) portrait:p-4 portrait:gap-2"
                        style="animation-delay: 110ms"
                    >
                        <Icon
                            icon="mdi:view-dashboard-outline"
                            class="icon-pop size-9 text-(--theme-accent-text) drop-shadow-[0_0_3px_var(--theme-halo-color)] portrait:size-7"
                            style="animation-delay: 200ms"
                        />
                        <div class="flex flex-col gap-1">
                            <span
                                class="text-lg font-semibold text-(--theme-card-text) [text-shadow:_0_0_3px_var(--theme-halo-color)] portrait:text-base"
                                >Buff 集</span
                            >
                            <span
                                class="portrait:hidden text-[15px] text-(--theme-muted-text) [text-shadow:_0_0_2px_var(--theme-halo-color)]"
                                >管理本地增益，拉表时一键导入</span
                            >
                        </div>
                    </button>
                    <button
                        onclick={() => (showSettings = true)}
                        class="card-pop-in group flex flex-col items-start gap-3 rounded-2xl border border-(--theme-card-border) bg-(--theme-card-bg) p-6 text-left theme-glass-surface shadow-[var(--theme-card-shadow)] transition-all hover:-translate-y-0.5 hover:bg-(--theme-card-bg-focused) portrait:p-4 portrait:gap-2"
                        style="animation-delay: 165ms"
                    >
                        <Icon
                            icon="mdi:cog-outline"
                            class="icon-pop size-9 text-(--theme-accent-text) drop-shadow-[0_0_3px_var(--theme-halo-color)] portrait:size-7"
                            style="animation-delay: 255ms"
                        />
                        <div class="flex flex-col gap-1">
                            <span
                                class="text-lg font-semibold text-(--theme-card-text) [text-shadow:_0_0_3px_var(--theme-halo-color)] portrait:text-base"
                                >设置</span
                            >
                            <span
                                class="portrait:hidden text-[15px] text-(--theme-muted-text) [text-shadow:_0_0_2px_var(--theme-halo-color)]"
                                >主题、按键图标与工坊设置</span
                            >
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

            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                bind:this={toolbarEl}
                role="toolbar"
                onpointerdown={toolbarDown}
                onpointermove={toolbarMove}
                onpointerup={toolbarUp}
                onpointercancel={toolbarUp}
                onpointerenter={() => (toolbarHover = true)}
                onpointerleave={() => (toolbarHover = false)}
                onclickcapture={toolbarClickCapture}
                class={simplifyToolbar
                    ? 'simplified-toolbar theme-glass-surface fixed bottom-5 z-40 flex cursor-grab touch-none select-none items-center gap-1.5 rounded-xl border p-2 shadow-2xl active:cursor-grabbing'
                    : 'flex shrink-0 items-center gap-2 border-t border-white/5 px-4 py-2.5'}
                style={simplifyToolbar
                    ? `interpolate-size: allow-keywords; border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 78%, transparent); color: var(--theme-modal-text);${
                          toolbarX !== null && gpuAccel
                              ? `left: 0; transform: translate(${toolbarX}px, 0) scale(${toolbarScale});`
                              : `transform: scale(${toolbarScale});${toolbarX !== null ? `left: ${toolbarX}px;` : 'right: 20px;'}`
                      }${
                          toolbarScale > 1
                              ? ' box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-accent-bg) 60%, transparent), 0 0 14px color-mix(in srgb, var(--theme-accent-bg) 45%, transparent);'
                              : ''
                      }transition: ${
                          toolbarDrag
                              ? 'left 150ms ease'
                              : 'transform 150ms ease, box-shadow 150ms ease, left 150ms ease, width 250ms ease'
                      };${toolbarDrag ? (gpuAccel ? ' will-change: transform;' : ' will-change: left;') : ''}`
                    : 'background: var(--theme-sidebar-bg); color: var(--theme-sidebar-text)'}
            >
                <button
                    onclick={() => (showLookup = true)}
                    disabled={!teamPhaseLocked}
                    class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 disabled:opacity-40 disabled:pointer-events-none {simplifyToolbar
                        ? 'rounded-full px-3 py-2'
                        : 'rounded-lg px-3 py-1.5'}"
                    title="速查"
                >
                    <Icon icon="mdi:book-search-outline" class="size-4 shrink-0" />
                    {#if !simplifyToolbar}<span>速查</span>{/if}
                </button>
                <button
                    onclick={() => (showCharDetail = true)}
                    class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                        ? 'rounded-full px-3 py-2'
                        : 'rounded-lg px-3 py-1.5'}"
                    title="角色详情配置"
                >
                    <Icon icon="mdi:account-details" class="size-4 shrink-0" />
                    {#if !simplifyToolbar}<span>角色详情配置</span>{/if}
                </button>
                {#if !showResult}
                    {#if activePhase === 'timeline'}
                        <button
                            onclick={() => setShowDamageList(true)}
                            class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                                ? 'rounded-full px-3 py-2'
                                : 'rounded-lg px-3 py-1.5'}"
                            title="查看所有伤害"
                        >
                            <Icon icon="mdi:chart-box-outline" class="size-4 shrink-0" />
                            {#if !simplifyToolbar}<span>查看所有伤害</span>{/if}
                        </button>
                        <button
                            onclick={formatTimeline}
                            class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                                ? 'rounded-full px-3 py-2'
                                : 'rounded-lg px-3 py-1.5'}"
                            title="自动格式化：每个操作块右边界对齐下一个块（可跨角色）的左边界，参考线跟随其左右块"
                        >
                            <Icon icon="mdi:auto-fix" class="size-4 shrink-0" />
                            {#if !simplifyToolbar}<span>格式化</span>{/if}
                        </button>
                        <div class="relative group">
                            <button
                                onclick={toggleQuickMode}
                                class="inline-flex items-center gap-1.5 border text-sm transition-colors {simplifyToolbar
                                    ? 'rounded-full px-3 py-2'
                                    : 'rounded-lg px-3 py-1.5'} {getQuickMode()
                                    ? 'border-(--theme-accent-bg)'
                                    : 'border-(--theme-sidebar-text)/20'}"
                                style="color: {getQuickMode()
                                    ? 'var(--theme-accent-text)'
                                    : 'var(--theme-sidebar-text)'}"
                                title="快速排轴"
                            >
                                <Icon icon="mdi:keyboard-outline" class="size-4 shrink-0" />
                                {#if !simplifyToolbar}
                                    <span
                                        >{getQuickMode()
                                            ? '快速排轴(关闭' +
                                              (getQuickSpecial() !== 'none'
                                                  ? `·${getQuickSpecial() === 'intro' ? '变奏' : '切回'}`
                                                  : '') +
                                              ')'
                                            : '快速排轴(开启)'}</span
                                    >
                                {/if}
                            </button>
                        </div>
                    {/if}
                    {#if activePhase === 'calculation'}
                        <button
                            onclick={() => setShowBuffModal(true)}
                            class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                                ? 'rounded-full px-3 py-2'
                                : 'rounded-lg px-3 py-1.5'}"
                            title="BUFF配置"
                        >
                            <Icon icon="mdi:tune-variant" class="size-4 shrink-0" />
                            {#if !simplifyToolbar}<span>BUFF配置</span>{/if}
                        </button>
                        {#if getCalcViewMode() !== 'spread'}
                            <button
                                onclick={toggleBuffDiffMode}
                                class="inline-flex items-center gap-1.5 border text-sm transition-colors {simplifyToolbar
                                    ? 'rounded-full px-3 py-2'
                                    : 'rounded-lg px-3 py-1.5'} {getBuffDiffMode()
                                    ? 'border-(--theme-accent-bg)'
                                    : 'border-(--theme-sidebar-text)/20'}"
                                style="color: {getBuffDiffMode()
                                    ? 'var(--theme-accent-text)'
                                    : 'var(--theme-sidebar-text)'}"
                                title={getBuffDiffMode() ? 'Buff差异模式' : 'Buff全览模式'}
                            >
                                <Icon
                                    icon={getBuffDiffMode() ? 'mdi:swap-vertical-bold' : 'mdi:swap-vertical'}
                                    class="size-4 shrink-0"
                                />
                                {#if !simplifyToolbar}
                                    <span>{getBuffDiffMode() ? 'Buff差异模式' : 'Buff全览模式'}</span>
                                {/if}
                            </button>
                        {/if}
                        {#if getCalcViewMode() === 'spread'}
                            <button
                                onclick={() => {
                                    const next = !getDamageTypeEditMode()
                                    setDamageTypeEditMode(next)
                                    addToast(next ? '已切换为编辑伤害类型' : '已切换为仅查看伤害类型', 'success')
                                }}
                                class="inline-flex items-center gap-1.5 border text-sm transition-colors {simplifyToolbar
                                    ? 'rounded-full px-3 py-2'
                                    : 'rounded-lg px-3 py-1.5'} {getDamageTypeEditMode()
                                    ? 'border-(--theme-accent-bg)'
                                    : 'border-(--theme-sidebar-text)/20'}"
                                style="color: {getDamageTypeEditMode()
                                    ? 'var(--theme-accent-text)'
                                    : 'var(--theme-sidebar-text)'}"
                                title="切换「视为」列伤害类型的编辑 / 只读查看"
                            >
                                <Icon
                                    icon={getDamageTypeEditMode() ? 'mdi:pencil' : 'mdi:eye-off'}
                                    class="size-4 shrink-0"
                                />
                                {#if !simplifyToolbar}
                                    <span>{getDamageTypeEditMode() ? '伤害类型(编辑中)' : '伤害类型(仅查看)'}</span>
                                {/if}
                            </button>
                            <button
                                onclick={() => {
                                    const next = getScrollAxisDefault() === 'vertical' ? 'horizontal' : 'vertical'
                                    setScrollAxisDefault(next)
                                    addToast(
                                        next === 'horizontal'
                                            ? '已切换为默认横向滚动（Shift+方向键改变默认方向，Ctrl+滚轮临时换向）'
                                            : '已切换为默认纵向滚动（Shift+方向键改变默认方向，Ctrl+滚轮临时换向）',
                                        'success'
                                    )
                                }}
                                class="inline-flex items-center gap-1.5 border text-sm transition-colors {simplifyToolbar
                                    ? 'rounded-full px-3 py-2'
                                    : 'rounded-lg px-3 py-1.5'} {getScrollAxisDefault() === 'horizontal'
                                    ? 'border-(--theme-accent-bg)'
                                    : 'border-(--theme-sidebar-text)/20'}"
                                style="color: {getScrollAxisDefault() === 'horizontal'
                                    ? 'var(--theme-accent-text)'
                                    : 'var(--theme-sidebar-text)'}"
                                title="修改默认滚动方向：Shift+方向键 改变默认方向（持久）；Ctrl+滚轮 临时换向"
                            >
                                <Icon
                                    icon={getScrollAxisDefault() === 'horizontal'
                                        ? 'mdi:arrow-right-bold'
                                        : 'mdi:arrow-down'}
                                    class="size-4 shrink-0"
                                />
                                {#if !simplifyToolbar}
                                    <span
                                        >{getScrollAxisDefault() === 'horizontal'
                                            ? '默认横向滚动'
                                            : '默认纵向滚动'}</span
                                    >
                                {/if}
                            </button>
                        {/if}
                        {#if getCalcViewMode() !== 'spread'}
                            <button
                                onclick={toggleHideConditionMismatch}
                                class="inline-flex items-center gap-1.5 border text-sm transition-colors {simplifyToolbar
                                    ? 'rounded-full px-3 py-2'
                                    : 'rounded-lg px-3 py-1.5'} {getHideConditionMismatch()
                                    ? 'border-(--theme-accent-bg)'
                                    : 'border-(--theme-sidebar-text)/20'}"
                                style="color: {getHideConditionMismatch()
                                    ? 'var(--theme-accent-text)'
                                    : 'var(--theme-sidebar-text)'}"
                                title="隐藏条件不匹配（链/阶低于配置、属性/类型对不上条目）的 buff"
                            >
                                <Icon
                                    icon={getHideConditionMismatch() ? 'mdi:filter-off' : 'mdi:filter-outline'}
                                    class="size-4 shrink-0"
                                />
                                {#if !simplifyToolbar}
                                    <span>{getHideConditionMismatch() ? '可用Buff' : '全部Buff'}</span>
                                {/if}
                            </button>
                        {/if}
                    {/if}
                {/if}
                {#if simplifyToolbar}
                    <div
                        class="mx-1.5 h-5 w-px shrink-0"
                        style="background: color-mix(in srgb, var(--theme-modal-text) 15%, transparent);"
                    ></div>
                {:else}
                    <div class="flex-1"></div>
                {/if}
                {#if showResult}
                    <button
                        onclick={async () => {
                            if (getReloadOnResultRefresh()) {
                                await handleReloadAllPhases()
                            }
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
                        class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 {simplifyToolbar
                            ? 'rounded-full px-3 py-2'
                            : 'rounded-lg px-3 py-1.5'}"
                        title="刷新结果"
                    >
                        <Icon icon="mdi:refresh" class="size-4 shrink-0" />
                        {#if !simplifyToolbar}<span>刷新结果</span>{/if}
                    </button>
                {/if}
                {#if !showResult}
                    <button
                        onclick={phaseLocked ? handleUnlockPhase : handleLockPhase}
                        disabled={!phaseLocked && !canLock}
                        class="inline-flex items-center gap-1.5 border border-(--theme-sidebar-text)/20 text-sm text-(--theme-sidebar-text) transition-colors hover:border-(--theme-sidebar-text)/40 disabled:opacity-40 disabled:pointer-events-none {simplifyToolbar
                            ? 'rounded-full px-3 py-2'
                            : 'rounded-lg px-3 py-1.5'}"
                        title={phaseLocked ? '解锁' : '锁定'}
                    >
                        <Icon
                            icon={phaseLocked ? 'mdi:lock-open-variant-outline' : 'mdi:lock-outline'}
                            class="size-4 shrink-0"
                        />
                        {#if !simplifyToolbar}<span>{phaseLocked ? '解锁' : '锁定'}</span>{/if}
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

{#if showWorkshopFrame}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5))"
        onclick={(e) => {
            if (e.target === e.currentTarget) showWorkshopFrame = false
        }}
        onkeydown={(e) => {
            if (e.key === 'Escape') showWorkshopFrame = false
        }}
        out:fade={{ duration: 130 }}
    >
        <div
            class="animate-pop-in flex h-[90vh] w-[min(94vw,1100px)] flex-col overflow-hidden rounded-xl border shadow-2xl"
            style="background: var(--theme-modal-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
            role="dialog"
            aria-modal="true"
            out:popOut
        >
            <div class="flex min-h-0 flex-1">
                <!-- Left toolbar -->
                <div
                    class="flex w-12 shrink-0 flex-col items-center gap-1 border-r py-3"
                    style="border-color: var(--theme-divider-border);"
                >
                    <button
                        onclick={() => workshopFrameKey++}
                        class="rounded p-2 text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/10 hover:text-(--theme-modal-text)"
                        title="刷新"
                    >
                        <Icon icon="mdi:refresh" class="size-4.5" />
                    </button>
                    <a
                        href={getShareBase()}
                        target="_blank"
                        rel="noreferrer"
                        class="rounded p-2 text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/10 hover:text-(--theme-modal-text)"
                        title="在新标签页打开"
                    >
                        <Icon icon="mdi:open-in-new" class="size-4.5" />
                    </a>
                    <button
                        onclick={() => (showWorkshopFrame = false)}
                        class="rounded p-2 text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/10 hover:text-red-500"
                        title="关闭"
                    >
                        <Icon icon="mdi:close" class="size-4.5" />
                    </button>
                </div>
                {#key workshopFrameKey}
                    <iframe src={workshopFrameSrc} title="椰果工坊" class="min-h-0 w-full flex-1 border-0"></iframe>
                {/key}
            </div>
        </div>
    </div>
{/if}

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
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (showNewModal = false)}
                    class="theme-glass-surface h-7 rounded-md bg-(--theme-card-bg) px-3 text-xs text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
                    >取消</button
                >
                <button
                    disabled={!newName.trim()}
                    onclick={() => handleCreate(newName)}
                    class="h-7 rounded-md px-3 text-xs transition-all hover:brightness-125 disabled:opacity-40 disabled:pointer-events-none"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
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
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-700 focus:border-(--theme-accent-bg)/50 theme-glass-surface"
                    style="background: var(--theme-search-box-bg); color: var(--theme-search-box-text)"
                    onkeydown={(e) => e.key === 'Enter' && handleRename()}
                />
            </div>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (renameModal = false)}
                    class="theme-glass-surface h-7 rounded-md bg-(--theme-card-bg) px-3 text-xs text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
                    >取消</button
                >
                <button
                    disabled={!renameValue.trim()}
                    onclick={handleRename}
                    class="h-7 rounded-md px-3 text-xs transition-all hover:brightness-125 disabled:opacity-40 disabled:pointer-events-none"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
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
                            class="size-4"
                            style="accent-color: var(--theme-accent-bg, #6366f1)"
                        />
                        <span>{PHASE_LABELS[phase]}</span>
                    </label>
                {/each}
            </div>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (exportModal = false)}
                    class="theme-glass-surface h-7 rounded-md bg-(--theme-card-bg) px-3 text-xs text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
                    >取消</button
                >
                <button
                    onclick={handleExport}
                    class="h-7 rounded-md px-3 text-xs transition-all hover:brightness-125"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
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
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-700 focus:border-(--theme-accent-bg)/50 theme-glass-surface"
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
                    class="theme-glass-surface h-7 rounded-md bg-(--theme-card-bg) px-3 text-xs text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
                    >取消</button
                >
                <button
                    disabled={!cloneName.trim()}
                    onclick={handleClone}
                    class="h-7 rounded-md px-3 text-xs transition-all hover:brightness-125 disabled:opacity-40 disabled:pointer-events-none"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                    >复制</button
                >
            </div>
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

<style>
    /* 首页功能卡片入场：错峰上浮淡入 + 轻微缩放 */
    .card-pop-in {
        animation: card-pop-in 0.38s cubic-bezier(0.2, 0, 0, 1) backwards;
    }
    @keyframes card-pop-in {
        0% {
            opacity: 0;
            transform: translateY(16px) scale(0.98);
        }
        100% {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }
    /* 卡片图标：快速弹跳（:global，作用于 Icon 组件根元素） */
    :global(.icon-pop) {
        animation: icon-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
    }
    @keyframes icon-pop {
        0% {
            transform: scale(0);
        }
        70% {
            transform: scale(1.12);
        }
        100% {
            transform: scale(1);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .card-pop-in,
        :global(.icon-pop) {
            animation: none;
        }
    }

    /* ── 简化底部工具栏（悬浮模式）── */
    /* 按钮点击/按住时按钮自身放大（hover 不放大）；保留原有颜色过渡 */
    .simplified-toolbar > button {
        transition:
            transform 150ms ease,
            color 150ms ease,
            background-color 150ms ease,
            border-color 150ms ease;
    }
    .simplified-toolbar > button:active:not(:disabled) {
        transform: scale(1.15);
    }
</style>
