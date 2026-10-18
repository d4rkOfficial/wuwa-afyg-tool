<script lang="ts">
    /**
     * @desc 数据分析 → 贡献分析（角色页签 + 左右两栏）。
     *
     * 左栏副词条（三种算法可切换）、右栏 Buff（按移除损失计算）。把「角色」提到页签上，
     * 是因为 Buff 清单动辄几十条：三角色并排的窄栏放不下，逐角色看才有足够宽度。
     * 右栏高度跟随左栏（等高 + 内部滚动），两栏底边对齐。
     */
    import Icon from '@iconify/svelte'
    import { getCharElementMap, getCharIconMap } from '$lib/calc/timeline.store.svelte'
    import type { CharBuffAnalysis, CharSubstatAnalysis } from '$lib/calc/result.types'
    import type { CharSlot } from '$lib/types/project'
    import type { AlgorithmId, AlgorithmInfo } from '$lib/calc/substat-algorithms/types'
    import { fallbackIcon } from '$lib/utils/icons'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import SubstatContribution from './substat-contribution.svelte'
    import BuffContribution from './buff-contribution.svelte'

    interface Props extends ComponentsProps {
        team: [CharSlot, CharSlot, CharSlot]
        substatAnalysis: CharSubstatAnalysis[]
        buffAnalysis: CharBuffAnalysis[]
        algorithmsInfo: AlgorithmInfo[]
        selectedAlgorithm: AlgorithmId
        substatComputing: boolean
        buffComputing: boolean
        onSelectAlgorithm: (id: AlgorithmId) => void
    }

    let {
        team,
        substatAnalysis,
        buffAnalysis,
        algorithmsInfo,
        selectedAlgorithm,
        substatComputing,
        buffComputing,
        onSelectAlgorithm,
        class: className,
        style: styleProp
    }: Props = $props()

    let charElements = $derived(getCharElementMap())
    let charIcons = $derived(getCharIconMap())

    /** @desc 角色主题色（与词条配置页的角色页签同一套取色） */
    const colorOf = (name: string): string => {
        const el = charElements[name]
        return el ? `var(--theme-element-${el})` : '#71717a'
    }

    /**
     * @desc 角色清单：**先按队伍槽位**（分析未回来时页签也能先渲染，数量不跳动），
     * 再把结果里出现的额外角色追加在后面（理论上不会出现，属兜底）。
     */
    let characters = $derived.by(() => {
        const teamNames = team.map((slot) => slot.character).filter((c): c is string => !!c)
        const resultNames = [
            ...new Set([...buffAnalysis.map((b) => b.character), ...substatAnalysis.map((s) => s.character)])
        ]
        return [...teamNames, ...resultNames.filter((name) => !teamNames.includes(name))]
    })

    let picked = $state<string | null>(null)

    /** @desc 全部分析结果已到齐（未到齐时不要按「最高伤害」选人，否则随着结果分批到达会跳角色） */
    let allDone = $derived(buffAnalysis.length >= characters.length)

    /** @desc 默认选中「当前总伤最高」的角色（结果未齐 / 没有结果时回落到队伍首位） */
    let defaultCharacter = $derived.by(() => {
        if (!allDone) return characters[0] ?? ''
        const best = [...buffAnalysis].sort((a, b) => b.totalDamageNorm - a.totalDamageNorm)[0]
        return best?.character ?? characters[0] ?? ''
    })

    let activeCharacter = $derived(
        picked && characters.includes(picked) ? picked : characters[0] ? defaultCharacter : ''
    )

    let activeSubstat = $derived(substatAnalysis.find((s) => s.character === activeCharacter))
    let activeBuff = $derived(buffAnalysis.find((b) => b.character === activeCharacter))

    /** @desc 左栏实测高度：右栏（Buff）按它定高并内部滚动，两栏底边对齐 */
    let leftHeight = $state(0)
</script>

<section class={mergeClass(['space-y-3', className])} style={styleProp}>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div class="flex items-center gap-2">
            <Icon icon="mdi:chart-timeline-variant" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <h3 class="text-base font-black tracking-tight" style="color: var(--theme-modal-text);">直伤贡献分析</h3>
        </div>
        <!-- 角色页签：与「词条配置」页的角色页签同一套样式（元素色描边 + 头像） -->
        <div class="flex flex-wrap items-center gap-2">
            {#each characters as name (name)}
                {@const active = name === activeCharacter}
                {@const color = colorOf(name)}
                <button
                    onclick={() => (picked = name)}
                    class={[
                        'flex items-center gap-2 rounded-none border px-3 py-1.5 text-xs font-black tracking-tight transition-colors',
                        active
                            ? 'border-current'
                            : 'border-transparent text-(--theme-modal-text)/40 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/70'
                    ].join(' ')}
                    style={active ? `background: color-mix(in srgb, ${color} 18%, transparent); color: ${color};` : ''}
                >
                    {#if charIcons[name]}
                        <img
                            src={charIcons[name]}
                            alt=""
                            use:fallbackIcon={'/icons/placeholder-character.svg'}
                            class="size-5 shrink-0 rounded-full"
                        />
                    {:else}
                        <span
                            class="flex size-5 shrink-0 items-center justify-center rounded-full bg-(--theme-modal-text)/10 text-[10px]"
                            >{name.charAt(0)}</span
                        >
                    {/if}
                    <span>{name}</span>
                </button>
            {/each}
        </div>
        <span class="text-[10px]" style="color: var(--theme-modal-text); opacity: 0.45;">
            统计该角色全部伤害条目（含处决 / 响应 / 偏谐）；副词条与 Buff 的算法说明见各栏「?」
        </span>
    </div>

    {#if characters.length === 0}
        <div
            class="rounded-none border py-10 text-center text-xs"
            style="border-color: var(--theme-divider-border); color: var(--theme-modal-text); opacity: 0.4;"
        >
            {substatComputing || buffComputing ? '计算中…' : '暂无数据'}
        </div>
    {:else}
        <!-- 宽屏并排两栏（右栏等高滚动）；窄屏上下堆叠 -->
        <div class="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
            <div class="min-w-0" bind:clientHeight={leftHeight}>
                <SubstatContribution
                    analysis={activeSubstat}
                    {algorithmsInfo}
                    {selectedAlgorithm}
                    computing={substatComputing}
                    {onSelectAlgorithm}
                />
            </div>
            <BuffContribution analysis={activeBuff} computing={buffComputing} height={leftHeight} />
        </div>
    {/if}
</section>
