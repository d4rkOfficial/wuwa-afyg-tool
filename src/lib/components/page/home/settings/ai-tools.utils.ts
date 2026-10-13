/**
 * @desc 助手工具时间线的并入逻辑（纯函数，便于单测）。
 *
 * ## 为什么必须单独抽出来
 * 原实现是「拿**最后一张卡**，名称相同就当作它的结果」：
 * 只要有一张卡没配对到结果事件，**后续每一次配对都会顺延错位**，症状就是卡片永远停在「执行中…」。
 * 实测触发点：服务端 `web_search` 完成时只更新了实时状态、**没有发结果事件**，
 * 于是它后面所有工具的结果都被记到了别人身上（或各自新增一张卡），原卡永远不收尾。
 *
 * 改成按 `seq`（回合内递增的调用序号）配对后，一次错配**只影响自己**，不会传染。
 */
export interface ToolCard {
    name: string
    args: Record<string, unknown>
    /** @desc 结果字符数（有值即表示已结束） */
    resultLen?: number
    /** @desc 「无结果体」的结束标记（如服务端 `web_search` 只报检索完成） */
    done?: boolean
    /** @desc 本次调用的序号（与 `session.ts` 的 emit 配对；纯进度伪卡片没有它） */
    seq?: number
}

/** @desc 一次 `tool` 事件里与时间线有关的字段（`SessionEvent` 的子集，便于测试构造） */
export interface ToolEventLike {
    toolName?: string
    toolArgs?: Record<string, unknown>
    resultLen?: number
    done?: boolean
    seq?: number
}

/** @desc 结果事件 = 带 resultLen 或显式 done；否则是「开始调用」 */
const isResultEvent = (evt: ToolEventLike): boolean => evt.resultLen !== undefined || evt.done === true

/**
 * @desc 把一次 `tool` 事件并入工具时间线。
 * - 调用事件 → 追加一张新卡；
 * - 结果事件 → 按 `seq` 定位并补上结果；**找不到也绝不动别的卡**，只追加一张已结束的卡。
 */
export const applyToolEvent = (cards: readonly ToolCard[], evt: ToolEventLike): ToolCard[] => {
    if (!isResultEvent(evt)) {
        return [
            ...cards,
            {
                name: evt.toolName ?? 'tool',
                args: evt.toolArgs ?? {},
                ...(evt.seq !== undefined ? { seq: evt.seq } : {})
            }
        ]
    }
    const index = evt.seq === undefined ? -1 : cards.findIndex((card) => card.seq === evt.seq)
    if (index < 0) {
        return [
            ...cards,
            {
                name: evt.toolName ?? 'tool',
                args: evt.toolArgs ?? {},
                ...(evt.resultLen !== undefined ? { resultLen: evt.resultLen } : {}),
                ...(evt.done ? { done: true } : {})
            }
        ]
    }
    return cards.map((card, i) =>
        i === index
            ? {
                  ...card,
                  ...(evt.resultLen !== undefined ? { resultLen: evt.resultLen } : {}),
                  ...(evt.done ? { done: true } : {})
              }
            : card
    )
}

/**
 * @desc 长任务进度（`generate_*`）：优先挂到正在跑的那张卡上（改它的 `status`），
 * 否则追加一张**纯进度伪卡** —— 它没有 `seq`，因此永远不会抢走真实调用的结果配对。
 */
export const applyToolProgress = (cards: readonly ToolCard[], status: string): ToolCard[] => {
    const last = cards[cards.length - 1]
    if (last && last.name.startsWith('generate_') && last.resultLen === undefined && !last.done) {
        return cards.map((card, i) => (i === cards.length - 1 ? { ...card, args: { ...card.args, status } } : card))
    }
    return [...cards, { name: 'buff生成', args: { status } }]
}
