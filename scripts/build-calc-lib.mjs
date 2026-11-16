// 计算核的**导出库构建**：把 `src/lib/calc/core/index.ts` 打成单文件 ESM，零外部依赖。
//
// 用法：node scripts/build-calc-lib.mjs
//
// 产物：`dist/calc-core/index.js`（ESM；Node 直接 `import` 即可用）。
// 类型：TS 消费方直接引用 `src/lib/calc/core/index.ts`（源码即类型），不额外生成 d.ts ——
// 生成 d.ts 会把 `$lib/*` 别名写进产物，反而对消费方不可用。
//
// 用 vite 的 JS API 而不是新引一个打包器：`vite` 已是本仓依赖，且它自带 `resolve.alias`，
// 不用为 `$lib` / `$src` 写第二套解析。
import { build } from 'vite'
import { resolve } from 'node:path'

const root = process.cwd()

await build({
    configFile: false,
    logLevel: 'warn',
    resolve: {
        alias: {
            $lib: resolve(root, 'src/lib'),
            $src: resolve(root, 'src')
        }
    },
    build: {
        lib: {
            entry: resolve(root, 'src/lib/calc/core/index.ts'),
            formats: ['es'],
            fileName: () => 'index.js'
        },
        outDir: 'dist/calc-core',
        emptyOutDir: true,
        // Node 侧消费：ES2022 足够，且避免打包器注入浏览器 shim
        target: 'node20',
        minify: false,
        rollupOptions: { external: [] }
    }
})

console.log('[build-calc-lib] 产物：dist/calc-core/index.js')
