// 图片附件准入校验单测：上限与拒绝文案散在组件里最容易出现「界面说 4 张、实际只收 3 张」的漂移
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    ACCEPTED_IMAGE_TYPES,
    COMPRESS_THRESHOLD_BYTES,
    MAX_ATTACHMENTS,
    MAX_ATTACHMENT_BYTES,
    MAX_IMAGE_DIMENSION,
    computeScaledSize,
    formatBytes,
    planAttachments,
    shouldOptimizeImage,
    validateImageFile
} from '$lib/ai/attachments'

const file = (name: string, type = 'image/png', size = 1024) => ({ name, type, size })

test('formatBytes：按量级切换单位', () => {
    assert.equal(formatBytes(512), '512 B')
    assert.equal(formatBytes(2048), '2 KB')
    assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
})

test('validateImageFile：白名单内的类型都通过', () => {
    for (const type of ACCEPTED_IMAGE_TYPES) {
        assert.equal(validateImageFile(file(`a.${type}`, type)), null, `${type} 应通过`)
    }
})

test('validateImageFile：非白名单类型被拒且指明原因', () => {
    const reason = validateImageFile(file('doc.pdf', 'application/pdf'))
    assert.equal(typeof reason, 'string')
    assert.equal(reason?.includes('doc.pdf'), true, '拒绝文案要点名是哪个文件')
    assert.equal(reason?.includes('PNG'), true, '拒绝文案要说明支持什么')
})

test('validateImageFile：空文件被拒', () => {
    assert.notEqual(validateImageFile(file('a.png', 'image/png', 0)), null)
})

test('validateImageFile：超过单张上限被拒，恰好等于上限则通过', () => {
    assert.notEqual(validateImageFile(file('big.png', 'image/png', MAX_ATTACHMENT_BYTES + 1)), null)
    assert.equal(validateImageFile(file('edge.png', 'image/png', MAX_ATTACHMENT_BYTES)), null)
})

test('planAttachments：全部合法时按顺序全部接受', () => {
    const plan = planAttachments(0, [file('a.png'), file('b.jpg', 'image/jpeg')])
    assert.deepEqual(
        plan.accepted.map((f) => f.name),
        ['a.png', 'b.jpg']
    )
    assert.deepEqual(plan.rejections, [])
})

test('planAttachments：受剩余名额限制，超出部分逐条给理由（不静默丢弃）', () => {
    // 已有 3 张，只剩 1 个名额，却给了 3 个文件
    const plan = planAttachments(3, [file('a.png'), file('b.png'), file('c.png')])
    assert.equal(plan.accepted.length, 1)
    assert.equal(plan.rejections.length, 2)
    assert.equal(plan.rejections[0].includes(`最多 ${MAX_ATTACHMENTS} 张`), true)
    assert.equal(plan.rejections[1].includes('c.png'), true)
})

test('planAttachments：名额已满时全部拒绝', () => {
    const plan = planAttachments(MAX_ATTACHMENTS, [file('a.png')])
    assert.equal(plan.accepted.length, 0)
    assert.equal(plan.rejections.length, 1)
})

test('planAttachments：非法文件与超额同时出现时，两者都不被吞掉', () => {
    const plan = planAttachments(MAX_ATTACHMENTS - 1, [file('ok.png'), file('bad.pdf', 'application/pdf')])
    assert.deepEqual(
        plan.accepted.map((f) => f.name),
        ['ok.png']
    )
    assert.equal(plan.rejections.length, 1)
    assert.equal(plan.rejections[0].includes('bad.pdf'), true)
})

test('planAttachments：透传原始类型（传 File 拿回 File，不必再断言）', () => {
    const plan = planAttachments(0, [file('a.png')])
    // 类型层面即可断言：accepted 的元素类型与入参一致（此处的 name 访问即为证据）
    assert.equal(plan.accepted[0].name, 'a.png')
})

test('computeScaledSize：等比缩到最长边上限，小图保持原尺寸，非法尺寸返回 null', () => {
    assert.deepEqual(computeScaledSize(4096, 2048, MAX_IMAGE_DIMENSION), { width: 2048, height: 1024 })
    assert.deepEqual(computeScaledSize(1000, 800, MAX_IMAGE_DIMENSION), { width: 1000, height: 800 })
    assert.equal(computeScaledSize(0, 800, MAX_IMAGE_DIMENSION), null)
    assert.equal(computeScaledSize(Number.NaN, 800, MAX_IMAGE_DIMENSION), null)
})

test('shouldOptimizeImage：大图才重编码；GIF 与小图保持原样（不丢动画 / 不无谓有损）', () => {
    assert.equal(shouldOptimizeImage(file('big.png', 'image/png', COMPRESS_THRESHOLD_BYTES + 1)), true)
    assert.equal(shouldOptimizeImage(file('edge.png', 'image/png', COMPRESS_THRESHOLD_BYTES)), false)
    assert.equal(shouldOptimizeImage(file('anim.gif', 'image/gif', 5 * 1024 * 1024)), false)
})
