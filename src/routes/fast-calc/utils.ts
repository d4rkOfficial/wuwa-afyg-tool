import { defaultEnemy } from '$lib/calc/config.consts'
import type { CharEchoConfig, ConfigState, EchoSlotConfig } from '$lib/calc/config.types'
import { autoConfigureTimings } from '$lib/calc/ref-line-timing'
import type { ResultEntry } from '$lib/calc/result.types'
import { ECHO_SLOT_COUNT } from '$lib/consts/game-terms'
import { MAIN_STAT_POOL, SECOND_MAIN_STAT, SUBSTAT_MAX, SUBSTAT_OPTIONS } from '$lib/consts/stat-data'
import type { EchoStat } from '$lib/types/game-data'
import type { EditableProject, FastCalcFile, FastCalcTiming, LoadedProject, SegmentView } from './types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

/** @desc 主词条候选（按声骸 cost 查表，未登记的 cost 返回空数组） */
export const mainStatOptions = (cost: number) => MAIN_STAT_POOL[cost] ?? []

export const mainStatFromOption = (option: { label: string; maxValue: number; unit: string }): EchoStat => ({
    type: option.label,
    value: option.maxValue,
    unit: option.unit
})

/** @desc 新增副词条的默认值：取该词条档位的中档（与工具箱「添加副词条」同口径） */
export const defaultSubstat = (label: string): EchoStat => {
    const option = SUBSTAT_OPTIONS.find((item) => item.label === label)
    const middle = option ? option.tiers[Math.floor((option.tiers.length - 1) / 2)] : 0
    return { type: label, value: middle, unit: option?.unit ?? '' }
}

/** @desc 某槽位当前可选的副词条名（同一件声骸不允许重复词条） */
export const availableSubstatLabels = (slot: EchoSlotConfig, current: string): string[] =>
    SUBSTAT_OPTIONS.filter(
        (option) => option.label === current || !slot.substats.some((sub) => sub.type === option.label)
    ).map((option) => option.label)

export const formatEchoStat = (stat: EchoStat | null): string => (stat ? `${stat.type} ${stat.value}${stat.unit}` : '—')

/**
 * @desc 解析 `?import_project=` 指向的工程文件。
 *  兼容「导出信封」`{ version, exportedAt, project }` 与直接给工程对象的两种形态；
 *  `root` 会原样回传父窗口，避免改动文件外层结构。
 */
export const readProjectFile = (text: string): LoadedProject => {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        throw new Error('不是合法的 JSON 文件')
    }
    const wrapped = isRecord(raw) && isRecord(raw.project)
    const project = (wrapped ? (raw as FastCalcFile).project : raw) as EditableProject
    if (!isRecord(project) || !Array.isArray(project.team)) throw new Error('工程文件缺少 team 字段')
    return { root: raw, project }
}

export const chainsOf = (project: EditableProject): number[] =>
    project.team.map((slot, index) => slot.chain ?? project.conditionProfile?.chains?.[index] ?? 0)

export const refinementsOf = (project: EditableProject): number[] =>
    project.team.map((slot, index) => slot.refinement ?? project.conditionProfile?.refinements?.[index] ?? 1)

const toEchoStat = (stat: { label: string; value: number; unit: string }): EchoStat => ({
    type: stat.label,
    value: stat.value,
    unit: stat.unit
})

/** @desc 复用文件里已有的槽位；没有时按队伍声骸的 cost 建空槽（副主词条由 cost 表查得） */
const normalizeSlot = (existing: EchoSlotConfig | undefined, cost: number): EchoSlotConfig => {
    const second = SECOND_MAIN_STAT[cost]
    return {
        cost,
        mainStat: existing?.mainStat ? { ...existing.mainStat } : null,
        secondMainStat: existing?.secondMainStat ? { ...existing.secondMainStat } : second ? toEchoStat(second) : null,
        substats: existing?.substats ? existing.substats.map((sub) => ({ ...sub })) : []
    }
}

/** @desc 取工程当前的词条配置；没有任何配置时按队伍声骸建一份可编辑的空配置 */
export const initialConfig = (project: EditableProject): ConfigState => {
    const existing = (project.encounter?.config?.data ?? project.phases?.config?.data ?? null) as ConfigState | null
    const characters = project.team.map((slot, charIndex) => {
        const existingEchoes = existing?.characters?.[charIndex]?.echoes ?? []
        const echoes = Array.from({ length: ECHO_SLOT_COUNT }, (_, slotIndex) => {
            const cost = existingEchoes[slotIndex]?.cost ?? slot.echoes?.[slotIndex]?.cost ?? 1
            return normalizeSlot(existingEchoes[slotIndex], cost)
        })
        return { echoes } as CharEchoConfig
    })
    return {
        characters: characters as ConfigState['characters'],
        enemy: existing?.enemy ?? defaultEnemy()
    }
}

/**
 * @desc 把编辑结果写回工程并返回可回传的根节点：
 *  - 链/阶写 `team[]` 与兼容视图 `conditionProfile`；
 *  - 词条写 `phases.config.data`（导出文件形态）与 `encounter.config.data`（内存态形态，两处都写避免丢数据）。
 */
export const applyEdits = (
    loaded: LoadedProject,
    config: ConfigState,
    chains: number[],
    refinements: number[],
    timings?: FastCalcTiming[]
): unknown => {
    const project = loaded.project
    project.team = project.team.map((slot, index) => ({
        ...slot,
        chain: chains[index] ?? 0,
        refinement: refinements[index] ?? 1
    })) as EditableProject['team']
    project.conditionProfile = { chains: [...chains], refinements: [...refinements] }

    if (timings) {
        project.analysis = {
            ...(project.analysis ?? {}),
            timings: timings.map((timing) => ({ refLineId: timing.refLineId, seconds: timing.seconds }))
        }
    }

    const snapshot = JSON.parse(JSON.stringify(config)) as ConfigState
    if (project.phases) {
        project.phases.config = { locked: project.phases.config?.locked ?? false, data: snapshot }
    }
    if (project.encounter?.config) project.encounter.config.data = JSON.parse(JSON.stringify(snapshot))
    if (!project.phases && !project.encounter?.config) {
        project.phases = { config: { locked: false, data: snapshot } }
    }
    return loaded.root
}

/** @desc 单个声骸最多可填的副词条数（模板里判断「添加」按钮是否可用） */
export const SUBSTAT_LIMIT = SUBSTAT_MAX

/** @desc 时间线数据（只声明切分时段 / 报告协议用到的字段） */
export interface TimelineLike {
    refLines?: { id: string; pos: number; name: string }[]
    damageBlocks?: {
        id: string
        sourceId: string
        sourceType?: string
        skillHits?: { catalogId?: string; [key: string]: unknown }[]
    }[]
    opBlocks?: { id: string; pos: number }[]
}

export const timelineOf = (project: EditableProject): TimelineLike | null =>
    (project.phases?.timeline?.data ?? project.encounter?.timeline?.data ?? null) as TimelineLike | null

export const calculationOf = (project: EditableProject): unknown =>
    project.phases?.calculation?.data ?? project.encounter?.calculation?.data ?? null

/** @desc 时段切分点：优先用工程已存的 timing；没有时按参考线名解析（与工具箱数据分析同口径） */
export const timingsOf = (project: EditableProject): FastCalcTiming[] => {
    const timeline = timelineOf(project)
    if (!timeline) return []
    const refLines = timeline.refLines ?? []
    const blocks = timeline.damageBlocks ?? []
    const opBlocks = timeline.opBlocks ?? []
    const refById = new Map(refLines.map((ref) => [ref.id, ref]))
    const posById = new Map<string, number>()
    for (const block of opBlocks) posById.set(block.id, block.pos)
    for (const ref of refLines) posById.set(ref.id, ref.pos)
    const labelOf = (id: string, index: number): string => {
        const round = /^round(\d+)$/.exec(id)
        if (round) return `第 ${round[1]} 轮结束`
        if (id === 'end') return '结束'
        return refById.get(id)?.name || `参考线 ${index + 1}`
    }
    const imported = project.analysis?.timings ?? []
    const source = imported.length
        ? imported
        : autoConfigureTimings(refLines, (pos) => blocks.some((block) => (posById.get(block.sourceId) ?? -1) > pos))
    return source.map((timing, index) => ({
        refLineId: timing.refLineId,
        label: labelOf(timing.refLineId, index),
        seconds: timing.seconds
    }))
}

/** @desc 按参考线位置窗口切分时段（与工具箱「数据分析 → 时段 DPS」同口径） */
export const segmentsOf = (
    entries: ResultEntry[],
    timings: FastCalcTiming[],
    project: EditableProject
): SegmentView[] => {
    const timeline = timelineOf(project)
    if (!timeline) return []
    const blocks = timeline.damageBlocks ?? []
    const refs = new Map((timeline.refLines ?? []).map((ref) => [ref.id, ref]))
    const blockToRef = new Map(blocks.map((block) => [block.id, block.sourceId]))
    const posById = new Map<string, number>()
    for (const block of timeline.opBlocks ?? []) posById.set(block.id, block.pos)
    for (const ref of refs.values()) posById.set(ref.id, ref.pos)
    const posOf = (entry: ResultEntry): number | null => {
        const target = blockToRef.get(entry.sourceTimelineBlockId) ?? entry.sourceTimelineBlockId
        const pos = posById.get(target)
        return typeof pos === 'number' ? pos : null
    }
    const anchors: { refLineId: string; seconds: number; pos: number }[] = []
    for (const timing of timings) {
        const pos = refs.get(timing.refLineId)?.pos
        if (timing.seconds === null || timing.seconds <= 0 || typeof pos !== 'number') continue
        anchors.push({ refLineId: timing.refLineId, seconds: timing.seconds, pos })
    }
    anchors.sort((a, b) => a.pos - b.pos)
    const segments: SegmentView[] = []
    let prevPos = 0
    let prevSeconds = 0
    for (const anchor of anchors) {
        const span = anchor.seconds - prevSeconds
        if (span <= 0) continue
        const list = entries.filter((entry) => {
            const pos = posOf(entry)
            return pos !== null && pos >= prevPos && pos < anchor.pos
        })
        const total = list.reduce((sum, entry) => sum + entry.totalDamage, 0)
        segments.push({
            key: anchor.refLineId,
            time: `${prevSeconds.toFixed(1)}s — ${anchor.seconds.toFixed(1)}s`,
            start: prevSeconds,
            end: anchor.seconds,
            total,
            dps: total / span,
            seconds: span,
            entries: list
        })
        prevPos = anchor.pos
        prevSeconds = anchor.seconds
    }
    return segments
}

/** @desc 表格乘区列：按引擎返回的乘区顺序取并集，只保留至少一条不等于 1 的列（新增乘区自动出现） */
export const zoneColumnsOf = (entries: ResultEntry[]): string[] => {
    const labels: string[] = []
    for (const entry of entries) {
        for (const zone of entry.multiplierZones) {
            if (!labels.includes(zone.label)) labels.push(zone.label)
        }
    }
    return labels.filter((label) =>
        entries.some(
            (entry) => Math.abs((entry.multiplierZones.find((zone) => zone.label === label)?.value ?? 1) - 1) > 1e-9
        )
    )
}

export const zoneValueOf = (entry: ResultEntry, label: string): { value: number; detail: string } | null => {
    const zone = entry.multiplierZones.find((item) => item.label === label)
    return zone ? { value: zone.value, detail: zone.detail } : null
}
