// composer 工具条的宽度契约：小卡片 / 窄半屏时不能把发送按钮挤出边界
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const COMPOSER = 'src/lib/components/page/home/settings/ai-composer.svelte'

test('composer 用容器查询而不是视口宽度收起模型名', () => {
    const source = readFileSync(COMPOSER, 'utf8')
    assert.match(source, /class="@container /, '根节点需要 @container 才能按卡片实际宽度判断')
    assert.match(source, /@max-\[440px\]:hidden/, '窄卡片应隐藏模型名，给发送按钮留位置')
})
