// ── 背景图遮罩（纯函数） ──────────────────────────────────────────────────
// 「外观 → 背景图遮罩」把整张背景图整体压暗 / 提白，独立于各区域质感。
// 取值范围与换算集中在这里：设置面板的滑杆、工作区 :root 上的 --theme-bg-mask、
// AI 工具的入参校验都从这里取，避免三处各写一遍口径。

/** @desc 遮罩取值范围：-200 全黑 ~ 0 原图 ~ 200 极白 */
export const BG_MASK_MIN = -200
export const BG_MASK_MAX = 200

export interface BgMaskColor {
    /** @desc CSS rgb 三元组：压暗用黑、提白用白 */
    rgb: '0, 0, 0' | '255, 255, 255'
    /** @desc 遮罩不透明度 0-1（0 = 不铺遮罩） */
    alpha: number
}

/**
 * @desc 遮罩取值 → 颜色与不透明度：
 * - 压暗段分两档：0 ~ -100 沿用旧口径（-100 = 60% 黑，老配置观感不变），
 *   -100 ~ -200 再线性加浓到全黑（-200 = 100% 黑，可把背景图压到全黑）；
 * - 提白段沿用旧口径：0 ~ 200 → 0 ~ 70% 白（斜率减半，避免过曝）。
 */
export const bgMaskOf = (mask: number): BgMaskColor => {
    const v = Math.max(BG_MASK_MIN, Math.min(BG_MASK_MAX, Number.isFinite(mask) ? mask : 0))
    if (v >= 0) return { rgb: '255, 255, 255', alpha: v === 0 ? 0 : Math.min(0.8, (v / 100) * 0.35) }
    const abs = Math.abs(v)
    const alpha = abs <= 100 ? (abs / 100) * 0.6 : 0.6 + ((abs - 100) / 100) * 0.4
    return { rgb: '0, 0, 0', alpha: Math.min(1, alpha) }
}

/** @desc 遮罩取值 → CSS 背景色（0 与越界值都按 clamp 后处理；0 返回 transparent） */
export const bgMaskCss = (mask: number): string => {
    const { rgb, alpha } = bgMaskOf(mask)
    return alpha <= 0 ? 'transparent' : `rgba(${rgb}, ${alpha.toFixed(3)})`
}

/** @desc 遮罩取值 → 设置面板的数值文案 */
export const bgMaskLabel = (mask: number): string => {
    const v = Math.max(BG_MASK_MIN, Math.min(BG_MASK_MAX, Number.isFinite(mask) ? mask : 0))
    if (v === 0) return '原图'
    if (v <= BG_MASK_MIN) return '全黑'
    if (v < 0) return `压暗 ${Math.abs(v)}%`
    return v > 100 ? `极白 ${v - 100}%` : `偏白 ${v}%`
}
