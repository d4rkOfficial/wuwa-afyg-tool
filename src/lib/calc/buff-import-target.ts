import type { BuffCondition, BuffConf } from './calculation.types'
import type { CharSlot } from '$lib/types/project'
import { buffFolderPath, buffLeafName, joinBuffPath } from './buff-name'
import { coarsePathOf } from './buff-tree-state'
import { normalizeCondition, withOwnerBodyGate } from './condition'
import { rewriteOwnerInCondition } from './buff-owner'

export interface ResolvedImportTarget {
    /** @desc 工坊/本地库里的最后一段短名 */
    leaf: string
    /** @desc 来源一级文件夹（没有则为 null；导入工程时保留为条件文件夹之内的一层） */
    sourceFolder: string | null
    /** @desc 按最终条件算出的工程条件文件夹 */
    conditionFolder: string | null
    /** @desc 工程内最终全名：条件文件夹\来源文件夹\短名 */
    fullName: string
    /** @desc 重指归属并补本体门后的条件（与最终写入一致） */
    condition: BuffCondition
}

/**
 * @desc 导入到工程时的唯一落点解析：
 * 1. 先按真实主人重指链/阶条件；
 * 2. 再补 owner 的 0 链本体门；
 * 3. 用**最终条件**算条件文件夹；
 * 4. 工坊来源文件夹放在条件文件夹之内，短名放最后。
 *
 * 这样冲突检测（`toImportItem`）与真正落库（store）使用同一套名字，
 * 不会出现“按 0 号位检测、按 1 号位写入”的错位。
 */
export const resolveImportTarget = (
    name: string,
    condition: BuffCondition | undefined,
    owner: number,
    team: readonly CharSlot[]
): ResolvedImportTarget => {
    const leaf = buffLeafName(name) || '未命名BUFF块'
    const sourceFolder = buffFolderPath(name)[0] ?? null
    const reowned = rewriteOwnerInCondition(condition, owner)
    const finalCondition = withOwnerBodyGate(normalizeCondition(reowned, 'buff', owner), owner)
    const coarse = coarsePathOf(
        {
            id: '',
            name: leaf,
            zones: [],
            scope: 'all',
            condition: finalCondition,
            conditionRefCharIdx: owner
        } as BuffConf,
        team
    )
    return {
        leaf,
        sourceFolder,
        conditionFolder: coarse.folder,
        fullName: joinBuffPath(coarse.folder, sourceFolder, leaf),
        condition: finalCondition
    }
}
