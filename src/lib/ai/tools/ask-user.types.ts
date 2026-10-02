/**
 * @desc 「向用户提问」工具（`ask_user`）的**契约类型**：AI 侧提问结构 + 宿主侧作答结果。
 *
 * 为什么单独成文件：`registry.ts` 需要 `AskUserFn` 来声明 `ToolContext.askUser`，
 * 而提问结构又被工具实现与 UI 同时引用。放这里可避免 registry ↔ 工具 ↔ UI 之间的循环 import
 * （本文件**只有类型**，无运行时依赖）。
 *
 * 能力归属（**关键**）：`askUser` 是**宿主提供的能力**，只有内置 AI 助手会注入它。
 *  WS 远程接管（`$lib/ws-remote`）没有交互界面，故不注入 —— 于是 `ask_user` 在 WS 上下文里
 *  ① 不出现在 hello 的工具清单里、② 即便被直接 exec 也会返回明确错误。见 `registry.availableTools`。
 */

/** @desc 问题类型：是否型 / 单选型 / 多选型 */
export type AskUserQuestionType = 'boolean' | 'single' | 'multi'

/** @desc 单选 / 多选的候选项 */
export interface AskUserOption {
    /** 选项值（提交结果里回传这个） */
    value: string
    /** 选项显示文案 */
    label: string
    /** 可选的补充说明（hover/次行显示） */
    description?: string
}

/** @desc 单个问题 */
export interface AskUserQuestion {
    /** 稳定 id；AI 可省略，宿主按序号补 `q1`/`q2`…（结果里回传的一定是补全后的 id） */
    id?: string
    type: AskUserQuestionType
    /** 问题正文 */
    question: string
    /** 可选的补充说明（展示在问题下方） */
    description?: string
    /** `single` / `multi` **必填**；`boolean` 忽略 */
    options?: AskUserOption[]
    /** `single` / `multi` 是否允许「自定义输入」（默认 true） */
    allowCustom?: boolean
    /** 自定义输入框的占位提示 */
    customPlaceholder?: string
    /** 是否必答：true 时「忽略本题」被禁用，且未作答时不允许提交（默认 false） */
    required?: boolean
}

/** @desc 一次提问（**问题组**：可以只问一题，也可以一次问多题，用户逐题作答） */
export interface AskUserRequest {
    /** 整组问题的标题（可选） */
    title?: string
    /** 为什么问这些（可选，展示在标题下方） */
    description?: string
    questions: AskUserQuestion[]
}

/** @desc 单题作答 */
export interface AskUserAnswer {
    /** 补全后的稳定 id */
    id: string
    type: AskUserQuestionType
    /** 用户点了「忽略本题」（或提交时该非必答题目未作答） */
    skipped: boolean
    /**
     * 作答值：
     *  - `boolean` → `['yes']` / `['no']`
     *  - `single`  → `[选项 value]` 或 `[自定义输入原文]`
     *  - `multi`   → `[选项 value, …]`，自定义输入原文也追加在末尾
     *  `skipped` 为 true 时是空数组。
     */
    values: string[]
    /** 用户自定义输入原文（若用过），便于 AI 区分「预设项」与「自由输入」 */
    custom?: string
}

/** @desc 整组提问的作答结果 */
export interface AskUserResult {
    /** 用户是否点了「提交」（false = 中途放弃 / 本轮被取消 / 面板被强制关闭） */
    submitted: boolean
    answers: AskUserAnswer[]
}

/** @desc 宿主的提问实现（内置 AI 助手）：渲染问题组 → 用户逐题作答 → 提交后 resolve */
export type AskUserFn = (request: AskUserRequest) => Promise<AskUserResult>
