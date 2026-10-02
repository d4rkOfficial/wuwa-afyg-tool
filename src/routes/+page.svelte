<script lang="ts">
    import { onMount, tick } from 'svelte'
    import { registerPanel, unregisterPanel } from '$lib/ai/panels.svelte'
    import {
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
        buildExportFile,
        parseProjectFile,
        archiveProject,
        updateConditionProfile,
        ProjectParseError
    } from '$lib/data/project.svelte'
    import { importFromShareUrl, shareAndCopy, shareState, shareCooldownLabel } from '$lib/data/share.svelte'
    import { pushProjectSwitch, pushPhaseChange } from '$lib/ai/change-queue.svelte'
    import type { PhaseKey } from '$lib/types/project'
    import type { TimelineData } from '$lib/calc/timeline.types'
    import type { CalcState } from '$lib/calc/calculation.types'
    import type { ConfigState } from '$lib/calc/config.types'
    import { PHASE_LABELS } from '$lib/consts/game-terms'
    import { addToast } from '$lib/data/toast.svelte'
    import { preloadCharElements } from '$lib/data/char-elements.svelte'
    import { loadCustomHits } from '$lib/calc/timeline.store.svelte'
    import {
        setShowBuffModal,
        setShowDamageTypeModal,
        getShowDamageTypeModal,
        setProfileChangeListener,
        getCalcState,
        createBuffSet,
        setPendingFocusBuffSetId
    } from '$lib/calc/calculation.store.svelte'
    import { getReloadOnResultRefresh, getReloadOnProfileChange } from '$lib/data/render-prefs.svelte'
    import { setWsHost } from '$lib/ws-remote/ws-remote.svelte'
    import { registerHashAction, runHashActions } from '$lib/utils/hash-actions.svelte'
    import { getSimplifyToolbar } from '$lib/data/toolbar-prefs.svelte'
    import {
        getConfirmDeletes,
        getLockWatermark,
        getEffectiveLockWatermarkText
    } from '$lib/data/interaction-prefs.svelte'
    import ProjectSidebar from '$lib/components/page/home/project-sidebar.svelte'
    import WorkshopModal from '$lib/components/page/home/workshop/workshop-modal.svelte'
    import SubstatLibraryModal from '$lib/components/page/home/config/substat-library-modal.svelte'
    import DamageTypeModal from '$lib/components/page/home/calculation/damage-type-modal.svelte'
    import {
        getSubstatLibraryOpen,
        openSubstatLibrary,
        setSubstatLibraryOpen
    } from '$lib/data/substat-library-ui.svelte'
    import BuffLibraryModal from '$lib/components/page/home/calculation/buff-library-modal.svelte'
    import SettingsModal from '$lib/components/page/home/settings/settings-modal.svelte'
    import CharacterDetailModal from '$lib/components/page/home/config/character-detail-modal.svelte'
    import AiAssistant from '$lib/components/page/home/settings/ai-assistant.svelte'
    import TeamConfig from '$lib/components/page/home/team/team-config.svelte'
    import Timeline from '$lib/components/page/home/timeline/timeline.svelte'
    import Calculation from '$lib/components/page/home/calculation/calculation.svelte'
    import Config from '$lib/components/page/home/config/config.svelte'
    import Result from '$lib/components/page/home/result/result.svelte'
    import PhaseTabs from '$lib/components/page/home/phase-tabs.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import ConfirmDeleteModal from '$lib/components/ui/confirm-delete-modal.svelte'
    import Icon from '@iconify/svelte'
    import WelcomeScreen from '$lib/components/page/home/welcome-screen.svelte'
    import Toolbar from '$lib/components/page/home/toolbar.svelte'
    import WorkshopFrameModal from '$lib/components/page/home/workshop/workshop-frame-modal.svelte'
    import { CLONE_SELECTION_DEFAULTS, SIDEBAR_MAX_EXPANDED, SIDEBAR_SHORT_EXPANDED } from './consts'
    import {
        bootstrapRouteStores,
        reloadActiveProjectStores,
        relockAllPhases,
        syncPhaseLockSideEffects
    } from './store.svelte'
    import type { PhaseSelectionMap, TeamSlots } from './types'
    import {
        cloneSelectionsUpTo,
        collectTeamCharacterNames,
        isTeamComplete,
        projectDataFingerprint,
        selectedPhaseKeys
    } from './utils'

    let showNewModal = $state(false)
    let newName = $state('')
    let showResult = $state(false)
    let showBuffLibrary = $state(false)
    let showSettings = $state(false)
    /** @desc 「编辑伤害类型」弹窗开关（底部工具栏按钮 / AI、WS 面板工具共用，状态在 calculation store 里） */
    let showDamageTypeModal = $derived(getShowDamageTypeModal())
    let showWorkshopFrame = $state(false)
    /** @desc 工坊 iframe 弹窗的目标路径（空 = 工坊首页；如 /share/xxx = 详情页） */
    let workshopFramePath = $state('')

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
            target = e.clientX <= 144 ? 52 : Math.max(200, Math.min(600, e.clientX))
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

    const sidebarWide = $derived(sidebarWidth >= SIDEBAR_MAX_EXPANDED - 1)
    function toggleSidebarWidth() {
        sidebarWidth = sidebarWide ? SIDEBAR_SHORT_EXPANDED : SIDEBAR_MAX_EXPANDED
    }

    let sidebarLookupOpen = $state(false)

    $effect(() => {
        // 无活动工程：侧边栏速查收起（顶部 toggle 按钮也依赖活动工程隐藏）
        if (!activeProject && sidebarLookupOpen) sidebarLookupOpen = false
    })

    // 速查开/关时联动侧栏宽度：开启→自动延展到最长；关闭→若几乎最宽则自动收窄
    let prevSidebarLookupOpen = false
    $effect(() => {
        const nowOpen = sidebarLookupOpen
        if (nowOpen === prevSidebarLookupOpen) return
        if (nowOpen) {
            // 开启速查：侧栏未至最长档则延展
            if (sidebarWidth < SIDEBAR_MAX_EXPANDED - 1) sidebarWidth = SIDEBAR_MAX_EXPANDED
        } else {
            // 关闭速查：侧栏几乎最宽（容差 24px）则收窄回较短档
            if (sidebarWidth >= SIDEBAR_MAX_EXPANDED - 24) sidebarWidth = SIDEBAR_SHORT_EXPANDED
        }
        prevSidebarLookupOpen = nowOpen
    })
    let showCharDetail = $state(false)
    let resultRefreshKey = $state(0)
    let renameModal = $state(false)
    let renameId = $state('')
    let renameValue = $state('')

    let cloneModal = $state(false)
    let cloneId = $state('')
    let cloneName = $state('')
    let cloneSelections = $state<PhaseSelectionMap>({ ...CLONE_SELECTION_DEFAULTS })
    let cloneResult = $state(false)

    let deleteModal = $state(false)
    let deleteId = $state('')
    let deleteName = $state('')

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
            ['quick-lookup', '速查', () => sidebarLookupOpen, (v) => (sidebarLookupOpen = v)],
            ['buff-library', 'Buff 集', () => showBuffLibrary, (v) => (showBuffLibrary = v)],
            ['substat-library', '快速词条方案', () => getSubstatLibraryOpen(), (v) => setSubstatLibraryOpen(v)],
            ['damage-type', '编辑伤害类型', () => getShowDamageTypeModal(), (v) => setShowDamageTypeModal(v)],
            ['settings', '设置', () => showSettings, (v) => (showSettings = v)],
            ['workshop', '工坊', () => showWorkshop, (v) => (showWorkshop = v)],
            [
                'workshop-frame',
                '工坊页',
                () => showWorkshopFrame,
                (v) => {
                    if (v) workshopFramePath = ''
                    showWorkshopFrame = v
                }
            ],
            ['character-detail', '角色详情配置', () => showCharDetail, (v) => (showCharDetail = v)],
            ['new-project', '新建工程', () => showNewModal, (v) => (showNewModal = v)],
            ['rename-project', '重命名工程', () => renameModal, (v) => (renameModal = v)],
            ['clone-project', '克隆工程', () => cloneModal, (v) => (cloneModal = v)],
            ['delete-project', '删除工程', () => deleteModal, (v) => (deleteModal = v)]
        ]
        for (const [name, label, get, set] of panels) registerPanel(name, label, get, set)
        return () => {
            for (const [name] of panels) unregisterPanel(name)
        }
    })

    onMount(async () => {
        await bootstrapRouteStores()
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
        const names = collectTeamCharacterNames(projects)
        if (names.length > 0) {
            preloadCharElements(names)
        }
    })

    function handleCreate(name: string) {
        if (!name.trim()) return
        createProject(name.trim())
        showNewModal = false
        newName = ''
        initForActiveProject()
        addToast(`工程「${name.trim()}」已创建`, 'success')
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
        addToast('工程已重命名', 'success')
    }

    function openClone(id: string) {
        const p = projects.find((pr) => pr.id === id)
        if (!p) return
        cloneId = id
        cloneName = `${p.name} (副本)`
        cloneSelections = cloneSelectionsUpTo(getPhaseOrder(), activePhase)
        cloneResult = false
        cloneModal = true
    }

    async function handleClone() {
        if (!cloneName.trim()) return
        const selected = selectedPhaseKeys(cloneSelections)
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
        addToast('工程已删除', 'info')
    }

    function goHome() {
        setActiveProject('')
        activePhase = 'team'
    }

    /** @desc 导出工程：全阶段一次性导出（含结果页），不再弹勾选框 */
    function openExport(id: string) {
        const p = projects.find((pr) => pr.id === id)
        if (!p) return
        const file = buildExportFile(p, getPhaseOrder(), true)
        const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${p.name}.json`
        a.click()
        URL.revokeObjectURL(url)
        addToast(`工程「${p.name}」已导出（全阶段）`, 'success')
    }

    function handleImport() {
        const file = importInput?.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
            try {
                const normalized = parseProjectFile(reader.result as string)
                importProjects(normalized)
                addToast(`成功导入 ${normalized.length} 个工程`, 'success')
            } catch (e) {
                addToast(e instanceof ProjectParseError ? `导入失败：${e.message}` : '导入失败：文件格式错误', 'error')
            }
        }
        reader.readAsText(file)
        if (importInput) importInput.value = ''
    }

    /** @desc 记录工程四阶段 + 队伍的变化指纹，变化时推入 AI 变化队列（供 AI 助手感知） */
    let _lastChangeFp = ''
    $effect(() => {
        const p = activeProject
        if (!p) return
        const fp = JSON.stringify([
            p.id,
            p.team,
            p.encounter.timeline.data ? JSON.stringify(p.encounter.timeline.data).length : 0,
            p.encounter.calculation.data ? JSON.stringify(p.encounter.calculation.data) : null,
            p.encounter.config.data ? JSON.stringify(p.encounter.config.data) : null
        ])
        if (fp === _lastChangeFp) return
        const first = _lastChangeFp === ''
        _lastChangeFp = fp
        // 首次建立基线时不入队（避免刚打开页面就报一堆「变化」）
        if (first) return
        pushPhaseChange('calculation', '工程数据发生变化')
    })

    function handleSelectProject(id: string) {
        setActiveProject(id)
        const next = projects.find((pr) => pr.id === id)
        if (next) pushProjectSwitch(next.name, next.id)
        initForActiveProject()
    }

    let showWorkshop = $state(false)

    async function handleShare(id: string) {
        if (shareState.cooldownRemaining > 0) {
            addToast(`分享冷却中，请在 ${shareCooldownLabel()} 后重试`, 'info')
            return
        }
        const p = projects.find((pr) => pr.id === id)
        if (!p) return
        addToast('正在生成分享链接...', 'info')
        const res = await shareAndCopy(p)
        if (!res.ok) {
            addToast(res.error ?? '分享失败', 'error')
            return
        }
        addToast('已分享(10分钟)，链接已复制到剪贴板', 'success')
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

    /** @desc 关闭「编辑伤害类型」弹窗并回写工程 */
    function handleCloseDamageTypeModal() {
        setShowDamageTypeModal(false)
        void updateCalculation(getCalcState())
    }

    /** @desc 伤害类型改动后回写工程（弹窗内每次点选/同步都调用） */
    function handlePersistDamageTypes() {
        void updateCalculation(getCalcState())
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
    /** @desc 锁定水印文案（设置-交互相关可自定义，留空回落默认「已锁定」） */
    let lockWatermarkText = $derived(getEffectiveLockWatermarkText())
    let canLock = $derived.by(() => {
        if (phaseLocked) return false
        const idx = getPhaseOrder().indexOf(activePhase)
        if (idx === 0) return activeProject ? isTeamComplete(activeProject.team) : false
        return activeProject?.phases[getPhaseOrder()[idx - 1]]?.locked === true
    })

    function handleUpdateTeam(team: TeamSlots) {
        updateTeam(team)
    }

    function handleResetTeam() {
        if (!activeProject) return
        unlockPhase(activeProject.id, 'team')
    }

    function handleLockPhase() {
        if (!activeProject) return
        lockPhase(activePhase)
        syncPhaseLockSideEffects(activePhase)
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

    /** @desc 重载数据并重新锁定全部环节（「刷新结果」与「链/阶变动」共用） */
    async function handleReloadAllPhases() {
        initForActiveProject()
        await relockAllPhases()
        addToast('已重载数据并重新锁定全部环节', 'info')
    }

    /** @desc 链/阶档位变动回调：开启「链/阶变动重载数据」时重载全部阶段数据（不跳转视图，结果页若已打开会自动重算） */
    async function handleProfileReload() {
        if (!getReloadOnProfileChange()) return
        reloadActiveProjectStores()
        await relockAllPhases()
        addToast('链/阶变动，已重载数据并重新锁定全部环节', 'info')
    }

    function handleLockTab(phase: PhaseKey) {
        if (!activeProject) return
        const idx = getPhaseOrder().indexOf(phase)
        if (idx === 0 && !isTeamComplete(activeProject.team)) return
        if (idx > 0 && !activeProject.phases[getPhaseOrder()[idx - 1]]?.locked) return
        lockPhase(phase)
        syncPhaseLockSideEffects(phase)
        addToast(`${PHASE_LABELS[phase]} 已锁定`, 'success')
    }

    // 上次刷新时的工程数据指纹：数据未变时跳过逐阶段重挂（init 幂等短路，重挂只是重渲染+重测量）
    let _lastRefreshFp = ''

    // 刷新结果（开启重载数据时先重解锁全部环节再按原锁定状态重锁）：数据有变才逐阶段重挂载，随后刷新结果页
    async function handleRefreshResult() {
        if (getReloadOnResultRefresh()) {
            await handleReloadAllPhases()
        }
        const fp = projectDataFingerprint(getActiveProject())
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
        {sidebarLookupOpen}
        {sidebarWide}
        onToggleSidebarLookup={() => (sidebarLookupOpen = !sidebarLookupOpen)}
        onToggleSidebarWidth={toggleSidebarWidth}
        team={activeProject?.team}
        locked={phaseLocked}
        onCreateBuff={(name) => {
            // 新建后记下 id，buff 弹窗打开时自动滚动定位到这条
            const id = createBuffSet(name)
            if (id) setPendingFocusBuffSetId(id)
            sidebarLookupOpen = false
            setShowBuffModal(true)
        }}
        showBuffOption={activePhase === 'calculation' && !showResult}
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
        data-press="none"
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
                onWorkshopFrame={() => {
                    workshopFramePath = ''
                    showWorkshopFrame = true
                }}
                onBuffLibrary={() => (showBuffLibrary = true)}
                onSubstatLibrary={() => openSubstatLibrary(null, 'home')}
                onsettings={() => (showSettings = true)}
                oncreate={() => {
                    newName = ''
                    showNewModal = true
                }}
                onimport={() => importInput?.click()}
                onworkshop={() => (showWorkshop = true)}
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
                {#if !showResult && phaseLocked && getLockWatermark()}
                    <!-- 已锁定遮罩：纯透明背景 + SVG pattern 平铺小字（文案可在 设置-交互相关-锁定水印 自定义）。
                         整层 opacity-10 封顶，文字取 currentColor（主题文本色），保证任何主题/任何变量解析下都只弱显示、不遮挡内容 -->
                    <div class="absolute inset-0 z-(--z-sticky) pointer-events-none select-none opacity-10">
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
                                        letter-spacing="4">{lockWatermarkText}</text
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
                {phaseLocked}
                {canLock}
                team={activeProject.team}
                onCharDetail={() => (showCharDetail = true)}
                onrefresh={handleRefreshResult}
                onLockToggle={() => (phaseLocked ? handleUnlockPhase() : handleLockPhase())}
            />
        {/if}
    </div>
</div>

<svelte:head><title>椰果工具箱</title></svelte:head>

<WorkshopModal
    open={showWorkshop}
    onclose={() => (showWorkshop = false)}
    ondetail={(code) => {
        workshopFramePath = `/share/${code}`
        showWorkshopFrame = true
    }}
/>

<BuffLibraryModal open={showBuffLibrary} onclose={() => (showBuffLibrary = false)} />

<SubstatLibraryModal />

<!-- @desc 编辑伤害类型弹窗：与词条集一样挂在页面顶层（底部工具栏按钮打开） -->
<DamageTypeModal
    open={showDamageTypeModal}
    locked={phaseLocked}
    onclose={handleCloseDamageTypeModal}
    onpersist={handlePersistDamageTypes}
/>

{#if activeProject}
    <CharacterDetailModal
        open={showCharDetail}
        team={activeProject.team}
        configState={activeProject.phases.config.data as ConfigState | null}
        calcState={activeProject.phases.calculation.data as CalcState | null}
        onclose={() => (showCharDetail = false)}
        onTeamUpdate={(next) => handleUpdateTeam(next)}
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

<WorkshopFrameModal
    open={showWorkshopFrame}
    onclose={() => (showWorkshopFrame = false)}
    path={workshopFramePath || undefined}
/>

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
            新建工程
        {/snippet}
        <div class="space-y-4">
            <div>
                <label for="project-name" class="mb-1 block text-[10px] text-(--theme-modal-text)/40">工程名称</label>
                <input
                    id="project-name"
                    bind:value={newName}
                    placeholder="输入工程名称"
                    class="w-full rounded-none border border-(--theme-divider-border) px-3 py-2 text-sm outline-none transition-colors placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)/50 theme-glass-surface"
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
            重命名工程
        {/snippet}
        <div class="space-y-4">
            <div>
                <label for="rename-name" class="mb-1 block text-[10px] text-(--theme-modal-text)/40">工程名称</label>
                <input
                    id="rename-name"
                    bind:value={renameValue}
                    placeholder="输入新名称"
                    class="w-full rounded-none border border-(--theme-divider-border) px-3 py-2 text-sm outline-none transition-colors placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)/50 theme-glass-surface"
                    style="background: var(--theme-search-box-bg); color: var(--theme-search-box-text)"
                    onkeydown={(e) => e.key === 'Enter' && handleRename()}
                />
            </div>
            {@render modalFooter(!renameValue.trim(), '确认', () => (renameModal = false), handleRename)}
        </div>
    </Modal>
{/if}

<!-- @desc 导出不再弹勾选框：全阶段一次性导出（含结果页） -->

<!-- Clone Modal -->
{#if cloneModal}
    <Modal open={true} onclose={() => (cloneModal = false)}>
        {#snippet title()}
            复制工程
        {/snippet}
        <div class="space-y-4">
            <div>
                <label for="clone-name" class="mb-1 block text-[10px] text-(--theme-modal-text)/40">新工程名称</label>
                <input
                    id="clone-name"
                    bind:value={cloneName}
                    placeholder="输入新工程名称"
                    class="w-full rounded-none border border-(--theme-divider-border) px-3 py-2 text-sm outline-none transition-colors placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)/50 theme-glass-surface"
                    style="background: var(--theme-search-box-bg); color: var(--theme-search-box-text)"
                    onkeydown={(e) => e.key === 'Enter' && handleClone()}
                />
            </div>
            <div>
                <p class="mb-2 text-[10px] text-(--theme-modal-text)/40">
                    选择要保留的部分（勾选的部分将被复制并锁定）
                </p>
                {@render phaseChecklist(cloneSelections, toggleClonePhase)}
            </div>
            <label
                class="flex cursor-pointer items-center gap-2.5 rounded-none px-3 py-2 text-sm transition-colors hover:bg-(--theme-modal-text)/5"
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
        title="删除工程"
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
            class="theme-glass-surface h-7 rounded-none bg-(--theme-card-bg) px-3 text-xs text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
            >取消</button
        >
        <button
            {disabled}
            onclick={onConfirm}
            class="h-7 rounded-none px-3 text-xs transition-all hover:brightness-125 disabled:opacity-40 disabled:pointer-events-none"
            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
            >{confirmLabel}</button
        >
    </div>
{/snippet}

{#snippet phaseChecklist(selections: Record<PhaseKey, boolean>, onToggle: (phase: PhaseKey) => void)}
    <div class="space-y-1.5">
        {#each getPhaseOrder() as phase (phase)}
            <label
                class="flex cursor-pointer items-center gap-2.5 rounded-none px-3 py-2 text-sm transition-colors hover:bg-(--theme-modal-text)/5"
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
