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
    'buff-library.ts': 'Buff 库',
    'buff-generate.ts': 'Buff 生成',
    'panels.ts': '面板',
    'view.ts': '视图',
    'settings.ts': '设置'
}

function pickString(objText, key) {
    const m = objText.match(new RegExp(key + ":\\s*'((?:[^'\\\\]|\\\\.)*)'", 's'))
    return m ? m[1].replace(/\\(['\\])/g, '$1') : ''
}

function matchBalanced(src, openIdx) {
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
        if (ch === '{') stack.push(i)
        else if (ch === '}') {
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
    const arrOpen = src.indexOf('[', start)
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
    return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
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

    for (const file of fs.readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'registry.ts')) {
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
    lines.push('AI 助手悬浮窗与 WS 远程接管（`#websocket=`）共用同一套工具注册表与执行引擎；危险工具在 AI 侧受「危险操作权限」策略约束，WS 侧直接放行。')
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
    lines.push('- 按键图标（设置 → 按键图标）')
    lines.push('- 界面快捷键（设置 → 交互相关 → 界面快捷键）')
    lines.push('- 归档管理（设置 → 归档管理）')
    lines.push('- 缓存清理（设置 → 缓存清理）')
    lines.push('- 助手设置（启用开关、危险操作权限、AI 配置文件、提示词、黑话词典）')
    lines.push('- 自定义主题的创建/删除（设置 → 外观主题，仅支持明暗切换/主色调/背景与质感参数）')
    lines.push('- 背景图本地文件上传（AI 仅可设置远程 URL / data:image 数据 / 清除）')
    lines.push('')
    lines.push('### `set_setting` 白名单一览')
    lines.push('')
    lines.push('| key | 说明 | 取值 |')
    lines.push('| --- | --- | --- |')
    lines.push('| `theme_mode` | 明暗模式 | dark / light |')
    lines.push('| `theme_accent_hue` | 主色调 | default(青色) / orange(橘红) / orangeyellow(橘黄) / magenta(品红) / cyan(青色别名) / indigo(靛蓝) / green(墨绿) / mono(黑白) 或 0-360 整数 |')
    lines.push('| `theme_background_image` | 背景图 | http(s):// 地址 / data:image 数据 / 空串清除 |')
    lines.push('| `theme_bg_opacity` | 卡片透明度 | 30-100 |')
    lines.push('| `theme_bg_blur` | 毛玻璃强度 | 0-32 |')
    lines.push('| `theme_bg_dim` | 背景暗度 | 0-100 |')
    lines.push('| `theme_bg_image_blur` | 背景图模糊 | 0-32 |')
    lines.push('| `theme_bg_image_mask` | 背景图遮罩 | 0-100 |')
    lines.push('| `calc_view` | 拉表视图 | dropdown / spread |')
    lines.push('| `simplify_toolbar` | 简化底部工具栏 | true / false |')
    lines.push('| `magnetic_pointer` | 磁力光标 | true / false |')
    lines.push('| `gpu_accel` | 渲染加速（GPU） | true / false |')
    lines.push('| `reload_on_result_refresh` | 刷新结果重载数据 | true / false |')
    lines.push('| `reload_on_profile_change` | 链/阶变动重载数据 | true / false |')
    lines.push('')
    lines.push('工坊实例管理请使用 `manage_workshop`（action：switch / add / remove / reset）。')
    lines.push('')

    fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
    console.log(`已生成 ${OUT}：${total} 个工具（${groups.length} 组），危险 ${dangerous.length} 个`)
}

main()
