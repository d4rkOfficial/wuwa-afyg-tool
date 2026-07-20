<script lang="ts">
    import type { CharSlot } from '$lib/data/types'
    import type { CalcState } from '../calculation/calculation.types'
    import type { ConfigState, EnemyConfig } from '../config/config.types'
    import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
    import { getCharacterInfo, getWeaponInfo, getCharacterIcons, getWeaponIcons } from '$lib/data/api'
    import { getCharElementMap, getCharWeaponTypeMap } from '../timeline/timeline.store.svelte'
    import { getEntries, getBlocks, getEntryBlockIds } from '../calculation/calculation.store.svelte'
    import { ELEMENT_COLORS } from '../timeline/timeline.consts'
    import { SECOND_MAIN_STAT, SUBSTAT_OPTIONS } from '$lib/consts/stat-data'
    import type { ResultEntry } from './result.types'
    import { parseValueString, computeHitBase, computeTotalBase } from '$lib/consts/parse-value-string'
    import { EFFECT_BASE_DAMAGE, getTuneDamage } from '$lib/consts/tune-data'
    import { onMount } from 'svelte'
    import Icon from '@iconify/svelte'

    interface Props {
        team: [CharSlot, CharSlot, CharSlot]
        calcState: CalcState | null
        configState: ConfigState | null
    }

    let { team, calcState, configState }: Props = $props()

    let charInfoMap = $state<Record<string, CharacterInfo>>({})
    let weaponInfoMap = $state<Record<string, WeaponInfo>>({})
    let charIcons = $state<Record<string, string>>({})
    let weaponIcons = $state<Record<string, string>>({})
    let entries = $state<ResultEntry[]>([])
    let loading = $state(true)
    let charElements = $derived(getCharElementMap())

    $effect(() => {
        loadData()
    })

    async function loadData() {
        loading = true
        try {
            const charNames = team.map((s) => s.character).filter((c): c is string => c !== null)
            const [ci, wi] = await Promise.all([getCharacterIcons(), getWeaponIcons()])
            charIcons = ci
            weaponIcons = wi

            const infoPromises = charNames.map((n) => getCharacterInfo(n).catch(() => null))
            const infos = await Promise.all(infoPromises)
            const cmap: Record<string, CharacterInfo> = {}
            for (let i = 0; i < charNames.length; i++) {
                if (infos[i]) cmap[charNames[i]] = infos[i]!
            }
            charInfoMap = cmap

            const weaponNames = team.map((s) => s.weapon).filter((w): w is string => w !== null)
            const wpPromises = weaponNames.map((n) => getWeaponInfo(n).catch(() => null))
            const wpInfos = await Promise.all(wpPromises)
            const wmap: Record<string, WeaponInfo> = {}
            for (let i = 0; i < weaponNames.length; i++) {
                if (wpInfos[i]) wmap[weaponNames[i]] = wpInfos[i]!
            }
            weaponInfoMap = wmap
        } catch {
            /* ignore */
        }
        computeAll()
        loading = false
    }

    function computeAll() {
        const rawEntries = getEntries()
        const blocks = getBlocks()
        const blocksMap = new Map(blocks.map((b) => [b.id, b]))
        const config = configState
        const enemy = config?.enemy

        const zoneSum = (entryId: string, zoneId: string): number => {
            const ids = getEntryBlockIds(entryId)
            let sum = 0
            for (const bid of ids) {
                const block = blocksMap.get(bid)
                if (block) {
                    const zone = block.zones.find((z) => z.zoneId === zoneId)
                    if (zone) sum += zone.value
                }
            }
            return sum
        }

        entries = rawEntries.flatMap((e) => {
            const charInfo = charInfoMap[e.character]
            const slot = team.find((s) => s.character === e.character)
            const weaponInfo = slot?.weapon ? weaponInfoMap[slot.weapon] : null
            const charConfig = config?.characters?.[team.findIndex((s) => s.character === e.character)]
            const charElement = charElements[e.character] ?? ''

            // Base stats
            const baseCharAtk = charInfo?.lv90BaseStats?.atk ?? 0
            const baseCharHp = charInfo?.lv90BaseStats?.hp ?? 0
            const baseCharDef = charInfo?.lv90BaseStats?.def ?? 0
            const baseCharTune = charInfo?.lv90BaseStats?.tune ?? 0
            const baseWeapAtk = weaponInfo?.lv90BaseAtk ?? 0

            // Echo stats
            let atkFlat = 0,
                atkPct = 0
            let hpFlat = 0,
                hpPct = 0
            let defFlat = 0,
                defPct = 0
            let tuneFlat = 0
            let critRateBuff = 0,
                critDmgBuff = 0
            if (charConfig) {
                for (const es of charConfig.echoes) {
                    if (es.secondMainStat?.type === '攻击') atkFlat += es.secondMainStat.value
                    if (es.secondMainStat?.type === '生命') hpFlat += es.secondMainStat.value
                    if (es.mainStat?.type === '攻击%') atkPct += es.mainStat.value / 100
                    if (es.mainStat?.type === '生命%') hpPct += es.mainStat.value / 100
                    if (es.mainStat?.type === '防御%') defPct += es.mainStat.value / 100
                    if (es.mainStat?.type === '暴击率') critRateBuff += es.mainStat.value
                    if (es.mainStat?.type === '暴击伤害') critDmgBuff += es.mainStat.value
                    for (const sub of es.substats) {
                        if (sub.type === '攻击') atkFlat += sub.value
                        if (sub.type === '攻击%') atkPct += sub.value / 100
                        if (sub.type === '生命') hpFlat += sub.value
                        if (sub.type === '生命%') hpPct += sub.value / 100
                        if (sub.type === '防御') defFlat += sub.value
                        if (sub.type === '防御%') defPct += sub.value / 100
                        if (sub.type === '暴击率') critRateBuff += sub.value
                        if (sub.type === '暴击伤害') critDmgBuff += sub.value
                    }
                }
            }
            // Buff stats
            const buffAtkFlat = zoneSum(e.id, 'atk_flat')
            const buffAtkPct = zoneSum(e.id, 'atk_pct') / 100
            const buffHpFlat = zoneSum(e.id, 'hp_flat')
            const buffHpPct = zoneSum(e.id, 'hp_pct') / 100
            const buffDefFlat = zoneSum(e.id, 'def_flat')
            const buffDefPct = zoneSum(e.id, 'def_pct') / 100
            const buffTune = zoneSum(e.id, 'harmony_dmg')
            const harmonyDmgZone = 1 + buffTune / 100

            const totalAtk = (baseCharAtk + baseWeapAtk) * (1 + atkPct + buffAtkPct) + atkFlat + buffAtkFlat
            const totalHp = baseCharHp * (1 + hpPct + buffHpPct) + hpFlat + buffHpFlat
            const totalDef = baseCharDef * (1 + defPct + buffDefPct) + defFlat + buffDefFlat
            const totalTune = baseCharTune + tuneFlat

            const stats = { atk: totalAtk, hp: totalHp, def: totalDef, tune: totalTune }

            // Determine base damage
            let baseDamage = 0
            const isEffect = ['光噪效应', '风蚀效应', '霜渐效应', '聚爆效应', '电磁效应'].includes(e.skillType)
            const isHarmony = e.skillType === '谐度破坏' || e.skillType === '震谐响应' || e.skillType === '骇破响应'

            if (isEffect) {
                // Effect damage: base from EFFECT_BASE_DAMAGE
                const effectName = e.skillType
                const layerName = e.hitName
                const layerMatch = layerName.match(/(\d+)层/)
                const layers = layerMatch ? parseInt(layerMatch[1]) : 1
                const baseValues = EFFECT_BASE_DAMAGE[effectName] ?? []
                const baseVal = baseValues[Math.min(layers, baseValues.length) - 1] ?? 0
                baseDamage = baseVal * e.ratioNum
            } else if (isHarmony) {
                // Harmony/tune damage — no dmgBonus/deepen/crit; use local vars
                const hDmgBonus = 0
                const hDeepen = 0
                const hCritRate = 0.05
                const hCritDmg = 0.5
                if (e.skillType === '谐度破坏') {
                    const slot2 = team.find((s) => s.character === e.character)
                    const weapType = getCharWeaponTypeMap()[e.character] ?? ''
                    const eCost = slot2?.echoes?.[0]?.cost ?? 4
                    const tuneHits = weapType ? getTuneDamage(weapType, eCost) : []
                    if (tuneHits.length > 0) {
                        const totalBase = tuneHits.reduce((s, h) => s + h.damage * h.multiplier, 0)
                        baseDamage = totalBase * harmonyDmgZone
                    }
                } else {
                    baseDamage = totalTune * e.ratioNum * harmonyDmgZone
                }
                // Recompute common multipliers with harmony-specific values
                const hFinalDmg = (zoneSum(e.id, 'final_dmg') + zoneSum(e.id, 'target_final_dmg')) / 100
                const hFinalHarmony = zoneSum(e.id, 'final_harmony') / 100
                const hVuln = (zoneSum(e.id, 'dmg_taken_inc') + zoneSum(e.id, 'target_dmg_taken_inc')) / 100
                const hCustomMult = 1 + zoneSum(e.id, 'custom_final_dmg') / 100
                const hRaw = baseDamage * (1 + hDmgBonus) * (1 + hDeepen) * defMulti * resMulti * (1 - dmgReduction) * (1 + hFinalHarmony) * (1 + hFinalDmg) * (1 + hVuln) * hCustomMult
                const hCrit = 1 + hCritRate * hCritDmg
                const hTotalMul = (1 + hDmgBonus) * (1 + hDeepen) * defMulti * resMulti * (1 - dmgReduction) * (1 + hFinalHarmony) * (1 + hFinalDmg) * (1 + hVuln) * hCustomMult * hCrit

                return [{
                    id: e.id, character: e.character, hitName: e.hitName, skillType: e.skillType,
                    element: e.element, ratioNum: e.ratioNum, hits: e.hits, time: e.time,
                    baseValue: baseDamage, baseUnit: 'TUNE', totalMultiplier: hTotalMul,
                    baseAtk: Math.round(totalAtk), totalAtk: Math.round(totalAtk),
                    atkPctSum: 0, atkFlatSum: 0,
                    totalHp: 0, hpPctSum: 0, hpFlatSum: 0,
                    totalDef: 0, defPctSum: 0, defFlatSum: 0,
                    totalTune: Math.round(totalTune),
                    dmgBonus: hDmgBonus, deepen: hDeepen,
                    critRate: hCritRate, critDmg: hCritDmg,
                    defMulti, resMulti, dmgRedMulti: 1 - dmgReduction,
                    finalDmg: hFinalDmg,
                    finalHarmony: hFinalHarmony,
                    customMult: hCustomMult,
                    vulnerability: hVuln,
                    rawPerHit: hRaw, expectedPerHit: hRaw * hCrit * e.hits,
                    totalDamage: hRaw * hCrit * e.hits
                }]
            } else {
                // Normal damage: parse ratio string for base stat components
                const components = parseValueString(e.ratio)
                baseDamage = computeTotalBase(components, stats)
            }

            // Common multipliers
            let dmgBonus = zoneSum(e.id, 'bonus_dmg') + zoneSum(e.id, 'target_bonus')
            if (e.element && charElement) {
                const elementDmgLabel = e.element + '伤害加成'
                if (charConfig) {
                    for (const es of charConfig.echoes) {
                        if (es.mainStat?.type === elementDmgLabel) dmgBonus += es.mainStat.value
                        for (const sub of es.substats) {
                            if (sub.type === elementDmgLabel) dmgBonus += sub.value
                        }
                    }
                }
            }
            const skillTypeMap: Record<string, string> = {
                常态攻击: '普攻伤害加成',
                重击: '重击伤害加成',
                共鸣技能: '共鸣技能伤害加成',
                共鸣解放: '共鸣解放伤害加成'
            }
            const stLabel = skillTypeMap[e.skillType]
            if (stLabel && charConfig) {
                for (const es of charConfig.echoes) {
                    for (const sub of es.substats) {
                        if (sub.type === stLabel) dmgBonus += sub.value
                    }
                }
            }
            dmgBonus = dmgBonus / 100

            const deepen = (zoneSum(e.id, 'deepen_dmg') + zoneSum(e.id, 'target_deepen')) / 100

            // Crit (only for non-effect, non-harmony damage)
            let critRate = 0.05,
                critDmg = 0.5
            if (!isEffect && !isHarmony) {
                critRate += critRateBuff / 100
                critDmg += critDmgBuff / 100
            }

            const defPen = zoneSum(e.id, 'def_pen') / 100
            const defIgnore = zoneSum(e.id, 'def_ignore') / 100
            const enemyLevel = enemy?.level ?? 90
            const enemyDef = enemy?.defense ?? 1592
            const defDenom = (792 + enemyLevel * 8) * (1 - defPen) * (1 - defIgnore) + 1520
            const defMulti = 1520 / defDenom

            const enemyRes = enemy?.resistances?.[e.element] ?? 0
            const resPen = zoneSum(e.id, 'res_pen') / 100
            const resDown = zoneSum(e.id, 'res_down') / 100
            let effRes = (enemyRes - resPen * 100 - resDown * 100) / 100
            let resMulti: number
            if (effRes < 0) resMulti = 1 + Math.abs(effRes)
            else if (effRes > 1) resMulti = 1 - (1 + (effRes - 1) / 2)
            else resMulti = 1 - effRes

            const dmgRedPen = zoneSum(e.id, 'dmg_red_pen') / 100
            const dmgReduction = Math.max(0, (enemy?.dmgReduction ?? 0) - dmgRedPen * 100) / 100

            const finalHarmony = zoneSum(e.id, 'final_harmony') / 100
            const finalDmg = (zoneSum(e.id, 'final_dmg') + zoneSum(e.id, 'target_final_dmg')) / 100
            const vulnerability = (zoneSum(e.id, 'dmg_taken_inc') + zoneSum(e.id, 'target_dmg_taken_inc')) / 100
            const customMult = 1 + zoneSum(e.id, 'custom_final_dmg') / 100

            const rawPerHit =
                baseDamage *
                (1 + dmgBonus) *
                (1 + deepen) *
                defMulti *
                resMulti *
                (1 - dmgReduction) *
                (1 + finalHarmony) *
                (1 + finalDmg) *
                (1 + vulnerability) *
                customMult
            const critExpect = 1 + critRate * critDmg
            const expectedPerHit = rawPerHit * critExpect
            const totalDamage = expectedPerHit * e.hits

            const totalMultiplier =
                (1 + dmgBonus) *
                (1 + deepen) *
                defMulti *
                resMulti *
                (1 - dmgReduction) *
                (1 + finalHarmony) *
                (1 + finalDmg) *
                (1 + vulnerability) *
                customMult *
                critExpect

            function makeEntry(bv: number, rn: number, bu: string, sfx: string) {
                const isFlat = bu === '固定'
                const rph = isFlat
                    ? bv
                    : bv *
                      (1 + dmgBonus) *
                      (1 + deepen) *
                      defMulti *
                      resMulti *
                      (1 - dmgReduction) *
                      (1 + finalHarmony) *
                      (1 + finalDmg) *
                      (1 + vulnerability) *
                      customMult
                const tmul = isFlat ? 1 : totalMultiplier
                return {
                    id: e.id + sfx,
                    character: e.character,
                    hitName: e.hitName + sfx,
                    skillType: e.skillType,
                    element: e.element,
                    ratioNum: isFlat ? 1 : rn,
                    hits: e.hits,
                    time: e.time,
                    baseValue: bv,
                    baseUnit: bu,
                    totalMultiplier: tmul,
                    baseAtk: Math.round(totalAtk),
                    totalAtk: Math.round(totalAtk),
                    atkPctSum: (atkPct + buffAtkPct) * 100,
                    atkFlatSum: Math.round(atkFlat + buffAtkFlat),
                    totalHp: Math.round(totalHp),
                    hpPctSum: (hpPct + buffHpPct) * 100,
                    hpFlatSum: Math.round(hpFlat + buffHpFlat),
                    totalDef: Math.round(totalDef),
                    defPctSum: (defPct + buffDefPct) * 100,
                    defFlatSum: Math.round(defFlat + buffDefFlat),
                    totalTune: Math.round(totalTune),
                    dmgBonus,
                    deepen,
                    critRate,
                    critDmg,
                    defMulti,
                    resMulti,
                    dmgRedMulti: 1 - dmgReduction,
                    finalDmg,
                    finalHarmony,
                    customMult,
                    vulnerability,
                    rawPerHit: rph,
                    expectedPerHit: isFlat ? bv * e.hits : rph * critExpect * e.hits,
                    totalDamage: isFlat ? bv * e.hits : rph * critExpect * e.hits
                }
            }

            if (isEffect) return [makeEntry(baseDamage, e.ratioNum, '异常', '')]
            if (isHarmony) return [makeEntry(baseDamage, e.ratioNum, 'TUNE', '')]

            const comps = parseValueString(e.ratio)
            if (comps.length === 0) return [makeEntry(0, 0, 'ATK', '')]
            if (comps.length === 1) {
                const c = comps[0]
                const bu =
                    c.baseStat === 'hp'
                        ? 'HP'
                        : c.baseStat === 'def'
                          ? 'DEF'
                          : c.baseStat === 'tune'
                            ? 'TUNE'
                            : c.baseStat === 'flat'
                              ? '固定'
                              : 'ATK'
                return [makeEntry(computeHitBase(c, stats), c.ratioNum * c.hits, bu, '')]
            }
            return comps.map((c, i) => {
                const bu =
                    c.baseStat === 'hp'
                        ? 'HP'
                        : c.baseStat === 'def'
                          ? 'DEF'
                          : c.baseStat === 'tune'
                            ? 'TUNE'
                            : c.baseStat === 'flat'
                              ? '固定'
                              : 'ATK'
                return makeEntry(computeHitBase(c, stats), c.ratioNum * c.hits, bu, ` [${i + 1}]`)
            })
        })
    }

    let charSummaries = $derived.by(() => {
        const map = new Map<string, { total: number; count: number }>()
        for (const e of entries) {
            const cur = map.get(e.character) ?? { total: 0, count: 0 }
            cur.total += e.totalDamage
            cur.count++
            map.set(e.character, cur)
        }
        return [...map.entries()].map(([character, d]) => ({ character, totalDamage: d.total, entryCount: d.count }))
    })

    let totalDamage = $derived(charSummaries.reduce((s, c) => s + c.totalDamage, 0))

    let expandedEntry = $state<string | null>(null)

    function toggleExpand(id: string) {
        expandedEntry = expandedEntry === id ? null : id
    }
</script>

<div class="flex h-full flex-col" style="background: var(--theme-modal-bg); color: var(--theme-modal-text)">
    {#if loading}
        <div class="flex items-center justify-center py-20 text-xs text-[var(--theme-modal-text)]/40">计算中…</div>
    {:else if entries.length === 0}
        <div class="flex items-center justify-center py-20 text-xs text-[var(--theme-modal-text)]/40">暂无伤害数据</div>
    {:else}
        <!-- Summary -->
        <div class="shrink-0 border-b border-white/10 px-5 py-4">
            <div class="flex items-end gap-6">
                <div>
                    <div class="text-[10px] text-[var(--theme-modal-text)]/40 mb-1">总伤害</div>
                    <div class="text-2xl font-bold tabular-nums text-indigo-300">
                        {Math.round(totalDamage).toLocaleString()}
                    </div>
                </div>
                {#each charSummaries as cs}
                    <div>
                        <div
                            class="text-[10px] text-[var(--theme-modal-text)]/40 mb-1"
                            style="color: {(ELEMENT_COLORS as Record<string, string>)[charElements[cs.character]] ??
                                '#888'}"
                        >
                            {cs.character}
                        </div>
                        <div class="text-sm font-semibold tabular-nums">
                            {Math.round(cs.totalDamage).toLocaleString()}
                        </div>
                    </div>
                {/each}
            </div>
        </div>

        <!-- Detail table -->
        <div class="flex-1 overflow-y-auto">
            <table class="w-full text-xs">
                <thead>
                    <tr
                        class="text-[var(--theme-modal-text)]/50 border-b border-white/10 sticky top-0"
                        style="background: var(--theme-modal-bg)"
                    >
                        <th class="text-left font-medium py-2 px-3">来源</th>
                        <th class="text-left font-medium py-2 px-3">[技能]倍率名</th>
                        <th class="text-right font-medium py-2 px-3">基础值</th>
                        <th class="text-right font-medium py-2 px-3">单位</th>
                        <th class="text-right font-medium py-2 px-3">倍率</th>
                        <th class="text-right font-medium py-2 px-3">翻倍数</th>
                        <th class="text-right font-medium py-2 px-3">期望</th>
                        <th class="text-right font-medium py-2 px-3 w-8"></th>
                    </tr>
                </thead>
                <tbody>
                    {#each entries as entry}
                        <tr
                            onclick={() => toggleExpand(entry.id)}
                            class="cursor-pointer border-b border-white/5 transition-colors hover:bg-white/5"
                        >
                            <td
                                class="py-1.5 px-3 text-[var(--theme-modal-text)]"
                                style="color: {(ELEMENT_COLORS as Record<string, string>)[
                                    charElements[entry.character]
                                ] ?? '#888'}">{entry.character}</td
                            >
                            <td class="py-1.5 px-3 text-[var(--theme-modal-text)]/80">
                                [{entry.skillType}] {entry.hitName}
                                {#if entry.hits > 1}<span class="text-[var(--theme-modal-text)]/40">
                                        ×{entry.hits}</span
                                    >{/if}
                            </td>
                            <td class="py-1.5 px-3 text-right tabular-nums text-[var(--theme-modal-text)]/60"
                                >{Math.round(entry.baseValue).toLocaleString()}</td
                            >
                            <td class="py-1.5 px-3 text-right text-[var(--theme-modal-text)]/60">{entry.baseUnit}</td>
                            <td class="py-1.5 px-3 text-right tabular-nums text-[var(--theme-modal-text)]/60"
                                >{(entry.ratioNum * 100).toFixed(2)}%</td
                            >
                            <td class="py-1.5 px-3 text-right tabular-nums text-[var(--theme-modal-text)]/60"
                                >{(entry.totalMultiplier * 100).toFixed(1)}%</td
                            >
                            <td class="py-1.5 px-3 text-right tabular-nums text-indigo-300 font-medium"
                                >{Math.round(entry.expectedPerHit).toLocaleString()}</td
                            >
                            <td class="py-1.5 w-8"></td>
                        </tr>
                        {#if expandedEntry === entry.id}
                            {@const baseATK = Math.round((charInfoMap[entry.character]?.lv90BaseStats?.atk ?? 0) + (weaponInfoMap[team.find((s) => s.character === entry.character)?.weapon ?? '']?.lv90BaseAtk ?? 0))}
                            {@const baseHP = Math.round(charInfoMap[entry.character]?.lv90BaseStats?.hp ?? 0)}
                            {@const baseDEF = Math.round(charInfoMap[entry.character]?.lv90BaseStats?.def ?? 0)}
                            {@const step1 = entry.baseValue}
                            {@const step2 = step1 * (1 + entry.dmgBonus) * (1 + entry.deepen) * (1 + entry.vulnerability) * (1 + entry.finalHarmony) * (1 + entry.finalDmg) * entry.customMult}
                            {@const step3 = step2 * entry.defMulti * entry.resMulti * entry.dmgRedMulti}
                            {@const step4 = step3 * (1 + entry.critRate * entry.critDmg)}
                            <tr class="bg-white/[0.02]">
                                <td colspan="8" class="p-0">
                                    <div class="border-b border-white/5 px-6 py-3 space-y-2 text-xs text-[var(--theme-modal-text)]/60 font-mono">
                                        <div class="text-indigo-400 font-semibold font-sans">① 基础属性</div>
                                        {#if entry.baseUnit === 'ATK'}
                                            <div class="pl-3">白值 {baseATK} (角色{Math.round(charInfoMap[entry.character]?.lv90BaseStats?.atk ?? 0)} + 武器{Math.round(weaponInfoMap[team.find((s) => s.character === entry.character)?.weapon ?? '']?.lv90BaseAtk ?? 0)})</div>
                                            <div class="pl-3">百分比 {entry.atkPctSum.toFixed(1)}% = {Math.round(baseATK * entry.atkPctSum / 100)}</div>
                                            <div class="pl-3">固定值 {entry.atkFlatSum}</div>
                                            <div class="pl-3 text-[var(--theme-modal-text)]">总ATK = {baseATK} × (1 + {entry.atkPctSum.toFixed(1)}%) + {entry.atkFlatSum} = {entry.totalAtk}</div>
                                            <div class="pl-3">× 倍率 {(entry.ratioNum * 100).toFixed(2)}% = {Math.round(step1)}</div>
                                        {:else if entry.baseUnit === 'HP'}
                                            <div class="pl-3">白值 {baseHP}</div>
                                            <div class="pl-3">百分比 {entry.hpPctSum.toFixed(1)}% = {Math.round(baseHP * entry.hpPctSum / 100)}</div>
                                            <div class="pl-3">固定值 {entry.hpFlatSum}</div>
                                            <div class="pl-3 text-[var(--theme-modal-text)]">总HP = {baseHP} × (1 + {entry.hpPctSum.toFixed(1)}%) + {entry.hpFlatSum} = {entry.totalHp}</div>
                                            <div class="pl-3">× 倍率 {(entry.ratioNum * 100).toFixed(2)}% = {Math.round(step1)}</div>
                                        {:else if entry.baseUnit === 'DEF'}
                                            <div class="pl-3">白值 {baseDEF}</div>
                                            <div class="pl-3">百分比 {entry.defPctSum.toFixed(1)}% = {Math.round(baseDEF * entry.defPctSum / 100)}</div>
                                            <div class="pl-3">固定值 {entry.defFlatSum}</div>
                                            <div class="pl-3 text-[var(--theme-modal-text)]">总DEF = {baseDEF} × (1 + {entry.defPctSum.toFixed(1)}%) + {entry.defFlatSum} = {entry.totalDef}</div>
                                            <div class="pl-3">× 倍率 {(entry.ratioNum * 100).toFixed(2)}% = {Math.round(step1)}</div>
                                        {:else if entry.baseUnit === 'TUNE'}
                                            <div class="pl-3">基础谐度 {Math.round(charInfoMap[entry.character]?.lv90BaseStats?.tune ?? 0)}</div>
                                            <div class="pl-3 text-[var(--theme-modal-text)]">总谐度 = {entry.totalTune}</div>
                                            <div class="pl-3">× 倍率 {(entry.ratioNum * 100).toFixed(2)}% = {Math.round(step1)}</div>
                                        {:else if entry.baseUnit === '固定'}
                                            <div class="pl-3">固定值 {Math.round(step1)}</div>
                                        {:else if entry.baseUnit === '异常'}
                                            <div class="pl-3">异常基础值 × 倍率 {(entry.ratioNum * 100).toFixed(2)}% = {Math.round(step1)}</div>
                                        {/if}

                                        <div class="text-indigo-400 font-semibold font-sans pt-1">② 倍率×增伤×加深×易伤×集谐×终伤×特殊</div>
                                        <div class="pl-3">
                                            {Math.round(step1)} ×
                                            {(1 + entry.dmgBonus).toFixed(4)}(增伤) ×
                                            {(1 + entry.deepen).toFixed(4)}(加深) ×
                                            {(1 + entry.vulnerability).toFixed(4)}(易伤) ×
                                            {(1 + entry.finalHarmony).toFixed(4)}(集谐) ×
                                            {(1 + entry.finalDmg).toFixed(4)}(终伤) ×
                                            {entry.customMult.toFixed(4)}(特殊)
                                            = {Math.round(step2).toLocaleString()}
                                        </div>

                                        <div class="text-indigo-400 font-semibold font-sans pt-1">③ 三大敌人抵抗系数</div>
                                        <div class="pl-3">
                                            {Math.round(step2).toLocaleString()} ×
                                            {entry.defMulti.toFixed(4)}(防御) ×
                                            {entry.resMulti.toFixed(4)}(抗性) ×
                                            {entry.dmgRedMulti.toFixed(4)}(免伤)
                                            = {Math.round(step3).toLocaleString()}
                                        </div>

                                        <div class="text-indigo-400 font-semibold font-sans pt-1">④ 暴击因子</div>
                                        <div class="pl-3">
                                            {Math.round(step3).toLocaleString()} ×
                                            (1 + {(entry.critRate * 100).toFixed(1)}% × {(entry.critDmg * 100).toFixed(1)}%)
                                            = {Math.round(step4).toLocaleString()}
                                        </div>

                                        <div class="text-indigo-400 font-semibold font-sans pt-1">⑤ 以上 × 段数</div>
                                        <div class="pl-3">
                                            {Math.round(step4).toLocaleString()}
                                            {#if entry.hits > 1}
                                                × {entry.hits}段
                                            {/if}
                                            = <span class="text-indigo-300 font-bold">{Math.round(entry.expectedPerHit).toLocaleString()}</span>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        {/if}
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>
