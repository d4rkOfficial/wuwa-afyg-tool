// 动效一致性检查：把 Phase 8.1 的动效不变量变成可机检的闸门（AGENTS.md §5.1）。
//
// 用法：node scripts/check-motion.mjs
//
// 设计（报告风格对齐 scripts/check-components.mjs）：
//   - ① / ② 是**硬断言**：任何一处违规立即失败（exit 1），并逐条给出文件:行。
//   - ③ 是**棘轮**：基线为实测站点（已清零到 0 处，数量只许下降）；新增即失败，减少则提示下调基线。
//   - 永远豁免放在 EXEMPT，逐条注明理由，不静默忽略。
//
// 为什么 ① 必须由机器保证：Svelte 的 `transition:` 只吃 JS 数字，读不到 CSS 变量，
// 于是 `--motion-*`（CSS）与 `MOTION_MS`（TS）是同一份时长的两份手抄本——只有脚本能防它们漂移。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const norm = (p) => p.replace(/\\/g, '/')

/** @desc 递归收集文件（本检查器只读，不改任何源文件） */
const walk = (dir, filter) => {
    const out = []
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) out.push(...walk(p, filter))
        else if (filter(name)) out.push(norm(p))
    }
    return out
}

const files = walk('src', (n) => extname(n) === '.svelte').sort()

// ────────────────────────────── 模板标签解析 ──────────────────────────────

/** @desc 从 `src[i]`（引号）跳到字符串结束后的下标 */
const skipString = (src, i) => {
    const quote = src[i]
    i++
    while (i < src.length) {
        const ch = src[i]
        if (ch === '\\') i += 2
        else if (ch === quote) return i + 1
        else i++
    }
    return i
}

/** @desc 从 `src[i]`（`{`）跳到配对 `}` 之后；跳过字符串字面量里的花括号 */
const skipBraces = (src, i) => {
    let depth = 0
    while (i < src.length) {
        const ch = src[i]
        if (ch === "'" || ch === '"' || ch === '`') {
            i = skipString(src, i)
            continue
        }
        if (ch === '{') depth++
        else if (ch === '}') {
            depth--
            if (depth === 0) return i + 1
        }
        i++
    }
    return i
}

/**
 * @desc 解析 `src[start] === '<'` 处的起始标签 → `{ name, attrs, selfClosing, end }`。
 *
 * 手写逐字符解析（而非正则）是为了**知道每条指令挂在哪个标签上**：属性位置上的 `{…}`
 * 整体按花括号配对跳过（内部的 `>`、`:` 都不算属性语法），`>` 只有出现在属性之外才结束标签，
 * 因此多行标签、表达式内的 `>`、自闭合 `/>` 都能正确收尾。
 *
 * 属性名位置出现 `<` 或 `}` 时判定「这不是标签」并返回 null：源码里的比较运算
 * （`{#if a<b}`）会伪造出 `<b`，若照单全收会把后续真标签整段吞掉，反而漏检。
 */
const parseTag = (src, start) => {
    const name = /^[^\s/>]+/.exec(src.slice(start + 1))?.[0]
    if (!name) return null
    let i = start + 1 + name.length
    const attrs = []
    let selfClosing = false
    let closed = false
    while (i < src.length) {
        const ch = src[i]
        if (/\s/.test(ch)) {
            i++
            continue
        }
        if (ch === '>') {
            i++
            closed = true
            break
        }
        if (ch === '/' && src[i + 1] === '>') {
            i += 2
            closed = true
            selfClosing = true
            break
        }
        if (ch === '{') {
            i = skipBraces(src, i)
            continue
        }
        if (ch === '"' || ch === "'") {
            i = skipString(src, i)
            continue
        }
        const attrName = /^[^\s=/>]+/.exec(src.slice(i))?.[0]
        if (!attrName || /[<}]/.test(attrName)) return null
        const attrStart = i
        i += attrName.length
        let j = i
        while (j < src.length && /\s/.test(src[j])) j++
        let value = null
        if (src[j] === '=') {
            j++
            while (j < src.length && /\s/.test(src[j])) j++
            if (src[j] === '"' || src[j] === "'") {
                const end = skipString(src, j)
                value = src.slice(j + 1, end - 1)
                j = end
            } else if (src[j] === '{') {
                const end = skipBraces(src, j)
                value = src.slice(j, end)
                j = end
            } else {
                const raw = /^[^\s>{}<]+/.exec(src.slice(j))?.[0] ?? ''
                value = raw
                j += raw.length
            }
        }
        attrs.push({ name: attrName, value, index: attrStart })
        i = j
    }
    return closed ? { name, attrs, selfClosing, end: i } : null
}

const MOTION_DIRECTIVE = /^(transition|in|out|animate):/

/**
 * @desc 收集文件里所有动效指令，**并记录它实际挂在哪个标签上**。
 *
 * 为什么不能对整行做 `<[A-Z]` 之类的文本匹配：那样对「指令属于哪个标签」毫无判断力——
 * 实测会把 `<div transition:slide …>` 与同一行后面的 `<Icon …>` 算成同一条命中，
 * 于是所有「元素挂指令 + 同行还有组件」的合法写法全部误报。这里改为：
 * 扫描模板 → 逐个解析起始标签 → 只在**属性位置**识别指令 → 组件判定只看该标签自己的 name。
 */
const collectDirectives = (src) => {
    const out = []
    let i = 0
    while (i < src.length) {
        const lt = src.indexOf('<', i)
        const brace = src.indexOf('{', i)
        // 先到来的 `{…}` 是标签外的 mustache / 块标签（`{#if}`、`{:else}`、`{@html}`…），成对跳过
        if (brace >= 0 && (lt < 0 || brace < lt)) {
            i = skipBraces(src, brace)
            continue
        }
        if (lt < 0) break
        if (src.startsWith('<!--', lt)) {
            const end = src.indexOf('-->', lt + 4)
            i = end < 0 ? src.length : end + 3
            continue
        }
        // `<script>` / `<style>` 是原样文本，里面的 `transition:width …`、`'<div>'` 都不是模板语法
        const raw = /^<(script|style)\b/.exec(src.slice(lt))
        if (raw) {
            const close = src.indexOf(`</${raw[1]}`, lt)
            const gt = close < 0 ? -1 : src.indexOf('>', close)
            i = gt < 0 ? src.length : gt + 1
            continue
        }
        // 闭合标签（`</div>`）、`<!doctype>`、`<=` 之类：无属性可言，直接跳过这个 `<`
        if (src[lt + 1] === '/' || !/[a-zA-Z]/.test(src[lt + 1] ?? '')) {
            i = lt + 1
            continue
        }
        const tag = parseTag(src, lt)
        if (!tag) {
            i = lt + 1
            continue
        }
        for (const attr of tag.attrs) {
            if (MOTION_DIRECTIVE.test(attr.name)) {
                out.push({ tag: tag.name, directive: attr.name, value: attr.value, index: attr.index })
            }
        }
        i = tag.end
    }
    return out
}

/**
 * @desc 「组件」判定 —— 严格对齐 Svelte 编译器口径（2-analyze/visitors/shared/component.js:72
 * 只放行 Attribute / SpreadAttribute / LetDirective / OnDirective / BindDirective / AttachTag，
 * 其余指令一律 `component_invalid_directive`；SvelteSelf.js:35 与 SvelteComponent.js:17 走同一 visitor）：
 *   - 首字母大写（`<Foo>`）
 *   - 含 `.` 的命名空间写法（`<Foo.Bar>`）
 *   - `svelte:self` / `svelte:component`
 * 已用 svelte/compiler 实测**不属于**该错误、故刻意不列入者：`<div>`、`<svelte:element>`
 * （真元素，合法）；`<svelte:window|body|document>` 挂指令虽无意义但报的是 `illegal_element_attribute`，
 * `<svelte:head>` / `<svelte:boundary>` 各有专属错误码——本检查项只硬断言「组件」这一条。
 */
const isComponentTag = (name) =>
    /^[A-Z]/.test(name) || name.includes('.') || name === 'svelte:self' || name === 'svelte:component'

/**
 * @desc ③ 判定「裸字面量时长」：指令实参里出现 `duration: <数字字面量>`（如 `{{ duration: 200 }}`）。
 * 走 token / 工具函数的写法（`slideParams(MOTION_MS.base)`、`motionDuration(...)`）与
 * 脚本里的 `$derived` 参数（`{SLIDE_PARAMS}`、`{outParams}`）都不算裸字面量。
 */
const literalDurationMs = (value) => {
    if (!value) return null
    const m = /\bduration\s*:\s*(\d+(?:\.\d+)?)/.exec(value)
    return m ? Number(m[1]) : null
}

// ────────────────────────────── 采集 ──────────────────────────────

const facts = new Map()
for (const f of files) {
    const src = readFileSync(f, 'utf8')
    facts.set(f, { src, directives: collectDirectives(src) })
}

/** @desc 1-based 行号（只在打印违规/清单时调用，不在热路径上） */
const lineAt = (src, index) => src.slice(0, index).split('\n').length

let failed = 0
const sections = []

// ─────────────────── ① CSS ↔ JS 时长同步（硬断言） ───────────────────

const CSS_FILE = 'src/routes/layout.css'
const JS_FILE = 'src/lib/utils/motion.ts'

/** @desc 读 layout.css 的 `--motion-<key>: <n>ms`（只认冒号后带 ms 单位、带数字的声明，引用处 `var(--motion-*)` 不匹配） */
const readCssMotion = (src) =>
    new Map([...src.matchAll(/--motion-([\w-]+)\s*:\s*(\d+(?:\.\d+)?)ms\b/g)].map((m) => [m[1], Number(m[2])]))

/** @desc 读 motion.ts 的 `MOTION_MS = { fast: 120, base: 180, slow: 260 }` */
const readJsMotion = (src) => {
    const body = /MOTION_MS\s*=\s*\{([^}]*)\}/.exec(src)?.[1]
    return new Map([...(body ?? '').matchAll(/(\w+)\s*:\s*(\d+(?:\.\d+)?)/g)].map((m) => [m[1], Number(m[2])]))
}

const cssMs = readCssMotion(readFileSync(CSS_FILE, 'utf8'))
const jsMs = readJsMotion(readFileSync(JS_FILE, 'utf8'))
const motionKeys = [...new Set([...cssMs.keys(), ...jsMs.keys()])].sort()

{
    console.log('\n── ① CSS(--motion-*) ↔ JS(MOTION_MS) 时长同步（Svelte 过渡只吃 JS 数字，必须机器对齐）')
    console.log(`   ${CSS_FILE}: ${motionKeys.map((k) => `${k}=${cssMs.get(k) ?? '缺失'}`).join(' ')}`)
    console.log(`   ${JS_FILE}: ${motionKeys.map((k) => `${k}=${jsMs.get(k) ?? '缺失'}`).join(' ')}`)
    const bad = []
    for (const k of motionKeys) {
        const c = cssMs.get(k)
        const j = jsMs.get(k)
        if (c === undefined) bad.push(`${k} 只在 motion.ts 中声明（layout.css 缺少 --motion-${k}）`)
        else if (j === undefined) bad.push(`${k} 只在 layout.css 中声明（motion.ts 的 MOTION_MS 缺少 ${k}）`)
        else if (c !== j) bad.push(`${k} 不一致：layout.css = ${c}ms / motion.ts = ${j}`)
    }
    if (bad.length) {
        failed += bad.length
        for (const b of bad) console.log(`   ✗ ${b}`)
    } else {
        console.log(`   ✓ 无新增违规（${motionKeys.join(' / ')} 共 ${motionKeys.length} 项逐一相等）`)
    }
    sections.push(`① CSS↔JS 时长 ${motionKeys.length} 项，违规 ${bad.length}`)
}

// ─────────── ② 动效指令不得挂在组件上（硬断言，component_invalid_directive） ───────────

const allDirectives = [...facts].flatMap(([file, f]) => f.directives.map((d) => ({ file, ...d })))

{
    const hits = allDirectives.filter((d) => isComponentTag(d.tag))
    console.log('\n── ② transition:/in:/out:/animate: 不得挂在组件上（Svelte 编译期 component_invalid_directive）')
    console.log(
        `   扫描 ${files.length} 个 .svelte / 动效指令 ${allDirectives.length} 条（组件判定：首字母大写 / 含「.」的命名空间 / svelte:self|component）`
    )
    if (hits.length) {
        failed += hits.length
        for (const h of hits) {
            const { src } = facts.get(h.file)
            console.log(`   ✗ ${h.file}:${lineAt(src, h.index)}  <${h.tag}> 上的 ${h.directive}（指令只能挂元素）`)
        }
    } else {
        console.log('   ✓ 无新增违规（全部指令都挂在元素上）')
    }
    sections.push(`② 组件上的动效指令 ${hits.length} 条，违规 ${hits.length}`)
}

// ─────────── ③ 手写字面量时长棘轮（基线 + 单调递减） ───────────

/**
 * @desc ③ 基线：**已清零**（T17 把最后 14 处迁到 `slideParams(MOTION_MS.*)` 后实测 0 处）。
 * key = `<文件> :: <指令>=<实参>`，value = 该 key 的出现次数（同文件同型站点会合并计数）。
 * key 刻意不含行号与标签名：行号会随无关编辑漂移，按「文件 + 指令 + 实参」定位才稳定。
 * 还清债后请**同时**下调 LITERAL_DURATION_BASELINE 与对应条目（脚本会自检两者一致）。
 * 从今往后这里的任何新增都是**失败**（棘轮终点）——动效时长一律走
 * `$lib/utils/motion.ts` 的 `MOTION_MS` / `motionDuration` / `slideParams`。
 */
const LITERAL_DURATION_BASELINE = 0
const LITERAL_SITES = new Map([])

/**
 * @desc ③ 永久豁免：**当前为空**（T26 已清空最后一条）。
 *
 * 曾经的唯一一条是 `layout/modal.svelte` 的遮罩 `out:fade={{ duration: 130 }}`，
 * 理由是「刻意比 --motion-fast(120) 多 10ms，与面板 out:popOut 的默认 130ms 配对」。
 * T26 把它改成 `out:fade={{ duration: motionDuration(130) }}`：
 *   - 正常模式仍返回 130ms（`motionDuration` 只在 reduce 下压到 1ms）→ 配对观感**不变**；
 *   - reduce 下遮罩与面板（`out:popOut` 默认值已是 `motionDuration(130)`）一起归零，
 *     修掉 T18 留下的「面板瞬收、遮罩 130ms 才淡完」的不对称。
 * 于是它不再需要豁免：实参里没有字面量 `duration: <数字>`，③ 自然不命中。
 *
 * 这里保留空 Map 而不是删掉整个机制：下一个「确实只能用字面量」的站点仍应有登记处，
 * 脚本也照旧无条件打印本清单（空 = 无豁免，不留误导）。
 */
const EXEMPT = new Map([])

{
    const siteKey = (d) => `${d.file} :: ${d.directive}=${(d.value ?? '').replace(/\s+/g, ' ').trim()}`
    const literal = allDirectives
        .filter((d) => literalDurationMs(d.value) !== null)
        .map((d) => ({ ...d, key: siteKey(d), ms: literalDurationMs(d.value) }))
    const exemptHits = literal.filter((d) => EXEMPT.has(d.key))
    const counted = literal
        .filter((d) => !EXEMPT.has(d.key))
        .sort((a, b) => (a.file === b.file ? a.index - b.index : a.file < b.file ? -1 : 1))
    const seen = new Map()
    for (const d of counted) seen.set(d.key, (seen.get(d.key) ?? 0) + 1)

    const measured = counted.length
    const baselineTotal = [...LITERAL_SITES.values()].reduce((a, b) => a + b, 0)
    const fresh = []
    for (const [key, n] of seen) {
        const base = LITERAL_SITES.get(key) ?? 0
        if (n > base) fresh.push(`${key}  ×${n - base}`)
    }
    const reclaimed = []
    for (const [key, base] of LITERAL_SITES) {
        const n = seen.get(key) ?? 0
        if (n < base) reclaimed.push(`${key}  ×${base - n}`)
    }

    console.log('\n── ③ 动效指令内联手写字面量时长（棘轮：只许下降，应改走 MOTION_MS / motionDuration / slideParams）')
    console.log(`   基线 ${LITERAL_DURATION_BASELINE} 处 / 实测 ${measured} 处 / 永久豁免 ${exemptHits.length} 处`)
    console.log(`   ── 实测站点清单（${measured} 处，可直接照此下调基线）`)
    for (const d of counted) {
        const { src } = facts.get(d.file)
        console.log(`   · ${d.file}:${lineAt(src, d.index)}  <${d.tag}>  ${d.directive}=${d.value}  (${d.ms}ms)`)
    }

    if (baselineTotal !== LITERAL_DURATION_BASELINE) {
        failed += 1
        console.log(
            `   ✗ 基线自检失败：LITERAL_DURATION_BASELINE=${LITERAL_DURATION_BASELINE} 与 LITERAL_SITES 合计 ${baselineTotal} 不一致（两者必须同步修改）`
        )
    }
    if (fresh.length) {
        failed += fresh.length
        for (const x of fresh) console.log(`   ✗ 新增违规 ${x}（基线 ${LITERAL_DURATION_BASELINE} → 实测 ${measured}）`)
    }
    if (reclaimed.length) {
        for (const x of reclaimed)
            console.log(`   ↺ 可下调基线（已不再手写）: ${x} → 现为 ${LITERAL_DURATION_BASELINE}`)
    }
    if (!fresh.length && !reclaimed.length) console.log('   ✓ 无新增违规，基线无冗余')
    for (const [key, reason] of EXEMPT) {
        const hit = exemptHits.some((d) => d.key === key)
        console.log(`   ⊘ 永久豁免${hit ? '' : '（已失效，可删除）'}: ${key}`)
        console.log(`     理由：${reason}`)
    }
    sections.push(`③ 手写字面量时长 ${measured} 处（基线 ${LITERAL_DURATION_BASELINE}），新增 ${fresh.length}`)
}

// ────────────────────────────── 汇总 ──────────────────────────────

console.log('\n══════════════════════════════════════')
for (const s of sections) console.log(s)
console.log(failed === 0 ? '[check-motion] OK' : `[check-motion] ${failed} 处新增违规`)
process.exit(failed === 0 ? 0 : 1)
