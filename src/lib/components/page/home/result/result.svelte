<script lang="ts">
    import type { CharSlot } from '$lib/data/types'
    import type { CalcState } from '../calculation/calculation.types'
    import type { ConfigState } from '../config/config.types'
    import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
    import { getCharacterInfo, getWeaponInfo, getCharacterIcons, getWeaponIcons } from '$lib/data/api'
    import { getCharElementMap } from '../timeline/timeline.store.svelte'
    import { ELEMENT_COLORS } from '../timeline/timeline.consts'
    import type { ResultEntry } from './result.types'
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
        entries = []
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
                            {@const baseATK = Math.round(
                                (charInfoMap[entry.character]?.lv90BaseStats?.atk ?? 0) +
                                    (weaponInfoMap[team.find((s) => s.character === entry.character)?.weapon ?? '']
                                        ?.lv90BaseAtk ?? 0)
                            )}
                            {@const baseHP = Math.round(charInfoMap[entry.character]?.lv90BaseStats?.hp ?? 0)}
                            {@const baseDEF = Math.round(charInfoMap[entry.character]?.lv90BaseStats?.def ?? 0)}
                            {@const step1 = entry.baseValue}
                            {@const step2 =
                                step1 *
                                (1 + entry.dmgBonus) *
                                (1 + entry.deepen) *
                                (1 + entry.vulnerability) *
                                (1 + entry.finalHarmony) *
                                (1 + entry.finalDmg) *
                                entry.customMult}
                            {@const step3 = step2 * entry.defMulti * entry.resMulti * entry.dmgRedMulti}
                            {@const step4 = step3 * (1 + entry.critRate * entry.critDmg)}
                            <tr class="bg-white/[0.02]">
                                <td colspan="8" class="p-0">
                                    <div
                                        class="border-b border-white/5 px-6 py-3 space-y-2 text-xs text-[var(--theme-modal-text)]/60 font-mono"
                                    >
                                        <div class="text-indigo-400 font-semibold font-sans">① 基础属性</div>
                                        {#if entry.baseUnit === 'ATK'}
                                            <div class="pl-3">
                                                白值 {baseATK} (角色{Math.round(
                                                    charInfoMap[entry.character]?.lv90BaseStats?.atk ?? 0
                                                )} + 武器{Math.round(
                                                    weaponInfoMap[
                                                        team.find((s) => s.character === entry.character)?.weapon ?? ''
                                                    ]?.lv90BaseAtk ?? 0
                                                )})
                                            </div>
                                            <div class="pl-3">
                                                百分比 {entry.atkPctSum.toFixed(1)}% = {Math.round(
                                                    (baseATK * entry.atkPctSum) / 100
                                                )}
                                            </div>
                                            <div class="pl-3">固定值 {entry.atkFlatSum}</div>
                                            <div class="pl-3 text-[var(--theme-modal-text)]">
                                                总ATK = {baseATK} × (1 + {entry.atkPctSum.toFixed(1)}%) + {entry.atkFlatSum}
                                                = {entry.totalAtk}
                                            </div>
                                            <div class="pl-3">
                                                × 倍率 {(entry.ratioNum * 100).toFixed(2)}% = {Math.round(step1)}
                                            </div>
                                        {:else if entry.baseUnit === 'HP'}
                                            <div class="pl-3">白值 {baseHP}</div>
                                            <div class="pl-3">
                                                百分比 {entry.hpPctSum.toFixed(1)}% = {Math.round(
                                                    (baseHP * entry.hpPctSum) / 100
                                                )}
                                            </div>
                                            <div class="pl-3">固定值 {entry.hpFlatSum}</div>
                                            <div class="pl-3 text-[var(--theme-modal-text)]">
                                                总HP = {baseHP} × (1 + {entry.hpPctSum.toFixed(1)}%) + {entry.hpFlatSum} =
                                                {entry.totalHp}
                                            </div>
                                            <div class="pl-3">
                                                × 倍率 {(entry.ratioNum * 100).toFixed(2)}% = {Math.round(step1)}
                                            </div>
                                        {:else if entry.baseUnit === 'DEF'}
                                            <div class="pl-3">白值 {baseDEF}</div>
                                            <div class="pl-3">
                                                百分比 {entry.defPctSum.toFixed(1)}% = {Math.round(
                                                    (baseDEF * entry.defPctSum) / 100
                                                )}
                                            </div>
                                            <div class="pl-3">固定值 {entry.defFlatSum}</div>
                                            <div class="pl-3 text-[var(--theme-modal-text)]">
                                                总DEF = {baseDEF} × (1 + {entry.defPctSum.toFixed(1)}%) + {entry.defFlatSum}
                                                = {entry.totalDef}
                                            </div>
                                            <div class="pl-3">
                                                × 倍率 {(entry.ratioNum * 100).toFixed(2)}% = {Math.round(step1)}
                                            </div>
                                        {:else if entry.baseUnit === 'TUNE'}
                                            <div class="pl-3">
                                                基础谐度 {Math.round(
                                                    charInfoMap[entry.character]?.lv90BaseStats?.tune ?? 0
                                                )}
                                            </div>
                                            <div class="pl-3 text-[var(--theme-modal-text)]">
                                                总谐度 = {entry.totalTune}
                                            </div>
                                            <div class="pl-3">
                                                × 倍率 {(entry.ratioNum * 100).toFixed(2)}% = {Math.round(step1)}
                                            </div>
                                        {:else if entry.baseUnit === '固定'}
                                            <div class="pl-3">固定值 {Math.round(step1)}</div>
                                        {:else if entry.baseUnit === '异常'}
                                            <div class="pl-3">
                                                异常基础值 × 倍率 {(entry.ratioNum * 100).toFixed(2)}% = {Math.round(
                                                    step1
                                                )}
                                            </div>
                                        {/if}

                                        <div class="text-indigo-400 font-semibold font-sans pt-1">
                                            ② 倍率×增伤×加深×易伤×集谐×终伤×特殊
                                        </div>
                                        <div class="pl-3">
                                            {Math.round(step1)} ×
                                            {(1 + entry.dmgBonus).toFixed(4)}(增伤) ×
                                            {(1 + entry.deepen).toFixed(4)}(加深) ×
                                            {(1 + entry.vulnerability).toFixed(4)}(易伤) ×
                                            {(1 + entry.finalHarmony).toFixed(4)}(集谐) ×
                                            {(1 + entry.finalDmg).toFixed(4)}(终伤) ×
                                            {entry.customMult.toFixed(4)}(特殊) = {Math.round(step2).toLocaleString()}
                                        </div>

                                        <div class="text-indigo-400 font-semibold font-sans pt-1">
                                            ③ 三大敌人抵抗系数
                                        </div>
                                        <div class="pl-3">
                                            {Math.round(step2).toLocaleString()} ×
                                            {entry.defMulti.toFixed(4)}(防御) ×
                                            {entry.resMulti.toFixed(4)}(抗性) ×
                                            {entry.dmgRedMulti.toFixed(4)}(免伤) = {Math.round(step3).toLocaleString()}
                                        </div>

                                        <div class="text-indigo-400 font-semibold font-sans pt-1">④ 暴击因子</div>
                                        <div class="pl-3">
                                            {Math.round(step3).toLocaleString()} × (1 + {(entry.critRate * 100).toFixed(
                                                1
                                            )}% × {(entry.critDmg * 100).toFixed(1)}%) = {Math.round(
                                                step4
                                            ).toLocaleString()}
                                        </div>

                                        <div class="text-indigo-400 font-semibold font-sans pt-1">⑤ 以上 × 段数</div>
                                        <div class="pl-3">
                                            {Math.round(step4).toLocaleString()}
                                            {#if entry.hits > 1}
                                                × {entry.hits}段
                                            {/if}
                                            =
                                            <span class="text-indigo-300 font-bold"
                                                >{Math.round(entry.expectedPerHit).toLocaleString()}</span
                                            >
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
