// ── 让「带 runes 的 store」也能在 node:test 里直接跑 ──────────────────────────
// 背景：本环境禁止子进程，vitest/vite 起不来，测试统一走 node:test + preload.mjs。
// 但 project.svelte.ts / *.store.svelte.ts 里用了 $state / $derived，Node 解析时会报
// `$state is not defined`，于是「复制工程」这类落在 svelte 模块里的逻辑没法回归。
//
// 这里把两个 runes 降级成普通变量语义：
//   $state(v)   → v（测试是单线程同步场景，不需要响应式）
//   $derived(e) → e（读一次的值；仅用于模块顶层的派生缓存）
// 对被测逻辑（纯数据拷贝）没有语义影响，仅够加载模块。
//
// 用法：node --import ./test/preload-runes.mjs --import ./test/preload.mjs <test.ts>
// 必须排在 preload.mjs 之前，保证在任何模块解析前完成注入。

const g = globalThis

if (typeof g.$state === 'undefined') {
    g.$state = (initial) => initial
}
if (typeof g.$derived === 'undefined') {
    g.$derived = (value) => value
}
if (typeof g.$derivedBy === 'undefined') {
    g.$derivedBy = (fn) => fn()
}
if (typeof g.$effect === 'undefined') {
    // 模块加载期不应产生副作用；给出空实现，避免误用时报 ReferenceError
    g.$effect = () => {}
}
