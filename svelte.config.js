import vercelAdapter from '@sveltejs/adapter-vercel'
import cloudflareAdapter from '@sveltejs/adapter-cloudflare'

const deployTarget = process.env.DEPLOY_TARGET || 'vercel'

/** @type {import('@sveltejs/kit').Config} */
const config = {
    compilerOptions: {
        runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
    },
    kit: {
        adapter: deployTarget === 'cloudflare' ? cloudflareAdapter() : vercelAdapter(),
        /**
         * @desc 别名：`$lib` 是 SvelteKit 自带的（→ `src/lib`），这里补一个 `$src`（→ `src`）。
         *
         * 为什么需要：测试统一放 `test/` 下并镜像源码路径（`src/routes/a/+server.ts` →
         * `test/src/routes/a/xxx.test.ts`），测试要 import 路由模块时走相对路径会变成 7 层
         * `../../../../../../`（AGENTS §4 明确不允许多级相对导入）。`kit.alias` 会同时喂给
         * Vite 解析与 `.svelte-kit/tsconfig.json` 的 paths，故 svelte-check 也认；
         * node:test 侧见 `test/preload.mjs` 的 aliasMap（两处必须一起改）。
         */
        alias: { $src: 'src' },
        prerender: {
            // `/shell-page` 是移动端横屏壳页：`src/routes/shell-page/+server.ts` 自己声明了
            // `export const prerender = true`（它必须是静态页），但**没有任何页面链接指向它**
            // —— 跳转是 `src/app.html` 里的运行期脚本做的，爬虫看不见。于是从 `/` 爬不到它，
            // SvelteKit 会以「marked as prerenderable, but were not prerendered」报错并使
            // `pnpm run build` 退出码 1（构建产物其实已经生成，但会卡住任何部署流水线）。
            // 故显式把它列进 entries：保住「预渲染」的意图，而不是用
            // `handleUnseenRoutes: 'ignore'` 把这类不一致静默掉。
            entries: ['/', '/shell-page']
        }
    }
}

export default config
