/**
 * @desc 时间轴（排轴）数据的结构性归一化迁移。
 */

import { isRecord } from './shared'

// ── 工程迁移链 ──

/**
 * @desc 旧版「普攻块用备注标注重击」的两种备注形态：
 * ① 纯标记「重击」—— 图标已能表达，升级后清空；
 * ② `z` / `Z` 开头（可紧跟段数数字，数字为空也行，其后任意内容）—— 是用户手写的补充信息（如 z3 表示第 3 段），升级后**保留**。
 */
const HEAVY_NOTE = '重击'
const HEAVY_NOTE_PATTERN = /^[zZ]\d*/

/**
 * @desc 把旧版靠备注区分重击的普攻块升级为独立重击块（key 换成 MouseLeftHold = 新重击图标）：
 * - 备注恰好是「重击」：清空备注（图标已能区分，不再需要「重击」二字）；
 * - 备注以 z/Z 开头（可紧跟数字，数字为空也匹配）：保留备注内容，只换图标。
 *
 * 只改「key 仍是普攻 MouseLeft」的块，其余块原样返回；
 * 幂等（再跑一次不会命中），故也可作为结构性归一化在迁移链之外兜底（见 `migrateProject`）。
 */
export const migrateHeavyPressOpBlocks = (timeline: unknown): unknown => {
    if (!isRecord(timeline) || !Array.isArray(timeline.opBlocks)) return timeline
    let changed = false
    const opBlocks = timeline.opBlocks.map((block) => {
        if (!isRecord(block) || block.key !== 'MouseLeft') return block
        const desc = typeof block.desc === 'string' ? block.desc : ''
        if (desc === HEAVY_NOTE) {
            changed = true
            return { ...block, key: 'MouseLeftHold', desc: '' }
        }
        if (!HEAVY_NOTE_PATTERN.test(desc)) return block
        changed = true
        return { ...block, key: 'MouseLeftHold' }
    })
    return changed ? { ...timeline, opBlocks } : timeline
}

/**
 * @desc 修复重复的伤害块 id（幂等，与版本无关地兜底）。
 *
 * 为什么会有重复：`addDamageBlock()` 曾直接用 `d${Date.now()}` 作 id —— 同一毫秒内连建多块
 * （AI 批量排轴、连续录入）就会撞车。伤害条目 id 由「块 id + 技能/命中/基础类型」派生，
 * 块 id 重复 ⇒ 条目 id 重复 ⇒ 拉表（下拉 / 平铺）的 `{#each … (entry.id)}` 抛 `each_key_duplicate`
 * 整表白屏；此外 `removeDamageBlock(id)` 会一次删掉两块、绑定表也会互相覆盖。
 *
 * 口径：**首个保留原 id**，其后重复的追加 `-2` / `-3`；无重复时原对象原样返回（保持幂等与引用不变）。
 * 代价：被改名的块，其条目的既有 Buff 绑定（按旧条目 id 存）会落空 —— 但那批绑定本来就和第一块共用同一份。
 */
export const dedupeDamageBlockIds = (timeline: unknown): unknown => {
    if (!isRecord(timeline) || !Array.isArray(timeline.damageBlocks)) return timeline
    const used = new Set<string>()
    let changed = false
    const damageBlocks = timeline.damageBlocks.map((block) => {
        const id = isRecord(block) ? String(block.id ?? '') : ''
        if (!id) return block
        if (!used.has(id)) {
            used.add(id)
            return block
        }
        let n = 2
        while (used.has(`${id}-${n}`)) n++
        const nextId = `${id}-${n}`
        used.add(nextId)
        changed = true
        return { ...(block as Record<string, unknown>), id: nextId }
    })
    return changed ? { ...timeline, damageBlocks } : timeline
}
