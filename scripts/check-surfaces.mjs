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
console.log(bad === 0 ? '[check-surfaces] OK' : `[check-surfaces] ${bad} 处不一致`)
process.exit(bad === 0 ? 0 : 1)
