// Buff 导入纯函数（手动导入弹窗 / AI 工具共用）：定位实体归属槽位 + 构造带 ownerIdx 的导入条目
import type { BuffLibraryEntity, BuffLibraryBuff, BuffLibraryScope } from '$lib/data/buff-library.svelte'
import type { CharSlot } from '$lib/types/project'
import type { ImportBuffInput } from './calculation.store.svelte'
import type { BuffCondition } from './calculation.types'

export type { BuffLibraryEntity }

// 定位实体归属的角色槽位：character 直接按实体名匹配；武器/声骸/套装找配装中对应的角色（可能多人共用）
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

export function toImportItem(
    b: { name: string; scope?: BuffLibraryScope; condition?: BuffCondition; zones: ImportBuffInput['zones'] },
    ownerIdx: number
): ImportBuffInput {
    return {
        name: b.name,
        scope: b.scope,
        ownerIdx,
        ...(b.condition ? { condition: b.condition } : {}),
        zones: b.zones
    }
}

// 实体全部 Buff → 导入条目：多主人时 self（主人专属）按每个主人生成独立条目，其它 scope 单条（引用第一主人）
export function buildEntityImportItems(
    entity: BuffLibraryEntity,
    team: [CharSlot, CharSlot, CharSlot] | undefined
): ImportBuffInput[] {
    const owners = ownerIdxFor(team, entity)
    const firstOwner = owners[0] ?? -1
    if (owners.length > 1) {
        const selfItems = owners.flatMap((owner) =>
            entity.buffs
                .filter((b) => b.scope === 'self')
                .map((b) =>
                    toImportItem({ name: b.buffName, scope: b.scope, condition: b.condition, zones: b.zones }, owner)
                )
        )
        const otherItems = entity.buffs
            .filter((b) => b.scope !== 'self')
            .map((b) =>
                toImportItem({ name: b.buffName, scope: b.scope, condition: b.condition, zones: b.zones }, firstOwner)
            )
        return [...selfItems, ...otherItems]
    }
    return entity.buffs.map((b: BuffLibraryBuff) =>
        toImportItem({ name: b.buffName, scope: b.scope, condition: b.condition, zones: b.zones }, firstOwner)
    )
}
