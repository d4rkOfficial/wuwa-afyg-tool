/**
 * @desc 拉表（分类平铺 / 分段平铺，共用 `spread-table`）的**纯逻辑**。
 *
 * 职责（实测）：把同一领域（伤害条目 × Buff 绑定）里的判定口径与文案拼装收在一处：
 * `damageTypesByEntry`、`inferredDamageTypeMap`、`charToIdx`、条件贡献判定、伤害类型短名、
 * 影响源文案、选中集合增删。一旦口径漂移，就会出现「同一格在两处可用性不同」的隐性不一致。
 *
 * 注：本文件位于 `components/` 下，**不在** `eslint.config.js` 的 functional-preference
 * 文件列表内（该层只覆盖 `calc/ api/ utils/ consts/ types/ ai/generate/ ai/tools/`），
 * 故此处按该层的写法自律（纯函数、入参不可重赋值、只用 `const` 与箭头函数），但规则本身不强制。
 */
import { resolveDamageTypes, zoneConditionMet, type ConditionProfile } from '$lib/calc/compute'
import { inferDamageTypes } from '$lib/calc/utils'
import { DAMAGE_TYPE_SHORT, ZONE_REF_MAP, zoneAppliesToCoeffEntry } from '$lib/calc/calculation.consts'
import type { BuffConf, BuffZoneValue, DamageEntry } from '$lib/calc/calculation.types'
import type { CharSlot } from '$lib/types/project'

/** @desc 直伤判定的最小入参（两个表的入参都是 `DamageEntry`，此处放宽便于共用） */
type DamageKind = Pick<DamageEntry, 'isEffect' | 'isTuneBreak' | 'isTuneResponse'>

/**
 * @desc 非直伤条目（效应 / 处决 / 响应）的判定。
 *
 * 注：它们**不是**「没有伤害类型上下文」—— 引擎给它们判乘区条件时用的是解析后的伤害类型
 * （效应 → `效应伤害`；处决/响应 → 推断类型），拉表的条件过滤也必须照传（见 `buffMatchesEntry`）。
 * 这里只表示「走系数基类公式」这一归属，供分组、可用性与双暴口径使用。
 */
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
 *
 * **非直伤条目（处决/响应/效应）也要收进来**：引擎给它们的乘区条件判定传的就是解析后的伤害类型
 * （效应 → `效应伤害`、处决/响应 → 推断类型），拉表若在这里跳过它们，条件过滤就失去了上下文，
 * 会把「带属性/类型条件的乘区」一律判成不匹配（实测：效应条目上带「导电/效应」条件的加深 buff
 * 被默认开启的「可用Buff」过滤挡掉、挂不上）。本 Map 只服务于条件判定，**不用于展示** ——
 * 展示仍走 `entryDamageTypeMap`（用户显式）与 `inferredDamageTypeMap`（自动推导）。
 */
export const buildDamageTypesByEntry = (
    damageEntries: readonly DamageEntry[],
    entryDamageTypeMap: ResolveArgs[1],
    charInfoMap: CharInfoMap,
    echoDescByEntry: ResolveArgs[3]
): Map<string, string[]> => {
    const m = new Map<string, string[]>()
    for (const e of damageEntries) {
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
 * @desc Buff 作用域是否覆盖本条：效应伤害只吃「通用（`'all'`）」或「仅效应（空数组）」；
 * 其余条目要求作用域指向本条目所属角色（charIdx < 0 → 不覆盖）。
 */
export const buffScopeOk = (bs: BuffConf, isEffect: boolean | undefined, charIdx: number): boolean => {
    if (isEffect) return bs.scope === 'all' || (Array.isArray(bs.scope) && bs.scope.length === 0)
    return charIdx >= 0 && (bs.scope === 'all' || (bs.scope as number[]).includes(charIdx))
}

/**
 * @desc 效应/处决/响应伤害实际读取的乘区（`computeEffectEntry` / `computeTuneEntry`）：
 * 效应吃加深不吃谐度增幅；处决/响应吃谐度增幅不吃加深；都不吃攻击/增伤/面板类。
 *
 * **双暴是「初始 0」而不是「不吃」**：这类条目的双暴基准为 0% / 100%（`compute.ts` 的 `critBase`），
 * 面板双暴不计入，且**双暴只有「覆盖」写入生效** —— 追加/引用一律不生效
 * （见 `COEFF_OVERRIDE_ONLY_ZONE_IDS`），所以「可吃」还要再过一道 `zoneAppliesToCoeffEntry`。
 */
export const EFFECT_RELEVANT_ZONES: ReadonlySet<string> = new Set([
    'extraRatio',
    'deepenDmg',
    'critRate',
    'critDmg',
    'resPen',
    'resDown',
    'defPen',
    'defDown',
    'dmgRedPen',
    'dmgTakenInc',
    'finalDmg',
    'specialFinal1',
    'specialFinal2',
    'unisonBoonLayer'
])

export const TUNE_RELEVANT_ZONES: ReadonlySet<string> = new Set([
    'extraRatio',
    'tuneBreakBoost',
    'critRate',
    'critDmg',
    'resPen',
    'resDown',
    'defPen',
    'defDown',
    'dmgRedPen',
    'dmgTakenInc',
    'finalDmg',
    'specialFinal1',
    'specialFinal2',
    'unisonBoonLayer'
])

/** @desc 单条乘区是否被当前非直伤条目真正读取（白名单 + 双暴「只有覆盖生效」） */
export const zoneUsableByNonDirect = (zone: BuffZoneValue, entry: DamageEntry): boolean => {
    const zones = entry.isTuneBreak || entry.isTuneResponse ? TUNE_RELEVANT_ZONES : EFFECT_RELEVANT_ZONES
    return zones.has(zone.zoneId) && zoneAppliesToCoeffEntry(zone)
}

/** @desc 该 buff 是否含当前非直伤条目可用的乘区（避免显示吃不到的全局 buff） */
export const buffRelevantForNonDirect = (bs: BuffConf, entry: DamageEntry): boolean =>
    bs.zones.some((z) => zoneUsableByNonDirect(z, entry))

/**
 * @desc 该 buff 是否**允许勾到**这个条目上（拉表两视图共用的可用性硬门槛）：
 * 直伤一律允许；非直伤要求至少有一条能真正生效的乘区 —— 由此挡住
 * 「给处决/响应/效应条目加**追加型**暴击率/暴击伤害 buff」（那些写入对这类条目不生效，勾了也白勾）。
 *
 * 影响源（改写被引用角色面板的 buff）不走本判据：它们改的是**别人的面板**，与本条自己吃不吃双暴无关，
 * 由调用方单独放行（铺开表的 `|| pane`、下拉表的影响源分支都排在它前面）。
 */
export const buffUsableByEntry = (bs: BuffConf, entry: DamageEntry): boolean =>
    isDirectDamage(entry) || buffRelevantForNonDirect(bs, entry)

/**
 * @desc 乘区级「伤害属性 / 伤害类型」条件是否至少有一条乘区能满足（引擎口径：任一条目满足即可吃到）。
 *
 * 这是**软条件**：不满足时格子仍属于「这个 Buff 和这个条目有关」，只是当下勾不上 →
 * 拉表用它决定「显示灰色禁止图标且不可勾选」；列是否保留不看它（看 `cellBlockReasonOf` 的硬门槛）。
 */
export const buffZonesConditionOk = (
    bs: BuffConf,
    entry: DamageEntry,
    damageTypes: readonly string[] | undefined,
    profile: ConditionProfile
): boolean =>
    bs.zones.some((zone) =>
        zoneConditionMet(zone, {
            chains: profile.chains,
            refinements: profile.refinements,
            element: entry.damageElement,
            damageTypes: damageTypes ? [...damageTypes] : []
        })
    )

/**
 * @desc 拉表格子「不可勾」的原因（null = 可勾）：
 * - `scope`：作用域不覆盖本条目；
 * - `zone`：非直伤条目吃不到该乘区（追加型双暴等）；
 * - `condition`：乘区级伤害属性/类型条件不满足。
 *
 * 三者都渲染成灰色禁止图标；区分原因是为了「列是否保留」只看前两者（软条件不隐藏整列）。
 */
export type CellBlockReason = 'scope' | 'zone' | 'condition'

export const cellBlockReasonOf = (
    bs: BuffConf,
    entry: DamageEntry,
    charIdx: number,
    damageTypes: readonly string[] | undefined,
    profile: ConditionProfile
): CellBlockReason | null => {
    if (!buffScopeOk(bs, entry.isEffect, charIdx)) return 'scope'
    if (!buffUsableByEntry(bs, entry)) return 'zone'
    if (!buffZonesConditionOk(bs, entry, damageTypes, profile)) return 'condition'
    return null
}

/**
 * @desc 在 `current` 之上批量勾选/取消 `ids`（两个表的行/列/文件夹批量操作共用）。
 * 保留 `current` 的既有顺序（Set 的插入序），新增项追加在后。
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
