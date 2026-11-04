// 工程内 Buff 文件夹工具：树以文件夹/排序为结构真源，Buff 全名为 路径\短名
import { defineTool } from './registry'
import {
    createBuffTreeFolder,
    deleteBuffTreeFolder,
    getAllBuffConfs,
    getBuffTree,
    moveBuffFolderSibling,
    moveBuffTreeNode,
    renameBuffTreeFolder
} from '$lib/calc/calculation.store.svelte'
import { collectFolders } from '$lib/calc/buff-tree-state'
import { buffLeafName } from '$lib/calc/buff-name'
import type { BuffTreeNode } from '$lib/calc/calculation.types'

const str = (v: unknown): string => String(v ?? '').trim()

interface TreeNodeView {
    kind: 'folder' | 'buff'
    id: string
    name: string
    path: string
    folders: TreeNodeView[]
    buffs: Array<{ id: string; name: string; shortName: string }>
    buff?: { id: string; name: string; shortName: string }
}

const viewOf = (
    nodes: readonly BuffTreeNode[],
    path: string[],
    buffById: ReadonlyMap<string, { name: string }>
): TreeNodeView[] =>
    nodes.map((node) => {
        if (node.kind === 'folder') {
            const nextPath = [...path, node.name]
            return {
                kind: 'folder',
                id: node.id,
                name: node.name,
                path: nextPath.join('\\'),
                folders: viewOf(
                    node.children.filter((child) => child.kind === 'folder'),
                    nextPath,
                    buffById
                ),
                buffs: node.children
                    .filter((child): child is Extract<BuffTreeNode, { kind: 'buff' }> => child.kind === 'buff')
                    .map((child) => ({
                        id: child.buffId,
                        name: buffById.get(child.buffId)?.name ?? child.buffId,
                        shortName: buffLeafName(buffById.get(child.buffId)?.name ?? child.buffId)
                    }))
            }
        }
        const name = buffById.get(node.buffId)?.name ?? node.buffId
        return {
            kind: 'buff',
            id: node.buffId,
            name,
            path: [...path, name].join('\\'),
            folders: [],
            buffs: [],
            buff: { id: node.buffId, name, shortName: buffLeafName(name) }
        }
    })

const findFolder = (id: string): { path: string[]; node: BuffTreeNode } | null => {
    const tree = getBuffTree()
    const folders = collectFolders([...tree.global, ...tree.nonGlobal])
    const folder = folders.find((item) => item.id === id)
    if (!folder) return null
    const path: string[] = []
    const walk = (nodes: readonly BuffTreeNode[], prefix: string[]): boolean => {
        for (const node of nodes) {
            if (node.id === id) {
                path.splice(0, path.length, ...prefix)
                return true
            }
            if (node.kind === 'folder' && walk(node.children, [...prefix, node.name])) return true
        }
        return false
    }
    walk(tree.global, [])
    walk(tree.nonGlobal, [])
    return { path: [...path, folder.name], node: folder }
}

defineTool('list_buff_tree', {
    description:
        '查看当前工程的两个 Buff 根（global / nonGlobal）的文件夹与 Buff 全名。文件夹有 id/name/path，Buff 有 id/full name/short name；用于定位后再调用文件夹管理工具。',
    parameters: { type: 'object', properties: {} },
    handler: () => {
        const tree = getBuffTree()
        const buffById = new Map(getAllBuffConfs().map((buff) => [buff.id, buff]))
        return {
            global: viewOf(tree.global, [], buffById),
            nonGlobal: viewOf(tree.nonGlobal, [], buffById)
        }
    }
})

defineTool('create_buff_folder', {
    description:
        '在当前工程 Buff 树新建文件夹（最多两级）。name 只能是短名，不能含反斜杠；parentFolderId 省略则建在根。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            name: { type: 'string', description: '文件夹短名（不能含 \\）' },
            tab: { type: 'string', description: 'global / nonGlobal，默认 nonGlobal' },
            parentFolderId: { type: 'string', description: '可选：父文件夹 id（最多两级）' }
        },
        required: ['name']
    },
    handler: (args) => {
        const name = str(args.name)
        if (!name || name.includes('\\')) throw new Error('文件夹名不能为空且不能含反斜杠')
        const tab = str(args.tab) === 'global' ? 'global' : 'nonGlobal'
        const id = createBuffTreeFolder(name, tab, str(args.parentFolderId) || null)
        if (!id) throw new Error('创建失败：同级重名、层级超限或当前不可编辑')
        return { id, path: findFolder(id)?.path.join('\\') ?? name }
    }
})

defineTool('rename_buff_folder', {
    description: '重命名当前工程 Buff 文件夹（只改短名；后代 Buff 全名会级联更新）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            folderId: { type: 'string', description: '文件夹 id（用 list_buff_tree 获取）' },
            name: { type: 'string', description: '新短名（不能含 \\）' }
        },
        required: ['folderId', 'name']
    },
    handler: (args) => {
        const folderId = str(args.folderId)
        const name = str(args.name)
        if (!folderId || !name || name.includes('\\')) throw new Error('参数无效')
        renameBuffTreeFolder(folderId, name)
        return { id: folderId, path: findFolder(folderId)?.path.join('\\') ?? name }
    }
})

defineTool('delete_buff_folder', {
    description: '删除当前工程非全局 Buff 文件夹（含其中 Buff，递归删除；全局树受保护）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: { folderId: { type: 'string', description: '文件夹 id' } },
        required: ['folderId']
    },
    handler: (args) => {
        const folderId = str(args.folderId)
        if (!folderId) throw new Error('缺少 folderId')
        if (!deleteBuffTreeFolder(folderId)) throw new Error('删除失败：文件夹不存在或属于全局树')
        return { deleted: folderId }
    }
})

defineTool('move_buff_tree_node', {
    description:
        '把当前工程的一个文件夹或 Buff 移到目标容器（targetFolderId 省略则移到所在根目录）。保持同一 global/nonGlobal 页签；移动后 Buff 全名级联更新。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            nodeId: { type: 'string', description: '文件夹 id 或 Buff id' },
            targetFolderId: { type: 'string', description: '可选：目标文件夹 id；省略 = 根' }
        },
        required: ['nodeId']
    },
    handler: (args) => {
        const nodeId = str(args.nodeId)
        const target = str(args.targetFolderId) || null
        if (!nodeId) throw new Error('缺少 nodeId')
        if (!moveBuffTreeNode(nodeId, target)) throw new Error('移动失败：目标非法、层级超限或自嵌套')
        return { moved: nodeId, targetFolderId: target }
    }
})

defineTool('reorder_buff_folder', {
    description: '把当前工程某个文件夹在同级上移/下移一位（delta = -1 上移，1 下移）。',
    dangerous: true,
    parameters: {
        type: 'object',
        properties: {
            folderId: { type: 'string', description: '文件夹 id' },
            delta: { type: 'number', description: '-1 上移 / 1 下移' }
        },
        required: ['folderId', 'delta']
    },
    handler: (args) => {
        const folderId = str(args.folderId)
        const delta = Number(args.delta) === 1 ? 1 : -1
        if (!folderId) throw new Error('缺少 folderId')
        moveBuffFolderSibling(folderId, delta)
        return { folderId, delta }
    }
})
