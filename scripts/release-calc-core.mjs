/**
 * @desc 把计算核打成**可分发的独立包**：`dist/coconut-core/` → `dist/d4rkofficial-coconut-core-<version>.tgz`。
 *
 * 为什么是一条本地命令而不是发布流水线：内核长期不变，改动频率远低于 app，
 * 手动跑一次、把 tgz 挂到 GitHub Release 附件即可；消费方 `npm i <tgz 的 release 直链>` 就装了，
 * 不需要 npm 账号、也不需要把内核混进 app 的 release 语义里（脚本最后会打印现成的 `gh release` 命令）。
 *
 * 产物内容：
 * - `index.js`：单文件 ESM（零 import、零 `$coconut` 别名残留），由 `build-calc-lib.mjs` 打包；
 * - `*.d.ts`：由 `tsconfig.core.json` 直出（内核源码内部已改为相对路径，类型说明符天然干净），
 *   并把相对说明符补成 `.js`，让 `moduleResolution: node16/nodenext` 的消费方也能解析；
 * - `package.json` / `README.md` / `LICENSE`：包元数据与许可。
 *
 * 版本真源是 `src/coconut-core/package.json`（与 app 的 `0.0.1` 解耦）。
 *
 * 用法：node scripts/release-calc-core.mjs
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const coreManifestPath = resolve(root, 'src/coconut-core/package.json')
const coreManifest = JSON.parse(readFileSync(coreManifestPath, 'utf8'))
const { name, version } = coreManifest
if (!name || !version) throw new Error('[release-calc-core] src/coconut-core/package.json 缺少 name/version')

const outDir = resolve(root, 'dist/calc-core')
const repo = 'https://github.com/d4rkOfficial/wuwa-afyg-tool'

/** 1) 清空产物目录：避免上一版遗留的 d.ts / tarball 混进包 */
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

/** 2) JS：单文件 ESM */
execFileSync(process.execPath, [resolve(root, 'scripts/build-calc-lib.mjs')], { stdio: 'inherit' })

/** 3) 类型：tsc 直接出 d.ts 到产物目录 */
const tsc = resolve(root, 'node_modules/typescript/bin/tsc')
if (!existsSync(tsc)) throw new Error('[release-calc-core] 找不到 typescript，请先 pnpm install')
execFileSync(process.execPath, [tsc, '-p', resolve(root, 'tsconfig.core.json')], { stdio: 'inherit' })

/**
 * 4) 类型说明符补扩展名：`from './x'` → `from './x.js'`
 *
 * 相对说明符对 `moduleResolution: bundler` 已够用，但 node16/nodenext 的消费方要求显式扩展名。
 * 补 `.js` 对两种解析模式都成立（`.js` 会映射到同目录的 `.d.ts`）。
 */
const dtsFiles = readdirSync(outDir).filter((file) => file.endsWith('.d.ts'))
for (const file of dtsFiles) {
    const path = resolve(outDir, file)
    const source = readFileSync(path, 'utf8')
    const next = source.replace(/(from\s+'\.\/[^']+?)(?<!\.js)'/g, "$1.js'")
    if (next !== source) writeFileSync(path, next, 'utf8')
}

/** 5) 包元数据：入口 / 类型 / 许可 / Node 版本 */
writeFileSync(
    resolve(outDir, 'package.json'),
    JSON.stringify(
        {
            name,
            version,
            description: '通用伤害计算核：纯函数、零运行时依赖，面板 / 乘区 / 公式全部靠注册',
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
            files: ['index.js', '*.d.ts', 'README.md', 'LICENSE'],
            sideEffects: false,
            engines: { node: '>=20' },
            repository: { type: 'git', url: `git+${repo}.git`, directory: 'src/coconut-core' },
            homepage: `${repo}/blob/main/docs/coconut-core.md`,
            keywords: ['wuwa', 'wuthering-waves', 'damage', 'calculator', 'simulator', 'public-domain'],
            license: 'Unlicense',
            publishConfig: { access: 'public' }
        },
        null,
        4
    ) + '\n',
    'utf8'
)

/** 6) README / LICENSE：随包分发（本引擎自愿放弃版权，与工具箱本体的 MIT 分开） */
copyFileSync(resolve(root, 'docs/coconut-core.md'), resolve(outDir, 'README.md'))
copyFileSync(resolve(root, 'src/coconut-core/LICENSE'), resolve(outDir, 'LICENSE'))

/** 7) 打 tarball：用 npm pack（会按 `files` 裁剪，并生成 npm 期望的 `package/` 前缀） */
// `--pack-destination ..` 不用绝对路径：cmd.exe 下绝对路径的引号会被拆坏（实测）
const packCmd = 'npm pack --json --pack-destination ..'
const [shellBin, shellArgs] =
    process.platform === 'win32'
        ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', packCmd]]
        : ['/bin/sh', ['-c', packCmd]]
const packOutput = execFileSync(shellBin, shellArgs, { cwd: outDir, encoding: 'utf8' })
const [packed] = JSON.parse(packOutput)
const tarball = resolve(outDir, '..', packed.filename)

/** 8) 自检：关键文件必须真的在包里（防止 `files` 写错却「打包成功」） */
const paths = new Set(packed.files.map((entry) => entry.path))
const required = ['package.json', 'index.js', 'index.d.ts', 'README.md', 'LICENSE', ...dtsFiles]
const missing = required.filter((file) => !paths.has(file))
const extra = [...paths].filter((file) => !required.includes(file))
if (missing.length > 0) throw new Error(`[release-calc-core] 包内缺少：${missing.join(', ')}`)
if (extra.length > 0) throw new Error(`[release-calc-core] 包内多余文件：${extra.join(', ')}`)

const sizeKb = (packed.size / 1024).toFixed(1)
console.log(`\n[release-calc-core] OK：${name}@${version}`)
console.log(`   产物目录 dist/calc-core/（${packed.files.length} 个文件）`)
console.log(`     ${packed.files.map((entry) => entry.path).join('\n     ')}`)
console.log(`   tarball  ${tarball}（${sizeKb} KB，解包后 ${(packed.unpackedSize / 1024).toFixed(1)} KB）`)

/** 9) 打印手动发布命令（本项目不为内核建发布流水线） */
console.log(`\n── 手动发布到 GitHub Release（一次命令）`)
console.log(`gh release create core-v${version} "${tarball}" \\`)
console.log(`  --title "coconut-core ${version}" --notes "计算核 ${version}：纯函数、零依赖、语料靠注册"`)
console.log(`\n── 消费方安装`)
console.log(`npm i ${repo}/releases/download/core-v${version}/${packed.filename}`)
