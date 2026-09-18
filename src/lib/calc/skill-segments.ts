/** @desc 游戏技能倍率串里的单个命中段（`60.00%*2+40.00%*3` 展开后为 5 段） */
export interface RatioHit {
    /** @desc 数值：% 段为百分数（60 = 60%），固定值段为点数 */
    value: number
    /** @desc 单位：'攻击%' / '生命%' / '防御%' / ''（固定值） */
    unit: string
    kind: '%' | 'fixed'
}

const TOKEN_RE = /^\s*(\d+(?:\.\d+)?)\s*(%?)\s*(生命|防御|攻击|偏谐系数)?\s*(?:\*\s*(\d+))?\s*$/

/**
 * @desc 解析技能倍率串为逐段命中列表（每段一行，`*N` 按 N 次展开）：
 * - 支持 `60.00%*2+40.00%*3`、`809.48%`、`100`（固定值）、`8%生命`、`12%防御`、`60%偏谐系数` 等写法；
 * - 无法识别的片段直接跳过（忽略而不是整串失败）。
 */
export function parseRatioHits(ratio: string): RatioHit[] {
    const hits: RatioHit[] = []
    for (const token of String(ratio ?? '').split('+')) {
        const m = TOKEN_RE.exec(token)
        if (!m) continue
        const value = parseFloat(m[1])
        if (!Number.isFinite(value) || value <= 0) continue
        const count = m[4] ? Math.max(1, parseInt(m[4], 10)) : 1
        const kind: RatioHit['kind'] = m[2] === '%' ? '%' : 'fixed'
        const suffix = m[3] ?? '攻击'
        const unit = kind === '%' ? (suffix === '偏谐系数' ? '偏谐系数' : `${suffix}%`) : ''
        for (let i = 0; i < count; i++) hits.push({ value, unit, kind })
    }
    return hits
}

export interface SelectedHitsSummary {
    /** @desc 单段倍率（同倍率选择时为该倍率，混合选择时为所选段之和） */
    ratio: number
    /** @desc 段数（同倍率选择时为所选段数，混合选择固定为 1） */
    hits: number
    /** @desc 单位（同倍率选择时取该单位，混合选择取第一个 % 段单位） */
    unit: string
    kind: '%' | 'fixed'
    /** @desc 所选段倍率是否完全一致（决定 ratio/hits 的拆法） */
    uniform: boolean
    /** @desc 所选段合计倍率（用于 UI 展示，恒等于 ratio × hits） */
    total: number
}

/**
 * @desc 把所选段折算成「单段倍率 + 段数」：
 * - 所选段倍率一致（最常见的“只要其中 N 段”场景）→ 倍率=该段倍率、段数=N，合计精确；
 * - 所选段倍率不一致（如 60%×2 + 40%×1）→ 倍率=所选段之和、段数=1，合计同样精确（工具按 ratio×hits 计算总倍率）。
 */
export function summarizeSelectedHits(selected: RatioHit[]): SelectedHitsSummary {
    const first = selected[0]
    const uniform = selected.every((h) => h.value === first.value && h.unit === first.unit && h.kind === first.kind)
    const total = selected.reduce((sum, h) => sum + h.value, 0)
    return {
        ratio: uniform ? first.value : total,
        hits: uniform ? selected.length : 1,
        unit: first.unit,
        kind: first.kind,
        uniform,
        total
    }
}
