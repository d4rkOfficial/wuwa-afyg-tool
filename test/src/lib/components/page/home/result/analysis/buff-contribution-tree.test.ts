// Buff 贡献列表 → 文件夹树（展示层转换）的回归。
//
// 钉住：文件夹行取计算层给的「整组移除」值（不是逐条求和）、嵌套层级、展开/收起的行切片。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    buildBuffContributionTree,
    collectBuffFolderKeys,
    flattenBuffTreeRows
} from '$lib/components/page/home/result/analysis/buff-contribution-tree'
import type { BuffContribution, BuffFolderContribution, CharBuffAnalysis } from '$lib/calc/result.types'

const buff = (id: string, name: string, contribution: number): BuffContribution => ({
    id,
    name,
    entryCount: 1,
    zones: [],
    contribution,
    contribPct: contribution / 10
})

const folder = (path: string[], contribution: number): BuffFolderContribution => ({
    path,
    contribution,
    contribPct: contribution / 10
})

const analysis = (buffs: BuffContribution[], folders: BuffFolderContribution[]): CharBuffAnalysis => ({
    character: '甲',
    totalDamage: 1000,
    noBuffDamage: 900,
    buffTotal: 100,
    buffTotalPct: 10,
    buffs,
    folders
})

describe('Buff 贡献文件夹树', () => {
    const base = analysis(
        [
            buff('a', '甲\\攻击', 400),
            buff('b', '甲\\增伤', 300),
            buff('c', '甲\\子\\暴伤', 200),
            buff('d', '乙\\攻击', 150),
            buff('e', '根 Buff', 100)
        ],
        [folder(['甲'], 700), folder(['甲', '子'], 200), folder(['乙'], 150)]
    )
    const tree = buildBuffContributionTree(base)

    it('按全名建树：文件夹行用整组移除值，Buff 行只显示短名', () => {
        assert.deepEqual(
            tree.folders.map((f) => f.path.join('\\')),
            ['甲', '乙']
        )
        assert.equal(tree.folders[0].contribution, 700, '文件夹行必须用计算层的整组损失，而不是子项之和')
        assert.deepEqual(
            tree.folders[0].buffs.map((b) => b.name),
            ['甲\\攻击', '甲\\增伤'],
            '树里的 Buff 仍保留全名（展示层取短名）'
        )
        assert.deepEqual(
            flattenBuffTreeRows(tree, new Set())
                .filter((row) => row.kind === 'buff')
                .map((row) => row.name)
                .sort(),
            ['攻击', '增伤', '暴伤', '攻击', '根 Buff'].sort()
        )
    })

    it('根目录 Buff 与文件夹同级，按贡献降序混排', () => {
        const rows = flattenBuffTreeRows(tree, new Set())
        assert.deepEqual(
            rows.map((row) => `${row.kind}:${row.name}`),
            ['folder:甲', 'buff:攻击', 'buff:增伤', 'folder:子', 'buff:暴伤', 'folder:乙', 'buff:攻击', 'buff:根 Buff']
        )
    })

    it('树线信息与 tree 输出一致：同级最后一行画 └，祖先有后续兄弟才画竖线', () => {
        const rows = flattenBuffTreeRows(tree, new Set())
        assert.deepEqual(
            rows.map((row) => [row.name, row.depth, row.lastSibling, row.ancestorHasNext]),
            [
                ['甲', 0, false, []],
                ['攻击', 1, false, [true]],
                ['增伤', 1, false, [true]],
                ['子', 1, true, [true]],
                ['暴伤', 2, true, [true, false]],
                ['乙', 0, false, []],
                ['攻击', 1, true, [true]],
                ['根 Buff', 0, true, []]
            ]
        )
    })

    it('收起文件夹只隐藏其子行（父行与兄弟仍在）', () => {
        const rows = flattenBuffTreeRows(tree, new Set(['folder:甲']))
        assert.deepEqual(
            rows.map((row) => `${row.kind}:${row.name}`),
            ['folder:甲', 'folder:乙', 'buff:攻击', 'buff:根 Buff']
        )
        assert.deepEqual(collectBuffFolderKeys(tree), ['folder:甲', 'folder:甲\\子', 'folder:乙'])
    })

    it('缺少文件夹统计时不致断树：退化为子项之和', () => {
        const noStats = analysis([buff('a', '甲\\攻击', 400), buff('b', '甲\\增伤', 300)], [])
        const fallback = buildBuffContributionTree(noStats)
        assert.equal(fallback.folders[0].contribution, 700)
    })
})
