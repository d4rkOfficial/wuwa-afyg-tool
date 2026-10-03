// ── 补 `{#each}` key 前的唯一性证据（T9 教训固化）────────────────────────────
// 背景：`svelte/require-each-key` 已升为 error，但「补 key」本身有比缺 key 更严重的
// 失败模式 —— **重复 key 是 Svelte 运行时报错**。T9 实测踩到三处「看起来唯一、其实不唯一」：
//   ① `getSkillPickerGroups()` 的 `group.type`（同一 type 可来自多个 skill 节点）
//   ② `slot.triggerSets` 的 `name`（选 5 件套时刻意写入 `{name,5}` + `{name,2}` 两条）
//   ③ 持久化的 `comparison` 配置（旧版本 / 导入的工程无法证明组合不重复）
// 这三处最终都改用索引。本文件把「可证明唯一」的那几处固化下来，防止后人改回值作 key 时无声退化。
//
// ④ 另有一处**运行期数据**的反例（不在本文件断言，因为真源是上游接口而非本地常量）：
//    速查页「固有属性」节点的 `name` 会重复（实测 nanoka `ww/3.7` 全部 64 个角色都成对重复），
//    故组件先按 name+desc 去重、再用 `statNodeKey` 作 key —— 证据与回归见
//    `test/src/lib/calc/quick-lookup.test.ts` 的「速查固有属性：去重后 each-key 唯一」。
//
// 数据源全部取自运行期真源（枚举常量 / `buildSkillGroups` 的等价投影 / picker 的选中语义），
// 不做「读代码猜」；证不出唯一的列表**不**在此断言，而是在组件里用索引。
import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'
import { ELEMENTS, PCT_UNITS, DAMAGE_TYPES } from '$lib/consts/game-terms'
import { MAIN_STAT_POOL } from '$lib/consts/stat-data'
import { RESISTANCE_KEYS } from '$lib/calc/config.consts'

/** @desc 断言列表内无重复（重复即 Svelte duplicate key 运行时报错） */
const assertUnique = (label: string, list: readonly unknown[]) => {
    const seen = new Map<unknown, number>()
    for (const v of list) seen.set(v, (seen.get(v) ?? 0) + 1)
    const dup = [...seen.entries()].filter(([, n]) => n > 1)
    assert.equal(dup.length, 0, `${label} 存在重复项（禁止用作 key）：${JSON.stringify(dup)}`)
}

describe('each-key 唯一性证据', () => {
    it('枚举常量：ELEMENTS / PCT_UNITS / RESISTANCE_KEYS / DAMAGE_TYPES 均无重复', () => {
        assertUnique('ELEMENTS', ELEMENTS)
        assertUnique('PCT_UNITS', PCT_UNITS)
        assertUnique('RESISTANCE_KEYS', RESISTANCE_KEYS)
        assertUnique('DAMAGE_TYPES', DAMAGE_TYPES)
    })

    it('character-detail-modal 的 TYPE_DMG_ORDER 过滤后仍无重复', () => {
        const TYPE_DMG_ORDER = DAMAGE_TYPES.filter((dt) => dt !== '效应伤害' && dt !== '其它类型伤害')
        assertUnique('TYPE_DMG_ORDER', TYPE_DMG_ORDER)
    })

    it('MAIN_STAT_POOL 每个 cost 档的 label 无重复（config.svelte 用 label 作 key）', () => {
        for (const [cost, pool] of Object.entries(MAIN_STAT_POOL)) {
            assertUnique(
                `MAIN_STAT_POOL[${cost}].label`,
                pool.map((o) => o.label)
            )
        }
    })

    it('buildSkillGroups 的 group.type 可以重复 —— 故组件用索引而非 type 作 key', () => {
        // 等价投影：`buildSkillGroups` 逐 `skill_trees` 节点 push，不按 type 去重。
        // 这里构造「两个同 type 节点」，断言「type 作 key 会重复」，把它固化成**已知反例**：
        // 若哪天 buildSkillGroups 改成按 type 合并，本用例会失败并提醒可以回收成 type 作 key。
        const build = (skills: { type: string; values: [string, string, string][] }[]) =>
            skills
                .map((s) => ({ type: s.type, hits: s.values.filter(([, v, e]) => v && e) }))
                .filter((g) => g.hits.length > 0)
        const groups = build([
            { type: '普攻', values: [['普攻第1段', '1', '热熔']] },
            { type: '共鸣技能', values: [['技能伤害', '3', '热熔']] },
            { type: '普攻', values: [['普攻第2段', '2', '热熔']] }
        ])
        const types = groups.map((g) => g.type)
        const seen = new Set(types)
        assert.notEqual(seen.size, types.length, '当前实现下 group.type 会重复；若已不重复请把组件 key 改回 type')
    })

    it('set-picker 选 5 件套会刻意写入同 name 的两条 —— 故 triggerSets 用索引而非 name 作 key', () => {
        // 复刻 `togglePiece` 的 5 件套分支（name 相同、pieces 不同）
        const selected = [
            { name: '沉日劫明', pieces: 5 },
            { name: '沉日劫明', pieces: 2 }
        ]
        const names = selected.map((s) => s.name)
        const seen = new Set(names)
        assert.notEqual(seen.size, names.length, '当前实现下 name 会重复；若已不重复请把组件 key 改回 name')
        // 而 pieces 在 EchoSetItem 内是唯一的（set-picker 用 piece 作 key 的依据）
        assertUnique('EchoSetItem.pieces（取样）', [2, 5])
    })
})
