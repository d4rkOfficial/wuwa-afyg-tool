/**
 * @desc Buff 文件夹命名迁移：旧「角色名本体 / 角色名2链 / 角色名的武器」→ 新短横线命名，
 * 并把旧导入混在角色本体里的声骸 / 套装 / 武器 Buff 按实体归档。
 */

import type { BuffInstance, BuffTreeNode, BuffTreeState, CalcState } from '$lib/calc/calculation.types'
import { BUFF_PATH_SEP, joinBuffPath, splitBuffPath } from '$lib/calc/buff-name'
import {
    characterBodyFolderName,
    characterChainFolderName,
    characterEchoFolderName,
    characterSetFolderName,
    characterWeaponFolderName,
    normalizeBuffTree
} from '$lib/calc/buff-tree-state'
import type { CharSlot } from '$lib/types/project'

// ── Buff 文件夹命名迁移：旧「角色名本体 / 角色名2链 / 角色名的武器」→ 新「角色名-本体 / 角色名-2链 / 角色名-武器名」──

/** @desc 角色本体文件夹的归属角色；新旧命名都认（`甲-本体` / `甲本体`） */
const bodyCharacterOf = (folder: string): string | null => {
    if (folder.endsWith('-本体')) return folder.slice(0, -3)
    if (!folder.endsWith('本体')) return null
    const character = folder.slice(0, -2)
    return character && !character.endsWith('-') ? character : null
}

/** @desc 该角色当前配装里与文件夹同名的实体 → 新归属文件夹（武器 / 首位声骸 / 套装） */
const equipmentFolderOf = (character: string, folder: string, team: readonly CharSlot[]): string | null => {
    const slot = team.find((item) => item.character === character)
    if (!slot) return null
    if (slot.weapon && slot.weapon === folder) return characterWeaponFolderName(character, folder)
    const echo = slot.echoes?.[0]?.name
    if (echo && echo === folder) return characterEchoFolderName(character, folder)
    const set = slot.triggerSets?.find((item) => item.name === folder)
    if (set) return characterSetFolderName(character, folder, set.pieces)
    return null
}

/**
 * @desc 旧一级文件夹名 → 新命名。只重命名属于当前队伍角色的文件夹：
 * - `角色名本体` → `角色名-本体`
 * - `角色名2链` → `角色名-2链`
 * - `角色名的武器名` → `角色名-武器名`
 * 已是新命名 / 非角色文件夹原样返回。
 */
const renameLegacyFolder = (folder: string, team: readonly CharSlot[]): string => {
    if (folder.endsWith('-本体') || /^.+-(\d+)链$/.test(folder)) return folder
    const body = /^(.+)本体$/.exec(folder)
    if (body && team.some((slot) => slot.character === body[1])) return characterBodyFolderName(body[1])
    const chain = /^(.+?)(\d+)链$/.exec(folder)
    if (chain && team.some((slot) => slot.character === chain[1])) {
        return characterChainFolderName(chain[1], Number(chain[2]))
    }
    const weapon = /^(.+)的(.+)$/.exec(folder)
    if (weapon && team.some((slot) => slot.character === weapon[1])) {
        return characterWeaponFolderName(weapon[1], weapon[2])
    }
    return folder
}

/**
 * @desc 迁移单条 Buff 全名：
 * 1. 一级文件夹按新命名重写（本体 / 链 / 旧武器文件夹）；
 * 2. 旧导入落在 `角色本体\声骸/套装/武器名\短名` 下的，按当前配装移到 `角色名-实体名[\x件]`，
 *    并丢掉与实体同名的来源文件夹（条件不动，仍是角色本体门 / 原阶条件）。
 */
const migrateBuffFolderName = (name: string, team: readonly CharSlot[]): string => {
    const parts = splitBuffPath(name)
    if (parts.length < 2) return name
    const [folder, ...rest] = parts
    const character = bodyCharacterOf(folder)
    if (character && rest.length >= 2) {
        const origin = equipmentFolderOf(character, rest[0], team)
        if (origin) return joinBuffPath(origin, ...rest.slice(1))
    }
    return [renameLegacyFolder(folder, team), ...rest].join(BUFF_PATH_SEP)
}

/** @desc 改名后的 Buff 实际用到的文件夹路径（用于判断迁移后的空文件夹是否该删） */
const usedFolderPathsOf = (buffs: readonly BuffInstance[]): Record<'global' | 'nonGlobal', Set<string>> => {
    const used = { global: new Set<string>(), nonGlobal: new Set<string>() }
    for (const buff of buffs) {
        const tab = buff.global ? 'global' : 'nonGlobal'
        const parts = splitBuffPath(buff.name)
        for (let depth = 1; depth < parts.length; depth++) {
            used[tab].add(parts.slice(0, depth).join(BUFF_PATH_SEP))
        }
    }
    return used
}

/**
 * @desc 显式树随 Buff 全名一起迁移，保留原有文件夹顺序：
 * - 旧文件夹改名（本体 / 链 / 武器）；
 * - `角色本体\声骸名` 这类来源文件夹在 Buff 被移走后整棵删除；
 * - 迁走的 Buff 节点由 `normalizeBuffTree` 按新全名重新挂载，并补出新归属文件夹。
 */
const migrateBuffTreeFolderNames = (
    tree: BuffTreeState | undefined,
    buffs: readonly BuffInstance[],
    team: readonly CharSlot[]
): BuffTreeState => {
    const used = usedFolderPathsOf(buffs)
    const migrateNodes = (
        nodes: readonly BuffTreeNode[],
        tab: 'global' | 'nonGlobal',
        parentOld: string[],
        parentNew: string[],
        migratedAncestor: boolean
    ): BuffTreeNode[] => {
        const out: BuffTreeNode[] = []
        for (const node of nodes) {
            if (node.kind === 'buff') {
                out.push(node)
                continue
            }
            const oldPath = [...parentOld, node.name]
            let newPath: string[] | null = [...parentNew, node.name]
            let migrated = migratedAncestor
            if (parentOld.length === 0) {
                const renamed = renameLegacyFolder(node.name, team)
                if (renamed !== node.name) {
                    newPath = [renamed]
                    migrated = true
                }
            } else {
                const character = bodyCharacterOf(parentOld[0])
                if (character && equipmentFolderOf(character, node.name, team)) {
                    // 来源文件夹：其下 Buff 已移到 `角色名-实体名`，整棵丢弃
                    newPath = null
                    migrated = true
                }
            }
            if (newPath === null) continue
            const children = migrateNodes(node.children, tab, oldPath, newPath, migrated)
            const usedHere = used[tab].has(newPath.join(BUFF_PATH_SEP))
            // 迁移过的文件夹若已无用途就删掉；本来就空的自定义文件夹保留
            if (migrated && !usedHere && children.length === 0) continue
            out.push({ ...node, name: newPath[newPath.length - 1], children })
        }
        return out
    }
    return {
        global: migrateNodes(tree?.global ?? [], 'global', [], [], false),
        nonGlobal: migrateNodes(tree?.nonGlobal ?? [], 'nonGlobal', [], [], false)
    }
}

/**
 * @desc v5 → v6 的 Buff 文件夹命名迁移：v5 文件夹 → `角色名-本体 / 角色名-x链 / 角色名-武器名`，
 * 并把混在角色本体里的声骸 / 套装 / 武器 Buff 归到 `角色名-实体名[-x件]`。
 *
 * 只由 `migrateV5toV6` 调用（与版本绑定）；函数本身幂等，重复调用同一份数据不会变化。
 */
export const migrateBuffFolderNaming = (calc: CalcState, team: readonly CharSlot[]): CalcState => {
    const buffs = calc.buffSets.map((buff) => {
        const name = migrateBuffFolderName(buff.name, team)
        return name === buff.name ? buff : { ...buff, name }
    })
    if (buffs.every((buff, index) => buff === calc.buffSets[index])) return calc
    const tree = migrateBuffTreeFolderNames(calc.buffTree, buffs, team)
    return {
        ...calc,
        buffSets: buffs,
        buffTree: normalizeBuffTree(
            tree,
            buffs,
            buffs.filter((buff) => buff.global).map((buff) => buff.id)
        )
    }
}
