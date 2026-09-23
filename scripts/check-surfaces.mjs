// 一致性检查：组件里用到的 data-sf 值，必须都能在 layout.css 找到规则、且属于引擎的 SURFACE_KEYS
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

const used = new Map()
for (const file of walk('src')) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/data-sf="([^"{}]+)"/g)) {
        const list = used.get(m[1]) ?? []
        list.push(file)
        used.set(m[1], list)
    }
}

console.log(`引擎区域 key：${[...keys].join(' / ')}`)
console.log(`组件中出现的 data-sf 值：${[...used.keys()].join(' / ') || '(无)'}`)
let bad = 0
for (const [k, files] of used) {
    const inKeys = keys.has(k)
    const inCss = new RegExp(`\\[data-sf='${k}'\\]`).test(css)
    if (!inKeys || !inCss) {
        bad++
        console.log(`  ✗ ${k}  引擎key=${inKeys} css规则=${inCss}  (${files.length} 处)`)
    }
}
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
