/**
 * @desc 直伤命中的**稳定标识**（零持久化，纯函数）。
 *
 * 为什么不用「第几条」：`get_damage_bindings` 给出 `hitIndex` 后，只要期间发生任何增删
 * （另一个客户端解绑了一条、AI 自己多绑了一条），同一个下标就会指向**另一条命中** ——
 * `update_damage_hit` 会静默改错倍率，`unbind_damage_hit` 会解错条目。
 *
 * 稳定标识由命中的**身份**派生，而身份只取绑定时不变量：
 * `character | skillType | hitName` + 「同名同技能的第几条」（同名重复绑定才需要）。
 *
 * 关键性质：`update_damage_hit` 只能改 `ratio` / `element` / `hits`（段数），这三样**都不在身份里**，
 * 所以「改完再按同一个标识操作」一定还命中同一条 —— 这正是之前 `hitIndex` 做不到的。
 * 反之若 `skillHits` 被 `bind_damage_to_block` 整体覆盖，标识自然随内容重算，不会错误命中旧条目。
 */
import { shortKeyOf } from '$lib/ai/short-key'
import type { SkillHit } from '$lib/calc/timeline.types'

/** @desc 命中的身份（不含倍率 / 属性 / 段数，这三项可以改而身份不变） */
const hitIdentity = (hit: Pick<SkillHit, 'character' | 'skillType' | 'hitName'>): string =>
    `${hit.character}\u0000${hit.skillType}\u0000${hit.hitName}`

/**
 * @desc 一个伤害块上每条直伤命中的稳定标识（与 `skillHits` 同序）。
 * 同身份的第 2、3 条通过序号区分，例如同一命中被绑了两次。
 */
export const damageHitKeys = (hits: readonly SkillHit[]): string[] => {
    const seen = new Map<string, number>()
    return hits.map((hit) => {
        const base = hitIdentity(hit)
        const ordinal = seen.get(base) ?? 0
        seen.set(base, ordinal + 1)
        return shortKeyOf(`${base}\u0000${ordinal}`)
    })
}

/**
 * @desc 按稳定标识定位命中下标（0 起）。找不到时抛错并给出可选清单，模型可自我纠正。
 * 正常情况下标识由 {@link damageHitKeys} 生成且唯一；这里仍做一次碰撞检测，避免「取第一个」。
 */
export const resolveDamageHitKey = (hits: readonly SkillHit[], ref: unknown): number => {
    const raw = String(ref ?? '').trim()
    if (!raw) throw new Error('缺少命中标识（先用 get_damage_bindings 查 hitKey）')
    const keys = damageHitKeys(hits)
    const hits2 = keys.map((key, index) => ({ key, index })).filter((x) => x.key === raw)
    if (hits2.length === 1) return hits2[0].index
    if (hits2.length > 1) throw new Error(`命中标识冲突：${raw} 命中 ${hits2.length} 条（内部数据重复）`)
    const roster = hits
        .slice(0, 12)
        .map((hit, index) => `${keys[index]}=${hit.character}·${hit.hitName}`)
        .join('、')
    const more = hits.length > 12 ? ` …（共 ${hits.length} 条）` : ''
    throw new Error(`未找到命中「${raw}」。请用 get_damage_bindings 返回的 hitKey。可选：${roster}${more}`)
}
