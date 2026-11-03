// 配置同步弹窗的纯逻辑回归：选择集合运算 / 快捷范围 / 导入方式收窄 / 导出计数与文件名。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CONFIG_CATEGORIES, configKeysOfCategory, listConfigEntries } from '$lib/data/config'
import {
    areAllSelected,
    countExportedEntries,
    countSelected,
    exportFileName,
    isPartiallySelected,
    keysOfPreset,
    parseImportMode,
    selectedCountOfCategory,
    withKeyToggled,
    withKeysSelected
} from '$lib/components/page/home/settings/config-sync.utils'

const ALL_KEYS = listConfigEntries().map((e) => e.key)

describe('选择集合运算', () => {
    it('countSelected / areAllSelected / isPartiallySelected', () => {
        const selected = new Set(['a', 'b'])
        assert.equal(countSelected(['a', 'b', 'c'], selected), 2)
        assert.equal(areAllSelected(['a', 'b'], selected), true)
        assert.equal(areAllSelected(['a', 'b', 'c'], selected), false)
        assert.equal(areAllSelected([], selected), false)
        assert.equal(isPartiallySelected(['a', 'b', 'c'], selected), true)
        assert.equal(isPartiallySelected(['a', 'b'], selected), false)
        assert.equal(isPartiallySelected(['c'], selected), false)
    })

    it('withKeysSelected 不修改原集合', () => {
        const selected = new Set(['a'])
        const next = withKeysSelected(selected, ['a', 'b'], true)
        assert.deepEqual([...next].sort(), ['a', 'b'])
        assert.deepEqual([...selected], ['a'])
        assert.deepEqual([...withKeysSelected(selected, ['a'], false)], [])
    })

    it('withKeyToggled 翻单条', () => {
        const selected = new Set(['a'])
        assert.deepEqual([...withKeyToggled(selected, 'b')].sort(), ['a', 'b'])
        assert.deepEqual([...withKeyToggled(selected, 'a')], [])
    })
})

describe('快捷范围', () => {
    it('全选 / 清空', () => {
        assert.deepEqual([...keysOfPreset('all')].sort(), [...ALL_KEYS].sort())
        assert.deepEqual(keysOfPreset('clear'), [])
    })

    it('仅设置 / 仅本地库与登记表同源', () => {
        assert.deepEqual(keysOfPreset('settings').sort(), configKeysOfCategory('settings').sort())
        assert.deepEqual(keysOfPreset('libraries').sort(), configKeysOfCategory('libraries').sort())
    })

    it('按大类统计已选数量', () => {
        for (const cat of CONFIG_CATEGORIES) {
            const keys = configKeysOfCategory(cat.id)
            assert.equal(selectedCountOfCategory(cat.id, new Set(keys)), keys.length)
            assert.equal(selectedCountOfCategory(cat.id, new Set()), 0)
        }
    })
})

describe('导入方式与导出摘要', () => {
    it('parseImportMode 只接受 merge / replace', () => {
        assert.equal(parseImportMode('merge'), 'merge')
        assert.equal(parseImportMode('replace'), 'replace')
        assert.equal(parseImportMode('覆盖'), null)
        assert.equal(parseImportMode(''), null)
    })

    it('countExportedEntries 按分组桶累计条目', () => {
        assert.equal(countExportedEntries({}), 0)
        assert.equal(
            countExportedEntries({
                settings: { appearance: { a: 1, b: 2 }, data: {} },
                libraries: { library: { c: 3 } }
            }),
            3
        )
    })

    it('exportFileName 用本地日期（补零）', () => {
        assert.equal(exportFileName(new Date(2026, 0, 5)), '椰果工具箱-配置-2026-01-05.json')
        assert.equal(exportFileName(new Date(2026, 11, 31)), '椰果工具箱-配置-2026-12-31.json')
    })
})
