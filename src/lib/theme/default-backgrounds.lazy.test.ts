// 默认背景图的**按需加载契约**单测（node:test，纯源码静态检查，不联网）
//
// 为什么需要一条「读源码」的测试：这条约束的失败模式在代码层面完全隐形，只有看构建产物才发现 ——
// `src/lib/theme/default-backgrounds.ts` 里是两个合计约 280KB 的 base64 webp 常量，
// 而全项目只有 `applyFirstRunAppearance()` 用它们、该函数又只在**首次进入**时被调用。
// 一旦 theme store 用**顶层静态** import 引它，这个模块就进入模块图，被根 layout（nodes/0）
// 静态引用而落进**首屏关键路径**：每个用户、每次进入都下载 282KB（含 service worker 预缓存清单），
// 而它只在首次进入才用得上。实测过这个回归：静态 import 时产物里该 chunk 被 nodes/0 静态 import
// 且出现在 index.html 的 modulepreload 列表；改成函数内动态 import 后二者都消失。
//
// 因为无法在单测里跑完整构建，这里把「不能出现顶层静态 import」这条钉死为源码断言。
// 通过 scripts/test/preload.mjs 解析 TS 与相对导入。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const THEME_STORE = readFileSync(join(HERE, 'theme.svelte.ts'), 'utf8')

describe('内置默认背景图必须按需加载（防 282KB 落回首屏）', () => {
    it('theme store 不得顶层静态 import ./default-backgrounds', () => {
        // 匹配形如 `import ... from './default-backgrounds'` 的顶层静态 import（含 `import './x'`）
        const staticImport = /^\s*import\s[^\n]*?from\s*['"]\.\/default-backgrounds['"]/m
        const bareStaticImport = /^\s*import\s*['"]\.\/default-backgrounds['"]/m
        const hit = staticImport.exec(THEME_STORE) ?? bareStaticImport.exec(THEME_STORE)
        assert.equal(
            hit,
            null,
            `theme.svelte.ts 里出现了对 ./default-backgrounds 的顶层静态 import：\n  ${hit?.[0] ?? ''}\n` +
                '这会把 280KB base64 拉进首屏关键路径（nodes/0 静态 import → index.html modulepreload）。' +
                '请改成在 applyFirstRunAppearance() 内 `await import(...)`（该函数已是 async）。'
        )
    })

    it('applyFirstRunAppearance 内确实用了动态 import 取默认背景图', () => {
        const fnStart = THEME_STORE.indexOf('export async function applyFirstRunAppearance')
        assert.notEqual(fnStart, -1, 'applyFirstRunAppearance 应当仍是 async 函数（动态 import 需要它）')
        // 取到下一个顶层导出为止，作为函数体范围
        const rest = THEME_STORE.slice(fnStart)
        const nextTopLevel = rest.slice(1).search(/\nexport\s/)
        const body = nextTopLevel === -1 ? rest : rest.slice(0, nextTopLevel + 1)
        assert.match(
            body,
            /await\s+import\(\s*['"]\.\/default-backgrounds['"]\s*\)/,
            "applyFirstRunAppearance 内应出现 `await import('./default-backgrounds')`"
        )
        assert.match(body, /DEFAULT_BACKGROUND_DARK/, '仍应使用 DEFAULT_BACKGROUND_DARK')
        assert.match(body, /DEFAULT_BACKGROUND_LIGHT/, '仍应使用 DEFAULT_BACKGROUND_LIGHT')
    })

    it('default-backgrounds 仍是纯常量模块（无副作用 import，可安全拆分/懒载）', () => {
        const raw = readFileSync(join(HERE, 'default-backgrounds.ts'), 'utf8')
        const withoutComments = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        assert.doesNotMatch(
            withoutComments,
            /^\s*import\s/m,
            'default-backgrounds.ts 一旦引入其它模块就不再是叶子常量模块，懒加载分块会连带拉进别的代码'
        )
        assert.match(withoutComments, /export const DEFAULT_BACKGROUND_LIGHT\s*=\s*'data:image\//)
        assert.match(withoutComments, /export const DEFAULT_BACKGROUND_DARK\s*=\s*'data:image\//)
    })
})
