/**
 * @desc 左侧 Buff 列表的三级归类（纯逻辑，界面只负责渲染）：
 *
 * 一级：全局 Buff（并入全局的那些）
 * 二级：角色名X链 / 角色名的武器X阶 —— 依据 Buff 的**链/阶硬性条件**（参考角色取条件里的角色槽位）；
 *      没有链/阶条件的 Buff 留在最外层平铺（与一级同级）
 * 三级：名字里「前缀+数字+后缀」规律相同的 ≥2 条自动归档，目录内按数字升序
 *
 * 目录是**派生**的（随时按条件/名字算出来），所以拖拽只改变同一父容器内的顺序；
 * `buckets` 给出各父容器的成员顺序，供拖拽后重建 Buff 数组顺序。
 */

import type { BuffInstance } from './calculation.types'
import type { CharSlot } from '$lib/types/project'
import { groupBuffSets, type GroupedBuffSetItem } from './calculation.consts'

/** @desc 二级目录的归属来源：链条件 / 阶条件 */
export interface BuffGate {
    kind: 'chain' | 'refinement'
    charIdx: number
    min: number
}

/** @desc 归类树节点：复用左侧列表既有的「folder/item」渲染结构（GroupedBuffSetItem），并补充拖拽/样式所需信息 */
export interface BuffTreeNode extends GroupedBuffSetItem {
    /** @desc 目录种类：全局 / 角色链阶（派生，不可拖动）/ 数字前后缀（可整体拖动） */
    folderKind?: 'global' | 'char-gate' | 'layered'
    /** @desc 角色链阶目录的归属角色槽位（渲染头像用） */
    charIdx?: number
    /** @desc 二级目录种类：链条件目录（角色头像）/ 武器条件目录（当前装配武器图标） */
    gateKind?: 'chain' | 'weapon'
    /** @desc 所属父容器 key（拖拽「同父重排」判定用） */
    parentKey: string
    /** @desc 目录下的全部 Buff id（含嵌套数字目录，按展示顺序） */
    memberIds?: string[]
}

export interface BuffTree {
    nodes: BuffTreeNode[]
    /** @desc 全部目录 key（拖拽时「收起所有文件夹」用） */
    folderKeys: string[]
    /** @desc 各父容器（不含全局目录）下的 Buff 顺序：拖拽后据此重建非全局 Buff 顺序 */
    buckets: { parentKey: string; memberIds: string[] }[]
}

/** @desc 取 Buff 的链/阶硬性条件（只取第一段；链阶互斥，界面也只会设一个） */
export const gateOf = (buff: BuffInstance): BuffGate | null => {
    const chain = buff.condition?.chains?.[0]
    if (chain && typeof chain.charIdx === 'number') return { kind: 'chain', charIdx: chain.charIdx, min: chain.min }
    const refine = buff.condition?.refinements?.[0]
    if (refine && typeof refine.charIdx === 'number')
        return { kind: 'refinement', charIdx: refine.charIdx, min: refine.min }
    return null
}

/**
 * @desc 二级目录 key/标题：
 * - 链条件 → `角色名X链`
 * - 阶条件（武器精炼）→ `角色名的武器名` —— 按「角色 + 武器」划分，**不按阶数划分**
 */
export const gateFolderOf = (gate: BuffGate, team: readonly CharSlot[]): { key: string; title: string } => {
    const charName = team[gate.charIdx]?.character ?? `角色${gate.charIdx + 1}`
    if (gate.kind === 'chain') return { key: `chain:${gate.charIdx}:${gate.min}`, title: `${charName}${gate.min}链` }
    const weaponName = team[gate.charIdx]?.weapon ?? ''
    return {
        key: `weapon:${gate.charIdx}:${weaponName}`,
        title: weaponName ? `${charName}的${weaponName}` : `${charName}的武器`
    }
}

/**
 * @desc 构建三级归类树（一级全局 / 二级角色链阶 / 三级数字前后缀）。
 *
 * 输出沿用左侧列表既有的 `GroupedBuffSetItem` 结构：目录节点的 `children` 是该容器下的**原始 Buff 列表**，
 * 三级数字目录由界面用 `groupBuffSets(children)` 就地派生（该函数已按键数字升序）。这样既满足「三级归类」，
 * 又不改变既有列表渲染/拖拽/右键菜单的实现。
 *
 * @param globalIds 已并入全局的 Buff id（归入一级「全局 Buff」目录）
 */
export const buildBuffTree = (
    buffSets: readonly BuffInstance[],
    globalIds: readonly string[],
    team: readonly CharSlot[]
): BuffTree => {
    const globalSet = new Set(globalIds)
    const globals: BuffInstance[] = []
    /** @desc 二级目录 key → 成员（**只按链条件归目录**；无链条件的走 __top__ 平铺） */
    const buckets = new Map<
        string,
        { title: string; charIdx?: number; gateKind?: 'chain' | 'weapon'; items: BuffInstance[] }
    >()
    const bucketOrder: string[] = []

    for (const buff of buffSets) {
        if (globalSet.has(buff.id)) {
            globals.push(buff)
            continue
        }
        const gate = gateOf(buff)
        // 链条件 → 角色名X链；阶条件 → 角色名的武器名（按角色+武器划分，不按阶数）
        const key = gate ? `folder:${gateFolderOf(gate, team).key}` : '__top__'
        let bucket = buckets.get(key)
        if (!bucket) {
            bucket = {
                title: gate ? gateFolderOf(gate, team).title : '',
                charIdx: gate?.charIdx,
                gateKind: gate?.kind === 'chain' ? 'chain' : 'weapon',
                items: []
            }
            buckets.set(key, bucket)
            bucketOrder.push(key)
        }
        bucket.items.push(buff)
    }

    // 二级目录排序：按角色槽位 → 同角色内「链目录在前（门槛升序）、武器目录在后（武器名自然序）」
    const gateSortKey = (key: string): [number, number, string | number] => {
        const chain = /^folder:chain:(\d+):(\d+)$/.exec(key)
        if (chain) return [Number(chain[1]), 0, Number(chain[2])]
        const weapon = /^folder:weapon:(\d+):(.*)$/.exec(key)
        if (weapon) return [Number(weapon[1]), 1, weapon[2]]
        return [99, 99, '']
    }
    const orderedKeys = bucketOrder
        .filter((k) => k !== '__top__')
        .sort((a, b) => {
            const ka = gateSortKey(a)
            const kb = gateSortKey(b)
            if (ka[0] !== kb[0]) return ka[0] - kb[0]
            if (ka[1] !== kb[1]) return ka[1] - kb[1]
            if (typeof ka[2] === 'number' && typeof kb[2] === 'number') return ka[2] - kb[2]
            return String(ka[2]).localeCompare(String(kb[2]))
        })

    const nodes: BuffTreeNode[] = []
    const folderKeys: string[] = []
    const treeBuckets: BuffTree['buckets'] = []

    if (globals.length > 0) {
        const folderKey = 'folder:global'
        folderKeys.push(folderKey)
        nodes.push({
            key: folderKey,
            type: 'folder',
            name: '全局 Buff',
            prefix: folderKey,
            prefixText: '全局 Buff',
            suffixText: '',
            folderKind: 'global',
            parentKey: '__root__',
            memberIds: globals.map((b) => b.id),
            children: globals
        })
    }

    for (const key of orderedKeys) {
        const bucket = buckets.get(key)!
        folderKeys.push(key)
        nodes.push({
            key,
            type: 'folder',
            name: bucket.title,
            prefix: key,
            prefixText: bucket.title,
            suffixText: '',
            folderKind: 'char-gate',
            charIdx: bucket.charIdx,
            gateKind: bucket.gateKind,
            parentKey: '__root__',
            memberIds: bucket.items.map((b) => b.id),
            children: bucket.items
        })
        treeBuckets.push({ parentKey: key, memberIds: bucket.items.map((b) => b.id) })
    }

    // 无链/阶条件的 Buff：留在最外层平铺（其中的数字目录仍由 groupBuffSets 就地派生）
    const top = buckets.get('__top__')
    if (top && top.items.length > 0) {
        for (const item of groupBuffSets(top.items)) {
            if (item.type === 'folder') {
                folderKeys.push(`folder:${item.prefix}`)
                nodes.push({
                    key: item.key,
                    type: 'folder',
                    name: item.name,
                    prefix: `folder:${item.prefix}`,
                    prefixText: item.prefixText,
                    suffixText: item.suffixText,
                    folderKind: 'layered',
                    parentKey: '__top__',
                    memberIds: (item.children ?? []).map((c) => c.id),
                    children: item.children
                })
            } else {
                nodes.push({
                    key: item.key,
                    type: 'item',
                    parentKey: '__top__',
                    buffSet: item.buffSet
                })
            }
        }
        treeBuckets.push({ parentKey: '__top__', memberIds: top.items.map((b) => b.id) })
    }

    return { nodes, folderKeys, buckets: treeBuckets }
}
