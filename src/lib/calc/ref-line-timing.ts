// 时间参考线秒数解析（纯函数）：从参考线命名提取时间片段 → 秒数。
// 供「数据分析」弹窗与 AI/WS 时间记点工具共用，确保同源口径。
//
// 规则：
// 1) 数字紧邻单位（分/秒/帧/min/sec/m/s/f）即时间片段，可在名称任意位置；相邻片段合并（1m30s50f）
// 2) 裸数字仅独立片段（前后不与中文/字母/数字紧贴）才算
// 3) 多个片段取最后一个；带单位优先于裸数字
// 返回 { relative, seconds }；无时间片段返回 null

export interface RefLineLike {
    id: string
    /** 参考线在时间轴上的像素位置（用于排序） */
    pos: number
    /** 参考线名称（含时间片段，如 "1m30s"、"起手"、"right"=结束线） */
    time: string
}

export interface TimingEntry {
    refLineId: string
    seconds: number | null
}

/** 时间片段前（可隔空格）紧邻 '+' → 相对追加 */
const hasAdjacentPlus = (raw: string, fragStart: number): boolean => {
    let i = fragStart - 1
    while (i >= 0 && /\s/.test(raw[i])) i--
    return i >= 0 && raw[i] === '+'
}

/** 参考线命名 → 时间片段（{ relative, seconds }）；无片段返回 null */
export const parseRefLineSeconds = (raw: string): { relative: boolean; seconds: number } | null => {
    if (!raw) return null
    const UNIT_PAT = /(\d+(?:\.\d+)?)\s*(分|秒|帧|min|sec|m|s|f)/g

    // 单位片段：数字 + 紧邻单位
    const unitHits: { start: number; end: number; seconds: number }[] = []
    let m: RegExpExecArray | null
    while ((m = UNIT_PAT.exec(raw)) !== null) {
        const v = parseFloat(m[1])
        const u = m[2]
        const sec = u === '分' || u === 'min' || u === 'm' ? v * 60 : u === '帧' || u === 'f' ? v / 100 : v
        unitHits.push({ start: m.index, end: m.index + m[0].length, seconds: sec })
    }
    // 合并相邻单位片段（允许空白间隔）：1m30s50f / 1m 30s
    const merged: { start: number; end: number; seconds: number }[] = []
    for (const h of unitHits) {
        const last = merged[merged.length - 1]
        if (last && raw.slice(last.end, h.start).trim() === '') {
            last.end = h.end
            last.seconds += h.seconds
        } else {
            merged.push({ ...h })
        }
    }
    // 有单位片段 → 带单位优先，取最后一个
    if (merged.length > 0) {
        const frag = merged[merged.length - 1]!
        return { relative: hasAdjacentPlus(raw, frag.start), seconds: frag.seconds }
    }

    // 无单位片段 → 独立裸数字（前后不与中文/字母/数字紧贴）取最后一个
    const NUM_PAT = /\d+(?:\.\d+)?/g
    const bare: { start: number; end: number; value: number }[] = []
    while ((m = NUM_PAT.exec(raw)) !== null) {
        const before = raw[m.index - 1] ?? ''
        const after = raw[m.index + m[0].length] ?? ''
        if (/[\u4e00-\u9fffA-Za-z0-9]/.test(before) || /[\u4e00-\u9fffA-Za-z0-9]/.test(after)) continue
        bare.push({ start: m.index, end: m.index + m[0].length, value: parseFloat(m[0]) })
    }
    if (bare.length > 0) {
        const frag = bare[bare.length - 1]!
        return { relative: hasAdjacentPlus(raw, frag.start), seconds: frag.value }
    }
    return null
}

/**
 * 启用参考线作为时间记点时，按其命名解析秒数：
 * - 结束线（id='right'）默认 120s（≤ 上一记点则 +30s 直到大于）
 * - 名称无时间片段返回 null（未解析，不参与分段）
 * - 相对片段（前缀 +）→ 上一记点秒数 + 片段值；绝对片段但早于上一记点 → 改走相对追加
 * @param id 参考线 id
 * @param refLines 全部参考线（含 id/pos/time）
 * @param timings 现有时间记点（用于推算「上一有效记点」）
 */
export const resolveRefLineSeconds = (id: string, refLines: RefLineLike[], timings: TimingEntry[]): number | null => {
    const rl = refLines.find((r) => r.id === id)
    const raw = rl?.time ?? ''
    // 候选集合 = 现有记点 + 新记点（秒数置 null），按参考线位置排序
    const candidate = [...timings, { refLineId: id, seconds: null }]
        .filter((t) => refLines.some((r) => r.id === t.refLineId))
        .sort((a, b) => {
            const aRl = refLines.find((r) => r.id === a.refLineId)
            const bRl = refLines.find((r) => r.id === b.refLineId)
            return (aRl?.pos ?? 0) - (bRl?.pos ?? 0)
        })
    const idx = candidate.findIndex((t) => t.refLineId === id)
    // 上一有效记点（跳过未解析的「未填写」记点）
    let prevSeconds = 0
    for (let i = idx - 1; i >= 0; i--) {
        if (candidate[i]!.seconds !== null) {
            prevSeconds = candidate[i]!.seconds!
            break
        }
    }

    // 结束线：默认 120s，不满足「> 上一记点」则每次 +30s 直到满足
    if (id === 'right') {
        let sec = 120
        while (sec <= prevSeconds) sec += 30
        return sec
    }

    const parsed = parseRefLineSeconds(raw)
    if (!parsed) return null
    let seconds = parsed.relative ? prevSeconds + parsed.seconds : parsed.seconds
    // 绝对时间早于上一记点 → 改走相对追加
    if (!parsed.relative && seconds < prevSeconds) seconds = prevSeconds + parsed.seconds
    return seconds
}
