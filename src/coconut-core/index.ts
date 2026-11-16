/**
 * @desc `coconut-core` 的唯一公开出口。
 *
 * 外部只需要认三样东西：
 * - `CoconutCore`（类）：注册角色 / 武器基础属性 → `compute(table)`；
 * - `GeneralTable`（类型）：唯一输入结构；
 * - `CoreResult` / `DamageResult`（类型）：输出结构。
 *
 * 其余（面板 / 乘子 / 公式 / 词条落点 / 作用表）都是实现细节，不从这里导出。
 */
export { CoconutCore } from '$coconut/coconut-core'
export type {
    BaseStats,
    CharacterBaseStats,
    ComputeOptions,
    EnemyBaseStats,
    WeaponBaseStats
} from '$coconut/coconut-core'

export type {
    ApplyToEnum,
    Buff,
    BuffEffect,
    BuffValue,
    CalculationFormula,
    CharacterStatEnum,
    CritDMG,
    CritRate,
    Damage,
    DamageEntry,
    ElementEnum,
    EnemyStatEnum,
    GeneralTable,
    MultiEnum,
    Stat,
    StatKeyEnum,
    StatRef
} from '$coconut/general-table'
export { parseValue } from '$coconut/general-table'

export type { CoreResult, DamageResult, MultiplierDisplay, MultiplierZone } from '$coconut/result'
