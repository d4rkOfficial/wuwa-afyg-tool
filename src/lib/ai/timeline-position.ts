/**
 * @desc 排轴位置参数解析（AI 工具共用，纯函数）。
 *
 * 排轴统一用 **pos 定位**：pos 是时间轴上的像素坐标，与摘要 `get_timeline_summary`
 * 输出的 `items[].pos` 同一坐标系、**与秒数无关**。`{time: 秒}` 这种秒数定位不受支持：
 * 传入会直接报错并给出改写方式（不做静默兼容，避免两种坐标语义在参数里并存）。
 *
 * 两种写法：
 * - `{ pos }` —— 绝对位置，取值 0..当前结束线（`getMaxPos()`）
 * - `{ anchor, side?, offset? }` —— 相对某个操作块，`offset` 也是**坐标偏移**（不是秒）
 */

/** @desc 操作块标准宽度（像素）：相对定位时以「半个块宽」为贴靠基准 */
export const BLOCK_W = 60

export interface PositionResolveDeps {
    /** 当前有效右边界（像素） */
    maxPos: number
    /** anchor 短索引 → 目标操作块坐标；定位失败时自行抛错 */
    anchorPos: (ref: unknown) => number
    /** 操作块宽度（默认 {@link BLOCK_W}） */
    blockWidth?: number
}

/** @desc 位置参数 → 像素坐标；非法输入抛错（错误信息直接面向模型，须可自我纠正） */
export const parsePositionArgs = (position: Record<string, unknown>, deps: PositionResolveDeps): number => {
    if (position.time !== undefined) {
        throw new Error(
            'position.time 不是有效参数：排轴统一用 pos 定位，请改传 {pos: 排轴坐标}（与 get_timeline_summary 的 pos 同坐标系），或用 {anchor, side, offset} 相对定位'
        )
    }
    if (position.pos !== undefined) {
        const pos = Number(position.pos)
        const { maxPos } = deps
        if (!Number.isFinite(pos) || pos < 0 || pos > maxPos) {
            throw new Error(`pos 须为 0-${maxPos}（排轴坐标，与 get_timeline_summary 的 pos 同坐标系）`)
        }
        return pos
    }
    const anchorRef = position.anchor
    if (anchorRef === undefined || anchorRef === null || String(anchorRef).trim() === '') {
        throw new Error('需要 pos（排轴坐标）或 anchor（目标操作块短索引）')
    }
    const anchorPos = deps.anchorPos(anchorRef)
    const side = String(position.side ?? '').trim() === 'before' ? 'before' : 'after'
    const offset = Number(position.offset ?? 0)
    if (!Number.isFinite(offset) || offset < 0) throw new Error('offset 须为非负数字（坐标偏移）')
    const gap = (deps.blockWidth ?? BLOCK_W) / 2 + offset
    return side === 'before' ? anchorPos - gap : anchorPos + gap
}
