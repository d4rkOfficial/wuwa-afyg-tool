// @desc 从工具源码提取 defineTool / GENERATE_TOOLS 定义，生成 docs/tools.md（AI 助手与 WS 共用注册表的完整文档）
// 用法：node scripts/generate-tools-doc.mjs [--out <path>] [--check]
//   · 不带参数：生成 docs/tools.md
//   · `--out <path>`：写到别处（只为「改前/改后 diff」留出口）
//   · `--check`：**只比对不写入**（默认比对 `--out` 指向的文件，即 docs/tools.md），
//     逐字节与磁盘文件比较，不同则 exit 1 并指出首个差异行号与该行内容（供 pnpm run check 守卫文档漂移）
// 纯正则 + 括号/字符串感知解析，不执行 TS（避免 $lib 别名与 Svelte store 依赖）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const TOOLS_DIR = path.join(ROOT, 'src/lib/ai/tools')
const GENERATE_FILE = path.join(ROOT, 'src/lib/ai/generate/tools.ts')
const OUT = path.join(ROOT, 'docs/tools.md')
/** @desc `--out <path>`：只为「改前/改后 diff」留出口；不带参数时行为与以前完全一致 */
const outArgIdx = process.argv.indexOf('--out')
const OUT_PATH = outArgIdx === -1 ? OUT : path.resolve(ROOT, process.argv[outArgIdx + 1])

const DOMAIN_LABELS = {
    'project.ts': '工程',
    'team.ts': '队伍',
    'timeline.ts': '排轴',
    'calculation.ts': '拉表',
    'config.ts': '配装',
    'result.ts': '结果',
    'buff-set.ts': 'Buff 集',
    'buff-generate.ts': 'Buff 生成',
    'panels.ts': '面板',
    'view.ts': '视图',
    'settings.ts': '设置',
    'ai-session.ts': 'AI 助手自身（上下文 / 用量 / 运行情况）',
    'ask-user.ts': 'AI 助手 · 交互',
    // 联网抓取（web_fetch）：同样声明 requires，只属于内置 AI 助手
    'web-fetch.ts': 'AI 助手 · 联网',
    'skills.ts': '技能卡',
    'kuro.ts': '库街区',
    'substat-library.ts': '词条集（方案）'
}

/** @desc 依次尝试 extractor，取第一个非空结果（用于「引用本地常量」的取值回退） */
function firstNonEmpty(...extractors) {
    for (const f of extractors) {
        const v = f()
        if (typeof v === 'string' && v !== '') return v
    }
    return ''
}

/**
 * @desc 把 JS 字符串字面量里的转义还原成真实字符（`\n` → 换行、`\'` → 单引号…）。
 *
 * 为什么必须还原：描述文案常写成 `'第一句\n' + '第二句'`，不还原的话文档里会出现字面的 `\n`。
 * 未知转义（`\u` / 十六进制等）原样保留 —— 宁可留着也**不能吃掉反斜杠**（否则 `\ud83d` 这种会变味）。
 */
function unescapeLiteral(s) {
    const MAP = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }
    return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, g1) =>
        g1.length === 1 ? (g1 in MAP ? MAP[g1] : g1) : m
    )
}

/**
 * @desc 从值的起点 `j` 取出**该值本身**的文本（复合值取整段，裸字面量只取到第一个分隔符）。
 *
 * 为什么不能「用下一个顶层键的 start 截取」：`topLevelEntries` 对裸字面量的 `end` 是「最后一个字符」，
 * 而下一个键的 `start` 与它之间还夹着分隔逗号、注释、缩进。用 `next.start` 截取会把注释与后续键一起带进来
 * （实测 ask_user 的 `description: DESCRIPTION,` 后面跟着一段注释与 `requires:`，
 * 于是「常量引用」的解析被这一堆尾巴搅坏）。这里改用**值本身的语法边界**：
 * 复合值走 skipBalanced，字符串/模板串走各自的 skipper，裸字面量只取到空白/逗号/收尾括号为止。
 */
function valueTextAt(text, j) {
    const ch = text[j]
    if (ch === '{' || ch === '[' || ch === '(') return text.slice(j, skipBalanced(text, j).end + 1)
    if (ch === "'" || ch === '"') return text.slice(j, skipStringLiteral(text, j))
    if (ch === '`') return text.slice(j, skipTemplate(text, j))
    let k = j
    while (k < text.length && !/[\s,;)\]}[]/.test(text[k])) k++
    return text.slice(j, k)
}

/**
 * @desc 把模板字符串里的 `${…}` 表达式折叠成 `…`，让文档里不出现原始 JS 插值。
 *
 * 场景：属性级描述常写成 `` `上下文分段 id（${SEGMENT_IDS.map((id) => `${id}（…）`).join(' / ')}）` ``。
 * 文档给模型读的是「说明」，塞一段 `${…}` 源码既占 token 又容易误读；折叠成 `上下文分段 id（…）` 保留语义。
 *
 * ⚠️ 不能用一个扁平正则（`/\$\{[^}]*\}/g`）：插值里常有嵌套的 `${…}` 与对象字面量，
 * 扁平正则会从**内层** `${` 一路吃到内层的第一个 `}`，把外壳的尾巴留在原地 —— 实测结果就是
 * `上下文分段 id（…（…）`).join(' / ')}）` 这种半截源码。这里用括号配对整段跳过。
 * 单引号/双引号字符串**不做**这个折叠（那里面的 `${…}` 是字面文本）。
 */
function unwrapTemplateLiteral(s) {
    let out = ''
    let i = 0
    while (i < s.length) {
        if (s[i] === '$' && s[i + 1] === '{') {
            const { end } = skipBalanced(s, i + 1)
            out += '…'
            i = end === -1 ? s.length : end + 1
            continue
        }
        out += s[i]
        i++
    }
    return out
}

/** @desc 取出「值从下标 j 开始」的字符串字面量内容（`'…'` / `"…"` / `` `…` ``）；不是字符串则返回 '' */
function stringValueAt(src, j) {
    const ch = src[j]
    if (ch === "'" || ch === '"') return unescapeLiteral(src.slice(j + 1, skipStringLiteral(src, j) - 1))
    if (ch === '`') return unescapeLiteral(unwrapTemplateLiteral(src.slice(j + 1, skipTemplate(src, j) - 1)))
    return ''
}

/**
 * @desc 拼接的多段字符串字面量（`'a' + 'b' + \`c\` + CONST`）逐段取值后连起来。
 *
 * ⚠️ 必须在 `+` **左侧**停下，不能「一路扫到源码末尾」（T28 踩过）：
 * 早先的循环把标识符也当可跳过字符（为了跳过 `+ CONST` 这类引用），于是 `'描述…'` 之后的
 * `;` / `)` / `,` / `}` 全部跳不过去才停——但如果整个 defineTool 块后面没有这些字符，
 * 扫描会越过值的边界，把后续源码里的字符串（连 `defineTool('ask_user'` 的名字）也拼进描述里。
 * 现在的规则：遇到 `+` 先**向前看**，只有「右操作数以引号/反引号开头」才继续拼；
 * 否则（标识符 / 标识符成员访问等运行时表达式）就地停下，已收集的字面量片段即为结果。
 */
function concatValueAt(src, j) {
    const parts = []
    let k = j
    const eatLiteral = () => {
        const ch = src[k]
        if (ch === "'" || ch === '"') {
            parts.push(unescapeLiteral(src.slice(k + 1, skipStringLiteral(src, k) - 1)))
            k = skipStringLiteral(src, k)
            return true
        }
        if (ch === '`') {
            parts.push(unescapeLiteral(unwrapTemplateLiteral(src.slice(k + 1, skipTemplate(src, k) - 1))))
            k = skipTemplate(src, k)
            return true
        }
        return false
    }
    if (!eatLiteral()) return ''
    while (k < src.length) {
        // 跳到下一个 `+`
        while (k < src.length && /\s/.test(src[k])) k++
        if (src[k] !== '+') break
        k++
        while (k < src.length && /\s/.test(src[k])) k++
        if (src[k] === "'" || src[k] === '"' || src[k] === '`') {
            if (!eatLiteral()) break
            continue
        }
        // `+ 标识符`：右侧是运行时表达式，跳过它但不把任何内容带进结果
        const idM = /^[A-Za-z_$][\w$]*/.exec(src.slice(k))
        if (!idM) break
        k += idM[0].length
        while (k < src.length && /[\w$.[\]()]/.test(src[k])) k++ // 成员访问 / 调用
    }
    return parts.join('')
}

/**
 * @desc 找「按顶层 key 取出某个字符串字段」的值；取值支持：字符串字面量、拼接字面量、**引用本文件里的常量**。
 *
 * 旧实现是 `objText.match(/key:\s*'…'/)` —— 取「块内第一个」该 key，与嵌套层级无关。于是：
 *   · `ask_user` / `web_fetch` 把 `parameters` 写在 `description` 之前时，拿到的是**第一个参数的 description**
 *     （实测 docs/tools.md 里 ask_user 的摘要是 title 那句、web_fetch 的是 url 那句）；
 *   · 顶层 `description: DESCRIPTION`（引用常量）时完全取不到。
 * 现在改成：① 只在**顶层**找 key（topLevelEntries 的括号栈）→ 找到后**只把该键的值文本**交给取值器
 *   （所以调用方不必关心自己传进来的文本是整文件、块还是切片，也不需要做下标偏移）；
 *   ② 值先试字面量，再试「本文件内同名常量的值」。
 *
 * @param {string} objText 对象文本（可以带或不带最外层花括号）
 * @param {string} key 字段名
 * @param {string} [src] 同文件的完整源码（用于解析常量引用；不传则不解析引用）
 */
function pickString(objText, key, src) {
    const entries = topLevelEntries(objText)
    const entry = entries.find((e) => e.key === key)
    if (!entry) return ''
    const value = valueTextAt(objText, entry.start)
    return firstNonEmpty(
        // ⚠️ 拼接取值必须排在单字面量**前面**：`'a' + 'b'` 用 stringValueAt 只会拿到 "a"（少掉其余半句）
        () => concatValueAt(value, 0),
        () => stringValueAt(value, 0),
        () => (src ? resolveLocalConstant(src, value) : '')
    )
}

/**
 * @desc 把「引用本文件常量」的取值形式解析成实际的字符串值（只支持**同文件、声明在顶层**的 const）。
 *
 * 为什么需要它：工具作者把长描述抽成 `const DESCRIPTION = '…' + '…'`（避免 defineTool 块被几百行文案撑爆）
 * 是合理写法，而本解析器不执行 TS。若不做这一步，`description: DESCRIPTION` 只能取到空串
 * → docs/tools.md 里该工具的描述整段消失（比抓错字段更糟）。所以按「名字唯一」在源码里找一次声明即可。
 * 解析失败（多份声明 / 不是字符串 / 找不到）时返回 ''，调用方维持「取不到就是空」的既有行为。
 */
function resolveLocalConstant(src, valueText) {
    // 值文本已由 valueTextAt 收窄成「值本身的语法边界」内的内容，这里只取开头的标识符。
    const nameM = /^\s*([A-Za-z_$][\w$]*)/.exec(valueText)
    if (!nameM) return ''
    const name = nameM[1]
    // ⚠️ 声明正则必须挂 `const`，不能出现「裸标识符也能命中」的形态：
    // 早先写成 `(?:^|\n)\s*(?:const\s+)?NAME\s*=`，于是拼接串里的 `+ NAME` 这个引用点也被当成一处声明
    // → hits.length=2 → 判定「同名多份声明」直接放弃 → 全项目长描述变空（踩过，务必保留 const 前缀）。
    const re = new RegExp(`(?:^|\\n)[ \\t]*(?:export\\s+)?const\\s+${name}\\s*(?::[^=\\n]+)?=\\s*`, 'g')
    const hits = []
    let m
    while ((m = re.exec(src))) hits.push(m.index + m[0].length)
    if (hits.length !== 1) return ''
    const j = hits[0]
    return firstNonEmpty(
        // 数组字面量常量（实测 `project.ts` 的 `phaseKeys: PhaseKey[] = ['team', …]`）。
        // 必须排在两个「字面量拼接」取值器**之前**：那两个只认引号开头的值，遇到 `[` 一律返回 ''，
        // 于是 `enum: phaseKeys` 的整份可选值会被丢掉（docs/tools.md 里 `phase` 只剩裸 `string`）。
        // 返回 Balanced 截出的数组文本，交给 `splitArrayItemsText` 拆项。
        () => (valueTextAt(src, j).startsWith('[') ? valueTextAt(src, j) : ''),
        // 同上：拼接必须在单字面量之前
        () => concatValueAt(src, j),
        () => stringValueAt(src, j),
        // 常量本身也可以引用另一个常量（再保险一层，只解析字符串 / 拼接 / 单层间接引用）
        () => resolveLocalConstant(src, valueTextAt(src, j))
    )
}

/**
 * @desc 从 `src[i]`（`/`）跳到注释结束之后；不是注释则返回 `i` 原样。
 *
 * 为什么必须跳过注释（T26）：这套解析器是「括号 + 三引号全局配对」的，
 * 而注释里的反引号 / 裸引号会把配对彻底打乱 —— 整块 `end=-1` → 参数表变空。
 * 实测踩过：`ai-session.ts` 的属性级模板字符串注释、`calculation.ts` 的同类注释。
 */
function skipComment(src, i) {
    if (src[i] !== '/' || src[i + 1] !== '/') {
        if (src[i] === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2)
            return end === -1 ? src.length : end + 2
        }
        return i
    }
    const nl = src.indexOf('\n', i)
    return nl === -1 ? src.length : nl
}

/**
 * @desc 从 `src[i]`（`` ` ``）跳到模板字符串结束之后，**并把 `${…}` 里的表达式整段跳过**。
 *
 * 为什么要把 `${…}` 排除（T26）：属性级模板字符串里常出现
 * `` `上下文分段 id（${SEGMENT_IDS.map((id) => `${id}（…）`).join(' / ')}）` `` 这种嵌套表达式，
 * 里面还有嵌套模板串。旧实现只跟踪「一个反引号到下一个反引号」，
 * 于是 `` ${id} `` 的 `` ` `` 被当成收尾 → 后面的属性被整段吞掉（实测 `ai-session.ts:83` 的
 * `segmentId` 在 docs/tools.md 里少了一行，`calculation.ts` 另有 2 处同类写法）。
 */
function skipTemplate(src, i) {
    i++ // 跳过开头的反引号
    while (i < src.length) {
        const ch = src[i]
        if (ch === '\\') {
            i += 2
            continue
        }
        if (ch === '`') return i + 1
        if (ch === '$' && src[i + 1] === '{') {
            i = skipBalanced(src, i + 1).end + 1
            continue
        }
        i++
    }
    return i
}

/**
 * @desc 通用「括号 + 字符串 + 注释感知」配对扫描：从 `src[openIdx]`（`{` / `[` / `(`）跳到配对结束。
 * @returns {{ end: number, bodyStart: number, bodyEnd: number, body: string }} `end = -1` 表示没配上。
 *
 * 同时跟踪 `{}` / `[]` / `()`：只跟踪 `{}` 时，对象内部的数组（`required: ['a']`、`enum: [...]`）
 * 会让配对数提前归零、解析被截断（历史上 Buff 生成辅助 15 个工具只抽出 1 个就是这个原因）。
 * 括号不匹配的杂散闭括号直接忽略（TS 类型里的 `>`、泛型等不参与本扫描器）。
 */
function skipBalanced(src, openIdx) {
    const OPEN = { '{': '}', '[': ']', '(': ')' }
    const stack = []
    for (let i = openIdx; i < src.length; i++) {
        const ch = src[i]
        if (ch === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
            i = skipComment(src, i) - 1
            continue
        }
        if (ch === "'" || ch === '"') {
            i = skipStringLiteral(src, i) - 1
            continue
        }
        if (ch === '`') {
            i = skipTemplate(src, i) - 1
            continue
        }
        if (OPEN[ch]) stack.push(OPEN[ch])
        else if (ch === '}' || ch === ']' || ch === ')') {
            if (stack[stack.length - 1] !== ch) continue
            stack.pop()
            if (stack.length === 0)
                return { end: i, bodyStart: openIdx + 1, bodyEnd: i, body: src.slice(openIdx + 1, i) }
        }
    }
    return { end: -1, bodyStart: -1, bodyEnd: -1, body: '' }
}

/** @desc 从 `src[i]`（引号）跳到字符串结束之后 */
function skipStringLiteral(src, i) {
    const quote = src[i]
    i++
    while (i < src.length) {
        if (src[i] === '\\') i += 2
        else if (src[i] === quote) return i + 1
        else i++
    }
    return i
}

/**
 * @desc 把一段对象字面量文本按**顶层键**切成 `[{ key, start, end }]`（`end` = 该值结束的下标）。
 *
 * 旧实现在整段文本上反复 `match(/^\s*(\w+):\s*\{/)`，这会把**属性内部的**键
 * （`type:` / `enum:` / `description:` / `items:`）也当成属性抽出来 —— 于是：
 *   · 属性表多出 `type` / `description` 之类的假条目；
 *   · 真正的属性只抽出「第一个」，后续属性被吞（`ai-session.ts` 的 `segmentId` 就是这样丢的）。
 *
 * 这里改成**括号栈**驱动：只有「没有未闭合容器」（`stack.length === 1`，即只剩对象自身那层）时才认键。
 * ⚠️ 不能靠「记住上一个键」这种状态位：`handler: () => { … }` 这种箭头函数体
 * 内部的 `key: value` 会被误认成顶层键（T26 第一版就踩了这个坑：`parameters` 被真·嵌套键
 * 挤到列表后面、`find` 取不到 → 全项目参数表变空）。
 */
function topLevelEntries(text) {
    const entries = []
    const stack = []
    const OPEN = { '{': '}', '[': ']', '(': ')' }
    const CLOSE = { '}': '{', ']': '[', ')': '(' }
    // 两种入参形态都要支持（T26 踩过两次，务必看清）：
    //   A. 以 `{` 开头（如 `"{ type: 'object', properties: {} }"`）→ 开头的 `{` 是对象自身的，
    //      从下标 1 开始扫，并且**忽略末尾那个配平到 0 的 `}`**；
    //   B. 不以 `{` 开头（调用方传的是「已切掉开头 `{` 的对象体」）→ 从 0 开始扫，
    //      第一个把栈清空的 `}` 就是对象结束。
    // 若把 B 当成 A 处理（`text.indexOf('{')` 找到的是**值内部**的花括号），
    // 会整段丢掉它前面的键（`description` / `parameters`）→ 全项目参数表变空。
    const braced = text.trimStart().startsWith('{')
    stack.push('{')
    let i = braced ? text.indexOf('{') + 1 : 0
    while (i < text.length) {
        const ch = text[i]
        if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
            i = skipComment(text, i)
            continue
        }
        if (ch === "'" || ch === '"') {
            i = skipStringLiteral(text, i)
            continue
        }
        if (ch === '`') {
            i = skipTemplate(text, i)
            continue
        }
        if (OPEN[ch]) {
            stack.push(ch)
            i++
            continue
        }
        if (CLOSE[ch]) {
            if (stack[stack.length - 1] === CLOSE[ch]) {
                stack.pop()
                if (stack.length === 0 && !braced) break // B 形态：对象结束
            }
            i++
            continue
        }
        if (stack.length === 1) {
            const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(text.slice(i))
            if (m) {
                let j = i + m[0].length
                while (j < text.length && /\s/.test(text[j])) j++
                const end = valueEnd(text, j)
                entries.push({ key: m[1], start: j, end })
                // ⚠️ 必须从**值的结束处**继续扫（T28 修）。早先是 `i = j`（值的**起点**），于是循环会把
                // 值文本本身当成新的键位继续认键：`description: DESCRIPTION,` 之后紧跟的
                // `requires: 'askUser'`、注释里的 `关键信息（目标、偏好…）` 都被当成顶层键 push 进 entries
                // → 下一个 entry 的 `start` 落到值之后很远的地方 → 「用 next.start 截取本键值」的做法拿到
                // 一大段混着注释与后续键的脏文本。ask_user / web_fetch 的长描述因此取不到值（T28 踩过）。
                if (end < j) break // 防御：值结束点异常时不要死循环
                i = end + 1
                continue
            }
        }
        i++
    }
    return entries
}

/** @desc 从值的起点 `j` 找出该值结束的下标（括号 / 字符串 / 模板串 / 裸字面量各走各的） */
function valueEnd(text, j) {
    const ch = text[j]
    if (ch === '{' || ch === '[' || ch === '(') return skipBalanced(text, j).end
    if (ch === "'" || ch === '"') return skipStringLiteral(text, j) - 1
    if (ch === '`') return skipTemplate(text, j) - 1
    let k = j
    while (k < text.length && text[k] !== ',' && text[k] !== '}') k++
    return k - 1
}

/**
 * @desc 抽 `parameters` 的 `required` 与 `properties`。
 *
 * T26 修的两个 bug：
 *  1. **`required` 只认顶层**。旧实现用 `/required:\s*\[([^\]]*)\]/` 在整段参数文本里找第一个
 *     `required`，而属性内部的 `items: { …, required: ['value','label'] }` 会先被命中 ——
 *     `ask_user` 就是这样把 `required: ['questions']` 整条读丢的（文档里 `questions` 标「否」）。
 *  2. **属性表只取顶层键**，并用 `type:` 过滤掉无类型字段（`additionalProperties: false` 之类不是参数）。
 */
function extractParams(objText, fileSrc) {
    const entries = topLevelEntries(objText)
    const params = entries.find((e) => e.key === 'parameters')
    if (!params) return { properties: [], required: [] }
    // ⚠️ 下面所有下标都必须对**同一段文本**取（`paramsText`），不能一半用 objText 一半用 paramsText：
    // `params.start/end` 是相对 objText 的，而 `parameters` 内部的键下标是相对 paramsText 的，
    // 混用会把 `properties` 的位置当成 objText 的位置 → 切到毫不相干的片段（T26 踩过）。
    const paramsText = objText.slice(params.start, params.end + 1)
    const paramEntries = topLevelEntries(paramsText)
    const reqEntry = paramEntries.find((e) => e.key === 'required')
    const required = reqEntry
        ? paramsText
              .slice(reqEntry.start, reqEntry.end + 1)
              .replace(/[[\]]/g, '')
              .split(',')
              .map((s) => s.trim().replace(/:.*$/s, '').replace(/^'|'$/g, '').replace(/^"|"$/g, ''))
              .filter(Boolean)
        : []
    const propEntry = paramEntries.find((e) => e.key === 'properties')
    if (!propEntry) return { properties: [], required }
    const propsText = paramsText.slice(propEntry.start, propEntry.end + 1)
    const properties = topLevelEntries(propsText)
        .filter((e) => /(^|[\s{[(,])type\s*:/.test(propsText.slice(e.start, e.end + 1)))
        .map((e) => {
            const valText = propsText.slice(e.start, e.end + 1)
            const desc = pickString(valText, 'description', fileSrc)
            // `type` 与 `enum` 都走**结构化**取值（T34 修的两个错值/错位）：
            //  ① type 旧实现是 `/(^|[\s{[(,])type\s*:\s*([^,}\n]+)/` —— 它用「到逗号为止」截取值，
            //     于是**联合类型数组** `type: ['number', 'string']`（config.ts 的 `value`）
            //     在文档里变成 `['number` 这种半截字符串；`enum` 里带引号的值同理。
            //  ② enum 旧实现在整段值文本里找第一个 `enum:`，命中**嵌套** enum →
            //     `timeline.ts` 的 `position` 被渲染成 `object（before / after）`。
            // 现在两者统一走 `readTypeSpec` / `readOwnEnum`（都基于 `topLevelEntries` 的括号栈，
            // 与 `required` 只认顶层同源）：值一律取「值本身的语法边界」，数组逐项取值，引号交给 `skipStringLiteral`。
            const spec = readTypeSpec(valText, fileSrc)
            return {
                name: e.key,
                type: spec.type,
                required: required.includes(e.key),
                description: desc,
                enum: spec.enum ?? readOwnEnum(valText)
            }
        })
    return { properties, required }
}

/** @desc 取「该参数自身那一层」的顶层键值文本（不进入嵌套对象）；没有该键返回 null */
function ownValueText(valText, key) {
    const entry = topLevelEntries(valText).find((e) => e.key === key)
    return entry ? valueTextAt(valText, entry.start) : null
}

/**
 * @desc 读 `type:` 与紧邻的 `enum:`（两者都是**自身那一层**的键）。
 *
 * `type` 的两种形态都要处理：
 *  · 裸字面量 —— `type: 'object'` / `type: 'string'`；多段拼接（`type: 'a' + 'b'`）走 `concatValueAt`；
 *  · **数组字面量** —— `type: ['number', 'string']`（联合类型）。旧实现按「到逗号为止」截取，
 *    会把数组截成 `['number` 这种半截内容（docs/tools.md 里 config.ts 的 `value` 曾如此）。
 * 数组逐项取值后以 ` / ` 连接，与 `enum` 的渲染口径一致。
 *
 * `enum` 只认顶层（见 `readOwnEnum`），非数组字面量（常量引用等）返回 `null`，
 * 由调用方回退——这样「没有 enum」与「enum 解析不出」在文档里表现一致（都不加括号后缀）。
 *
 * @param {string} [fileSrc] 同文件完整源码（用于解析 `enum: SOME_CONST` 这类常量数组引用）
 * @returns {{ type: string, enum: string[] | null }}
 */
function readTypeSpec(valText, fileSrc) {
    const typeText = ownValueText(valText, 'type')
    let type = ''
    if (typeText) {
        if (typeText.startsWith('[')) {
            type = splitArrayItemsText(typeText).join(' / ')
        } else {
            type = firstNonEmpty(
                () => concatValueAt(typeText, 0),
                () => stringValueAt(typeText, 0)
            )
            // 联合类型也可能写成拼接串里的数组元素，兜底取裸标识符（如 `type: SOME_UNION`）
            if (!type) type = typeText.trim().replace(/^'|'$/g, '')
        }
    }
    const enumText = ownValueText(valText, 'enum')
    let enumList = enumText && enumText.startsWith('[') ? splitArrayItemsText(enumText) : null
    // `enum` 也可以**引用本文件常量数组**（实测 `project.ts` 的 `phaseKeys`）：
    // 与 `resolveLocalConstant` 同一套「同文件唯一 const」解析，解析出数组字面量再拆项。
    // 不解析的话 docs/tools.md 里 `phase` 只剩裸 `string`，把可选值整段丢掉。
    if (!enumList && enumText) {
        const resolved = resolveLocalConstant(fileSrc, enumText)
        if (resolved.startsWith('[')) enumList = splitArrayItemsText(resolved)
    }
    return { type, enum: enumList }
}

/** @desc 把 `['a', 'b']` 这类数组字面量文本拆成各项（逐项走字符串取值，引号由 skipper 吃掉） */
function splitArrayItemsText(arrayText) {
    const inner = arrayText.slice(1, -1)
    const items = []
    let k = 0
    while (k < inner.length) {
        while (k < inner.length && /[\s,]/.test(inner[k])) k++
        if (k >= inner.length) break
        const ch = inner[k]
        if (ch === "'" || ch === '"') {
            items.push(unescapeLiteral(inner.slice(k + 1, skipStringLiteral(inner, k) - 1)))
            k = skipStringLiteral(inner, k)
            continue
        }
        if (ch === '`') {
            items.push(unescapeLiteral(unwrapTemplateLiteral(inner.slice(k + 1, skipTemplate(inner, k) - 1))))
            k = skipTemplate(inner, k)
            continue
        }
        // 裸标识符 / 数字等：取到下一个逗号
        const start = k
        while (k < inner.length && inner[k] !== ',') k++
        const raw = inner.slice(start, k).trim()
        if (raw) items.push(raw)
    }
    return items
}

/**
 * @desc 取「该参数**自身那一层**」的 `enum` 值列表（不含嵌套对象里的 enum）。
 * 值文本可以是裸字面量（`type: 'string', enum: ['a','b']` 这种 `valText` 是 `'string', enum: [...]`），
 * 也可以是对象字面量（`{ type: 'object', … }`）；两种形态都用括号栈取顶层键，故无需分支。
 * 括号外（顶层）的 `enum` 一律接受 —— 与 `required` 的顶层判定保持一致：真实的枚举参数一律写在顶层。
 */
function readOwnEnum(valText) {
    // 顶层键相对 `valText` 的下标；裸字面量形态下 `enum` 本身也在「顶层」
    const entry = topLevelEntries(valText).find((e) => e.key === 'enum')
    if (!entry) return []
    const valueText = valueTextAt(valText, entry.start)
    if (!valueText.startsWith('[')) return [] // 非数组字面量（引用常量等）不解析
    const inner = valueText.slice(1, -1)
    // 这里**不需要**再剥引号：`valueTextAt` 走 `skipStringLiteral`，而 `skipBalanced` 内部会经
    // `skipString` 处理，`'none'` 已是裸 `none`。旧实现里那句 `.replace(/^'|'$/g, '')` 缺少 `g`
    // 之外的锚定问题，本身就是死代码（实测：加与不加产物一致），故删除以免误导后人。
    return inner
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
}

function extractDefineToolBlocks(src) {
    const tools = []
    const re = /defineTool\(\s*'([^']+)',\s*\{/g
    let m
    while ((m = re.exec(src))) {
        const name = m[1]
        const openIdx = m.index + m[0].length - 1
        const { body } = skipBalanced(src, openIdx)
        tools.push({
            name,
            description: pickString(body, 'description', src),
            dangerous: /dangerous:\s*true/.test(body),
            params: extractParams(body, src)
        })
    }
    return tools
}

function extractGenerateTools(src) {
    const start = src.indexOf('export const GENERATE_TOOLS')
    if (start === -1) return []
    // 必须从 `=` 之后取第一个 `[`：声明里是 `GENERATE_TOOLS: ToolDefinition[] = [`
    // 直接取第一个 `[` 会命中类型注解 `ToolDefinition[]` 的空数组，导致整段抽不出来。
    const eqIdx = src.indexOf('=', start)
    if (eqIdx === -1) return []
    const arrOpen = src.indexOf('[', eqIdx)
    if (arrOpen === -1) return []
    const { end, body: arrText } = skipBalanced(src, arrOpen)
    if (end === -1) return []
    const tools = []
    const re = /name:\s*'([^']+)'/g
    let m
    while ((m = re.exec(arrText))) {
        const name = m[1]
        // 向上找所属 function 对象的起始（最近的一个 function: { 且包含该 name）
        const fnIdx = arrText.lastIndexOf('function: {', m.index)
        if (fnIdx === -1) continue
        const fnOpen = arrText.indexOf('{', fnIdx)
        const { body } = skipBalanced(arrText, fnOpen)
        tools.push({
            name,
            description: pickString(body, 'description', src),
            dangerous: false,
            params: extractParams(body, src)
        })
    }
    return tools
}

function escapeMd(s) {
    return String(s ?? '')
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' ')
}

function paramTable(params) {
    if (!params.properties.length) return '_无参数_'
    const rows = params.properties.map((p) => {
        const type = p.enum.length ? `${p.type}（${p.enum.join(' / ')}）` : p.type
        return `| \`${p.name}\` | ${p.required ? '**是**' : '否'} | ${escapeMd(type)} | ${escapeMd(p.description)} |`
    })
    return ['| 参数 | 必填 | 类型 | 说明 |', '| --- | --- | --- | --- |', ...rows].join('\n')
}

/** @desc 汇总全项目工具定义 → 返回文档正文（Prettier 之前的原始 Markdown）与统计信息 */
function buildDoc() {
    const groups = []
    let total = 0
    const dangerous = []

    for (const file of fs.readdirSync(TOOLS_DIR).filter(
        (f) =>
            f.endsWith('.ts') &&
            // 注册表自身与测试夹具不是暴露给 AI/WS 的工具，文档里必须排除
            f !== 'index.ts' &&
            f !== 'registry.ts' &&
            !f.endsWith('.test.ts')
    )) {
        const src = fs.readFileSync(path.join(TOOLS_DIR, file), 'utf8')
        const tools = extractDefineToolBlocks(src)
        if (!tools.length) continue
        const label = DOMAIN_LABELS[file] ?? file.replace('.ts', '')
        groups.push({ label, file, tools })
        total += tools.length
        for (const t of tools) if (t.dangerous) dangerous.push(t.name)
    }

    const genSrc = fs.readFileSync(GENERATE_FILE, 'utf8')
    const genTools = extractGenerateTools(genSrc)
    if (genTools.length) {
        groups.push({ label: 'Buff 生成辅助', file: 'generate/tools.ts', tools: genTools })
        total += genTools.length
    }

    const lines = []
    lines.push('# 工具文档（AI 助手 / WS 远程接管共用）')
    lines.push('')
    lines.push(`> 本文档由 \`scripts/generate-tools-doc.mjs\` 从工具源码自动生成，共 **${total}** 个工具。`)
    lines.push('> 新增/修改工具后请重跑：`node scripts/generate-tools-doc.mjs`')
    lines.push('')
    lines.push(
        'AI 助手悬浮窗与 WS 远程接管（`#websocket=`）共用同一套工具注册表与执行引擎；危险工具在 AI 侧受「危险操作权限」策略约束，WS 侧直接放行。'
    )
    lines.push('')
    lines.push(
        '**能力门控（AI 独享 / WS 不可调用）**：声明了 `requires` 的工具依赖**宿主能力**，能力缺失时既不会进发给对方的工具清单，直接 exec 也会被拒。' +
            '当前有 `ask_user`（需要提问界面）与 `web_fetch`（需要宿主网络代理出网）：WS 远程接管不提供这两项能力，故在远程通道里不可见、也不可执行。'
    )
    lines.push('')
    lines.push('## 危险工具')
    lines.push('')
    lines.push(dangerous.length ? dangerous.map((d) => `- \`${d}\``).join('\n') : '_无_')
    lines.push('')

    for (const g of groups) {
        lines.push(`## ${g.label}`)
        lines.push('')
        for (const t of g.tools) {
            lines.push(`### \`${t.name}\``)
            lines.push('')
            if (t.dangerous) lines.push('> ⚠️ **危险工具**：执行后不可轻易撤销')
            lines.push('')
            lines.push(escapeMd(t.description))
            lines.push('')
            lines.push(paramTable(t.params))
            lines.push('')
        }
    }

    lines.push('## 附录：AI 不可修改的设置')
    lines.push('')
    lines.push('以下设置不允许 AI/WS 修改（调用 `set_setting` 会报错并提示手动调整）：')
    lines.push('')
    lines.push('- 自定义主题的创建 / 删除（设置 → 外观主题；仅支持明暗切换与主色调）')
    lines.push('- 背景图本地文件上传（AI 仅可设置远程 URL / data:image 数据 / 清除）')
    lines.push('- 磁力光标的跟手性 / 灵敏度 / 旋转 / 描边 / 晃动参数（已固定，调用静默忽略）')
    lines.push('')
    lines.push('以下设置虽不可直接用 `set_setting`，但有专用工具，**可以**由 AI/WS 修改：')
    lines.push('')
    lines.push('- 按键图标 → `get_keymap` / `set_keymap_entry`')
    lines.push('- 界面快捷键 → `get_shortcuts` / `set_shortcut`')
    lines.push('- 归档管理 → `archive_project` / `unarchive_project` / `delete_project`')
    lines.push('- 缓存清理 → `set_setting` key=`clear_cache`（或 `get_cache_counts` 只读）')
    lines.push('- 助手设置（启用开关 / 危险操作权限 / 人设提示词）→ `set_setting`')
    lines.push('- AI 配置文件 → `get_ai_profiles` / `manage_ai_profile`')
    lines.push('- 工坊实例 → `get_settings_state` / `manage_workshop`')
    lines.push('- AI 上下文分段 / 用量 / 运行情况 → `get_ai_context_state` / `set_ai_context_segment` 等')
    lines.push('')
    lines.push(
        '> 完整 key 白名单以 `set_setting` 的工具描述为准（`get_settings_state` 会回传 `modifiableKeys` 实时清单）。'
    )
    lines.push('')

    return {
        content: lines.join('\n'),
        total,
        groupCount: groups.length,
        dangerousCount: dangerous.length
    }
}

const BUILD = buildDoc()

/*
 * 产物再走一遍 Prettier 再收工。
 *
 * 本脚本产出的是「未格式化」的 Markdown（表格列不对齐、行尾空行冗余），而 `pnpm run lint`
 * （= `prettier --check .`）覆盖 `docs/tools.md`（`.prettierignore` 未排除它）—— 不格式化就 lint 必红，
 * 于是「生成器产物」与「lint 期望」长期互相打架（手工补一次 prettier 就会被下一次生成打回）。
 * 故把格式化收进生成器自身，产物即 Prettier 格式，两边口径一致。
 *
 * 用 Prettier 的 Node API 而不是起 `prettier` 子进程：少一次进程启动，也避开沙箱对管道 stdio 的限制。
 */
const prettier = (await import('prettier')).default
const content = await prettier.format(BUILD.content, { filepath: OUT_PATH })

/** @desc 展示用路径：仓库内用相对路径（日志可读），仓库外（临时 `--out` 目标）保留绝对路径 */
const displayPath = (p) => {
    const rel = path.relative(ROOT, p)
    return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : p
}

/** @desc 首个不同字节的下标；完全相同返回 -1，仅长度不同返回较短者的长度 */
const firstDiffByte = (a, b) => {
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
    return a.length === b.length ? -1 : n
}

/*
 * `--check`：比对而不写入，供 `pnpm run check` 守卫「分发文档未随工具源码重生成」。
 *
 * 为什么是**逐字节**比较（而不是 check-components-doc 那种空白/表格归一后比较）：
 * 本脚本的产物自己就过一遍 Prettier（上面那段），生成侧与磁盘侧口径完全一致，
 * 没有「列宽填充差异」需要容忍 —— 于是任何字节差异都是真漂移（历史上发生过
 * 145 个工具的参数表被打成 `_无参数_`、整文件少 367 行却无人发现）。
 * 归一化比较会放过的「空白/换行悄悄变了」这类漂移，在这里也应当算错。
 */
if (process.argv.includes('--check')) {
    const shown = displayPath(OUT_PATH)
    if (!fs.existsSync(OUT_PATH)) {
        console.error(`[check-tools-doc] ✗ 缺少 ${shown}，请运行 pnpm run generate-tools-doc`)
        process.exit(1)
    }
    const onDisk = fs.readFileSync(OUT_PATH)
    const generated = Buffer.from(content, 'utf8')
    const at = firstDiffByte(onDisk, generated)
    if (at !== -1) {
        const fileText = onDisk.toString('utf8')
        const fileLines = fileText.split('\n')
        const genLines = content.split('\n')
        console.error(
            `[check-tools-doc] ✗ ${shown} 与工具源码不同步（${BUILD.total} 个工具，文件 ${fileLines.length} 行 / 生成 ${genLines.length} 行），请运行 pnpm run generate-tools-doc`
        )
        // 字节偏移 → 行号：数**目标文件**里该偏移之前的换行字节数。
        // ⚠️ 不能拿字节偏移去 slice 字符串（CJK 一个字 3 字节，会切错行）。
        let lineNo = 1
        for (let i = 0; i < at; i++) if (onDisk[i] === 10) lineNo++
        console.error(`   首个差异在第 ${lineNo} 行：`)
        console.error(`     文件: ${JSON.stringify((fileLines[lineNo - 1] ?? '(缺行)').slice(0, 120))}`)
        console.error(`     生成: ${JSON.stringify((genLines[lineNo - 1] ?? '(缺行)').slice(0, 120))}`)
        if (fileText.replace(/\r\n/g, '\n') === content)
            console.error('   提示：两侧内容一致、仅行尾（CRLF/LF）不同，跑一次 pnpm run format 归一即可')
        process.exit(1)
    }
    console.log(`[check-tools-doc] OK：${BUILD.total} 个工具与文档一致`)
    process.exit(0)
}

fs.writeFileSync(OUT_PATH, content, 'utf8')
console.log(`已生成 ${OUT_PATH}：${BUILD.total} 个工具（${BUILD.groupCount} 组），危险 ${BUILD.dangerousCount} 个`)
