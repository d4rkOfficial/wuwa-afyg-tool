/**
 * @desc Buff 全名工具（两仓库口径一致）：
 * 全名用反斜杠分隔层级：`文件夹A\文件夹B\buff短名`。
 * - 短名 / 文件夹名允许正斜杠，禁止反斜杠；
 * - 展示层默认只显示最后一段短名；溯源使用全名；
 * - 根目录 Buff 没有分隔符。
 */

export const BUFF_PATH_SEP = '\\'

/** @desc 按反斜杠拆段，过滤空段（兼容误输入的前后/连续分隔符） */
export const splitBuffPath = (name: string): string[] =>
    String(name ?? '')
        .split(BUFF_PATH_SEP)
        .map((part) => part.trim())
        .filter(Boolean)

/** @desc 最后一段短名；根 Buff 即全名 */
export const buffLeafName = (name: string): string => {
    const parts = splitBuffPath(name)
    return parts[parts.length - 1] ?? ''
}

/** @desc 文件夹路径（去掉最后一段短名） */
export const buffFolderPath = (name: string): string[] => splitBuffPath(name).slice(0, -1)

/** @desc 拼接全名；空段自动忽略 */
export const joinBuffPath = (...parts: readonly (string | null | undefined)[]): string =>
    parts
        .flatMap((part) => (part == null ? [] : splitBuffPath(String(part))))
        .filter(Boolean)
        .join(BUFF_PATH_SEP)

/** @desc 清洗叶子名：去首尾空白，把反斜杠替换为正斜杠（分隔符禁用） */
export const sanitizeLeafName = (name: string): string =>
    String(name ?? '')
        .trim()
        .replaceAll(BUFF_PATH_SEP, '/')

/** @desc 是否可作为叶子名（非空且不含反斜杠） */
export const isLeafNameValid = (name: string): boolean => {
    const trimmed = String(name ?? '').trim()
    return trimmed.length > 0 && !trimmed.includes(BUFF_PATH_SEP)
}

/** @desc 在已有名字集合上补 `#`，直到不冲突 */
export const uniqueLeafName = (desired: string, used: ReadonlySet<string>): string => {
    let name = desired
    while (used.has(name)) name += '#'
    return name
}

/** @desc 把全名限制在最大文件夹层数内（超出时把多余层级并入短名，用正斜杠保留信息） */
export const clampBuffPathName = (name: string, maxDepth: number): string => {
    const parts = splitBuffPath(name)
    const leaf = parts.pop() ?? ''
    const depth = Math.max(0, maxDepth)
    if (parts.length <= depth) return joinBuffPath(...parts, leaf)
    const kept = parts.slice(0, depth)
    const extra = parts.slice(depth)
    return joinBuffPath(...kept, [...extra, leaf].join('/'))
}
