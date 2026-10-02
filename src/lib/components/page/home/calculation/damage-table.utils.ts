/**
 * @desc 拉表两视图（铺开 `spread-table` / 下拉 `dropdown-table`）共用的**纯逻辑**。
 *
 * 抽因（实测）：两张表渲染的是同一领域（伤害条目 × Buff 绑定），但 DOM 结构毫不相同
 * （矩阵 vs 列表，跨文件共享的元素壳只有 4 种微结构），真正重复的是**判定口径与文案拼装**：
 * `damageTypesByEntry`、`inferredDamageTypeMap`、`charToIdx`、条件贡献判定、伤害类型短名、
 * 影响源文案、选中集合增删在这两个文件里各写了一份、且逐字相同 —— 一旦其中一处改口径，
 * 就会出现「同一格在两个视图里可用性不同」的隐性不一致。
 *
 * 注：本文件位于 `components/` 下，**不在** `eslint.config.js` 的 functional-preference
 * 文件列表内（该层只覆盖 `calc/ api/ utils/ consts/ types/ ai/generate/ ai/tools/`），
 * 故此处按该层的写法自律（纯函数、入参不可重赋值、只用 `const` 与箭头函数），但规则本身不强制。
 */
import { buffContributesToEntry, resolveDamageTypes, type ConditionProfile } from '$lib/calc/compute'
import { inferDamageTypes } from '$lib/calc/utils'
import { DAMAGE_TYPE_SHORT, ZONE_REF_MAP } from '$lib/calc/calculation.consts'
import type { BuffSet, DamageEntry } from '$lib/calc/calculation.types'
import type { CharSlot } from '$lib/types/project'

/** @desc 直伤判定的最小入参（两个表的入参都是 `DamageEntry`，此处放宽便于共用） */
type DamageKind = Pick<DamageEntry, 'isEffect' | 'isTuneBreak' | 'isTuneResponse'>

/** @desc 非直伤条目（效应 / 处决 / 响应）：三者一律不吃条目级伤害类型上下文 */
export const isNonDirectDamage = (e: DamageKind): boolean => e.isEffect || e.isTuneBreak || e.isTuneResponse

/** @desc 是否为直伤条目（非效应/非处决/非响应） */
export const isDirectDamage = (e: DamageKind): boolean => !isNonDirectDamage(e)

/** @desc 角色名 → 槽位索引（空槽位不登记，故查不到即 -1） */
export const buildCharToIdx = (team: readonly CharSlot[]): Record<string, number> =>
    Object.fromEntries(team.map((s, i) => [s.character ?? '', i]).filter(([name]) => name !== ''))

/** @desc 某个条目所属的角色槽位索引（无角色/不在队伍中 → -1） */
export const entryCharIdx = (entry: Pick<DamageEntry, 'character'>, charToIdx: Record<string, number>): number =>
    entry.character ? (charToIdx[entry.character] ?? -1) : -1

/** @desc `resolveDamageTypes` 的实参类型（避免在此重述 charInfo / echoDesc 的具体形状） */
type ResolveArgs = Parameters<typeof resolveDamageTypes>
/** @desc 角色信息表（伤害类型推导规则 2 需要） */
type CharInfoMap = ResolveArgs[2]

/**
 * @desc 条目 → 生效伤害类型：`resolveDamageTypes()` 只依赖条目与角色/声骸信息，与具体 buff 无关，
 * 不该按「条目 × buff」重算。两个视图共用同一口径与同一次记忆。
 */
export const buildDamageTypesByEntry = (
    damageEntries: readonly DamageEntry[],
    entryDamageTypeMap: ResolveArgs[1],
    charInfoMap: CharInfoMap,
    echoDescByEntry: ResolveArgs[3]
): Map<string, string[]> => {
    const m = new Map<string, string[]>()
    for (const e of damageEntries) {
        if (isNonDirectDamage(e)) continue
        m.set(e.id, resolveDamageTypes(e, entryDamageTypeMap, charInfoMap, echoDescByEntry))
    }
    return m
}

/** @desc 单条目的自动推导伤害类型（未手填伤害类型时展示推导结果；规则 2 需要角色/声骸技能文案） */
export const inferredDamageTypesOf = (
    entry: DamageEntry,
    charInfoMap: CharInfoMap,
    echoDescByEntry: Record<string, string>
): string[] =>
    inferDamageTypes(entry, entry.character ? charInfoMap?.[entry.character] : undefined, echoDescByEntry[entry.id])

/** @desc 全表「条目 → 自动推导伤害类型」映射 */
export const buildInferredDamageTypeMap = (
    damageEntries: readonly DamageEntry[],
    charInfoMap: CharInfoMap,
    echoDescByEntry: Record<string, string>
): Record<string, string[]> =>
    Object.fromEntries(damageEntries.map((e) => [e.id, inferredDamageTypesOf(e, charInfoMap, echoDescByEntry)]))

/** @desc 伤害类型短名（查不到时回落原值） */
export const damageTypeShort = (dt: string): string => DAMAGE_TYPE_SHORT[dt as keyof typeof DAMAGE_TYPE_SHORT] ?? dt

/** @desc 自动推导的展示文案（空集合返回空串，调用方据此决定是否渲染） */
export const inferredDamageTypeText = (types: readonly string[]): string =>
    types.length > 0 ? `自动推导：${types.map(damageTypeShort).join('/')}` : ''

/** @desc 面板乘区键 → 展示标签（查不到时回落键名，与引擎的引用定义表同源） */
export const zoneLabelsOf = (zoneIds: readonly string[]): string[] =>
    zoneIds.map((z) => ZONE_REF_MAP.get(z)?.label ?? z)

/**
 * @desc 「影响源」提示文案：该 Buff 作用于「被本段伤害引用的角色」，会改写那个角色的面板乘区。
 * 伤害是当下的 —— 勾上它就会参与该角色在这一段伤害下的面板计算。
 * @param subject 主语短语：铺开表按组（`本组的伤害`）、下拉表按段（`本段伤害`）
 */
export const paneSourceText = (charName: string, zoneLabels: readonly string[], subject: string): string =>
    `影响源：${charName} 的${zoneLabels.join('、')}会被它改写，而${subject}引用了该面板 —— 勾上后参与该角色在这一段的面板计算`

/**
 * @desc Buff 作用域是否覆盖本条：效应伤害只吃「全队」或「效应专属（空数组）」；
 * 其余条目要求作用域指向本条目所属角色（charIdx < 0 → 不覆盖）。
 */
export const buffScopeOk = (bs: BuffSet, isEffect: boolean | undefined, charIdx: number): boolean => {
    if (isEffect) return bs.scope === 'all' || (Array.isArray(bs.scope) && bs.scope.length === 0)
    return charIdx >= 0 && (bs.scope === 'all' || (bs.scope as number[]).includes(charIdx))
}

/**
 * @desc 条件匹配判定（隐藏开关开启时过滤链/阶低于配置、属性/类型对不上条目的 buff）。
 *
 * 用 `buffContributesToEntry` 而非实例级条件：属性/类型条件挂在**乘区条目**上，
 * 只看实例级会让「乘区条件不满足」的 buff 仍可勾选。非直伤条目没有条目级伤害类型上下文，
 * 故按引擎口径丢掉乘区条件的 damageTypes 维度。
 */
export const buffMatchesEntry = (
    bs: BuffSet | undefined,
    entry: DamageEntry,
    ctx: {
        hideConditionMismatch: boolean
        conditionProfile: ConditionProfile
        damageTypes: string[] | undefined
        charIdx: number
    }
): boolean => {
    if (!bs) return false
    if (!ctx.hideConditionMismatch) return true
    return buffContributesToEntry(
        bs,
        isNonDirectDamage(entry)
            ? {}
            : {
                  element: entry.damageElement,
                  damageTypes: ctx.damageTypes ?? []
              },
        ctx.conditionProfile,
        ctx.charIdx
    )
}

/**
 * @desc 在 `current` 之上批量勾选/取消 `ids`（两个表的行/列/文件夹批量操作共用）。
 * 保留 `current` 的原有顺序（Set 的插入序），新增项追加在后 —— 与原先就地 new Set 的写法一致。
 */
export const applyIdsSelection = (current: readonly string[], ids: readonly string[], select: boolean): string[] => {
    const next = new Set(current)
    for (const id of ids) {
        if (select) next.add(id)
        else next.delete(id)
    }
    return [...next]
}

/**
 * @desc 「三态读出、两态写入」的全选/全不选：`ids` 全已选 → 全取消；否则 → 全选。
 * 下拉表的叠层文件夹（整组）与叠层前缀段（1层..N层）用的是同一条逻辑。
 */
export const toggleAllIds = (ids: readonly string[], selected: readonly string[]): string[] =>
    applyIdsSelection(selected, ids, !ids.every((id) => selected.includes(id)))
