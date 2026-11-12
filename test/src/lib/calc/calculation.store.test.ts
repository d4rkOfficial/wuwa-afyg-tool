// 复制 Buff 的命名回归：短名直接补 `#`，重名继续补 `#`，且留在原文件夹。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    createBuffSet,
    createBuffTreeFolder,
    duplicateBuffSet,
    getAllBuffConfs,
    init
} from '$lib/calc/calculation.store.svelte'
import type { CharSlot } from '$lib/types/project'
import type { TimelineData } from '$lib/calc/timeline.types'

const TEAM = [
    { character: '复制测试甲', weapon: null },
    { character: '复制测试乙', weapon: null },
    { character: '复制测试丙', weapon: null }
] as unknown as [CharSlot, CharSlot, CharSlot]

const TIMELINE: TimelineData = { refLines: [], opBlocks: [], damageBlocks: [] }

describe('复制 Buff：短名 + #', () => {
    it('文件夹内复制：留在原文件夹，重名继续补 #', () => {
        init(TEAM, TIMELINE, null, false, () => {})
        const folderId = createBuffTreeFolder('复制测试文件夹', 'nonGlobal', null)
        assert.ok(folderId)
        const sourceId = createBuffSet('晴天', { tab: 'nonGlobal', folderId })
        assert.ok(sourceId)

        assert.ok(duplicateBuffSet(sourceId, '晴天#'))
        assert.ok(duplicateBuffSet(sourceId, '晴天#'))

        assert.deepEqual(
            getAllBuffConfs()
                .map((buff) => buff.name)
                .sort(),
            ['复制测试文件夹\\晴天', '复制测试文件夹\\晴天#', '复制测试文件夹\\晴天##']
        )
    })

    it('根目录复制：同样短名 + #，不生成「名字 复制」', () => {
        const otherTeam = [
            { character: '复制测试丁', weapon: null },
            { character: '复制测试戊', weapon: null },
            { character: '复制测试己', weapon: null }
        ] as unknown as [CharSlot, CharSlot, CharSlot]
        init(otherTeam, TIMELINE, null, false, () => {})
        const sourceId = createBuffSet('雨天', { tab: 'nonGlobal' })
        assert.ok(sourceId)

        assert.ok(duplicateBuffSet(sourceId, '雨天#'))
        assert.ok(duplicateBuffSet(sourceId, '雨天#'))

        assert.deepEqual(
            getAllBuffConfs()
                .map((buff) => buff.name)
                .sort(),
            ['雨天', '雨天#', '雨天##']
        )
    })
})
