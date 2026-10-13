// 「导出 / 导入的勾选粒度到单条配置项」回归：
// key 清单是导出与导入共用的唯一口径（`selectConfigEntries`），分组 / 大类只是界面上的聚合快捷方式。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    CONFIG_CATEGORIES,
    CONFIG_GROUPS,
    configKeysOfCategory,
    configKeysOfGroup,
    exportConfig,
    importConfig,
    listConfigEntries,
    selectConfigEntries,
    type ExportedConfig
} from '$lib/data/config'

const ALL = listConfigEntries()
const ALL_KEYS = ALL.map((e) => e.key)

describe('配置选择器（粒度到单条配置项）', () => {
    it('selectConfigEntries：undefined = 全部，[] = 全不选', () => {
        assert.equal(selectConfigEntries(ALL).length, ALL.length)
        assert.deepEqual(selectConfigEntries(ALL, []), [])
    })

    it('selectConfigEntries：只保留选中的 key，未知 key 静默忽略', () => {
        const picked = selectConfigEntries(ALL, ['keymap', 'shortcuts', '不存在的键'])
        assert.deepEqual(picked.map((e) => e.key).sort(), ['keymap', 'shortcuts'])
    })

    it('分组 / 大类 key 清单与登记表严格同源（界面聚合视图的唯一来源）', () => {
        const byGroup = CONFIG_GROUPS.flatMap((g) => configKeysOfGroup(g.id))
        const byCategory = CONFIG_CATEGORIES.flatMap((c) => configKeysOfCategory(c.id))
        assert.equal(byGroup.length, ALL.length)
        assert.deepEqual([...byGroup].sort(), [...ALL_KEYS].sort())
        assert.deepEqual([...byCategory].sort(), [...ALL_KEYS].sort())
        // 分组之间不重叠：重复会让「全选该组」意外勾到别的组
        assert.equal(new Set(byGroup).size, byGroup.length)
    })

    it('按分组取键：只含该组条目，且与登记顺序一致', () => {
        for (const g of CONFIG_GROUPS) {
            assert.deepEqual(
                configKeysOfGroup(g.id),
                ALL.filter((e) => e.group === g.id).map((e) => e.key)
            )
        }
    })

    it('导出：只对**选中**的条目报 API Key 跳过（未选中的不算跳过）', async () => {
        const all = await exportConfig({ includeApiKey: false })
        assert.deepEqual(all.skipped, ['AI 模型接入（含 API Key）'])

        const appearanceOnly = await exportConfig({
            includeApiKey: false,
            keys: configKeysOfGroup('appearance')
        })
        assert.equal(appearanceOnly.skipped, undefined)
    })

    it('导出：空选择产出空文件（两大桶仍在，结构稳定）', async () => {
        const empty = await exportConfig({ keys: [] })
        assert.deepEqual(empty.settings, {})
        assert.deepEqual(empty.libraries, {})
        assert.equal(empty.kind, 'wuwa-afyg-config')
    })

    it('导入：只应用选中的条目（未选中的条目保持现状）', async () => {
        const file: ExportedConfig = {
            kind: 'wuwa-afyg-config',
            version: 2,
            exportedAt: 0,
            settings: { appearance: { 'theme-active': 'dark' } },
            libraries: {}
        }
        const hit = await importConfig(file, { keys: ['theme-active'] })
        assert.equal(hit.applied, 1)
        assert.deepEqual(hit.unknownKeys, [])

        const miss = await importConfig(file, { keys: ['keymap'] })
        assert.equal(miss.applied, 0)
    })
})
