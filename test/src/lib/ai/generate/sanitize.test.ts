// 生成结果清洗：buffName 只能落成单段短名，绝不把模型误写的反斜杠带进文件夹路径。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeBuffs } from '$lib/ai/generate/sanitize'
import { renderNamingRules, renderSystemPrompt } from '$lib/ai/generate/prompts'

const generated = (buffName: string) =>
    sanitizeBuffs([{ buffName, scope: 'self', zones: [{ zoneId: 'atkPct', value: 10 }] }])

describe('AI 生成 Buff 名称', () => {
    it('反斜杠归一为正斜杠，生成结果里不出现文件夹分隔符', () => {
        const out = generated('甲\\乙')
        assert.equal(out.length, 1)
        assert.equal(out[0].buffName, '甲/乙')
        assert.ok(!out[0].buffName?.includes('\\'))
    })

    it('归一后同名条目按清洗后的短名去重', () => {
        const out = sanitizeBuffs([
            { buffName: '甲\\乙', scope: 'self', zones: [{ zoneId: 'atkPct', value: 10 }] },
            { buffName: '甲/乙', scope: 'self', zones: [{ zoneId: 'atkPct', value: 20 }] }
        ])
        assert.equal(out.length, 1)
        assert.equal(out[0].buffName, '甲/乙')
        assert.equal(out[0].zones?.[0]?.value, 10)
    })

    it('自定义命名规则也会追加硬性格式，禁止反斜杠', () => {
        const text = renderNamingRules('完全自定义的风格')
        assert.match(text, /禁止出现反斜杠/)
        assert.ok(text.includes('\\'))
    })

    it('渲染后的 system 提示词始终带硬性格式（即使模板被用户替换）', () => {
        const text = renderSystemPrompt('只输出 JSON', { entityType: 'character', namingRule: '自定义' })
        assert.match(text, /buffName 硬性格式/)
        assert.ok(text.includes('\\'))
    })
})
