/**
 * @desc 「长任务模式」的纯逻辑：自动继续的判定与续写提示词。
 *
 * ## 为什么需要它
 * 一次 `runAiTurn` 在模型不再调用工具时就会结束 —— 对「查一遍数据、改几处配置、再校验」这类
 * 跨很多步的任务，模型一次回复写完就停，用户得手动打字「继续」。长任务模式让 AI 自己声明
 * 「这件事没做完，别结束回合」，于是输出停止后系统自动追加一条续写提示，直到 AI 主动关闭。
 *
 * ## 谁控制
 * - **AI**：通过 `set_long_task` 工具开关（它自己判断任务边界）；
 * - **用户**：停止按钮直接 abort 并清掉状态（见 `session.ts` 的 `finishTurn` 与界面的停止逻辑）；
 * - **系统**：轮次上限是最后一道保险，到顶后停止并明确报告，而不是无限循环。
 *
 * 本文件无副作用，便于单测；状态本身在 `turn-state.svelte.ts`。
 */

/** @desc 开关长任务模式的工具名（提示词里点名它，模型才知道用哪个工具关闭） */
export const LONG_TASK_TOOL_NAME = 'set_long_task'

/** @desc 自动继续的判定入参 */
export interface AutoContinueInput {
    /** @desc 当前是否处于长任务模式 */
    active: boolean
    /** @desc 用户是否已经按了停止 */
    aborted: boolean
    /** @desc 下一次模型调用是第几轮（从 1 开始；即已用轮次 + 1） */
    nextRound: number
    /** @desc 本回合的轮次上限（含工具轮次与自动继续） */
    maxRounds: number
}

/**
 * @desc 输出停止后是否应自动继续。
 * 三个条件缺一不可：长任务开着、用户没中止、还有轮次预算。
 */
export const canAutoContinue = (input: AutoContinueInput): boolean =>
    input.active && !input.aborted && input.nextRound < input.maxRounds

/**
 * @desc 组装「输出停止 → 继续推进」的提示词。
 *
 * 刻意写成 `user` 消息（由 `session.ts` 以 `ephemeral` 标记注入、不进持久历史）：
 * - 它是一句明确的执行指令，不是模型自己的输出；
 * - 不进入历史，避免多轮自动继续后历史里堆满「继续」。
 *
 * @param count 第几次自动继续（从 1 开始，给模型一个「已经续过几轮」的感知）
 * @param goal AI 开启长任务时写的目标 / 进度（可能为空）
 */
export const buildLongTaskContinuation = (count: number, goal: string): string => {
    const trimmed = goal.trim()
    return [
        `【长任务模式 · 自动继续第 ${count} 次】`,
        '你上一次输出已经停止，但长任务模式仍处于开启状态。请直接继续推进当前任务，不要等用户再说「继续」。',
        trimmed ? `当前任务目标 / 进度：${trimmed}` : '',
        '继续前先判断：哪些步骤已完成、哪些还没做。不要重复已完成的工作；需要时继续调用工具。',
        `只有确认**整个任务已经完成**（或确认无法继续）时，才调用 ${LONG_TASK_TOOL_NAME}（enabled=false）关闭长任务模式；任务未完成时不要关闭。`,
        '如果任务确实已经完成，请关闭长任务模式并给出最终结果。'
    ]
        .filter(Boolean)
        .join('\n')
}
