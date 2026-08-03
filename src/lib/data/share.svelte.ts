import { browser } from '$app/environment'
import { getShareBase } from './workshop.svelte'
import {
    buildExportFile,
    getPhaseOrder,
    importProjects,
    parseProjectFile,
    ProjectParseError
} from '$lib/data/project.svelte'
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
    downloads: number
    createdAt: string
}

export type ShareSort = 'heat' | 'newest'

export const SHARE_SORT_LABELS: { value: ShareSort; label: string }[] = [
    { value: 'heat', label: '热度' },
    { value: 'newest', label: '最新' }
]

export interface ShareResult {
    ok: boolean
    code?: string
    url?: string
    error?: string
}

export const shareState = $state({
    available: false,
    checked: false,
    loading: false,
    projects: [] as ShareProject[],
    error: null as string | null,
    query: '',
    sort: 'newest' as ShareSort,
    page: 1,
    total: 0,
    perPage: 12
})

export function getShareState() {
    return shareState
}

let _seq = 0

export async function checkShare(force = false) {
    if (!browser) return
    if (shareState.checked && !force) return
    const seq = ++_seq
    shareState.loading = true
    shareState.error = null
    try {
        const params = new URLSearchParams({
            page: String(shareState.page),
            perPage: String(shareState.perPage),
            sort: shareState.sort,
            excludeAnon: '1'
        })
        if (shareState.query.trim()) params.set('q', shareState.query.trim())
        const res = await fetch(`${getShareBase()}/api/public/projects?${params}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { projects: ShareProject[]; total?: number }
        if (seq !== _seq) return
        shareState.projects = json.projects ?? []
        shareState.total = json.total ?? 0
        shareState.available = true
    } catch (e) {
        if (seq !== _seq) return
        shareState.available = false
        shareState.error = e instanceof Error ? e.message : '连接失败'
    } finally {
        if (seq === _seq) {
            shareState.checked = true
            shareState.loading = false
        }
    }
}

export function refreshProjects() {
    return checkShare(true)
}

export function setSearch(query: string) {
    if (shareState.query === query) return
    shareState.query = query
    shareState.page = 1
    return checkShare(true)
}

export function setSort(sort: ShareSort) {
    if (shareState.sort === sort) return
    shareState.sort = sort
    shareState.page = 1
    return checkShare(true)
}

export function setPage(page: number) {
    const maxPage = Math.max(1, Math.ceil(shareState.total / shareState.perPage))
    const next = Math.min(maxPage, Math.max(1, page))
    if (shareState.page === next) return
    shareState.page = next
    return checkShare(true)
}

export async function shareProject(project: Project): Promise<ShareResult> {
    const file = buildExportFile(project, getPhaseOrder(), true)
    try {
        const res = await fetch(`${getShareBase()}/api/public/projects`, {
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

/** 分享工程并生成 10 分钟有效的导入链接；失败返回 null */
export async function getShareLink(project: Project): Promise<string | null> {
    const res = await shareProject(project)
    if (!res.ok || !res.code) return null
    return `${location.origin}#import_project=${encodeURIComponent(`${getShareBase()}/share/${res.code}/download`)}`
}

export interface DownloadResult {
    ok: boolean
    error?: string
}

export async function downloadProject(code: string): Promise<DownloadResult> {
    try {
        const res = await fetch(`${getShareBase()}/share/${code}/download`)
        if (!res.ok) return { ok: false, error: `下载失败（HTTP ${res.status}）` }
        const imported = parseProjectFile(await res.text())
        importProjects(imported)
        return { ok: true }
    } catch (e) {
        return {
            ok: false,
            error: e instanceof ProjectParseError ? e.message : e instanceof Error ? e.message : '下载失败'
        }
    }
}

export interface ImportResult {
    ok: boolean
    error?: string
    project?: Project
}

export async function importFromShareUrl(url: string): Promise<ImportResult> {
    let text: string
    try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        text = await res.text()
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '网络错误' }
    }
    let imported: Project[]
    try {
        imported = parseProjectFile(text)
    } catch (e) {
        return { ok: false, error: e instanceof ProjectParseError ? e.message : '导入失败：链接内容格式错误' }
    }
    if (!imported.length) return { ok: false, error: '链接内容为空' }
    importProjects(imported)
    return { ok: true, project: imported[0] }
}
