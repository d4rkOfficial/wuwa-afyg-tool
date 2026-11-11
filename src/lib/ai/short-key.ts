/**
 * @desc 排轴操作块 / 参考线的**短索引**（稳定、可读、零持久化）。
 *
 * 为什么不用「第几个」：位置序号会随移动 / 删除漂移，AI 工具拿到 `[块3]` 后一旦发生任何
 * 增删改，`3` 就可能指向别的块 —— 批量操作会静默错位。
 *
 * 为什么不做成持久化字段：短索引只是 `id` 的**纯函数投影**，`id` 本身已经持久化且永不重写
 * （`move_op_block` / `reflow_track` / `format_timeline` 全是 `{...b, pos}` 展开），
 * 所以派生出来天然「绝对不变」，不需要任何额外存储或迁移。
 *
 * 编码：FNV-1a（32 位）→ 对 36^5 取模 → 5 位 base36，如 `xlm8n`。
 * 取模而不是「截哈希的高位」：32 位哈希在 base36 下第 7 位恒为 0/1，截高位实测熵只剩 4 位。
 * 碰撞率按 36^5 ≈ 6040 万算，100 个块 ≈ 0.008%；解析侧仍会显式检测碰撞并报错，不做「取第一个」。
 */

/** @desc 短索引固定长度（改这个会改变所有已生成短索引，仅在确认无引用时才动） */
export const SHORT_KEY_LEN = 5

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
const MOD = 36 ** SHORT_KEY_LEN

/** @desc FNV-1a 32 位哈希（`Math.imul` 保证 32 位乘法不丢精度） */
const fnv1a = (text: string): number => {
    let hash = FNV_OFFSET_BASIS
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i)
        hash = Math.imul(hash, FNV_PRIME) >>> 0
    }
    return hash
}

/**
 * @desc 内部 id → 短索引（纯函数：同一个 id 永远得到同一个值，与顺序、位置、时间无关）。
 * 例：`b1731234567890` → `xlm8n`、`left` → `2pxm8`。
 */
export const shortKeyOf = (id: string): string => (fnv1a(id) % MOD).toString(36).padStart(SHORT_KEY_LEN, '0')
