// 结果域工具（Phase 4）：读取当前配置下的伤害计算结果
import { defineTool } from './registry'
import { computeAll } from '$lib/components/page/home/result/compute'
import {
    getAllDamageEntries,
    getCalcState,
    getConditionProfile
} from '$lib/components/page/home/calculation/calculation.store.svelte'
import { getConfig } from '$lib/components/page/home/config/config.store.svelte'
import { getActiveProject } from '$lib/data/project.svelte'
import { getCharacterInfo, getWeaponInfo } from '$lib/data/api'

defineTool('get_result_summary', {
    description:
        '基于当前配装/Buff/条件配置计算并返回伤害结果摘要：每个伤害条目的期望伤害（含暴击）与全队总伤害。可用来回答“这套配置伤害多少”“哪个技能伤害最高”。',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        const p = getActiveProject()
        if (!p) throw new Error('当前没有活动工程')
        const calc = getCalcState()
        const config = getConfig()

        const charNames = p.team.map((s) => s.character).filter((c): c is string => !!c)
        const weaponNames = p.team.map((s) => s.weapon).filter((w): w is string => !!w)
        const [charInfos, weaponInfos] = await Promise.all([
            Promise.all(charNames.map((n) => getCharacterInfo(n).catch(() => null))),
            Promise.all(weaponNames.map((n) => getWeaponInfo(n).catch(() => null)))
        ])
        const charInfoMap: Record<string, NonNullable<(typeof charInfos)[number]>> = {}
        charNames.forEach((n, i) => {
            if (charInfos[i]) charInfoMap[n] = charInfos[i]!
        })
        const weaponInfoMap: Record<string, NonNullable<(typeof weaponInfos)[number]>> = {}
        weaponNames.forEach((n, i) => {
            if (weaponInfos[i]) weaponInfoMap[n] = weaponInfos[i]!
        })

        const entries = computeAll(
            getAllDamageEntries(),
            calc.buffSets,
            calc.damageEntryBuffSetIds,
            calc.damageEntryDamageTypes,
            config,
            p.team,
            charInfoMap,
            weaponInfoMap,
            getConditionProfile()
        )

        const total = entries.reduce((sum, e) => sum + (e.totalDamage ?? 0), 0)
        return {
            total,
            entries: entries.map((e) => ({
                displayName: e.displayName,
                character: e.character,
                element: e.element,
                hits: e.hits,
                totalDamage: e.totalDamage,
                perHit: e.totalDamage > 0 && e.hits > 0 ? Math.round(e.totalDamage / e.hits) : 0
            }))
        }
    }
})
