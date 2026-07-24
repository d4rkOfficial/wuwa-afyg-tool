<script lang="ts">
    import type { CharSlot, ResultAnalysisData } from '$lib/data/types'
    import type { CalcState } from '../calculation/calculation.types'
    import type { ConfigState } from '../config/config.types'
    import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
    import { getCharacterInfo, getWeaponInfo, getCharacterIcons, getWeaponIcons } from '$lib/data/api'
    import { getCharElementMap } from '../timeline/timeline.store.svelte'
    import { ELEMENT_COLORS } from '../timeline/timeline.consts'
    import { getAllDamageEntries, getCalcState } from '../calculation/calculation.store.svelte'
    import { getConfig } from '../config/config.store.svelte'
    import { getActiveProject, updateResultAnalysis } from '$lib/data/project.svelte'
    import { computeAll as computeAllDamage } from './compute'
    import type { ResultEntry } from './result.types'
    import Icon from '@iconify/svelte'
    import DataAnalysisModal from './data-analysis-modal.svelte'

    interface Props {
        team: [CharSlot, CharSlot, CharSlot]
        calcState: CalcState | null
        configState: ConfigState | null
        refreshKey?: number
    }

    let { team, calcState, configState, refreshKey = 0 }: Props = $props()

    let charInfoMap = $state<Record<string, CharacterInfo>>({})
    let weaponInfoMap = $state<Record<string, WeaponInfo>>({})
    let charIcons = $state<Record<string, string>>({})
    let weaponIcons = $state<Record<string, string>>({})
    let entries = $state<ResultEntry[]>([])
    let loading = $state(true)
    let charElements = $derived(getCharElementMap())
    let resultAnalysis = $derived(getActiveProject()?.resultAnalysis)

    $effect(() => {
        calcState
        configState
        loadData()
    })

    $effect(() => {
        if (refreshKey > 0) computeAll()
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
        const calc = getCalcState()
        const config = getConfig()
        const dmgEntries = getAllDamageEntries()
        if (dmgEntries.length === 0) {
            entries = []
            return
        }
        entries = computeAllDamage(
            dmgEntries,
            calc.buffSets,
            calc.damageEntryBuffSetIds,
            calc.damageEntryDamageTypes,
            config,
            team,
            charInfoMap,
            weaponInfoMap
        )
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
    let showDataAnalysis = $state(false)

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
        <div class="shrink-0 border-b px-5 py-4" style="border-color: var(--theme-divider-border);">
            <div class="flex items-end gap-6">
                <div>
                    <div class="text-[10px] text-[var(--theme-modal-text)]/40 mb-1">总伤害</div>
                    <div class="text-2xl font-bold tabular-nums text-[var(--theme-accent-text)]">
                        {Math.round(totalDamage).toLocaleString()}
                    </div>
                </div>
                {#each charSummaries as cs}
                    <div>
                        <div
                            class="text-[10px] text-[var(--theme-modal-text)]/40 mb-1"
                            style="color: {cs.character
                                ? ((ELEMENT_COLORS as Record<string, string>)[charElements[cs.character]] ?? '#888')
                                : 'var(--theme-modal-text)'}"
                        >
                            {cs.character || '—'}
                        </div>
                        <div class="text-sm font-semibold tabular-nums">
                            {Math.round(cs.totalDamage).toLocaleString()}
                        </div>
                    </div>
                {/each}
                <button
                    onclick={() => (showDataAnalysis = true)}
                    class="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
                    style="background: var(--theme-input-bg); color: var(--theme-accent-text);"
                >
                    <Icon icon="mdi:chart-box-outline" class="size-3.5" />
                    数据分析
                </button>
            </div>
        </div>

        <!-- Detail table -->
        <div class="flex-1 overflow-y-auto">
            <table class="w-full text-xs">
                <thead>
                    <tr
                        class="text-[var(--theme-modal-text)]/50 sticky top-0"
                        style="background: var(--theme-modal-bg); border-bottom: 1px solid var(--theme-divider-border);"
                    >
                        <th class="text-left font-medium py-2 px-3">来源</th>
                        <th class="text-left font-medium py-2 px-3">条目</th>
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
                            class="cursor-pointer border-b transition-colors hover:bg-[var(--theme-modal-text)]/[0.03]"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <td
                                class="py-1.5 px-3"
                                style="color: {entry.character
                                    ? ((ELEMENT_COLORS as Record<string, string>)[charElements[entry.character]] ??
                                      '#888')
                                    : 'var(--theme-modal-text)'}">{entry.character || '—'}</td
                            >
                            <td
                                class="py-1.5 px-3 max-w-48 truncate"
                                title={entry.displayName}
                                style="color: {(ELEMENT_COLORS as Record<string, string>)[entry.element] ?? '#888'}"
                            >
                                {entry.displayName}
                            </td>
                            <td class="py-1.5 px-3 text-right tabular-nums text-[var(--theme-modal-text)]/60"
                                >{Math.round(entry.baseValue).toLocaleString()}</td
                            >
                            <td class="py-1.5 px-3 text-right text-[var(--theme-modal-text)]/60">{entry.baseUnit}</td>
                            <td class="py-1.5 px-3 text-right tabular-nums text-[var(--theme-modal-text)]/60"
                                >{((entry.ratioNum / entry.hits) * 100).toFixed(2)}%{#if entry.hits > 1}
                                    ×{entry.hits}{/if}</td
                            >
                            <td class="py-1.5 px-3 text-right tabular-nums text-[var(--theme-modal-text)]/60"
                                >{(entry.totalMultiplier * 100).toFixed(1)}%</td
                            >
                            <td class="py-1.5 px-3 text-right tabular-nums font-medium text-[var(--theme-accent-text)]"
                                >{Math.round(entry.expectedPerHit).toLocaleString()}</td
                            >
                            <td class="py-1.5 w-8"></td>
                        </tr>
                        {#if expandedEntry === entry.id}
                            {@const s2 = entry.baseValue * (1 + entry.deepen) * (1 + entry.dmgBonus)}
                            {@const s3 = s2 * (1 + entry.critRate * (entry.critDmg - 1)) * (1 + entry.vulnerability)}
                            {@const s4 = s3 * entry.resMulti * entry.dmgRedMulti * entry.defMulti}
                            {@const harmony = 1 + entry.finalHarmony}
                            {@const s5 = s4 * harmony * (1 + entry.finalDmg) * entry.customMult}
                            <tr style="background: var(--theme-input-bg);">
                                <td colspan="8" class="p-0">
                                    <div
                                        class="border-b px-6 py-3 space-y-3 text-xs text-[var(--theme-modal-text)]/60 font-mono"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        {#if entry.baseUnit.startsWith('偏谐系数')}
                                            <!-- Tune entry (处决/响应) -->
                                            <div class="font-semibold font-sans text-[var(--theme-accent-text)]">
                                                ① 基础属性
                                            </div>
                                            <div class="pl-3 space-y-0.5">
                                                <div>
                                                    基础{entry.baseUnit} = {Math.round(entry.baseAtk).toLocaleString()}
                                                </div>
                                                <div>
                                                    × 倍率 {((entry.ratioNum / entry.hits) * 100).toFixed(
                                                        2
                                                    )}%{#if entry.hits > 1}
                                                        ×{entry.hits}{/if} = {Math.round(
                                                        entry.baseValue
                                                    ).toLocaleString()}
                                                </div>
                                            </div>

                                            <div class="font-semibold font-sans text-[var(--theme-accent-text)]">
                                                ② 敌人减免
                                            </div>
                                            <div class="pl-3 space-y-0.5">
                                                <div>抗性区 = {entry.resMulti.toFixed(4)}</div>
                                                <div>免伤区 = {entry.dmgRedMulti.toFixed(4)}</div>
                                                <div>防御区 = {entry.defMulti.toFixed(4)}</div>
                                                <div>
                                                    {Math.round(s3).toLocaleString()} × {entry.resMulti.toFixed(4)} × {entry.dmgRedMulti.toFixed(
                                                        4
                                                    )} × {entry.defMulti.toFixed(4)}
                                                    = {Math.round(s4).toLocaleString()}
                                                </div>
                                            </div>

                                            <div class="font-semibold font-sans text-[var(--theme-accent-text)]">
                                                ③ 谐度增幅 × 终伤 × 特殊
                                            </div>
                                            <div class="pl-3">
                                                {Math.round(s4).toLocaleString()} ×
                                                {harmony.toFixed(4)}(谐度) × (1 + {(entry.finalDmg * 100).toFixed(
                                                    1
                                                )}%)(终伤) ×
                                                {entry.customMult.toFixed(4)}(特殊) = {Math.round(s5).toLocaleString()}
                                            </div>
                                            <div class="pl-3 font-bold text-[var(--theme-accent-text)]">
                                                最终期望 = {Math.round(s5).toLocaleString()}
                                            </div>
                                        {:else if entry.baseUnit === '效应系数'}
                                            <!-- Effect damage entry -->
                                            <div class="font-semibold font-sans text-[var(--theme-accent-text)]">
                                                ① 基础属性
                                            </div>
                                            <div class="pl-3 space-y-0.5">
                                                <div>效应系数 = {entry.baseAtk}</div>
                                                <div>
                                                    × 倍率 {((entry.ratioNum / entry.hits) * 100).toFixed(
                                                        2
                                                    )}%{#if entry.hits > 1}
                                                        ×{entry.hits}{/if} = {Math.round(
                                                        entry.baseValue
                                                    ).toLocaleString()}
                                                </div>
                                            </div>

                                            <div class="font-semibold font-sans text-[var(--theme-accent-text)]">
                                                ② 敌人减免
                                            </div>
                                            <div class="pl-3 space-y-0.5">
                                                <div>抗性区 = {entry.resMulti.toFixed(4)}</div>
                                                <div>免伤区 = {entry.dmgRedMulti.toFixed(4)}</div>
                                                <div>防御区 = {entry.defMulti.toFixed(4)}</div>
                                                <div>
                                                    {Math.round(s3).toLocaleString()} × {entry.resMulti.toFixed(4)} × {entry.dmgRedMulti.toFixed(
                                                        4
                                                    )} × {entry.defMulti.toFixed(4)}
                                                    = {Math.round(s4).toLocaleString()}
                                                </div>
                                            </div>

                                            <div class="font-semibold font-sans text-[var(--theme-accent-text)]">
                                                ③ 终伤 × 特殊
                                            </div>
                                            <div class="pl-3">
                                                {Math.round(s4).toLocaleString()} × (1 + {(
                                                    entry.finalDmg * 100
                                                ).toFixed(1)}%)(终伤) ×
                                                {entry.customMult.toFixed(4)}(特殊) = {Math.round(s5).toLocaleString()}
                                            </div>
                                            <div class="pl-3 font-bold text-[var(--theme-accent-text)]">
                                                最终期望 = {Math.round(s5).toLocaleString()}
                                            </div>
                                        {:else}
                                            <!-- Direct damage entry -->
                                            <div class="font-semibold font-sans text-[var(--theme-accent-text)]">
                                                ① 基础属性
                                            </div>
                                            <div class="pl-3 space-y-0.5">
                                                {#if entry.baseUnit === '攻击'}
                                                    <div>
                                                        总ATK = {entry.baseAtk} × (1 + {entry.atkPctSum.toFixed(1)}%) + {entry.atkFlatSum}
                                                        = {entry.totalAtk}
                                                    </div>
                                                {:else if entry.baseUnit === '生命'}
                                                    <div>
                                                        总HP = {entry.totalHp}
                                                    </div>
                                                {:else if entry.baseUnit === '防御'}
                                                    <div>
                                                        总DEF = {entry.totalDef}
                                                    </div>
                                                {:else if entry.baseUnit === '固定'}
                                                    <div>固定值 {Math.round(entry.baseValue)}</div>
                                                {/if}
                                                {#if entry.baseUnit !== '固定'}
                                                    <div>
                                                        × 倍率 {((entry.ratioNum / entry.hits) * 100).toFixed(
                                                            2
                                                        )}%{#if entry.hits > 1}
                                                            ×{entry.hits}{/if} = {Math.round(
                                                            entry.baseValue
                                                        ).toLocaleString()}
                                                    </div>
                                                {/if}
                                            </div>

                                            {#if entry.baseUnit === '固定'}
                                                <div class="pl-3 font-bold text-[var(--theme-accent-text)]">
                                                    最终期望 = {Math.round(entry.baseValue).toLocaleString()}
                                                </div>
                                            {:else}
                                                <div class="font-semibold font-sans text-[var(--theme-accent-text)]">
                                                    ② 加深 × 加成
                                                </div>
                                                <div class="pl-3">
                                                    {Math.round(entry.baseValue).toLocaleString()} × (1 + {(
                                                        entry.deepen * 100
                                                    ).toFixed(1)}%)(加深) × (1 + {(entry.dmgBonus * 100).toFixed(
                                                        1
                                                    )}%)(加成) = {Math.round(s2).toLocaleString()}
                                                </div>

                                                <div class="font-semibold font-sans text-[var(--theme-accent-text)]">
                                                    ③ 暴击期望 × 易伤
                                                </div>
                                                <div class="pl-3">
                                                    {Math.round(s2).toLocaleString()} × ((1 - {(
                                                        entry.critRate * 100
                                                    ).toFixed(1)}%) + {(entry.critRate * 100).toFixed(1)}% × {(
                                                        entry.critDmg * 100
                                                    ).toFixed(1)}%)(暴击) × (1 + {(entry.vulnerability * 100).toFixed(
                                                        1
                                                    )}%)(易伤) = {Math.round(s3).toLocaleString()}
                                                </div>

                                                <div class="font-semibold font-sans text-[var(--theme-accent-text)]">
                                                    ④ 抗性区 × 免伤区 × 防御区
                                                </div>
                                                <div class="pl-3 space-y-0.5">
                                                    <div>抗性区 = {entry.resMulti.toFixed(4)}</div>
                                                    <div>免伤区 = {entry.dmgRedMulti.toFixed(4)}</div>
                                                    <div>防御区 = {entry.defMulti.toFixed(4)}</div>
                                                    <div>
                                                        {Math.round(s3).toLocaleString()} × {entry.resMulti.toFixed(4)} ×
                                                        {entry.dmgRedMulti.toFixed(4)} × {entry.defMulti.toFixed(4)}
                                                        = {Math.round(s4).toLocaleString()}
                                                    </div>
                                                </div>

                                                <div class="font-semibold font-sans text-[var(--theme-accent-text)]">
                                                    ⑤ 集谐 × 终伤 × 特殊
                                                </div>
                                                <div class="pl-3">
                                                    {Math.round(s4).toLocaleString()} ×
                                                    {harmony.toFixed(4)}(集谐) × (1 + {(entry.finalDmg * 100).toFixed(
                                                        1
                                                    )}%)(终伤) ×
                                                    {entry.customMult.toFixed(4)}(特殊) = {Math.round(
                                                        s5
                                                    ).toLocaleString()}
                                                </div>
                                                <div class="pl-3 font-bold text-[var(--theme-accent-text)]">
                                                    最终期望 = {Math.round(s5).toLocaleString()}
                                                </div>
                                            {/if}
                                        {/if}
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

{#if showDataAnalysis && entries.length}
    <DataAnalysisModal
        {entries}
        {charSummaries}
        {team}
        {totalDamage}
        {resultAnalysis}
        onUpdateResultAnalysis={(data) => updateResultAnalysis(data)}
        onclose={() => (showDataAnalysis = false)}
    />
{/if}
