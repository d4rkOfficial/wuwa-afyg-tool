// ── 列表分组（词条集 / Buff 集共用） ───────────────────────────────────────
// 归类口径：角色按属性、武器按武器类型、声骸按 cost、套装按套件数；组内五星在前，
// 同一属性里「漂泊者」永远排第一位（上游名可能不带属性后缀）。

/** @desc 按给定顺序分组：顺序表里没出现的键排在最后（保持发现顺序） */
export const groupInOrder = <T>(
    items: T[],
    keyOf: (item: T) => string,
    order: readonly string[],
    otherLabel = '其它'
): { key: string; items: T[] }[] => {
    const buckets = new Map<string, T[]>()
    for (const item of items) {
        const key = keyOf(item) || otherLabel
        const list = buckets.get(key)
        if (list) list.push(item)
        else buckets.set(key, [item])
    }
    const ordered = order.filter((key) => buckets.has(key))
    const rest = [...buckets.keys()].filter((key) => !order.includes(key))
    return [...ordered, ...rest].map((key) => ({ key, items: buckets.get(key) ?? [] }))
}

/** @desc 组内排序：漂泊者优先 → 星级降序 → 名称（拼音） */
export const compareRoverStarName = (
    a: { name: string; star?: number },
    b: { name: string; star?: number }
): number => {
    const roverRank = (name: string) => (name.startsWith('漂泊者') ? 0 : 1)
    return (
        roverRank(a.name) - roverRank(b.name) ||
        (b.star ?? 0) - (a.star ?? 0) ||
        a.name.localeCompare(b.name, 'zh-Hans-CN')
    )
}

/** @desc 组内排序的可复用比较器（按名称升序，用于 cost / 套件数这类没有星级的维度） */
export const compareByName = (a: { name: string }, b: { name: string }): number =>
    a.name.localeCompare(b.name, 'zh-Hans-CN')
