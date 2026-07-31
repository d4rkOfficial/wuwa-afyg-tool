import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import type { Project, CharSlot, EchoSlot, PhaseKey, SelectedSet, ResultAnalysisData } from './types'
import type { TimelineData } from '$lib/components/page/home/timeline/timeline.types'
import type { CalcState } from '$lib/components/page/home/calculation/calculation.types'
import type { ConfigState } from '$lib/components/page/home/config/config.types'

const PROJECTS_KEY = 'projects'
const ACTIVE_KEY = 'project-active'

const PHASE_ORDER: PhaseKey[] = ['team', 'timeline', 'calculation', 'config']

function emptyEchoSlot(): EchoSlot {
    return { name: null, cost: 0 }
}

function emptyCharSlot(): CharSlot {
    return {
        character: null,
        weapon: null,
        triggerSets: [],
        echoes: [emptyEchoSlot(), emptyEchoSlot(), emptyEchoSlot(), emptyEchoSlot(), emptyEchoSlot()]
    }
}

function emptyPhaseState(): { locked: boolean; data: null } {
    return { locked: false, data: null }
}

function deepCloneTeam(team: [CharSlot, CharSlot, CharSlot]): [CharSlot, CharSlot, CharSlot] {
    return team.map((slot) => ({
        ...slot,
        triggerSets: slot.triggerSets.map((s: SelectedSet) => ({ ...s })),
        echoes: slot.echoes.map((e) => ({ ...e }))
    })) as [CharSlot, CharSlot, CharSlot]
}

function deepClonePhaseState(state: { locked: boolean; data: unknown }): { locked: boolean; data: unknown } {
    return {
        locked: state.locked,
        data: state.data ? JSON.parse(JSON.stringify(state.data)) : null
    }
}

function normalizeProject(p: Partial<Project>): Project {
    const phases = Object.assign(
        {
            team: emptyPhaseState(),
            timeline: emptyPhaseState(),
            calculation: emptyPhaseState(),
            config: emptyPhaseState()
        },
        p.phases || {}
    )
    return {
        id: p.id ?? crypto.randomUUID(),
        name: p.name ?? '未命名项目',
        createdAt: p.createdAt ?? Date.now(),
        team: p.team ?? [emptyCharSlot(), emptyCharSlot(), emptyCharSlot()],
        customSkillHits: p.customSkillHits ?? {},
        resultAnalysis: p.resultAnalysis,
        lockedTeamKey: p.lockedTeamKey,
        lockedTeamNames: p.lockedTeamNames,
        phases: {
            team: phases.team ?? emptyPhaseState(),
            timeline: phases.timeline ?? emptyPhaseState(),
            calculation: phases.calculation ?? emptyPhaseState(),
            config: phases.config ?? emptyPhaseState()
        }
    }
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
    const activeSaved = await dbGet<string>(ACTIVE_KEY)

    if (saved && saved.data.length > 0) {
        projects = saved.data.map(normalizeProject)
        const found = activeSaved?.data && projects.find((p) => p.id === activeSaved.data)
        activeId = found ? activeSaved!.data : projects[0].id
        await dbSet(ACTIVE_KEY, activeId)
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

    const newProject = createProjectData(newName)

    if (selectedPhases.includes('team')) {
        newProject.team = deepCloneTeam(source.team)
        if (source.lockedTeamKey) {
            newProject.lockedTeamKey = source.lockedTeamKey
            newProject.lockedTeamNames = source.lockedTeamNames
        }
    }

    for (const phase of PHASE_ORDER) {
        if (selectedPhases.includes(phase)) {
            newProject.phases[phase] = deepClonePhaseState(source.phases[phase])
            newProject.phases[phase].locked = true
        }
    }

    newProject.customSkillHits = JSON.parse(JSON.stringify(source.customSkillHits ?? {}))
    if ((selectedPhases as string[]).includes('result')) {
        newProject.resultAnalysis = source.resultAnalysis
            ? JSON.parse(JSON.stringify(source.resultAnalysis))
            : undefined
    }

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
    await persist()
}

export async function updateTimeline(data: TimelineData) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    project.phases.timeline.data = data
    await persist()
}

export async function updateCalculation(data: CalcState) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    project.phases.calculation.data = data
    await persist()
}

export async function updateCustomSkillHits(hits: Record<string, import('./types').CustomHit[]>) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    project.customSkillHits = hits
    await persist()
}

export async function updateConfig(data: ConfigState) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    project.phases.config.data = data
    await persist()
}

export async function updateResultAnalysis(data: ResultAnalysisData) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    project.resultAnalysis = data
    await persist()
}

export async function unlockPhase(id: string, phase: PhaseKey) {
    const project = projects.find((p) => p.id === id)
    if (!project) return
    const idx = PHASE_ORDER.indexOf(phase)
    for (let i = idx; i < PHASE_ORDER.length; i++) {
        project.phases[PHASE_ORDER[i]].locked = false
    }
    await persist()
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
        if (normalized.phases.team.locked && !normalized.lockedTeamKey) {
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

/** 构建与导出/导入一致的工程文件（{ version, exportedAt, project }） */
export function buildExportFile(
    project: Project,
    selected: PhaseKey[],
    includeResult = false
): Record<string, unknown> {
    const data: Record<string, unknown> = { id: project.id, name: project.name, createdAt: project.createdAt }
    if (selected.includes('team')) {
        data.team = project.team
        if (project.lockedTeamKey) data.lockedTeamKey = project.lockedTeamKey
        if (project.lockedTeamNames) data.lockedTeamNames = project.lockedTeamNames
    }
    data.customSkillHits = project.customSkillHits ?? {}
    const phases: Record<string, { locked: boolean; data: unknown }> = {}
    for (const ph of PHASE_ORDER) {
        if (selected.includes(ph)) {
            phases[ph] = { locked: project.phases[ph]?.locked ?? false, data: project.phases[ph]?.data ?? null }
        }
    }
    data.phases = phases
    if (includeResult) {
        data.resultAnalysis = project.resultAnalysis ?? null
    }
    return { version: 1, exportedAt: Date.now(), project: data }
}

/** 解析导出的工程文件文本为项目数组（导入/下载共用） */
export function parseImportFile(text: string): Project[] {
    const raw = JSON.parse(text) as Record<string, unknown>
    const rawProjects: Record<string, unknown>[] = raw?.version
        ? Array.isArray(raw.project)
            ? (raw.project as Record<string, unknown>[])
            : [raw.project as Record<string, unknown>]
        : Array.isArray(raw)
          ? (raw as Record<string, unknown>[])
          : [raw]
    return rawProjects.map((item) => ({
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
            calculation: (item.phases as Record<string, unknown>)?.calculation ?? { locked: false, data: null },
            config: (item.phases as Record<string, unknown>)?.config ?? { locked: false, data: null }
        },
        customSkillHits: (item.customSkillHits as Record<string, unknown[]>) ?? {}
    })) as unknown as Project[]
}

export async function lockPhase(phase: PhaseKey) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    if (!project.phases[phase]) return
    project.phases[phase].locked = true
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
    return project.phases[prevPhase]?.locked === true
}

export function isPhaseReadonly(project: Project, phase: PhaseKey): boolean {
    return project.phases[phase]?.locked === true
}

export function getPhaseOrder(): PhaseKey[] {
    return PHASE_ORDER
}

async function persist() {
    await dbSet(PROJECTS_KEY, toPlain(projects))
}
