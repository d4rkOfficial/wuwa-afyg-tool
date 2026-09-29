// 表格「条件不匹配」筛选判定复现/回归：
// 拉表平铺模式里，属性/类型不满足生效条件的 buff 不能被勾选（隐藏条件不匹配开启时该格应禁用）。
//
// 关键点：条件分层之后，属性/类型条件挂在**乘区条目**上（BuffZoneValue.condition），
// 只有链/阶硬门槛留在实例级（BuffInstance.condition）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buffContributesToEntry, resolveDamageTypes, DEFAULT_CONDITION_PROFILE } from './compute'
import type { BuffInstance, DamageEntry } from './calculation.types'

const entryWith = (element: string, damageTypes: string[]): DamageEntry =>
    ({
        id: `e-${damageTypes.join('+') || 'none'}`,
        hitName: '共鸣技能',
        displayName: '共鸣技能',
        isEffect: false,
        isTuneBreak: false,
        isTuneResponse: false,
        ratioValue: 100,
        ratioUnit: '%',
        damageBaseType: '攻击',
        damageElement: element,
        sourceTimelineBlockId: 'b1',
        hits: 1
    }) as unknown as DamageEntry

const buffWith = (zones: BuffInstance['zones'], condition?: BuffInstance['condition']): BuffInstance =>
    ({
        id: 'buff1',
        name: '测试buff',
        scope: 'all',
        zones,
        ...(condition ? { condition } : {})
    }) as unknown as BuffInstance

const PROF = DEFAULT_CONDITION_PROFILE

/** 表格的实际调用形态：条目 + 显式配置的伤害类型 → buffContributesToEntry */
const met = (buff: BuffInstance, damageTypes: string[], profile = PROF, charIdx = 0) => {
    const entry = entryWith('热熔', damageTypes)
    return buffContributesToEntry(
        buff,
        {
            element: entry.damageElement,
            damageTypes: resolveDamageTypes(entry, { [entry.id]: damageTypes })
        },
        profile,
        charIdx
    )
}

describe('buffContributesToEntry：乘区级（属性/类型）条件必须参与判定', () => {
    it('乘区条件是伤害类型且不匹配 → 不满足', () => {
        const buff = buffWith([
            { zoneId: 'bonusDmg', value: 20, condition: { damageTypes: ['共鸣解放伤害'] } } as never
        ])
        assert.equal(met(buff, ['共鸣技能伤害']), false, '乘区只吃共鸣解放伤害，当前是共鸣技能伤害 → 不满足')
    })

    it('乘区条件是伤害属性且不匹配 → 不满足', () => {
        const buff = buffWith([{ zoneId: 'bonusDmg', value: 20, condition: { elements: ['导电'] } } as never])
        assert.equal(met(buff, ['共鸣技能伤害']), false, '乘区只吃导电，当前是热熔 → 不满足')
    })

    it('乘区条件匹配 → 满足', () => {
        const buff = buffWith([
            { zoneId: 'bonusDmg', value: 20, condition: { damageTypes: ['共鸣技能伤害'] } } as never
        ])
        assert.equal(met(buff, ['共鸣技能伤害']), true, '条件命中 → 满足')
    })

    it('无条件乘区 → 满足', () => {
        const buff = buffWith([{ zoneId: 'bonusDmg', value: 20 } as never])
        assert.equal(met(buff, ['共鸣技能伤害']), true)
    })

    it('混合：一条乘区条件不满足、另一条无条件 → 仍有贡献，视为满足（与引擎「逐条各自判定」一致）', () => {
        const buff = buffWith([
            { zoneId: 'bonusDmg', value: 20, condition: { damageTypes: ['共鸣解放伤害'] } } as never,
            { zoneId: 'atkPct', value: 10 } as never
        ])
        assert.equal(met(buff, ['共鸣技能伤害']), true, '无条件乘区仍然生效，buff 不应对该条目整体禁用')
    })

    it('全部乘区条件都不满足 → 不满足（引擎在该条目下拿不到任何贡献）', () => {
        const buff = buffWith([
            { zoneId: 'bonusDmg', value: 20, condition: { damageTypes: ['共鸣解放伤害'] } } as never,
            { zoneId: 'atkPct', value: 10, condition: { elements: ['导电'] } } as never
        ])
        assert.equal(met(buff, ['共鸣技能伤害']), false)
    })

    it('零值条目不算贡献', () => {
        const buff = buffWith([{ zoneId: 'bonusDmg', value: 0 } as never])
        assert.equal(met(buff, ['共鸣技能伤害']), false, 'value=0 的乘区对引擎无贡献')
    })

    it('链/阶硬门槛仍然只认实例级条件', () => {
        const buff = buffWith([{ zoneId: 'bonusDmg', value: 20 } as never], {
            chains: [{ charIdx: 0, min: 3 }]
        })
        assert.equal(
            met(buff, ['共鸣技能伤害'], { chains: [1, 0, 0], refinements: [1, 1, 1] }),
            false,
            '1 链 < 3 链门槛 → 不满足'
        )
        assert.equal(
            met(buff, ['共鸣技能伤害'], { chains: [3, 0, 0], refinements: [1, 1, 1] }),
            true,
            '3 链达到门槛 → 满足'
        )
    })
})
