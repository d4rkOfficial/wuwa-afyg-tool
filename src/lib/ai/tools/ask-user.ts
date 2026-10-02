// ─────────────────────────────────────────────────────────────────────────────
// 【本文件的注释约定 — 改文案/加注释前必读】
// scripts/generate-tools-doc.mjs 是「纯正则 + 括号/引号/注释感知」的解析器（不执行 TS）。
// T26 起它会跳过注释与模板串，T28 起取值只在**顶层键**上做、并支持引用本文件的常量，于是：
//   A) 注释里出现反引号 / 裸引号**已不再是问题**（T28 实测：成对/单个反引号、单个/成对单引号、双引号、
//      块注释、乃至参数表内部的这类注释，参数表都照常解析；见 .tmp/reports/T28.md §C.4）。
//   B) `parameters` **仍必须是内联的对象字面量**：写成 `parameters: PARAMETERS`（引用常量）时
//      extractParams 取不到花括号，参数表会变成「_无参数_」。这是解析器不执行 TS 的硬限制。
//   C) 属性级 description 用模板字符串**已支持**（嵌套模板串也对，`${…}` 会被折叠成 `…`）。
// 顶层 description 既可以写成拼接字面量，也可以抽成同文件的 const（T28 起会解析该常量）。
// ─────────────────────────────────────────────────────────────────────────────
// 交互式提问工具（ask_user）：向用户抛出「问题组」，阻塞当前回合等用户逐题作答。
//
// 能力门控（ws 无法调用的落地方式）：本工具声明 requires: 'askUser' ——
//   ToolContext.askUser 只由内置 AI 助手注入（见 src/lib/ai/session.ts 的 onAskUser），
//   WS 远程接管刻意不注入（没有交互界面）。于是 WS 上下文里：
//     ① availableTools() 把它从发给模型的清单里滤掉；
//     ② 即便被直接 exec，executeTool() 也会返回明确错误。
//   两道防线都在 registry 里，本文件不重复实现；但 handler 仍会自查一次
//   ctx.askUser（handler 也可能被别的路径直接调用，见任务约定）。
//
// 参数校验/归一与结果归一都是**纯函数**，拆在同目录 ask-user.utils.ts（AGENTS §1）。
// ─────────────────────────────────────────────────────────────────────────────
import { defineTool } from './registry'
import {
    MAX_OPTIONS,
    MAX_QUESTIONS,
    normalizeAskRequest,
    normalizeAskUserResult,
    summarizeAnswers
} from './ask-user.utils'

const DESCRIPTION =
    '向用户提出一个或多个结构化问题，并阻塞当前回合直到用户作答完毕。' +
    '界面是**逐题问答**：每题可「上一题 / 下一题 / 忽略本题」，最后一题或任意时刻可「提交」；' +
    '用户提交或放弃后你才会拿回控制权，期间不要假设用户已经看到或已经作答。\n' +
    '\n' +
    '题型与结果里 values 的取值约定：\n' +
    '- boolean（是否型）：界面显示「是 / 否」，values 为 ["yes"] 或 ["no"]，请不要给它 options。\n' +
    '- single（单选型）：values 为 [某个选项 value] 或 [用户自定义输入原文]；默认允许自定义输入。\n' +
    '- multi（多选型）：values 为 [选项 value, …]（可能为空），用户的自定义输入原文追加在末尾；默认允许自定义输入。\n' +
    '- 「其它」由界面保证只出现一次：你在 options 里已经写了「其它」（label 或 value 命中「其它 / 其他 / other / custom / 自定义」）时，' +
    '界面**不会再补一行**，而是让那一项自己展开输入框（此时 answers[].values 里是用户输入的原文）；你没写时界面才补一行「其它」。\n' +
    '\n' +
    '什么时候该用：\n' +
    '- 缺少只有用户知道的关键信息（目标、偏好、业务含义、外部约束），且不打算为了猜而做无用功；\n' +
    '- 存在多个都合理的实现方向，需要用户拍板（例如「改哪一套 Buff 集」「用哪种出图口径」）；\n' +
    '- 需求内部有冲突/歧义，必须先澄清再动手。\n' +
    '什么时候不该用：\n' +
    '- 能自己查到的（工具清单/工程状态/文档里已有的），先自己查，不要把查询工作推给用户；\n' +
    '- 不要拿它当「危险操作二次确认」——危险操作有专门的确认机制（工具的 dangerous 标记），用它只会无谓地打断用户一次。\n' +
    '\n' +
    '结果约定：\n' +
    '- answers 是逐题作答数组，含补全后的 id、type、skipped、values、custom（用户自定义输入原文）。\n' +
    '- 用户可以「忽略本题」（或提交时未答非必答题）：必须逐题检查 skipped，skipped=true 时 values 为空数组——' +
    '不要臆造被跳过的答案，也不要把「没答」当成「默认值」。\n' +
    '- submitted=false 表示用户中途放弃、面板被关闭或本轮被取消：此时应当停止当前方案并直接询问用户下一步，' +
    '不要自动重试同一个问题组。\n' +
    '- 额外字段 notes 记录了入参被改写过什么（补 id / 改写重复 id / 忽略 boolean 的 options / 截断超长文本），' +
    '有内容时请据此修正下次调用。'

defineTool('ask_user', {
    // 能力门控：只有注入了宿主能力 askUser 的上下文（内置 AI 助手）能用；WS 远程接管不注入。
    // 详见文件头说明；parameters 必须内联（见文件头约束 B）。
    parameters: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: '整组问题的标题（可选，显示在问答面板顶部），例如「需要你确认两件事」'
            },
            description: { type: 'string', description: '为什么问这些（可选，显示在标题下方），简要说明背景即可' },
            questions: {
                type: 'array',
                minItems: 1,
                maxItems: MAX_QUESTIONS,
                description:
                    '问题组，按顺序逐题提问，最多 20 题（与 Schema 的 maxItems 一致，便于模型预判规模）。每题一个对象，见 items。',
                items: {
                    type: 'object',
                    properties: {
                        id: {
                            type: 'string',
                            description:
                                '本题的稳定标识（可选，缺省按序号补 q1/q2…）。结果里的 answers[].id 就是它，重复会被改写'
                        },
                        type: {
                            type: 'string',
                            enum: ['boolean', 'single', 'multi'],
                            description:
                                'boolean=是否型（**不要填 options**，界面固定「是 / 否」，values 为 yes/no）；single=单选型；multi=多选型'
                        },
                        question: { type: 'string', description: '问题正文（必填，尽量具体到可直接回答）' },
                        description: {
                            type: 'string',
                            description: '补充说明（可选，显示在问题下方），如背景、影响面、你的倾向'
                        },
                        options: {
                            type: 'array',
                            minItems: 1,
                            maxItems: MAX_OPTIONS,
                            description:
                                '候选选项，**single / multi 必填且至少 1 项**；boolean 请省略此项（给了会被忽略）。最多 30 项（与 Schema 的 maxItems 一致）。',
                            items: {
                                type: 'object',
                                properties: {
                                    value: {
                                        type: 'string',
                                        description: '选项值：结果里回传的就是它，同一题内必须唯一'
                                    },
                                    label: { type: 'string', description: '选项显示文案（必填）' },
                                    description: {
                                        type: 'string',
                                        description: '选项的补充说明（可选，次行 / hover 显示）'
                                    }
                                },
                                required: ['value', 'label'],
                                additionalProperties: false
                            }
                        },
                        allowCustom: {
                            type: 'boolean',
                            description:
                                'single / multi 是否允许「自定义输入」框（默认 true）；boolean 恒为「是 / 否」，不受此项影响'
                        },
                        customPlaceholder: {
                            type: 'string',
                            description: '自定义输入框的占位提示（可选），如「其它（请说明）」'
                        },
                        required: {
                            type: 'boolean',
                            description:
                                '是否必答（默认 false）。true 时「忽略本题」被禁用且未作答不允许提交；请克制使用，用户可能确实答不上来'
                        }
                    },
                    required: ['type', 'question'],
                    additionalProperties: false
                }
            }
        },
        required: ['questions'],
        additionalProperties: false
    },
    // T28 起 generate-tools-doc.mjs 只取**顶层** description。这里的 DESCRIPTION 是同文件常量，
    // 解析器会顺着常量找到拼接后的完整文案（实测 docs/tools.md 里 ask_user 的摘要就是下面这段长描述）。
    // 历史上（T26 及以前）它取「块内第一个 description」，所以当时把 parameters 排在最前面来规避；
    // 那段取舍已经不需要了 —— 本字段的位置现在与文档摘要无关。
    description: DESCRIPTION,
    // 能力门控：只有注入了宿主能力 askUser 的上下文（内置 AI 助手）能用；WS 远程接管不注入
    requires: 'askUser',
    handler: async (args, ctx) => {
        // 兜底：正常路径上 executeTool 已按 requires 拦过（返回 ok:false），
        // 但 handler 也可能被别的路径直接调用，故这里再自查一次能力。
        const askUser = ctx.askUser
        if (!askUser) {
            throw new Error(
                '当前上下文不支持交互式提问（缺少宿主能力 askUser）：该功能需要内置 AI 助手的交互界面，WS 远程接管无法调用'
            )
        }

        const { questions, notes: requestNotes, ...meta } = normalizeAskRequest(args)

        let raw: unknown
        try {
            raw = await askUser({ ...meta, questions })
        } catch (e) {
            // 宿主侧异常（面板崩溃 / 提问被中断）不该冒泡成「工具参数错误」，给一句人能读的原因
            throw new Error(`向用户提问失败：${e instanceof Error ? e.message : String(e)}`)
        }
        const result = normalizeAskUserResult(raw, questions)
        const notes = [...requestNotes, ...result.notes]

        if (!result.submitted) {
            notes.push('用户未提交（submitted=false）：本轮已作废，请停止当前方案并询问用户下一步，不要重试同一问题组')
        }

        const questionView = questions.map((q) => ({
            id: q.id,
            type: q.type,
            question: q.question,
            options: q.options?.map((o) => o.value) ?? []
        }))

        return {
            submitted: result.submitted,
            answers: result.answers,
            questions: questionView,
            answerSummary: summarizeAnswers(result.answers, questions),
            notes
        }
    }
})
