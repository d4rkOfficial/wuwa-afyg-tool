/**
 * 旧存项目 Zone ID 迁移函数
 *
 * 2026-07-25: 全量重构 zone ID 命名
 *   snake_case → camelCase
 *   harmony_dmg → tuneBreakBoost      (谐度破坏增幅)
 *   harmony_acc → offTuneBuildupRate  (偏谐值累积效率)
 *   tune_strain → tuneStrainLayer     (集谐干涉层数)
 *
 * 只迁移旧格式 ID，新格式/未知 ID 原样返回。
 * 2026-09-01 以后此函数自动变为透传（no-op），届时可删除本文件及所有调用。
 *
 * 不过以后可能还会出现术语命名调整，说不定会用上这个函数呢？
 * 呵呵，还是希望库洛搞新户口文案时搞点没这么文艺的词。不然别怪我滑坡了。
 * 你看看你写的那文案，我主力模型都看蒙了，还要我来教他，666。
 *
 * # 妈的写代码写到四点二十九分，又可以去清体力了。船长和嘉贝什么时候能五个部位全部刷出暴击率啊，傻逼声骸养成我操你妈。
 */
export function migrateZoneId(oldId: string): string {
    if (Date.now() > new Date('2026-09-01T00:00:00+08:00').getTime()) {
        return oldId
    }

    const ZONE_ID_MAP = {
        atk_flat: 'atkFlat',
        atk_pct: 'atkPct',
        hp_flat: 'hpFlat',
        hp_pct: 'hpPct',
        def_flat: 'defFlat',
        def_pct: 'defPct',
        crit_rate: 'critRate',
        crit_dmg: 'critDmg',
        recharge: 'recharge',
        harmony_dmg: 'tuneBreakBoost',
        harmony_acc: 'offTuneBuildupRate',
        tune_strain: 'tuneStrainLayer',
        bonus_dmg: 'bonusDmg',
        deepen_dmg: 'deepenDmg',
        res_pen: 'resPen',
        res_down: 'resDown',
        def_pen: 'defPen',
        def_down: 'defDown',
        dmg_red_pen: 'dmgRedPen',
        final_dmg: 'finalDmg',
        dmg_taken_inc: 'dmgTakenInc',
        custom_final_dmg: 'customFinalDmg',
        base_atk: 'baseAtk',
        total_atk: 'totalAtk',
        base_hp: 'baseHp',
        total_hp: 'totalHp',
        base_def: 'baseDef',
        total_def: 'totalDef'
    } as const

    return ZONE_ID_MAP[oldId as keyof typeof ZONE_ID_MAP] ?? oldId
}
