import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const srcDir = join(root, 'src')
const mdi = JSON.parse(readFileSync(join(root, 'node_modules/@iconify-json/mdi/icons.json'), 'utf-8'))

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

const pattern = /mdi:([a-z0-9-]+)/gi
const names = new Set()
for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf-8')
    for (const m of text.matchAll(pattern)) {
        names.add(m[1].toLowerCase())
    }
}

const icons = {}
const aliases = {}
const stack = [...names]
while (stack.length) {
    const name = stack.pop()
    if (icons[name] || aliases[name]) continue
    if (mdi.icons[name]) {
        const icon = mdi.icons[name]
        const out = { body: icon.body }
        if (icon.width !== undefined) out.width = icon.width
        if (icon.height !== undefined) out.height = icon.height
        icons[name] = out
    } else if (mdi.aliases?.[name]) {
        const alias = mdi.aliases[name]
        aliases[name] = { parent: alias.parent }
        if (alias.parent) stack.push(alias.parent)
    } else {
        console.warn(`MISSING mdi icon: ${name}`)
    }
}

function quote(s) {
    return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function emit(obj) {
    const parts = Object.keys(obj).map((k) => `${k}: ${typeof obj[k] === 'string' ? quote(obj[k]) : obj[k]}`)
    return `{ ${parts.join(', ')} }`
}

const iconLines = Object.keys(icons)
    .sort()
    .map((n) => `        ${quote(n)}: ${emit(icons[n])}`)
const aliasLines = Object.keys(aliases)
    .sort()
    .map((n) => `        ${quote(n)}: ${emit(aliases[n])}`)

const body = [
    '/** 由 scripts/collect-mdi-icons.mjs 自动生成，请勿手改；改动图标后运行 pnpm collect-icons */',
    '// prettier-ignore',
    'export const MDI_ICONS = {',
    "    prefix: 'mdi',",
    `    width: ${mdi.width},`,
    `    height: ${mdi.height},`,
    '    icons: {',
    iconLines.join(',\n'),
    '    },',
    '    aliases: {',
    aliasLines.join(',\n'),
    '    }',
    '}'
].join('\n')

const outPath = join(root, 'src/lib/utils/mdi-icons.generated.ts')
writeFileSync(outPath, body + '\n')
console.log(`Collected ${Object.keys(icons).length} icons + ${Object.keys(aliases).length} aliases -> ${outPath}`)
