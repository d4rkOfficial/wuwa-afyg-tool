/**
 * @desc 迁移基础设施：版本常量、通用对象工具、默认结构与队伍归一化。
 */

import type { CharSlot, EchoSlot, EncounterState, PhaseKey, SelectedSet } from '$lib/types/project'

export const PHASE_ORDER: PhaseKey[] = ['team', 'timeline', 'calculation', 'config']

/**
 * @desc 缺 `project.version` 时的兜底判定门槛（毫秒）：**2026-10-01 00:00 伦敦时间**。
 *
 * 背景：工坊（分享中转站）用逐字段白名单重建工程对象，会把 `project.version` 一并抹掉。
 * 于是「上传工坊再下载」拿回的文件没有版本号，`readVersion` 若按 0 处理，整条迁移链就会重跑
 * —— 其中 `migrateV2toV3` 的 `bindPaneEffectSources` 会把「影响源」Buff 补勾到伤害段上（只加不减），
 * 症状就是「本来没勾的同奏层数被挂到守岸人全部倍率 + 处决倍率」。
 *
 * 工具自身导出的文件**一直带 `project.version`**，所以现代分享件「没有版本号」意味着
 * 「中转站吃掉了版本号」，而不是「v0 工程」。这个日期远晚于 v4（2026-09-27 起有 v2→v3 / v3→v4）与 v3，
 * 因此晚于它的无版本文件可以直接断言为当前最新版。
 *
 * 注意：无版本号的导出文件确实存在过，所以门槛之前仍按 0 处理（迁移链照跑），
 * 不能用「无版本号 = 最新版」一刀切。
 *
 * 另注：门槛之后新增的版本若也要作用于这些无版本号文件，必须做成**幂等且无条件执行**的结构性归一化
 * （如 v5 的「备注重击块 → 独立重击块」，见 `migrateHeavyPressOpBlocks` 在 `migrateProject` 里的兜底调用），
 * 否则会被本兜底判定直接跳过。
 */
export const VERSIONLESS_ASSUME_CURRENT_AFTER = Date.UTC(2026, 9, 1, 0, 0, 0, 0)

/** @desc 一个原子迁移步骤：把 from 版本的数据升级到 to 版本 */
export interface Migration {
    from: number
    to: number
    migrate(raw: Record<string, unknown>): Record<string, unknown>
}

// ── 基础设施 ──

export const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)

export const asRecord = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {})

export const pickNum = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback

export const genId = (prefix: string): string =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** @desc 深拷贝（结构化数据；含 unknown 阶段数据的快照） */
export const deepClone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

// ── 默认结构构造 ──

export const emptyEchoSlot = (): EchoSlot => ({ name: null, cost: 0 })

export const emptyCharSlot = (): CharSlot => ({
    character: null,
    weapon: null,
    triggerSets: [],
    echoes: [emptyEchoSlot(), emptyEchoSlot(), emptyEchoSlot(), emptyEchoSlot(), emptyEchoSlot()],
    chain: 0,
    refinement: 1
})

/** @desc 内置链/精炼档位：链阶真源是角色槽位（team[].chain / team[].refinement），不用变量 */
export const DEFAULT_SLOTS = [0, 1, 2] as const

export const emptyEncounter = (): EncounterState => ({
    teamLocked: false,
    timeline: { locked: false, data: null },
    calculation: { locked: false, data: null },
    config: { locked: false, data: null }
})

/** @desc 读取 v0 结构里某阶段的锁定标记（phases[phase].locked） */
export const lockedOf = (container: Record<string, unknown>, key: PhaseKey): boolean =>
    asRecord(container[key]).locked === true

/** @desc 读取队伍锁定标记（teamLocked 可能是布尔或 phases.team 对象） */
export const teamLockedOf = (container: Record<string, unknown>): boolean =>
    container.teamLocked === true || asRecord(container.teamLocked).locked === true

/** @desc 链/阶对比弹窗的对比点（chains / refinements 两个数组） */
export type ComparisonPoint = { chains: number[]; refinements: number[] }

/** @desc 自动生成的默认全局 buff（global-{角色名} / global-all）标识 */
export const isLegacyAutoGlobal = (id: string): boolean => id.startsWith('global-')

export const normalizeTeam = (raw: unknown): [CharSlot, CharSlot, CharSlot] =>
    DEFAULT_SLOTS.map((i) => {
        const slot = asRecord(Array.isArray(raw) ? raw[i] : undefined)
        const echoes = Array.isArray(slot.echoes) ? slot.echoes : []
        return {
            character: typeof slot.character === 'string' ? slot.character : null,
            weapon: typeof slot.weapon === 'string' ? slot.weapon : null,
            triggerSets: (Array.isArray(slot.triggerSets) ? slot.triggerSets : [])
                .filter(isRecord)
                .map((s) => ({ name: String(s.name ?? ''), pieces: pickNum(s.pieces, 2) }) as SelectedSet),
            echoes: DEFAULT_SLOTS.map((j) => {
                const e = asRecord(echoes[j])
                return { name: typeof e.name === 'string' ? e.name : null, cost: pickNum(e.cost, 0) }
            }) as [EchoSlot, EchoSlot, EchoSlot, EchoSlot, EchoSlot],
            chain: Math.max(0, pickNum(slot.chain, 0)),
            refinement: pickNum(slot.refinement, 1)
        }
    }) as [CharSlot, CharSlot, CharSlot]
