// 图片附件 → 两条协议 content parts 的转换单测：形状写错只会表现为服务商 400，故必须钉住
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasImageAttachments, toChatContentParts, toResponseContentParts } from '$lib/ai/image-parts'
import { toChatWireMessages } from '$lib/ai/client'
import type { ChatMessage } from '$lib/ai/client'

const PNG = 'data:image/png;base64,AAAA'
const JPG = 'data:image/jpeg;base64,BBBB'

test('toChatContentParts：正文与图片各自成 part，图片是 image_url 对象', () => {
    assert.deepEqual(toChatContentParts('看图', [PNG]), [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: PNG } }
    ])
})

test('toChatContentParts：多图按顺序排列', () => {
    const parts = toChatContentParts('两张', [PNG, JPG])
    assert.equal(parts.length, 3)
    assert.deepEqual(parts[1].image_url, { url: PNG })
    assert.deepEqual(parts[2].image_url, { url: JPG })
})

test('toChatContentParts：正文为空时不产生 text part（空 text 会被部分服务商拒绝）', () => {
    assert.deepEqual(toChatContentParts('', [PNG]), [{ type: 'image_url', image_url: { url: PNG } }])
    assert.deepEqual(toChatContentParts('   ', [PNG]), [{ type: 'image_url', image_url: { url: PNG } }])
})

test('toChatContentParts：没有图片时只留 text part', () => {
    assert.deepEqual(toChatContentParts('只有文字', []), [{ type: 'text', text: '只有文字' }])
})

test('toResponseContentParts：用 input_text / input_image，且 image_url 是**字符串**', () => {
    assert.deepEqual(toResponseContentParts('看图', [PNG]), [
        { type: 'input_text', text: '看图' },
        { type: 'input_image', image_url: PNG }
    ])
})

test('toResponseContentParts：正文为空时只留图片 part', () => {
    assert.deepEqual(toResponseContentParts('', [PNG]), [{ type: 'input_image', image_url: PNG }])
})

test('toChatWireMessages：带图消息的 content 换成 parts，且摘掉内部 images 字段', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: '看图', images: [PNG] }]
    const wire = toChatWireMessages(messages) as Array<Record<string, unknown>>
    assert.equal(wire.length, 1)
    assert.equal('images' in wire[0], false, 'images 不是协议字段，不能发出去')
    assert.deepEqual(wire[0].content, [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: PNG } }
    ])
})

test('toChatWireMessages：无图消息原样传递（保持改动前的请求体形状）', () => {
    const toolCall = { id: 'c1', type: 'function' as const, function: { name: 't', arguments: '{}' } }
    const messages: ChatMessage[] = [
        { role: 'system', content: '人设' },
        { role: 'assistant', content: '', tool_calls: [toolCall] },
        { role: 'tool', content: '结果', tool_call_id: 'c1' }
    ]
    const wire = toChatWireMessages(messages) as Array<Record<string, unknown>>
    assert.deepEqual(wire[0], { role: 'system', content: '人设' })
    assert.equal(typeof wire[1].content, 'string', '无图消息的 content 必须仍是字符串')
    assert.deepEqual(wire[1].tool_calls, [toolCall])
    assert.equal(wire[2].content, '结果')
})

test('toChatWireMessages：webSearchCalls 也是内部字段，不能发进 Chat Completions 请求体', () => {
    const messages: ChatMessage[] = [{ role: 'assistant', content: '查完了', webSearchCalls: [{ id: 'ws_1' }] }]
    const wire = toChatWireMessages(messages) as Array<Record<string, unknown>>
    assert.equal('webSearchCalls' in wire[0], false)
    assert.equal(wire[0].content, '查完了')
})

test('toChatWireMessages：空图片数组等同于无图（不产生 parts）', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: '文字', images: [] }]
    const wire = toChatWireMessages(messages) as Array<Record<string, unknown>>
    assert.equal(wire[0].content, '文字')
})

test('hasImageAttachments：只看 images，空数组与缺字段都算「无图」', () => {
    assert.equal(hasImageAttachments([]), false)
    assert.equal(hasImageAttachments([{}]), false, '完全没有 images 字段也算无图')
    assert.equal(hasImageAttachments([{ images: [] }]), false)
    assert.equal(hasImageAttachments([{ images: [PNG] }]), true)
})

test('hasImageAttachments：**历史里的图也算**（否则后续回合会被切回 Responses 而丢图）', () => {
    const history: ChatMessage[] = [
        { role: 'user', content: '第一轮带图', images: [PNG] },
        { role: 'assistant', content: '看到了' },
        { role: 'user', content: '第二轮只有文字' }
    ]
    assert.equal(hasImageAttachments(history), true)
})
