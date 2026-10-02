// 组件一致性检查：把 AGENTS.md §3 的组件约束变成可机检的闸门。
//
// 用法：node scripts/check-components.mjs
//
// 设计：
//   - 每个检查项都带「基线白名单」= 整改开始时的既有债务（见 .tmp/component-consistency-plan.md）。
//   - 白名单外的**新**违规 → 失败（exit 1），防退化。
//   - 白名单内已不再违规的条目 → 提示「可回收」，不失败（推动债务单调下降）。
//   - 永远豁免项放在 EXEMPT，不计入债务。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const norm = (p) => p.replace(/\\/g, '/')

const walk = (dir) => {
    const out = []
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) out.push(...walk(p))
        else if (extname(p) === '.svelte') out.push(norm(p))
    }
    return out
}

const COMPONENT_DIR = 'src/lib/components'
const files = walk(COMPONENT_DIR).sort()

/** @desc ⑧ 用：`ui/` 元件目录（其中的元件必须被 `src/**` 内至少一个消费方引用） */
const UI_DIR = 'src/lib/components/ui'

/** @desc 永远豁免：这些文件本身就是被豁免机制的定义者 */
const EXEMPT = {
    // 共享弹窗外壳：backdrop / Escape / z 层级的唯一合法实现处
    backdrop: new Set(['src/lib/components/layout/modal.svelte']),
    /**
     * ④ 豁免：**无法用 Tailwind 表达的 `<style>`**（AGENTS §3 只说「尽量」用 Tailwind）。
     * 逐个核对过，三者各有硬理由；其余 6 个文件已迁走（5 个进 layout.css、1 个转 Tailwind，
     * 其中 magnetic-pointer 的 @keyframes 与 --animate-* 于 T11 迁入 layout.css 的 @theme）。
     */
    style: new Set([
        // `{@html}` 注入的 Markdown 内容对 Svelte 作用域不可见，必须 :global 才能匹配（~30 条 .ai-md 规则）
        'src/lib/components/page/home/settings/ai-assistant.svelte',
        // 同上：`{@html}` 富文本类（.rich-*）+ `@supports (color: oklch(from …))` 渐进增强，Tailwind 无对应表达
        'src/lib/components/page/home/quick-lookup/quick-lookup-content.svelte',
        // 共享自定义属性 --spread-hl + inset box-shadow 叠加高亮：为不覆盖区域系统的 background-image 而刻意如此
        'src/lib/components/page/home/calculation/spread-table.svelte'
    ]),
    /**
     * ⑥ 豁免：**store 驱动的单例** —— 全局只实例化一次、可见性与位置全部来自 store、
     * 调用处一律无 props（已核查：`<MagneticPointer />`、`<EnemyPanel />`、`<SkillPicker />`、
     * `<NonDirectPicker />`、`<DamageList />`、`<ContextMenu />` 均无任何传参）。
     * 给它们加 `class`/`style` 只会造出**无人使用的死 API**，故按 AGENTS §3 的例外处理。
     * 判定标准：全项目实例化处均不传 props 且无合理定制点；新增豁免须在此注明理由。
     */
    noProps: new Set([
        'src/lib/components/layout/magnetic-pointer.svelte',
        'src/lib/components/page/home/config/enemy-panel.svelte',
        'src/lib/components/page/home/timeline/timeline-menus.svelte',
        'src/lib/components/page/home/timeline/damage-list.svelte',
        'src/lib/components/page/home/timeline/non-direct-picker.svelte',
        'src/lib/components/page/home/timeline/skill-picker.svelte'
    ])
}

/**
 * @desc 整改基线（Phase 0 采集）。清空某项即代表该债务已还清。
 * 来源：.tmp/component-consistency-plan.md 第一节调查结论。
 */
const BASELINE = {
    // ① 用 $props() 但未声明 interface Props extends ComponentsProps（Phase 0 采集时 0 违规）
    iface: new Set([]),
    // ② 用 $props() 但未解构 class（Phase 0 采集时 0 违规）
    classProp: new Set([]),
    // ③ 手搓弹窗 backdrop —— **已清零**：Phase 3.2 把 22 处 / 19 个文件全部迁到 layout/modal.svelte
    // （基线原为 18 个文件，但基线按文件计，`buff-modal` 实含 4 处、`settings-modal` /
    //  `comparison-modal` / `skill-picker` 各 2 处；另有一处 `ui/confirm-dialog.svelte` 因
    //  `class={…}` 写法被漏检而从未进基线）。故现为**硬闸门**：新增手搓 backdrop 立即失败。
    backdrop: new Set([]),
    // ④ 内联 <style> —— 9 个中 5 个已迁移（toast/welcome-screen 动画 → layout.css @theme；
    //    config/team-config 的 .hide-scrollbar → layout.css；toolbar → Tailwind arbitrary variant），
    //    余 4 个见 EXEMPT.style。基线归零。
    style: new Set([]),
    // ⑤ 禁止裸 z-40..z-100（弹窗层级一律走 layout.css 的 --z-* token）
    //    Phase 3.5 已完成：原 30 个文件的裸值全部迁移为 z-(--z-*)，基线归零。
    zIndex: new Set([]),
    // ⑥ 完全没有 $props() 的组件 —— 现存 6 个已判定为 store 驱动单例，移入 EXEMPT，基线归零
    noProps: new Set([]),
    /**
     * ⑧ `ui/` 元件零引用（防「假组件化」，见 .tmp/component-consistency-plan.md §9.3）。
     * 实测（T7 采集，对照 `.tmp/components.md` 的 18 个元件）：**4 个**写得完整却全项目无人引用 ——
     * `button` / `select` / `avatar` / `search-box`。这是设计系统债务：它同时掩盖「元件缺失」
     * 与「同一控件被重复手搓」两类问题（原生 `<button>` 415 处而 `<Button>` 0 处即其表现）。
     * **只减不增**：T5/T6 接线推进时逐个回收（回收后本检查会提示「可回收白名单」，不失败）；
     * 出现新的零引用元件 → 失败。
     * 注：计划 §9.3 原列 5 个（含 `tabs`），实测 `tabs` 已被 4 个文件 import + 5 处 `<Tabs>` 渲染，
     * 故不入基线；`button` 唯一一处「引用」是 `utils/button-surface.ts` 的**注释**提及，
     * `select` 的两处同理（`quick-lookup-content` / `timeline-menus` 的注释），均不算消费方。
     * 另：`switch` 为**预先登记**——T15 正把设置里全部 toggle 换成 `ui/tabs` 文字 tab，
     * 落地后 `switch.svelte` 会变成零引用；按项目管理约定「不删除零引用的 ui/ 元件」（保留为
     * 通用控件，AGENTS §3 要求优先复用 `ui/` 既有元件），故计入基线债务而非新增违规。
     * 登记期间若它仍有引用，本检查只会提示「可回收」而不失败，不影响绿灯。
     *
     * ── 剩余 4 项的处置结论（T34 逐项实测后落定，**不要再把它们当「待接线」**）──
     * • `button`：✅ **已回收**（T5，原基线最大一笔债）。它**不是**「找不到接线点」，而是元件 API
     *   不足以承接现状 —— 已扩充合同（`children` / `type` / `$restProps` / `compact` / `bare`），
     *   并接线**弹窗 footer 族 10 处**（实测该族原本只有 `transition-colors hover:*`，
     *   `bare` 关掉元件自带的状态层后与原生按钮无可见差异）。剩余 371 处按目录分批推进。
     * • `avatar`：两个真实候选点都在 `team/pickers/character-picker.svelte`（`size-14` 圆形 +
     *   首字母兜底，2 处逐字相同）。**未接线**的原因：该处圆形容器带
     *   `bg-(--theme-modal-text)/10` 占位底，而 `avatar` 自带 `theme-glass-surface` +
     *   `bg-(--theme-avatar-bg)` —— 换过去会改可外观，且组件没有 `size-14` 档。
     *   即同样属**待扩充**（需 `size` 档 + 可关掉自身表面），不是「没有场景」。
     * • `search-box`：三个 picker 的搜索框都在 `{#snippet title()}` 里，形态是
     *   「放大镜 + 无边框透明 input + 清除钮」；`search-box` 是**有边框+底色**的独立输入控件，
     *   与本项目 title 行设计不同；且它 `value`/`oninput` 非 `$bindable`，换用要把
     *   `bind:value={query}` 改成 `value` + `oninput` 两处手写（3 个 picker × 2 = 6 处）。
     *   属**待扩充**（需无边框档 + `bindable`），不是「没有场景」。
     * • `select`：见 2.7 决策 —— 全项目手搓下拉（`layout/context-menu`、`timeline/context-menu`、
     *   `config.svelte` 主词条菜单）**语义是命令菜单/就地菜单**，与「取值选择器」不同，
     *   不应硬接。判定为「保留的通用控件」，故永久留在基线而非待办。
     * → 结论：`button` / `avatar` / `search-box` 三项是**元件扩充**任务（AGENTS §3「ui/ 缺失的
     *   元件应补在 ui/」），接线点已定位；`select` + `switch` 是**明确保留**的通用控件。
     */
    uiNoRef: new Set([
        'src/lib/components/ui/avatar.svelte',
        'src/lib/components/ui/search-box.svelte',
        'src/lib/components/ui/select.svelte',
        'src/lib/components/ui/switch.svelte'
    ])
}

/** @desc 判定「手搓 backdrop」：fixed inset-0 + 视觉遮罩特征（排除透明的 click-catcher） */
const isBackdrop = (cls) => /fixed inset-0/.test(cls) && /backdrop-blur|--theme-overlay-bg|bg-black\//.test(cls)

/**
 * @desc 抽出所有 class 属性值。**必须同时支持两种写法**：
 *   - `class="…"`（字面量）
 *   - `class={…}`（表达式，内部做花括号配对，跳过字符串字面量里的括号）
 * 早期版本只扫字面量，导致 `ui/confirm-dialog.svelte` 用
 * `class={mergeClass(['… fixed inset-0 … backdrop-blur-sm', className])}` 手搓的 backdrop
 * 完全逃过检查（实测漏检）。多行写法也靠花括号配对覆盖。
 */
const collectClassAttrs = (src) => {
    const out = []
    const re = /class=(?:"([^"]*)"|\{)/g
    let m
    while ((m = re.exec(src))) {
        if (m[1] !== undefined) {
            out.push(m[1])
            continue
        }
        let depth = 1
        let i = m.index + m[0].length
        const start = i
        let quote = null
        for (; i < src.length && depth > 0; i++) {
            const ch = src[i]
            if (quote) {
                if (ch === '\\') i++
                else if (ch === quote) quote = null
                continue
            }
            if (ch === "'" || ch === '"' || ch === '`') quote = ch
            else if (ch === '{') depth++
            else if (ch === '}') depth--
        }
        out.push(src.slice(start, i - 1))
        re.lastIndex = i
    }
    return out
}

/**
 * @desc ⑧ 用：抽出每个 `ui/` 元件在 `src/**` 内（**排除自身**）的引用。
 * 覆盖三类引用，与 AGENTS §3「优先复用 ui/ 既有元件」的接线事实对应：
 *   ① `import X from '$lib/components/ui/x.svelte'`（含相对路径 `../ui/x.svelte`）
 *   ② ① 绑定的本地名（含别名 / `{ default as X }`）在模板里的 `<X …>` 渲染
 *   ③ barrel re-export：`export { default as X } from '…/ui/x.svelte'`（当前仓库无 barrel，
 *      但判定必须覆盖：将来加了 barrel 不该把「已接线」误报成零引用）
 * **注释里的路径提及不算引用**（实测踩到）：`utils/button-surface.ts`、
 * `quick-lookup-content.svelte`、`timeline-menus.svelte` 各有一处纯注释提及
 * `ui/button.svelte` / `ui/select.svelte`，裸文本匹配会把这两个真·零引用元件误判为已接线。
 * 故要求 specifier 与 `import`/`export` 关键字同行，并跳过注释起始行；
 * 标签匹配用 `<X` 后须跟 `\s`/`/`/`>`（避免把 TS 泛型 `$derived.by<Chip[]>` 当标签）。
 */
const collectUiRefs = () => {
    const srcFiles = []
    const walkSrc = (dir) => {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name)
            if (statSync(p).isDirectory()) walkSrc(p)
            else if (/\.(svelte|ts|js)$/.test(name)) srcFiles.push(norm(p))
        }
    }
    walkSrc('src')

    const refs = new Map()
    for (const uiFile of files) {
        if (!uiFile.startsWith(`${UI_DIR}/`)) continue
        const stem = uiFile.slice(UI_DIR.length + 1, -'.svelte'.length)
        const specRe = new RegExp(`\\b(?:import|export)\\b[^\\n]*?['"\`][^'"\`]*ui/${stem}\\.svelte['"\`]`)
        const hits = []
        const tags = []
        for (const f of srcFiles) {
            if (f === uiFile) continue
            const src = readFileSync(f, 'utf8')
            const bindings = new Set()
            src.split('\n').forEach((line, i) => {
                if (!specRe.test(line) || /^\s*(\/\/|\/\*|\*|<!--)/.test(line)) return
                hits.push(`${f}:${i + 1}`)
                const bindRe = /\b(?:import|export)\s+([A-Za-z_$][\w$]*)|default\s+as\s+([A-Za-z_$][\w$]*)/g
                for (const m of line.matchAll(bindRe)) {
                    const name = m[1] ?? m[2]
                    if (name) bindings.add(name)
                }
            })
            for (const b of bindings) {
                for (const m of src.matchAll(new RegExp(`<\\s*${b}(?=[\\s/>])`, 'g'))) {
                    tags.push(`${f}:${src.slice(0, m.index).split('\n').length}`)
                }
            }
        }
        refs.set(uiFile, { hits, tags, total: new Set([...hits, ...tags]).size })
    }
    return refs
}

/** @desc ⑧ 引用事实表（key = `ui/` 元件文件，value 含 hits/tags/total） */
const uiRefs = collectUiRefs()

/** @desc 收集每个文件的违规事实，供各检查项复用（单次遍历） */
const facts = new Map()
for (const f of files) {
    const src = readFileSync(f, 'utf8')
    const hasProps = /\$props\(\)/.test(src)
    const backdrops = collectClassAttrs(src).filter(isBackdrop)
    const zHits = [...src.matchAll(/\bz-(\d{2,3})\b/g)].map((m) => m[1]).filter((n) => Number(n) >= 40)
    facts.set(f, {
        hasProps,
        // ① 用 $props() 但未声明 interface Props extends ComponentsProps
        badIface: hasProps && !/interface\s+Props\s+extends\s+ComponentsProps/.test(src),
        // ② 用 $props() 但未解构 class
        badClass: hasProps && !/class:\s*(className|class)\b/.test(src),
        backdrops,
        hasStyle: /(^|\n)\s*<style[\s>]/.test(src),
        zHits,
        // ⑧ 位于 ui/ 的元件零引用（非 ui 文件恒为 false）
        uiZeroRef: uiRefs.get(f)?.total === 0
    })
}

let failed = 0
const reclaimable = []

/**
 * @desc 执行一个「基线白名单」式检查：新违规失败，旧债务提示可回收
 * @param label 检查项名称
 * @param pick 从 facts 取出该文件的违规详情（返回空/假值表示合规）
 */
const check = (label, key, pick) => {
    const baseline = BASELINE[key]
    const exempt = EXEMPT[key] ?? new Set()
    const violating = []
    for (const [f, fact] of facts) {
        const detail = pick(fact)
        if (!detail) continue
        if (exempt.has(f)) continue
        violating.push({ file: f, detail })
    }

    const fresh = violating.filter((v) => !baseline.has(v.file))
    const stale = [...baseline].filter((b) => !violating.some((v) => v.file === b))

    console.log(`\n── ${label}`)
    console.log(
        `   基线债务 ${violating.length} 个文件 / 白名单 ${baseline.size} 条${exempt.size ? ` / 永久豁免 ${exempt.size}` : ''}`
    )

    if (fresh.length) {
        failed += fresh.length
        for (const v of fresh) console.log(`   ✗ 新增违规 ${v.file}\n       ${v.detail}`)
    }
    if (stale.length) {
        reclaimable.push({ key, files: stale })
        for (const s of stale) console.log(`   ↺ 可回收白名单（已合规）: ${s}`)
    }
    if (!fresh.length && !stale.length) console.log('   ✓ 无新增违规，白名单无冗余')
}

// ① / ②：AGENTS.md §3 的硬性 props 规范（Phase 0 采集时基线为 0，纯防退化闸门）
check('① $props() 必须声明 interface Props extends ComponentsProps', 'iface', (f) =>
    f.badIface ? '缺少 `interface Props extends ComponentsProps`' : ''
)
check('② $props() 必须解构 class 以支持外部定制', 'classProp', (f) =>
    f.badClass ? '未解构 class（无法外部定制）' : ''
)
check('③ 禁止手搓弹窗 backdrop（一律用 layout/modal.svelte）', 'backdrop', (f) =>
    f.backdrops.length ? `${f.backdrops.length} 处: ${f.backdrops[0].slice(0, 64)}` : ''
)
check('④ 禁止内联 <style>（优先 TailwindCSS）', 'style', (f) => (f.hasStyle ? '存在 <style> 块' : ''))
check('⑤ 禁止裸 z-40..z-100（弹窗层级用 --z-* token）', 'zIndex', (f) =>
    f.zHits.length ? `${f.zHits.length} 处: z-${[...new Set(f.zHits)].join(', z-')}` : ''
)
check('⑥ 独立组件应暴露 $props()（class/style 定制入口）', 'noProps', (f) => (f.hasProps ? '' : '无 $props()'))

// ⑦ 源文件编码：必须 UTF-8（无 BOM、无 NUL）。
// 动机：Windows 下用 PowerShell `>` 重定向写文件会产出 UTF-16LE，此时按 utf8 读取得到含 NUL 的乱码，
// 而 svelte-check 对这类文件报 0 errors（静默通过）—— 必须由本检查器兜住。
// 覆盖整个 src（不限组件），因为任何源文件都可能被这样写坏。
const encodingBad = []
const walkAll = (dir) => {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walkAll(p)
        else if (/\.(svelte|ts|js|css|json)$/.test(name)) {
            const buf = readFileSync(p)
            const isUtf16 =
                buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))
            const hasNul = buf.includes(0)
            if (isUtf16 || hasNul) encodingBad.push(`${norm(p)}  (${isUtf16 ? 'UTF-16 BOM' : '含 NUL 字节'})`)
        }
    }
}
walkAll('src')
{
    console.log('\n── ⑦ 源文件必须为 UTF-8（无 BOM/NUL）')
    if (encodingBad.length) {
        failed += encodingBad.length
        for (const b of encodingBad) console.log(`   ✗ ${b}`)
    } else {
        console.log('   ✓ 全部为 UTF-8')
    }
}

// ⑧ `ui/` 元件不得零引用：防「假组件化」——文件存在 ≠ 已组件化，必须看「谁引用它」
// （.tmp/component-consistency-plan.md §9.1 的教训；原生 button 415 处而 ui/button 0 引用即其表现）
check('⑧ ui/ 元件必须被至少一个消费方引用（防「假组件化」）', 'uiNoRef', (f) =>
    f.uiZeroRef ? '零引用（src/** 内无 import / `<X>` 渲染 / re-export）' : ''
)
// ⑧ 附：引用数一览（供 T5/T6 接线推进时观察债务下降；闸门本身只看「零引用」）
console.log(
    `   · 引用数：${files
        .filter((f) => f.startsWith(`${UI_DIR}/`))
        .map((f) => `${f.slice(UI_DIR.length + 1, -'.svelte'.length)}=${uiRefs.get(f).total}`)
        .join('  ')}`
)

console.log('\n══════════════════════════════════════')
console.log(`组件文件 ${files.length} 个`)
console.log(`backdrop 基线债务 ${BASELINE.backdrop.size} 文件（目标 0）`)
console.log(`<style> 基线债务 ${BASELINE.style.size} 文件（目标 ≤1）`)
console.log(`裸 z 基线债务 ${BASELINE.zIndex.size} 文件（目标 0）`)
console.log(`无 props 基线 ${BASELINE.noProps.size} 文件（目标 0）`)
console.log(`ui/ 零引用基线 ${BASELINE.uiNoRef.size} 元件（目标 0）`)
if (reclaimable.length) console.log(`可回收白名单条目：${reclaimable.reduce((a, r) => a + r.files.length, 0)} 条`)
console.log(failed === 0 ? '[check-components] OK' : `[check-components] ${failed} 处新增违规`)
process.exit(failed === 0 ? 0 : 1)
