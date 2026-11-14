// fast-calc 溯源弹窗的「基础面板来源」回归（issue #16）：
// 弹窗第一行长期只有 白值/绿值/面板 汇总，`trace.baseParts`（角色白值 + 武器 + 声骸固定/百分比 + Buff…）
// 明明已经算好却从来没被渲染，导致「来源合计 ≈ 面板」无从核对。
// 这类「把已有数据丢掉」的缺口静态检查器看不见（svelte-check / eslint 都不会报），故用源码契约锁住：
//   ① 基础行必须渲染 `trace.baseParts`；
//   ② 基础行与各乘区共用同一个 `partsTable` snippet（基础行两列 + 贡献列，乘区只有两列）；
//   ③ 基础行底部给「合计 / 面板」对照，能一眼看出漏项；
//   ④ 角色名 / 敌怪配置 / 时段汇总三处都是 `<h2>` 且真的写了 h2 样式（Tailwind preflight 会把 h2 归零）。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync('src/routes/fast-calc/+page.svelte', 'utf8')

/** @desc 去掉换行与多余空白，避免断言被格式化细节绊倒 */
const flat = SOURCE.replace(/\s+/g, ' ')

describe('fast-calc 溯源弹窗：基础面板来源（baseParts）', () => {
    it('基础面板那一行渲染 trace.baseParts', () => {
        assert.match(flat, /\{@render partsTable\(trace\.baseParts,/)
    })

    it('基础行的合计值用 sumContribution 汇总、并带上 panel 对照', () => {
        assert.match(flat, /value: sumContribution\(trace\.baseParts\)/)
        assert.match(flat, /panel: trace\.totalStat/)
    })

    it('各乘区来源复用同一个 partsTable snippet（不各自内联一张表）', () => {
        assert.match(flat, /\{#snippet partsTable\(parts: TracePart\[\], total\?: \{[^}]*\}\)/)
        assert.match(flat, /\{@render partsTable\(seg\.parts\)\}/)
        // 乘区行里不应再出现内联的 part 循环（说明已收敛到 snippet）
        assert.doesNotMatch(flat, /\{#each seg\.parts as part/)
    })

    it('snippet 是两列（来源·词条 / 数值），「贡献」列只在基础面板（传了 total）时才出', () => {
        const snippet = flat.match(/\{#snippet partsTable\([\s\S]*?\{\/snippet\}/)?.[0] ?? ''
        assert.ok(snippet, '没找到 partsTable snippet')
        for (const header of ['来源 · 词条', '数值']) {
            assert.ok(snippet.includes(`>${header}<`), `snippet 缺少列头「${header}」`)
        }
        // 贡献列 + 合计行都必须挂在 `{#if total}` 上：乘区（攻/生/防以外的区）不该出现贡献列
        assert.match(snippet, /\{#if total\}<th class="num">贡献<\/th>\{\/if\}/)
        assert.match(snippet, /\{#if total\}[\s\S]*?<th>合计<\/th>/)
        assert.match(snippet, /\{#each parts as part, partIndex \(partIndex\)\}/)
        assert.match(snippet, /formatPartValue\(part\)/)
    })
})

describe('fast-calc 三个 h2 级标题', () => {
    it('角色名 / 敌怪配置 / 时段汇总都用 <h2>', () => {
        assert.match(flat, /<h2>\{slot\.character \|\| `角色 \$\{charIndex \+ 1\}`\}<\/h2>/)
        assert.match(flat, /<h2>敌怪配置<\/h2>/)
        assert.match(flat, /<h2> \{segment\.time\} · 总伤/)
        // 页面里不该再混入别的标题层级（h1/h3 都清掉，避免层级跳级）
        assert.doesNotMatch(flat, /<h1[\s>]/)
        assert.doesNotMatch(flat, /<h3[\s>]/)
    })

    it('真的给 h2 写了样式（preflight 会把标题归零成正文样式）', () => {
        const styleBlock = SOURCE.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? ''
        assert.match(styleBlock, /\.fast-calc h2 \{[\s\S]*?font-size: [\d.]+px/)
        assert.match(styleBlock, /\.fast-calc h2 \{[\s\S]*?font-weight: 700/)
    })
})

describe('fast-calc 纯白独立页', () => {
    it('html 也要用白底（全站给 html 设了深色主题底，露出时会看到黑边）', () => {
        const styleBlock = SOURCE.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? ''
        assert.match(styleBlock, /:global\(html:root\) \{[\s\S]*?background: #fff/)
        assert.match(styleBlock, /:global\(html:root\) \{[\s\S]*?color-scheme: light/)
    })
})
