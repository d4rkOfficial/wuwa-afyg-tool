// @desc 从工具源码提取 defineTool / GENERATE_TOOLS 定义，生成 docs/tools.md（AI 助手与 WS 共用注册表的完整文档）
// 用法：node scripts/generate-tools-doc.mjs
// 纯正则 + 括号/字符串感知解析，不执行 TS（避免 $lib 别名与 Svelte store 依赖）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const TOOLS_DIR = path.join(ROOT, 'src/lib/ai/tools')
const GENERATE_FILE = path.join(ROOT, 'src/lib/ai/generate/tools.ts')
const OUT = path.join(ROOT, 'docs/tools.md')

const DOMAIN_LABELS = {
    'project.ts': '工程',
    'team.ts': '队伍',
    'timeline.ts': '排轴',
    'calculation.ts': '拉表',
    'config.ts': '配装',
    'result.ts': '结果',
    'buff-library.ts': 'Buff 集',
    'buff-generate.ts': 'Buff 生成',
    'panels.ts': '面板',
    'view.ts': '视图',
    'settings.ts': '设置',
    'ai-session.ts': 'AI 助手自身（上下文 / 用量 / 运行情况）',
    'skills.ts': '技能卡',
    'kuro.ts': '库街区',
    'substat-library.ts': '词条集（方案）'
}

function pickString(objText, key) {
    const m = objText.match(new RegExp(key + ":\\s*'((?:[^'\\\\]|\\\\.)*)'", 's'))
    return m ? m[1].replace(/\\(['\\])/g, '$1') : ''
}

function matchBalanced(src, openIdx) {
    // 同时跟踪 {} 与 []：只跟踪 {} 时，对象内部出现数组（如 `required: ['a']`、
    // `enum: [...]`）会让配对数提前归零，导致解析被截断（历史上 Buff 生成辅助
    // 15 个工具只抽出 1 个就是这个原因）。
    const OPEN = { '{': '}', '[': ']' }
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
        else if (ch === '}' || ch === ']') {
            if (stack[stack.length - 1] !== ch) continue // 类型无关的杂散括号，忽略
            stack.pop()
            if (stack.length === 0) return { end: i, text: src.slice(openIdx, i) }
        }
    }
    return { end: -1, text: '' }
}

function extractParams(objText) {
    const pIdx = objText.indexOf('parameters:')
    if (pIdx === -1) return { properties: [], required: [] }
    const open = objText.indexOf('{', pIdx)
    const { text: paramsText } = matchBalanced(objText, open)
    const required = []
    const reqM = paramsText.match(/required:\s*\[([^\]]*)\]/)
    if (reqM) {
        reqM[1]
            .split(',')
            .map((s) => s.trim().replace(/^'|'$/g, ''))
            .filter(Boolean)
            .forEach((k) => required.push(k))
    }
    const propIdx = paramsText.indexOf('properties:')
    if (propIdx === -1) return { properties: [], required }
    const propOpen = paramsText.indexOf('{', propIdx)
    const { text: propsText } = matchBalanced(paramsText, propOpen)
    const properties = []
    let i = 0
    while (i < propsText.length) {
        const keyM = propsText.slice(i).match(/^\s*(\w+):\s*\{/)
        if (!keyM) {
            i++
            continue
        }
        const key = keyM[1]
        const valOpen = i + keyM.index + keyM[0].length - 1
        const { text: valText } = matchBalanced(propsText, valOpen)
        const typeM = valText.match(/type:\s*([^,}]+)/)
        const desc = pickString(valText, 'description')
        const enumM = valText.match(/enum:\s*\[([^\]]*)\]/)
        properties.push({
            name: key,
            type: typeM ? typeM[1].trim().replace(/^'|'$/g, '') : '',
            required: required.includes(key),
            description: desc,
            enum: enumM
                ? enumM[1]
                      .split(',')
                      .map((s) => s.trim().replace(/^'|'$/g, ''))
                      .filter(Boolean)
                : []
        })
        i = valOpen + valText.length + 1
    }
    return { properties, required }
}

function extractDefineToolBlocks(src) {
    const tools = []
    const re = /defineTool\(\s*'([^']+)',\s*\{/g
    let m
    while ((m = re.exec(src))) {
        const name = m[1]
        const openIdx = m.index + m[0].length - 1
        const { text } = matchBalanced(src, openIdx)
        tools.push({
            name,
            description: pickString(text, 'description'),
            dangerous: /dangerous:\s*true/.test(text),
            params: extractParams(text)
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
    const { end, text: arrText } = matchBalanced(src, arrOpen)
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
        const { text } = matchBalanced(arrText, fnOpen)
        tools.push({
            name,
            description: pickString(text, 'description'),
            dangerous: false,
            params: extractParams(text)
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

function main() {
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

    fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
    console.log(`已生成 ${OUT}：${total} 个工具（${groups.length} 组），危险 ${dangerous.length} 个`)
}

main()
