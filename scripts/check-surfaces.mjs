// 一致性检查：组件里用到的 data-sf / data-sf-under 值，必须都能在 layout.css 找到规则、且属于引擎的 SURFACE_KEYS
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const walk = (dir) => {
    const out = []
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) out.push(...walk(p))
        else if (extname(p) === '.svelte') out.push(p)
    }
    return out
}

const keys = new Set(
    (readFileSync('src/lib/theme/types.ts', 'utf8').match(/export type SurfaceKey =([^\n]+)/)?.[1] ?? '')
        .split('|')
        .map((s) => s.trim().replace(/'/g, ''))
        .filter(Boolean)
)
const css = readFileSync('src/routes/layout.css', 'utf8')
const engine = readFileSync('src/lib/theme/theme.svelte.ts', 'utf8')

/** @desc 收集某属性在组件里的取值 → 使用位置 */
const collect = (re) => {
    const map = new Map()
    for (const file of walk('src')) {
        const src = readFileSync(file, 'utf8')
        for (const m of src.matchAll(re)) {
            const list = map.get(m[1]) ?? []
            list.push(file)
            map.set(m[1], list)
        }
    }
    return map
}

const used = collect(/data-sf="([^"{}]+)"/g)
const usedUnder = collect(/data-sf-under="([^"{}]+)"/g)

let bad = 0
/** @desc 校验「组件里出现的取值」都有引擎 key 与对应 css 规则（data-sf 规则形如 [data-sf='x']，垫层形如 [data-sf-under='x']） */
const checkUsed = (map, attr) => {
    for (const [k, files] of map) {
        const inKeys = keys.has(k)
        const inCss = new RegExp(`\\[${attr}='${k}'\\]`).test(css)
        if (!inKeys || !inCss) {
            bad++
            console.log(`  ✗ ${attr}="${k}"  引擎key=${inKeys} css规则=${inCss}  (${files.length} 处)`)
        }
    }
}

console.log(`引擎区域 key：${[...keys].join(' / ')}`)
console.log(`组件中出现的 data-sf 值：${[...used.keys()].join(' / ') || '(无)'}`)
console.log(`组件中出现的 data-sf-under 值：${[...usedUnder.keys()].join(' / ') || '(无)'}`)
checkUsed(used, 'data-sf')
checkUsed(usedUnder, 'data-sf-under')

for (const k of keys) {
    const emitted = new RegExp(`--sf-\\$\\{key\\}-|--sf-${k}-`).test(engine)
    const inCss = new RegExp(`\\[data-sf='${k}'\\]`).test(css)
    if (!inCss || !emitted) {
        bad++
        console.log(`  ✗ 引擎 key ${k} 缺少 css 规则或变量发射（css=${inCss} engine=${emitted}）`)
    }
}

// ── 主题组件命名空间一致性：ThemeComponentKey 联合 与 两个 preset JSON 必须完全一致 ──
// 历史缺陷：titlebar 存在于 dark/light.json 却不在联合类型里，靠 theme.svelte.ts 的动态索引绕过类型检查。
const typesSrc = readFileSync('src/lib/theme/types.ts', 'utf8')
const unionBody = (typesSrc.match(/export type ThemeComponentKey =([\s\S]*)$/)?.[1] ?? '')
    // 联合类型按语义分了组，组间用 // 注释分隔；解析前先去注释
    .replace(/\/\/[^\n]*/g, '')
const unionKeys = new Set(
    unionBody
        .split('|')
        .map((s) => s.trim().replace(/'/g, ''))
        .filter(Boolean)
)
const readPresetKeys = (p) => new Set(Object.keys(JSON.parse(readFileSync(p, 'utf8')).components ?? {}))
const darkKeys = readPresetKeys('src/lib/theme/preset/dark.json')
const lightKeys = readPresetKeys('src/lib/theme/preset/light.json')

console.log('')
console.log(`ThemeComponentKey 联合：${[...unionKeys].sort().join(' / ')}`)
const diff = (a, b) => [...a].filter((k) => !b.has(k)).sort()

for (const [label, missing] of [
    ['联合有但 dark.json 缺失', diff(unionKeys, darkKeys)],
    ['dark.json 有但联合缺失', diff(darkKeys, unionKeys)],
    ['light.json 有但联合缺失', diff(lightKeys, unionKeys)],
    ['dark/light 不一致', [...diff(darkKeys, lightKeys), ...diff(lightKeys, darkKeys)]]
]) {
    if (missing.length) {
        bad += missing.length
        console.log(`  ✗ ${label}: ${missing.join(', ')}`)
    }
}
if (bad === 0) console.log('  ✓ 组件命名空间三处一致')

// ── SURFACE_GROUPS 提示文案 ↔ AI 工具描述：必须同步 ──
// settings.ts 的 set_setting.description 内联了各区域含义（不能拼接：generate-tools-doc.mjs
// 的 pickString 只取第一个字符串字面量，拼接会让 docs/tools.md 被静默截断）。
// 故改为断言：每个 SURFACE_GROUPS[*].hint 都必须原样出现在 settings.ts 里。
const settingsSrc = readFileSync('src/lib/ai/tools/settings.ts', 'utf8')
const hints = [...typesSrc.matchAll(/hint:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1])
const missingHints = hints.filter((h) => !settingsSrc.includes(h))
console.log('')
console.log(`区域提示文案 ${hints.length} 条`)
if (missingHints.length) {
    bad += missingHints.length
    for (const h of missingHints) {
        console.log(`  ✗ AI 工具描述缺少该区域提示（改 SURFACE_GROUPS.hint 后需同步 settings.ts）: ${h.slice(0, 40)}…`)
    }
} else {
    console.log('  ✓ 与 set_setting 的 AI 描述一致')
}

console.log(bad === 0 ? '[check-surfaces] OK' : `[check-surfaces] ${bad} 处不一致`)
process.exit(bad === 0 ? 0 : 1)
