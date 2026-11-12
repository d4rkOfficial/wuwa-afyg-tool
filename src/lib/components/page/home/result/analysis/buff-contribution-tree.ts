/**
 * @desc Buff 贡献列表 → 文件夹树（纯展示层转换，不改计算口径）。
 *
 * 文件夹层级来自 Buff 全名 `文件夹A\文件夹B\短名`（与左侧 Buff 列表同一套），
 * 文件夹自身的贡献由 `CharBuffAnalysis.folders` 提供（整组移除损失），
 * 因此「文件夹行」与「逐条 Buff 行」是两个不同口径，界面上必须说明。
 */

import { BUFF_PATH_SEP, buffFolderPath, buffLeafName } from '$lib/calc/buff-name'
import type { BuffContribution, CharBuffAnalysis } from '$lib/calc/result.types'

/** @desc 树里的一个文件夹节点（已带整组贡献与排序） */
export interface BuffTreeFolder {
    key: string
    name: string
    path: string[]
    /** 整组移除损失 */
    contribution: number
    contribPct: number
    folders: BuffTreeFolder[]
    buffs: BuffContribution[]
}

export interface BuffTree {
    folders: BuffTreeFolder[]
    /** 根目录 Buff（全名里没有文件夹） */
    buffs: BuffContribution[]
}

/** @desc 展开后的行：文件夹与 Buff 混排，按贡献降序 */
export interface BuffTreeRow {
    kind: 'folder' | 'buff'
    /** 缩进层级：根目录行 = 0 */
    depth: number
    key: string
    name: string
    contribution: number
    contribPct: number
    /** 文件夹行的完整路径（title 用）；Buff 行同样给出所属文件夹路径 */
    path: string[]
    buff?: BuffContribution
    /** @desc 是否为同级最后一个（决定树线画 └ 还是 ├） */
    lastSibling: boolean
    /** @desc 每一层祖先是否还有后续兄弟（有则画竖线），长度 = depth；根行为空 */
    ancestorHasNext: boolean[]
}

const folderKeyOf = (path: readonly string[]): string => `folder:${path.join(BUFF_PATH_SEP)}`

const makeFolder = (name: string, path: string[]): BuffTreeFolder => ({
    key: folderKeyOf(path),
    name,
    path,
    contribution: 0,
    contribPct: 0,
    folders: [],
    buffs: []
})

/** @desc 文件夹行本身没有分数时（理论上不会），退化成其下 Buff 贡献之和，至少不让树断掉 */
const fallbackSumOf = (folder: BuffTreeFolder): number =>
    folder.buffs.reduce((sum, buff) => sum + buff.contribution, 0) +
    folder.folders.reduce((sum, child) => sum + fallbackSumOf(child), 0)

const sortFolder = (folder: BuffTreeFolder) => {
    for (const child of folder.folders) sortFolder(child)
    folder.buffs.sort((a, b) => b.contribution - a.contribution)
    folder.folders.sort((a, b) => b.contribution - a.contribution)
    if (folder.contribution <= 0) folder.contribution = fallbackSumOf(folder)
}

/** @desc 按 Buff 全名的文件夹路径建树并排序（文件夹取计算层给的整组贡献） */
export const buildBuffContributionTree = (analysis: CharBuffAnalysis | undefined): BuffTree => {
    const stats = new Map((analysis?.folders ?? []).map((folder) => [folder.path.join(BUFF_PATH_SEP), folder] as const))
    const root = makeFolder('', [])
    for (const buff of analysis?.buffs ?? []) {
        const parts = buffFolderPath(buff.name)
        let node = root
        for (let depth = 1; depth <= parts.length; depth++) {
            const path = parts.slice(0, depth)
            const key = path.join(BUFF_PATH_SEP)
            let child = node.folders.find((folder) => folder.path.join(BUFF_PATH_SEP) === key)
            if (!child) {
                child = makeFolder(parts[depth - 1], path)
                const stat = stats.get(key)
                if (stat) {
                    child.contribution = stat.contribution
                    child.contribPct = stat.contribPct
                }
                node.folders.push(child)
            }
            node = child
        }
        node.buffs.push(buff)
    }
    sortFolder(root)
    return { folders: root.folders, buffs: root.buffs }
}

/** @desc 树的全部文件夹 key（「展开全部 / 收起全部」用） */
export const collectBuffFolderKeys = (tree: BuffTree): string[] => {
    const keys: string[] = []
    const walk = (folders: readonly BuffTreeFolder[]) => {
        for (const folder of folders) {
            keys.push(folder.key)
            walk(folder.folders)
        }
    }
    walk(tree.folders)
    return keys
}

/** @desc 树 → 行列表；`collapsed` 里的文件夹不展开其子行 */
export const flattenBuffTreeRows = (tree: BuffTree, collapsed: ReadonlySet<string>): BuffTreeRow[] => {
    const rows: BuffTreeRow[] = []
    const pushChildren = (
        folders: readonly BuffTreeFolder[],
        buffs: readonly BuffContribution[],
        depth: number,
        ancestorHasNext: boolean[]
    ) => {
        type Entry = { at: number; kind: 'folder' | 'buff'; folder?: BuffTreeFolder; buff?: BuffContribution }
        const entries: Entry[] = [
            ...folders.map((folder) => ({ at: folder.contribution, kind: 'folder' as const, folder })),
            ...buffs.map((buff) => ({ at: buff.contribution, kind: 'buff' as const, buff }))
        ].sort((a, b) => b.at - a.at)
        entries.forEach((entry, index) => {
            const lastSibling = index === entries.length - 1
            if (entry.folder) {
                const folder = entry.folder
                rows.push({
                    kind: 'folder',
                    depth,
                    key: folder.key,
                    name: folder.name,
                    contribution: folder.contribution,
                    contribPct: folder.contribPct,
                    path: folder.path,
                    lastSibling,
                    ancestorHasNext
                })
                if (!collapsed.has(folder.key)) {
                    pushChildren(folder.folders, folder.buffs, depth + 1, [...ancestorHasNext, !lastSibling])
                }
                return
            }
            const buff = entry.buff!
            const path = buffFolderPath(buff.name)
            rows.push({
                kind: 'buff',
                depth,
                key: `buff:${buff.id}`,
                name: buffLeafName(buff.name),
                contribution: buff.contribution,
                contribPct: buff.contribPct,
                path,
                buff,
                lastSibling,
                ancestorHasNext
            })
        })
    }
    pushChildren(tree.folders, tree.buffs, 0, [])
    return rows
}
