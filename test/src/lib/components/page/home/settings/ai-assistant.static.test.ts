// 助手界面的静态契约：这条是实测崩过的硬错误（each_key_duplicate 会让整个界面抛异常）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 源码断言一律用**仓库根相对路径**（cwd 恒为仓库根），不要用 import.meta.url 取旁边
const ASSISTANT = 'src/lib/components/page/home/settings/ai-assistant.svelte'

test('工具时间线的 each key 不能是工具名（同一工具一次回合内可被调用多次）', () => {
    const source = readFileSync(ASSISTANT, 'utf8')
    // 反例：`{#each m.tools ?? [] as t (t.name)}` —— run_js 连调两轮、或一轮内并行两个同名工具
    // 都会产生重复 key，Svelte 抛 each_key_duplicate 并让界面整个挂掉（实测踩过）
    assert.equal(/as t \(t\.name\)/.test(source), false, '工具时间线的 key 必须唯一，请改用索引')
    assert.equal(/as t, \w+ \(\w+\)/.test(source), true, '应当改成以索引作 key')
})
