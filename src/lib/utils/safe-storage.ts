/**
 * @desc `localStorage` 的安全读写（**Worker 里也安全**）。
 *
 * 客户端构建里 `$app/environment` 的 `browser` 恒为 `true` —— 连 Worker 里也是（构建期按
 * 「客户端」注入字面量，不是 `typeof window`）。但 Worker 没有 `localStorage`，模块顶层直接
 * `browser ? localStorage.getItem(…) : …` 会在 Worker 里抛 `ReferenceError: localStorage is
 * not defined`，整个 Worker 加载即崩（实测：贡献分析 Worker 就是这条路径挂的）。
 *
 * 因此凡是在**模块顶层**读存储的地方统一走这里：经 `globalThis` 取用，没有存储环境时读到
 * `null`、写入静默忽略；隐私模式 / 配额满导致的抛错同样不扩散给调用方。
 */

/** @desc 读字符串；无存储环境或抛错时返回 `null` */
export const readStorage = (key: string): string | null => {
    try {
        return globalThis.localStorage?.getItem(key) ?? null
    } catch {
        return null
    }
}

/** @desc 写字符串；无存储环境或抛错时静默忽略（存储不是计算的前置条件） */
export const writeStorage = (key: string, value: string): void => {
    try {
        globalThis.localStorage?.setItem(key, value)
    } catch {
        /* 无存储环境 / 隐私模式 / 配额满：不影响内存态 */
    }
}
