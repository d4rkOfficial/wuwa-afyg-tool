/**
 * @desc 左侧 Buff 列表的三级归类（纯逻辑，界面只负责渲染）：
 *
 * 一级：全局 Buff（并入全局的那些）
 * 二级：角色名X链 / 角色名的武器X阶 —— 依据 Buff 的**链/阶硬性条件**（参考角色取条件里的角色槽位）；
 *      没有链/阶条件的 Buff 留在最外层平铺（与一级同级）；「全局 Buff」目录内部同样按此规则分子目录
 * 三级：名字里「前缀+数字+后缀」规律相同的 ≥2 条自动归档，目录内按数字升序
 *
 * 目录是**派生**的（随时按条件/名字算出来），所以拖拽只改变同一父容器内的顺序；
 * `buckets` 给出各父容器的成员顺序，供拖拽后重建 Buff 数组顺序。
 */

import type { BuffInstance } from './calculation.types'
import type { CharSlot } from '$lib/types/project'
import { groupBuffSets, type GroupedBuffConfItem } from './calculation.consts'

/** @desc 二级目录的归属来源：链条件 / 阶条件 */
export interface BuffGate {
    kind: 'chain' | 'refinement'
    charIdx: number
    min: number
}

/** @desc 归类树节点：复用左侧列表既有的「folder/item」渲染结构（GroupedBuffConfItem），并补充拖拽/样式所需信息 */
export interface BuffTreeNode extends GroupedBuffConfItem {
    /** @desc 目录种类：全局 / 角色链阶（派生，不可拖动）/ 数字前后缀（可整体拖动） */
    folderKind?: 'global' | 'char-gate' | 'layered'
    /** @desc 角色链阶目录的归属角色槽位（渲染头像用） */
    charIdx?: number
    /** @desc 二级目录种类：链条件目录（角色头像 + 链角标）/ 武器条件目录（角色头像 + 武器角标） */
    gateKind?: 'chain' | 'weapon'
    /** @desc 链目录的链门槛（链角标显示用） */
    gateMin?: number
    /** @desc 所属父容器 key（拖拽「同父重排」判定用） */
    parentKey: string
    /** @desc 目录下的全部 Buff id（含嵌套数字目录，按展示顺序） */
    memberIds?: string[]
    /**
     * @desc 目录内的二级（链/武器）子目录：仅「全局 Buff」目录需要
     * （全局 buff 同样按链/阶条件分子目录；非全局的二级目录直接就是顶层节点）
     */
    gateChildren?: BuffTreeNode[]
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
 * - 链条件 → `角色名X链`；**0 链即角色本体（未点共鸣链），显示为 `角色名本体`**
 * - 阶条件（武器精炼）→ `角色名的武器名` —— 按「角色 + 武器」划分，**不按阶数划分**
 */
export const gateFolderOf = (gate: BuffGate, team: readonly CharSlot[]): { key: string; title: string } => {
    const charName = team[gate.charIdx]?.character ?? `角色${gate.charIdx + 1}`
    if (gate.kind === 'chain')
        return {
            key: `chain:${gate.charIdx}:${gate.min}`,
            title: gate.min > 0 ? `${charName}${gate.min}链` : `${charName}本体`
        }
    const weaponName = team[gate.charIdx]?.weapon ?? ''
    return {
        key: `weapon:${gate.charIdx}:${weaponName}`,
        title: weaponName ? `${charName}的${weaponName}` : `${charName}的武器`
    }
}

/** @desc 一个二级目录桶：key 主体（不含顶层/全局前缀）+ 标题 + 成员 */
interface GateBucket {
    raw: string
    title: string
    charIdx?: number
    gateKind?: 'chain' | 'weapon'
    gateMin?: number
    items: BuffInstance[]
}

/** @desc 二级目录分桶结果：目录桶（已排序）+ 无链/阶条件的散条目 */
interface GateBuckets {
    buckets: GateBucket[]
    loose: BuffInstance[]
}

/** @desc 二级目录排序键：角色槽位 → 目录种类（链 0 / 武器 1）→ 门槛或武器名自然序 */
const gateSortKey = (key: string): [number, number, string | number] => {
    const chain = /^chain:(\d+):(\d+)$/.exec(key)
    if (chain) return [Number(chain[1]), 0, Number(chain[2])]
    const weapon = /^weapon:(\d+):(.*)$/.exec(key)
    if (weapon) return [Number(weapon[1]), 1, weapon[2]]
    return [99, 99, '']
}

const compareGateKey = (a: string, b: string): number => {
    const ka = gateSortKey(a)
    const kb = gateSortKey(b)
    if (ka[0] !== kb[0]) return ka[0] - kb[0]
    if (ka[1] !== kb[1]) return ka[1] - kb[1]
    if (typeof ka[2] === 'number' && typeof kb[2] === 'number') return ka[2] - kb[2]
    return String(ka[2]).localeCompare(String(kb[2]))
}

/**
 * @desc 按链/阶条件把 Buff 分到二级目录（同一套口径同时服务顶层与「全局 Buff」目录内部）：
 * 链条件 → `角色名X链`；阶条件 → `角色名的武器名`（按角色 + 武器划分，不按阶数）。
 * 无链/阶条件的 Buff 原样留在 `loose`（由界面就地做数字归并）。
 */
const gateBucketsOf = (buffs: readonly BuffInstance[], team: readonly CharSlot[]): GateBuckets => {
    const map = new Map<string, GateBucket>()
    const order: string[] = []
    const loose: BuffInstance[] = []
    for (const buff of buffs) {
        const gate = gateOf(buff)
        if (!gate) {
            loose.push(buff)
            continue
        }
        const folder = gateFolderOf(gate, team)
        let bucket = map.get(folder.key)
        if (!bucket) {
            bucket = {
                raw: folder.key,
                title: folder.title,
                charIdx: gate.charIdx,
                gateKind: gate.kind === 'chain' ? 'chain' : 'weapon',
                gateMin: gate.min,
                items: []
            }
            map.set(folder.key, bucket)
            order.push(folder.key)
        }
        bucket.items.push(buff)
    }
    return { buckets: order.sort(compareGateKey).map((key) => map.get(key)!), loose }
}

/**
 * @desc 二级目录桶 → 渲染节点。
 * `keyPrefix` 区分顶层（`folder:`）与「全局 Buff」目录内部（`global:`），
 * 避免两处同名目录（如都叫「今汐的时和岁稔」）在折叠状态上互相影响。
 */
const gateNodesOf = (buckets: readonly GateBucket[], parentKey: string, keyPrefix: string): BuffTreeNode[] =>
    buckets.map((bucket) => ({
        key: `${keyPrefix}${bucket.raw}`,
        type: 'folder',
        name: bucket.title,
        prefix: `${keyPrefix}${bucket.raw}`,
        prefixText: bucket.title,
        suffixText: '',
        folderKind: 'char-gate',
        charIdx: bucket.charIdx,
        gateKind: bucket.gateKind,
        gateMin: bucket.gateMin,
        parentKey,
        memberIds: bucket.items.map((b) => b.id),
        children: bucket.items
    }))

/**
 * @desc 构建三级归类树（一级全局 / 二级角色链阶 / 三级数字前后缀）。
 *
 * 输出沿用左侧列表既有的 `GroupedBuffConfItem` 结构：目录节点的 `children` 是该容器下的**原始 Buff 列表**，
 * 三级数字目录由界面用 `groupBuffSets(children)` 就地派生（该函数已按键数字升序）。这样既满足「三级归类」，
 * 又不改变既有列表渲染/拖拽/右键菜单的实现。
 *
 * 「全局 Buff」目录内部同样按二级规则分子目录：`gateChildren` 放链/武器子目录，
 * `children` 只留无链/阶条件的全局 buff（界面内做数字归并）。
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
    const nonGlobals: BuffInstance[] = []

    for (const buff of buffSets) {
        if (globalSet.has(buff.id)) globals.push(buff)
        else nonGlobals.push(buff)
    }

    const topGates = gateBucketsOf(nonGlobals, team)

    const nodes: BuffTreeNode[] = []
    const folderKeys: string[] = []
    const treeBuckets: BuffTree['buckets'] = []

    if (globals.length > 0) {
        const folderKey = 'folder:global'
        const globalGates = gateBucketsOf(globals, team)
        const gateChildren = gateNodesOf(globalGates.buckets, folderKey, 'global:')
        folderKeys.push(folderKey, ...gateChildren.map((node) => node.prefix!))
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
            children: globalGates.loose,
            gateChildren
        })
    }

    for (const node of gateNodesOf(topGates.buckets, '__root__', 'folder:')) {
        folderKeys.push(node.prefix!)
        nodes.push(node)
        treeBuckets.push({ parentKey: node.prefix!, memberIds: node.memberIds! })
    }

    // 无链/阶条件的非全局 Buff：留在最外层平铺（其中的数字目录仍由 groupBuffSets 就地派生）
    if (topGates.loose.length > 0) {
        for (const item of groupBuffSets(topGates.loose)) {
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
        treeBuckets.push({ parentKey: '__top__', memberIds: topGates.loose.map((b) => b.id) })
    }

    return { nodes, folderKeys, buckets: treeBuckets }
}
