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

// 转模回归：离散转模按「每 divisor 转 multiplier」折算，本就不写 pct；
// 因此 pct 不能强制要求数字，否则这类 ref 会被整条丢掉（转模永远写不进去）。
describe('AI 生成引用 / 转模（ref）', () => {
    it('离散转模不写 pct 也能保留', () => {
        const out = sanitizeBuffs([
            {
                buffName: '甲 暴击伤害(转模)',
                scope: 'self',
                zones: [
                    {
                        zoneId: 'critDmg',
                        value: 0,
                        ref: {
                            targetZoneId: 'totalAtk',
                            threshold: 2000,
                            discrete: true,
                            divisor: 100,
                            multiplier: 5,
                            upper: 30
                        }
                    }
                ]
            }
        ])
        assert.equal(out.length, 1)
        const ref = out[0].zones?.[0]?.ref
        assert.ok(ref, 'ref 不应被丢弃')
        assert.equal(ref?.targetZoneId, 'totalAtk')
        assert.equal(ref?.pct, 0)
        assert.equal(ref?.discrete, true)
        assert.equal(ref?.divisor, 100)
        assert.equal(ref?.multiplier, 5)
        assert.equal(ref?.upper, 30)
    })

    it('线性转模保留 pct', () => {
        const out = sanitizeBuffs([
            {
                buffName: '甲 增伤(转模)',
                scope: 'self',
                zones: [
                    {
                        zoneId: 'bonusDmg',
                        value: 0,
                        ref: { targetZoneId: 'totalAtk', threshold: 1000, pct: 2, lower: 5 }
                    }
                ]
            }
        ])
        const ref = out[0].zones?.[0]?.ref
        assert.equal(ref?.pct, 2)
        assert.equal(ref?.threshold, 1000)
        assert.equal(ref?.lower, 5)
    })

    it('引用目标不在白名单时整条丢弃（value 也不会退化成普通乘区）', () => {
        const out = sanitizeBuffs([
            {
                buffName: '甲 乱写引用',
                scope: 'self',
                zones: [{ zoneId: 'critDmg', value: 0, ref: { targetZoneId: 'notAStat', pct: 10 } }]
            }
        ])
        // ref 被丢弃后 value=0 的普通条目仍在（与工具箱既有口径一致），但不能再带 ref
        assert.equal(out[0]?.zones?.[0]?.ref, undefined)
    })
})
