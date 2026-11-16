import type { ConfigState } from '$lib/calc/config.types'
import type { ResultEntry } from '$lib/calc/result.types'
import type { CharSlot } from '$lib/types/project'

/** @desc 工程文件里某一阶段的容器（只声明 fast-calc 需要的阶段） */
export interface EditablePhase<T> {
    locked?: boolean
    data?: T | null
}

/** @desc 参考线计时点（切分时段用） */
export interface FastCalcTiming {
    refLineId: string
    label: string
    seconds: number | null
}

/** @desc 一个时间段的展示数据 */
export interface SegmentView {
    key: string
    time: string
    start: number
    end: number
    total: number
    dps: number
    seconds: number
    entries: ResultEntry[]
}

/**
 * @desc fast-calc 只会读写 `team` / `conditionProfile` / config 阶段 / 计时点，其余工程字段原样保留。
 *  不直接使用 `Project`：分享下载的文件是「导出信封」形态（只有 phases，可能没有 encounter）。
 */
export interface EditableProject {
    name?: string
    version?: number
    team: CharSlot[]
    conditionProfile?: { chains: number[]; refinements: number[] }
    phases?: {
        timeline?: EditablePhase<unknown>
        calculation?: EditablePhase<unknown>
        config?: EditablePhase<ConfigState>
        [key: string]: unknown
    }
    encounter?: {
        timeline?: EditablePhase<unknown>
        calculation?: EditablePhase<unknown>
        config?: EditablePhase<ConfigState>
        [key: string]: unknown
    }
    analysis?: { timings?: { refLineId: string; seconds: number | null }[]; [key: string]: unknown }
    [key: string]: unknown
}

/** @desc 导入文件的外层信封（工具导出为 { version, exportedAt, project }） */
export interface FastCalcFile {
    version?: number
    exportedAt?: number
    project: EditableProject
    [key: string]: unknown
}

/** @desc 解析结果：`root` 用于原样回传父窗口，`project` 是真正编辑的工程本体 */
export interface LoadedProject {
    root: unknown
    project: EditableProject
}
