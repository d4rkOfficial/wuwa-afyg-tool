// ── `ui/button` 的 `bare` 档契约 ──────────────────────────────────────────────
// 动机（T5 实测）：`ui/button` 自带一整套**状态层**样式（focus-visible / disabled /
// active:brightness），而项目里有 10 处弹窗 footer 按钮**原本没有任何自定义状态样式**。
// 直接换过去会凭空多出键盘焦点轮廓、禁用态变暗与按下提亮 —— 属可见行为变化。
// `bare` 就是为这类接线准备的「关掉状态层」开关。
//
// 本测试用真实 `svelte/compiler` SSR 渲染组件，断言：
//   ① 默认档（不含 bare）**必须仍然带**那一整套状态层（防有人误把状态层删了）；
//   ② bare 档**必须一个状态层类都不带**；
//   ③ bare 档必须补 `font-normal` 抵消基类 `font-medium` —— Tailwind preflight 对 button
//      设 `font: inherit`（字重 400），而原生按钮没有 `font-medium`，不抵消就会出现
//      「字重 500 vs 400」的真实视觉差。两者同为 font-weight 工具类，靠产物串序定胜负，
//      已实测 `.font-medium`(@4538) 在 `.font-normal`(@4652) 之前 → 后者胜出。
//   ④ 尺寸档是同位置二选一（compact 不得同时出现 `py-1.5`/`text-sm`）。
//   ⑤ `bare` 档**既不发射前景色兜底 `--theme-btn-text`，也不发射底色兜底 `--theme-btn-bg`**：
//      两者在预设里都是「为按钮底色配的对比色系」，昼夜恰好与 `modal.*` 对调
//      （btn.textColor dark #18181b / light #ffffff，btn.backgroundImage dark 浅渐变 / light 深渐变），
//      而 `bare` 的语义是「长得像原生按钮、外观全由调用方给」——原生 `<button>` 被 preflight
//      置为透明底 + 继承色，留兜底就会把调用方 class 压掉，实测症状即 AI 助手悬浮窗头部
//      两个按钮「昼夜与主题相反的实心块」。
import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'
import { compile } from 'svelte/compiler'
import { writeFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * @desc 把组件编译成 SSR 模块再 import。
 *
 * ⚠️ **不要把临时文件写到专用子目录并在结束后删掉它**（本项目实测踩过，代价是整组用例静默消失）：
 * 早期版本写到 `.tmp/button-contract-test/` 并在 `after()` 里 `rmSync` 清理；但 sandbox 删掉该目录后
 * 会把它列入**永久拒绝**名单 —— 下一次运行 `mkdirSync` 同一路径直接 EPERM，整个测试文件在 import
 * 阶段抛错、**用例一个都不注册**（症状是 `pnpm test` 总数莫名变少而没有任何失败输出，极易漏过）。
 * 现在改为：写到 `.tmp/` 下的**单文件**（不建子目录、不删），每次覆盖 —— 无目录生命周期问题。
 *
 * 注：不能用 `mem:` 这类自定义 scheme 走 module hook —— Node 会以 `Invalid URL` 拒绝。
 */
const TMP_MJS = '.tmp/button-contract-compiled.mjs'
const STUB_MJS = '.tmp/button-contract-iconify-stub.mjs'
// `@iconify/svelte` 在纯 node ESM 下解析不了（package.json 无 exports.main）→ 换占位实现。
// 被断言的路径都是 `variant="text"`（不渲染图标分支），故不影响被测产物。
writeFileSync(STUB_MJS, `export default function Icon($$r){$$r.push('<svg></svg>')}`, 'utf8')
writeFileSync(
    TMP_MJS,
    compile(readFileSync('src/lib/components/ui/button.svelte', 'utf8'), {
        generate: 'server',
        runes: true,
        filename: 'button.svelte',
        dev: false
    }).js.code.replace(/from\s*'@iconify\/svelte'/g, "from './button-contract-iconify-stub.mjs'"),
    'utf8'
)

const { render } = await import('svelte/server')
const buttonMod = (await import(pathToFileURL(TMP_MJS).href)).default

/** @desc 渲染并取回 `<button>` 的 class token 列表 */
const tokensOf = (props: Record<string, unknown>): string[] => {
    const html = render(buttonMod, { props: { variant: 'text', label: '确认', ...props } }).body
    const m = /class="([^"]*)"/.exec(html)
    return (m?.[1] ?? '').split(/\s+/).filter(Boolean)
}

/** @desc 渲染并取回 `<button>` 的 style 属性（底色/前景色兜底都写在这里，不在 class 上） */
const styleOf = (props: Record<string, unknown>): string => {
    const html = render(buttonMod, { props: { variant: 'text', label: '确认', ...props } }).body
    return /style="([^"]*)"/.exec(html)?.[1] ?? ''
}

/** @desc 状态层类名特征：focus-visible: / disabled: / active: 三个变体前缀 */
const stateLayer = (tokens: string[]) => tokens.filter((t) => /^(focus-visible|disabled|active):/.test(t))

describe('ui/button 的 bare 档契约', () => {
    it('默认档仍带完整状态层（防误删）', () => {
        const t = tokensOf({})
        const st = stateLayer(t)
        assert.ok(st.length >= 6, `默认档应带状态层，实得 ${st.length} 个：${st.join(' ')}`)
        assert.ok(
            st.some((x) => x.startsWith('focus-visible:outline')),
            '应有 focus-visible 轮廓'
        )
        assert.ok(st.includes('disabled:opacity-40'), '应有禁用态变暗')
        assert.ok(st.includes('active:brightness-110'), '应有按下提亮')
    })

    it('bare 档一个状态层类都不带', () => {
        const t = tokensOf({ bare: true })
        const st = stateLayer(t)
        assert.deepEqual(st, [], `bare 档不应带任何状态层类，实得：${st.join(' ')}`)
    })

    it('bare + keepDisabled 只保留禁用态（focus/active 仍关掉）', () => {
        const t = tokensOf({ bare: true, keepDisabled: true })
        const st = stateLayer(t)
        assert.ok(
            st.includes('disabled:opacity-40') && st.includes('disabled:pointer-events-none'),
            `keepDisabled 应保留禁用态，实得：${st.join(' ')}`
        )
        assert.ok(!st.some((x) => x.startsWith('focus-visible:')), 'focus-visible 仍应被关掉')
        assert.ok(!st.some((x) => x === 'active:brightness-110'), '按下提亮仍应被关掉')
        // 单独传 keepDisabled（不带 bare）不应改变默认档
        assert.deepEqual(stateLayer(tokensOf({ keepDisabled: true })), stateLayer(tokensOf({})))
    })

    it('bare 档补 font-normal 抵消基类 font-medium', () => {
        const bare = tokensOf({ bare: true })
        assert.ok(bare.includes('font-normal'), 'bare 档应补 font-normal')
        assert.ok(bare.includes('font-medium'), '基类 font-medium 仍在（靠产物串序被 font-normal 压过）')
        // 默认档不得出现 font-normal（否则会削弱默认外观）
        assert.ok(!tokensOf({}).includes('font-normal'), '默认档不应出现 font-normal')
    })

    it('size="none" 不发射任何尺寸/内边距（避免同权重覆盖静默失效）', () => {
        const t = tokensOf({ size: 'none', bare: true })
        for (const bad of ['px-3', 'py-1.5', 'text-sm', 'h-7', 'text-xs']) {
            assert.ok(!t.includes(bad), `size="none" 不应发射 ${bad}，实得：${t.join(' ')}`)
        }
        // 显式 pad 档替换内边距（不叠加）；icon + p-1 不得同时出现 p-1.5
        const t2 = tokensOf({ size: 'none', pad: 'p-1', bare: true })
        assert.deepEqual(
            t2.filter((x) => /^(p|px|py)-/.test(x)),
            ['p-1'],
            `显式 pad 应只发射该档，实得：${t2.join(' ')}`
        )
        // ⚠️ `pad="none"` **不**抑制 `compact` 档自带的 `px-3`（它只负责「不加额外内边距」）；
        //    要连 `px-3` 一起去掉必须用 `size="none"` + 调用方自带 `h-7`。这条差异是实测踩出来的，
        //    故在此显式锁定，避免后人误以为 pad="none" 足够。
        const t3 = tokensOf({ compact: true, pad: 'none', bare: true })
        assert.ok(t3.includes('h-7') && t3.includes('px-3'), 'compact + pad="none" 仍保留 h-7/px-3')
    })

    it('尺寸档是同位置二选一（compact 不叠加默认档）', () => {
        const def = tokensOf({})
        const cmp = tokensOf({ compact: true, bare: true })
        assert.ok(def.includes('py-1.5') && def.includes('text-sm'), '默认档应为 py-1.5 + text-sm')
        assert.ok(cmp.includes('h-7') && cmp.includes('text-xs'), 'compact 档应为 h-7 + text-xs')
        assert.ok(!cmp.includes('py-1.5'), 'compact 档不得同时出现 py-1.5')
        assert.ok(!cmp.includes('text-sm'), 'compact 档不得同时出现 text-sm')
    })

    it('内边距档：auto 按变体判定，显式档替换基类（不叠加）', () => {
        const padOf = (t: string[]) => t.filter((x) => /^p-(\d|0\.5|1\.5|2)$/.test(x))
        // auto：icon → p-1.5；非 icon → 不补
        assert.deepEqual(padOf(tokensOf({ variant: 'icon' })), ['p-1.5'])
        assert.deepEqual(padOf(tokensOf({})), [])
        // 显式档：只出现被指定的那一个（关键：icon + p-1 不得同时出现 p-1.5）
        for (const p of ['p-0.5', 'p-1', 'p-1.5', 'p-2'] as const) {
            assert.deepEqual(padOf(tokensOf({ variant: 'icon', pad: p })), [p], `pad=${p} 应只发射该档`)
            assert.deepEqual(padOf(tokensOf({ pad: p })), [p], `pad=${p}（非 icon）应只发射该档`)
        }
        // none：不发射任何内边距
        assert.deepEqual(padOf(tokensOf({ variant: 'icon', pad: 'none' })), [])
    })

    /**
     * 前景色兜底：`--theme-btn-text` 是主题里**为按钮底色配的对比色**（预设 dark #18181b / light #ffffff），
     * 与 `modal.textColor`（dark #e4e4e7 / light #1e293b）昼夜恰好对调。
     * `bare` 语义是「长得像原生按钮、样式全由调用方给」，此时该兜底色作为**同权重工具类**会压掉
     * 调用方 class 里的前景色（Tailwind 按字面串序发射，调用方斗不过）——实测症状就是
     * AI 助手悬浮窗头部两个 `ui/Button` 的明暗观感与左侧那个原生 `<button>` 正好相反。
     * 故 `bare` 档**刻意不发射**它；AST 实测全项目 70 个 `ui/Button` 调用点（全是 `bare`）里 56 个未显式
     * 传 `textColor`，但**没有一个**缺少自己的前景色 class，即该兜底色在该档上从无实际消费者。
     */
    it('前景色兜底：默认档发射，bare 档刻意不发射（否则压掉调用方意图）', () => {
        assert.ok(tokensOf({}).includes('text-(--theme-btn-text)'), '默认档应保留 text-(--theme-btn-text) 兜底')
        const bare = tokensOf({ bare: true })
        assert.ok(
            !bare.includes('text-(--theme-btn-text)'),
            `bare 档不得发射 text-(--theme-btn-text)（会昼夜对调地压掉调用方 class），实得：${bare.join(' ')}`
        )
        // 状态层里的 focus-visible 前景色也属同一组，bare 档一并关掉
        assert.ok(
            !bare.some((t) => t.includes('theme-btn-text')),
            `bare 档不该出现任何 theme-btn-text 类：${bare.join(' ')}`
        )
        // 调用方自带的前景色 class 必须原样保留（基类不得吞掉）
        const withClass = tokensOf({ bare: true, class: 'text-(--theme-modal-text)/40' })
        assert.ok(withClass.includes('text-(--theme-modal-text)/40'), '调用方前景色 class 必须保留')
    })

    /**
     * 底色兜底：`--theme-btn-bg` 在预设里是**与主题昼夜相反**的按钮渐变
     * （dark `linear-gradient(135deg,#e4e4e7,#a1a1aa)` / light `linear-gradient(135deg,#18181b,#3f3f46)`），
     * 而 `bare` 语义是「长得像原生按钮」——原生 `<button>` 的底色被 Tailwind preflight 置为透明。
     * 留兜底会使「自带暗淡前景色 class 的图标钮」变成与主题相反的实心块，并把它 class 里的
     * `hover:bg-*` 盖在渐变之下（实测：AI 助手悬浮窗头部两个按钮昼夜反色）。
     */
    it('底色兜底：默认档发射，bare 档不发射；显式 backgroundImage / widget 仍照传', () => {
        assert.match(styleOf({}), /background:\s*var\(--theme-btn-bg\)/, '默认档应回落 --theme-btn-bg')
        const bareStyle = styleOf({ bare: true })
        assert.doesNotMatch(bareStyle, /theme-btn-bg/, `bare 档不得回落按钮底色，实得：${bareStyle}`)
        assert.equal(bareStyle, '', 'bare 且无显式配色时不该留下任何内联样式')
        // 调用方显式给底色时原样透传（bare 与默认档都一样）
        assert.match(styleOf({ bare: true, backgroundImage: 'transparent' }), /background:\s*transparent/)
        assert.match(styleOf({ backgroundImage: 'var(--theme-accent-bg)' }), /background:\s*var\(--theme-accent-bg\)/)
        // widget 模式本来就不发射（底色交给「外观主题-背景质感-小部件」）
        assert.doesNotMatch(styleOf({ surface: 'widget' }), /theme-btn-bg/)
        // textColor 仍逐字透传（不给就什么都不写，交给 class 定色）
        assert.match(styleOf({ bare: true, textColor: 'var(--x)' }), /color:\s*var\(--x\)/)
        assert.doesNotMatch(bareStyle, /color:/, 'bare 且未传 textColor 时不得写死前景色')
    })
})
