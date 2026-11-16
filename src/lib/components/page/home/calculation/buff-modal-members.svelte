<script lang="ts">
    /**
     * @desc 右列「生效成员」tab：三张角色卡 + 一张效应卡（四态作用域）。
     *
     * 四态的界面叫法（全项目统一）：**通用**（三名角色 + 效应）/ **全队**（只有三名角色）/
     * **仅效应** / 指定角色子集。
     *
     * 状态机由 `buff-modal.utils` 的 `nextScopeAfterCharToggle` / `nextScopeAfterEffectToggle` 给出
     * （纯函数、可单测），本组件只负责把点击换算成新作用域并交回父组件：
     * - 勾效应 = 通用；从通用取消效应 = 全队；仅效应取消效应 = 禁止（返回 null）
     * - 取消最后一个角色 = 仅效应；永远不会产生「一个成员都没有」
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { CharSlot } from '$lib/types/project'
    import type { BuffConf } from '$lib/calc/calculation.types'
    import { classifyBuffScope } from '$lib/calc/calculation.consts'
    import { addToast } from '$lib/data/toast.svelte'
    import { fallbackIcon } from '$lib/utils/icons'
    import { mergeClass } from '$lib/utils/component-style'
    import {
        checkedCharsIn,
        effectCheckedIn,
        nextScopeAfterCharToggle,
        nextScopeAfterEffectToggle
    } from './buff-modal.utils'

    interface Props extends ComponentsProps {
        /** @desc 当前 Buff（作用域来源） */
        buff: BuffConf
        team: [CharSlot, CharSlot, CharSlot]
        charIconMap: Record<string, string>
        /** @desc 作用域是否只读（全局 Buff 的受益者被锁定） */
        locked: boolean
        /** @desc 提交新作用域 */
        onscope: (scope: 'all' | number[]) => void
    }

    let { buff, team, charIconMap, locked, onscope, class: className, style: styleProp }: Props = $props()

    const scopeClass = $derived(classifyBuffScope(buff.scope, team.length))
    const chars = $derived(checkedCharsIn(buff.scope, team.length))
    const hasEffect = $derived(effectCheckedIn(buff.scope))

    /** @desc 当前作用域的一句话说明（四态：通用 / 全队 / 仅效应 / 指定角色） */
    const scopeSummary = $derived.by(() => {
        if (scopeClass.kind === 'all') return '通用：三名角色 + 效应伤害'
        if (scopeClass.kind === 'charsAll') return '全队：只对三名角色的伤害生效，不含效应伤害'
        if (scopeClass.kind === 'effect') return '效应专属：只对效应伤害生效'
        const names = scopeClass.idxs.map((i) => team[i]?.character ?? `角色${i + 1}`).join('、')
        return `指定角色：${names}`
    })

    /** @desc 切换单个角色：状态机保证「永远不会一个成员都没有」 */
    const toggleChar = (idx: number) => {
        if (locked) return
        onscope(nextScopeAfterCharToggle(buff.scope, idx, team.length))
    }

    const toggleEffect = () => {
        if (locked) return
        const next = nextScopeAfterEffectToggle(buff.scope, team.length)
        if (next === null) {
            addToast('至少要保留一个生效成员，不能取消仅效应', 'info')
            return
        }
        onscope(next)
    }

    /** @desc 卡片通用类名（选中 = 主题色描边 + 半透明底，未选 = 灰） */
    const cardClass = (on: boolean): string =>
        [
            'flex flex-col items-center justify-center gap-1.5 border px-2 py-3 text-[11px] transition-all',
            locked ? 'cursor-not-allowed opacity-60' : 'hover:border-(--theme-accent-bg)',
            on
                ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10 text-(--theme-accent-text)'
                : 'border-(--theme-divider-border) text-(--theme-modal-text)/50'
        ].join(' ')
</script>

<div class={mergeClass(['flex flex-1 flex-col gap-3 overflow-y-auto p-3', className])} style={styleProp}>
    <div class="flex flex-wrap items-center gap-2 text-[11px] text-(--theme-modal-text)/60">
        <Icon icon="mdi:account-group-outline" class="size-3.5 shrink-0" style="color: var(--theme-accent-text);" />
        <span class="text-xs font-black tracking-tight text-(--theme-modal-text)">这些伤害源可以吃到</span>
        <span class="min-w-0 truncate">· {scopeSummary}</span>
    </div>

    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {#each team as slot, i (i)}
            {@const on = chars.includes(i)}
            <button type="button" onclick={() => toggleChar(i)} class={cardClass(on)} disabled={locked}>
                <span class="relative flex size-10 items-center justify-center overflow-hidden rounded-full border">
                    {#if slot.character && charIconMap[slot.character]}
                        <img
                            src={charIconMap[slot.character]}
                            alt={slot.character}
                            draggable="false"
                            use:fallbackIcon={'/icons/placeholder-character.svg'}
                            class={['h-full w-full object-cover', on ? '' : 'grayscale'].join(' ')}
                        />
                    {:else}
                        <span class="text-[10px] font-medium text-(--theme-modal-text)/40"
                            >{slot.character?.charAt(0) ?? '?'}</span
                        >
                    {/if}
                </span>
                <span class="max-w-full truncate">{slot.character ?? `角色 ${i + 1}`}</span>
                <span class="flex items-center gap-1 text-[10px]">
                    <Icon icon={on ? 'mdi:checkbox-marked' : 'mdi:checkbox-blank-outline'} class="size-3.5" />
                    角色
                </span>
            </button>
        {/each}
        <button type="button" onclick={toggleEffect} class={cardClass(hasEffect)} disabled={locked}>
            <span
                class="flex size-10 items-center justify-center rounded-full border"
                style="border-color: var(--theme-divider-border);"
            >
                <svg viewBox="0 0 24 24" class="size-5 shrink-0">
                    {#if hasEffect}
                        <path d="M7 2v11h3v9l7-12h-4l4-8H7z" fill="currentColor" />
                    {:else}
                        <path
                            d="M7 2v11h3v9l7-12h-4l4-8H7z"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linejoin="round"
                        />
                    {/if}
                </svg>
            </span>
            <span class="truncate">效应伤害</span>
            <span class="flex items-center gap-1 text-[10px]">
                <Icon icon={hasEffect ? 'mdi:checkbox-marked' : 'mdi:checkbox-blank-outline'} class="size-3.5" />
                效应
            </span>
        </button>
    </div>

    {#if locked}
        <p class="text-[10px] text-(--theme-modal-text)/40">全局 BUFF 的受益者被锁定，需先移出全局再改。</p>
    {/if}
</div>
