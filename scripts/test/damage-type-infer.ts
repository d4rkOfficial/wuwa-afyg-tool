// ── 伤害类型推导：TDD 断言夹具 ─────────────────────────────────────────────
// 输入「角色名 + 倍率行名（+ 可选技能类型）」，输出「推导出的伤害类型」。
// 数据链路与线上完全一致：getProvider().getCharacterInfo(name, { rich: true })
//   → inferDamageTypes(entry, charInfo)，因此用例失败即代表线上推导同样会错。
// 用法与完整算法说明见 docs/damage-type-inference.md；
// 空白模板见 scripts/test/damage-type-infer.example.ts。
//
// 运行：node --import ./scripts/test/preload.mjs scripts/test/damage-type-infer.example.ts

import assert from 'node:assert/strict'
import { getProvider } from '$lib/api/provider'
import { DAMAGE_TYPES as CANONICAL_DAMAGE_TYPES } from '$lib/consts/game-terms'
import { inferDamageTypes } from '$lib/calc/utils'
import type { CharacterInfo, SkillEntry } from '$lib/api/types'
import type { DamageEntry } from '$lib/calc/calculation.types'

/** @desc 权威伤害类型（`src/lib/consts/game-terms.ts`），用例的期望值必须是其中之一 */
export type DamageTypeName = (typeof CANONICAL_DAMAGE_TYPES)[number]

/** @desc 一条「倍率 → 伤害类型」用例 */
export interface InferCase {
    /** 角色中文名（与上游 character.json 的 zh 一致） */
    characterName: string
    /** 倍率行名，必须与技能面板行名完全一致（可用 listRatios 查） */
    ratioName: string
    /** 期望的伤害类型 */
    expectedDamageType: string
    /** 行名在多个技能节点里重名时用它定位（如「技能伤害」在共鸣解放/变奏技能里各有一条） */
    skillType?: string
    /** 效应结算条目：只认 isEffect，不看任何文案 */
    isEffect?: boolean
    /** 备注：写清依据（游戏内判定 / 上游哪句话），失败报告里会打印 */
    note?: string
}

/** @desc 单条用例的推导结果 */
export interface InferOutcome {
    characterName: string
    ratioName: string
    /** 实际命中的技能节点类型（未指定 skillType 时可能不止一个，以 ` / ` 连接） */
    skillType: string
    actualDamageType: string
}

// ── 上游数据：同角色只拉一次 ────────────────────────────────────────────

const infoCache = new Map<string, Promise<CharacterInfo>>()

const loadInfo = (characterName: string): Promise<CharacterInfo> => {
    const cached = infoCache.get(characterName)
    if (cached) return cached
    const pending = getProvider()
        .getCharacterInfo(characterName, { rich: true })
        .catch((error: unknown) => {
            infoCache.delete(characterName)
            throw new Error(`拉取角色「${characterName}」详情失败：${String(error)}`)
        })
    infoCache.set(characterName, pending)
    return pending
}

// ── 行名定位 ────────────────────────────────────────────────────────────

const skillRows = (info: CharacterInfo, skillType?: string): Array<{ type: SkillEntry['type']; row: string }> =>
    info.skills
        .filter((skill) => !skillType || skill.type === skillType)
        .flatMap((skill) => (skill.values ?? []).map((value) => ({ type: skill.type, row: value[0] })))

/** @desc 近似行名（找不到时提示用）：去掉「伤害」后互相包含的行名，取前若干条 */
const nearRatioNames = (info: CharacterInfo, ratioName: string, skillType?: string): string[] => {
    const key = ratioName.replace(/伤害$/, '')
    const rows = skillRows(info, skillType).map((entry) => entry.row)
    const direct = rows.filter((row) => row.includes(key) || key.includes(row.replace(/伤害$/, '')))
    return [...new Set(direct)].slice(0, 8)
}

/**
 * @desc 打印角色全部倍率行名（`技能类型 | 行名`），可按关键字过滤。
 * 写用例前先用它核对行名的精确写法。
 */
export const listRatios = async (characterName: string, keyword = ''): Promise<string[]> => {
    const info = await loadInfo(characterName)
    const lines = skillRows(info)
        .filter((entry) => !keyword || entry.row.includes(keyword) || entry.type.includes(keyword))
        .map((entry) => `${entry.type} | ${entry.row}`)
    console.log(
        `\n【${characterName}】倍率行名 ${lines.length} 条${keyword ? `（过滤：${keyword}）` : ''}：\n${lines.join('\n')}`
    )
    return lines
}

/**
 * @desc 打印某条倍率相关的技能文案（大标题单独成行），用于人/AI 判断「结论写在哪句话里」。
 * 展示口径与推导口径一致：取「技能类型 + 行名」都对得上的节点，找不到再取同技能类型的节点。
 */
export const dumpRatioContext = async (
    characterName: string,
    ratioName: string,
    options: Pick<InferCase, 'skillType' | 'isEffect'> = {}
): Promise<void> => {
    const info = await loadInfo(characterName)
    const exact = info.skills.filter(
        (skill) =>
            (!options.skillType || skill.type === options.skillType) &&
            (skill.values ?? []).some((value) => value[0] === ratioName)
    )
    const pool =
        exact.length > 0 ? exact : info.skills.filter((skill) => !options.skillType || skill.type === options.skillType)
    for (const skill of pool) {
        const rendered = String(skill.desc ?? '')
            .replace(/<color=Title>([\s\S]*?)<\/color>/gi, '\n【$1】\n')
            .replace(/<[^>]*>/g, '')
            .replace(/\n{2,}/g, '\n')
            .trim()
        console.log(`\n########## ${characterName} / ${skill.type}（行名命中：${exact.includes(skill) ? '是' : '否'}）`)
        console.log(rendered)
    }
}

// ── 推导 ────────────────────────────────────────────────────────────────

/**
 * @desc 构造推导用的伤害条目：只把参与推导的字段填实（character / skillType / hitName / isEffect），
 * 其余字段是占位（推导完全不读倍率数值、元素与能量）。
 */
const buildEntry = (
    info: CharacterInfo,
    characterName: string,
    skillType: string,
    ratioName: string,
    isEffect: boolean
): DamageEntry => ({
    id: `${characterName}|${skillType}|${ratioName}`,
    character: characterName,
    skillType,
    hitName: ratioName,
    displayName: ratioName,
    isEffect,
    isTuneBreak: false,
    isTuneResponse: false,
    ratioValue: 100,
    ratioUnit: '%',
    damageBaseType: '攻击',
    damageElement: info.element,
    sourceTimelineBlockId: 'damage-type-infer',
    hits: 1
})

/**
 * @desc 跑一次推导并返回结果（不改期望值、不抛断言错误），适合排查与批量普查。
 * 未指定 skillType 且该行名在多个技能节点里推导结果不一致时抛错，要求显式指定。
 */
export const inferDamageTypeOf = async (
    characterName: string,
    ratioName: string,
    options: Pick<InferCase, 'skillType' | 'isEffect'> = {}
): Promise<InferOutcome> => {
    const info = await loadInfo(characterName)
    const isEffect = options.isEffect ?? false
    const candidates = info.skills.filter(
        (skill) =>
            (!options.skillType || skill.type === options.skillType) &&
            (skill.values ?? []).some((value) => value[0] === ratioName)
    )
    if (candidates.length === 0) {
        // 该行名可能存在于别的技能节点（skillType 写错），或行名写法不一致
        const all = info.skills.filter((skill) => (skill.values ?? []).some((value) => value[0] === ratioName))
        const hint =
            options.skillType && all.length > 0
                ? `该行名实际位于这些技能节点：${all.map((skill) => skill.type).join(' / ')}（请检查 skillType）`
                : `用 listRatios('${characterName}', '关键字') 核对行名的精确写法`
        const suggestions = nearRatioNames(info, ratioName, options.skillType)
        const suggestionText = suggestions.length > 0 ? `\n相近行名：${suggestions.join(' / ')}` : ''
        throw new Error(`角色「${characterName}」里没有倍率行「${ratioName}」。${hint}${suggestionText}`)
    }
    const outcomes = candidates.map((skill) => ({
        skillType: skill.type,
        actual:
            inferDamageTypes(buildEntry(info, characterName, skill.type, ratioName, isEffect), info)[0] ??
            '其它类型伤害'
    }))
    const distinct = [...new Set(outcomes.map((outcome) => outcome.actual))]
    if (distinct.length > 1) {
        const detail = outcomes.map((outcome) => `  ${outcome.skillType} → ${outcome.actual}`).join('\n')
        throw new Error(`倍率「${ratioName}」在多个技能节点里推导结果不一致，请用 skillType 指定：\n${detail}`)
    }
    return {
        characterName,
        ratioName,
        skillType: [...new Set(outcomes.map((outcome) => outcome.skillType))].join(' / '),
        actualDamageType: distinct[0] ?? '其它类型伤害'
    }
}

/** @desc 自检：本地短名枚举的每个值都必须落在权威清单里（写错字立刻报错） */
export const assertDamageTypeEnum = (map: Record<string, string>): void => {
    for (const [shortName, fullName] of Object.entries(map)) {
        assert.ok(
            (CANONICAL_DAMAGE_TYPES as readonly string[]).includes(fullName),
            `DAMAGE_TYPES.${shortName} = '${fullName}' 不在权威伤害类型清单里（见 src/lib/consts/game-terms.ts）`
        )
    }
}

const assertKnownDamageType = (expected: string): void => {
    assert.ok(
        (CANONICAL_DAMAGE_TYPES as readonly string[]).includes(expected),
        `期望值「${expected}」不是合法伤害类型，取值只能是：${CANONICAL_DAMAGE_TYPES.join(' / ')}`
    )
}

/**
 * @desc 断言「角色 + 倍率行名」推导出的伤害类型等于期望值。
 * 失败信息会带上实际值、命中的技能节点与排查入口，方便直接定位到推导规则。
 */
export const assertCorrectDamageTypeInfer = async (
    characterName: string,
    ratioName: string,
    expectedDamageType: string,
    options: Pick<InferCase, 'skillType' | 'isEffect' | 'note'> = {}
): Promise<void> => {
    assertKnownDamageType(expectedDamageType)
    const outcome = await inferDamageTypeOf(characterName, ratioName, options)
    const note = options.note ? `\n依据备注：${options.note}` : ''
    assert.equal(
        outcome.actualDamageType,
        expectedDamageType,
        `伤害类型推导不符：角色「${characterName}」倍率「${ratioName}」（技能节点：${outcome.skillType}）` +
            `\n期望：${expectedDamageType}\n实际：${outcome.actualDamageType}${note}` +
            `\n排查：src/lib/calc/skill-infer.ts；用 dumpRatioContext('${characterName}', '${ratioName}') 看文案落在哪个大标题小节`
    )
}

/**
 * @desc 批量跑用例（TDD 主循环）：打印通过/失败清单，有失败则抛错（退出码非 0）。
 * 失败时先确认期望值本身是否正确，再决定改算法还是改用例。
 */
export const reportDamageTypeInfer = async (cases: readonly InferCase[], title = '伤害类型推导用例'): Promise<void> => {
    const lines: string[] = []
    const failures: string[] = []
    for (const oneCase of cases) {
        const label = `${oneCase.characterName} | ${oneCase.skillType ?? '（自动定位）'} | ${oneCase.ratioName}`
        try {
            const outcome = await inferDamageTypeOf(oneCase.characterName, oneCase.ratioName, oneCase)
            if (outcome.actualDamageType === oneCase.expectedDamageType) {
                lines.push(`  ✔ ${label} → ${outcome.actualDamageType}`)
            } else {
                const detail =
                    `  ✘ ${label} → 期望 ${oneCase.expectedDamageType}，实际 ${outcome.actualDamageType}` +
                    `（命中节点：${outcome.skillType}）${oneCase.note ? `｜依据：${oneCase.note}` : ''}`
                lines.push(detail)
                failures.push(detail)
            }
        } catch (error) {
            const detail = `  ✘ ${label} → ${error instanceof Error ? error.message : String(error)}`
            lines.push(detail)
            failures.push(detail)
        }
    }
    console.log(`\n${title}：${cases.length} 条，通过 ${cases.length - failures.length}，失败 ${failures.length}`)
    if (lines.length > 0) console.log(lines.join('\n'))
    if (cases.length === 0) {
        console.log('  （用例为空：把「角色 + 倍率行名 + 期望伤害类型」填进 CASES 即可开始 TDD）')
        return
    }
    if (failures.length > 0) {
        throw new Error(
            `${title}：${failures.length}/${cases.length} 条失败\n${failures.join('\n')}` +
                `\n排查：src/lib/calc/skill-infer.ts（规则2 文案定位 / 规则1 名称前缀 / 技能类型兜底）`
        )
    }
}

/**
 * @desc 全角色/指定角色的逐行普查：打印 `技能类型 | 行名 → 推导类型`，用于「改前改后对比」防回归。
 * 典型用法：改算法前后各跑一次，把输出存文件后 diff，逐条确认每处变化都是修正。
 */
export const sweepDamageTypeInfer = async (characterNames: readonly string[]): Promise<string[]> => {
    const out: string[] = []
    for (const characterName of characterNames) {
        const info = await loadInfo(characterName)
        for (const { type, row } of skillRows(info)) {
            if (/消耗|冷却|能量|协奏|每秒|持续|治疗|护盾/.test(row)) continue
            const outcome = await inferDamageTypeOf(characterName, row, { skillType: type })
            out.push(`${characterName} | ${type} | ${row} → ${outcome.actualDamageType}`)
        }
    }
    console.log(out.join('\n'))
    console.log(`\n普查完成：${characterNames.length} 个角色，${out.length} 行`)
    return out
}
