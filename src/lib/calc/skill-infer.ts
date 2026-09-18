import type { CharacterInfo } from '$lib/api/types'
import type { DamageEntry } from './calculation.types'
import type { CharSlot } from '$lib/types/project'

/** @desc 规则1：技能倍率名里的类型前缀 → 对应伤害类型 */
const NAME_PREFIX_TYPES: Array<[string, string]> = [
    ['普攻·', '普攻伤害'],
    ['重击·', '重击伤害'],
    ['共鸣技能·', '共鸣技能伤害'],
    ['共鸣解放·', '共鸣解放伤害'],
    ['变奏技能·', '变奏技能伤害'],
    ['延奏技能·', '延奏技能伤害']
]

/** @desc 规则2：技能文案「视为/为 XX 伤害」里的伤害名（含「XX效应」通配） */
const VIEW_AS_RE =
    /(视为|为)([^，。；、！？,.\s]{1,4}效应|普攻|重击|共鸣技能|共鸣解放|声骸技能|变奏技能|延奏技能|协同攻击)伤害/g

/** @desc 去掉富文本标签（`<color=`、`<te href=>`、`<size=>` 等）并压缩空白：
 *  必须先剥标签，否则 `<te href=1>共鸣技能</te>` 会把「共鸣技能」拆开导致匹配失败 */
export function stripRichTags(text: string): string {
    return String(text ?? '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, '')
}

function typeWordToDamageType(word: string): string {
    if (word === '协同攻击') return '协同攻击伤害'
    if (word.endsWith('效应')) return '效应伤害'
    return `${word}伤害`
}

/**
 * @desc 规则2：从技能文案里匹配「<技能><视为|为><…伤害>」。
 * 返回伤害类型（如「共鸣技能伤害」/「效应伤害」），匹配不到返回 null。
 * 排除「不作为…伤害」「非…伤害」这类否定写法。
 */
export function matchSkillTextOverride(text: string): string | null {
    const plain = stripRichTags(text)
    if (!plain) return null
    const re = new RegExp(VIEW_AS_RE.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(plain)) !== null) {
        if (m[1] === '为') {
            const prev = plain[m.index - 1]
            if (prev === '不' || prev === '非' || prev === '勿') continue
        }
        return typeWordToDamageType(m[2])
    }
    return null
}

/** @desc 规则1：倍率名命中「普攻·/重击·/共鸣技能·/…」前缀时返回对应伤害类型 */
export function matchHitNamePrefix(hitName: string): string | null {
    for (const [prefix, type] of NAME_PREFIX_TYPES) {
        if (hitName.includes(prefix)) return type
    }
    return null
}

/**
 * @desc 取出与该伤害条目相关的技能文案（先按「命中名出现在技能倍率行里」精确匹配，
 * 匹配不到再退回同技能类型的全部技能）；用于规则2的富文本匹配。
 */
export function skillDescriptionsFor(
    info: CharacterInfo | null | undefined,
    entry: Pick<DamageEntry, 'hitName' | 'skillType'>
): string[] {
    const skills = info?.skills
    if (!Array.isArray(skills) || skills.length === 0) return []
    const exact = skills.filter((s) => (s.values ?? []).some((v) => v[0] === entry.hitName))
    const pool = exact.length > 0 ? exact : skills.filter((s) => s.type === entry.skillType)
    return pool.map((s) => s.desc ?? '').filter(Boolean)
}

/** @desc 规则2 的便捷入口：在候选技能文案（角色技能 + 额外文案，如声骸技能）里找到第一条「视为/为 XX 伤害」 */
export function inferFromSkillText(
    info: CharacterInfo | null | undefined,
    entry: Pick<DamageEntry, 'hitName' | 'skillType'>,
    extraDescs: string[] = []
): string | null {
    for (const desc of [...skillDescriptionsFor(info, entry), ...extraDescs]) {
        const hit = matchSkillTextOverride(desc)
        if (hit) return hit
    }
    return null
}

/**
 * @desc 声骸技能条目的候选文案索引（entryId → 首位声骸技能文案）：
 * 声骸技能来自角色的「首位声骸」，其文案挂在 EchoInfo.skill.desc 上，按角色槽位的首位声骸名取。
 */
export function buildEchoDescByEntry(
    entries: Array<Pick<DamageEntry, 'id' | 'character' | 'skillType'>>,
    team: Array<Pick<CharSlot, 'character' | 'echoes'>>,
    echoSkillText: Record<string, string>
): Record<string, string> {
    const echoByChar = new Map<string, string>()
    for (const slot of team) {
        if (slot.character) echoByChar.set(slot.character, slot.echoes?.[0]?.name ?? '')
    }
    const out: Record<string, string> = {}
    for (const entry of entries) {
        if (entry.skillType !== '声骸技能') continue
        const echoName = entry.character ? echoByChar.get(entry.character) : ''
        const desc = echoName ? echoSkillText[echoName] : ''
        if (desc) out[entry.id] = desc
    }
    return out
}
