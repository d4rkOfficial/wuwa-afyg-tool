// 生成提示词的装配回归：
// - 目标（工程 / Buff 集）决定「槽位口径」与「工程侧独有规则」两段是否注入；
// - 乘区归属判定表（加成 / 倍率提升 / 易伤 / 额外倍率）必须在系统提示里；
// - `{CONDITION_RULES}` 等占位符必须全部被替换掉，不能把裸占位符丢给模型。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { renderConditionRules, renderSystemPrompt } from '$lib/ai/generate/prompts'
import { DEFAULT_SYSTEM_PROMPT } from '$lib/ai/generate/prompts.config'
import { executeGenerateTool, type GenerateDataSource, type GenerateToolContext } from '$lib/ai/generate/tools'

const fakeData = { target: 'buff-set' } as unknown as GenerateDataSource
const ctxOf = (target: 'project' | 'buff-set'): GenerateToolContext => ({
    entityType: 'character',
    entityName: '测试角色',
    namingRule: '',
    slangDict: '',
    data: { ...fakeData, target } as GenerateDataSource
})

describe('条件规则：按生成目标裁剪', () => {
    it('Buff 集目标：钉死 charIdx 一律 0，且不出现工程侧独有的 buffActive', () => {
        const text = renderConditionRules('character', 'buff-set')
        assert.match(text, /库内没有配队\/槽位概念/)
        assert.match(text, /charIdx \*\*一律写 0\*\*/)
        assert.doesNotMatch(text, /buffActive/)
        assert.doesNotMatch(text, /工程 Buff 配置/)
    })

    it('工程目标：说明 buffActive / 槽位在生成阶段不输出', () => {
        const text = renderConditionRules('character', 'project')
        assert.match(text, /工程 Buff 配置/)
        assert.match(text, /buffActive/)
        assert.match(text, /只写 0（本角色）或 -1（出伤者）/)
        assert.doesNotMatch(text, /库内没有配队\/槽位概念/)
    })

    it('两种目标都带 rules 段（伤害名 / 面板 / 敌人类型多选 + 同类一条）', () => {
        for (const target of ['project', 'buff-set'] as const) {
            const text = renderConditionRules('character', target)
            assert.match(text, /damageNameRegex/, `${target}: 缺伤害名正则`)
            assert.match(text, /zoneCompare/, `${target}: 缺面板数值`)
            assert.match(text, /"kind":"enemyType","types"/, `${target}: 敌人类型应写成多选 types`)
            assert.match(text, /同一种条件只能有一条/, `${target}: 缺「同类只能一条」口径`)
        }
    })

    it('链阶可并存，且按实体类型裁剪（声骸不再讲链/阶细则）', () => {
        const character = renderConditionRules('character', 'project')
        const weapon = renderConditionRules('weapon', 'project')
        const echo = renderConditionRules('echo', 'project')
        assert.match(character, /可以并存/)
        assert.match(character, /需角色共鸣链 ≥ n/, '角色应讲共鸣链细则')
        assert.match(weapon, /需武器精炼 ≥ n/, '武器应讲精炼阶细则')
        assert.doesNotMatch(echo, /需角色共鸣链 ≥ n/, '声骸不应讲链门槛')
        assert.doesNotMatch(echo, /需武器精炼 ≥ n/, '声骸不应讲阶门槛')
    })
})

describe('乘区归属判定表：三种「提升」不能混', () => {
    it('「加成」必定加成；倍率提升 → 特殊终伤；具名招式伤害提升 → 易伤；额外造成 → 额外倍率', () => {
        const text = renderSystemPrompt(DEFAULT_SYSTEM_PROMPT, { entityType: 'character', target: 'buff-set' })
        assert.match(text, /有「加成」必定是加成/)
        assert.match(text, /「倍率提升」→ 特殊终伤/)
        assert.match(text, /具名招式的「伤害提升」→ 易伤/)
        assert.match(text, /「额外造成…的伤害」→ 额外倍率/)
        assert.match(text, /普攻伤害倍率提升 30%/, '应有具名 + 倍率提升的正面例句')
        assert.match(text, /额外造成一次…伤害/, '应有「额外造成」→ 额外倍率的正面例句')
    })
})

describe('系统提示装配', () => {
    it('所有占位符都被替换', () => {
        const rendered = renderSystemPrompt(DEFAULT_SYSTEM_PROMPT, {
            entityType: 'character',
            namingRule: '短名优先',
            target: 'buff-set'
        })
        for (const placeholder of ['{CONDITION_RULES}', '{NAMING_RULES}', '{ZONE_LIST}', '{REF_ZONE_LIST}']) {
            assert.ok(!rendered.includes(placeholder), `${placeholder} 未被替换`)
        }
        assert.match(rendered, /短名优先/, '自定义命名规则应注入')
        assert.match(rendered, /共鸣解放伤害/, '乘区白名单表应注入')
        assert.match(rendered, /库内没有配队\/槽位概念/, 'Buff 集目标的槽位口径应注入')
    })
})

describe('get_condition_rules 工具按目标返回不同细则', () => {
    it('工程目标返回带 buffActive 的版本', async () => {
        const out = await executeGenerateTool(ctxOf('project'), 'get_condition_rules', {})
        assert.match(out, /buffActive/)
        assert.match(out, /工程 Buff 配置/)
    })

    it('Buff 集目标返回槽位一律 0 的版本', async () => {
        const out = await executeGenerateTool(ctxOf('buff-set'), 'get_condition_rules', {})
        assert.match(out, /charIdx \*\*一律写 0\*\*/)
        assert.doesNotMatch(out, /buffActive/)
    })
})

describe('get_examples 条件示例', () => {
    it('列出具名正则 / 敌人类型 / 面板门槛的完整示例', async () => {
        const out = await executeGenerateTool(ctxOf('project'), 'get_examples', {})
        assert.match(out, /示例14/)
        assert.match(out, /"kind":"damageNameRegex","pattern":"共鸣解放·终曲"/)
        assert.match(out, /"kind":"enemyType","types":\["BOSS","精英怪"\]/)
        assert.match(out, /示例15/)
        assert.match(out, /"kind":"zoneCompare","charIdx":-1,"zone":"critRate","op":"ge","value":60/)
    })
})
