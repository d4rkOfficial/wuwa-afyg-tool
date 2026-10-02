/**
 * @desc `ask_user` 的**纯函数**成分：入参校验/归一 + 宿主结果校验/归一。
 *
 * 为什么单独成文件（AGENTS §1「纯函数必须拆」）：这两段逻辑没有任何 I/O 与副作用，
 * 却承载了「模型给错参数」与「宿主回错结果」两道防线的全部判定，值得被单独回归。
 * `ask-user.ts` 只负责取 `ctx.askUser`、发起提问、把归一后的结果包成返回结构。
 *
 * 设计原则：**能改写的改写（补 id / 去空白 / 裁长度），改不动的才报错**。
 * 一切改写都通过返回值里的 `notes` 如实上报，绝不静默丢弃模型给的信息。
 */
import type { AskUserOption, AskUserQuestion, AskUserQuestionType } from './ask-user.types'

/** @desc 取值助手：任何输入都收成 trim 过的字符串（与 ai-session.ts 的 `str` 同款） */
export const str = (v: unknown): string => String(v ?? '').trim()

/** @desc 单次提问的问题数上限（防止模型一口气塞爆逐题问答 UI） */
export const MAX_QUESTIONS = 20
/** @desc 单题候选项数量上限 */
export const MAX_OPTIONS = 30
/** @desc 问题正文最大长度（超出截断，见 `limitText`） */
export const MAX_QUESTION_LEN = 300
/** @desc 补充说明 / 标签 / 选项值 / 自定义占位符的最大长度 */
export const MAX_TEXT_LEN = 600
/** @desc 三个合法类型（同时用于报错文案与 `type` 校验） */
export const QUESTION_TYPES: AskUserQuestionType[] = ['boolean', 'single', 'multi']

/** @desc 归一后的问题 + 宿主可见的标题，以及「入参被改写/忽略过什么」的说明 */
export interface NormalizedAskRequest {
    title?: string
    description?: string
    questions: AskUserQuestion[]
    /** 补 id / 裁长度 / 忽略 boolean 的 options 等改写记录（给模型看） */
    notes: string[]
}

/** @desc 结果归一：丢弃不属于本次提问的作答，`values` 一律收成字符串数组 */
export interface NormalizedAskResult {
    submitted: boolean
    answers: { id: string; type: AskUserQuestionType; skipped: boolean; values: string[]; custom?: string }[]
    /** 宿主结果里被丢弃的内容记录（给模型看） */
    notes: string[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * @desc 归一一段模型给的展示文案：去换行、trim、超长截断。
 *  `used` 为 true 时把截断记为改写（调用方自行 push note）。返回 `null` 表示该字段实际为空。
 */
const limitText = (v: unknown, used: boolean, max: number): { text: string; truncated: boolean } | null => {
    const raw = String(v ?? '')
        .replace(/\s+/g, ' ')
        .trim()
    if (!used || !raw) return null
    return raw.length > max
        ? { text: `${raw.slice(0, max)}…（已截断）`, truncated: true }
        : { text: raw, truncated: false }
}

/** @desc 校验单个候选项：`value` 必填且组内唯一、`label` 必填 */
const readOption = (o: unknown, questionLabel: string, seen: Set<string>): AskUserOption => {
    if (!isRecord(o)) throw new Error(`${questionLabel} 的 options 里存在非对象项（应为 { value, label }）`)
    const value = str(o.value)
    if (!value) throw new Error(`${questionLabel} 的某个选项缺少 value`)
    if (seen.has(value))
        throw new Error(`${questionLabel} 的选项 value 重复：${value}（结果里无法区分，请改用唯一 value）`)
    seen.add(value)
    const label = str(o.label)
    if (!label) throw new Error(`${questionLabel} 的选项 ${value} 缺少 label（选项必须同时给 value 与 label）`)
    const desc = limitText(o.description, o.description !== undefined, MAX_TEXT_LEN)
    return desc ? { value, label, description: desc.text } : { value, label }
}

/** @desc 把「宿主已存在的题号集合」转成补全 id 时的可用值：`q1`/`q2`… 逐个试，跳过早被占用的 */
const uniqueId = (preferred: string, used: Set<string>, fallbackIndex: number): string => {
    const base = preferred || `q${fallbackIndex}`
    let candidate = base
    let n = fallbackIndex
    while (used.has(candidate)) {
        n += 1
        candidate = `${base}-${n}`
    }
    return candidate
}

/**
 * @desc 校验并归一模型给的提问参数（`questions` 数组）。
 *  能改写的改写并在 `notes` 说明（补 id / 修重复 id / 忽略 boolean 的 options / 截断超长文本），
 *  结构性问题直接抛 `Error`（缺 questions、未知 type、单选多选缺 options、value 重复、缺 label、数量超限）。
 */
export const normalizeAskRequest = (args: Record<string, unknown>): NormalizedAskRequest => {
    const notes: string[] = []
    const rawQuestions = args.questions
    if (!Array.isArray(rawQuestions)) {
        throw new Error(
            'questions 必须是数组（至少要有一个问题）；是否型/单选型/多选型都放在同一个数组里，按顺序逐题提问'
        )
    }
    if (rawQuestions.length === 0) {
        throw new Error('questions 至少要有一个问题（空问题组没有意义）')
    }
    if (rawQuestions.length > MAX_QUESTIONS) {
        throw new Error(
            `问题数 ${rawQuestions.length} 超过上限 ${MAX_QUESTIONS}（一次最多问 ${MAX_QUESTIONS} 题，请拆成多次提问）`
        )
    }

    const used = new Set<string>()
    const questions = rawQuestions.map((raw, i): AskUserQuestion => {
        const label = `第 ${i + 1} 题`
        if (!isRecord(raw)) throw new Error(`${label} 不是对象（应为 { type, question, … }）`)

        const rawType = str(raw.type)
        const type = QUESTION_TYPES.find((t) => t === rawType)
        if (!type) {
            throw new Error(`${label} 的 type 非法：${rawType || '(空)'}（合法值：${QUESTION_TYPES.join(' / ')}）`)
        }
        const rawQuestion = str(raw.question)
        if (!rawQuestion) throw new Error(`${label} 缺少 question（问题正文不能为空）`)
        const questionText = limitText(raw.question, true, MAX_QUESTION_LEN)
        if (questionText?.truncated) notes.push(`${label} 的 question 超长，已截断到 ${MAX_QUESTION_LEN} 字符`)

        const id = uniqueId(str(raw.id), used, i + 1)
        if (str(raw.id) && id !== str(raw.id))
            notes.push(`${label} 的 id「${str(raw.id)}」与前面的题目重复，已改写为「${id}」`)
        if (!str(raw.id)) notes.push(`${label} 未提供 id，已补为「${id}」`)
        used.add(id)

        const desc = limitText(raw.description, raw.description !== undefined, MAX_TEXT_LEN)
        if (desc?.truncated) notes.push(`${label} 的 description 超长，已截断到 ${MAX_TEXT_LEN} 字符`)

        const question: AskUserQuestion = { id, type, question: questionText?.text ?? '' }

        if (type === 'boolean') {
            // 契约：boolean 的 options 应留空。这里**不报错**，静默忽略并如实上报，
            // 否则模型一次小失误就会让整组提问失败（用户什么也看不到）。
            if (raw.options !== undefined)
                notes.push(`${label} 是 boolean 类型，已忽略其 options（是否型固定为「是 / 否」）`)
        } else {
            const rawOptions = raw.options
            if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
                throw new Error(`${label} 是 ${type} 类型，必须提供非空的 options 数组（每项 { value, label }）`)
            }
            if (rawOptions.length > MAX_OPTIONS) {
                throw new Error(`${label} 的选项数 ${rawOptions.length} 超过上限 ${MAX_OPTIONS}（请精简候选项）`)
            }
            const seen = new Set<string>()
            question.options = rawOptions.map((o) => readOption(o, label, seen))
        }

        if (desc) question.description = desc.text
        if (raw.allowCustom !== undefined) question.allowCustom = raw.allowCustom !== false
        if (raw.required !== undefined) question.required = raw.required === true
        const placeholder = limitText(raw.customPlaceholder, raw.customPlaceholder !== undefined, MAX_TEXT_LEN)
        if (placeholder?.truncated) notes.push(`${label} 的 customPlaceholder 超长，已截断到 ${MAX_TEXT_LEN} 字符`)
        if (placeholder) question.customPlaceholder = placeholder.text

        return question
    })

    const request: NormalizedAskRequest = { questions, notes }
    const title = limitText(args.title, args.title !== undefined, MAX_TEXT_LEN)
    if (title?.truncated) notes.push(`title 超长，已截断到 ${MAX_TEXT_LEN} 字符`)
    if (title) request.title = title.text
    const groupDesc = limitText(args.description, args.description !== undefined, MAX_TEXT_LEN)
    if (groupDesc?.truncated) notes.push(`description 超长，已截断到 ${MAX_TEXT_LEN} 字符`)
    if (groupDesc) request.description = groupDesc.text
    return request
}

/**
 * @desc 校验并归一宿主的作答结果：**只保留属于本次提问的 id**（宿主 bug 不得污染模型上下文），
 *  `values` 一律归一为字符串数组并剔除空串。`submitted` 严格取 `=== true`（契约：false = 放弃/取消）。
 */
export const normalizeAskUserResult = (result: unknown, questions: AskUserQuestion[]): NormalizedAskResult => {
    const notes: string[] = []
    if (!isRecord(result)) {
        return { submitted: false, answers: [], notes: ['宿主未返回有效结果，已按「用户放弃作答」处理'] }
    }
    const byId = new Map(questions.map((q) => [q.id ?? '', q]))
    const rawAnswers = Array.isArray(result.answers) ? result.answers : []
    const answers: NormalizedAskResult['answers'] = []
    const seen = new Set<string>()
    for (const raw of rawAnswers) {
        if (!isRecord(raw)) {
            notes.push('宿主返回的某个作答不是对象，已忽略')
            continue
        }
        const id = str(raw.id)
        const question = byId.get(id)
        if (!question) {
            notes.push(`宿主返回了本次提问之外的作答 id「${id || '(空)'}」，已忽略`)
            continue
        }
        if (seen.has(id)) {
            notes.push(`宿主返回了重复的作答 id「${id}」，已忽略后一次`)
            continue
        }
        seen.add(id)
        const values = Array.isArray(raw.values) ? raw.values.map((v) => String(v ?? '').trim()).filter(Boolean) : []
        const custom = str(raw.custom)
        answers.push({
            id,
            type: question.type,
            skipped: raw.skipped === true,
            values,
            ...(custom ? { custom } : {})
        })
    }
    if (!Array.isArray(result.answers)) notes.push('宿主结果缺少 answers 数组，已按空作答处理')
    return { submitted: result.submitted === true, answers, notes }
}

/** @desc 模型可读的结果摘要：逐题列出「作答 / 忽略 / 缺失」，强制模型自己检查 `skipped` 而不是臆造答案 */
export const summarizeAnswers = (answers: NormalizedAskResult['answers'], questions: AskUserQuestion[]): string[] =>
    questions.map((q) => {
        const id = q.id ?? ''
        const answer = answers.find((a) => a.id === id)
        if (!answer) return `${id}：未作答（该题既未被忽略也没有值，请按未作答处理，不要臆造）`
        if (answer.skipped) return `${id}：用户忽略了本题（skipped=true，不要臆造答案）`
        return `${id}：${answer.values.length ? answer.values.join('、') : '(空作答)'}`
    })
