// T24 纯逻辑回归：ask-user-card.utils.ts（「向用户提问」卡片的全部规则）
//
// 运行方式（与仓库 `pnpm test` 同一套 preload + node:test 单进程聚合：
// package.json 的 test 脚本 = node --import ./scripts/test/preload-runes.mjs
//   --import ./scripts/test/preload.mjs scripts/test/run-provider-tests.ts
// 本文件已登记在 scripts/test/run-provider-tests.ts 的 import 列表里）：
//   node --import ./scripts/test/preload-runes.mjs --import ./scripts/test/preload.mjs src/lib/components/page/home/settings/ask-user-card.utils.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    BOOLEAN_TABS,
    EMPTY_QUESTION,
    NO_VALUE,
    YES_VALUE,
    answerValues,
    blockerText,
    canGoNext,
    canGoPrev,
    canSkip,
    canSubmit,
    cancelResult,
    clampIndex,
    createDraft,
    draftOf,
    indexAfterSkip,
    isAnswered,
    isCustomOn,
    isPicked,
    normalizeGroup,
    normalizeOptions,
    normalizeQuestions,
    pickRadio,
    progressText,
    questionBadges,
    questionStatus,
    setCustomPick,
    setCustomText,
    settleOnce,
    skipQuestion,
    stepIndex,
    submitBlockers,
    toAnswer,
    toResult,
    toggleCheck
} from './ask-user-card.utils'
import type { AskUserRequest } from '$lib/ai/tools/ask-user.types'

/** @desc 构造一次提问（默认三题：boolean / single / multi，第二题必答） */
const request = (over: Partial<AskUserRequest> = {}): AskUserRequest => ({
    title: ' 需要你确认两件事 ',
    description: ' 问完就开工 ',
    questions: [
        { id: 'b1', type: 'boolean', question: '是否继续？' },
        {
            type: 'single',
            question: '用哪套口径？',
            options: [
                { value: 'a', label: '口径A', description: '按面板值' },
                { value: 'b', label: '口径B' }
            ],
            required: true
        },
        {
            type: 'multi',
            question: '要跑哪些环节？',
            options: [
                { value: 'x', label: '排轴' },
                { value: 'y', label: '拉表' }
            ],
            customPlaceholder: '其它环节'
        }
    ],
    ...over
})

const group = () => normalizeGroup(request())
const q = (g: ReturnType<typeof group>, i: number) => g.questions[i]

describe('归一：问题组 / 题号 / 选项 / allowCustom / required', () => {
    it('补 id（q{序号}）、trim 标题说明、题号 1 起、是否型忽略 options、默认 allowCustom=true', () => {
        const g = group()
        assert.deepEqual(
            g.questions.map((x) => x.id),
            ['b1', 'q2', 'q3']
        )
        assert.deepEqual(
            g.questions.map((x) => x.no),
            [1, 2, 3]
        )
        assert.equal(g.title, '需要你确认两件事')
        assert.equal(g.description, '问完就开工')
        // 是否型：options 恒空、自带 allowCustom=false（契约：boolean 不支持自定义）
        assert.deepEqual(q(g, 0).options, [])
        assert.equal(q(g, 0).allowCustom, false)
        assert.equal(q(g, 0).required, false)
        // single/multi：默认允许自定义、默认非必答
        assert.equal(q(g, 1).allowCustom, true)
        assert.equal(q(g, 1).required, true)
        assert.equal(q(g, 2).required, false)
        assert.equal(q(g, 2).customPlaceholder, '其它环节')
        // 每个 id 都有初始草稿
        for (const question of g.questions)
            assert.deepEqual(draftOf(g.draft, question.id), {
                picked: [],
                customOn: false,
                customText: '',
                skipped: false
            })
    })

    it('重复 id 被改写、空 options / 重复 value / 缺 label 被安全处理（保证 {#each} key 唯一）', () => {
        const qs = normalizeQuestions([
            { id: 'dup', type: 'boolean', question: 'A' },
            { id: 'dup', type: 'boolean', question: 'B' },
            { id: 'dup', type: 'boolean', question: 'C' },
            {
                type: 'single',
                question: 'D',
                options: [
                    { value: 'v', label: 'V' },
                    { value: 'v', label: 'V重复' },
                    { value: '', label: '空值' },
                    { value: 'w', label: '' }
                ]
            }
        ])
        assert.deepEqual(
            qs.map((x) => x.id),
            ['dup', 'dup-2', 'dup-3', 'q4']
        )
        // 组内 id 唯一（`{#each (q.id)}` 的 key 前提）
        assert.equal(new Set(qs.map((x) => x.id)).size, qs.length)
        // 选项：去重 + 丢空 value + 缺 label 回落 value
        assert.deepEqual(qs[3].options, [
            { value: 'v', label: 'V' },
            { value: 'w', label: 'w' }
        ])
        assert.equal(new Set(qs[3].options.map((o) => o.value)).size, qs[3].options.length)
        assert.deepEqual(normalizeOptions(undefined), [])
    })

    it('normalizeQuestions 不修改调用方传入的 used 集合（无副作用）', () => {
        const used = new Set<string>()
        normalizeQuestions([{ id: 'k', type: 'boolean', question: 'x' }])
        assert.equal(used.size, 0)
    })

    it('空问题组不崩：questions=[]、progressText 不越界、EMPTY_QUESTION 可渲染', () => {
        const g = normalizeGroup({ questions: [] })
        assert.deepEqual(g.questions, [])
        assert.equal(progressText(0, 0), '第 1 / 0 题')
        assert.equal(clampIndex(3, 0), 0)
        assert.equal(EMPTY_QUESTION.allowCustom, false)
        assert.equal(EMPTY_QUESTION.type, 'boolean')
    })
})

describe('是否型：两段 tab 取值 → values yes/no', () => {
    it('选「是」/「否」分别得到 [yes] / [no]', () => {
        const g = group()
        const yes = pickRadio(g.draft, 'b1', YES_VALUE)
        assert.deepEqual(answerValues(q(g, 0), draftOf(yes, 'b1')), ['yes'])
        const no = pickRadio(g.draft, 'b1', NO_VALUE)
        assert.deepEqual(answerValues(q(g, 0), draftOf(no, 'b1')), ['no'])
        assert.deepEqual(
            BOOLEAN_TABS.map((t) => t.label),
            ['是', '否']
        )
    })

    it('是否型选项重选即互斥（不会同时留下 yes 与 no）', () => {
        const g = group()
        const draft = pickRadio(pickRadio(g.draft, 'b1', YES_VALUE), 'b1', NO_VALUE)
        assert.deepEqual(draftOf(draft, 'b1').picked, ['no'])
    })
})

describe('单选型：预设项 / 「其它」/ 自定义输入', () => {
    it('选预设项 → values 为该项 value，且未勾「其它」时 custom 不参与', () => {
        const g = group()
        const draft = pickRadio(g.draft, 'q2', 'a')
        const item = draftOf(draft, 'q2')
        assert.equal(isPicked(draft, 'q2', 'a'), true)
        assert.deepEqual(answerValues(q(g, 1), item), ['a'])
        assert.equal(isAnswered(q(g, 1), item), true)
        assert.equal(toAnswer(q(g, 1), item).custom, undefined)
    })

    it('勾「其它」清掉预设项（radio 互斥）；输入文本 → values 为自定义原文并写进 custom', () => {
        const g = group()
        const picked = pickRadio(g.draft, 'q2', 'a')
        const onCustom = setCustomPick(picked, q(g, 1), true)
        assert.deepEqual(draftOf(onCustom, 'q2').picked, [])
        assert.equal(isCustomOn(onCustom, 'q2'), true)
        // 勾了「其它」但没输入 → 仍未作答（required 题会挡住提交）
        assert.equal(isAnswered(q(g, 1), draftOf(onCustom, 'q2')), false)

        const typed = setCustomText(onCustom, q(g, 1), '  按期望值算  ')
        const item = draftOf(typed, 'q2')
        assert.deepEqual(answerValues(q(g, 1), item), ['按期望值算'])
        const answer = toAnswer(q(g, 1), item)
        assert.deepEqual(answer, {
            id: 'q2',
            type: 'single',
            skipped: false,
            values: ['按期望值算'],
            custom: '按期望值算'
        })
    })

    it('直接输入文本即视为选中「其它」，且与预设项互斥（有内容却不选中是不可能状态）', () => {
        const g = group()
        const picked = pickRadio(g.draft, 'q2', 'b')
        const typed = setCustomText(picked, q(g, 1), '自定义')
        const item = draftOf(typed, 'q2')
        assert.equal(item.customOn, true)
        assert.deepEqual(item.picked, [])
        assert.deepEqual(answerValues(q(g, 1), item), ['自定义'])
    })

    it('取消「其它」后自定义原文不进 values（也不写 custom）', () => {
        const g = group()
        const typed = setCustomText(g.draft, q(g, 1), 'x')
        const off = setCustomPick(typed, q(g, 1), false)
        const item = draftOf(off, 'q2')
        assert.equal(isAnswered(q(g, 1), item), false)
        assert.deepEqual(toAnswer(q(g, 1), item), { id: 'q2', type: 'single', skipped: true, values: [] })
    })
})

describe('多选型：勾选顺序 / 取消 / 自定义追加末尾', () => {
    it('多选可同时勾选、保持勾选先后、可取消', () => {
        const g = group()
        const two = toggleCheck(toggleCheck(g.draft, 'q3', 'y'), 'q3', 'x')
        assert.deepEqual(draftOf(two, 'q3').picked, ['y', 'x'])
        assert.deepEqual(answerValues(q(g, 2), draftOf(two, 'q3')), ['y', 'x'])
        const one = toggleCheck(two, 'q3', 'y')
        assert.deepEqual(draftOf(one, 'q3').picked, ['x'])
        assert.deepEqual(draftOf(toggleCheck(one, 'q3', 'x'), 'q3').picked, [])
    })

    it('自定义输入在 values 中**追加在末尾**，并同时写进 custom', () => {
        const g = group()
        const picked = toggleCheck(toggleCheck(g.draft, 'q3', 'x'), 'q3', 'y')
        const typed = setCustomText(setCustomPick(picked, q(g, 2), true), q(g, 2), '深塔')
        const item = draftOf(typed, 'q3')
        assert.deepEqual(item.picked, ['x', 'y'])
        assert.deepEqual(answerValues(q(g, 2), item), ['x', 'y', '深塔'])
        assert.deepEqual(toAnswer(q(g, 2), item), {
            id: 'q3',
            type: 'multi',
            skipped: false,
            values: ['x', 'y', '深塔'],
            custom: '深塔'
        })
    })

    it('多选下「其它」与预设项独立（互不清除）', () => {
        const g = group()
        const off = setCustomPick(toggleCheck(g.draft, 'q3', 'x'), q(g, 2), true)
        assert.deepEqual(draftOf(off, 'q3').picked, ['x'])
        const stillOn = setCustomPick(off, q(g, 2), false)
        assert.deepEqual(draftOf(stillOn, 'q3').picked, ['x'])
        assert.equal(isCustomOn(stillOn, 'q3'), false)
    })
})

describe('忽略本题 / 必答校验', () => {
    it('忽略本题：清空作答并标记 skipped，values 为空；isAnswered=false', () => {
        const g = group()
        const picked = pickRadio(g.draft, 'q2', 'a')
        // q2 是必答题 → 忽略是 no-op（组件层按钮也已禁用）
        assert.equal(canSkip(q(g, 1)), false)
        assert.deepEqual(skipQuestion(picked, q(g, 1)), picked)
        // 非必答的 q3 可忽略
        const skipped = skipQuestion(toggleCheck(picked, 'q3', 'x'), q(g, 2))
        const item = draftOf(skipped, 'q3')
        assert.equal(item.skipped, true)
        assert.deepEqual(item.picked, [])
        assert.deepEqual(answerValues(q(g, 2), item), [])
        assert.equal(questionStatus(q(g, 2), item), 'skipped')
    })

    it('必答题未作答 → 禁止提交并指出是第几题', () => {
        const g = group()
        assert.equal(canSubmit(g.questions, g.draft), false)
        const blockers = submitBlockers(g.questions, g.draft)
        assert.deepEqual(
            blockers.map((b) => b.no),
            [2]
        )
        assert.equal(blockerText(blockers), '第 2 题必答，尚未作答')
        // 作答后即可提交
        const answered = pickRadio(g.draft, 'q2', 'a')
        assert.equal(canSubmit(g.questions, answered), true)
        assert.deepEqual(submitBlockers(g.questions, answered), [])
        assert.equal(blockerText([]), '')
    })

    it('多题同时未答时逐一列出（顿号连接）', () => {
        const g = normalizeGroup({
            questions: [
                { type: 'boolean', question: 'A', required: true },
                { type: 'boolean', question: 'B' },
                { type: 'boolean', question: 'C', required: true }
            ]
        })
        assert.equal(blockerText(submitBlockers(g.questions, g.draft)), '第 1、3 题必答，尚未作答')
        assert.equal(questionStatus(g.questions[0], draftOf(g.draft, 'q1')), 'unanswered')
        assert.deepEqual(questionBadges(g.questions[0]), ['是否', '必答'])
        assert.deepEqual(questionBadges(g.questions[1]), ['是否'])
    })
})

describe('导航边界', () => {
    it('上一题 / 下一题 / 点题号的边界与钳制', () => {
        assert.equal(canGoPrev(0), false)
        assert.equal(canGoPrev(1), true)
        assert.equal(canGoNext(0, 3), true)
        assert.equal(canGoNext(2, 3), false)
        assert.equal(canGoNext(0, 0), false)
        assert.equal(stepIndex(1, 3, -1), 0)
        assert.equal(stepIndex(2, 3, 1), 2) // 末题不再前进
        assert.equal(stepIndex(0, 3, -1), 0) // 首题不再后退
        assert.equal(clampIndex(99, 3), 2)
        assert.equal(clampIndex(-5, 3), 0)
        assert.equal(progressText(0, 3), '第 1 / 3 题')
        assert.equal(progressText(2, 3), '第 3 / 3 题')
    })

    it('忽略本题：非末题自动前进一题，末题原地不动', () => {
        assert.equal(indexAfterSkip(0, 3), 1)
        assert.equal(indexAfterSkip(1, 3), 2)
        assert.equal(indexAfterSkip(2, 3), 2)
        assert.equal(indexAfterSkip(0, 1), 0)
        assert.equal(indexAfterSkip(0, 0), 0)
    })
})

describe('提交归一（AskUserResult）', () => {
    it('逐题按顺序归一：已答→skipped:false，未作答的非必答题→skipped:true + values:[]', () => {
        const g = group()
        // 第 1 题不答（非必答）、第 2 题答 a（必答）、第 3 题多选 x + 自定义
        const draft = setCustomText(setCustomPick(toggleCheck(g.draft, 'q3', 'x'), q(g, 2), true), q(g, 2), '深塔')
        const result = toResult(g.questions, pickRadio(draft, 'q2', 'a'))
        assert.equal(result.submitted, true)
        assert.deepEqual(result.answers, [
            { id: 'b1', type: 'boolean', skipped: true, values: [] },
            { id: 'q2', type: 'single', skipped: false, values: ['a'] },
            { id: 'q3', type: 'multi', skipped: false, values: ['x', '深塔'], custom: '深塔' }
        ])
        // answers 覆盖全部题目（顺序 = 题目顺序），契约要求 AI 能逐题看到「未作答」
        assert.deepEqual(
            result.answers.map((a) => a.id),
            g.questions.map((x) => x.id)
        )
    })

    it('显式忽略的题在提交结果里是 skipped:true + 空 values', () => {
        const g = group()
        const draft = skipQuestion(pickRadio(g.draft, 'q2', 'a'), q(g, 2))
        const result = toResult(g.questions, draft)
        assert.deepEqual(result.answers[2], { id: 'q3', type: 'multi', skipped: true, values: [] })
    })

    it('放弃结果固定为 { submitted:false, answers: [] }', () => {
        assert.deepEqual(cancelResult(), { submitted: false, answers: [] })
    })
})

describe('收尾幂等（Promise 不 double-resolve / 不泄漏）', () => {
    it('settleOnce：重复调用只生效一次，副作用只发生一次', () => {
        const seen: string[] = []
        const settle = settleOnce<string>((v) => seen.push(v))
        settle('提交')
        settle('放弃')
        settle('放弃')
        assert.deepEqual(seen, ['提交'])
    })

    it('两条收尾路径（提交 → 卸载回调）叠加时，Promise 只会 resolve 一次', async () => {
        let resolveFn: ((v: string) => void) | null = null
        const promise = new Promise<string>((r) => (resolveFn = r))
        const settle = settleOnce<string>((v) => resolveFn?.(v))
        settle('submitted') // 用户点提交
        settle('cancelled') // 卡片随后卸载，再收尾一次
        assert.equal(await promise, 'submitted')
    })

    it('createDraft 每题一份独立草稿（改一题不串题）', () => {
        const g = group()
        const draft = pickRadio(g.draft, 'q2', 'a')
        assert.deepEqual(draftOf(draft, 'q3'), { picked: [], customOn: false, customText: '', skipped: false })
        assert.notEqual(draftOf(draft, 'q2'), draftOf(draft, 'q3'))
        assert.deepEqual(g.draft, createDraft(g.questions)) // 入参草稿没被改（不可变）
    })
})
