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
//
// 四条硬规则：
//   ① 纯计算：每个文件的 import 闭包都不得触达 `$app/*` / `$lib/*` / `*.svelte.ts` / 界面层，
//      也不得触达注册配置 `$coconut-config`（配置依赖内核，方向不能反过来）；
//   ② 零语料：不出现中文字符（标识符 / 字符串 / 注释一律不允许 —— 内核注释是故意全删的）；
//   ③ 零内置表：不出现 `id: 'xxx'` 这类表项形状，作用表 / 乘子 / 公式只能来自 `init`；
//   ④ 单一出口：`$coconut-core/*` 子路径只允许注册配置（`src/coconut-config/**`）与门面
//      （`src/lib/calc/core-config.ts`）使用；`$coconut-config` 只允许门面使用 ——
//      「对外只暴露一个纯计算核、一份注册配置」的落地形态。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const CORE_DIR = 'src/coconut-core'

/** @desc 允许出现在核里的外部别名前缀（纯常量 / 纯类型 / 纯工具） */
const ALLOWED_LIB = new Set([])

/** @desc 明确禁止的路径特征（浏览器 / Svelte / store / 非核算法） */
const FORBIDDEN = [
    { test: (p) => p.startsWith('$app/'), reason: '依赖 SvelteKit 运行时（$app/*）' },
    { test: (p) => p.startsWith('$lib/'), reason: '内核不得依赖工具箱（$lib/*）' },
    { test: (p) => p.startsWith('$src/'), reason: '内核不得依赖路由层（$src/*）' },
    {
        test: (p) => p.startsWith('$lib/data/'),
        reason: '依赖数据层 store（$lib/data/*，含 Runes / localStorage / 上游 API）'
    },
    { test: (p) => p.endsWith('.svelte.ts'), reason: '依赖 Runes store（*.svelte.ts）' },
    { test: (p) => p.startsWith('$lib/substat'), reason: '副词条分析属于 app 功能，不在计算核内' },
    { test: (p) => p.startsWith('$lib/components/') || p.startsWith('$lib/theme/'), reason: '依赖界面层' },
    {
        test: (p) => p.startsWith('src/coconut-config') || p.startsWith('$coconut-config'),
        reason: '内核不得依赖注册配置（$coconut-config），方向是配置依赖内核'
    }
]

/** @desc 中文字符 / 全角标点的字符范围（内核零语料） */
const CJK_RE = /[\u2e80-\u2eff\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/

/** @desc 内置表项形状：`id: 'xxx'` 只能出现在注册层 */
const TABLE_ITEM_RE = /^\s*id:\s*'/m

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
    if (spec.startsWith('$coconut-core/')) return `src/coconut-core/${spec.slice('$coconut-core/'.length)}`
    if (spec === '$coconut-core') return 'src/coconut-core/index.ts'
    if (spec === '$coconut-config') return 'src/coconut-config/index.ts'
    if (spec.startsWith('$coconut-config/')) return `src/coconut-config/${spec.slice('$coconut-config/'.length)}`
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

        // 别名白名单：只允许纯类型 / 纯常量目录（当前为空 —— 内核零 $lib 依赖）
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

console.log('── 计算核 import 闭包')
console.log(`   核目录 ${CORE_DIR}（${coreFiles.length} 个源文件，全部作为入口）`)
console.log(`   可达文件 ${visited.size} 个`)
for (const f of [...visited].sort()) console.log(`   · ${f}`)

if (externalAliases.size > 0) {
    console.log('\n── 别名白名单外的 $lib 依赖')
    for (const line of externalAliases) console.log(`   ✗ ${line}`)
}

// ── ② 零语料 / ③ 零内置表 ──
const corpus = []
const builtInTables = []
for (const file of coreFiles) {
    const source = readFileSync(file, 'utf8')
    source.split('\n').forEach((line, index) => {
        if (CJK_RE.test(line)) corpus.push({ file, line: index + 1, text: line.trim() })
    })
    if (TABLE_ITEM_RE.test(source)) builtInTables.push(file)
}

if (corpus.length > 0) {
    console.log('\n── 内核语料（中文字符）')
    for (const hit of corpus) console.log(`   ✗ ${hit.file}:${hit.line}  ${hit.text.slice(0, 80)}`)
} else {
    console.log('\n── ② 零语料：通过')
}
if (builtInTables.length > 0) {
    console.log("\n── 内核内置表（id: '…' 表项）")
    for (const file of builtInTables) console.log(`   ✗ ${file}`)
} else {
    console.log('── ③ 零内置表：通过')
}

// ── ④ 单一出口：内核子路径只给注册配置与门面，`$coconut-config` 只给门面 ──
const CORE_SUBPATH_RE = /from '\$coconut-core\/(?!index)/
const CONFIG_RE = /from '\$coconut-config(\/|')/
const REGISTRATION_LAYER = 'src/lib/calc/core-config.ts'
const CONFIG_DIR = 'src/coconut-config/'
const coreSubpathImports = []
const configImports = []
const scanUpper = (dir) => {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) {
            if (name === 'coconut-core' || name === 'node_modules' || name.startsWith('.')) continue
            scanUpper(p)
        } else if (/\.(ts|svelte)$/.test(name)) {
            const file = norm(p)
            const source = readFileSync(file, 'utf8')
            if (file !== REGISTRATION_LAYER && !file.startsWith(CONFIG_DIR) && CORE_SUBPATH_RE.test(source))
                coreSubpathImports.push(file)
            if (file !== REGISTRATION_LAYER && CONFIG_RE.test(source)) configImports.push(file)
        }
    }
}
scanUpper('src')
if (coreSubpathImports.length > 0) {
    console.log('\n── 内核出口越界（只有注册配置与门面可以 import $coconut-core 子路径）')
    for (const file of coreSubpathImports) console.log(`   ✗ ${file}`)
} else {
    console.log(`── ④ 单一出口：内核子路径仅 ${CONFIG_DIR}** 与 ${REGISTRATION_LAYER}`)
}
if (configImports.length > 0) {
    console.log('\n── 注册配置出口越界（只有门面可以 import $coconut-config）')
    for (const file of configImports) console.log(`   ✗ ${file}`)
} else {
    console.log(`── ④ 单一出口：$coconut-config 仅 ${REGISTRATION_LAYER}`)
}

const failed =
    violations.length +
    externalAliases.size +
    corpus.length +
    builtInTables.length +
    coreSubpathImports.length +
    configImports.length
if (failed > 0) {
    if (violations.length > 0) {
        console.log('\n── 违规')
        for (const v of violations) console.log(`   ✗ ${v.file} → ${v.spec}：${v.reason}`)
    }
    console.log(`[check-calc-core] ${failed} 处问题`)
    process.exit(1)
}

console.log('\n══════════════════════════════════════')
console.log(`[check-calc-core] OK：${visited.size} 个文件全部为纯计算依赖，零语料、零内置表、单一出口`)
