/** @desc 结果聚合的纯函数部分：按角色汇总伤害与占比，便于单测且不依赖 store */
export interface DamageTotalRow {
    character: string
    totalDamage: number
}

export interface CharacterDamageTotal {
    character: string
    totalDamage: number
    entryCount: number
    /** @desc 占过滤后总伤害的比例（0-1） */
    share: number
    /** @desc 百分比数值，保留两位小数 */
    sharePct: number
}

export const summarizeDamageByCharacter = <T extends DamageTotalRow>(
    rows: readonly T[],
    character = ''
): { filtered: T[]; total: number; characters: CharacterDamageTotal[] } => {
    const filtered = character ? rows.filter((e) => e.character === character) : [...rows]
    const total = filtered.reduce((sum, e) => sum + (e.totalDamage ?? 0), 0)
    const byCharacter = new Map<string, { character: string; totalDamage: number; entryCount: number }>()
    for (const e of filtered) {
        const cur = byCharacter.get(e.character) ?? { character: e.character, totalDamage: 0, entryCount: 0 }
        cur.totalDamage += e.totalDamage ?? 0
        cur.entryCount++
        byCharacter.set(e.character, cur)
    }
    const characters = [...byCharacter.values()]
        .sort((a, b) => b.totalDamage - a.totalDamage)
        .map((c) => ({
            ...c,
            share: total > 0 ? c.totalDamage / total : 0,
            sharePct: total > 0 ? Number(((c.totalDamage / total) * 100).toFixed(2)) : 0
        }))
    return { filtered, total, characters }
}
