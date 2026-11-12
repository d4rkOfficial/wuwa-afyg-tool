/**
 * @desc 溯源来源列表 → 文件夹树（纯展示层转换）。
 *
 * 来源全名与 Buff 列表同口径（`文件夹A\文件夹B\短名`），因此浮窗里也按文件夹分组；
 * 非 Buff 来源（角色 / 武器 / 声骸 / 敌方）没有文件夹，直接作为顶层行。
 */

import { BUFF_PATH_SEP, splitBuffPath } from '$lib/calc/buff-name'
import type { TracePart } from '$lib/calc/damage-trace'

interface TraceRowBase {
    /** 缩进层级：顶层 = 0 */
    depth: number
    key: string
    /** 文件夹名 / 来源短名 */
    name: string
    /** 文件夹完整路径（title 用） */
    path: string[]
    /** @desc 是否为同级最后一个（决定树线画 └ 还是 ├） */
    lastSibling: boolean
    /** @desc 每一层祖先是否还有后续兄弟（有则画竖线），长度 = depth；根行为空 */
    ancestorHasNext: boolean[]
}

export interface TraceFolderRow extends TraceRowBase {
    kind: 'folder'
}

export interface TraceLeafRow extends TraceRowBase {
    kind: 'leaf'
    part: TracePart
}

export type TracePartRow = TraceFolderRow | TraceLeafRow

interface LeafEntry {
    kind: 'leaf'
    part: TracePart
    index: number
}

interface FolderEntry {
    kind: 'folder'
    node: FolderNode
}

type Entry = LeafEntry | FolderEntry

interface FolderNode {
    name: string
    path: string[]
    entries: Entry[]
    folders: Map<string, FolderNode>
}

const makeFolder = (name: string, path: string[]): FolderNode => ({
    name,
    path,
    entries: [],
    folders: new Map()
})

const leafNameOf = (part: TracePart): string => {
    if (part.sourceType !== 'buff') return part.source
    const segments = splitBuffPath(part.source)
    return segments[segments.length - 1] ?? part.source
}

/** @desc 文件夹路径（不含来源短名）：非 Buff 来源没有路径 */
const folderPathOf = (part: TracePart): string[] => {
    if (part.sourceType !== 'buff') return []
    const segments = splitBuffPath(part.source)
    return segments.slice(0, -1)
}

/**
 * @desc 来源列表 → 行列表（保持原顺序，首次遇到某文件夹时插入该文件夹行）。
 * `collapsed` 里的文件夹不展开其子行。
 */
export const buildTracePartRows = (parts: readonly TracePart[], collapsed: ReadonlySet<string>): TracePartRow[] => {
    const root = makeFolder('', [])
    parts.forEach((part, index) => {
        const segments = folderPathOf(part)
        let node = root
        for (const segment of segments) {
            let child = node.folders.get(segment)
            if (!child) {
                child = makeFolder(segment, [...node.path, segment])
                node.folders.set(segment, child)
                node.entries.push({ kind: 'folder', node: child })
            }
            node = child
        }
        node.entries.push({ kind: 'leaf', part, index })
    })

    const rows: TracePartRow[] = []
    const walk = (node: FolderNode, depth: number, ancestorHasNext: boolean[]) => {
        node.entries.forEach((entry, index) => {
            const lastSibling = index === node.entries.length - 1
            if (entry.kind === 'leaf') {
                rows.push({
                    kind: 'leaf',
                    depth,
                    key: `part:${entry.index}`,
                    name: leafNameOf(entry.part),
                    path: folderPathOf(entry.part),
                    part: entry.part,
                    lastSibling,
                    ancestorHasNext
                })
                return
            }
            const folder = entry.node
            const key = `folder:${folder.path.join(BUFF_PATH_SEP)}`
            rows.push({
                kind: 'folder',
                depth,
                key,
                name: folder.name,
                path: folder.path,
                lastSibling,
                ancestorHasNext
            })
            if (!collapsed.has(key)) walk(folder, depth + 1, [...ancestorHasNext, !lastSibling])
        })
    }
    walk(root, 0, [])
    return rows
}
