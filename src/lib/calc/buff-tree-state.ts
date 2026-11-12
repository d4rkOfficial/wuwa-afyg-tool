/**
 * @desc 显式 Buff 文件夹树的纯逻辑层（store / 迁移 / 导入 / 图标 / 平铺表共用）。
 *
 * 口径（已与产品对齐）：
 * - 树有两个根：`global` / `nonGlobal`；视图上就是两个受保护的根文件夹；
 * - 文件夹最多两级，Buff 可以挂在根 / 一级 / 二级；
 * - 同级文件夹名唯一；导入撞名的 Buff 末尾补 `#`；
 * - 文件夹图标由**所有后代 Buff**推导，不落库；
 * - 数字文件夹只在迁移/导入时用于排序/相邻，运行时不按数字自动归并。
 */

import type { BuffCondition, BuffInstance, BuffTreeState, BuffTreeNode } from './calculation.types'
import type { CharSlot } from '$lib/types/project'
import {
    buffFolderPath,
    buffLeafName,
    clampBuffPathName,
    isLeafNameValid,
    joinBuffPath,
    splitBuffPath,
    uniqueLeafName
} from './buff-name'

/** @desc 迁移/导入期数字命名识别（运行时不用于自动归并） */
const NUMERIC_NAME_PATTERN = /^(.+?)(\d+)([^\d]*)$/
/** @desc 文件夹最大层数（根之上还能套的文件夹层数） */
export const MAX_FOLDER_DEPTH = 2

export interface CoarsePath {
    tab: 'global' | 'nonGlobal'
    /** @desc 一级文件夹名；null = 根目录 */
    folder: string | null
}

/** @desc 角色本体文件夹：`角色名-本体` */
export const characterBodyFolderName = (character: string): string => `${character}-本体`

/** @desc 共鸣链文件夹：`角色名-链数链` */
export const characterChainFolderName = (character: string, min: number): string => `${character}-${min}链`

/** @desc 武器文件夹：`角色名-武器名` */
export const characterWeaponFolderName = (character: string, weapon: string): string => `${character}-${weapon}`

/** @desc 首位声骸文件夹：`角色名-声骸名` */
export const characterEchoFolderName = (character: string, echo: string): string => `${character}-${echo}`

/** @desc 套装文件夹：`角色名-套装名-x件` */
export const characterSetFolderName = (character: string, setName: string, pieces: number): string =>
    `${character}-${setName}-${pieces}件`

/** @desc 某 Buff 的粗分类落点：本体 / 单链 / 单阶武器；其它一律根目录 */
export const coarsePathOf = (buff: BuffInstance, team: readonly CharSlot[]): CoarsePath => {
    const tab = buff.global ? 'global' : 'nonGlobal'
    const rules = buff.rules ?? []
    const chains = rules.flatMap((rule) => (rule.kind === 'chain' ? [rule] : []))
    const refines = rules.flatMap((rule) => (rule.kind === 'refinement' ? [rule] : []))
    const charNameOf = (idx: number): string => team[idx]?.character ?? `角色${idx + 1}`

    if (chains.length === 1 && refines.length === 0) {
        const { charIdx, min } = chains[0]
        if (charIdx < 0) return { tab, folder: null }
        const name = charNameOf(charIdx)
        return { tab, folder: min <= 0 ? characterBodyFolderName(name) : characterChainFolderName(name, min) }
    }
    if (refines.length === 1 && chains.length === 0) {
        const { charIdx } = refines[0]
        if (charIdx < 0) return { tab, folder: null }
        const name = charNameOf(charIdx)
        const weapon = team[charIdx]?.weapon
        return { tab, folder: characterWeaponFolderName(name, weapon ?? '武器') }
    }
    return { tab, folder: null }
}

const buffNameOf = (buffId: string, buffById: ReadonlyMap<string, BuffInstance>): string =>
    buffById.get(buffId)?.name ?? buffId

/** @desc 同级目录下所有节点的名字（文件夹 + Buff） */
const siblingNamesOf = (
    children: readonly BuffTreeNode[],
    buffById: ReadonlyMap<string, BuffInstance>
): Set<string> => {
    const names = new Set<string>()
    for (const node of children) {
        if (node.kind === 'folder') names.add(node.name)
        else names.add(buffLeafName(buffNameOf(node.buffId, buffById)))
    }
    return names
}

/** @desc 在目标同级的现有名字上补 `#`，直到不冲突 */
export const uniqueBuffName = (desired: string, siblings: ReadonlySet<string>): string => {
    let name = desired
    while (siblings.has(name)) name += '#'
    return name
}

const makeFolderId = (): string => `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export const emptyBuffTree = (): BuffTreeState => ({ global: [], nonGlobal: [] })

export const isFolderNode = (node: BuffTreeNode): node is Extract<BuffTreeNode, { kind: 'folder' }> =>
    node.kind === 'folder'
export const isBuffNode = (node: BuffTreeNode): node is Extract<BuffTreeNode, { kind: 'buff' }> => node.kind === 'buff'

const cloneNodes = (nodes: readonly BuffTreeNode[]): BuffTreeNode[] =>
    nodes.map((node) => (node.kind === 'folder' ? { ...node, children: cloneNodes(node.children) } : { ...node }))

export const cloneBuffTree = (tree: BuffTreeState): BuffTreeState => ({
    global: cloneNodes(tree.global),
    nonGlobal: cloneNodes(tree.nonGlobal)
})

/** @desc 遍历树中所有 Buff 节点（含嵌套文件夹） */
export const collectBuffIds = (nodes: readonly BuffTreeNode[]): string[] => {
    const ids: string[] = []
    const walk = (list: readonly BuffTreeNode[]): void => {
        for (const node of list) {
            if (node.kind === 'buff') ids.push(node.buffId)
            else walk(node.children)
        }
    }
    walk(nodes)
    return ids
}

/** @desc 遍历树中所有文件夹节点 */
export const collectFolders = (nodes: readonly BuffTreeNode[]): Extract<BuffTreeNode, { kind: 'folder' }>[] => {
    const folders: Extract<BuffTreeNode, { kind: 'folder' }>[] = []
    const walk = (list: readonly BuffTreeNode[]): void => {
        for (const node of list) {
            if (node.kind !== 'folder') continue
            folders.push(node)
            walk(node.children)
        }
    }
    walk(nodes)
    return folders
}

/** @desc 名字真源：清洗/压平 Buff 全名（去掉空段、超深层级并入短名） */
export const normalizeBuffFullNames = (buffs: readonly BuffInstance[]): BuffInstance[] =>
    buffs.map((buff) => {
        const next = clampBuffPathName(buff.name || buff.id, MAX_FOLDER_DEPTH)
        return next === buff.name ? buff : { ...buff, name: next }
    })

interface FolderRecord {
    id: string
    name: string
    path: string
    parentPath: string
    depth: number
}

/**
 * @desc 归一化树：**Buff 全名是成员归属真源**。
 * - 文件夹节点只负责 id / 名字 / 排序 / 空文件夹；
 * - 每个 Buff 按 `A\B\buff` 的名字前缀放进对应文件夹（最多两级）；
 * - 保留已有文件夹顺序与 Buff 顺序；新文件夹/新 Buff 追加；
 * - 去未知 Buff、去重复、按 global 归位。
 */
export const normalizeBuffTree = (
    tree: BuffTreeState | undefined,
    buffs: readonly BuffInstance[],
    globalIds: readonly string[]
): BuffTreeState => {
    void globalIds
    const buffById = new Map(buffs.map((buff) => [buff.id, buff]))

    const buildTab = (nodes: readonly BuffTreeNode[] | undefined, tab: 'global' | 'nonGlobal'): BuffTreeNode[] => {
        const folders = new Map<string, FolderRecord>()
        const childOrder = new Map<string, string[]>()
        const buffOrder = new Map<string, number>()
        let order = 0

        const pushChild = (container: string, key: string): void => {
            const list = childOrder.get(container) ?? []
            if (!list.includes(key)) list.push(key)
            childOrder.set(container, list)
        }

        const walkExisting = (list: readonly BuffTreeNode[] | undefined, parentPath: string, depth: number): void => {
            for (const node of Array.isArray(list) ? list : []) {
                if (!node || typeof node !== 'object') continue
                if (node.kind === 'folder') {
                    if (depth >= MAX_FOLDER_DEPTH) continue
                    const name = String(node.name ?? '').trim()
                    if (!name || !isLeafNameValid(name)) continue
                    const path = joinBuffPath(parentPath, name)
                    if (folders.has(path)) continue
                    folders.set(path, {
                        id: node.id || makeFolderId(),
                        name,
                        path,
                        parentPath,
                        depth: depth + 1
                    })
                    pushChild(parentPath, `f:${path}`)
                    walkExisting(node.children ?? [], path, depth + 1)
                    continue
                }
                if (node.kind !== 'buff') continue
                const buff = buffById.get(node.buffId)
                if (!buff || !!buff.global !== (tab === 'global')) continue
                if (buffOrder.has(buff.id)) continue
                buffOrder.set(buff.id, order++)
                pushChild(parentPath, `b:${buff.id}`)
            }
        }
        walkExisting(nodes, '', 0)

        const ensureFolder = (parts: readonly string[], parentPath: string): string => {
            let current = parentPath
            for (const part of parts) {
                const path = joinBuffPath(current, part)
                if (!folders.has(path)) {
                    folders.set(path, {
                        id: makeFolderId(),
                        name: part,
                        path,
                        parentPath: current,
                        depth: part ? current.split('\\').filter(Boolean).length + 1 : 1
                    })
                    pushChild(current, `f:${path}`)
                }
                current = path
            }
            return current
        }

        const desired = new Map<string, string[]>()
        for (const buff of buffs) {
            if (!!buff.global !== (tab === 'global')) continue
            const folderParts = buffFolderPath(buff.name).slice(0, MAX_FOLDER_DEPTH)
            const container = ensureFolder(folderParts, '')
            const list = desired.get(container) ?? []
            if (!list.includes(buff.id)) list.push(buff.id)
            desired.set(container, list)
        }

        const build = (container: string): BuffTreeNode[] => {
            const orderKeys = childOrder.get(container) ?? []
            const folderKeys = [...folders.values()]
                .filter((folder) => folder.parentPath === container)
                .map((folder) => `f:${folder.path}`)
            const buffKeys = desired.get(container) ?? []
            const keys = [...orderKeys]
            for (const key of folderKeys) if (!keys.includes(key)) keys.push(key)
            for (const id of buffKeys) {
                const key = `b:${id}`
                if (!keys.includes(key)) keys.push(key)
            }
            const out: BuffTreeNode[] = []
            for (const key of keys) {
                if (key.startsWith('f:')) {
                    const folder = folders.get(key.slice(2))
                    if (!folder) continue
                    out.push({ kind: 'folder', id: folder.id, name: folder.name, children: build(folder.path) })
                    continue
                }
                const id = key.slice(2)
                const buff = buffById.get(id)
                if (!buff || !buffKeys.includes(id)) continue
                out.push({ kind: 'buff', id: buff.id, buffId: buff.id })
            }
            return out
        }

        return build('')
    }

    return {
        global: buildTab(tree?.global, 'global'),
        nonGlobal: buildTab(tree?.nonGlobal, 'nonGlobal')
    }
}

/** @desc 显式树迁移版本：旧工程/旧扁平树重跑一次数字前后缀迁移 */
export const BUFF_TREE_VERSION = 2

export interface LegacyMigrationResult {
    tree: BuffTreeState
    /** @desc 迁移后的 Buff 列表（数字组成员已改成全名） */
    buffs: BuffInstance[]
}

interface NumericEntry {
    buff: BuffInstance
    num: number
    suffix: string
    short: string
}

const parseNumericName = (name: string): { prefix: string; num: number; suffix: string } | null => {
    const match = name.match(NUMERIC_NAME_PATTERN)
    if (!match) return null
    const prefix = match[1].trimEnd()
    if (!prefix) return null
    return { prefix, num: Number(match[2]), suffix: match[3] }
}

const uniqueName = (desired: string, used: Set<string>): string => {
    let name = desired
    while (used.has(name)) name += '#'
    used.add(name)
    return name
}

const compareNatural = (a: string, b: string): number =>
    a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })

/** @desc 迁移期的数字文件夹名：前缀；同前缀不同后缀撞名时补 `（后缀）`，仍撞名补 `#` */
const numericFolderName = (prefix: string, suffix: string, used: Set<string>): string => {
    if (!used.has(prefix)) {
        used.add(prefix)
        return prefix
    }
    return uniqueName(`${prefix}（${suffix}）`.trim(), used)
}

/**
 * @desc 迁移旧工程：按条件粗分，再把「同前缀 + 同后缀」的数字命名成员收进数字文件夹。
 * - 以旧行为为准：`锁3链…` 与 `锁3链 同奏…` 后缀不同，不合并；
 * - 只拆最后一组「数字 + 非数字后缀」；空前缀不建文件夹；
 * - 同组 ≥2 条才建文件夹；文件夹名用前缀（撞名补后缀）；
 * - 子短名为 `${数字}${后缀}`；Buff 全名为 `条件文件夹\数字文件夹\短名`；
 * - 条件文件夹为一级，数字文件夹为二级；无条件的数字文件夹为一级。
 */
export const migrateLegacyBuffTree = (
    buffs: readonly BuffInstance[],
    team: readonly CharSlot[]
): LegacyMigrationResult => {
    // 已经是全名（含分隔符）的工程不再二次拆数字，避免把 v1 短名越改越乱
    if (buffs.some((buff) => buff.name.includes('\\'))) {
        const named = normalizeBuffFullNames(buffs)
        return {
            tree: normalizeBuffTree(
                undefined,
                named,
                named.filter((buff) => buff.global).map((buff) => buff.id)
            ),
            buffs: named
        }
    }

    const groups = new Map<string, { tab: 'global' | 'nonGlobal'; folder: string | null; buffs: BuffInstance[] }>()
    for (const buff of buffs) {
        const path = coarsePathOf(buff, team)
        const key = `${path.tab}\u0000${path.folder ?? ''}`
        const group = groups.get(key) ?? { ...path, buffs: [] }
        group.buffs.push(buff)
        groups.set(key, group)
    }

    const renamed = new Map<string, BuffInstance>()
    const rootFolders: Record<
        'global' | 'nonGlobal',
        Array<{ name: string; node: Extract<BuffTreeNode, { kind: 'folder' }> }>
    > = {
        global: [],
        nonGlobal: []
    }
    const rootBuffs: Record<'global' | 'nonGlobal', BuffTreeNode[]> = { global: [], nonGlobal: [] }
    const rootNames: Record<'global' | 'nonGlobal', Set<string>> = { global: new Set(), nonGlobal: new Set() }

    /**
     * @desc 一组同粗分类的 Buff → 文件夹节点 / 直挂 Buff 节点。
     * 先按「前缀 + 后缀」分组，只有 ≥2 条才成文件夹。
     */
    const buildGroup = (
        group: { tab: 'global' | 'nonGlobal'; folder: string | null; buffs: BuffInstance[] },
        conditionFolderName: string | null
    ): { folders: Array<{ name: string; node: Extract<BuffTreeNode, { kind: 'folder' }> }>; buffs: BuffTreeNode[] } => {
        const numericGroups = new Map<string, { prefix: string; suffix: string; entries: NumericEntry[] }>()
        for (const buff of group.buffs) {
            const parsed = parseNumericName(buff.name)
            if (!parsed) continue
            const key = `${parsed.prefix}\u0000${parsed.suffix}`
            const item = numericGroups.get(key) ?? { prefix: parsed.prefix, suffix: parsed.suffix, entries: [] }
            item.entries.push({
                buff,
                num: parsed.num,
                suffix: parsed.suffix,
                short: `${parsed.num}${parsed.suffix}`
            })
            numericGroups.set(key, item)
        }
        const active = [...numericGroups.values()]
            .filter((item) => item.entries.length >= 2)
            .sort((a, b) => compareNatural(a.prefix, b.prefix) || compareNatural(a.suffix, b.suffix))
        const activeBuffs = new Set(active.flatMap((item) => item.entries.map((entry) => entry.buff.id)))

        const directBuffs = group.buffs.filter((buff) => !activeBuffs.has(buff.id))
        const directNames = new Set(directBuffs.map((buff) => buff.name.trim()))
        const usedFolderNames = new Set<string>()

        const folders = active.map((item) => {
            const folderName = numericFolderName(
                item.prefix,
                item.suffix,
                new Set([...directNames, ...usedFolderNames])
            )
            usedFolderNames.add(folderName)
            const childNames = new Set<string>()
            const entries = [...item.entries]
                .sort((a, b) => a.num - b.num || compareNatural(a.suffix, b.suffix))
                .map((entry) => {
                    const short = uniqueLeafName(entry.short, childNames)
                    childNames.add(short)
                    const full = joinBuffPath(conditionFolderName, folderName, short)
                    renamed.set(entry.buff.id, { ...entry.buff, name: full })
                    return { ...entry, short }
                })
            return {
                name: folderName,
                node: {
                    kind: 'folder' as const,
                    id: makeFolderId(),
                    name: folderName,
                    children: entries.map((entry) => ({
                        kind: 'buff' as const,
                        id: entry.buff.id,
                        buffId: entry.buff.id
                    }))
                }
            }
        })

        for (const buff of directBuffs) {
            const full = joinBuffPath(conditionFolderName, buff.name.trim())
            renamed.set(buff.id, { ...buff, name: full })
        }

        return {
            folders,
            buffs: directBuffs.map((buff) => ({ kind: 'buff' as const, id: buff.id, buffId: buff.id }))
        }
    }

    for (const group of groups.values()) {
        if (group.folder === null) {
            // 顶层：无条件的数字文件夹与直挂 Buff 都在根
            const built = buildGroup(group, null)
            for (const folder of built.folders) {
                const name = uniqueName(folder.name, rootNames[group.tab])
                if (name !== folder.name) {
                    for (const id of collectBuffIds([folder.node])) {
                        const buff = renamed.get(id)
                        if (!buff) continue
                        const parts = splitBuffPath(buff.name)
                        if (parts.length > 1) parts[0] = name
                        renamed.set(id, { ...buff, name: joinBuffPath(...parts) })
                    }
                }
                rootFolders[group.tab].push({ name, node: { ...folder.node, name } })
            }
            rootBuffs[group.tab].push(...built.buffs)
            continue
        }
        const conditionName = uniqueName(group.folder, rootNames[group.tab])
        const built = buildGroup(group, conditionName)
        rootFolders[group.tab].push({
            name: conditionName,
            node: {
                kind: 'folder',
                id: makeFolderId(),
                name: conditionName,
                children: [...built.folders.map((folder) => folder.node), ...built.buffs]
            }
        })
    }

    const tree = emptyBuffTree()
    for (const tab of ['global', 'nonGlobal'] as const) {
        tree[tab] = [
            ...rootFolders[tab].sort((a, b) => compareNatural(a.name, b.name)).map((folder) => folder.node),
            ...rootBuffs[tab]
        ]
    }

    const nextBuffs = buffs.map((buff) => renamed.get(buff.id) ?? buff)
    return {
        tree: normalizeBuffTree(
            tree,
            nextBuffs,
            nextBuffs.filter((buff) => buff.global).map((buff) => buff.id)
        ),
        buffs: nextBuffs
    }
}

/** @desc 在树的目标文件夹内为 Buff 找不冲突的全名（只比较短名，撞名补 `#`） */
export const uniqueBuffFullName = (
    tree: BuffTreeState,
    buff: BuffInstance,
    buffById: ReadonlyMap<string, BuffInstance>
): string => {
    const folderParts = buffFolderPath(buff.name).slice(0, MAX_FOLDER_DEPTH)
    const leaf = buffLeafName(buff.name)
    let children = tree[buff.global ? 'global' : 'nonGlobal']
    for (const part of folderParts) {
        const folder = children.find(
            (node): node is Extract<BuffTreeNode, { kind: 'folder' }> => node.kind === 'folder' && node.name === part
        )
        if (!folder) return joinBuffPath(...folderParts, leaf)
        children = folder.children
    }
    const siblings = new Set<string>()
    for (const node of children) {
        if (node.kind === 'folder') siblings.add(node.name)
        else if (node.buffId !== buff.id) siblings.add(buffLeafName(buffNameOf(node.buffId, buffById)))
    }
    const unique = uniqueBuffName(leaf, siblings)
    return joinBuffPath(...folderParts, unique)
}

/** @desc 按 Buff 全名的文件夹路径追加进树；路径不存在就补文件夹（最多两级） */
export const appendBuffToTree = (
    tree: BuffTreeState,
    buff: BuffInstance,
    team: readonly CharSlot[],
    buffById: ReadonlyMap<string, BuffInstance>
): BuffTreeState => {
    void team
    void buffById
    const next = cloneBuffTree(tree)
    const root = next[buff.global ? 'global' : 'nonGlobal']
    const parts = buffFolderPath(buff.name).slice(0, MAX_FOLDER_DEPTH)
    let children = root
    for (const part of parts) {
        let folder = children.find(
            (item): item is Extract<BuffTreeNode, { kind: 'folder' }> => item.kind === 'folder' && item.name === part
        )
        if (!folder) {
            folder = { kind: 'folder', id: makeFolderId(), name: part, children: [] }
            children.push(folder)
        }
        children = folder.children
    }
    const node: BuffTreeNode = { kind: 'buff', id: buff.id, buffId: buff.id }
    if (!children.some((item) => item.kind === 'buff' && item.buffId === buff.id)) children.push(node)
    return next
}

/** @desc 平铺表列：非全局树按存储顺序展开；每列返回「一级/二级/Buff」路径标签 */
export const storedColumnLayout = (
    tree: BuffTreeState,
    buffs: readonly BuffInstance[]
): { columns: BuffInstance[]; paths: Map<string, string[]> } => {
    const normalized = normalizeBuffTree(
        tree,
        buffs,
        buffs.filter((b) => b.global).map((b) => b.id)
    )
    const buffById = new Map(buffs.map((buff) => [buff.id, buff]))
    const columns: BuffInstance[] = []
    const paths = new Map<string, string[]>()
    const pushBuff = (buffId: string, path: string[]): void => {
        const buff = buffById.get(buffId)
        if (!buff || buff.global) return
        columns.push(buff)
        paths.set(buff.id, [...path, buffLeafName(buff.name)])
    }
    const walk = (nodes: readonly BuffTreeNode[], folderPath: string[]): void => {
        for (const node of nodes) {
            if (node.kind === 'buff') {
                pushBuff(node.buffId, folderPath)
                continue
            }
            walk(node.children, [...folderPath, node.name])
        }
    }
    // 根目录 Buff 固定排最左（表头一层居中），文件夹列排其后
    for (const node of normalized.nonGlobal) {
        if (node.kind === 'buff') pushBuff(node.buffId, [])
    }
    walk(
        normalized.nonGlobal.filter((node) => node.kind === 'folder'),
        []
    )
    return { columns, paths }
}

/** @desc 同一父级下为导入 Buff 找不冲突的全名（文件夹路径 + 唯一短名） */
export const importedBuffName = (
    desired: string,
    rootNodes: readonly BuffTreeNode[],
    folderName: string | null,
    buffById: ReadonlyMap<string, BuffInstance>
): string => {
    const leaf = buffLeafName(desired)
    if (folderName === null) return uniqueBuffName(leaf, siblingNamesOf(rootNodes, buffById))
    const folder = rootNodes.find(
        (node): node is Extract<BuffTreeNode, { kind: 'folder' }> => node.kind === 'folder' && node.name === folderName
    )
    const unique = uniqueBuffName(leaf, siblingNamesOf(folder?.children ?? [], buffById))
    return joinBuffPath(folderName, unique)
}

// ── 文件夹图标（由后代 Buff 推导）──

export interface ChainRange {
    from: number
    to: number
}
export interface FolderIconSpec {
    kind: 'empty' | 'generic' | 'character' | 'weapon' | 'effect'
    charIdx?: number
    weapon?: string | null
    chainRanges: ChainRange[]
    refineRanges: ChainRange[]
}

const rangesOf = (values: readonly number[], excludeZero: boolean): ChainRange[] => {
    const nums = [...new Set(values)]
        .filter((n) => Number.isFinite(n) && (!excludeZero || n !== 0))
        .sort((a, b) => a - b)
    const ranges: ChainRange[] = []
    for (const num of nums) {
        const last = ranges[ranges.length - 1]
        if (last && num === last.to + 1) last.to = num
        else ranges.push({ from: num, to: num })
    }
    return ranges
}

/** @desc 文件夹图标：同角色纯链 → 头像+链范围；同角色纯阶 → 武器+阶范围；跨角色/链阶混合 → 通用 */
export const deriveFolderIcon = (
    node: Extract<BuffTreeNode, { kind: 'folder' }>,
    buffById: ReadonlyMap<string, BuffInstance>,
    team: readonly CharSlot[]
): FolderIconSpec => {
    const chars = new Set<number>()
    const chainMins: number[] = []
    const refineMins: number[] = []
    let hasEffect = false
    let hasAny = false
    const walk = (nodes: readonly BuffTreeNode[]): void => {
        for (const child of nodes) {
            if (child.kind === 'folder') {
                walk(child.children)
                continue
            }
            const buff = buffById.get(child.buffId)
            if (!buff) continue
            hasAny = true
            if (Array.isArray(buff.scope) && buff.scope.length === 0) hasEffect = true
            for (const rule of buff.rules ?? []) {
                if (rule.kind === 'chain') {
                    chars.add(rule.charIdx)
                    chainMins.push(rule.min)
                } else if (rule.kind === 'refinement') {
                    chars.add(rule.charIdx)
                    refineMins.push(rule.min)
                }
            }
        }
    }
    walk(node.children)

    if (!hasAny) return { kind: 'empty', chainRanges: [], refineRanges: [] }
    if (chars.size === 0) {
        if (hasEffect) return { kind: 'effect', chainRanges: [], refineRanges: [] }
        return { kind: 'generic', chainRanges: [], refineRanges: [] }
    }
    if (chars.size > 1) return { kind: 'generic', chainRanges: [], refineRanges: [] }
    const charIdx = [...chars][0]
    if (chainMins.length > 0 && refineMins.length > 0) {
        return { kind: 'generic', chainRanges: [], refineRanges: [] }
    }
    if (chainMins.length > 0) {
        return {
            kind: 'character',
            charIdx,
            chainRanges: rangesOf(chainMins, true),
            refineRanges: []
        }
    }
    return {
        kind: 'weapon',
        charIdx,
        weapon: team[charIdx]?.weapon ?? null,
        chainRanges: [],
        refineRanges: rangesOf(refineMins, false)
    }
}

// ── 树节点查找 / 移动（store 与测试共用）──

export interface LocatedNode {
    node: BuffTreeNode
    parent: BuffTreeNode[] | null
    parentFolder: Extract<BuffTreeNode, { kind: 'folder' }> | null
    tab: 'global' | 'nonGlobal'
}

export const findNode = (tree: BuffTreeState, id: string): LocatedNode | null => {
    const walk = (
        list: BuffTreeNode[],
        parentFolder: Extract<BuffTreeNode, { kind: 'folder' }> | null,
        tab: 'global' | 'nonGlobal'
    ): LocatedNode | null => {
        for (const node of list) {
            if (node.id === id) return { node, parent: list, parentFolder, tab }
            if (node.kind === 'folder') {
                const found = walk(node.children, node, tab)
                if (found) return found
            }
        }
        return null
    }
    return walk(tree.global, null, 'global') ?? walk(tree.nonGlobal, null, 'nonGlobal')
}

/** @desc Buff 节点所在容器（用于复制后插到原位置旁边） */
export interface BuffPlacement {
    tab: 'global' | 'nonGlobal'
    folderId: string | null
    index: number
}

/** @desc 找 Buff 节点所在容器与下标；先查非全局树，再查全局树 */
export const findBuffPlacement = (tree: BuffTreeState, buffId: string): BuffPlacement | null => {
    const walk = (list: BuffTreeNode[], folderId: string | null, tab: 'global' | 'nonGlobal'): BuffPlacement | null => {
        for (let index = 0; index < list.length; index++) {
            const node = list[index]
            if (node.kind === 'buff' && node.buffId === buffId) return { tab, folderId, index }
            if (node.kind === 'folder') {
                const found = walk(node.children, node.id, tab)
                if (found) return found
            }
        }
        return null
    }
    return walk(tree.nonGlobal, null, 'nonGlobal') ?? walk(tree.global, null, 'global')
}

/** @desc 节点的完整路径名（文件夹名数组 + Buff 短名），供「按全名转移」 */
export const pathNamesOf = (
    tree: BuffTreeState,
    id: string,
    buffById: ReadonlyMap<string, BuffInstance>
): string[] | null => {
    const walk = (list: BuffTreeNode[], path: string[]): string[] | null => {
        for (const node of list) {
            if (node.id === id) {
                return node.kind === 'folder' ? [...path, node.name] : splitBuffPath(buffNameOf(node.buffId, buffById))
            }
            if (node.kind === 'folder') {
                const found = walk(node.children, [...path, node.name])
                if (found) return found
            }
        }
        return null
    }
    return walk(tree.global, []) ?? walk(tree.nonGlobal, [])
}

/** @desc 条件文本（测试/调试用；不参与计算） */
export const conditionTextOf = (condition: BuffCondition | undefined): string => JSON.stringify(condition ?? null)

// ── 空文件夹清理 ──

export interface PruneEmptyResult {
    tree: BuffTreeState
    /** @desc 被清掉的文件夹 id（倒序：深的在前，便于调用方按需回滚/提示） */
    removedIds: string[]
}

/**
 * @desc 清理**空文件夹**（递归：子文件夹被清空后父文件夹也会跟着变空）。
 *
 * 口径（已对齐）：
 * - 只在 Buff 弹窗**关闭 / 保存**时调用，不做即时清理 —— 否则「新建 Buff 的文件夹选择器」
 *   临时建出来的空文件夹会在用户真正落盘前被删掉；
 * - 全局树与非全局树都清（两棵树用的是同一套 `BuffTreeNode`，不存在只清一侧的理由）；
 * - **根是受保护的**：返回的树永远是 `{ global, nonGlobal }` 两个数组，清理只发生在数组内部；
 * - 纯函数，入参不被改写（返回新节点）。
 */
export const pruneEmptyFolders = (tree: BuffTreeState): PruneEmptyResult => {
    const removedIds: string[] = []
    const prune = (nodes: readonly BuffTreeNode[]): BuffTreeNode[] => {
        const out: BuffTreeNode[] = []
        for (const node of nodes) {
            if (node.kind !== 'folder') {
                out.push(node)
                continue
            }
            const children = prune(node.children)
            if (children.length === 0) {
                removedIds.push(node.id)
                continue
            }
            out.push({ ...node, children })
        }
        return out
    }
    const global = prune(tree.global)
    const nonGlobal = prune(tree.nonGlobal)
    return { tree: { global, nonGlobal }, removedIds }
}
