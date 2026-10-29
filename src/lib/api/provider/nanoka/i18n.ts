// ── nanoka 译文覆盖层 ─────────────────────────────────────────────────────
// 中文详情负责全部数值/结构计算（见 utils.ts），本文件只把计算结果里的
// 「展示文本」换成目标语言详情里的原文。
//
// 约定：
// - 只处理非中文；中文请求原样返回，避免把中文规则生成的结果覆盖回上游基础文案。
// - 映射键一律用跨语言稳定的 id（skill_trees / chains / tag / group / set 的 key），
//   目标语言缺失对应条目时逐字段回退中文。
// - 上游没有对应文案的合成标签（如「共鸣技能伤害」「伤害1」）走下方字典，
//   字典缺失时保留中文原文。

import type { Character, CharacterInfo, EchoInfo, EchoSetInfo, SkillEntry, Weapon, WeaponInfo } from '$lib/api/types'
import type { ZhCharacterDetail, ZhEchoDetail, ZhSonataDetail, ZhWeaponDetail } from './types'
import { interpolate, isSkillTreeNode, skillLevelKeys, strip } from './utils'

/** 目标语言是否可覆盖（未知语言已由 fetchDetailPair 回退 zh） */
const canTranslate = (lang: string): boolean => !!lang && lang !== 'zh'

// ── 规范枚举的译文 ──
// 契约里的 element / weaponType 是中文规范值；非中文请求在输出层换成对应语言。

const ELEMENT_LABELS: Record<string, Record<string, string>> = {
    冷凝: { en: 'Glacio', ja: '凝縮', ko: '응결' },
    热熔: { en: 'Fusion', ja: '熱溶', ko: '융해' },
    导电: { en: 'Electro', ja: '電導', ko: '전도' },
    气动: { en: 'Aero', ja: '気動', ko: '기류' },
    衍射: { en: 'Spectro', ja: '回折', ko: '회절' },
    湮灭: { en: 'Havoc', ja: '湮滅', ko: '인멸' }
}

const WEAPON_TYPE_LABELS: Record<string, Record<string, string>> = {
    长刃: { en: 'Broadblade', ja: '長刃', ko: '장검' },
    迅刀: { en: 'Sword', ja: '迅刀', ko: '단검' },
    佩枪: { en: 'Pistols', ja: '拳銃', ko: '권총' },
    臂铠: { en: 'Gauntlets', ja: '臂鎧', ko: '건틀릿' },
    音感仪: { en: 'Rectifier', ja: '音感儀', ko: '음감기' }
}

const translateElement = (element: string, lang: string): string => ELEMENT_LABELS[element]?.[lang] ?? element

const translateWeaponType = (weaponType: string, lang: string): string =>
    WEAPON_TYPE_LABELS[weaponType]?.[lang] ?? weaponType

/** @desc 角色列表：名称已在 utils 按语言取好，这里只替换元素/武器类型枚举 */
export const localizeCharacterList = (list: Character[], lang: string): Character[] =>
    canTranslate(lang)
        ? list.map((item) => ({
              ...item,
              element: translateElement(item.element, lang),
              weaponType: translateWeaponType(item.weaponType, lang)
          }))
        : list

/** @desc 武器列表：只替换武器类型枚举 */
export const localizeWeaponList = (list: Weapon[], lang: string): Weapon[] =>
    canTranslate(lang)
        ? list.map((item) => ({ ...item, weaponType: translateWeaponType(item.weaponType, lang) }))
        : list

// ── 合成标签字典 ──
// 这些文案由中文规则生成，上游没有逐条译文；按语言补一份固定映射。

const SKILL_VALUE_LABELS: Record<string, Record<string, string>> = {
    共鸣技能伤害: { en: 'Resonance Skill DMG', ja: '共鳴スキルダメージ', ko: '공명 스킬 피해' },
    变奏技能伤害: { en: 'Intro Skill DMG', ja: '変奏スキルダメージ', ko: '변주 스킬 피해' },
    共鸣解放伤害: { en: 'Resonance Liberation DMG', ja: '共鳴解放ダメージ', ko: '공명 해방 피해' },
    延奏技能伤害: { en: 'Outro Skill DMG', ja: '終奏スキルダメージ', ko: '반주 스킬 피해' }
}

const NORMAL_ATTACK_DAMAGE = /^常态攻击第(\d+)段伤害$/
const ECHO_DAMAGE = /^伤害(\d+)$/

const NORMAL_ATTACK_LABELS: Record<string, (stage: string) => string> = {
    en: (stage) => `Basic Attack Stage ${stage} DMG`,
    ja: (stage) => `通常攻撃第${stage}段ダメージ`,
    ko: (stage) => `일반 공격 ${stage}단 피해`
}

const ECHO_DAMAGE_LABELS: Record<string, (index: string) => string> = {
    en: (index) => `DMG ${index}`,
    ja: (index) => `ダメージ${index}`,
    ko: (index) => `피해 ${index}`
}

/** @desc 翻译中文规则生成的合成标签；无映射时返回原文案 */
export const translateSyntheticLabel = (label: string, lang: string): string => {
    const fixed = SKILL_VALUE_LABELS[label]?.[lang]
    if (fixed) return fixed
    const normalAttack = label.match(NORMAL_ATTACK_DAMAGE)
    if (normalAttack) return NORMAL_ATTACK_LABELS[lang]?.(normalAttack[1]) ?? label
    const echoDamage = label.match(ECHO_DAMAGE)
    if (echoDamage) return ECHO_DAMAGE_LABELS[lang]?.(echoDamage[1]) ?? label
    return label
}

// ── 通用小工具 ──

type ZhSkill = ZhCharacterDetail['skill_trees'][string]['skill']

const renderText = (text: string | undefined, params: string[] | undefined, rich: boolean): string => {
    const filled = interpolate(text ?? '', params ?? [])
    return rich ? filled : strip(filled)
}

/** @desc 技能数值行里的原始参数（与中文计算使用同一等级下标口径） */
const rawSkillRow = (skill: ZhSkill | undefined, levelKey: string): string | undefined => {
    const row = skill?.level?.[levelKey]?.param?.[0]
    if (!row || row.length === 0) return undefined
    return row[Math.min(row.length - 1, 9)]
}

const localizeSkillValues = (
    values: SkillEntry['values'],
    zhSkill: ZhSkill,
    localizedSkill: ZhSkill,
    lang: string
): SkillEntry['values'] => {
    const levelKeys = skillLevelKeys(zhSkill)
    return values.map((value, index) => {
        const levelKey = levelKeys[index]
        const localizedLevel = levelKey ? localizedSkill.level?.[levelKey] : undefined
        if (!levelKey || !localizedLevel) {
            return [
                translateSyntheticLabel(value[0], lang),
                value[1],
                value[2],
                value[3],
                value[4]
            ] as SkillEntry['values'][number]
        }
        // 数值沿用中文计算；只把「名称」和「数字格式（如 {0}秒 / {0}s）」换成目标语言
        const raw = rawSkillRow(zhSkill, levelKey)
        const format = localizedLevel.format as string | null | undefined
        const formatted = raw === undefined ? value[1] : format ? format.replace('{0}', raw) : raw
        return [
            localizedLevel.name ?? translateSyntheticLabel(value[0], lang),
            formatted,
            value[2],
            value[3],
            value[4]
        ] as SkillEntry['values'][number]
    })
}

// ── 角色详情 ──

export const localizeCharacterInfo = (
    info: CharacterInfo,
    zhDetail: ZhCharacterDetail,
    localizedDetail: ZhCharacterDetail,
    lang: string,
    rich: boolean
): CharacterInfo => {
    if (!canTranslate(lang)) return info

    const skillNodeKeys = Object.entries(zhDetail.skill_trees)
        .filter(([, node]) => isSkillTreeNode(node))
        .map(([key]) => key)
    const statNodeKeys = Object.entries(zhDetail.skill_trees)
        .filter(([, node]) => !isSkillTreeNode(node))
        .map(([key]) => key)
    const chainKeys = Object.keys(zhDetail.chains ?? {})

    return {
        ...info,
        element: translateElement(info.element, lang) as CharacterInfo['element'],
        weaponType: translateWeaponType(info.weaponType, lang) as CharacterInfo['weaponType'],
        tags: info.tags.map((tag) => {
            const localizedTag = localizedDetail.tag?.[tag.id]
            if (!localizedTag) return tag
            return {
                ...tag,
                name: (localizedTag.name ?? '').trim() || tag.name,
                desc: (localizedTag.desc ?? '').trim() || tag.desc
            }
        }),
        skills: info.skills.map((skill, index) => {
            const key = skillNodeKeys[index]
            const localizedSkill = key ? localizedDetail.skill_trees?.[key]?.skill : undefined
            if (!localizedSkill) return skill
            return {
                ...skill,
                name: localizedSkill.name ?? skill.name,
                type: (localizedSkill.type ?? skill.type) as SkillEntry['type'],
                desc: localizedSkill.desc ? renderText(localizedSkill.desc, localizedSkill.param, rich) : skill.desc,
                values: localizeSkillValues(skill.values, zhDetail.skill_trees[key].skill, localizedSkill, lang).map(
                    (value) =>
                        [
                            value[0],
                            value[1],
                            translateElement(value[2], lang),
                            value[3],
                            value[4]
                        ] as SkillEntry['values'][number]
                ),
                // 原始伤害字典同样是中文（related_property 等），非中文时用目标语言详情里的同名条目
                damage: localizedSkill.damage ?? skill.damage
            }
        }),
        statNodes: info.statNodes.map((node, index) => {
            const key = statNodeKeys[index]
            const localizedSkill = key ? localizedDetail.skill_trees?.[key]?.skill : undefined
            if (!localizedSkill) return node
            return {
                name: localizedSkill.name ?? node.name,
                desc: localizedSkill.desc ? renderText(localizedSkill.desc, localizedSkill.param, rich) : node.desc
            }
        }),
        chains: info.chains.map((chain, index) => {
            const key = chainKeys[index]
            const localizedChain = key ? localizedDetail.chains?.[key] : undefined
            if (!localizedChain) return chain
            return {
                name: localizedChain.name ?? chain.name,
                desc: localizedChain.desc ? renderText(localizedChain.desc, localizedChain.param, rich) : chain.desc
            }
        })
    }
}

// ── 武器详情 ──

export const localizeWeaponInfo = (info: WeaponInfo, localized: ZhWeaponDetail, lang: string): WeaponInfo => {
    if (!canTranslate(lang)) return info

    const stats = localized.stats?.['6']?.['90'] ?? localized.stats?.['5']?.['90'] ?? localized.stats?.['6']?.['80']
    const substat = stats?.[1]

    let desc = localized.effect ?? ''
    if (localized.param) {
        desc = desc.replace(/\{(\d+)\}/g, (_, index) => {
            const params = localized.param?.[Number(index)]
            return params ? params.join('/') : `{${index}}`
        })
    }

    return {
        ...info,
        type: translateWeaponType(info.type, lang) as WeaponInfo['type'],
        substat: {
            name: substat?.name || info.substat.name,
            value: info.substat.value
        },
        effect: {
            name: localized.effect_name || info.effect.name,
            desc: desc || info.effect.desc
        }
    }
}

// ── 声骸详情 ──

const localizeEchoValue = (
    value: EchoInfo['skill']['values'][number],
    zhDamage: ZhEchoDetail['skill']['damage'],
    localizedDamage: ZhEchoDetail['skill']['damage'],
    damageKey: string
): EchoInfo['skill']['values'][number] => {
    const zhProperty = zhDamage?.[damageKey]?.related_property
    const localizedProperty = localizedDamage?.[damageKey]?.related_property
    if (!zhProperty || zhProperty === '攻击' || !localizedProperty) return value
    if (!value[1].endsWith(zhProperty)) return value
    return [value[0], value[1].slice(0, -zhProperty.length) + localizedProperty, value[2]]
}

export const localizeEchoInfo = (
    info: EchoInfo,
    zhDetail: ZhEchoDetail,
    localized: ZhEchoDetail,
    lang: string
): EchoInfo => {
    if (!canTranslate(lang)) return info

    const localizedSkill = localized.skill ?? zhDetail.skill
    let desc = localizedSkill?.desc ?? ''
    const params = localizedSkill?.param ?? []
    if (params.length > 0) {
        const lastRow = params[params.length - 1]
        desc = desc.replace(/\{(\d+)\}/g, (_, index) => lastRow[Number(index)] ?? `{${index}}`)
    }

    const groupKeys = Object.keys(zhDetail.group ?? {})
    const damageKeys = Object.keys(zhDetail.skill?.damage ?? {})

    return {
        ...info,
        skill: {
            desc: desc || info.skill.desc,
            values: info.skill.values.map((value, index) => {
                const localizedValue = localizeEchoValue(
                    value,
                    zhDetail.skill?.damage,
                    localizedSkill?.damage,
                    damageKeys[index]
                )
                return [
                    translateSyntheticLabel(localizedValue[0], lang),
                    localizedValue[1],
                    translateElement(localizedValue[2], lang)
                ]
            })
        },
        groups: info.groups.map((group, index) => {
            const key = groupKeys[index]
            return (key ? localized.group?.[key]?.name : undefined) ?? group
        })
    }
}

// ── 声骸套装详情 ──

export const localizeEchoSetInfo = (
    info: EchoSetInfo,
    setId: string,
    zhDetail: ZhSonataDetail,
    localized: ZhSonataDetail,
    lang: string
): EchoSetInfo => {
    if (!canTranslate(lang)) return info

    const localizedEntry = localized[setId]
    const zhEntry = zhDetail[setId]
    if (!localizedEntry || !zhEntry) return info

    const bonuses: Record<string, string> = {}
    for (const pieces of Object.keys(zhEntry.set ?? {})) {
        const localizedBonus = localizedEntry.set?.[pieces]
        bonuses[pieces] = localizedBonus
            ? interpolate(localizedBonus.desc, localizedBonus.param ?? [])
            : (info.bonuses[pieces] ?? '')
    }
    return { ...info, bonuses }
}
