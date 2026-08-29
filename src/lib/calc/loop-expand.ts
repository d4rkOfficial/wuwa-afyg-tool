// 分段 DPS 轴循环的共享展开逻辑：数据分析弹窗（分段表格/曲线/占比）与结果页（副词条贡献重算）共用同一口径。
// 语义：每个有效时间记点对应一小节（[上一个有效记点秒数, 该记点秒数]），记点上配置的循环次数 K 表示该小节重复 K 次；
// 展开后后续小节整体后移（时间偏移），位置区间不变（同一批条目重放）。

export interface LoopInterval {
    startSeconds: number
    endSeconds: number
    startPos: number
    endPos: number
    baseSegIdx: number
    loopIdx: number
}

/** @desc 按时间记点（含循环次数）展开段区间；无有效记点或全部次数 ≤1 时仍返回每段一份（loopIdx=0），供调用方自行判断是否启用循环 */
export function buildLoopIntervals(
    timings: { refLineId: string; seconds: number | null }[],
    refLines: { id: string; pos: number }[],
    loopCounts: Record<string, number>
): LoopInterval[] {
    const valid = timings
        .map((t) => ({ t, rl: refLines.find((r) => r.id === t.refLineId) }))
        .filter(
            (x): x is { t: { refLineId: string; seconds: number }; rl: { id: string; pos: number } } =>
                x.rl !== undefined && x.t.seconds !== null
        )
        .sort((a, b) => a.rl.pos - b.rl.pos)

    if (valid.length === 0) return []

    const result: LoopInterval[] = []
    let prevPos = 0
    let prevSec = 0
    let cursor = 0
    let segIdx = 0
    for (const { t, rl } of valid) {
        const spanSec = t.seconds - prevSec
        if (spanSec <= 0) {
            prevPos = rl.pos
            prevSec = t.seconds
            continue
        }
        const K = loopCounts[t.refLineId] ?? 1
        const baseSegIdx = segIdx
        for (let j = 0; j < K; j++) {
            result.push({
                startSeconds: cursor + j * spanSec,
                endSeconds: cursor + (j + 1) * spanSec,
                startPos: prevPos,
                endPos: rl.pos,
                baseSegIdx,
                loopIdx: j
            })
        }
        cursor += K * spanSec
        prevPos = rl.pos
        prevSec = t.seconds
        segIdx++
    }
    return result
}

/** @desc 展开伤害条目：循环段条目按展开份数复制（同一引用，伤害自然 ×K），无位置/非循环段条目保留一份 */
export function expandDamageEntries<T extends { id: string; sourceTimelineBlockId: string }>(
    entries: T[],
    blockPosMap: Map<string, number>,
    intervals: LoopInterval[]
): T[] {
    if (intervals.length === 0) return entries
    const expanded: T[] = []
    const emitted = new Set<string>()
    for (const iv of intervals) {
        for (const de of entries) {
            const pos = blockPosMap.get(de.sourceTimelineBlockId)
            if (pos !== undefined && pos >= iv.startPos && pos < iv.endPos) {
                expanded.push(de)
                emitted.add(de.id)
            }
        }
    }
    for (const de of entries) {
        if (!emitted.has(de.id)) expanded.push(de)
    }
    return expanded
}
