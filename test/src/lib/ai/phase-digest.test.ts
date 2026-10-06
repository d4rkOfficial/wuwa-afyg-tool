// 阶段详情「给 AI 看」的渲染回归：
// 排轴要按 pos 排成一条时间线、倍率默认不出现（按需另查）；拉表要按时间顺序、带已绑 Buff 名。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    fmtSeconds,
    renderBuffSetList,
    renderCalculationDigest,
    renderDamageRatioList,
    renderTimelineDigest
} from '$lib/ai/phase-digest'
import type { DamageBlock, OpBlock, RefLine } from '$lib/calc/timeline.types'
import type { DamageEntry } from '$lib/calc/calculation.types'

const op = (id: string, trackIndex: number, pos: number, key: string, extra: Partial<OpBlock> = {}): OpBlock => ({
    id,
    trackIndex,
    pos,
    key,
    desc: '',
    intro: false,
    switchback: false,
    ...extra
})

const refLine = (id: string, pos: number, time: string): RefLine => ({
    id,
    pos,
    time
})

const hit = (character: string, skillType: string, hitName: string, ratio: string, hits = 1) => ({
    character,
    skillType,
    hitName,
    ratio,
    hits,
    element: '冷凝'
})

const damageBlock = (sourceId: string, partial: Partial<DamageBlock> = {}): DamageBlock => ({
    id: `db-${sourceId}`,
    trackIndex: 0,
    sourceType: 'op',
    sourceId,
    skillHits: [],
    nonDirectEntries: [],
    ...partial
})

describe('排轴时间线渲染', () => {
    it('按 pos 排成一条时间线，参考线插在正确位置，伤害挂在所属块下', () => {
        const out = renderTimelineDigest({
            // 故意乱序传入：渲染必须自己按 pos 排
            opBlocks: [op('op-c', 2, 2, '共鸣解放'), op('op-a', 0, 0, '普攻'), op('op-b', 1, 1, '共鸣技能')],
            refLines: [refLine('rl-1', 1.5, '1m30s')],
            damageBlocks: [
                damageBlock('op-a', { skillHits: [hit('甲', '常态攻击', '普攻伤害', '100%')] }),
                damageBlock('op-b', { skillHits: [hit('乙', '共鸣技能', '共鸣技能伤害', '128.5%')] })
            ],
            trackLabels: ['甲', '乙', '丙'],
            locked: false
        })
        const lines = out.split('\n')
        // 跳过表头（表头里也含「参考线」字样）
        const order = lines
            .slice(1)
            .filter((l) => l.includes('轨') || l.includes('参考线'))
            .map((l) => l.trim())
        assert.deepEqual(order, [
            '[块1] 轨1 甲 · 普攻',
            '[块2] 轨2 乙 · 共鸣技能',
            '[线1] ── 参考线「1m30s」[自动推导 90.00s]',
            '[块3] 轨3 丙 · 共鸣解放'
        ])
        assert.ok(!out.includes('op-a') && !out.includes('rl-1'), '摘要只给序号，不出现内部 id')
        // 伤害缩进挂在各自块下，且顺序正确
        const a = lines.findIndex((l) => l.includes('[块1]'))
        assert.match(lines[a + 1], /└ 伤害: 普攻\(常态攻击\)/)
        const b = lines.findIndex((l) => l.includes('[块2]'))
        assert.match(lines[b + 1], /└ 伤害: 共鸣技能\(共鸣技能\)/)
    })

    it('默认不列倍率（倍率是按需查询的），只给命中名与技能类型', () => {
        const out = renderTimelineDigest({
            opBlocks: [op('op-a', 0, 0, '普攻')],
            refLines: [],
            damageBlocks: [damageBlock('op-a', { skillHits: [hit('甲', '共鸣技能', '共鸣技能伤害', '128.5%')] })],
            trackLabels: ['甲'],
            locked: false
        })
        assert.ok(!out.includes('128.5'), '排轴摘要里不应出现倍率数值')
        assert.ok(out.includes('共鸣技能(共鸣技能)'), '应给出命中名 + 技能类型')
    })

    it('同一命中绑多次合并成 ×N，不重复占行', () => {
        const out = renderTimelineDigest({
            opBlocks: [op('op-a', 0, 0, '普攻')],
            refLines: [],
            damageBlocks: [
                damageBlock('op-a', {
                    skillHits: [
                        hit('甲', '共鸣技能', '共鸣技能伤害', '100%'),
                        hit('甲', '共鸣技能', '共鸣技能伤害', '100%')
                    ]
                })
            ],
            trackLabels: ['甲'],
            locked: false
        })
        assert.ok(out.includes('共鸣技能(共鸣技能) ×2'), '重复命中应合并计数')
        assert.equal(out.split('└ 伤害').length - 1, 1, '只应有一行伤害')
    })

    it('非直伤与标记、参考线记点都渲染出来', () => {
        const out = renderTimelineDigest({
            opBlocks: [op('op-a', 0, 0, '共鸣解放', { desc: '大招', intro: true, switchback: true })],
            refLines: [refLine('rl-1', 1, '1m30s')],
            damageBlocks: [
                damageBlock('op-a', {
                    nonDirectEntries: [
                        { name: '电磁效应', category: '效应', layers: 3, hits: 2 },
                        { name: '谐度破坏', category: '处决', layers: 0, responders: ['甲'] }
                    ]
                })
            ],
            trackLabels: ['甲'],
            locked: true,
            timings: [{ refLineId: 'rl-1', seconds: 90 }]
        })
        assert.ok(out.includes('共鸣解放「大招」[变奏入场·切回]'))
        assert.ok(out.includes('效应·电磁效应 3层 ×2段'))
        assert.ok(out.includes('处决·谐度破坏 响应者=甲'))
        assert.ok(out.includes('参考线「1m30s」[记点 90.00s]'))
        assert.ok(out.includes('已锁定'))
    })

    it('空时间线给出明确提示', () => {
        const out = renderTimelineDigest({
            opBlocks: [],
            refLines: [],
            damageBlocks: [],
            trackLabels: [],
            locked: false
        })
        assert.ok(out.includes('（时间线为空）'))
    })

    it('只格式化已确定的参考线秒数', () => {
        assert.equal(fmtSeconds(1.5), '1.50s')
    })
})

describe('绑定倍率（按需查询）', () => {
    it('一行一条、按时间顺序给出倍率/属性/系数类型', () => {
        const out = renderDamageRatioList([
            {
                character: '甲',
                name: '普攻(常态攻击)',
                value: '100%',
                baseType: '攻击',
                time: 0,
                element: '物理'
            },
            {
                character: '乙',
                name: '共鸣技能(共鸣技能)',
                value: '128.5%*3',
                baseType: '攻击',
                time: 100,
                element: '冷凝'
            }
        ])
        const lines = out.split('\n')
        assert.ok(lines[0].includes('绑定倍率（2 条'))
        assert.ok(lines[1].includes('甲 · 普攻(常态攻击) 100% · 物理 · 攻击系数'))
        assert.ok(lines[2].includes('乙 · 共鸣技能(共鸣技能) 128.5%*3 · 冷凝 · 攻击系数'))
        assert.ok(lines[2].startsWith('[02]'), '倍率行按排轴序号编号，不标伪秒数')
    })

    it('没有绑定时给出明确提示', () => {
        assert.ok(renderDamageRatioList([]).includes('（没有任何已绑定的伤害倍率）'))
    })
})

const entry = (id: string, character: string, displayName: string, extra: Partial<DamageEntry> = {}): DamageEntry => ({
    id,
    character,
    skillType: '共鸣技能',
    hitName: '共鸣技能伤害',
    displayName,
    isEffect: false,
    isTuneBreak: false,
    isTuneResponse: false,
    ratioValue: 100,
    ratioUnit: '%',
    damageBaseType: '攻击',
    damageElement: '冷凝',
    sourceTimelineBlockId: `op-${id}`,
    hits: 1,
    ...extra
})

describe('拉表渲染', () => {
    it('按时间顺序逐条列出序号/归属/名称/属性/类型/已绑 Buff 名', () => {
        const out = renderCalculationDigest({
            // 乱序传入，渲染按时间排
            entries: [entry('e2', '乙', '共鸣技能(共鸣技能)'), entry('e1', '甲', '普攻(常态攻击)')],
            buffNamesOf: (id) => (id === 'e2' ? ['攻击加成', '暴击提升'] : []),
            damageTypesOf: (id) => (id === 'e2' ? ['共鸣技能伤害'] : ['普攻伤害']),
            posOf: (e) => (e.id === 'e1' ? 0 : 120)
        })
        const lines = out.split('\n')
        assert.ok(lines[0].includes('拉表（2 条伤害条目'))
        assert.ok(lines[1].includes('[01] 甲 · 普攻(常态攻击) · 冷凝 · 普攻伤害 · Buff: 无'))
        assert.ok(lines[2].includes('[02] 乙 · 共鸣技能(共鸣技能) · 冷凝 · 共鸣技能伤害 · Buff(2): 攻击加成、暴击提升'))
        assert.ok(lines[1].startsWith('[01]'), '条目序号在行首，不标伪秒数')
        assert.ok(!out.includes('(e1)') && !out.includes('(e2)'), '摘要只给序号，不出现条目 id')
    })

    it('非直伤条目带类型标记，未设伤害类型给出提示', () => {
        const out = renderCalculationDigest({
            entries: [entry('e9', '无', '电磁效应', { isEffect: true })],
            buffNamesOf: () => [],
            damageTypesOf: () => [],
            posOf: () => undefined
        })
        assert.ok(out.includes('[效应]'))
        assert.ok(out.includes('未定伤害类型'))
        assert.ok(out.split('\n')[1].startsWith('[01]'), '无位置的条目仍给序号')
        assert.ok(!out.includes('0.00s'), '不能把缺失位置当成零秒')
    })

    it('空拉表给出明确提示', () => {
        const out = renderCalculationDigest({
            entries: [],
            buffNamesOf: () => [],
            damageTypesOf: () => [],
            posOf: () => undefined
        })
        assert.ok(out.includes('（还没有任何伤害条目'))
    })
})

describe('Buff 集清单渲染', () => {
    it('一行一条，行首是序号，作用域与条件可读', () => {
        const out = renderBuffSetList([
            { name: '攻击加成', scope: 'all', global: true, starred: true, zoneCount: 2 },
            { name: '效应专属', scope: [], global: false, starred: false, zoneCount: 1 },
            { name: '双人共享', scope: [0, 1], global: false, starred: false, zoneCount: 3, condition: 'chains=1' }
        ])
        const lines = out.split('\n')
        assert.ok(lines[1].includes('[01] 攻击加成[全局★] · 全队 · 2 乘区'))
        assert.ok(lines[2].includes('[02] 效应专属 · 效应专属 · 1 乘区'))
        assert.ok(lines[3].includes('[03] 双人共享 · 角色1/2 · 3 乘区 · 条件: chains=1'))
    })

    it('空清单给出明确提示', () => {
        assert.ok(renderBuffSetList([]).includes('（还没有任何 Buff 集）'))
    })
})

const timelineInput = (extra: Partial<Parameters<typeof renderTimelineDigest>[0]> = {}) => ({
    opBlocks: [op('op-a', 0, 20, '普攻')],
    refLines: [
        refLine('left', 0, ''),
        refLine('rl-1', 100, '+25s'),
        refLine('rl-2', 200, '+25s'),
        refLine('right', 300, '结束')
    ],
    damageBlocks: [damageBlock('op-a', { skillHits: [hit('甲', '常态攻击', '普攻伤害', '100%')] })],
    trackLabels: ['甲'],
    locked: false,
    ...extra
})

describe('AI 时间口径（Issue #11）', () => {
    it('有效分析记点优先于名称；其它线不能冒充已配置时间', () => {
        const out = renderTimelineDigest(timelineInput({ timings: [{ refLineId: 'rl-1', seconds: 80 }] }))
        assert.ok(out.includes('参考线「+25s」[记点 80.00s]'))
        assert.ok(!out.includes('[自动推导'), '配置有效时不混入另一套自动时间')
        assert.ok(out.split('\n').find((line) => line.startsWith('[块1]')))
    })

    it('零秒也是有效配置，不被名称推导覆盖', () => {
        const out = renderTimelineDigest(timelineInput({ timings: [{ refLineId: 'rl-1', seconds: 0 }] }))
        assert.ok(out.includes('[记点 0.00s]'))
        assert.ok(!out.includes('[自动推导'))
    })

    it('无有效配置时复用相对时间、帧数与无尾部伤害的自动配置规则', () => {
        const out = renderTimelineDigest(
            timelineInput({
                refLines: [
                    refLine('left', 0, ''),
                    refLine('rl-1', 100, '+25s'),
                    refLine('rl-2', 200, '+25s50f'),
                    refLine('right', 300, '结束')
                ]
            })
        )
        assert.ok(out.includes('参考线「+25s」[自动推导 25.00s]'))
        assert.ok(out.includes('参考线「+25s50f」[自动推导 50.50s]'))
        assert.ok(out.includes('参考线「结束」[自动推导 50.50s]'))
    })

    it('尾部伤害绑定在参考线上时，结束线也遵守自动配置规则', () => {
        const out = renderTimelineDigest(
            timelineInput({
                damageBlocks: [
                    damageBlock('right', { sourceType: 'ref', skillHits: [hit('甲', '常态攻击', '普攻伤害', '100%')] })
                ]
            })
        )
        assert.ok(out.includes('参考线「结束」[自动推导 120.00s]'))
    })

    it('空伤害块不延长尾部；左锚点不被当作中间参考线', () => {
        const out = renderTimelineDigest(timelineInput({ damageBlocks: [damageBlock('right')] }))
        assert.ok(out.includes('参考线「结束」[自动推导 50.00s]'))
        const onlyEnd = renderTimelineDigest(
            timelineInput({ refLines: [refLine('left', 0, ''), refLine('right', 300, '结束')] })
        )
        assert.ok(onlyEnd.includes('参考线「结束」[自动推导 120.00s]'))
    })

    it('未填写、失效引用和非法秒数不阻止名称回退，不输出 NaN/Infinity', () => {
        const out = renderTimelineDigest(
            timelineInput({
                timings: [
                    { refLineId: 'rl-1', seconds: null },
                    { refLineId: 'rl-2', seconds: NaN },
                    { refLineId: 'right', seconds: -1 },
                    { refLineId: 'missing', seconds: 999 }
                ]
            })
        )
        assert.ok(out.includes('参考线「+25s」[记点 未填写][自动推导 25.00s]'))
        assert.ok(out.includes('[自动推导 50.00s]'))
        assert.ok(!out.includes('NaN') && !out.includes('999.00s') && !out.includes('-1.00s'))
    })

    it('没有记点且名称无法解析时，操作块也不会获得伪秒数', () => {
        const out = renderTimelineDigest(timelineInput({ refLines: [refLine('rl-1', 100, '起手')] }))
        assert.ok(!/\d+\.\d+s/.test(out))
        assert.ok(out.includes('[块1]'))
    })

    it('位置平移、缩放只保持顺序，不改变摘要中的时间信息', () => {
        const input = timelineInput()
        const transformed = {
            ...input,
            opBlocks: input.opBlocks.map((b) => ({ ...b, pos: b.pos * 9 + 700 })),
            refLines: input.refLines.map((r) => ({ ...r, pos: r.pos * 9 + 700 }))
        }
        assert.equal(renderTimelineDigest(transformed), renderTimelineDigest(input))
        const ratios = [
            { character: '甲', name: '普攻', value: '100%', baseType: '攻击', element: '物理', time: 20 },
            { character: '乙', name: '共鸣技能', value: '200%', baseType: '攻击', element: '冷凝', time: 10 }
        ]
        assert.equal(
            renderDamageRatioList(ratios),
            renderDamageRatioList(ratios.map((r) => ({ ...r, time: r.time * 9 + 700 })))
        )
        assert.ok(renderDamageRatioList(ratios).split('\n')[1].includes('[01] 乙'))
        const calcInput = {
            entries: [entry('e1', '甲', '普攻')],
            buffNamesOf: () => [],
            damageTypesOf: () => [],
            posOf: () => 20
        }
        assert.equal(renderCalculationDigest(calcInput), renderCalculationDigest({ ...calcInput, posOf: () => 880 }))
    })
})
