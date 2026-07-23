export interface HitComponent {
    ratioNum: number
    baseType: string
    flatValue?: number
    implicitSuffix?: boolean
    mult?: number
}

const SUFFIX_MAP: Record<string, string> = {
    '': '攻击',
    生命: '生命',
    防御: '防御'
}

export function parseValueString(value: string): HitComponent[] {
    if (!value || value === '0') return []

    const parts = value.split('+')
    const result: HitComponent[] = []

    for (const part of parts) {
        const trimmed = part.trim()
        if (!trimmed) continue

        const pctIdx = trimmed.indexOf('%')
        if (pctIdx !== -1) {
            const numStr = trimmed.slice(0, pctIdx)
            let suffix = trimmed.slice(pctIdx + 1)
            if (!suffix) suffix = ''

            // extract per-part multiplier: product of all *N after %
            let mult = 1
            while (/^\*\d+/.test(suffix)) {
                const m = suffix.match(/^\*(\d+)/)
                if (m) {
                    mult *= parseInt(m[1], 10)
                    suffix = suffix.slice(m[0].length)
                }
            }

            const num = parseFloat(numStr)
            if (isNaN(num)) continue

            const ratioNum = num
            const implicitSuffix = suffix === ''
            const baseType = SUFFIX_MAP[suffix] ?? suffix

            result.push({ ratioNum, baseType, implicitSuffix, mult: mult > 1 ? mult : undefined })
        } else {
            const flatValue = parseFloat(trimmed)
            if (isNaN(flatValue) || flatValue === 0) continue

            result.push({ flatValue, baseType: '固定', ratioNum: 0 })
        }
    }

    return result
}

export function sumRatioNum(_components: HitComponent[]): number {
    return 0
}

export function computeHitBase(_comp: HitComponent, _stats: Record<string, number>): number {
    return 0
}

export function computeTotalBase(_components: HitComponent[], _stats: Record<string, number>): number {
    return 0
}

export function formatRatio(_components: HitComponent[]): string {
    return ''
}
