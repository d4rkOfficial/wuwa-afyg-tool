/**
 * @desc 最小调用示例：造一张 GeneralTable，算一段直伤 + 一段效应伤害。
 *
 * 运行前先打包：`pnpm run build:core`，然后 `node examples/coconut-core.mjs`。
 */
import { CoconutCore } from '../dist/calc-core/index.js'

/** 表：3 名成员（1 名角色 + 1 把武器 + 1 个效应虚角色），词条与段伤害 */
const table = {
    characters: ['角色A', '效应·电磁效应'],
    weapons: ['武器W', ''],
    // 每个角色的词条：key 直接是「作用 id」（atkPct = 攻击%，critRate = 暴击率）
    main_stats: [
        [{ key: 'atkPct', value: '12' }],
        []
    ],
    sub_stats: [
        [
            { key: 'critRate', value: '10' },
            { key: 'critDmg', value: '20' },
            { key: 'atkFlat', value: '40' }
        ],
        []
    ],
    buffs: [],
    damage_entries: [
        {
            source: '角色A',
            damages: [
                {
                    // 纯倍数：'100%' = 1.0；基准维度由 base 给（atk / hp / def）
                    value: '100%',
                    base: 'atk',
                    element: '冷凝',
                    formula: 'direct',
                    // 这一段生效的 buff：只剩「已判定生效」的事实
                    activated_buffs: [{ id: 'b1', effect: { applyTo: 'bonusDmg', value: '20' } }]
                }
            ]
        },
        {
            source: '效应·电磁效应',
            damages: [
                {
                    // 效应：倍率 = 层数倍率（电磁 3 层 = 1.313）
                    value: '1.313',
                    element: '导电',
                    formula: 'effect',
                    activated_buffs: []
                }
            ]
        }
    ]
}

/** 基础数值：角色 / 武器 / 怪物全部调用时传入 */
const bases = {
    characters: {
        角色A: { atk: 400, hp: 10000, def: 500, element: '冷凝' },
        // 效应虚角色：只有「效应系数」（效应基础值），没有三维面板
        '效应·电磁效应': { atk: 0, hp: 0, def: 0, element: '导电', coefficient: 3674 }
    },
    weapons: { 武器W: { atk: 500 } },
    enemy: {
        type: '演示敌人',
        level: 90,
        defense: 1000,
        dmgReduction: 5,
        resistances: { 冷凝: 40, 导电: 10 },
        coefficient: 10027
    }
}

const core = new CoconutCore()
const result = core.compute(table, bases, { trace: true })

for (const damage of result.damages) {
    console.log(
        `${damage.source} / ${damage.formula}: 基值 ${damage.baseValue} → 期望 ${damage.expected}` +
            `（不暴击 ${damage.nonCrit} / 暴击 ${damage.crit}）`
    )
    console.log(
        '  乘区 ' +
            damage.multipliers.map((zone) => `${zone.id}=${zone.value.toFixed(4)}`).join(' ')
    )
    console.log(
        '  贡献 ' +
            damage.contributions.map((item) => `${item.buffId}:${item.deltaExpected}`).join(' ') || '  贡献 -'
    )
}
console.log('合计期望', result.total.expected)
