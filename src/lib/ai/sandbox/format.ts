/**
 * @desc 沙箱的**纯逻辑**部分：可注入名判定、脚本包装、宿主能力遮蔽名单、可序列化转换、截断。
 *
 * 抽出来的理由：沙箱本身（Worker + postMessage）在 node 单测里跑不起来，
 * 而「哪些名字要遮、脚本怎么包、返回值怎么降级」这些恰恰是最容易写错、也最值得钉住的部分。
 * 本文件无副作用、不依赖 Worker / DOM。
 */

/**
 * @desc 沙箱自带的全局名：工具**不得**占用，否则会覆盖 `window` / `console` / `tools` 等设施。
 * 前六个是设施名，其余是宿主能力名（同时也会被当作形参遮蔽成 `undefined`，见 `SHADOWED_HOST_NAMES`）。
 */
export const RESERVED_SANDBOX_NAMES: readonly string[] = [
    'window',
    'globalThis',
    'self',
    'tools',
    'console',
    'arguments',
    'eval',
    'undefined',
    'NaN',
    'Infinity'
]

/**
 * @desc 会被**形参遮蔽成 `undefined`** 的宿主能力名。
 *
 * 为什么删了还要遮：`delete` 对某些属性无效（`navigator` / `location` 是 globalThis 上的只读 getter），
 * 形参遮蔽是第二道保险 —— 脚本里的裸引用 `fetch(...)` 即使删不掉也会解析成 `undefined`。
 */
export const SHADOWED_HOST_NAMES: readonly string[] = [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'importScripts',
    'indexedDB',
    'caches',
    'postMessage',
    'onmessage',
    'onmessageerror',
    'addEventListener',
    'removeEventListener',
    'close',
    'Worker',
    'SharedWorker',
    'BroadcastChannel',
    'MessageChannel',
    'navigator',
    'location'
]

/** @desc 合法标识符：工具名要当形参用，非法名只能走 `tools.xxx` */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** @desc 该工具名能否直接注入成沙箱全局（非法标识符或保留名则只能走 `tools` 命名空间） */
export const isInjectableToolName = (name: string): boolean =>
    IDENTIFIER.test(name) && !RESERVED_SANDBOX_NAMES.includes(name) && !SHADOWED_HOST_NAMES.includes(name)

/**
 * @desc 包装脚本正文（沙箱与真 window 两条路径共用）。
 *
 * - `"use strict"`：让 `(function(){ return this })()` 得到 `undefined` 而非真全局 ——
 *   顺手堵掉最省事的一条越权路径。真正的防线是「逃出去也没有能力」（见 `sandbox.worker.ts`）。
 * - 外层 async IIFE：脚本内可用**顶层 `await`** 调工具，`return` 也能把值交回来。
 */
export const buildScriptBody = (source: string): string => `"use strict";\nreturn (async () => {\n${source}\n})()`

/** @desc 截断长文本（返回值与日志共用） */
export const truncateText = (text: string, max: number): { text: string; truncated: boolean } =>
    text.length <= max
        ? { text, truncated: false }
        : { text: `${text.slice(0, max)}…[已截断 ${text.length - max} 字符]`, truncated: true }

/** @desc 单个容器最多转换多少项（防止巨大数组/对象把结果撑爆） */
const MAX_ITEMS = 200

/** @desc 递归深度上限 */
const MAX_DEPTH = 6

/**
 * @desc 把脚本返回值转成可跨进程 / 可 JSON 化的形式。
 * 有界深度 + 环检测 + 函数/符号/BigInt 降级为可读占位，**任何输入都不抛错**。
 */
export const toSerializable = (value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown => {
    if (value === null || value === undefined) return null
    if (typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
    if (typeof value === 'bigint') return `${value}n`
    if (typeof value === 'symbol') return String(value)
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
    if (typeof value !== 'object') return String(value)
    if (seen.has(value)) return '[循环引用]'
    if (depth >= MAX_DEPTH) return '[嵌套过深]'
    if (value instanceof Error) return { name: value.name, message: value.message }
    seen.add(value)
    if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => toSerializable(item, depth + 1, seen))
    if (value instanceof Map) {
        return {
            '[Map]': [...value.entries()]
                .slice(0, MAX_ITEMS)
                .map(([k, v]) => [toSerializable(k, depth + 1, seen), toSerializable(v, depth + 1, seen)])
        }
    }
    if (value instanceof Set) {
        return { '[Set]': [...value].slice(0, MAX_ITEMS).map((item) => toSerializable(item, depth + 1, seen)) }
    }
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS)) {
        out[key] = toSerializable(item, depth + 1, seen)
    }
    return out
}

/** @desc `JSON.stringify` 的兜底版（BigInt / 循环引用不抛错） */
export const safeStringify = (value: unknown): string => {
    try {
        const json = JSON.stringify(value)
        return json === undefined ? String(value) : json
    } catch {
        return String(value)
    }
}

/** @desc 一条 console 日志行（非字符串先 JSON 化，单行上限 500 字符） */
export const formatLogLine = (value: unknown): string =>
    truncateText(typeof value === 'string' ? value : safeStringify(value), 500).text
