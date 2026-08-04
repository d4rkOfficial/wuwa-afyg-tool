import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const srcDir = join(root, 'src')
const genPath = join(root, 'src/lib/utils/mdi-icons.generated.ts')

function walk(dir) {
    const out = []
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
            out.push(...walk(full))
        } else if (/\.(svelte|ts)$/.test(entry)) {
            out.push(full)
        }
    }
    return out
}

const used = new Set()
for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf-8')
    for (const m of text.matchAll(/mdi:([a-z0-9-]+)/gi)) {
        used.add(m[1].toLowerCase())
    }
}

const gen = readFileSync(genPath, 'utf-8')
const genKeys = new Set()
for (const m of gen.matchAll(/^\s+'([a-z0-9-]+)': \{/gm)) {
    genKeys.add(m[1])
}

const missing = [...used].filter((n) => !genKeys.has(n)).sort()

if (missing.length > 0) {
    console.error(
        `[check-mdi-icons] 以下 ${missing.length} 个 mdi 图标未收录在 mdi-icons.generated.ts，将回退到远程加载:`
    )
    for (const n of missing) console.error(`  - ${n}`)
    console.error(`请运行 pnpm collect-icons 重新生成本地图标集合。`)
    process.exit(1)
}

console.log(`[check-mdi-icons] OK: ${used.size} 个使用中的 mdi 图标均已收录于本地集合`)
