/**
 * @desc 自定义直伤 / 自定义倍率的**纯逻辑**：把结构化数值渲染成与技能表一致的倍率串。
 *
 * 抽出来的原因：这段格式化同时被「排轴倍率选择器」与「AI 自定义倍率工具」使用，
 * 两处各写一遍最容易出现「界面显示 ×2、AI 看到 ×1」这类口径漂移。
 */
import type { CustomHit } from './timeline.types'

/** @desc 自定义倍率的倍率串：固定值 / 百分比（带单位）逐项拼接，多段用 `*N` 后缀 */
export const customHitRatio = (hit: Pick<CustomHit, 'flatValue' | 'pctValue' | 'pctUnit' | 'hits'>): string => {
    const count = Math.max(1, hit.hits ?? 1)
    const suffix = count > 1 ? `*${count}` : ''
    const parts: string[] = []
    if (hit.flatValue > 0) parts.push(`${hit.flatValue}${suffix}`)
    if (hit.pctValue > 0) {
        const unit =
            hit.pctUnit === '攻击%'
                ? ''
                : hit.pctUnit === '生命%'
                  ? '生命'
                  : hit.pctUnit === '防御%'
                    ? '防御'
                    : hit.pctUnit
        parts.push(`${hit.pctValue}%${unit}${suffix}`)
    }
    return parts.join('+')
}
