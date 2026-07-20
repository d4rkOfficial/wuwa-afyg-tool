import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import type { Project, CharSlot, EchoSlot, PhaseKey, SelectedSet } from './types'
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
    }

    for (const phase of PHASE_ORDER) {
        if (selectedPhases.includes(phase)) {
            newProject.phases[phase] = deepClonePhaseState(source.phases[phase])
            newProject.phases[phase].locked = true
        }
    }

    newProject.customSkillHits = JSON.parse(JSON.stringify(source.customSkillHits ?? {}))

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
    project.team = team
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
        toAdd.push(normalizeProject(item))
    }
    projects = [...projects, ...toAdd]
    persist()
}

export async function lockPhase(phase: PhaseKey) {
    const project = projects.find((p) => p.id === activeId)
    if (!project) return
    if (!project.phases[phase]) return
    project.phases[phase].locked = true
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
