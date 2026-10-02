// 工具注册表幂等性单测：HMR 重跑/多入口重复导入同一工具时不得产生同名重复定义
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableTools, buildTools, defineTool, executeTool, isToolAvailable, toolRequires } from './registry'
import type { AskUserRequest } from './ask-user.types'
import type { WebFetchRequest } from './web-fetch.types'
import './ask-user'
import './web-fetch'

test('defineTool 重复注册同名工具时去重，且以后一次定义为准', async () => {
    defineTool('__dup_test', {
        description: '第一版',
        parameters: { type: 'object', properties: { a: { type: 'string' } } },
        handler: () => 'v1'
    })
    defineTool('__dup_test', {
        description: '第二版',
        parameters: { type: 'object', properties: { b: { type: 'string' } } },
        handler: () => 'v2'
    })

    const names = buildTools().map((t) => t.function.name)
    assert.equal(names.filter((n) => n === '__dup_test').length, 1)

    const def = buildTools().find((t) => t.function.name === '__dup_test')
    assert.equal(def?.function.description, '第二版')

    const result = await executeTool({}, '__dup_test', { b: 'x' })
    assert.deepEqual(JSON.parse(result), { ok: true, data: 'v2' })
})

// 能力门控（requires）：ask_user 这类「需要宿主交互界面」的工具在缺能力时必须
// ① 不进可用清单、② 直接调用也被拒、③ 仍留在 buildTools() 的全量清单里（供文档/注册表用）。
// WS 远程接管正是靠这条把 ask_user 挡在门外（其 ToolContext 刻意不注入 askUser）。
test('requires 能力门控：缺 askUser 时工具不可见且不可执行，注入后才可用', async () => {
    defineTool('__cap_probe', {
        description: '能力门控探针',
        parameters: { type: 'object', properties: {} },
        requires: 'askUser',
        handler: () => 'probe'
    })

    const names = (ctx: Parameters<typeof availableTools>[0]): string[] =>
        availableTools(ctx).map((t) => t.function.name)

    // ① 缺能力：不在可用清单里（因为它是**白名单式过滤**，不是留在清单里等运行时报错）
    assert.equal(names({}).includes('__cap_probe'), false)
    assert.equal(isToolAvailable({}, '__cap_probe'), false)

    // ② 注入能力后：出现且可用
    const withCapability = { askUser: async () => ({ submitted: true, answers: [] }) }
    assert.equal(names(withCapability).includes('__cap_probe'), true)
    assert.equal(isToolAvailable(withCapability, '__cap_probe'), true)

    // ③ buildTools() 不按能力过滤（文档生成与「注册表全量」场景要靠它）
    const def = buildTools().find((t) => t.function.name === '__cap_probe')
    assert.ok(def, 'buildTools() 应当仍包含声明了 requires 的工具')
    assert.equal(def.function.description, '能力门控探针')

    // ④ 缺能力时直接 executeTool：返回 ok:false 且点明缺少哪个能力（不能静默成功）
    const denied = JSON.parse(await executeTool({}, '__cap_probe', {})) as { ok: boolean; error: string }
    assert.equal(denied.ok, false)
    assert.match(denied.error, /askUser/)

    // ⑤ 能力齐备时正常执行（证明门控只拦缺能力的那一侧）
    const allowed = JSON.parse(await executeTool(withCapability, '__cap_probe', {})) as { ok: boolean; data: string }
    assert.deepEqual(allowed, { ok: true, data: 'probe' })
})

// ask_user 真正的注册形态：工具确实在清单里 = requires 声明生效；handler 的校验/归一/透传见下一条
test('ask_user 已注册并声明 askUser 能力需求', () => {
    assert.equal(isToolAvailable({}, 'ask_user'), false)
    assert.equal(isToolAvailable({ askUser: async () => ({ submitted: true, answers: [] }) }, 'ask_user'), true)
})

test('ask_user handler：补全 id、忽略 boolean 的 options、原样透传作答、归一越界 id', async () => {
    const seen: AskUserRequest[] = []
    const ctx = {
        askUser: async (request: AskUserRequest) => {
            seen.push(request)
            return {
                submitted: true,
                answers: [
                    { id: 'q1', type: 'boolean' as const, skipped: false, values: ['yes'] },
                    // 宿主越界作答（本次没问过 q9）：必须被丢弃，不得污染模型上下文
                    { id: 'q9', type: 'single' as const, skipped: false, values: ['幽灵'] }
                ]
            }
        }
    }

    const raw = await executeTool(ctx, 'ask_user', {
        title: '两件事',
        questions: [
            // id 缺失 → 补 q1；boolean 给了 options → 忽略（不报错，结果里如实反映）
            { type: 'boolean', question: '  要不要继续？  ', options: [{ value: 'yes', label: '是' }] },
            // 重复 id=q1 → 改写保证唯一
            {
                id: 'q1',
                type: 'single',
                question: '用哪套？',
                options: [
                    { value: 'a', label: 'A 方案' },
                    { value: 'b', label: 'B 方案' }
                ]
            }
        ]
    })
    const out = JSON.parse(raw) as {
        ok: boolean
        data: {
            submitted: boolean
            answers: { id: string; values: string[] }[]
            questions: { id: string; type: string; question: string; options: string[] }[]
            answerSummary: string[]
            notes: string[]
        }
    }
    assert.equal(out.ok, true)
    assert.equal(out.data.submitted, true)

    // 传给宿主的问题已经过校验/归一：id 补齐唯一、text 已 trim、boolean 的 options 被剥掉
    assert.deepEqual(
        seen[0].questions.map((q) => ({ id: q.id, type: q.type, question: q.question, options: q.options })),
        [
            { id: 'q1', type: 'boolean', question: '要不要继续？', options: undefined },
            // 第 3 题 id 与第 1 题冲突 → 改为「冲突 id + 该题序号」= q1-3
            { id: 'q1-3', type: 'single', question: '用哪套？', options: seen[0].questions[1].options }
        ]
    )
    assert.equal(seen[0].title, '两件事')

    // 越界作答被丢弃，剩下的是本次提问内的题
    assert.deepEqual(out.data.answers, [{ id: 'q1', type: 'boolean', skipped: false, values: ['yes'] }])
    assert.ok(
        out.data.notes.some((n) => n.includes('q9')),
        '应记录被丢弃的越界 id'
    )
    assert.ok(
        out.data.notes.some((n) => n.includes('options')),
        '应记录 boolean 的 options 被忽略'
    )
    assert.ok(
        out.data.notes.some((n) => n.includes('补')),
        '应记录 id 被补全'
    )
    // 逐题摘要：第二题宿主没作答 → 明确标「未作答」，不臆造
    assert.equal(out.data.answerSummary.length, 2)
    assert.ok(out.data.answerSummary[1].includes('未作答'))
})

test('ask_user handler：参数错误抛出可读原因，缺能力时兜底抛错', async () => {
    const ctx = { askUser: async () => ({ submitted: true, answers: [] }) }
    const bad = async (args: Record<string, unknown>, expected: RegExp): Promise<void> => {
        const res = JSON.parse(await executeTool(ctx, 'ask_user', args)) as { ok: boolean; error: string }
        assert.equal(res.ok, false)
        assert.match(res.error, expected)
    }

    await bad({}, /questions/)
    await bad({ questions: [] }, /至少/)
    await bad({ questions: [{ type: 'rating', question: '???' }] }, /boolean/)
    await bad({ questions: [{ type: 'single', question: '选一个' }] }, /options/)
    await bad(
        {
            questions: [
                {
                    type: 'single',
                    question: '选一个',
                    options: [
                        { value: 'a', label: 'A' },
                        { value: 'a', label: '重复' }
                    ]
                }
            ]
        },
        /重复/
    )
    await bad({ questions: [{ type: 'multi', question: '选', options: [{ value: 'a' }] }] }, /label/)
    await bad(
        {
            questions: Array.from({ length: 21 }, (_, i) => ({ type: 'boolean', question: `问题 ${i}` }))
        },
        /上限/
    )

    // 兜底：handler 被别的路径直接调用、宿主未注入能力时，也要有明确报错
    const noCap = JSON.parse(
        await executeTool({}, 'ask_user', { questions: [{ type: 'boolean', question: 'x' }] })
    ) as {
        ok: boolean
        error: string
    }
    assert.equal(noCap.ok, false)
    assert.match(noCap.error, /askUser/)
})

// ── web_fetch：AI 独享 / WS 禁止调用 ──────────────────────────────────────────
// `wsCtx()`（$lib/ws-remote/ws-remote.svelte.ts）刻意**不注入 `webFetch`**，
// 所以 WS 侧必须：① 清单里没有它、② 直接 exec 也被拒。这里用一个「字段与 wsCtx() 同形」的上下文钉住这条契约。
const WS_LIKE_CTX = {
    onConfirm: async () => true,
    requestView: () => {},
    notifyCalc: () => {},
    onGenerateProgress: () => {}
}

test('web_fetch 声明 webFetch 能力需求：WS 式上下文不可见、不可执行，注入后才可用', async () => {
    assert.equal(toolRequires('web_fetch'), 'webFetch')

    // ① 清单：WS 式上下文里没有 web_fetch（白名单式过滤，不是「留着等运行时报错」）
    assert.equal(
        availableTools(WS_LIKE_CTX).some((t) => t.function.name === 'web_fetch'),
        false
    )
    assert.equal(isToolAvailable(WS_LIKE_CTX, 'web_fetch'), false)

    // ② 直接 exec：明确拒绝并点明缺少哪个能力（不静默成功、不真的出网）
    const denied = JSON.parse(await executeTool(WS_LIKE_CTX, 'web_fetch', { url: 'https://example.com' })) as {
        ok: boolean
        error: string
    }
    assert.equal(denied.ok, false)
    assert.match(denied.error, /webFetch/)

    // ③ 内置 AI 助手注入能力后：进清单、可执行
    const ctx = {
        webFetch: async (request: WebFetchRequest) => ({
            url: request.url,
            status: 200,
            contentType: 'text/html',
            content: '正文',
            truncated: false
        })
    }
    assert.equal(
        availableTools(ctx).some((t) => t.function.name === 'web_fetch'),
        true
    )
    assert.equal(isToolAvailable(ctx, 'web_fetch'), true)

    // ④ buildTools() 全量清单仍包含它（文档生成 / 注册表全量场景）
    assert.ok(buildTools().some((t) => t.function.name === 'web_fetch'))

    // ⑤ 对照：同一份「WS 式上下文」不影响不需要能力的工具（证明门控是**按能力**而不是把清单整体清空）
    assert.equal(availableTools(WS_LIKE_CTX).length > 0, true)
})

test('web_fetch handler：入参先归一（补协议 / 去 fragment / 钳制 maxChars）再交给宿主能力', async () => {
    const seen: WebFetchRequest[] = []
    const ctx = {
        webFetch: async (request: WebFetchRequest) => {
            seen.push(request)
            return {
                url: request.url,
                status: 200,
                contentType: 'text/html',
                title: '标题',
                content: '正文',
                truncated: false
            }
        }
    }
    const raw = await executeTool(ctx, 'web_fetch', {
        url: '  example.com/doc#part  ',
        format: 'markdown',
        maxChars: 999999,
        mainOnly: false
    })
    const out = JSON.parse(raw) as { ok: boolean; data: { content: string; title?: string } }
    assert.equal(out.ok, true)
    assert.equal(out.data.content, '正文')
    assert.equal(out.data.title, '标题')
    // 宿主拿到的是**归一后**的请求：https 补全、fragment 去掉、maxChars 压到硬顶、mainOnly 保留 false
    assert.deepEqual(seen[0], {
        url: 'https://example.com/doc',
        format: 'markdown',
        maxChars: 40000,
        mainOnly: false
    })
})

test('web_fetch handler：参数错误抛出可读原因，缺能力时同样被拒', async () => {
    const ctx = {
        webFetch: async () => ({
            url: 'https://x.test/',
            status: 200,
            contentType: 'text/html',
            content: '',
            truncated: false
        })
    }
    const bad = async (args: Record<string, unknown>, expected: RegExp): Promise<void> => {
        const res = JSON.parse(await executeTool(ctx, 'web_fetch', args)) as { ok: boolean; error: string }
        assert.equal(res.ok, false)
        assert.match(res.error, expected)
    }
    await bad({}, /url/)
    await bad({ url: '   ' }, /url/)
    await bad({ url: 'ftp://a.test/x' }, /http/)

    // 宿主能力缺失（= WS 侧）时同样被拒：与上面 ② 是同一道闸门
    const noCap = JSON.parse(await executeTool({}, 'web_fetch', { url: 'https://a.test' })) as {
        ok: boolean
        error: string
    }
    assert.equal(noCap.ok, false)
    assert.match(noCap.error, /webFetch/)
})
