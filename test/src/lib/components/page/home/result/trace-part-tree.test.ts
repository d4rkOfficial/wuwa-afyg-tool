// 结果页溯源浮窗 → 文件夹树（展示层转换）的回归。
//
// 钉住：Buff 来源按全名分组、非 Buff 来源保持顶层、收起视角只切子行、顺序按首次出现。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buildTracePartRows } from '$lib/components/page/home/result/trace-part-tree'
import type { TracePart } from '$lib/calc/damage-trace'

const part = (sourceType: TracePart['sourceType'], source: string, label = '', value = 10): TracePart => ({
    sourceType,
    source,
    label,
    value,
    unit: '%'
})

const ROWS = [
    part('buff', '套装\\焚羽\\重击后 20 声骸暴击', '热熔加成', 20),
    part('buff', '套装\\焚羽\\重击 + 声骸16 热熔', '热熔加成', 16),
    part('buff', '嘉贝莉娜\\内燃烧时 攻击', '热熔加成', 10),
    part('buff', '首位 热熔/声骸加成', '热熔加成', 30),
    part('panel', '技能', '基础每段倍率', 50)
]

describe('溯源来源文件夹树', () => {
    it('Buff 来源按全名分组，叶子只显示短名；非 Buff 来源留在顶层', () => {
        const rows = buildTracePartRows(ROWS, new Set())
        assert.deepEqual(
            rows.map((row) => `${row.kind}:${row.name}`),
            [
                'folder:套装',
                'folder:焚羽',
                'leaf:重击后 20 声骸暴击',
                'leaf:重击 + 声骸16 热熔',
                'folder:嘉贝莉娜',
                'leaf:内燃烧时 攻击',
                'leaf:首位 热熔/声骸加成',
                'leaf:技能'
            ]
        )
        assert.deepEqual(rows[1].path, ['套装', '焚羽'])
        assert.equal(rows[2].depth, 2)
        assert.equal(rows[7].depth, 0)
    })

    it('树线信息与 tree 输出一致：最后一行画 └，祖先有后续兄弟才画竖线', () => {
        const rows = buildTracePartRows(ROWS, new Set())
        assert.deepEqual(
            rows.map((row) => [row.name, row.depth, row.lastSibling, row.ancestorHasNext]),
            [
                ['套装', 0, false, []],
                ['焚羽', 1, true, [true]],
                ['重击后 20 声骸暴击', 2, false, [true, false]],
                ['重击 + 声骸16 热熔', 2, true, [true, false]],
                ['嘉贝莉娜', 0, false, []],
                ['内燃烧时 攻击', 1, true, [true]],
                ['首位 热熔/声骸加成', 0, false, []],
                ['技能', 0, true, []]
            ]
        )
    })

    it('收起文件夹只隐藏其子行，顺序保持来源原本的先后', () => {
        const rows = buildTracePartRows(ROWS, new Set(['folder:套装']))
        assert.deepEqual(
            rows.map((row) => `${row.kind}:${row.name}`),
            ['folder:套装', 'folder:嘉贝莉娜', 'leaf:内燃烧时 攻击', 'leaf:首位 热熔/声骸加成', 'leaf:技能']
        )
    })

    it('文件夹 key 与收起集合使用同一套路径', () => {
        const folded = buildTracePartRows(ROWS, new Set(['folder:套装\\焚羽']))
        assert.deepEqual(
            folded.map((row) => `${row.kind}:${row.name}`),
            [
                'folder:套装',
                'folder:焚羽',
                'folder:嘉贝莉娜',
                'leaf:内燃烧时 攻击',
                'leaf:首位 热熔/声骸加成',
                'leaf:技能'
            ]
        )
    })
})
