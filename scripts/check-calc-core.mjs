// 计算核的**纯度闸门**：`src/coconut-core/**` 的每个文件都要能独立在 Node 里跑，
// 一旦触达浏览器 / Svelte / store / app 功能依赖就失败。
//
// 用法：node scripts/check-calc-core.mjs
//
// 为什么必须机器保证：计算核要能被外部项目（工坊 / conv 报告页 / 脚本）直接 import 且在 Node 里跑，
// 只要有人顺手 `import { getEchoSkillText } from '$lib/data/char-info.svelte'`，整条链就绑上了
// Runes + `$app/environment` + 上游 API 缓存 —— 而这种耦合在 app 里跑是**完全正常**的，只有这个闸门能发现。
//
// 判据是「目录内**每个**文件都干净」，而不是「从某个入口可达的部分干净」：核里新增一个没人
// import 的文件，也必须是纯的（否则接线的第一步就踩坑，且闸门看不见）。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const CORE_DIR = 'src/coconut-core'

/** @desc 允许出现在核里的外部别名前缀（纯常量 / 纯类型 / 纯工具） */
const ALLOWED_LIB = new Set(['consts', 'utils', 'types', 'api'])

/** @desc 明确禁止的路径特征（浏览器 / Svelte / store / 非核算法） */
const FORBIDDEN = [
    { test: (p) => p.startsWith('$app/'), reason: '依赖 SvelteKit 运行时（$app/*）' },
    {
        test: (p) => p.startsWith('$lib/data/'),
        reason: '依赖数据层 store（$lib/data/*，含 Runes / localStorage / 上游 API）'
    },
    { test: (p) => p.endsWith('.svelte.ts'), reason: '依赖 Runes store（*.svelte.ts）' },
    { test: (p) => p.startsWith('$lib/substat'), reason: '副词条分析属于 app 功能，不在计算核内' },
    { test: (p) => p.startsWith('$lib/components/') || p.startsWith('$lib/theme/'), reason: '依赖界面层' }
]

const norm = (p) => p.replace(/\\/g, '/')

/** @desc 收集一个源文件里的 import/export 来源说明符（静态字符串字面量） */
const specifiersOf = (source) => {
    const out = []
    const re = /(?:from|import)\s*\(?\s*'([^']+)'/g
    let m
    while ((m = re.exec(source))) out.push(m[1])
    return out
}

/** @desc 把说明符解析成相对仓库根的路径；外部包返回 null */
const resolveSpecifier = (spec, fromFile) => {
    if (spec.startsWith('.')) {
        const resolved = norm(normalize(join(dirname(fromFile), spec)))
        return resolved
    }
    if (spec.startsWith('$lib/')) return `src/lib/${spec.slice('$lib/'.length)}`
    if (spec.startsWith('$src/')) return `src/${spec.slice('$src/'.length)}`
    if (spec.startsWith('$coconut/')) return `src/coconut-core/${spec.slice('$coconut/'.length)}`
    if (spec === '$coconut') return `src/coconut-core/index.ts`
    return null
}

/** @desc 核目录里的全部 TS 源（每个都是闸门入口） */
const coreFiles = []
const collect = (dir) => {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) collect(p)
        else if (name.endsWith('.ts')) coreFiles.push(norm(p))
    }
}
collect(CORE_DIR)
coreFiles.sort()

const visited = new Set()
const violations = []
const externalAliases = new Set()

const walk = (file) => {
    if (visited.has(file)) return
    visited.add(file)
    const source = readFileSync(file, 'utf8')
    for (const spec of specifiersOf(source)) {
        const target = resolveSpecifier(spec, file)
        if (target === null) continue // 第三方包 / node 内置

        for (const rule of FORBIDDEN) {
            if (rule.test(target) || rule.test(spec)) {
                violations.push({ file, spec, reason: rule.reason })
            }
        }

        // 别名白名单：只允许纯类型 / 纯常量目录
        if (spec.startsWith('$lib/')) {
            const top = spec.slice('$lib/'.length).split('/')[0]
            if (!ALLOWED_LIB.has(top)) externalAliases.add(`${spec}  ← ${file}`)
        }

        const candidates = [target, `${target}.ts`, `${target}/index.ts`]
        const next = candidates.find((c) => existsSync(c))
        if (!next) {
            violations.push({ file, spec, reason: `无法解析：${target}` })
            continue
        }
        walk(norm(next))
    }
}

for (const file of coreFiles) walk(file)

const files = [...visited].sort()
console.log('── 计算核 import 闭包')
console.log(`   核目录 ${CORE_DIR}（${coreFiles.length} 个源文件，全部作为入口）`)
console.log(`   可达文件 ${files.length} 个`)
for (const f of files) console.log(`   · ${f}`)

if (externalAliases.size > 0) {
    console.log('\n── 别名白名单外的 $lib 依赖')
    for (const line of externalAliases) console.log(`   ✗ ${line}`)
}

const failed = violations.length + externalAliases.size
if (failed > 0) {
    if (violations.length > 0) {
        console.log('\n── 违规')
        for (const v of violations) console.log(`   ✗ ${v.file} → ${v.spec}：${v.reason}`)
    }
    console.log(`[check-calc-core] ${failed} 处问题`)
    process.exit(1)
}

console.log('\n══════════════════════════════════════')
console.log(`[check-calc-core] OK：${files.length} 个文件全部为纯计算依赖`)
