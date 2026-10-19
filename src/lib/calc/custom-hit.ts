/**
 * @desc 自定义直伤 / 自定义倍率的**纯逻辑**：把结构化数值渲染成与技能表一致的倍率串。
 *
 * 抽出来的原因：这段格式化同时被「排轴倍率选择器」与「AI 自定义倍率工具」使用，
 * 两处各写一遍最容易出现「界面显示 ×2、AI 看到 ×1」这类口径漂移。
 */
import type { CustomHit } from './timeline.types'

/** @desc 百分比单位 → 倍率串后缀（攻击% 省略后缀，生命%/防御% 写成 `%生命` / `%防御`） */
const pctUnitSuffix = (unit: string): string =>
    unit === '攻击%' ? '' : unit === '生命%' ? '生命' : unit === '防御%' ? '防御' : unit

/** @desc 倍率串里的各项（固定值 / 百分比），`suffix` 用于可选的 `*N` 段数后缀 */
const ratioTerms = (hit: Pick<CustomHit, 'flatValue' | 'pctValue' | 'pctUnit'>, suffix: string): string[] => {
    const terms: string[] = []
    if (hit.flatValue > 0) terms.push(`${hit.flatValue}${suffix}`)
    if (hit.pctValue > 0) terms.push(`${hit.pctValue}%${pctUnitSuffix(hit.pctUnit)}${suffix}`)
    return terms
}

/**
 * @desc 零值条目的占位倍率：固定值 / 百分比都为 0 时仍要渲染成可解析的 `0%`，
 * 否则倍率串为空会被下游 `parseValueString` 当成「没有倍率」而整条吞掉。
 */
const zeroRatio = (pctUnit: string): string => `0%${pctUnitSuffix(pctUnit)}`

/** @desc 自定义倍率的倍率串：固定值 / 百分比（带单位）逐项拼接，多段用 `*N` 后缀 */
export const customHitRatio = (hit: Pick<CustomHit, 'flatValue' | 'pctValue' | 'pctUnit' | 'hits'>): string => {
    const count = Math.max(1, hit.hits ?? 1)
    const suffix = count > 1 ? `*${count}` : ''
    const terms = ratioTerms(hit, suffix)
    return terms.length > 0 ? terms.join('+') : zeroRatio(hit.pctUnit)
}

/**
 * @desc 不含段数后缀的倍率串：绑定到伤害块时，段数由 `SkillHit.hits` 单独携带，
 * 倍率串里再写 `*N` 会被下游重复乘一次。
 */
export const customHitRatioBase = (hit: Pick<CustomHit, 'flatValue' | 'pctValue' | 'pctUnit'>): string => {
    const terms = ratioTerms(hit, '')
    return terms.length > 0 ? terms.join('+') : zeroRatio(hit.pctUnit)
}
