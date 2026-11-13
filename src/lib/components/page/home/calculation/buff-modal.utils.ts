/**
 * `buff-modal.svelte` 的纯逻辑层（**不 import 任何 store**，需要 store 能力的部分由调用方注入）：
 * 数据变换、查表、格式化、默认值构造、拖拽状态装配。
 *
 * 放置约定与同目录 `spread-table.utils.ts` 一致：
 * 纯函数住同目录 `*.utils.ts`，落进 ESLint 的「纯逻辑层」享受函数式约束。
 */
import { ZONE_REF_DEFS, ZONE_REF_MAP, ZONE_MAP, classifyBuffScope, groupBuffSets } from '$lib/calc/calculation.consts'
import type { GroupedBuffConfItem, ZoneId } from '$lib/calc/calculation.consts'
import type { BuffTreeNode } from '$lib/calc/buff-tree'
import type { BuffConf, ZoneRef } from '$lib/calc/calculation.types'
import type { CharSlot } from '$lib/types/project'

/** @desc 右栏「添加乘区」清单的固定宽度（不再支持拖拽调宽） */
export const ZONE_BAR_WIDTH = 208

// ── 数字/百分比换算 ──

/** @desc 最大公约数（用于把百分比化简为分数） */
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** @desc 把百分比 pct 化简为 除数/乘数 分数形式（如 12% → ÷100×12） */
export const simplifyPct = (pct: number): { divisor: number; multiplier: number } => {
    if (pct === 0) return { divisor: 1, multiplier: 0 }
    const num = Math.round(pct)
    const g = gcd(num, 100)
    return { divisor: 100 / g, multiplier: num / g }
}

// ── 引用配置（引用乘区 id 解析 / 默认值 / 草稿 → ZoneRef）──

/** @desc 解析引用属性定义（先查可引用表，再兜底查全部乘区） */
export const refTargetDefOf = (id: string) => ZONE_REF_MAP.get(id) ?? ZONE_MAP.get(id) ?? null

/** @desc 乘区单位：`%` 或 `点` */
export const zoneUnitLabel = (unit: string | undefined): string => (unit === '%' ? '%' : '点')

/** @desc 由「除数 / 乘数」反算百分比 */
export const pctOfFraction = (divisor: number, multiplier: number): number =>
    divisor !== 0 ? (multiplier / divisor) * 100 : 0

/** @desc 引用草稿默认值（同一乘区不可引用自身时，自动换一个可引用属性） */
export interface RefDraft {
    targetZoneId: string
    threshold: number
    lower: number | undefined
    upper: number | undefined
    divisor: number
    multiplier: number
    isDiscrete: boolean
    hasThreshold: boolean
    hasLower: boolean
    hasUpper: boolean
}

/** @desc 全新引用的初始草稿：阈值开、上下限关、默认 ÷10×0（与整改前 `openRefModal` 的 else 分支逐字一致） */ export const defaultRefDraft =
    (zoneId: string): RefDraft => ({
        targetZoneId: zoneId,
        threshold: 0,
        lower: undefined,
        upper: undefined,
        divisor: 10,
        multiplier: 0,
        isDiscrete: false,
        hasThreshold: true,
        hasLower: false,
        hasUpper: false
    })

/** @desc 由已存在的引用回填草稿（除数/乘数缺失时按 pct 反推） */
export const refDraftFromRef = (ref: ZoneRef): RefDraft => {
    const s = simplifyPct(ref.pct)
    return {
        targetZoneId: ref.zoneId,
        threshold: ref.threshold,
        lower: ref.lower,
        upper: ref.upper,
        divisor: ref.divisor ?? s.divisor,
        multiplier: ref.multiplier ?? s.multiplier,
        isDiscrete: ref.discrete ?? false,
        hasThreshold: true,
        hasLower: ref.lower !== undefined,
        hasUpper: ref.upper !== undefined
    }
}

/** @desc 引用属性不能是自身：目标恒等于当前乘区时换成第一个可引用属性（无可选项则空串） */
export const resolveRefTarget = (draft: RefDraft, zoneId: string): string => {
    if (draft.targetZoneId !== zoneId) return draft.targetZoneId
    return ZONE_REF_DEFS.find((d) => d.id !== zoneId)?.id ?? ''
}

/** @desc 草稿 → 待写入的 ZoneRef（阈值关 → 0；上下限关或 NaN → undefined） */
export const refFromDraft = (draft: RefDraft, characterIdx: number): ZoneRef => ({
    characterIdx,
    zoneId: draft.targetZoneId as ZoneId,
    threshold: draft.hasThreshold ? draft.threshold : 0,
    pct: pctOfFraction(draft.divisor, draft.multiplier),
    lower: draft.hasLower && draft.lower !== undefined && !isNaN(draft.lower) ? draft.lower : undefined,
    upper: draft.hasUpper && draft.upper !== undefined && !isNaN(draft.upper) ? draft.upper : undefined,
    discrete: draft.isDiscrete,
    divisor: draft.divisor,
    multiplier: draft.multiplier
})

/** @desc 引用配置弹窗的草稿态（状态对象由调用方持有；组件只读写字段，不 import store） */
export interface RefModalState extends RefDraft {
    /** @desc 被配置的乘区下标（同一乘区可添加多次，故用下标定位；-1 = 未打开） */
    zoneIndex: number
    /** @desc 引用来源角色槽位 */
    characterIdx: number
    /** @desc 引用属性下拉是否展开 */
    zoneMenuOpen: boolean
    /** @desc 由父组件传入的默认引用属性（父组件按乘区定义给出，不 import store） */
    baseZoneId: string
}

/** @desc 引用配置弹窗的初始状态（默认引用属性由调用方给出，避免 utils 依赖 store） */
export const createRefModalState = (baseZoneId: string): RefModalState => ({
    zoneIndex: -1,
    zoneMenuOpen: false,
    characterIdx: 0,
    baseZoneId,
    ...defaultRefDraft(baseZoneId)
})

// ── 生效成员（作用域四态状态机）──

/** @desc 作用域里勾选的效应卡：`'all'` 与空数组（仅效应）都算勾上 */
export const effectCheckedIn = (scope: 'all' | number[]): boolean => !Array.isArray(scope) || scope.length === 0

/** @desc 作用域里勾选的角色槽位（`'all'` = 全部槽位；空数组 = 一个都没有） */
export const checkedCharsIn = (scope: 'all' | number[], teamSize = 3): number[] => {
    if (scope === 'all') return Array.from({ length: teamSize }, (_, i) => i)
    return [...new Set(scope)].filter((i) => i >= 0 && i < teamSize).sort((a, b) => a - b)
}

/**
 * @desc 点击某张角色卡后的作用域（四态状态机，已与产品逐条对齐）：
 * - 勾着效应时**再勾角色 = 通用**（`'all'`，三名角色 + 效应都吃）；
 * - 通用状态下取消一个角色 = 取消效应、保留剩余角色；
 * - 只勾部分角色时勾满三个 = **全队**（`[0,1,2]`，效应仍是关的）；
 * - 取消最后一个角色 = **仅效应**（`[]`）；永远不会产生「一个成员都没有」。
 */
export const nextScopeAfterCharToggle = (scope: 'all' | number[], idx: number, teamSize = 3): 'all' | number[] => {
    const chars = checkedCharsIn(scope, teamSize)
    const hasEffect = effectCheckedIn(scope)
    const checked = chars.includes(idx)
    if (hasEffect) {
        if (!checked) return 'all'
        const rest = chars.filter((i) => i !== idx)
        return rest.length === 0 ? [] : rest
    }
    const next = checked ? chars.filter((i) => i !== idx) : [...chars, idx].sort((a, b) => a - b)
    return next.length === 0 ? [] : next
}

/**
 * @desc 点击效应卡后的作用域；返回 null 表示**禁止**这次操作（仅效应取消效应 = 空成员）。
 * - 勾效应 = 通用（`'all'`，三名角色 + 效应）；
 * - 从通用取消效应 = **全队**（`[0,1,2]`，只有三名角色）；
 * - 仅效应（`[]`）取消效应 → 禁止。
 */
export const nextScopeAfterEffectToggle = (scope: 'all' | number[], teamSize = 3): 'all' | number[] | null => {
    if (!effectCheckedIn(scope)) return 'all'
    if (scope === 'all') return Array.from({ length: teamSize }, (_, i) => i)
    return null
}

// ── 列表展示派生（徽标 / 分组）──

/**
 * @desc 条目作用域徽标（**行首**，取代原星标图标）：
 * - 通用（`'all'`，三名角色 + 效应都吃）→ 主题色实心「通用」
 * - 全队（`[0,1,2]`，只有三名角色）→ 主题色描边「全队」
 * - 仅效应（空数组）→ 主题色描边「效应专属」
 * - 指定角色（1~2 个槽位）→ 逐个出角色名，用该角色属性色做空心 + 半透明底
 * `elementColor` 由调用方注入（它是 store 能力，不进本模块）。
 */
export const scopeBadgesOf = (
    bs: BuffConf,
    team: readonly CharSlot[],
    elementColor: (name: string) => string
): { key: string; label: string; style: string }[] => {
    const cls = classifyBuffScope(bs.scope, team.length)
    if (cls.kind === 'all') {
        return [
            {
                key: 'all',
                label: '通用',
                style: 'border-color: transparent; background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);'
            }
        ]
    }
    if (cls.kind === 'charsAll') {
        return [
            {
                key: 'chars-all',
                label: '全队',
                style: 'border-color: var(--theme-accent-bg); background: transparent; color: var(--theme-accent-text);'
            }
        ]
    }
    if (cls.kind === 'effect') {
        return [
            {
                key: 'effect',
                label: '效应专属',
                style: 'border-color: var(--theme-accent-bg); background: transparent; color: var(--theme-accent-text);'
            }
        ]
    }
    return cls.idxs.map((idx) => {
        const name = team[idx]?.character ?? `角色${idx + 1}`
        const color = elementColor(name)
        return {
            key: `char-${idx}`,
            label: name,
            style: `border-color: ${color}; background: color-mix(in srgb, ${color} 15%, transparent); color: ${color};`
        }
    })
}

/**
 * @desc 目录下的全部成员 Buff（数字目录直接取 children；
 * 「全局 Buff」目录还要并入二级子目录的成员，否则批量操作会漏掉它们；
 * 二级子目录自身的数字子目录（`children`）也一并并入）
 */
export const folderMembersOf = (folder: GroupedBuffConfItem): BuffConf[] => [
    ...(folder.children ?? []),
    ...((folder as BuffTreeNode).gateChildren ?? []).flatMap((gate) => folderMembersOf(gate))
]

/** @desc 目录图标配色：一律半透明灰（星标已移除，不再有「内部有收藏条目」的标黄口径） */
export const folderIconClass = (base: string): string => `${base} opacity-60`

/** @desc 非全局容器（角色链 / 武器目录）下未被数字归并的散条目（数字目录由 foldersOf 分支渲染） */
export const looseChildrenOf = (children: BuffConf[] | undefined): BuffConf[] =>
    groupBuffSets(children ?? [])
        .filter((x) => x.type !== 'folder')
        .map((x) => x.buffSet!)

/** @desc 非全局容器下的数字目录（含成员），恒排在散条目前面 */
export const foldersOf = (children: BuffConf[] | undefined): GroupedBuffConfItem[] =>
    groupBuffSets(children ?? []).filter((x) => x.type === 'folder')

/** @desc 数字目录（三级）的折叠 key：按所属容器分区，避免不同容器下的同名目录互相影响 */
export const layeredKeyOf = (containerKey: string, prefix: string | undefined): string => `${containerKey}/${prefix}`

// ── 多选 / 排序 ──

/** @desc 多选模式下不可勾选的 buff：内置默认全局块（global- 前缀）既不能删除也不能移出全局 */
export const isMultiSelectDisabled = (id: string): boolean => id.startsWith('global-')

/** @desc 切换一个集合成员的选中态（返回新集合，保持入参不被改写） */
export const toggledSet = (set: ReadonlySet<string>, id: string): Set<string> => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
}

/** @desc 切换整组成员的选中态：全选则整组取消，否则整组勾上（不可勾选的成员由调用方先过滤） */
export const toggledGroupSet = (set: ReadonlySet<string>, ids: readonly string[]): Set<string> => {
    const next = new Set(set)
    const allSelected = ids.every((id) => next.has(id))
    for (const id of ids) {
        if (allSelected) next.delete(id)
        else next.add(id)
    }
    return next
}

/** @desc 一组 id 是否全部被选中 */
export const allSelectedIn = (set: ReadonlySet<string>, ids: readonly string[]): boolean =>
    ids.length > 0 && ids.every((id) => set.has(id))

/**
 * @desc 按名称排序已选 BUFF：连续数字按数值大小、其它字符按 unicode（`compareNatural`）。
 * 只重排「已选中的那些位置」，未选项与其位置保持不变。
 * 返回 null 表示无需重排（可排序的已选少于 2 条）。
 */
export const sortedSelectionOrder = (
    buffSets: readonly BuffConf[],
    selected: ReadonlySet<string>,
    globalIds: readonly string[],
    compareNatural: (a: string, b: string) => number
): { order: string[]; count: number } | null => {
    const sortable = [...selected].filter((id) => !globalIds.includes(id))
    if (sortable.length < 2) return null
    const order = buffSets.filter((b) => !globalIds.includes(b.id)).map((b) => b.id)
    const slots: number[] = []
    order.forEach((id, i) => {
        if (selected.has(id)) slots.push(i)
    })
    const nameById = new Map(buffSets.map((b) => [b.id, b.name]))
    const sorted = order
        .filter((id) => selected.has(id))
        .sort((a, b) => compareNatural(nameById.get(a) ?? '', nameById.get(b) ?? ''))
    const next = [...order]
    slots.forEach((slot, k) => {
        next[slot] = sorted[k]
    })
    return { order: next, count: sorted.length }
}

// ── 拖拽状态装配 ──

/** @desc 一次拖拽的完整状态（列表是派生的，所以只能改同一父容器内的行顺序） */
export interface DragState {
    /** @desc 拖拽单元 key：item=Buff id；folder=数字目录的分组 key */
    id: string
    /** @desc 拖拽单元种类 */
    mode: 'item' | 'folder'
    /** @desc 目标父容器 key（决定可落点的行序列） */
    parentKey: string
    /** @desc 被搬运的 Buff id（按展示顺序） */
    unitIds: string[]
    /** @desc 不移动时的落点下标（用于区分「点击」与「拖动」；-1=不在该父容器行序列里） */
    idx: number
    /** @desc 当前落点下标；-1=没有有效落点（拖出列表 / 原地未移动） */
    dropIdx: number
    /** @desc 是否已拖出列表（松手即删除） */
    outside: boolean
    /** @desc 插入指示条位置：显示在 dropBeforeId 这一行上方 / dropAfterId 这一行下方 */
    dropBeforeId: string | null
    dropAfterId: string | null
    /** @desc 手动模式下指针悬停的手动文件夹行 key（`manual:<id>`）；非空时松手 = 移入该文件夹 */
    dropFolderKey: string | null
}

/** @desc 构造拖拽起始状态（落点即当前下标，未拖出） */
export const createDragState = (
    id: string,
    mode: 'item' | 'folder',
    parentKey: string,
    unitIds: string[],
    idx: number
): DragState => ({
    id,
    mode,
    parentKey,
    unitIds,
    idx,
    dropIdx: idx,
    outside: false,
    dropBeforeId: null,
    dropAfterId: null,
    dropFolderKey: null
})
