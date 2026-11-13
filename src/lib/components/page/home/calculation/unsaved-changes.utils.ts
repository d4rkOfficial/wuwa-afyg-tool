/**
 * @desc 「未保存修改」确认弹窗的**变更清单**计算（纯逻辑，可单测）。
 *
 * 两个弹窗各自把自己的改动折成同一份 `UnsavedChangeItem[]`：
 * - Buff 配置弹窗 → `diffBuffConfig(before, after)`（新建/删除/改名/乘区/作用范围/门槛条件/全局/位置/顺序）；
 * - 伤害类型编辑弹窗 → `diffDamageTypes(before, after)`。
 *
 * 口径：**只列真正变了的对象**（逐字段比较，顺序无关的字段先归一化），
 * 没改动返回空数组 —— 空数组就是「无需二次确认」的唯一判据。
 */
import type { BuffInstance, BuffTreeNode, BuffTreeState, CalcState } from '$lib/calc/calculation.types'
import type { UnsavedChangeItem } from '$lib/types/unsaved-change'
import { ZONE_MAP, classifyBuffScope } from '$lib/calc/calculation.consts'

// ── 小工具 ──

/** @desc Buff 短名（全名的最后一段；文件夹用全名展示，这里只取叶子） */
const leafOf = (name: string): string => {
    const parts = String(name ?? '')
        .split('\\')
        .map((part) => part.trim())
        .filter(Boolean)
    return parts[parts.length - 1] ?? ''
}

/** @desc 逐字面量比较（对象/数组用；字段顺序由写入方固定，够用且足够快） */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** @desc 乘区标签（未知乘区回退 id） */
const zoneLabel = (zoneId: string): string => ZONE_MAP.get(zoneId)?.label ?? zoneId

/** @desc 乘区条目的一句话值描述（引用/覆盖/数值三种形态） */
const zoneValueText = (zone: BuffInstance['zones'][number]): string => {
    if (zone.ref) return '引用'
    const unit = ZONE_MAP.get(zone.zoneId)?.unit === '%' ? '%' : ''
    return `${zone.override ? '覆盖 ' : ''}${zone.value}${unit}`
}

/** @desc 作用范围文案（与「生效成员」tab 同一套四态叫法） */
export const scopeTextOf = (scope: BuffInstance['scope'], teamSize = 3): string => {
    const cls = classifyBuffScope(scope, teamSize)
    if (cls.kind === 'all') return '通用'
    if (cls.kind === 'charsAll') return '全队'
    if (cls.kind === 'effect') return '仅效应'
    return cls.idxs.map((i) => `角色${i + 1}`).join('/')
}

/** @desc 门槛条件条数文案 */
const rulesTextOf = (rules: BuffInstance['rules']): string => {
    const count = rules?.length ?? 0
    return count === 0 ? '无' : `${count} 条`
}

/** @desc 两个乘区条目列表的差异（逐下标比较；新增/移除/换乘区/改值都给一行） */
const zoneChangeLines = (before: BuffInstance['zones'], after: BuffInstance['zones']): string[] => {
    const lines: string[] = []
    const max = Math.max(before.length, after.length)
    for (let i = 0; i < max; i++) {
        const b = before[i]
        const a = after[i]
        if (!b && a) {
            lines.push(`新增乘区：${zoneLabel(a.zoneId)} ${zoneValueText(a)}`)
            continue
        }
        if (b && !a) {
            lines.push(`移除乘区：${zoneLabel(b.zoneId)} ${zoneValueText(b)}`)
            continue
        }
        if (!b || !a || same(b, a)) continue
        if (b.zoneId !== a.zoneId) {
            lines.push(`乘区：${zoneLabel(b.zoneId)} → ${zoneLabel(a.zoneId)}`)
        } else if (!same(b.value, a.value) || !!b.ref !== !!a.ref) {
            lines.push(`${zoneLabel(a.zoneId)}：${zoneValueText(b)} → ${zoneValueText(a)}`)
        } else {
            lines.push(`${zoneLabel(a.zoneId)}：覆盖/条件有改动`)
        }
    }
    return lines
}

// ── Buff 文件夹树 ──

/** @desc 把树摊平成「文件夹 id → 名字/父容器」「Buff 位置」「每个父容器的子项顺序」 */
const flattenTree = (tree: BuffTreeState | undefined) => {
    const folders = new Map<string, { name: string; parent: string }>()
    const buffSlots = new Map<string, string>()
    /** @desc 父容器 key → 子项 key 顺序（'root:global' / 'root:nonGlobal' / 文件夹 id） */
    const order = new Map<string, string[]>()
    const walk = (nodes: readonly BuffTreeNode[], parent: string, tab: string) => {
        const keys: string[] = []
        for (const node of nodes) {
            if (node.kind === 'folder') {
                folders.set(node.id, { name: node.name, parent })
                keys.push(`f:${node.id}`)
                walk(node.children, node.id, tab)
                continue
            }
            keys.push(`b:${node.buffId}`)
            buffSlots.set(node.buffId, parent === `root:${tab}` ? '' : parent)
        }
        order.set(parent, keys)
    }
    walk(tree?.global ?? [], 'root:global', 'global')
    walk(tree?.nonGlobal ?? [], 'root:nonGlobal', 'nonGlobal')
    return { folders, buffSlots, order }
}

/** @desc 文件夹路径（父容器链的名字，用 `\` 拼接；根目录返回空串） */
const folderPathOf = (folderId: string | undefined, folders: Map<string, { name: string; parent: string }>): string => {
    if (!folderId) return ''
    const names: string[] = []
    let cursor: string | undefined = folderId
    let guard = 0
    while (cursor && guard++ < 8) {
        const node = folders.get(cursor)
        if (!node) break
        names.unshift(node.name)
        cursor = node.parent.startsWith('root:') ? undefined : node.parent
    }
    return names.join('\\')
}

/** @desc 文件夹树的变更（新建/删除/改名/移动/顺序），单独成条 */
const diffBuffTree = (
    before: BuffTreeState | undefined,
    after: BuffTreeState | undefined,
    nameOf: (buffId: string) => string
): UnsavedChangeItem[] => {
    const a = flattenTree(before)
    const b = flattenTree(after)
    if (a.folders.size === 0 && b.folders.size === 0 && a.buffSlots.size === 0 && b.buffSlots.size === 0) return []
    const items: UnsavedChangeItem[] = []

    for (const [id, node] of b.folders) {
        const prev = a.folders.get(id)
        if (!prev) {
            items.push({
                key: `folder-create:${id}`,
                title: node.name,
                subtitle: '新建文件夹',
                tone: 'create',
                lines: [`位置：${folderPathOf(node.parent, b.folders) || '根目录'}`]
            })
            continue
        }
        const lines: string[] = []
        if (prev.name !== node.name) lines.push(`名称：${prev.name} → ${node.name}`)
        const prevPath = folderPathOf(prev.parent, a.folders)
        const nextPath = folderPathOf(node.parent, b.folders)
        if (prevPath !== nextPath) lines.push(`位置：${prevPath || '根目录'} → ${nextPath || '根目录'}`)
        if (lines.length > 0) {
            items.push({ key: `folder-update:${id}`, title: node.name, subtitle: '修改文件夹', tone: 'update', lines })
        }
    }
    for (const [id, node] of a.folders) {
        if (b.folders.has(id)) continue
        items.push({
            key: `folder-delete:${id}`,
            title: node.name,
            subtitle: '删除文件夹',
            tone: 'remove',
            lines: []
        })
    }

    // Buff 位置（移入/移出文件夹）：只对「两边都还在树里、父容器变了」的条目报一行
    for (const [buffId, slot] of b.buffSlots) {
        if (!a.buffSlots.has(buffId)) continue
        const prevSlot = a.buffSlots.get(buffId) ?? ''
        if (prevSlot === slot) continue
        items.push({
            key: `buff-move:${buffId}`,
            title: nameOf(buffId),
            subtitle: '调整位置',
            tone: 'update',
            lines: [
                `位置：${folderPathOf(prevSlot || undefined, a.folders) || '根目录'} → ${
                    folderPathOf(slot || undefined, b.folders) || '根目录'
                }`
            ]
        })
    }

    // 顺序调整：同一父容器内子项集合相同、顺序不同 → 一条汇总
    for (const [parent, nextKeys] of b.order) {
        const prevKeys = a.order.get(parent)
        if (!prevKeys || same(prevKeys, nextKeys)) continue
        const sameSet = prevKeys.length === nextKeys.length && prevKeys.every((k) => nextKeys.includes(k))
        if (!sameSet) continue
        const parentName = parent.startsWith('root:')
            ? parent.endsWith('global')
                ? '全局'
                : '非全局'
            : folderPathOf(parent, b.folders)
        items.push({
            key: `tree-order:${parent}`,
            title: parentName,
            subtitle: '调整顺序',
            tone: 'update',
            lines: ['同一目录内的排列顺序有调整']
        })
    }

    return items
}

/**
 * @desc 两次 Buff 配置快照的差异（Buff 配置弹窗「关闭前确认」用）。
 * 覆盖：Buff 自身的增删改（名称 / 乘区 / 作用范围 / 门槛条件 / 全局状态）+ 文件夹树（新建/删除/改名/位置/顺序）。
 */
export const diffBuffConfig = (before: CalcState, after: CalcState): UnsavedChangeItem[] => {
    const items: UnsavedChangeItem[] = []
    const beforeMap = new Map(before.buffSets.map((buff) => [buff.id, buff]))
    const afterMap = new Map(after.buffSets.map((buff) => [buff.id, buff]))

    for (const buff of after.buffSets) {
        const prev = beforeMap.get(buff.id)
        if (!prev) {
            items.push({
                key: `buff-create:${buff.id}`,
                title: leafOf(buff.name),
                subtitle: '新建 BUFF',
                tone: 'create',
                lines: [
                    `作用范围：${scopeTextOf(buff.scope)}`,
                    buff.zones.length > 0 ? `乘区：${buff.zones.length} 条` : '乘区：还没有'
                ]
            })
            continue
        }
        const lines: string[] = []
        if (prev.name !== buff.name) lines.push(`名称：${leafOf(prev.name)} → ${leafOf(buff.name)}`)
        if (!same(prev.scope, buff.scope)) {
            lines.push(`作用范围：${scopeTextOf(prev.scope)} → ${scopeTextOf(buff.scope)}`)
        }
        lines.push(...zoneChangeLines(prev.zones, buff.zones))
        if (!same(prev.rules, buff.rules)) {
            lines.push(`门槛条件：${rulesTextOf(prev.rules)} → ${rulesTextOf(buff.rules)}`)
        }
        if (!!prev.global !== !!buff.global) lines.push(buff.global ? '已并入全局' : '已移出全局')
        if (lines.length > 0) {
            items.push({
                key: `buff-update:${buff.id}`,
                title: leafOf(buff.name),
                subtitle: '修改 BUFF',
                tone: 'update',
                lines
            })
        }
    }

    for (const buff of before.buffSets) {
        if (afterMap.has(buff.id)) continue
        items.push({
            key: `buff-delete:${buff.id}`,
            title: leafOf(buff.name),
            subtitle: '删除 BUFF',
            tone: 'remove',
            lines: []
        })
    }

    const nameOf = (buffId: string): string =>
        leafOf(afterMap.get(buffId)?.name ?? beforeMap.get(buffId)?.name ?? buffId)
    items.push(...diffBuffTree(before.buffTree, after.buffTree, nameOf))
    return items
}

// ── 伤害类型 ──

/** @desc 伤害类型编辑弹窗的比对入参：一条倍率的当前伤害类型（空数组 = 走自动推导） */
export interface DamageTypeEntrySnapshot {
    id: string
    name: string
    character: string
    types: string[]
}

/** @desc 归一化伤害类型集合（顺序无关） */
const typeKeyOf = (types: readonly string[]): string => [...types].sort().join('|')

/** @desc 伤害类型文案：空 = 自动推导 */
const typesText = (types: readonly string[]): string => (types.length === 0 ? '自动推导' : types.join(' / '))

/** @desc 伤害类型改动清单（伤害类型编辑弹窗「关闭前确认」用） */
export const diffDamageTypes = (
    before: readonly DamageTypeEntrySnapshot[],
    after: readonly DamageTypeEntrySnapshot[]
): UnsavedChangeItem[] => {
    const beforeMap = new Map(before.map((entry) => [entry.id, entry]))
    return after.flatMap((entry) => {
        const prev = beforeMap.get(entry.id)
        if (!prev || typeKeyOf(prev.types) === typeKeyOf(entry.types)) return []
        return [
            {
                key: `damage-type:${entry.id}`,
                title: entry.name,
                subtitle: entry.character,
                tone: 'update' as const,
                lines: [`伤害类型：${typesText(prev.types)} → ${typesText(entry.types)}`]
            }
        ]
    })
}
