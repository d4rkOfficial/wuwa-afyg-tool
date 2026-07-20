export interface HitComponent {
    ratioNum: number
    baseStat: 'atk' | 'hp' | 'def' | 'tune' | 'flat'
    hits: number
    flatValue?: number
    statLabel?: string
}

const STAT_MAP: Record<string, 'hp' | 'def' | 'tune'> = {
    生命: 'hp',
    防御: 'def',
    偏谐系数: 'tune'
}

/**
 * 解析 value 字符串为 HitComponent 数组
 *
 * "31.78%"              → [{ ratioNum:0.3178, baseStat:'atk', hits:1 }]
 * "23.86%*2"            → [{ ratioNum:0.2386, baseStat:'atk', hits:2 }]
 * "19.64%*3生命"        → [{ ratioNum:0.1964, baseStat:'hp',   hits:3 }]
 * "522.33%防御"         → [{ ratioNum:5.2233, baseStat:'def',  hits:1 }]
 * "22.27%+16.71%*2"     → [{ ratioNum:0.2227, baseStat:'atk', hits:1 },
 *                          { ratioNum:0.1671, baseStat:'atk', hits:2 }]
 * "500+30%"             → [{ ratioNum:500,    baseStat:'flat', hits:1 },
 *                          { ratioNum:0.30,   baseStat:'atk', hits:1 }]
 * "500"                 → [{ ratioNum:500,    baseStat:'flat', hits:1 }]
 */
export function parseValueString(value: string): HitComponent[] {
    if (!value || value === '—') return [{ ratioNum: 0, baseStat: 'atk', hits: 1 }]

    const parts = value.split('+') as string[]
    const result: HitComponent[] = []

    for (const part of parts) {
        const trimmed = part.trim()
        if (!trimmed) continue

        // Check for flat value first (no % sign)
        if (!trimmed.includes('%')) {
            const num = parseFloat(trimmed)
            if (!isNaN(num)) {
                result.push({ ratioNum: num, baseStat: 'flat', hits: 1, flatValue: num })
            }
            continue
        }

        // Percentage value with optional *N and optional stat label
        // Format: {pct}%[*{N}][{statLabel}]
        const match = trimmed.match(/^([\d.]+)%(?:\*(\d+))?(生命|防御|偏谐系数)?$/)
        if (match) {
            const pct = parseFloat(match[1]) / 100
            const hitCount = match[2] ? parseInt(match[2]) : 1
            const label = match[3] as string | undefined
            const baseStat = label ? (STAT_MAP[label] ?? 'atk') : 'atk'

            result.push({
                ratioNum: pct,
                baseStat,
                hits: hitCount,
                statLabel: label
            })
        } else {
            // Fallback: just try to extract a number
            const num = parseFloat(trimmed.replace(/[^0-9.]/g, ''))
            if (!isNaN(num)) {
                result.push({ ratioNum: num / 100, baseStat: 'atk', hits: 1 })
            }
        }
    }

    return result.length > 0 ? result : [{ ratioNum: 0, baseStat: 'atk', hits: 1 }]
}

/**
 * 计算单个 HitComponent 的基础伤害（不含增伤/防御/抗性等乘区）
 */
export function computeHitBase(
    comp: HitComponent,
    stats: { atk: number; hp: number; def: number; tune: number }
): number {
    if (comp.baseStat === 'flat') return comp.ratioNum * comp.hits

    const statValue = stats[comp.baseStat] ?? 0
    return statValue * comp.ratioNum * comp.hits
}

/**
 * 计算 HitComponent[] 的总基础伤害
 */
export function computeTotalBase(
    components: HitComponent[],
    stats: { atk: number; hp: number; def: number; tune: number }
): number {
    return components.reduce((sum, c) => sum + computeHitBase(c, stats), 0)
}

/**
 * 总和 ratioNum（用于现有系统的 ratioNum 兼容）
 */
export function sumRatioNum(components: HitComponent[]): number {
    return components.reduce((s, c) => {
        if (c.baseStat === 'flat') return s + c.ratioNum
        return s + c.ratioNum * c.hits
    }, 0)
}

/**
 * 获取显示用的比率字符串
 */
export function formatRatio(components: HitComponent[]): string {
    const parts = components.map((c) => {
        if (c.baseStat === 'flat') return c.ratioNum.toString()
        const pct = (c.ratioNum * 100).toFixed(2)
        const suffix = c.hits > 1 ? `×${c.hits}` : ''
        const label = c.statLabel ?? ''
        return pct + '%' + suffix + label
    })
    return parts.join('+')
}
