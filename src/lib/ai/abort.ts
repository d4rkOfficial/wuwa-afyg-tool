/**
 * @desc 让「一次工具调用」可被中止（纯逻辑，便于单测）。
 *
 * ## 为什么必须有它（实测故障）
 * `runAiTurn` 的工具循环里是 `await executeTool(...)`。**工具处理器不接受取消**（130 个工具里
 * 绝大多数都没有拿 `signal`），所以只要某个工具不返回，整轮就会永远停在「正在调用工具「X」」，
 * 实时状态条的计时一直涨；更糟的是**停止按钮也没用** —— `abortCtrl.abort()` 只能打断 HTTP 流，
 * 打不断已经在跑的工具。用户看到的就是「任务早完成了，却还在执行中，而且暂停不掉」。
 *
 * 这里用 race 把控制权交回回合循环：`signal` 一触发就**立刻**以中止结果收尾，
 * 不再等工具自己返回（工具若之后才返回，其结果会被丢弃）。
 * 于是 `endToolCall` 必定执行、状态条必定恢复、循环下一轮也会看到 signal 已 abort 而收尾。
 */
export const ABORTED_TOOL_OUTPUT = JSON.stringify({ ok: false, cancelled: true, error: '已停止生成' })

/**
 * @desc 竞速：`task` 与 `signal` 谁先到用谁。
 * @param onAbort 中止时用来收尾的值（默认给 `ABORTED_TOOL_OUTPUT`）
 * @returns `task` 正常/异常结束时返回其结果或 `onAbort()`；`signal` 触发时返回 `onAbort()`
 */
export const raceWithAbort = async <T>(
    task: Promise<T>,
    signal: AbortSignal | undefined,
    onAbort: () => T
): Promise<T> => {
    if (!signal) return await task
    if (signal.aborted) return onAbort()
    return await new Promise<T>((resolve) => {
        let settled = false
        const finish = (value: T): void => {
            if (settled) return
            settled = true
            signal.removeEventListener('abort', onSignalAbort)
            resolve(value)
        }
        const onSignalAbort = (): void => finish(onAbort())
        signal.addEventListener('abort', onSignalAbort, { once: true })
        task.then((value) => finish(value)).catch(() => finish(onAbort()))
    })
}
