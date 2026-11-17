/**
 * @desc 把 `src/coconut-config` 编译成**可发布的 config 包**：`dist/calc-config/` → `dist/d4rkofficial-coconut-config-<version>.tgz`。
 *
 * 为什么要单独发包：内核零语料，使用方要么自己写 35 条作用 / 19 个引用来源 / 12 个乘子 / 4 条公式，
 * 要么直接拿工具箱已经调好的这一份。这份 config 只依赖内核的**类型**与 `defineFormula`，
 * 所以装它 + 内核就能算《鸣潮》口径。
 *
 * 版本号默认取根 `package.json`（与工具箱一起发，脚本用 `--version` 覆盖）。
 * 产物：`index.js`（单文件 ESM，默认导出当前版本的 config）、`index.d.ts`、`package.json`、`README.md`。
 *
 * 用法：node scripts/release-calc-config.mjs [--version 0.0.1]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = process.cwd()
const require = createRequire(import.meta.url)

const versionArg = process.argv.findIndex((arg) => arg === '--version')
const version =
    versionArg >= 0 && process.argv[versionArg + 1]
        ? process.argv[versionArg + 1]
        : JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
if (!version) throw new Error('[release-calc-config] 缺少版本号')

const name = '@d4rkofficial/coconut-config'
const repo = 'https://github.com/d4rkOfficial/wuwa-afyg-tool'
const outDir = resolve(root, 'dist/calc-config')

/** @desc esbuild 不是顶层依赖（被 vite 带进来），从 pnpm store 里兜底定位 */
const resolveEsbuild = () => {
    try {
        return require.resolve('esbuild')
    } catch {
        const store = resolve(root, 'node_modules/.pnpm')
        if (!existsSync(store)) throw new Error('[release-calc-config] 找不到 esbuild，请先 pnpm install')
        const entry = readdirSync(store).find((dir) => dir.startsWith('esbuild@'))
        if (!entry) throw new Error('[release-calc-config] 找不到 esbuild（node_modules/.pnpm 里也没有）')
        return resolve(store, entry, 'node_modules/esbuild/lib/main.js')
    }
}

const isFile = (path) => {
    try {
        return require('node:fs').statSync(path).isFile()
    } catch {
        return false
    }
}

/** @desc 前缀别名（esbuild 的 alias 只做精确匹配，这里手写 onResolve） */
const prefixAlias = {
    '$coconut-core': resolve(root, 'src/coconut-core'),
    '$coconut-config': resolve(root, 'src/coconut-config'),
    $lib: resolve(root, 'src/lib'),
    $src: resolve(root, 'src')
}

const resolveFile = (base) => {
    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.mjs`,
        `${base}/index.ts`,
        `${base}/index.js`
    ]
    for (const candidate of candidates) if (isFile(candidate)) return candidate
    throw new Error(`[release-calc-config] 无法解析：${base}`)
}

/** 1) 清空产物目录，避免上一版遗留文件混进包 */
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

/** 2) 生成入口：默认导出当前版本的 config */
const entryPath = resolve(outDir, 'entry.ts')
writeFileSync(
    entryPath,
    `import { config } from '$coconut-config'

export { config }
export default config
`,
    'utf8'
)

/** 3) 打包成单文件 ESM（`$app/environment` 的替身要先落盘，esbuild 才读得到） */
writeFileSync(
    resolve(outDir, 'env.js'),
    `export const browser = true
export const dev = false
export const building = false
export const version = '${version}'
`,
    'utf8'
)
const { build } = await import(`file://${resolveEsbuild().replace(/\\/g, '/')}`)
await build({
    entryPoints: [entryPath],
    outfile: resolve(outDir, 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: false,
    legalComments: 'none',
    logLevel: 'warning',
    define: { __OFFLINE_BUILD__: 'false' },
    plugins: [
        {
            name: 'coconut-alias',
            setup(builder) {
                builder.onResolve({ filter: /^\$app\/environment$/ }, () => ({ path: resolve(outDir, 'env.js') }))
                builder.onResolve({ filter: /^\$(coconut-core|coconut-config|lib|src)(\/|$)/ }, (args) => {
                    const [head, ...rest] = args.path.split('/')
                    return { path: resolveFile(resolve(prefixAlias[head], rest.join('/'))) }
                })
            }
        }
    ]
})
/** 4) 类型：直接声明成内核的 `CoconutCoreConfig`，不生成中间 d.ts */
writeFileSync(
    resolve(outDir, 'index.d.ts'),
    `import type { CoconutCoreConfig } from '@d4rkofficial/coconut-core'

/** 工具箱调好的一份注册配置：作用 / 引用来源 / 乘子 / 公式 / 面板 / 目标侧字段 / 常量 */
declare const config: CoconutCoreConfig

export { config }
export default config
`,
    'utf8'
)

/** 5) README：一段代码就够 */
writeFileSync(
    resolve(outDir, 'README.md'),
    `# coconut-config

《鸣潮》口径的一份 CoconutCore 注册配置（作用 / 引用来源 / 乘子 / 公式 / 面板维度 / 目标侧字段 / 常量），
直接拿去 \`init\` 就能算，不用自己写注册表。默认导出即配置对象。

\`\`\`js
import { CoconutCore } from '@d4rkofficial/coconut-core'
import config from '@d4rkofficial/coconut-config'

const core = new CoconutCore().init(config)
const result = core.compute(table)
\`\`\`
`,
    'utf8'
)

/** 6) 包元数据 */
writeFileSync(
    resolve(outDir, 'package.json'),
    JSON.stringify(
        {
            name,
            version,
            description: '椰果工具箱的 CoconutCore 注册配置：作用 / 引用来源 / 乘子 / 公式，直接 init 就能算',
            type: 'module',
            main: './index.js',
            module: './index.js',
            types: './index.d.ts',
            exports: {
                '.': {
                    types: './index.d.ts',
                    import: './index.js',
                    default: './index.js'
                },
                './package.json': './package.json'
            },
            files: ['index.js', 'index.d.ts', 'README.md'],
            sideEffects: false,
            engines: { node: '>=20' },
            peerDependencies: { '@d4rkofficial/coconut-core': '>=0.1.0' },
            repository: { type: 'git', url: `git+${repo}.git`, directory: 'src/coconut-config' },
            homepage: `${repo}/blob/main/docs/coconut-core.md`,
            keywords: ['wuwa', 'wuthering-waves', 'damage', 'calculator', 'coconut-core'],
            license: 'MIT',
            publishConfig: { access: 'public' }
        },
        null,
        4
    ) + '\n',
    'utf8'
)

/** 7) 打 tarball（与 core 同口径：`--pack-destination ..` 避开 cmd.exe 的引号问题） */
rmSync(entryPath, { force: true })
rmSync(resolve(outDir, 'env.js'), { force: true })
const packCmd = 'npm pack --json --pack-destination ..'
const [shellBin, shellArgs] =
    process.platform === 'win32'
        ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', packCmd]]
        : ['/bin/sh', ['-c', packCmd]]
const packOutput = execFileSync(shellBin, shellArgs, { cwd: outDir, encoding: 'utf8' })
const [packed] = JSON.parse(packOutput)
const tarball = resolve(outDir, '..', packed.filename)

/** 8) 自检：`files` 写错时不能「打包成功」 */
const paths = new Set(packed.files.map((file) => file.path))
const required = ['package.json', 'index.js', 'index.d.ts', 'README.md']
const missing = required.filter((file) => !paths.has(file))
const extra = [...paths].filter((file) => !required.includes(file))
if (missing.length > 0) throw new Error(`[release-calc-config] 包内缺少：${missing.join(', ')}`)
if (extra.length > 0) throw new Error(`[release-calc-config] 包内多余文件：${extra.join(', ')}`)

const sizeKb = (packed.size / 1024).toFixed(1)
console.log(`\n[release-calc-config] OK：${name}@${version}`)
console.log(`   产物目录 dist/calc-config/（${packed.files.length} 个文件）`)
console.log(`     ${packed.files.map((file) => file.path).join('\n     ')}`)
console.log(`   tarball  ${tarball}（${sizeKb} KB，解包后 ${(packed.unpackedSize / 1024).toFixed(1)} KB）`)
console.log(`\n── 消费方安装（core 与本包都从工具箱 Release 取）`)
console.log(`npm i ${repo}/releases/download/core-v0.1.0/d4rkofficial-coconut-core-0.1.0.tgz`)
console.log(`npm i ${repo}/releases/latest/download/${packed.filename}`)
