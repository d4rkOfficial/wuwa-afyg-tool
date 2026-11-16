/**
 * @desc 把计算核打成**可分发的独立包**：`dist/coconut-core/` → `dist/coconut-core-<version>.tgz`。
 *
 * 为什么不是 `npm publish` / GitHub Release：
 * 本仓库的 release 流水线绑了 app 的产物（PWA / Tauri / 静态包），计算核是纯 JS 库；
 * 强行混进去会让「一次 release」同时承载两种语义。这里只产出一个 npm 形态的 tarball
 * （带 package.json + 入口 + 类型源码），消费者可以 `npm i ./coconut-core-x.y.z.tgz`
 * 或直接解压引用；等真的需要发版时，把 tarball 挂到任意发布渠道即可。
 *
 * 用法：node scripts/release-calc-core.mjs
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
const outDir = resolve(root, 'dist/calc-core')

/** 1) 构建（复用库构建脚本） */
execFileSync(process.execPath, [resolve(root, 'scripts/build-calc-lib.mjs')], { stdio: 'inherit' })

/** 2) 补包元数据：入口、类型（源码即类型）、说明 */
writeFileSync(
    resolve(outDir, 'package.json'),
    JSON.stringify(
        {
            name: 'coconut-core',
            version,
            description: '鸣潮伤害计算核（纯函数，无框架依赖）',
            type: 'module',
            main: './index.js',
            module: './index.js',
            types: './index.d.ts',
            files: ['index.js', 'index.d.ts', 'README.md'],
            sideEffects: false,
            license: 'MIT'
        },
        null,
        4
    ) + '\n',
    'utf8'
)

copyFileSync(resolve(root, 'docs/calc-core.md'), resolve(outDir, 'README.md'))

/** 3) 类型：把内核公开出口的类型源码一并带上（不生成 d.ts，避免写出 $coconut 别名） */
const srcDir = resolve(outDir, 'types')
mkdirSync(srcDir, { recursive: true })
for (const name of ['index.ts', 'coconut-core.ts', 'general-table.ts', 'result.ts']) {
    copyFileSync(resolve(root, 'src/coconut-core', name), resolve(srcDir, name))
}

/** 4) tarball（Windows 10+ 自带 bsdtar） */
const tarball = resolve(root, `dist/coconut-core-${version}.tgz`)
execFileSync('tar', ['-czf', tarball, '-C', resolve(root, 'dist'), 'calc-core'], { stdio: 'inherit' })

console.log(`[release-calc-core] 产物：dist/coconut-core/index.js + dist/coconut-core-${version}.tgz`)
