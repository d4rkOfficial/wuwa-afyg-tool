// 助手界面的静态契约：这条是实测崩过的硬错误（each_key_duplicate 会让整个界面抛异常）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 源码断言一律用**仓库根相对路径**（cwd 恒为仓库根），不要用 import.meta.url 取旁边
const ASSISTANT = 'src/lib/components/page/home/settings/ai-assistant.svelte'

test('工具时间线的 each key 不能是工具名（同一工具一次回合内可被调用多次）', () => {
    const source = readFileSync(ASSISTANT, 'utf8')
    // 反例：`{#each m.tools ?? [] as t (t.name)}` —— run_js 连调两轮、或一轮内并行两个同名工具
    // 都会产生重复 key，Svelte 抛 each_key_duplicate 并让整个界面挂掉（实测踩过）
    assert.equal(/as t \(t\.name\)/.test(source), false, '工具时间线的 key 必须唯一，请改用索引')
    assert.equal(/as act, actIdx \(actIdx\)/.test(source), true, '活动流应当以索引作 key')
})

test('展开态占视口 2/3；运行结果/报错默认收起且整行可点击切换', () => {
    const source = readFileSync(ASSISTANT, 'utf8')
    assert.match(source, /Math\.round\(\(winW \* 2\) \/ 3\)/, '展开态宽度应随视口 2/3 计算')
    assert.equal(source.includes('act.expanded !== false'), false, '运行结果/报错不能默认展开')
    assert.equal((source.match(/act\.expanded === true/g) ?? []).length, 2, '运行结果与运行报错都应默认收起')
    assert.equal((source.match(/aria-expanded=\{expanded\}/g) ?? []).length, 2, '两行都应暴露展开状态')
    assert.match(source, /act\.kind === 'runResult'[\s\S]*?onclick=\{\(\) => \(act\.expanded = !expanded\)\}/)
    assert.match(source, /act\.kind === 'runError'[\s\S]*?onclick=\{\(\) => \(act\.expanded = !expanded\)\}/)
})

test('AI 输出是活动流，不再使用「聊天 / 思考 / 工具」tab 或气泡', () => {
    const source = readFileSync(ASSISTANT, 'utf8')
    assert.equal(source.includes('TabPanel'), false, '旧的 tab 容器应已移除')
    assert.equal(source.includes('m.tab'), false, '旧的 tab 状态应已移除')
    assert.match(source, /appendActivityText|applyToolEventToActivities/, '事件应写入活动流')
})
