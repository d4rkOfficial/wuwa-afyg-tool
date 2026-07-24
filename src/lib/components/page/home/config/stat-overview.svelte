<script lang="ts">
    import { onMount } from 'svelte'
    import type { CharSlot } from '$lib/data/types'
    import type { ConfigState } from './config.types'
    import type { CalcState, BuffZoneValue } from '../calculation/calculation.types'
    import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
    import { getCharacterInfo, getWeaponInfo, getCharacterIcons, getWeaponIcons } from '$lib/data/api'
    import {
        ELEMENT_COLORS,
        ELEMENT_ORDER,
        ELEMENT_BONUS_MAP,
        TYPE_BONUS_MAP,
        ELEMENT_MAP,
        WEAPON_SUBSTAT_NAME_MAP,
        SUBSTAT_DECIMAL_TO_PCT
    } from '$lib/consts/game-terms'
    import Icon from '@iconify/svelte'

    interface Props {
        team: [CharSlot, CharSlot, CharSlot]
        configState: ConfigState | null
        calcState: CalcState | null
        onclose: () => void
    }

    let { team, configState, calcState, onclose }: Props = $props()

    let charIcons = $state<Record<string, string>>({})
    let weaponIcons = $state<Record<string, string>>({})
    let charInfoMap = $state<Record<string, CharacterInfo>>({})
    let weaponInfoMap = $state<Record<string, WeaponInfo>>({})
    let loading = $state(true)

    onMount(async () => {
        const charNames = team.map((s) => s.character).filter((c): c is string => c !== null)
        const weaponNames = team.map((s) => s.weapon).filter((w): w is string => w !== null)

        const [ci, wi] = await Promise.all([getCharacterIcons(), getWeaponIcons()])
        charIcons = ci
        weaponIcons = wi

        const infos = await Promise.all(charNames.map((n) => getCharacterInfo(n).catch(() => null)))
        const cmap: Record<string, CharacterInfo> = {}
        for (let i = 0; i < charNames.length; i++) {
            if (infos[i]) cmap[charNames[i]] = infos[i]!
        }
        charInfoMap = cmap

        const wpInfos = await Promise.all(weaponNames.map((n) => getWeaponInfo(n).catch(() => null)))
        const wmap: Record<string, WeaponInfo> = {}
        for (let i = 0; i < weaponNames.length; i++) {
            if (wpInfos[i]) wmap[weaponNames[i]] = wpInfos[i]!
        }
        weaponInfoMap = wmap

        loading = false
    })

    function charElementColor(name: string): string {
        const info = charInfoMap[name]
        if (!info) return '#71717a'
        const el = (ELEMENT_MAP as any)[info.element] ?? ''
        return (ELEMENT_COLORS as Record<string, string>)[el] ?? '#71717a'
    }

    interface CharStats {
        name: string
        weapon: string | null
        atkWhite: number
        atkGreen: number
        atkTotal: number
        hpWhite: number
        hpGreen: number
        hpTotal: number
        defWhite: number
        defGreen: number
        defTotal: number
        tune: number
        recharge: number
        critRate: number
        critDmg: number
        healBonus: number
        elementDmg: Record<string, number>
        typeDmg: Record<string, number>
        bonusDmg: number
    }

    function computeStats(slot: CharSlot, idx: number): CharStats | null {
        if (!slot.character || !charInfoMap[slot.character]) return null
        const charInfo = charInfoMap[slot.character]
        const weaponInfo = weaponInfoMap[slot.weapon ?? ''] ?? null
        const echoes = configState?.characters?.[idx]?.echoes ?? []

        const atkWhite = Math.round(charInfo.lv90BaseStats.atk + (weaponInfo?.lv90BaseAtk ?? 0))
        const hpWhite = Math.round(charInfo.lv90BaseStats.hp)
        const defWhite = Math.round(charInfo.lv90BaseStats.def)

        let flatAtk = 0,
            pctAtk = 0
        let flatHp = 0,
            pctHp = 0
        let flatDef = 0,
            pctDef = 0
        let tune = charInfo.lv90BaseStats.tune
        let recharge = 100
        let critRate = 5
        let critDmg = 150
        let healBonus = 0
        let elementDmg: Record<string, number> = {}
        let typeDmg: Record<string, number> = {}
        let bonusDmg = 0

        function add(type: string, value: number) {
            const canonicalLabel = WEAPON_SUBSTAT_NAME_MAP[type] ?? type
            let canonicalValue = value
            if (SUBSTAT_DECIMAL_TO_PCT.has(canonicalLabel) && value < 1) {
                canonicalValue = value * 100
            }

            switch (canonicalLabel) {
                case '攻击':
                    flatAtk += canonicalValue
                    break
                case '生命':
                    flatHp += canonicalValue
                    break
                case '防御':
                    flatDef += canonicalValue
                    break
                case '攻击%':
                    pctAtk += canonicalValue
                    break
                case '生命%':
                    pctHp += canonicalValue
                    break
                case '防御%':
                    pctDef += canonicalValue
                    break
                case '暴击率':
                    critRate += canonicalValue
                    break
                case '暴击伤害':
                    critDmg += canonicalValue
                    break
                case '共鸣效率':
                    recharge += canonicalValue
                    break
                case '治疗加成':
                    healBonus += canonicalValue
                    break
                default:
                    if (canonicalLabel in ELEMENT_BONUS_MAP) {
                        const el = ELEMENT_BONUS_MAP[canonicalLabel]
                        elementDmg[el] = (elementDmg[el] ?? 0) + canonicalValue
                    } else if (canonicalLabel in TYPE_BONUS_MAP) {
                        const t = TYPE_BONUS_MAP[canonicalLabel]
                        typeDmg[t] = (typeDmg[t] ?? 0) + canonicalValue
                    }
                    break
            }
        }

        if (weaponInfo?.substat?.name) {
            const sv = parseFloat(weaponInfo.substat.value)
            add(weaponInfo.substat.name, sv)
        }

        for (const echo of echoes) {
            if (echo.mainStat) add(echo.mainStat.type, echo.mainStat.value)
            if (echo.secondMainStat) {
                if (echo.secondMainStat.type === '攻击') flatAtk += echo.secondMainStat.value
                else if (echo.secondMainStat.type === '生命') flatHp += echo.secondMainStat.value
            }
            for (const sub of echo.substats) add(sub.type, sub.value)
        }

        const charGlobalId = `global-${slot.character}`
        const globalBuffs = (calcState?.buffSets ?? []).filter((bs) => bs.id === charGlobalId)
        for (const bs of globalBuffs) {
            for (const z of bs.zones) {
                switch (z.zoneId) {
                    case 'atk_flat':
                        flatAtk += z.value
                        break
                    case 'atk_pct':
                        pctAtk += z.value
                        break
                    case 'hp_flat':
                        flatHp += z.value
                        break
                    case 'hp_pct':
                        pctHp += z.value
                        break
                    case 'def_flat':
                        flatDef += z.value
                        break
                    case 'def_pct':
                        pctDef += z.value
                        break
                    case 'crit_rate':
                        critRate += z.value
                        break
                    case 'crit_dmg':
                        critDmg += z.value
                        break
                    case 'recharge':
                        recharge += z.value
                        break
                    case 'harmony_dmg':
                        tune += z.value
                        break
                    case 'bonus_dmg':
                        bonusDmg += z.value
                        break
                }
            }
        }

        const atkGreen = Math.round(flatAtk + (atkWhite * pctAtk) / 100)
        const hpGreen = Math.round(flatHp + (hpWhite * pctHp) / 100)
        const defGreen = Math.round(flatDef + (defWhite * pctDef) / 100)

        return {
            name: slot.character,
            weapon: slot.weapon,
            atkWhite,
            atkGreen,
            atkTotal: atkWhite + atkGreen,
            hpWhite,
            hpGreen,
            hpTotal: hpWhite + hpGreen,
            defWhite,
            defGreen,
            defTotal: defWhite + defGreen,
            tune,
            recharge,
            critRate,
            critDmg,
            healBonus,
            elementDmg,
            typeDmg,
            bonusDmg
        }
    }

    let stats = $derived.by(() =>
        team.map((slot, i) => computeStats(slot, i)).filter((s): s is CharStats => s !== null)
    )
</script>

{#if loading}
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
        onclick={onclose}
    >
        <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
        <div
            class="rounded-xl border p-8 shadow-2xl"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <span class="text-xs text-[var(--theme-modal-text)]/40">加载中…</span>
        </div>
    </div>
{:else}
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
        onclick={onclose}
    >
        <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
        <div
            class="mx-4 max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl border p-6 shadow-2xl"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <!-- Header -->
            <div class="flex items-center justify-between mb-5">
                <span class="text-base font-semibold text-[var(--theme-modal-text)]">角色面板总览</span>
                <button
                    onclick={onclose}
                    class="rounded p-0.5 text-[var(--theme-modal-text)]/40 transition-colors hover:text-[var(--theme-modal-text)]/70"
                >
                    <Icon icon="mdi:close" class="size-5" />
                </button>
            </div>

            <!-- Character panels -->
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {#each stats as s, i}
                    <div
                        class="rounded-xl border p-4"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        <!-- Header -->
                        <div
                            class="flex items-start gap-3 mb-3 pb-3"
                            style="border-bottom: 1px solid var(--theme-divider-border);"
                        >
                            <div class="flex items-center gap-2 shrink-0">
                                {#if charIcons[s.name]}
                                    <img src={charIcons[s.name]} alt={s.name} class="size-10 rounded-full" />
                                {:else}
                                    <div
                                        class="size-10 rounded-full bg-[var(--theme-modal-text)]/10 flex items-center justify-center text-sm"
                                    >
                                        {s.name.charAt(0)}
                                    </div>
                                {/if}
                                <div class="text-sm font-medium" style="color: {charElementColor(s.name)}">
                                    {s.name}
                                </div>
                            </div>
                            {#if s.weapon}
                                <div class="flex items-center gap-2 shrink-0 ml-auto">
                                    <!-- <div>
                                        <div class="text-[11px] text-[var(--theme-modal-text)]/60 truncate text-right">
                                            {s.weapon}
                                        </div>
                                        <div
                                            class="text-[10px] text-[var(--theme-modal-text)]/50 tabular-nums text-right"
                                        >
                                            {weaponInfoMap[s.weapon]?.lv90BaseAtk.toLocaleString() ?? ''}攻
                                            {weaponInfoMap[s.weapon]?.substat
                                                ? `${weaponInfoMap[s.weapon].substat.name}${weaponInfoMap[s.weapon].substat.value}`
                                                : ''}
                                        </div>
                                    </div> -->
                                    {#if weaponIcons[s.weapon]}
                                        <img src={weaponIcons[s.weapon]} alt="" class="size-7" />
                                    {/if}
                                </div>
                            {/if}
                        </div>

                        <!-- Stats -->
                        <div class="space-y-1.5 text-xs">
                            <!-- ATK -->
                            <div class="flex items-center justify-between">
                                <span class="text-[var(--theme-modal-text)]/50">攻击</span>
                                <span class="tabular-nums text-[var(--theme-modal-text)]/80">
                                    {s.atkTotal.toLocaleString()}
                                    <span class="text-[var(--theme-modal-text)]/30">
                                        ({s.atkWhite.toLocaleString()} +
                                    </span><span class="text-[var(--theme-modal-text)]/30 text-green-600"
                                        >{s.atkGreen.toLocaleString()}</span
                                    ><span class="text-[var(--theme-modal-text)]/30">)</span>
                                </span>
                            </div>

                            <!-- HP -->
                            <div class="flex items-center justify-between">
                                <span class="text-[var(--theme-modal-text)]/50">生命</span>
                                <span class="tabular-nums text-[var(--theme-modal-text)]/80">
                                    {s.hpTotal.toLocaleString()}
                                    <span class="text-[var(--theme-modal-text)]/30">
                                        ({s.hpWhite.toLocaleString()} +
                                    </span><span class="text-[var(--theme-modal-text)]/30 text-green-600"
                                        >{s.hpGreen.toLocaleString()}</span
                                    ><span class="text-[var(--theme-modal-text)]/30">)</span>
                                </span>
                            </div>

                            <!-- DEF -->
                            <div class="flex items-center justify-between">
                                <span class="text-[var(--theme-modal-text)]/50">防御</span>
                                <span class="tabular-nums text-[var(--theme-modal-text)]/80">
                                    {s.defTotal.toLocaleString()}
                                    <span class="text-[var(--theme-modal-text)]/30">
                                        ({s.defWhite.toLocaleString()} +
                                    </span><span class="text-[var(--theme-modal-text)]/30 text-green-600"
                                        >{s.defGreen.toLocaleString()}</span
                                    ><span class="text-[var(--theme-modal-text)]/30">)</span>
                                </span>
                            </div>

                            <!-- Tune -->
                            <div class="flex items-center justify-between">
                                <span class="text-[var(--theme-modal-text)]/50">谐度破坏增幅</span>
                                <span class="tabular-nums text-[var(--theme-modal-text)]/80">{s.tune}</span>
                            </div>

                            <!-- Recharge -->
                            <div class="flex items-center justify-between">
                                <span class="text-[var(--theme-modal-text)]/50">共鸣效率</span>
                                <span class="tabular-nums text-[var(--theme-modal-text)]/80"
                                    >{s.recharge.toFixed(1)}%</span
                                >
                            </div>

                            <!-- Crit rate + dmg on one line -->
                            <div class="flex items-center justify-between">
                                <span class="text-[var(--theme-modal-text)]/50">暴击 / 暴击伤害</span>
                                <span class="tabular-nums text-[var(--theme-modal-text)]/80">
                                    {s.critRate.toFixed(1)}% / {s.critDmg.toFixed(1)}%
                                </span>
                            </div>

                            <!-- Heal bonus -->
                            {#if s.healBonus > 0}
                                <div class="flex items-center justify-between">
                                    <span class="text-[var(--theme-modal-text)]/50">治疗加成</span>
                                    <span class="tabular-nums text-[var(--theme-modal-text)]/80">+{s.healBonus}%</span>
                                </div>
                            {/if}

                            <!-- Element dmg bonuses -->
                            {#each ELEMENT_ORDER as el}
                                {@const v = s.elementDmg[el]}
                                {#if v && v > 0}
                                    <div class="flex items-center justify-between">
                                        <span class="text-[var(--theme-modal-text)]/50">{el}伤害加成</span>
                                        <span
                                            class="tabular-nums"
                                            style="color: {(ELEMENT_COLORS as Record<string, string>)[el]}">+{v}%</span
                                        >
                                    </div>
                                {/if}
                            {/each}

                            <!-- Type dmg bonuses -->
                            {#each Object.entries(s.typeDmg) as [type, v]}
                                {#if v > 0}
                                    <div class="flex items-center justify-between">
                                        <span class="text-[var(--theme-modal-text)]/50">{type}伤害加成</span>
                                        <span class="tabular-nums text-[var(--theme-modal-text)]/80">+{v}%</span>
                                    </div>
                                {/if}
                            {/each}

                            <!-- Bonus dmg -->
                            {#if s.bonusDmg > 0}
                                <div
                                    class="flex items-center justify-between pt-1"
                                    style="border-top: 1px solid var(--theme-divider-border);"
                                >
                                    <span class="text-[var(--theme-modal-text)]/50">全伤害加成</span>
                                    <span class="tabular-nums text-[var(--theme-accent-text)]">+{s.bonusDmg}%</span>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    </div>
{/if}
