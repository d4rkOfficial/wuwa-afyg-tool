/**
 * @desc Buff 归属重指纯函数：把一份 buff 的链/阶条件与引用归属，落到「该实体在当前配队里真正的主人槽位」。
 *
 * 背景（曾经的 bug）：工坊落库与 AI 生成结果里的链/阶条件 `charIdx` 一律是 0
 * （share 迁移与 `sanitizeCondition` 的默认值），而导入时不做重指，于是
 * **任何人的链 buff 都进 1 号位的链、任何人的阶 buff 都进 1 号位的武器**。
 *
 * 之所以单独成文件：`calculation.store`（写）与 `buff-import-utils`（检测）都要用它，
 * 放在任一侧都会造成 store ↔ utils 的循环依赖。
 */

import type { BuffCondition, BuffZoneValue } from './calculation.types'
import type { CharSlot } from '$lib/types/project'

/** @desc 定位实体归属的角色槽位（0/1/2）：character 按实体名匹配；武器/声骸/套装找配装里用它的角色（可能多人共用） */
export function ownerIdxFor(
    team: [CharSlot, CharSlot, CharSlot] | undefined,
    entity: { entityType: string; entityName: string }
): number[] {
    if (!team) return []
    if (entity.entityType === 'character') {
        const idx = team.findIndex((s) => s?.character === entity.entityName)
        return idx >= 0 ? [idx] : []
    }
    const idxs: number[] = []
    team.forEach((s, i) => {
        if (!s) return
        if (s.weapon === entity.entityName) return idxs.push(i)
        if (s.echoes?.some((ec) => ec.name === entity.entityName)) return idxs.push(i)
        if (s.triggerSets?.some((ts) => ts.name === entity.entityName && `${ts.pieces}set` === entity.entityType))
            idxs.push(i)
    })
    return idxs
}

/** @desc 当前配队里优先归属的槽位（取最靠前的主人；无主人返回 -1） */
export const primaryOwnerOf = (
    team: [CharSlot, CharSlot, CharSlot] | undefined,
    entity: { entityType: string; entityName: string }
): number => ownerIdxFor(team, entity)[0] ?? -1

/** @desc 一条导入项最终要落的归属槽位；-1 = 该实体不在当前配队里（此时链/阶条件会被丢弃） */
export const ownerIdxOfItem = (item: { ownerIdx?: number }, fallback = -1): number => item.ownerIdx ?? fallback

/**
 * @desc 把条件里的角色归属重指到目标槽位。
 * - `target < 0`（该实体不在配队里）→ **丢弃**链/阶条件，避免显示成某个角色的门槛；
 * - 否则 chains / refinements 以及旧单值 `chain` / `refinement` 的归属全部改成 target。
 */
export const rewriteOwnerInCondition = (
    condition: BuffCondition | undefined,
    target: number
): BuffCondition | undefined => {
    if (!condition) return condition
    const next: BuffCondition = { ...condition }
    if (target < 0) {
        delete next.chains
        delete next.refinements
        delete next.chain
        delete next.refinement
        return next
    }
    if (next.chains?.length) next.chains = next.chains.map((c) => ({ ...c, charIdx: target }))
    if (next.refinements?.length) next.refinements = next.refinements.map((c) => ({ ...c, charIdx: target }))
    return next
}

/** @desc 把乘区条目里的引用归属重指到目标槽位；target < 0 时保持原样（由引擎按无归属处理） */
export const rewriteOwnerInZones = (zones: readonly BuffZoneValue[], target: number): BuffZoneValue[] =>
    zones.map((z) => (z.ref && target >= 0 ? { ...z, ref: { ...z.ref, characterIdx: target } } : { ...z }))
