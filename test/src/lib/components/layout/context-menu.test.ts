// 右键菜单图标契约：按 item.icon 通用渲染，避免新增菜单项（如「移入文件夹」）再被白名单漏掉。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const CONTEXT_MENU = 'src/lib/components/layout/context-menu.svelte'

test('右键菜单按 item.icon 渲染任意图标，不需要图标白名单', () => {
    const source = readFileSync(CONTEXT_MENU, 'utf8')
    assert.match(source, /\{#if item\.icon\}[\s\S]*?<Icon icon=\{item\.icon\}/)
    assert.doesNotMatch(source, /item\.icon === 'mdi:/)
})
