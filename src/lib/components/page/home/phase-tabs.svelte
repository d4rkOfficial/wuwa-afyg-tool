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
    }

    let { project, active, onchange, showResult = false, resultEnabled = false, onresult }: Props = $props()

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
    class="flex items-center gap-1 border-b border-white/5 px-4"
    style="background: var(--theme-tabs-bg); color: var(--theme-tabs-text)"
>
    {#each tabs as tab}
        <button
            onclick={() => !tab.disabled && onchange(tab.key)}
            disabled={tab.disabled}
            title={tab.disabled ? tab.disabledReason : ''}
            class={[
                'relative flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors',
                !showResult && tab.locked && active === tab.key
                    ? 'text-emerald-300'
                    : !showResult && active === tab.key
                      ? 'text-indigo-300'
                      : tab.disabled
                        ? 'cursor-not-allowed text-zinc-700'
                        : 'text-zinc-400 hover:text-zinc-200',
                !tab.disabled && 'hover:bg-white/[0.02]'
            ].join(' ')}
        >
            {#if tab.locked}
                <Icon icon="mdi:lock" class="size-3.5 text-emerald-500" />
            {:else if tab.disabled}
                <Icon icon="mdi:lock-outline" class="size-3.5 text-zinc-700" />
            {:else}
                <Icon icon="mdi:lock-open-outline" class="size-3.5 text-zinc-500" />
            {/if}
            {tab.label}
            {#if !showResult && active === tab.key}
                <div class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-indigo-500"></div>
            {/if}
        </button>
    {/each}
    <button
        onclick={onresult}
        disabled={!resultEnabled}
        class={[
            'relative flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors',
            showResult
                ? 'text-indigo-300'
                : resultEnabled
                  ? 'text-indigo-300 hover:bg-white/[0.02]'
                  : 'cursor-not-allowed text-zinc-700'
        ].join(' ')}
        title={resultEnabled ? '' : '请先锁定全部阶段'}
    >
        <Icon icon="mdi:chart-box-outline" class="size-3.5" />
        结果
        {#if showResult}
            <div class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-indigo-500"></div>
        {/if}
    </button>
</div>
