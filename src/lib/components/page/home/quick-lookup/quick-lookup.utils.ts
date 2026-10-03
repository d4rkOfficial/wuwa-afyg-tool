/**
 * @desc 速查面板的**纯**数据/格式化函数（无副作用、不读组件状态）。
 *
 * 抽因（AGENTS §1「复杂功能里的无副作用成分必须拆」）：这些逻辑原本内联在
 * `quick-lookup-content.svelte` 里 —— 其中 `mergeTriggerSets` 与 `compareStatAttrs`
 * 都有非平凡的分支/数值解析，内联时无法单测（该组件依赖 `{@html}` 与整套 DOM 滚动容器，
 * 起不了 SSR 断言）。抽到这里后可脱离组件测。
 */

/** @desc 触发套装合并后的一项：同名套装的多个件数段合并到一条 */
export interface MergedTriggerSet {
    name: string
    pieces: number[]
    bonuses: Record<string, string>
}

/**
 * @desc 把「同名多件数」的触发套装合并成一项，并丢掉**没有任何加成**的套装。
 *
 * 为什么需要合并：`slot.triggerSets` 里选 5 件套时会**刻意**写成两条
 * （`{name,5}` + `{name,2}`，见 `set-picker` 的 `togglePiece`），若不去重会出现
 * 两张同名卡片。合并后 `pieces` 保留全部件数段（模板里用它过滤 `bonuses` 的 key）。
 *
 * @param sets 当前槽位的触发套装（含重复 name）
 * @param bonusOf 取某个套装名对应加成的回调（调用方已并行取好，按 index 对齐）
 */
export const mergeTriggerSets = (
    sets: readonly { name: string; pieces: number }[],
    bonusOf: (index: number) => Record<string, string>
): MergedTriggerSet[] => {
    const merged = new Map<string, MergedTriggerSet>()
    for (let i = 0; i < sets.length; i++) {
        const s = sets[i]
        const ex = merged.get(s.name)
        if (ex) {
            ex.pieces.push(s.pieces)
        } else {
            merged.set(s.name, { name: s.name, pieces: [s.pieces], bonuses: bonusOf(i) })
        }
    }
    return [...merged.values()].filter((s) => Object.keys(s.bonuses).length > 0)
}

/**
 * @desc 固有属性/固有技能节点的**渲染键**：`name` + `desc` 的组合（去重后组内唯一）。
 *
 * 为什么不能只用 `name`（**实测踩过，速查页卡在「加载中...」的真因**）：
 * `compareStatAttrs` 的注释早就写明「同名时按 desc 里的首个数字排序」，即这些节点**天然会同名**。
 * 拿上游真源采样（nanoka `ww/3.7`，全部 64 个角色）：每个角色的 `node_type=4` 节点都成对重复 ——
 * 如散华 4× 「攻击提升」（1.80% ×2 + 4.20% ×2）+ 4× 「冷凝伤害加成提升」（同）；
 * 于是 `{#each sortedStatAttrs as attr (attr.name)}` 一进详情就抛 `each_key_duplicate`，
 * 整个渲染更新被中断，DOM 停在上一帧的「加载中...」。
 * 注意 `name+desc` 在**未去重**时同样会重复（那两对是完全相同的节点），故必须先过 `dedupeStatNodes`。
 */
export const statNodeKey = (node: { name: string; desc?: string }): string => `${node.name}\u0000${node.desc ?? ''}`

/**
 * @desc 丢掉 `name + desc` **完全相同**的节点（保留首次出现）。
 *
 * 依据（上游真源采样，nanoka `ww/3.7` 全部 64 角色）：`node_type=4` 的固有属性节点成对重复，
 * 不去重会把同数值的卡片渲染两遍；去重后 `statNodeKey` 必然唯一 —— 这正是它能作 `{#each}` key 的前提。
 * 同名的**不同数值**节点（1.80% / 4.20%）会全部保留。
 */
export const dedupeStatNodes = <T extends { name: string; desc?: string }>(nodes: readonly T[]): T[] => {
    const seen = new Set<string>()
    const out: T[] = []
    for (const node of nodes) {
        const key = statNodeKey(node)
        if (seen.has(key)) continue
        seen.add(key)
        out.push(node)
    }
    return out
}

/**
 * @desc 固有属性的排序：先按名称字典序，同名时按描述里的**首个数字**升序。
 *
 * 抽因：这是模板里 `sortedStatAttrs` 的比较器，含两处非平凡点 ——
 * ① 先按 `name` 排；② 名称相同时从 `desc` 里 parse 第一个数字（可能缺失 → 视作 0）。
 * 内联时完全无法单测，而它决定了属性列表的展示顺序。
 */
export const compareStatAttrs = (a: { name: string; desc?: string }, b: { name: string; desc?: string }): number => {
    if (a.name < b.name) return -1
    if (a.name > b.name) return 1
    const numOf = (s?: string) => parseFloat(s?.match(/[\d.]+/)?.[0] ?? '0')
    return numOf(a.desc) - numOf(b.desc)
}

/**
 * @desc 副属性数值展示格式化：**小于 1 的数值按小数当比例**转成百分比，其余原样返回。
 * 例：`'0.12'` → `'12.0%'`；`'12'` → `'12'`；非数字 → 原样返回。
 */
export const formatSubstatValue = (v: string): string => {
    const n = parseFloat(v)
    if (isNaN(n) || n >= 1) return v
    return `${(n * 100).toFixed(1)}%`
}
