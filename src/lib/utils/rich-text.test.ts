// ── 富文本解析回归测试（node:test） ──────────────────────────────────────
// 症状（用户报告）：琳奈「普攻·灵感碰撞」三级判定行的正文丢了一行，高亮还串到下一节标题上。
// 根因：上游正文里的 `<` 也会当数学符号用（`当前【流光】<50%`），旧实现按「`<` 一路吃到下一个 `>`」
// 匹配标签，把 `<50%\n普攻·灵感碰撞·2级：50% ≤当前<color=Highlight>` 当成一个名为 `50` 的标签整段吃掉，
// 紧跟的 `</color>` / `<size=10></size>` 随之错位。
// 标签词法因此收紧为「`<` + 可选 `/` + **字母开头**的标签名」；全量扫描 nanoka ww/3.7 的
// 角色 / 武器 / 声骸 / 套装文案后确认：裸 `<` 只此两处，都在琳奈这条 desc 里。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { richTextToHtml, colorizeNumbers, extractKeywords } from './rich-text'

/** @desc 琳奈（1509）常态攻击「普攻·灵感碰撞」1~3 级判定行，逐字取自 nanoka ww/3.7 原文 */
const LINNE_LEVELS = `<color=Highlight>【<te href=150906>流光</te>】</color>百分比造成<color=Light>衍射伤害</color>：
普攻·灵感碰撞·1级：当前<color=Highlight>【<te href=150906>流光</te>】</color><50%
普攻·灵感碰撞·2级：50% ≤当前<color=Highlight>【<te href=150906>流光</te>】</color><100%
普攻·灵感碰撞·3级：当前<color=Highlight>【<te href=150906>流光</te>】</color>=100%
<size=10></size>
<size=40><color=Title>绮彩巡游·普攻</color></size>绮彩巡游状态期间，普攻替换为绮彩巡游·普攻。`

/** @desc 渲染结果的可见文本：去标签、`<br/>` 还原成换行、反转义（`&lt;` → `<`） */
const visibleText = (html: string): string =>
    html
        .replace(/<br\/>/g, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&')

const spanBalance = (html: string): number =>
    (html.match(/<span/g) ?? []).length - (html.match(/<\/span>/g) ?? []).length

describe('富文本标签词法', () => {
    it('正文里的数学符号 `<` 不是标签：琳奈三级判定行逐行保留', () => {
        const html = richTextToHtml(LINNE_LEVELS)
        const lines = visibleText(html).split('\n')
        assert.equal(lines[1], '普攻·灵感碰撞·1级：当前【流光】<50%')
        assert.equal(lines[2], '普攻·灵感碰撞·2级：50% ≤当前【流光】<100%')
        assert.equal(lines[3], '普攻·灵感碰撞·3级：当前【流光】=100%')
    })

    it('被误吞的闭合标签不再错位：span 开闭平衡，下一节标题不继承高亮', () => {
        const html = richTextToHtml(LINNE_LEVELS)
        assert.equal(spanBalance(html), 0)
        assert.ok(html.includes('<span class="rich-size-xs"></span>'), '三级判定行后的空行标签必须照常渲染')
        assert.ok(
            html.includes('<span class="rich-size-xl"><span class="rich-color-title">绮彩巡游·普攻</span></span>'),
            '下一节标题必须是完整的「大标题」结构，而不是被高亮包住的残片'
        )
    })

    it('四类标签照常开闭（收紧词法不影响正常标签）', () => {
        assert.equal(
            richTextToHtml(
                '<size=40><color=Title>重击</color></size><highlight>重点</highlight><te href=7>共鸣技能</te>'
            ),
            '<span class="rich-size-xl"><span class="rich-color-title">重击</span></span>' +
                '<span class="rich-highlight">重点</span>' +
                '<span class="rich-te" data-id="7">共鸣技能</span>'
        )
    })

    it('未知标签只丢标签、保留正文', () => {
        assert.equal(richTextToHtml('a<foo>b</foo>c'), 'abc')
    })

    it('裸 `<` / `>` / `&` 一律转义，换行转 `<br/>`', () => {
        assert.equal(richTextToHtml('1<2 且 3>2 & 4\n5'), '1&lt;2 且 3&gt;2 &amp; 4<br/>5')
    })

    it('数字着色与转义后的 `<` 正常组合（composition 不互相破坏）', () => {
        assert.equal(colorizeNumbers(richTextToHtml('当前<50%')), '当前&lt;<span class="rich-num">50%</span>')
    })
})

describe('内嵌词条抽取', () => {
    it('剥掉 te 后只剩方括号的高亮不算词条（`【<te>溢彩</te>】` 的常见写法）', () => {
        assert.deepEqual(
            extractKeywords(
                '<color=Highlight>【<te href=150905>溢彩</te>】</color>已满，且<color=Highlight>【热压弹】</color>上限{0}发'
            ),
            [
                { id: '150905', text: '溢彩' },
                { id: null, text: '【热压弹】' }
            ]
        )
    })

    it('真正的高亮词条照常抽出，且按名字去重', () => {
        assert.deepEqual(extractKeywords('<color=Highlight>普攻</color>与<color=Highlight>普攻</color>'), [
            { id: null, text: '普攻' }
        ])
    })
})
