<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { Project, PhaseKey } from '$lib/data/types'
    import { canEditPhase, getPhaseOrder } from '$lib/data/project.svelte'

    interface PhaseTab {
        key: PhaseKey
        label: string
        locked: boolean
        disabled: boolean
        disabledReason: string
    }

    const TAB_LABELS: Record<PhaseKey, string> = {
        team: '队伍配置',
        timeline: '排轴',
        calculation: '拉表',
        config: '词条/环境配置'
    }

    const TAB_REASONS: Record<PhaseKey, string> = {
        team: '',
        timeline: '等待队伍保存',
        calculation: '等待排轴锁定',
        config: '等待拉表锁定'
    }

    interface Props {
        project: Project
        active: PhaseKey
        onchange: (key: PhaseKey) => void
        showResult?: boolean
        resultEnabled?: boolean
        onresult?: () => void
        onunlock?: (key: PhaseKey) => void
        onlock?: (key: PhaseKey) => void
    }

    let {
        project,
        active,
        onchange,
        showResult = false,
        resultEnabled = false,
        onresult,
        onunlock,
        onlock
    }: Props = $props()

    let tabs = $derived<PhaseTab[]>(
        getPhaseOrder().map((key) => ({
            key,
            label: TAB_LABELS[key],
            locked: project.phases[key]?.locked === true,
            disabled: !canEditPhase(project, key),
            disabledReason: TAB_REASONS[key]
        }))
    )
</script>

<div
    class="flex items-center gap-1 border-b px-4"
    style="background: var(--theme-tabs-bg); color: var(--theme-tabs-text); border-color: var(--theme-divider-border)"
>
    {#each tabs as tab}
        <button
            onclick={() => !tab.disabled && onchange(tab.key)}
            disabled={tab.disabled}
            title={tab.disabled ? tab.disabledReason : ''}
            class={[
                'relative flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors',
                !showResult && tab.locked && active === tab.key
                    ? 'text-emerald-600'
                    : !showResult && active === tab.key
                      ? 'text-(--theme-accent-text)'
                      : tab.disabled
                        ? 'opacity-30 cursor-not-allowed'
                        : 'opacity-60 hover:opacity-100',
                !tab.disabled && 'hover:bg-(--theme-tabs-text)/5'
            ].join(' ')}
        >
            {#if tab.locked}
                <span
                    onclick={(e) => {
                        e.stopPropagation()
                        onunlock?.(tab.key)
                    }}
                    onkeydown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation()
                            onunlock?.(tab.key)
                        }
                    }}
                    role="button"
                    tabindex="0"
                    class="cursor-pointer"
                    title="点击解锁"
                >
                    <Icon icon="mdi:lock" class="size-3.5 text-emerald-600" />
                </span>
            {:else if tab.disabled}
                <Icon icon="mdi:lock-outline" class="size-3.5 opacity-30" />
            {:else}
                <span
                    onclick={(e) => {
                        if (active === tab.key) {
                            e.stopPropagation()
                            onlock?.(tab.key)
                        }
                    }}
                    onkeydown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && active === tab.key) {
                            e.stopPropagation()
                            onlock?.(tab.key)
                        }
                    }}
                    role="button"
                    tabindex="0"
                    class="cursor-pointer"
                    title="点击锁定"
                >
                    <Icon icon="mdi:lock-open-outline" class="size-3.5 opacity-50" />
                </span>
            {/if}
            {tab.label}
            {#if !showResult && active === tab.key}
                <div class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
            {/if}
        </button>
    {/each}
    <button
        onclick={onresult}
        disabled={!resultEnabled}
        class={[
            'relative flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors',
            showResult || resultEnabled ? 'text-(--theme-accent-text)' : 'opacity-30 cursor-not-allowed'
        ].join(' ')}
        title={resultEnabled ? '' : '请先锁定队伍配置'}
    >
        <Icon icon="mdi:chart-box-outline" class="size-3.5" />
        结果
        {#if showResult}
            <div class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
        {/if}
    </button>
</div>
