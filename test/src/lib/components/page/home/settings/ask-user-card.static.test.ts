// 题号栏的静态契约：overflow-x-auto 会把纵向也裁掉，选中描边（box-shadow 外扩 1px）必须留出 padding
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const CARD = 'src/lib/components/page/home/settings/ask-user-card.svelte'

test('题号滚动容器留出纵向 padding，避免裁掉选中题号的描边', () => {
    const source = readFileSync(CARD, 'utf8')
    // CSS 的 overflow-x: auto 会把 overflow-y 计算成 auto，故 1px 外扩的 box-shadow 会被裁掉
    assert.match(source, /overflow-x-auto p-1 -m-1/, '题号滚动容器需要有 p-1（配 -m-1 抵消布局高度）')
})
