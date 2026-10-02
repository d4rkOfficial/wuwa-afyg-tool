// 滚动条一致性检查（Phase 10.3）：滚动条样式只允许有一个家 —— src/routes/layout.css。
//
// 用法：node scripts/check-scrollbar.mjs
//
// 背景：Phase 10 之前，全局默认滚动条是硬编码灰、主题化靠给容器补 .theme-scrollbar，
// 于是 35 个文件里的滚动容器有 11 个漏了 class、一直渲染成硬编码灰；同时组件里还散落着
// 手写的 `[&::-webkit-scrollbar]:hidden` / `:global(.hide-scrollbar::-webkit-scrollbar)` 片段。
// 「统一」的唯一可持续做法是把样式收敛到一处：本脚本据此把关。
//
// 设计（报告风格对齐 scripts/check-motion.mjs / check-components.mjs）：
//   - ① 硬断言：layout.css 必须包含「默认主题化 + [data-scrolling]/:hover 显形」的骨架规则，
//     缺任何一条即失败（防止有人「清理」时把自动隐藏的关键规则删掉）。
//   - ② 棘轮：layout.css 之外的手写滚动条站点，基线为下方清单（数量只许下降）；
//     新增即失败，减少则提示下调基线。迁移完某处后请**同时**下调 BASELINE 与对应条目（脚本自检两者一致）。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

const CSS_FILE = 'src/routes/layout.css'
const norm = (p) => p.replace(/\\/g, '/')

/** @desc 递归收集 src 下的可读文本文件（本检查器只读，不改任何源文件） */
const walk = (dir) => {
    const out = []
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) out.push(...walk(p))
        else if (['.svelte', '.ts', '.js', '.css', '.mjs', '.html'].includes(extname(name))) out.push(norm(p))
    }
    return out
}

const files = walk('src')
    .filter((f) => f !== CSS_FILE)
    .sort()

// ──────────────── ① layout.css 骨架（硬断言） ────────────────

/**
 * @desc 滚动条样式的「唯一权威」必须体现的三件事：
 *   1) 默认拇指色引用昼夜主题变量 --theme-scrollbar-thumb（不再是硬编码灰）；
 *   2) 与「配色」主色 --theme-accent-bg 混色（用户明确要求滚动条跟随配色）；
 *   3) [data-scrolling] + :hover 两条显形路径（自动隐藏 + 鼠标可见性提示），
 *      且 webkit 与 Firefox(scrollbar-color) 两条渲染路径都覆盖。
 */
const REQUIRED = [
    ['昼夜主题变量 --theme-scrollbar-thumb', /var\(--theme-scrollbar-thumb/],
    ['配色主色 --theme-accent-bg 混色（color-mix）', /color-mix\([\s\S]*?var\(--theme-accent-bg/],
    ['滚动中显形 [data-scrolling]', /\*\[data-scrolling\]/],
    ['悬停显形 :hover', /\*:hover::-webkit-scrollbar-thumb/],
    ['Firefox 路径 scrollbar-color 显形', /\*\[data-scrolling\][\s\S]{0,80}scrollbar-color/],
    ['隐藏滚动条工具类 .hide-scrollbar 仍在', /\.hide-scrollbar\s*\{/]
]

// ──────────────── ② 手写滚动条站点棘轮 ────────────────

/**
 * @desc ② 基线：**今日实测 4 处**（Phase 10.3 采集，全部在 layout.css 之外）。
 * key = `<文件>::<该行 trim 后的原文>`，value = 出现次数。
 * key 刻意不含行号：行号会随无关编辑漂移，按「文件 + 该行内容」定位才稳定。
 * 这些都是组件里的**局部隐藏滚动条**（Tailwind 任意值 / :global 片段），属有意为之，
 * 本轮按 AGENTS.md 硬规则不动它们；但不得再新增，并鼓励后续统一改用 .hide-scrollbar。
 */
const BASELINE = 3
const SITES = new Map([
    [
        'src/lib/components/page/home/result/result.svelte::class="flex min-w-0 flex-1 flex-nowrap items-stretch gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"',
        1
    ],
    ['src/lib/components/page/home/quick-lookup/quick-lookup-content.svelte::scrollbar-width: none;', 1],
    [
        'src/lib/components/page/home/quick-lookup/quick-lookup-content.svelte:::global(.hide-scrollbar::-webkit-scrollbar) {',
        1
    ]
])

// ──────────────── 采集 ────────────────

const DECL_RE = /::-webkit-scrollbar|\bscrollbar-width\s*:|\bscrollbar-color\s*:|\bscrollbar-gutter\s*:/
const seen = new Map()
const hits = []
for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!DECL_RE.test(line)) continue
        const key = `${file}::${line.trim()}`
        seen.set(key, (seen.get(key) ?? 0) + 1)
        hits.push({ file, line: i + 1, text: line.trim(), key })
    }
}

const css = readFileSync(CSS_FILE, 'utf8')

let failed = 0
const sections = []

// ① 骨架
{
    console.log('\n── ① layout.css 滚动条骨架（样式唯一权威，硬断言）')
    const missing = REQUIRED.filter(([, re]) => !re.test(css))
    for (const [label] of REQUIRED) console.log(`   ${missing.some(([l]) => l === label) ? '✗' : '✓'} ${label}`)
    if (missing.length) {
        failed += missing.length
        console.log(`   ✗ 缺少 ${missing.length} 项：${missing.map(([l]) => l).join(' / ')}`)
    } else {
        console.log('   ✓ 骨架完整（默认主题化 + 配色混色 + [data-scrolling]/:hover 双路径显形）')
    }
    sections.push(`① layout.css 骨架 ${REQUIRED.length} 项，缺失 ${missing.length}`)
}

// ② 棘轮
{
    const measured = [...seen.values()].reduce((a, b) => a + b, 0)
    const baselineTotal = [...SITES.values()].reduce((a, b) => a + b, 0)
    const fresh = []
    for (const [key, n] of seen) {
        const base = SITES.get(key) ?? 0
        if (n > base) fresh.push(`${key}  ×${n - base}`)
    }
    const reclaimed = []
    for (const [key, base] of SITES) {
        const n = seen.get(key) ?? 0
        if (n < base) reclaimed.push(`${key}  ×${base - n}`)
    }

    console.log('\n── ② layout.css 之外的手写滚动条样式（棘轮：只许下降，样式应统一收敛到 layout.css）')
    console.log(`   基线 ${BASELINE} 处 / 实测 ${measured} 处`)
    for (const h of hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1)))
        console.log(`   · ${h.file}:${h.line}  ${h.text}`)

    if (baselineTotal !== BASELINE) {
        failed += 1
        console.log(`   ✗ 基线自检失败：BASELINE=${BASELINE} 与 SITES 合计 ${baselineTotal} 不一致（两者必须同步修改）`)
    }
    if (fresh.length) {
        failed += fresh.length
        for (const x of fresh) console.log(`   ✗ 新增违规 ${x}（基线 ${BASELINE} → 实测 ${measured}）`)
    }
    if (reclaimed.length) {
        for (const x of reclaimed) console.log(`   ↺ 可下调基线（已迁移/删除）: ${x} → 现为 ${BASELINE}`)
    }
    if (!fresh.length && !reclaimed.length) console.log('   ✓ 无新增违规，基线无冗余')
    sections.push(`② 手写滚动条站点 ${measured} 处（基线 ${BASELINE}），新增 ${fresh.length}`)
}

// ──────────────── 汇总 ────────────────

console.log('\n══════════════════════════════════════')
for (const s of sections) console.log(s)
console.log(failed === 0 ? '[check-scrollbar] OK' : `[check-scrollbar] ${failed} 处新增违规`)
if (files.length === 0) console.log(`   （提示：${relative(process.cwd(), 'src')} 下未扫描到文件）`)
process.exit(failed === 0 ? 0 : 1)
