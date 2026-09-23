import { browser } from '$app/environment'
import { getShareBase } from './workshop.svelte'
import {
    buildExportFile,
    getPhaseOrder,
    importProjects,
    parseProjectFile,
    ProjectParseError
} from '$lib/data/project.svelte'
import type { Project } from '$lib/types/project'

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

/** @desc 搜索模式扫描工程的上限（本地按角色过滤需要样本；超出部分用服务端 q 兜底标题/作者） */
const SEARCH_SCAN_LIMIT = 200
/** @desc 服务端单页上限（实测 perPage 超过 50 也只返回 50） */
const SCAN_PER_PAGE = 50
const SCAN_MAX_PAGES = 8

interface ProjectsPage {
    projects: ShareProject[]
    total: number
}

const fetchProjectsPage = async (params: {
    page: number
    perPage: number
    sort: ShareSort
    q?: string
}): Promise<ProjectsPage> => {
    const search = new URLSearchParams({
        page: String(params.page),
        perPage: String(params.perPage),
        sort: params.sort,
        excludeAnon: '1'
    })
    if (params.q?.trim()) search.set('q', params.q.trim())
    const res = await fetch(`${getShareBase()}/api/public/projects?${search}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { projects?: ShareProject[]; total?: number }
    return { projects: json.projects ?? [], total: json.total ?? 0 }
}

/** @desc 逐页扫描工程列表（用于本地检索）；complete=false 表示还有没扫到的老工程 */
const scanProjects = async (
    sort: ShareSort,
    limit: number
): Promise<{ projects: ShareProject[]; complete: boolean }> => {
    const collected: ShareProject[] = []
    let total = 0
    for (let page = 1; page <= SCAN_MAX_PAGES && collected.length < limit; page++) {
        const res = await fetchProjectsPage({ page, perPage: SCAN_PER_PAGE, sort })
        if (res.projects.length === 0) break
        total = res.total
        collected.push(...res.projects)
        if (collected.length >= total) break
    }
    return { projects: collected.slice(0, limit), complete: collected.length >= total }
}

/** @desc 本地匹配：标题 / 作者 / 标签 / 配队角色名（服务端 q 只认标题与作者，角色名需本地兜底） */
const matchesQuery = (project: ShareProject, query: string): boolean => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    const fields = [project.title, project.authorName, ...(project.tags ?? []), ...(project.teamPreview?.names ?? [])]
    return fields.some((field) => (field ?? '').toLowerCase().includes(q))
}

/** @desc 合并「本地命中」与「服务端命中」时按 id 去重，保留先出现的顺序 */
const dedupeById = (list: ShareProject[]): ShareProject[] => {
    const seen = new Set<string>()
    return list.filter((project) => {
        if (seen.has(project.id)) return false
        seen.add(project.id)
        return true
    })
}

export async function checkShare(force = false) {
    if (!browser) return
    if (shareState.checked && !force) return
    const seq = ++_seq
    shareState.loading = true
    shareState.error = null
    try {
        const query = shareState.query.trim()
        if (query) {
            // 搜索模式：本地按 标题/作者/标签/角色 过滤后分页（服务端 q 搜不到角色名）
            const scan = await scanProjects(shareState.sort, SEARCH_SCAN_LIMIT)
            const localHits = scan.projects.filter((project) => matchesQuery(project, query))
            const remoteHits = scan.complete
                ? []
                : (
                      await fetchProjectsPage({
                          page: 1,
                          perPage: SCAN_PER_PAGE,
                          sort: shareState.sort,
                          q: query
                      })
                  ).projects
            const merged = dedupeById([...localHits, ...remoteHits])
            if (seq !== _seq) return
            shareState.total = merged.length
            shareState.projects = merged.slice(
                (shareState.page - 1) * shareState.perPage,
                shareState.page * shareState.perPage
            )
            shareState.available = true
            return
        }
        const page = await fetchProjectsPage({
            page: shareState.page,
            perPage: shareState.perPage,
            sort: shareState.sort
        })
        if (seq !== _seq) return
        shareState.projects = page.projects
        shareState.total = page.total
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

/** 根据分享 code 构建导入链接（与 10 分钟临时分享同一格式） */
export function buildImportLink(code: string): string {
    return `${location.origin}#import_project=${encodeURIComponent(`${getShareBase()}/share/${code}/download`)}`
}

/** 分享工程并生成 10 分钟有效的导入链接；失败返回 null */
export async function getShareLink(project: Project): Promise<string | null> {
    const res = await shareProject(project)
    if (!res.ok || !res.code) return null
    return buildImportLink(res.code)
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
