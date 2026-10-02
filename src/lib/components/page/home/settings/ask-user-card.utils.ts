/**
 * @desc 「向用户提问」卡片（`ask-user-card.svelte`）的全部**纯逻辑**：
 *  问题组归一（补 id / 去重 / 解析 allowCustom·required）、逐题作答状态机（选项 / 自定义输入 / 忽略）、
 *  逐题导航边界、提交归一与必答校验、以及「收尾最多一次」的 Promise 守卫。
 *
 * 为什么必须拆出来（AGENTS §1「复杂功能里的无副作用成分必须拆」）：这些规则与 DOM 无关，却极易出错 ——
 *  「其它」行与预设选项的互斥、多选时自定义值必须追加在末尾、required 未作答要同时「禁用提交」且
 *  「指出是第几题」、越界导航必须钳制、忽略后要能跳到下一题。组件只负责把这里的返回值喂回模板
 *  （`draft = pickRadio(draft, question, value)`），不自己写规则。
 *
 * 契约来源：`$lib/ai/tools/ask-user.types.ts`（本文件不改它，只按它归一）。
 * 不可变约定：所有状态函数返回**新对象**，绝不修改入参（与 ESLint `no-param-reassign` 同源要求）。
 */
import type {
    AskUserAnswer,
    AskUserOption,
    AskUserQuestion,
    AskUserQuestionType,
    AskUserRequest,
    AskUserResult
} from '$lib/ai/tools/ask-user.types'

// ── 常量（契约里的固定取值与默认文案）────────────────────────────────────────

/** @desc 是否型的两个固定取值（契约：`boolean` 的 values 为 `['yes']` / `['no']`） */
export const YES_VALUE = 'yes'
export const NO_VALUE = 'no'

/** @desc 是否型分段控件的两段（等宽；与设置里的 toggle 同一形态的 `ui/tabs`） */
export const BOOLEAN_TABS: { value: string; label: string }[] = [
    { value: YES_VALUE, label: '是' },
    { value: NO_VALUE, label: '否' }
]

/** @desc 「其它」行的固定文案（它本身是一个选项，不是额外控件） */
export const CUSTOM_LABEL = '其它'
/** @desc 未提供 `customPlaceholder` 时的输入框占位提示 */
export const DEFAULT_CUSTOM_PLACEHOLDER = '输入自定义内容…'
/** @desc 极简兜底题：契约保证问题组非空，这里只为「万一空组」时模板不崩（父组件也会直接按放弃收尾） */
export const EMPTY_QUESTION: AskCardQuestion = {
    id: 'q1',
    no: 1,
    type: 'boolean',
    question: '（本次提问没有问题）',
    options: [],
    allowCustom: false,
    customPlaceholder: DEFAULT_CUSTOM_PLACEHOLDER,
    required: false
}

// ── 归一后的卡片数据结构 ────────────────────────────────────────────────────

/** @desc 归一后的候选项：`value` 组内唯一（可直接作 `{#each}` 的 key） */
export interface AskCardOption {
    value: string
    label: string
    description?: string
}

/** @desc 归一后的问题：`id` 组内唯一、`allowCustom`/`required` 已解析成布尔、题号已固化 */
export interface AskCardQuestion {
    /** 稳定 id（契约里提交结果回传的就是它） */
    id: string
    /** 题号（1 起，用于「第 N / M 题」与必答阻断文案） */
    no: number
    type: AskUserQuestionType
    question: string
    description?: string
    /** `boolean` 恒为空数组（契约：是否型不用 options） */
    options: AskCardOption[]
    /** `boolean` 恒为 false（契约：是否型不支持自定义输入） */
    allowCustom: boolean
    customPlaceholder: string
    required: boolean
}

/** @desc 单题作答草稿（UI 状态；`picked` 不含自定义值，自定义由 `customOn` + `customText` 表示） */
export interface AskDraftItem {
    /** 已勾选的预设选项 value（boolean: yes/no；single: 至多一个；multi: 可多个，保持勾选先后） */
    picked: string[]
    /** 「其它」行是否被选中（单选/是否型下与 `picked` 互斥） */
    customOn: boolean
    /** 自定义输入原文（需 `customOn` 且非空才进结果） */
    customText: string
    /** 用户显式点了「忽略本题」 */
    skipped: boolean
}

/** @desc 整组草稿：key = 归一后的题目 id */
export type AskDraft = Record<string, AskDraftItem>

/** @desc 归一后的整组提问（组件渲染取它，不再看原始 request） */
export interface AskCardGroup {
    title: string
    description: string
    questions: AskCardQuestion[]
    draft: AskDraft
}

/** @desc 逐题状态（进度条 / 题号点用）：已作答 / 已忽略 / 未作答 */
export type AskQuestionStatus = 'answered' | 'skipped' | 'unanswered'

// ── 内部小工具 ──────────────────────────────────────────────────────────────

const text = (v: unknown): string => String(v ?? '').trim()

/** @desc 把运行时可能出现的非法 type 收成 `boolean`（契约有校验，这里只防模板拿到未知类型） */
const readType = (v: unknown): AskUserQuestionType =>
    v === 'single' || v === 'multi' || v === 'boolean' ? v : 'boolean'

/** @desc 空草稿（每次返回新对象，避免多处共享同一份可变状态） */
export const emptyDraftItem = (): AskDraftItem => ({ picked: [], customOn: false, customText: '', skipped: false })

// ── 归一 ────────────────────────────────────────────────────────────────────

/**
 * @desc 归一候选项：丢弃无 value 的项、按 value 去重（保留先出现的）、label 缺失时回落成 value。
 *  去重不是为了「纠正模型」，而是为了让 `{#each (opt.value)}` 的 key **恒唯一** —— 重复 key 是运行时错误。
 */
export const normalizeOptions = (options: AskUserOption[] | undefined): AskCardOption[] => {
    const seen = new Set<string>()
    const out: AskCardOption[] = []
    for (const raw of options ?? []) {
        const value = text(raw?.value)
        if (!value || seen.has(value)) continue
        seen.add(value)
        const label = text(raw?.label) || value
        const description = text(raw?.description)
        out.push(description ? { value, label, description } : { value, label })
    }
    return out
}

/** @desc 归一单题：补 id（`q{序号}`）/ 改写重复 id / 解析 allowCustom 与 required / 丢弃 boolean 的 options */
export const normalizeQuestion = (raw: AskUserQuestion, index: number, used: Set<string>): AskCardQuestion => {
    const preferred = text(raw.id)
    const base = preferred || `q${index + 1}`
    let id = base
    // 撞 id 时后缀从 -2 起（第二个同名 → `id-2`，第三个 → `id-3`），保证组内唯一
    let suffix = 1
    while (used.has(id)) {
        suffix += 1
        id = `${base}-${suffix}`
    }
    used.add(id)

    const type = readType(raw.type)
    const description = text(raw.description)
    const customPlaceholder = text(raw.customPlaceholder)
    return {
        id,
        no: index + 1,
        type,
        question: text(raw.question) || `第 ${index + 1} 题`,
        ...(description ? { description } : {}),
        options: type === 'boolean' ? [] : normalizeOptions(raw.options),
        // 契约：默认允许自定义输入；boolean 恒不支持（它只有「是 / 否」两段）
        allowCustom: type !== 'boolean' && raw.allowCustom !== false,
        customPlaceholder: customPlaceholder || DEFAULT_CUSTOM_PLACEHOLDER,
        required: raw.required === true
    }
}

/** @desc 归一整组问题（保证 id 组内唯一，供 `{#each (q.id)}` 与草稿 key 使用） */
export const normalizeQuestions = (rawQuestions: AskUserQuestion[] | undefined): AskCardQuestion[] => {
    const used = new Set<string>()
    return (rawQuestions ?? []).map((raw, i) => normalizeQuestion(raw, i, used))
}

/** @desc 建立整组草稿（每题一份空草稿） */
export const createDraft = (questions: AskCardQuestion[]): AskDraft => {
    const draft: AskDraft = {}
    for (const q of questions) draft[q.id] = emptyDraftItem()
    return draft
}

/** @desc 归一一次提问：题组 + 初始草稿（组件挂载时算一次即固定，见组件注释） */
export const normalizeGroup = (request: AskUserRequest): AskCardGroup => {
    const questions = normalizeQuestions(request?.questions)
    return {
        title: text(request?.title),
        description: text(request?.description),
        questions,
        draft: createDraft(questions)
    }
}

// ── 读取草稿 ────────────────────────────────────────────────────────────────

/** @desc 取某题草稿（缺省给一份空草稿，避免模板里到处判空） */
export const draftOf = (draft: AskDraft, id: string): AskDraftItem => draft[id] ?? emptyDraftItem()

/** @desc 预设选项是否被勾选 */
export const isPicked = (draft: AskDraft, id: string, value: string): boolean =>
    draftOf(draft, id).picked.includes(value)

/** @desc 「其它」行是否被选中 */
export const isCustomOn = (draft: AskDraft, id: string): boolean => draftOf(draft, id).customOn

// ── 作答状态机（全部返回新草稿）─────────────────────────────────────────────

/** @desc 单选型 / 是否型：选中一个预设项（单选语义 —— 同时清掉「其它」） */
export const pickRadio = (draft: AskDraft, id: string, value: string): AskDraft => ({
    ...draft,
    [id]: { picked: [value], customOn: false, customText: draftOf(draft, id).customText, skipped: false }
})

/** @desc 多选型：切换一个预设项（保持勾选先后；`values` 的顺序即用户勾选顺序，自定义值最后追加） */
export const toggleCheck = (draft: AskDraft, id: string, value: string): AskDraft => {
    const item = draftOf(draft, id)
    const picked = item.picked.includes(value) ? item.picked.filter((v) => v !== value) : [...item.picked, value]
    return { ...draft, [id]: { ...item, picked, skipped: false } }
}

/**
 * @desc 勾选 / 取消「其它」行。它是**选项本身**，故遵守各自题型的互斥规则：
 *  - single / boolean → 单选语义，勾上「其它」即清掉预设项；
 *  - multi → 与预设项各自独立。
 */
export const setCustomPick = (draft: AskDraft, question: AskCardQuestion, on: boolean): AskDraft => {
    const item = draftOf(draft, question.id)
    const picked = question.type === 'multi' || !on ? item.picked : []
    return { ...draft, [question.id]: { ...item, picked, customOn: on, skipped: false } }
}

/**
 * @desc 写入自定义输入原文。输入非空即视为**选中「其它」**（输入框只在「其它」展开时可见，
 *  故「有内容却不选中」是不可能的状态）；单选型下同时清掉预设项，与 `setCustomPick(true)` 同一套互斥规则。
 */
export const setCustomText = (draft: AskDraft, question: AskCardQuestion, value: string): AskDraft => {
    const item = draftOf(draft, question.id)
    const customOn = item.customOn || value.trim().length > 0
    const picked = question.type === 'multi' || !customOn ? item.picked : []
    return { ...draft, [question.id]: { ...item, picked, customOn, customText: value, skipped: false } }
}

/** @desc 可否「忽略本题」（必答题不可忽略 —— 否则 `required` 形同虚设） */
export const canSkip = (question: AskCardQuestion): boolean => !question.required

/** @desc 忽略本题：清空该题作答并标记 `skipped`；必答题调用它是 no-op（组件层按钮也已禁用，双保险） */
export const skipQuestion = (draft: AskDraft, question: AskCardQuestion): AskDraft =>
    canSkip(question) ? { ...draft, [question.id]: { ...emptyDraftItem(), skipped: true } } : draft

// ── 作答判定与提交归一 ──────────────────────────────────────────────────────

/** @desc 自定义输入的有效值（未选中「其它」/ 不允许自定义 / 空文本 → 空串） */
export const customValue = (question: AskCardQuestion, item: AskDraftItem): string =>
    question.allowCustom && item.customOn ? item.customText.trim() : ''

/**
 * @desc 单题最终 values（契约）：
 *  - `boolean` → `[yes]` / `[no]`
 *  - `single`  → `[预设 value]` 或 `[自定义原文]`
 *  - `multi`   → `[预设 value, …]`，自定义原文**追加在末尾**
 *  skipped 或未作答 → 空数组。
 */
export const answerValues = (question: AskCardQuestion, item: AskDraftItem): string[] => {
    if (item.skipped) return []
    const custom = customValue(question, item)
    if (question.type === 'boolean') return item.picked.slice(0, 1)
    if (question.type === 'single') return custom ? [custom] : item.picked.slice(0, 1)
    return custom ? [...item.picked, custom] : [...item.picked]
}

/** @desc 该题是否已作答（有值时才算答；「其它」勾了但没输入不算） */
export const isAnswered = (question: AskCardQuestion, item: AskDraftItem): boolean =>
    answerValues(question, item).length > 0

/** @desc 逐题状态（进度条 / 题号点用） */
export const questionStatus = (question: AskCardQuestion, item: AskDraftItem): AskQuestionStatus =>
    isAnswered(question, item) ? 'answered' : item.skipped ? 'skipped' : 'unanswered'

/** @desc 题号旁的小标记（题型 / 可自定义 / 必答） */
export const questionBadges = (question: AskCardQuestion): string[] => {
    const type = question.type === 'boolean' ? '是否' : question.type === 'multi' ? '多选' : '单选'
    const badges = [type]
    if (question.allowCustom) badges.push('可自定义')
    if (question.required) badges.push('必答')
    return badges
}

/** @desc 未作答的必答题（提交阻断项；空数组 = 可以提交） */
export const submitBlockers = (questions: AskCardQuestion[], draft: AskDraft): AskCardQuestion[] =>
    questions.filter((q) => q.required && !isAnswered(q, draftOf(draft, q.id)))

/** @desc 是否可以提交（所有必答题都已作答） */
export const canSubmit = (questions: AskCardQuestion[], draft: AskDraft): boolean =>
    submitBlockers(questions, draft).length === 0

/** @desc 阻断文案：明确指出是第几题（例：「第 2 题必答，尚未作答」）；无阻断项时为空串 */
export const blockerText = (questions: AskCardQuestion[]): string =>
    questions.length === 0 ? '' : `第 ${questions.map((q) => q.no).join('、')} 题必答，尚未作答`

/**
 * @desc 单题归一成契约里的 `AskUserAnswer`：
 *  未作答（含显式忽略、必答题被强行提交的极端情况）→ `skipped: true` + 空 `values`；
 *  有自定义输入时另带 `custom`（便于 AI 区分「预设项」与「自由输入」）。
 */
export const toAnswer = (question: AskCardQuestion, item: AskDraftItem): AskUserAnswer => {
    const values = answerValues(question, item)
    if (values.length === 0) return { id: question.id, type: question.type, skipped: true, values: [] }
    const custom = customValue(question, item)
    return { id: question.id, type: question.type, skipped: false, values, ...(custom ? { custom } : {}) }
}

/** @desc 整组提交结果：逐题按顺序归一（契约要求未作答的非必答题也出现，且 `skipped: true`） */
export const toResult = (questions: AskCardQuestion[], draft: AskDraft): AskUserResult => ({
    submitted: true,
    answers: questions.map((q) => toAnswer(q, draftOf(draft, q.id)))
})

/** @desc 「放弃作答」结果：中止 / 取消 / 面板关闭 / 卸载一律用它（契约：submitted=false） */
export const cancelResult = (): AskUserResult => ({ submitted: false, answers: [] })

/**
 * @desc 把 `resolve` 包成**最多生效一次**的收尾函数。
 *  为什么需要它：提问卡有两条收尾路径（用户提交 / 卡片卸载按放弃收尾），二者可能同时发生
 *  （提交 → 父组件清状态 → 卡片卸载 → 卸载回调再收尾一次）。原生 `Promise` 对重复 `resolve`
 *  本身是幂等的，但这里要把「只 resolve 一次」变成**代码级事实**，顺带让重复调用不再触发任何副作用。
 */
export const settleOnce = <T>(settle: (value: T) => void): ((value: T) => void) => {
    let done = false
    return (value: T) => {
        if (done) return
        done = true
        settle(value)
    }
}

// ── 导航 / 进度 ─────────────────────────────────────────────────────────────

/** @desc 下标钳制（越界一律夹回合法区间；`total` 为 0 时给 0） */
export const clampIndex = (index: number, total: number): number => Math.max(0, Math.min(index, Math.max(0, total - 1)))

/** @desc 有上一题吗（第一题 → false，「上一题」按钮禁用） */
export const canGoPrev = (index: number): boolean => index > 0

/** @desc 有下一题吗（最后一题 → false，「下一题」按钮禁用） */
export const canGoNext = (index: number, total: number): boolean => index < total - 1

/** @desc 相对位移并钳制（上一题 / 下一题的统一实现） */
export const stepIndex = (index: number, total: number, delta: number): number => clampIndex(index + delta, total)

/**
 * @desc 「忽略本题」后的落点：非末题自动前进一题（用户点忽略就是想跳过这题继续答），末题原地不动。
 *  这是对交互规则「按下即标记 skipped **并可跳下一题**」的落地理解，已在交付报告里说明。
 */
export const indexAfterSkip = (index: number, total: number): number =>
    canGoNext(index, total) ? index + 1 : clampIndex(index, total)

/** @desc 进度文案：「第 N / M 题」 */
export const progressText = (index: number, total: number): string => `第 ${clampIndex(index, total) + 1} / ${total} 题`

/**
 * @desc Enter 的落点：**非末题 → 前进一题；已是末题 → 提交**。
 *
 * 为什么不是「Enter 一律提交」：本卡是**逐题**界面（一屏一题 + 上一题/下一题 + 题号跳题），
 * Enter 一路推进才符合逐题作答的直觉，到末题自然落到提交。
 * 返回 `null` 表示「提交」（调用方据此分支），否则返回应跳到的题号下标。
 *
 * 注意提交仍受 `submitBlockers` 把关：末题按 Enter 而必答题未作答时不会真的交卷，
 * 卡片会显示「第 N 题必答，尚未作答」，故 `enterStep` 不必自己判可提交性。
 */
export const enterStep = (index: number, total: number): number | null => (canGoNext(index, total) ? index + 1 : null)

/**
 * @desc 窗口级 Enter 是否应当被本卡接管。
 *
 * 三种情况**必须放行**（交回浏览器/控件）：
 *  ① 焦点在 `input` / `textarea` / `select` 内 —— 那里 Enter 归控件（本卡「其它」输入框有自己的处理）；
 *  ② 带修饰键（Ctrl/Alt/Meta/Shift）—— 别劫持快捷键；
 *  ③ 输入法组合中 —— 中文拼音选词的 Enter 是「上屏」，当成推进就会吞掉选词。
 *
 * 入参直接吃 `KeyboardEvent`（而不是自定义的结构化子集）：`keyCode` 在 DOM 类型里是必填 `number`、
 * `target` 是 `EventTarget | null`，写成结构化子类型会与真实事件不兼容
 * （实测 svelte-check 报「Argument of type 'KeyboardEvent' is not assignable to parameter of type …」）。
 * 测试里构造假事件时用 `as unknown as KeyboardEvent` 即可。
 */
export const shouldHandleEnter = (e: KeyboardEvent): boolean => {
    if (e.key !== 'Enter') return false
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false
    // keyCode 229 = IME 组合中（老浏览器路径；`isComposing` 是标准路径，两者都认）
    if (e.isComposing || e.keyCode === 229) return false
    const tag = ((e.target ?? null) as { tagName?: string } | null)?.tagName
    if (tag && /^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return false
    return true
}
