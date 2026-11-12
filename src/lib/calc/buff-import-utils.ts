// Buff 导入纯函数（手动导入弹窗 / AI 工具共用）：构造带 ownerIdx 的导入条目 + 冲突检测
// 归属重指（ownerIdxFor / rewriteOwnerIn*）在 buff-owner.ts：那是 store 与本文件共用的逻辑，
// 放这里会形成 store ↔ utils 循环依赖，故再导出一次保持既有导入路径可用。
import type { BuffLibraryEntity, BuffLibraryBuff, BuffLibraryScope } from '$lib/data/buff-library.svelte'
import type { CharSlot } from '$lib/types/project'
import type { ImportBuffInput } from './calculation.store.svelte'
import type { BuffRule } from './calculation.types'
import type { LegacyGateCondition } from './rules'
import { ownerIdxFor, ownerIdxOfItem } from './buff-owner'
import { resolveImportTarget, type ImportOrigin } from './buff-import-target'

export type { BuffLibraryEntity }
export { ownerIdxFor, ownerIdxOfItem, primaryOwnerOf, rewriteOwnerInRules, rewriteOwnerInZones } from './buff-owner'

export function toImportItem(
    b: {
        name: string
        scope?: BuffLibraryScope
        condition?: LegacyGateCondition
        rules?: BuffRule[]
        zones: ImportBuffInput['zones']
    },
    ownerIdx: number,
    team?: [CharSlot, CharSlot, CharSlot],
    origin?: ImportOrigin
): ImportBuffInput {
    const target = resolveImportTarget(b.name, b.condition, ownerIdx, team ?? [], origin, b.rules)
    return {
        name: b.name,
        targetName: target.fullName,
        scope: b.scope,
        ownerIdx,
        ...(target.rules ? { rules: target.rules } : {}),
        // 乘区条目（含乘区级生效条件 condition）原样带入，导入时不丢条件
        zones: b.zones
    }
}

/**
 * @desc 实体全部 Buff → 导入条目：多主人时 self（主人专属）按每个主人生成独立条目，其它 scope 单条（引用第一主人）。
 * 每条都带上**该实体在当前配队里的真实归属槽位**，供导入时重指链阶规则与引用。
 */
export function buildEntityImportItems(
    entity: BuffLibraryEntity,
    team: [CharSlot, CharSlot, CharSlot] | undefined
): ImportBuffInput[] {
    return buildBuffImportItems(entity, entity.buffs, team)
}

/** @desc 精细导入：只取实体中被勾选的 Buff，其余归属重指口径与整实体导入一致 */
export function buildBuffImportItems(
    entity: BuffLibraryEntity,
    buffs: readonly BuffLibraryBuff[],
    team: [CharSlot, CharSlot, CharSlot] | undefined
): ImportBuffInput[] {
    const owners = ownerIdxFor(team, entity)
    const firstOwner = owners[0] ?? -1
    /** @desc 实体来源决定归属文件夹（声骸 / 套装 / 武器）；规则仍按角色本体门走 */
    const origin: ImportOrigin = { entityType: entity.entityType, entityName: entity.entityName }
    const asSource = (b: BuffLibraryBuff) => ({
        name: b.buffName,
        scope: b.scope,
        ...(b.condition ? { condition: b.condition } : {}),
        ...(b.rules ? { rules: b.rules } : {}),
        zones: b.zones
    })
    if (owners.length > 1) {
        const selfItems = owners.flatMap((owner) =>
            buffs.filter((b) => b.scope === 'self').map((b) => toImportItem(asSource(b), owner, team, origin))
        )
        const otherItems = buffs
            .filter((b) => b.scope !== 'self')
            .map((b) => toImportItem(asSource(b), firstOwner, team, origin))
        return [...selfItems, ...otherItems]
    }
    return buffs.map((b: BuffLibraryBuff) => toImportItem(asSource(b), firstOwner, team, origin))
}

// ── 冲突检测：同名（内容不同）与完全一致 ────────────────────────────────────

/** @desc 导入批次内去重：同目标全名 + 同归属槽位视为重复（多主人时同名不同槽位保留） */
export function dedupeImportItems(items: readonly ImportBuffInput[]): ImportBuffInput[] {
    const seen = new Set<string>()
    const out: ImportBuffInput[] = []
    for (const item of items) {
        const name = (item.targetName ?? item.name).trim()
        if (!name) continue
        const key = `${name}\u0000${ownerIdxOfItem(item)}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(item)
    }
    return out
}
