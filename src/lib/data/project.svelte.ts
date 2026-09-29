import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import { getConditionProfile, getCalcState } from '$lib/calc/calculation.store.svelte'
import { getTimelineState } from '$lib/calc/timeline.store.svelte'
import { getConfig } from '$lib/calc/config.store.svelte'
import type { Project, CharSlot, PhaseKey, ResultAnalysisData } from '$lib/types/project'
import { PROJECT_VERSION } from '$lib/types/project'
import type { TimelineData } from '$lib/calc/timeline.types'
import type { CalcState } from '$lib/calc/calculation.types'
import type { ConfigState } from '$lib/calc/config.types'
import { conditionProfileFromTeam, migrateProject, toPlainProject, PHASE_ORDER } from '$lib/data/migration'

const PROJECTS_KEY = 'projects'
const ACTIVE_KEY = 'project-active'

function deepCloneTeam(team: [CharSlot, CharSlot, CharSlot]): [CharSlot, CharSlot, CharSlot] {
    return JSON.parse(JSON.stringify(team)) as [CharSlot, CharSlot, CharSlot]
}

/** @desc 深拷贝单个阶段的锁定态与数据到目标工程（team 阶段走 teamLocked，不在此处理） */
function cloneEncounterPhase(target: Project, source: Project, phase: PhaseKey): void {
    if (phase === 'team') return
    const copyOne = <T>(from: { locked: boolean; data: T | null }): { locked: boolean; data: T | null } => ({
        locked: true,
        data: from.data ? toPlain(from.data) : null
    })
    if (phase === 'timeline') target.encounter.timeline = copyOne(source.encounter.timeline)
    else if (phase === 'calculation') target.encounter.calculation = copyOne(source.encounter.calculation)
    else target.encounter.config = copyOne(source.encounter.config)
}

/** @desc 兼容期同步：把旧字段视图（phases/conditionProfile/buffSets）写入新结构真源 */
function syncLegacyIntoNew(p: Project): Project {
    const { phases, conditionProfile, buffSets } = p
    if (phases) {
        p.encounter = {
            teamLocked: phases.team?.locked ?? p.encounter.teamLocked,
            timeline: {
                locked: phases.timeline?.locked ?? false,
                data: (phases.timeline?.data ?? null) as TimelineData | null
            },
            calculation: {
                locked: phases.calculation?.locked ?? false,
                data: (phases.calculation?.data ?? null) as CalcState | null
            },
            config: {
                locked: phases.config?.locked ?? false,
                data: (phases.config?.data ?? null) as ConfigState | null
            }
        }
    }
    if (conditionProfile) {
        p.team = p.team.map((slot, i) => ({
            ...slot,
            chain: conditionProfile.chains?.[i] ?? slot.chain ?? 0,
            refinement: conditionProfile.refinements?.[i] ?? slot.refinement ?? 1
        })) as [CharSlot, CharSlot, CharSlot]
    }
    if (buffSets && !p.buffs?.length) p.buffs = buffSets
    return p
}

/**
 * @desc 由新结构真源刷新兼容期视图。
 *
 * **三个视图都必须一起刷新**：
 * - `buffSets ← buffs`
 * - `conditionProfile ← team[].chain/refinement`
 * - `phases[].data/locked ← encounter.*` —— 这一条曾经漏掉，症状就是「复制工程后除了队伍配置全是空白」：
 *   `cloneProject` 把四阶段数据写进了 `encounter`（真源），但页面读的是 `p.phases.<phase>.data`
 *   （见 reloadActiveProjectStores），视图没同步 → 读到的还是 null。队伍配置读 `project.team`，所以只有它正常。
 */
function applyDerivedViews(p: Project): Project {
    if (!p.buffs) p.buffs = []
    p.buffSets = p.buffs
    p.conditionProfile = conditionProfileFromTeam(p.team)
    p.phases = {
        team: { locked: p.encounter.teamLocked, data: null },
        timeline: { locked: p.encounter.timeline.locked, data: p.encounter.timeline.data },
        calculation: { locked: p.encounter.calculation.locked, data: p.encounter.calculation.data },
        config: { locked: p.encounter.config.locked, data: p.encounter.config.data }
    }
    return p
}

/** @desc 归一化并迁移工程数据到当前版本（幂等；索引库载入 / 导入 / 分享下载共用） */
function normalizeProject(p: Partial<Project>): Project {
    return applyDerivedViews(syncLegacyIntoNew(migrateProject(p)))
}

function toPlain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value))
}

export function createProjectData(name: string): Project {
    return normalizeProject({
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now()
    })
}

export function getTeamKeyFromTeam(team: [CharSlot, CharSlot, CharSlot]): string {
    return team
        .filter((s) => s.character !== null && s.weapon !== null)
        .map((s) => s.character as string)
        .sort()
        .join(',')
}

let projects = $state<Project[]>([])
let activeId = $state<string>('')

export async function loadProjects() {
    if (!browser) return

    const saved = await dbGet<Project[]>(PROJECTS_KEY)

    if (saved && saved.data.length > 0) {
        projects = saved.data.map(normalizeProject)
        activeId = ''
        await dbSet(ACTIVE_KEY, '')
        await persist()
    }
}

export function getProjects() {
    return projects
}

export function getActiveId() {
    return activeId
}

export function getActiveProject() {
    return projects.find((p) => p.id === activeId) ?? null
}

/**
 * @desc 仅供测试：直接注入工程列表与活动工程 id。
 * 生产代码里这两项只由 loadProjects / createProject / setActiveProject 维护；
 * 测试环境 browser=false，走不到 IndexedDB 载入路径，需要这个入口来搭场景。
 */
export function __seedProjectsForTest(list: Project[], active = ''): void {
    projects = list
    activeId = active
}

export async function createProject(name: string) {
    const project = createProjectData(name)
    projects = [...projects, project]
    activeId = project.id
    await dbSet(ACTIVE_KEY, activeId)
    await persist()
    return project
}

export async function renameProject(id: string, newName: string) {
    const project = projects.find((p) => p.id === id)
    if (!project) return
    project.name = newName
    await persist()
}

export async function cloneProject(id: string, newName: string, selectedPhases: PhaseKey[]) {
    const source = projects.find((p) => p.id === id)
    if (!source) return

    /**
     * @desc 复制前先把**当前打开工程**的实时状态并回它的 encounter 快照。
     *
     * 为什么需要：`encounter.<phase>.data` 只在**锁定该环节**时落盘（见 handleLockPhase：
     * lockPhase 之后才 updateTimeline / updateCalculation / updateConfig）。所以刚改完、还没锁定的环节
     * 在工程里仍然指向旧值（甚至 null）。复制若直接读快照，就会出现「除了队伍配置全是空白」——
     * 队伍配置一直挂在 project.team 上，而排轴 / 拉表 / 词条配置只存在于内存 store。
     *
     * 这里按「快照为底、活状态覆盖」合并：已锁定的环节用活状态（与刚锁定时一致），
     * 未锁定的环节同样用活状态（正是要救的那些）。非活动工程不受影响。
     */
    if (id === activeId) {
        const mirrors: { phase: PhaseKey; data: unknown }[] = [
            { phase: 'timeline', data: getTimelineState() },
            { phase: 'calculation', data: getCalcState() },
            { phase: 'config', data: getConfig() }
        ]
        for (const { phase, data } of mirrors) {
            if (phase === 'timeline') source.encounter.timeline.data = toPlain(data) as TimelineData
            else if (phase === 'calculation') {
                const state = toPlain(data) as CalcState
                source.encounter.calculation.data = state
                // 与 updateCalculation 同口径：拉表实例也同步到真源（复制读的是 source.buffs）
                if (state.buffSets) source.buffs = state.buffSets
            } else source.encounter.config.data = toPlain(data) as ConfigState
        }
    }

    const newProject = createProjectData(newName)

    if (selectedPhases.includes('team')) {
        newProject.team = deepCloneTeam(source.team)
        if (source.lockedTeamKey) {
            newProject.lockedTeamKey = source.lockedTeamKey
            newProject.lockedTeamNames = source.lockedTeamNames
        }
    }

    for (const phase of PHASE_ORDER) {
        if (phase === 'team') continue
        if (selectedPhases.includes(phase)) {
            cloneEncounterPhase(newProject, source, phase)
        }
    }
    newProject.encounter.teamLocked = source.encounter.teamLocked

    // 拉表页数据（Buff 实例 / 绑定 / 条目配置）随 calculation 阶段克隆
    if (selectedPhases.includes('calculation')) {
        newProject.buffs = toPlain(source.buffs)
    }

    newProject.customSkillHits = JSON.parse(JSON.stringify(source.customSkillHits ?? {}))
    if ((selectedPhases as string[]).includes('result')) {
        newProject.analysis = source.analysis ? JSON.parse(JSON.stringify(source.analysis)) : undefined
    }
    newProject.comparison = source.comparison ? toPlain(source.comparison) : undefined

    applyDerivedViews(newProject)
    projects = [...projects, newProject]
    activeId = newProject.id
    await dbSet(ACTIVE_KEY, activeId)
    await persist()
    return newProject
}

export async function deleteProject(id: string) {
    projects = projects.filter((p) => p.id !== id)
    if (activeId === id) {
        activeId = projects.length > 0 ? projects[0].id : ''
        await dbSet(ACTIVE_KEY, activeId)
    }
    await persist()
}

export function getArchivedProjects() {
    return projects.filter((p) => p.archived === true)
}

export async function archiveProject(id: string) {
    const project = projects.find((p) => p.id === id)
    if (!project) return
    project.archived = true
    if (activeId === id) {
        activeId = ''
        await dbSet(ACTIVE_KEY, activeId)
    }
    await persist()
}

export async function unarchiveProject(id: string) {
    const project = projects.find((p) => p.id === id)
    if (!project) return
    project.archived = false
    await persist()
}

export async function updateTeam(team: [CharSlot, CharSlot, CharSlot]) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    const oldKey = getTeamKeyFromTeam(project.team)
    project.team = team
    const newKey = getTeamKeyFromTeam(team)
    if (project.lockedTeamKey && oldKey !== newKey) {
        project.lockedTeamKey = undefined
        project.lockedTeamNames = undefined
    }
    applyDerivedViews(project)
    await persist()
}

export async function updateTimeline(data: TimelineData) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    project.encounter.timeline.data = data
    project.phases.timeline.data = data
    await persist()
}

export async function updateCalculation(data: CalcState) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    project.encounter.calculation.data = data
    project.phases.calculation.data = data
    if (data.buffSets) project.buffs = data.buffSets
    applyDerivedViews(project)
    await persist()
}

/** @desc 把当前内存中的链/阶配置（getConditionProfile）写回当前工程的角色槽位 */
export async function updateConditionProfile() {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    const profile = getConditionProfile()
    project.team = project.team.map((slot, i) => ({
        ...slot,
        chain: profile.chains?.[i] ?? slot.chain ?? 0,
        refinement: profile.refinements?.[i] ?? slot.refinement ?? 1
    })) as [CharSlot, CharSlot, CharSlot]
    applyDerivedViews(project)
    await persist()
}

export async function updateCustomSkillHits(hits: Record<string, import('$lib/types/project').CustomHit[]>) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    project.customSkillHits = hits
    await persist()
}

export async function updateConfig(data: ConfigState) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    project.encounter.config.data = data
    project.phases.config.data = data
    await persist()
}

export async function updateResultAnalysis(data: ResultAnalysisData) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    project.analysis = data
    await persist()
}

/** @desc 持久化链/阶对比弹窗选定的队伍对比配置 */
export async function updateComparisonPoints(points: { chains: number[]; refinements: number[] }[]) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    project.comparison = points.length > 0 ? points : undefined
    await persist()
}

export async function unlockPhase(id: string, phase: PhaseKey) {
    const project = projects.find((p) => p.id === id)
    if (!project) return
    const idx = PHASE_ORDER.indexOf(phase)
    for (let i = idx; i < PHASE_ORDER.length; i++) {
        setPhaseLocked(project, PHASE_ORDER[i], false)
    }
    await persist()
}

/** @desc 同步写阶段的锁定状态到新结构（team 走 teamLocked）与过渡期视图 */
function setPhaseLocked(project: Project, phase: PhaseKey, locked: boolean): void {
    if (phase === 'team') project.encounter.teamLocked = locked
    else if (phase === 'timeline') project.encounter.timeline.locked = locked
    else if (phase === 'calculation') project.encounter.calculation.locked = locked
    else project.encounter.config.locked = locked
    project.phases[phase].locked = locked
}

/** @desc 读取某阶段是否锁定（team 走 teamLocked） */
function readPhaseLocked(project: Project, phase: PhaseKey): boolean {
    if (phase === 'team') return project.encounter.teamLocked
    if (phase === 'timeline') return project.encounter.timeline.locked
    if (phase === 'calculation') return project.encounter.calculation.locked
    return project.encounter.config.locked
}

/** @desc 读取某阶段的数据（team 无数据） */
function readPhaseData(project: Project, phase: PhaseKey): unknown {
    if (phase === 'team') return null
    if (phase === 'timeline') return project.encounter.timeline.data
    if (phase === 'calculation') return project.encounter.calculation.data
    return project.encounter.config.data
}

export async function setActiveProject(id: string) {
    if (id && !projects.find((p) => p.id === id)) return
    activeId = id
    await dbSet(ACTIVE_KEY, id)
}

export function importProjects(imported: Project[]) {
    const existingIds = new Set(projects.map((p) => p.id))
    const toAdd: Project[] = []
    for (const item of imported) {
        if (existingIds.has(item.id)) item.id = crypto.randomUUID()
        const normalized = normalizeProject(item)
        normalized.archived = false
        if (normalized.encounter.teamLocked && !normalized.lockedTeamKey) {
            normalized.lockedTeamKey = getTeamKeyFromTeam(normalized.team)
            normalized.lockedTeamNames = normalized.team
                .filter((s) => s.character !== null && s.weapon !== null)
                .map((s) => s.character as string)
        }
        toAdd.push(normalized)
    }
    projects = [...projects, ...toAdd]
    persist()
}

/** @desc 构建与导出/导入一致的工程文件（{ version, exportedAt, project }） */
export function buildExportFile(
    project: Project,
    selected: PhaseKey[],
    includeResult = false
): Record<string, unknown> {
    const data: Record<string, unknown> = {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        version: PROJECT_VERSION
    }
    if (selected.includes('team')) {
        data.team = project.team
        if (project.lockedTeamKey) data.lockedTeamKey = project.lockedTeamKey
        if (project.lockedTeamNames) data.lockedTeamNames = project.lockedTeamNames
        // 导出角色的链/阶配置（与队伍配置一起）
        data.conditionProfile = conditionProfileFromTeam(project.team)
    }
    data.customSkillHits = project.customSkillHits ?? {}
    // 拉表页 Buff 实例：随 calculation 阶段导出（一切皆 buff 的新结构）
    if (selected.includes('calculation')) {
        data.buffs = project.buffs ?? []
    }
    const phases: Record<string, { locked: boolean; data: unknown }> = {}
    for (const ph of PHASE_ORDER) {
        if (ph === 'team') continue
        if (selected.includes(ph)) {
            phases[ph] = { locked: readPhaseLocked(project, ph), data: readPhaseData(project, ph) }
        }
    }
    phases.team = { locked: project.encounter.teamLocked, data: null }
    data.phases = phases
    if (includeResult) {
        data.analysis = project.analysis ?? null
    }
    if (project.comparison?.length) data.comparison = project.comparison
    return { version: PROJECT_VERSION, exportedAt: Date.now(), project: data }
}

export class ProjectParseError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ProjectParseError'
    }
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 解析前先校验为 JSON 且不超过尺寸上限 */
export function safeJsonParse(text: string): unknown {
    const bytes = new TextEncoder().encode(text).length
    if (bytes > 1024 * 1024) throw new ProjectParseError('文件超过 1MB 限制')
    try {
        return JSON.parse(text)
    } catch {
        throw new ProjectParseError('不是合法的 JSON 文件')
    }
}

/** 解析导出的工程文件文本为工程数组（导入/下载共用），结构无法识别时抛 ProjectParseError */
export function parseProjectFile(text: string): Project[] {
    const raw = safeJsonParse(text)
    const rawProjects: Record<string, unknown>[] = []
    if (isRecord(raw)) {
        if (isRecord(raw.project) || Array.isArray(raw.project)) {
            rawProjects.push(...(Array.isArray(raw.project) ? raw.project.filter(isRecord) : [raw.project]))
        } else if ('team' in raw || 'name' in raw) {
            rawProjects.push(raw)
        }
    } else if (Array.isArray(raw)) {
        rawProjects.push(...raw.filter(isRecord))
    }
    if (!rawProjects.length) throw new ProjectParseError('无法识别的工程文件结构')
    // 统一走 migration：任意历史版本的导出文件都会被升级到当前工程结构
    return rawProjects.map((item) => normalizeProject(item as Partial<Project>))
}

export async function lockPhase(phase: PhaseKey) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    if (!project.phases[phase]) return
    setPhaseLocked(project, phase, true)
    if (phase === 'team') {
        project.lockedTeamKey = getTeamKeyFromTeam(project.team)
        project.lockedTeamNames = project.team
            .filter((s) => s.character !== null && s.weapon !== null)
            .map((s) => s.character as string)
    }
    await persist()
}

export function canEditPhase(project: Project, phase: PhaseKey): boolean {
    const idx = PHASE_ORDER.indexOf(phase)
    if (idx === 0) return true
    const prevPhase = PHASE_ORDER[idx - 1]
    return isPhaseReadonly(project, prevPhase)
}

export function isPhaseReadonly(project: Project, phase: PhaseKey): boolean {
    return readPhaseLocked(project, phase)
}

export function getPhaseOrder(): PhaseKey[] {
    return PHASE_ORDER
}

/** @desc 持久化轻量防抖：同帧多次更新（快速排轴连按/框选批量）合并为一次 IndexedDB 写（~100ms 窗口，pagehide 时立即 flush） */
let _persistPending = false
let _persistTimer: ReturnType<typeof setTimeout> | null = null

/** @desc 落盘快照：只写新结构真源（不含 phases/conditionProfile 等过渡期视图字段） */
function snapshotForStorage(): unknown {
    return JSON.parse(JSON.stringify(projects.map((p) => toPlainProject(p))))
}

function persist() {
    if (_persistPending) return
    _persistPending = true
    if (_persistTimer !== null) clearTimeout(_persistTimer)
    _persistTimer = setTimeout(() => {
        _persistTimer = null
        _persistPending = false
        void dbSet(PROJECTS_KEY, snapshotForStorage())
    }, 100)
}

function flushPersist() {
    if (_persistTimer === null) return
    clearTimeout(_persistTimer)
    _persistTimer = null
    _persistPending = false
    void dbSet(PROJECTS_KEY, snapshotForStorage())
}

if (browser) {
    window.addEventListener('pagehide', flushPersist)
}
