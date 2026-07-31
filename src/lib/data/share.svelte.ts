import { browser } from '$app/environment'
import { SHARE_BASE } from '$lib/api/consts'
import { buildExportFile, getPhaseOrder, importProjects, parseImportFile } from '$lib/data/project.svelte'
import type { Project } from '$lib/data/types'

export interface ShareTeamPreview {
    names: string[]
    locked: boolean
    version: string | null
}

export interface ShareProject {
    id: string
    code: string
    title: string
    authorName: string
    tags: string[]
    gameVersion: string | null
    teamPreview: ShareTeamPreview | null
    createdAt: string
}

export interface ShareResult {
    ok: boolean
    code?: string
    url?: string
    error?: string
}

let available = $state(false)
let checked = $state(false)
let loading = $state(false)
let projects = $state<ShareProject[]>([])
let error = $state<string | null>(null)

export function getShareState() {
    return { available, checked, loading, projects, error }
}

export async function checkShare(force = false) {
    if (!browser) return
    if (checked && !force) return
    loading = true
    error = null
    try {
        const res = await fetch(`${SHARE_BASE}/api/public/projects`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { projects: ShareProject[] }
        projects = json.projects ?? []
        available = true
    } catch (e) {
        available = false
        error = e instanceof Error ? e.message : '连接失败'
    } finally {
        checked = true
        loading = false
    }
}

export function refreshProjects() {
    return checkShare(true)
}

export async function shareProject(project: Project): Promise<ShareResult> {
    const file = buildExportFile(project, getPhaseOrder(), true)
    try {
        const res = await fetch(`${SHARE_BASE}/api/public/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileText: JSON.stringify(file) })
        })
        const json = (await res.json().catch(() => ({}))) as { code?: string; url?: string; error?: string }
        if (!res.ok) return { ok: false, error: json.error ?? `HTTP ${res.status}` }
        return { ok: true, code: json.code, url: json.url }
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '网络错误' }
    }
}

export interface DownloadResult {
    ok: boolean
    error?: string
}

export async function downloadProject(code: string): Promise<DownloadResult> {
    try {
        const res = await fetch(`${SHARE_BASE}/share/${code}/download`)
        if (!res.ok) return { ok: false, error: `下载失败（HTTP ${res.status}）` }
        const imported = parseImportFile(await res.text())
        importProjects(imported)
        return { ok: true }
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '下载失败' }
    }
}
