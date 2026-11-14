/**
 * @desc Buff 集（工具箱本地库 / 工坊 `buff_sets`）侧的**条件口径**：把工程侧的 Buff 级规则
 * 裁剪成「模板里能表达、且导入后仍然有意义」的子集，并统一**归属轴**（本角色 / 出伤者）。
 *
 * 为什么单独成文件：读库（`data/buff-library.svelte.ts`）、书库编辑器、AI 工具与导入都要用同一套
 * 裁剪口径；放进 `data/` 会让 `calc/` 反向依赖 `data/`（既有依赖方向只有 `data → calc`）。
 *
 * 与工程侧 `rules.ts` 的分工：
 * - `rules.ts` = 引擎口径（6 种 kind 全量、`charIdx` 是真实槽位 0..2）；
 * - 本文件 = **库口径**（5 种 kind，去掉 `buffActive`：它引用工程内 buff id，库里没有该 id 空间；
 *   `charIdx` 收敛成两档：`0` = 本角色（导入时按实体归属重指）、`-1` = 出伤者）。
 */

import type { BuffRule, ZoneCompareId } from './calculation.types'
import {
    RULE_KIND_OPTIONS,
    ZONE_COMPARE_OPS,
    ZONE_COMPARE_OPTIONS,
    describeRule,
    isValidRegex,
    normalizeRules
} from './rules'

/** @desc 库内允许的规则种类（顺序即「创建条件」菜单顺序） */
export const LIBRARY_RULE_KINDS: BuffRule['kind'][] = [
    'chain',
    'refinement',
    'damageNameRegex',
    'zoneCompare',
    'enemyType'
]

/** @desc 库内允许的「创建条件」菜单项（隐藏 `buffActive`） */
export const LIBRARY_RULE_OPTIONS = RULE_KIND_OPTIONS.filter((option) => LIBRARY_RULE_KINDS.includes(option.value))

/**
 * @desc 「角色面板数值」条件可用的属性。
 *
 * 故意排除两项：
 * - `unisonBoonLayer` / `tuneBreakBoost` —— 它们的自封顶玩法依赖「其它产层源 + 排除自身」的
 *   跨 Buff 面板聚合（见 `docs/buff-engine.md` 的 zoneCompare 段），Buff 集是模板、拿不到那种聚合，
 *   配出来只会「永远不生效」。
 */
export const LIBRARY_ZONE_COMPARE_IDS: ZoneCompareId[] = [
    'atk',
    'hp',
    'def',
    'recharge',
    'offTuneBuildupRate',
    'critRate',
    'critDmg'
]

/** @desc 「角色面板数值」条件可选的属性下拉项 */
export const LIBRARY_ZONE_COMPARE_OPTIONS = ZONE_COMPARE_OPTIONS.filter((option) =>
    LIBRARY_ZONE_COMPARE_IDS.includes(option.value)
)

/** @desc 伤害名正则的长度上限（库内是社区共享数据，做一个粗暴的兜底，防超长正则当数据用） */
export const LIBRARY_REGEX_MAX = 120

/**
 * @desc 引用（转模）的归属档位。
 * - `self` / `owner` = **本角色**（角色实体自身 / 武器·声骸·套装的装备者）：两者语义相同，
 *   工坊两侧的既有数据里都出现过，差别只在文案；导入时都落到实体归属槽位。
 * - `active` = **出伤者**：引用「本次伤害所属角色」的面板（导入后是 `ZoneRef.characterIdx = -1`）。
 */
export type LibraryRefOwner = 'self' | 'owner' | 'active'

/** @desc 引用归属的两选一（界面用；`self`/`owner` 合并显示为「本角色」） */
export const LIBRARY_REF_OWNER_TABS: { value: 'owner' | 'active'; label: string; hint: string }[] = [
    { value: 'owner', label: '本角色', hint: '引用该增益所属角色的面板（武器 / 声骸 / 套装 = 装备者）' },
    { value: 'active', label: '出伤者', hint: '引用本次伤害所属角色的面板' }
]

/** @desc 该实体类型的「本角色」默认落哪个值（角色=自己；其余=装备者） */
export const defaultRefOwnerOf = (entityType: string | undefined): LibraryRefOwner =>
    entityType === 'character' ? 'self' : 'owner'

/** @desc 归一化引用归属（三条白名单以外一律丢弃） */
export const sanitizeRefOwner = (raw: unknown): LibraryRefOwner | undefined =>
    raw === 'self' || raw === 'owner' || raw === 'active' ? raw : undefined

/** @desc 界面两选一是否选中：`active` 单独一档，`self`/`owner` 都归「本角色」 */
export const isActiveRefOwner = (refOwner: LibraryRefOwner | undefined): boolean => refOwner === 'active'

/**
 * @desc 界面选择 → 落库值：`active` 直接写；「本角色」按实体类型落成 `self` / `owner`。
 */
export const applyRefOwnerChoice = (choice: 'owner' | 'active', entityType: string | undefined): LibraryRefOwner =>
    choice === 'active' ? 'active' : defaultRefOwnerOf(entityType)

/**
 * @desc 引用归属 → 工程侧 `ZoneRef.characterIdx`。
 * - 出伤者 = `-1`（引擎按本条目所属角色解算，见 `compute.ts`）；
 * - 本角色 = 实体在当前配队里的归属槽位（`-1` 表示实体不在配队，引用恒为 0，与既有行为一致）。
 */
export const libraryRefCharacterIdx = (refOwner: LibraryRefOwner | undefined, ownerSlot: number): number =>
    refOwner === 'active' ? -1 : ownerSlot

/** @desc 单条规则的库口径归一化（不合法返回 null） */
const sanitizeLibraryRule = (rule: BuffRule): BuffRule | null => {
    switch (rule.kind) {
        case 'chain':
            // 库内没有槽位概念：一律 0，导入时按实体归属重指
            return { kind: 'chain', charIdx: 0, min: rule.min }
        case 'refinement':
            return { kind: 'refinement', charIdx: 0, min: rule.min }
        case 'damageNameRegex':
            // 空草稿保留（编辑器正在输入）；超长的一律丢弃
            return rule.pattern.length <= LIBRARY_REGEX_MAX ? rule : null
        case 'zoneCompare': {
            if (!LIBRARY_ZONE_COMPARE_IDS.includes(rule.zone)) return null
            return { ...rule, charIdx: rule.charIdx < 0 ? -1 : 0 }
        }
        case 'enemyType':
            return rule
        default:
            // buffActive：引用工程内 buff id，库内无法表达
            return null
    }
}

/**
 * @desc 归一化库内 Buff 级规则：种类白名单 + 归属轴收敛 + 属性白名单，**同类只保留一条**。
 *
 * 草稿（空正则 / 空引用集合）保留：编辑器是就地编辑的，中途保存不该把刚建的条件卡吞掉；
 * 导入工程后草稿恒不满足（`ruleMet` 判 `isRuleDraft`），与工程侧口径一致。
 */
export const sanitizeLibraryRules = (raw: unknown): BuffRule[] | undefined => {
    const normalized = normalizeRules(raw)
    if (!normalized) return undefined
    const out: BuffRule[] = []
    const seenKind = new Set<BuffRule['kind']>()
    for (const rule of normalized) {
        const next = sanitizeLibraryRule(rule)
        if (!next) continue
        if (seenKind.has(next.kind)) continue
        seenKind.add(next.kind)
        out.push(next)
    }
    return out.length > 0 ? out : undefined
}

/** @desc 规则里的正则是否可用（编辑器提示用；空值视为「未填写」） */
export const isLibraryRegexUsable = (pattern: string): boolean => pattern.trim().length > 0 && isValidRegex(pattern)

/** @desc 库内规则的文案口径：槽位一律说「本角色」，`charIdx = -1` 说出伤者（不出现槽位号） */
export const describeLibraryRules = (rules: BuffRule[] | undefined): string =>
    (rules ?? []).map((rule) => describeRule(rule, { slotName: () => '本角色', activeName: '出伤者' })).join(' 且 ')

/** @desc 运算符文案（供界面展示，与工程侧同一张表） */
export const libraryCompareOpLabel = (op: string): string =>
    ZONE_COMPARE_OPS.find((item) => item.value === op)?.label ?? op
