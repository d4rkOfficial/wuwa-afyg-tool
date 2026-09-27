/**
 * @desc 纯文本插入：把 `insert` 写入 `text` 的 [start, end) 区间（默认尾部追加）。
 *
 * 供「工具名快速输入」这类「在光标处插入片段」的编辑框使用：
 * 返回新文本与插入后的光标位置，调用方据此更新 textarea 的选区。
 */
export interface TextInsertion {
    text: string
    /** @desc 插入片段结束后的光标位置 */
    cursor: number
}

export const insertTextAt = (text: string, insert: string, start?: number, end?: number): TextInsertion => {
    const from = Math.max(0, Math.min(start ?? text.length, text.length))
    const to = Math.max(from, Math.min(end ?? from, text.length))
    return { text: text.slice(0, from) + insert + text.slice(to), cursor: from + insert.length }
}
