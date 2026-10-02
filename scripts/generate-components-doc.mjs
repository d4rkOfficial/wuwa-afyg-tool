// 生成组件目录文档（.tmp/components.md）。
// 用法：node scripts/generate-components-doc.mjs [--dry | --check]
//
// 与 generate-tools-doc.mjs 同样是「按源码静态生成」：本脚本不 import 任何组件，
// 只做文本解析，因此不受 Svelte/Runes 运行时影响。
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const DRY = process.argv.includes('--dry')
const UI_DIR = 'src/lib/components/ui'

/** @desc 从 openIdx 处的 `{` / `[` 起做括号配对，返回内部文本 */
const matchBalanced = (src, openIdx) => {
    const OPEN = { '{': '}', '[': ']', '(': ')' }
    const stack = []
    let quote = null
    for (let i = openIdx; i < src.length; i++) {
        const ch = src[i]
        if (quote) {
            if (ch === '\\') i++
            else if (ch === quote) quote = null
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch
            continue
        }
        if (OPEN[ch]) stack.push(OPEN[ch])
        else if (ch === '}' || ch === ']' || ch === ')') {
            if (stack[stack.length - 1] !== ch) continue
            stack.pop()
            if (stack.length === 0) return src.slice(openIdx + 1, i)
        }
    }
    return ''
}

/** @desc 解析 interface Props 的成员（含前置块注释），支持多行类型 */
const parseMembers = (body) => {
    const out = []
    const lines = body.split('\n')
    let doc = null
    let pending = ''
    for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        if (line.startsWith('/**') || line.startsWith('*') || line.startsWith('*/')) {
            const t = line
                .replace(/^\/\*\*|^\*\/?|\*\/$/g, '')
                .replace(/@desc\s*/, '')
                .trim()
            if (t) doc = doc ? `${doc} ${t}` : t
            continue
        }
        pending += (pending ? ' ' : '') + line
        // 成员结束：类型在行尾收口（不是续行）
        const m = /^(\w+)(\?)?:\s*([\s\S]+)$/.exec(pending)
        if (m && (/[;,]$/.test(pending) || !/[,|&<{([]\s*$/.test(pending))) {
            out.push({ name: m[1], optional: !!m[2], type: m[3].replace(/[,;]$/, '').trim(), doc })
            doc = null
            pending = ''
        }
    }
    return out
}

const files = readdirSync(UI_DIR)
    .filter((f) => f.endsWith('.svelte'))
    .sort()

const comps = []
for (const f of files) {
    const path = join(UI_DIR, f)
    const src = readFileSync(path, 'utf8')
    const lines = src.split('\n').length

    // interface Props ...
    const im = /interface\s+Props\b([^{]*)\{/.exec(src)
    const extendsCP = im ? /extends\s+ComponentsProps/.test(im[1]) : false
    const body = im ? matchBalanced(src, src.indexOf('{', im.index)) : ''
    const members = body ? parseMembers(body) : []

    // 导出的类型 / 常量
    const exports = [...src.matchAll(/export\s+(?:interface|type|const)\s+(\w+)/g)].map((m) => m[1])

    // 是否用了共享 helper
    const helpers = ['mergeComponentsStyle', 'joinStyle', 'mergeClass'].filter((h) =>
        new RegExp(`\\b${h}\\(`).test(src)
    )
    // 是否走区域质感
    const surfaces = [...new Set([...src.matchAll(/data-sf="([a-z-]+)"/g)].map((m) => m[1]))]

    const own = members.filter(
        (m) =>
            !['class', 'style', 'backgroundImage', 'textColor', 'backgroundImageFocused', 'textColorFocused'].includes(
                m.name
            )
    )
    comps.push({
        file: f,
        name: f.replace(/\.svelte$/, ''),
        path,
        lines,
        extendsCP,
        members: own,
        exports,
        helpers,
        surfaces
    })
}

// --check 只输出结论，避免污染 pnpm run check 的日志
const VERBOSE = !process.argv.includes('--check')
if (VERBOSE) {
    console.log(`扫描 ${UI_DIR}：${comps.length} 个元件`)
    for (const c of comps) {
        console.log(
            `  ${c.name.padEnd(22)} ${String(c.lines).padStart(4)} 行  自身 props ${String(c.members.length).padStart(2)}  ComponentsProps=${c.extendsCP ? 'Y' : 'n'}  区域=${c.surfaces.join(',') || '-'}  helper=${c.helpers.join(',') || '-'}`
        )
    }
}
if (DRY) process.exit(0)

const md = []
md.push('# 组件目录（`src/lib/components/ui/`）')
md.push('')
md.push('> **本文件由 `scripts/generate-components-doc.mjs` 自动生成，请勿手改。**')
md.push('> 改动 `ui/` 组件后运行 `pnpm run generate-components-doc`（或 `node scripts/generate-components-doc.mjs`）。')
md.push('')
md.push('## 约定（所有 `ui/` 元件必须满足）')
md.push('')
md.push('| 约定 | 说明 | 守卫 |')
md.push('| --- | --- | --- |')
md.push('| `interface Props extends ComponentsProps` | `class` / `style` 定制入口 | `check-components` ① |')
md.push('| 解构并应用 `class` | 外部可定制；用 `mergeClass([…])` 合并 | `check-components` ② |')
md.push('| 配色走 `--theme-*`，不直接 import theme store | 见 AGENTS §3 | `check-surfaces` |')
md.push('| 类名/样式合并用共享 helper | `$lib/utils/component-style.ts` | AGENTS §3 |')
md.push('')
md.push('> 反例：不要写 `bg-[var(--theme-x-bg)]`（应用 Tailwind v4 简写 `bg-(--theme-x-bg)`）；')
md.push('> 不要在组件里手写弹窗 backdrop（一律用 `layout/modal.svelte`）；不要写裸 `z-\\d+`（用 `--z-*` token）。')
md.push('')

md.push('## 元件一览')
md.push('')
md.push('| 元件 | 行数 | 自身 props | extends `ComponentsProps` | 区域质感 | 文件 |')
md.push('| --- | --: | --: | :--: | --- | --- |')
for (const c of comps) {
    md.push(
        `| [\`${c.name}\`](#${c.name}) | ${c.lines} | ${c.members.length} | ${c.extendsCP ? '✅' : '—'} | ${c.surfaces.map((s) => `\`${s}\``).join(' ') || '—'} | \`ui/${c.file}\` |`
    )
}
md.push('')
md.push(
    `> 另有 2 个共享 helper：\`$lib/utils/component-style.ts\`（\`mergeComponentsStyle\` / \`joinStyle\` / \`mergeClass\`）、\`$lib/utils/picker-card-class.ts\`（\`pickerCardClass\`）。`
)
md.push('')

for (const c of comps) {
    md.push(`## ${c.name}`)
    md.push('')
    md.push(`\`ui/${c.file}\` · ${c.lines} 行`)
    md.push('')
    if (c.exports.length) {
        md.push(`导出类型/常量：${c.exports.map((e) => `\`${e}\``).join('、')}`)
        md.push('')
    }
    if (c.surfaces.length) {
        md.push(`区域质感：${c.surfaces.map((s) => `\`data-sf="${s}"\``).join('、')}`)
        md.push('')
    }
    if (!c.members.length) {
        md.push('_除 `ComponentsProps` 的 `class` / `style` 外无自定义 props。_')
        md.push('')
        continue
    }
    md.push('| prop | 必填 | 类型 | 说明 |')
    md.push('| --- | :--: | --- | --- |')
    for (const m of c.members) {
        const type = m.type.replace(/\|/g, '\\|').replace(/\n/g, ' ')
        md.push(`| \`${m.name}\` | ${m.optional ? '否' : '**是**'} | \`${type}\` | ${m.doc ?? ''} |`)
    }
    md.push('')
}

const outPath = join('.tmp', 'components.md')
const content = md.join('\n')

// --check：比对而不写入，供 pnpm run check 守卫「文档未随源码重生成」
//
// 比对前做「空白 + 表格分隔行归一」：prettier 会把 Markdown 表格的列填充到等宽，
// 并把分隔行 `| --- |` 拉长成 `| -------- |`，而生成器输出不做这两件事，
// 故两者逐字不等但内容相同。归一后仍能抓到真正的内容漂移（元件增删、props 变化）。
const normalize = (s) =>
    s
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').replace(/-{2,}/g, '---').trim())
        .join('\n')
        .trim()

if (process.argv.includes('--check')) {
    if (!existsSync(outPath)) {
        console.error(`[check-components-doc] ✗ 缺少 ${outPath}，请运行 pnpm run generate-components-doc`)
        process.exit(1)
    }
    const current = readFileSync(outPath, 'utf8')
    if (normalize(current) !== normalize(content)) {
        console.error(
            `[check-components-doc] ✗ ${outPath} 与 ui/ 不同步（${comps.length} 个元件），请运行 pnpm run generate-components-doc`
        )
        // 指出第一处差异，便于定位（归一后逐行比对）
        const a = normalize(current).split('\n')
        const b = normalize(content).split('\n')
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            if (a[i] !== b[i]) {
                console.error(`   首个差异在第 ${i + 1} 行：`)
                console.error(`     文件: ${JSON.stringify((a[i] ?? '(缺行)').slice(0, 100))}`)
                console.error(`     生成: ${JSON.stringify((b[i] ?? '(缺行)').slice(0, 100))}`)
                break
            }
        }
        process.exit(1)
    }
    console.log(`[check-components-doc] OK：${comps.length} 个元件与文档一致`)
    process.exit(0)
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, content)
console.log(`\n已生成 ${outPath}（${comps.length} 个元件，${md.length} 行）`)
