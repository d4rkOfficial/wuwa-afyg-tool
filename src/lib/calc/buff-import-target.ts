import type { BuffConf, BuffRule } from './calculation.types'
import type { CharSlot } from '$lib/types/project'
import { buffFolderPath, buffLeafName, joinBuffPath } from './buff-name'
import {
    characterEchoFolderName,
    characterSetFolderName,
    characterWeaponFolderName,
    coarsePathOf
} from './buff-tree-state'
import { normalizeRules, rulesFromLegacyCondition, type LegacyGateCondition } from './rules'
import { rewriteOwnerInRules } from './buff-owner'

/** @desc 导入实体的来源类型：角色 / 武器 / 首位声骸 / 套装件数 */
export type ImportOriginType = 'character' | 'weapon' | 'echo' | '1set' | '2set' | '3set' | '4set' | '5set'

/** @desc 导入来源（本地 Buff 库实体）：只用于决定文件夹归属，不参与条件判定 */
export interface ImportOrigin {
    entityType: ImportOriginType
    entityName: string
}

export interface ResolvedImportTarget {
    /** @desc 工坊/本地库里的最后一段短名 */
    leaf: string
    /** @desc 来源一级文件夹（没有则为 null；导入工程时保留为归属文件夹之内的一层） */
    sourceFolder: string | null
    /** @desc 按最终规则算出的工程条件文件夹 */
    conditionFolder: string | null
    /** @desc 按实体来源算出的归属文件夹；角色本体 / 链时沿用条件文件夹 */
    originFolder: string | null
    /** @desc 工程内最终全名：归属文件夹\来源文件夹\短名 */
    fullName: string
    /** @desc 重指归属后的 Buff 级规则（与最终写入一致） */
    rules: BuffRule[] | undefined
}

/** @desc 套装件数：`2set` → 2；非套装返回 null */
const setPiecesOf = (entityType: ImportOriginType): number | null => {
    const match = /^([1-5])set$/.exec(entityType)
    return match ? Number(match[1]) : null
}

/**
 * @desc 实体来源 → 角色归属文件夹。
 *
 * - 角色本体 / 链：由**最终条件**决定（`角色-本体` / `角色-x链`），这里返回 null 走条件文件夹；
 * - 首位声骸：`角色-声骸名`；
 * - 套装：`角色-套装名-x件`；
 * - 武器：`角色-武器名`。
 *
 * 注意：声骸 / 套装 Buff 的**生效条件仍是角色本体门**（0 链），文件夹只改归档位置，不改判定。
 */
export const originFolderOf = (character: string | null, origin: ImportOrigin | undefined): string | null => {
    if (!character || !origin) return null
    const pieces = setPiecesOf(origin.entityType)
    if (pieces !== null) return characterSetFolderName(character, origin.entityName, pieces)
    if (origin.entityType === 'echo') return characterEchoFolderName(character, origin.entityName)
    if (origin.entityType === 'weapon') return characterWeaponFolderName(character, origin.entityName)
    return null
}

/**
 * @desc 导入到工程时的唯一落点解析：
 * 1. 先把旧链/阶条件升级为规则，并把角色归属重指到真实主人；
 * 2. 归属存在且没有任何链/阶规则时补一道 0 链「本体门」（`≥ 0 链` 恒成立）；
 * 3. 用**最终规则**算条件文件夹；
 * 4. 实体来源另有归属文件夹（声骸 / 套装 / 武器），优先用它；
 * 5. 工坊来源文件夹放在归属文件夹之内，短名放最后。
 *
 * 这样冲突检测（`toImportItem`）与真正落库（store）使用同一套名字，
 * 不会出现“按 0 号位检测、按 1 号位写入”的错位。
 */
export const resolveImportTarget = (
    name: string,
    condition: LegacyGateCondition | undefined,
    owner: number,
    team: readonly CharSlot[],
    origin?: ImportOrigin,
    explicitRules?: BuffRule[]
): ResolvedImportTarget => {
    const leaf = buffLeafName(name) || '未命名BUFF块'
    const rawSourceFolder = buffFolderPath(name)[0] ?? null
    const legacyRules = rulesFromLegacyCondition(condition, owner >= 0 ? owner : 0)
    const reowned = rewriteOwnerInRules(normalizeRules(explicitRules) ?? legacyRules, owner)
    const finalRules = withOwnerBodyGate(reowned, owner)
    const coarse = coarsePathOf(
        {
            id: '',
            name: leaf,
            zones: [],
            scope: 'all',
            ...(finalRules ? { rules: finalRules } : {})
        } as BuffConf,
        team
    )
    const character = owner >= 0 ? (team[owner]?.character ?? null) : null
    const originFolder = originFolderOf(character, origin)
    /** @desc 来源文件夹与实体同名时不再多套一层（如 `声骸X\声骸X\短名`） */
    const sourceFolder = origin?.entityName && rawSourceFolder === origin.entityName ? null : rawSourceFolder
    const folder = originFolder ?? coarse.folder
    return {
        leaf,
        sourceFolder,
        conditionFolder: coarse.folder,
        originFolder,
        fullName: joinBuffPath(folder, sourceFolder, leaf),
        rules: finalRules
    }
}

/**
 * @desc 给「归属于某个角色、但自身没有任何链/阶规则」的 Buff 补一道**角色本体门**（`chain min = 0`）。
 *
 * 为什么是链而不是阶：「本体」这个概念属于**链行** —— 链 = 角色共鸣链，0 链即角色本体；
 * 阶 = 武器精炼阶数，武器总有一个精炼档位（默认 1 阶），不存在「本体」档。
 * 因此导入角色来源的 buff 时补 0 链，既保留「挂在哪个角色身上」的归属（左侧列表归档到「角色名-本体」），
 * 又不会因为档位把本体效果挡掉（`≥ 0 链` 恒成立）。
 */
export const withOwnerBodyGate = (rules: BuffRule[] | undefined, owner: number): BuffRule[] | undefined => {
    if (owner < 0) return rules
    if ((rules ?? []).some((rule) => rule.kind === 'chain' || rule.kind === 'refinement')) return rules
    return [...(rules ?? []), { kind: 'chain', charIdx: owner, min: 0 }]
}
