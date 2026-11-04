/**
 * @desc 显式 Buff 树 → 左栏列表 / 平铺表的渲染结构（纯转换，不含派生归并规则）。
 *
 * 运行时的文件夹结构只来自 `BuffTreeState`（global / nonGlobal 两个根）；
 * 迁移与导入的粗分类在 `buff-tree-state.ts` 完成，本文件只负责把已存好的树摊平成 UI 节点。
 */

import type { BuffInstance, BuffTreeNode as StateTreeNode, BuffTreeState } from './calculation.types'
import type { CharSlot } from '$lib/types/project'
import type { GroupedBuffConfItem } from './calculation.consts'
import { deriveFolderIcon, normalizeBuffTree, type FolderIconSpec } from './buff-tree-state'

/** @desc 归类树节点：复用左侧列表既有的「folder/item」渲染结构（GroupedBuffConfItem），并补充拖拽/样式所需信息 */
export interface BuffTreeNode extends GroupedBuffConfItem {
    /** @desc 目录种类：显式树文件夹；旧派生目录字段仅为兼容旧渲染分支保留 */
    folderKind?: 'manual' | 'global' | 'char-gate' | 'layered'
    /** @desc 文件夹图标（由后代 Buff 派生） */
    iconSpec?: FolderIconSpec
    /** @desc 角色头像槽位（兼容旧渲染字段；显式树按 iconSpec 画） */
    charIdx?: number
    /** @desc 条件目录种类（兼容旧渲染字段） */
    gateKind?: 'chain' | 'weapon'
    /** @desc 链门槛（兼容旧渲染字段） */
    gateMin?: number
    /** @desc 所属父容器 key（拖拽「同父重排」判定用） */
    parentKey: string
    /** @desc 目录下的全部 Buff id（含嵌套目录，按展示顺序） */
    memberIds?: string[]
    /** @desc 目录内的二级子目录 */
    gateChildren?: BuffTreeNode[]
}

export interface BuffTree {
    nodes: BuffTreeNode[]
    /** @desc 全部目录 key（拖拽时「收起所有文件夹」用） */
    folderKeys: string[]
    /** @desc 各父容器下的 Buff 顺序：拖拽后据此重建 */
    buckets: { parentKey: string; memberIds: string[] }[]
}

/**
 * @desc 显式树 → 左栏列表树（buff-modal-list 的渲染结构）。
 * 一级/二级文件夹都复用 folder 节点；二级放进一级的 `gateChildren`。
 */
export const buildStoredBuffTree = (
    treeState: BuffTreeState,
    tab: 'global' | 'nonGlobal',
    buffs: readonly BuffInstance[],
    team: readonly CharSlot[]
): BuffTree => {
    const normalized = normalizeBuffTree(
        treeState,
        buffs,
        buffs.filter((b) => b.global).map((b) => b.id)
    )
    const buffById = new Map(buffs.map((buff) => [buff.id, buff]))
    const nodes: BuffTreeNode[] = []
    const folderKeys: string[] = []
    const buckets: BuffTree['buckets'] = []

    const buffNodeOf = (buffId: string, parentKey: string, keyPrefix: string): BuffTreeNode | null => {
        const buff = buffById.get(buffId)
        if (!buff) return null
        return { key: `${keyPrefix}${buff.id}`, type: 'item', parentKey, buffSet: buff }
    }

    const folderNodeOf = (
        node: Extract<StateTreeNode, { kind: 'folder' }>,
        parentKey: string,
        depth: number
    ): BuffTreeNode => {
        const prefix = `${depth === 1 ? 'tree' : 'tree2'}:${node.id}`
        folderKeys.push(prefix)
        const iconSpec = deriveFolderIcon(node, buffById, team)
        const directBuffs = node.children
            .filter((child): child is Extract<StateTreeNode, { kind: 'buff' }> => child.kind === 'buff')
            .map((child) => buffById.get(child.buffId))
            .filter((buff): buff is BuffInstance => !!buff)
        const subFolders = node.children
            .filter((child): child is Extract<StateTreeNode, { kind: 'folder' }> => child.kind === 'folder')
            .map((child) => folderNodeOf(child, prefix, depth + 1))
        const memberIds = directBuffs.map((buff) => buff.id)
        if (subFolders.length > 0) memberIds.push(...subFolders.flatMap((sub) => sub.memberIds ?? []))
        buckets.push({ parentKey: prefix, memberIds })
        return {
            key: prefix,
            type: 'folder',
            name: node.name,
            prefix,
            prefixText: node.name,
            suffixText: '',
            folderKind: 'manual',
            parentKey,
            memberIds,
            children: directBuffs,
            ...(subFolders.length > 0 ? { gateChildren: subFolders } : {}),
            iconSpec
        }
    }

    for (const node of normalized[tab]) {
        if (node.kind === 'buff') {
            const item = buffNodeOf(node.buffId, '__tree_root__', 'tree:')
            if (item) nodes.push(item)
            continue
        }
        nodes.push(folderNodeOf(node, '__tree_root__', 1))
    }

    return { nodes, folderKeys, buckets }
}
