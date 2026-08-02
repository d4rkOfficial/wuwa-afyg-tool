<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { Project, PhaseKey } from '$lib/data/types'
    import { canEditPhase, getPhaseOrder } from '$lib/data/project.svelte'
    import { openHelp } from '$lib/data/help.svelte'

    let workflowHelpItems = [
        {
            name: '关于本工具',
            description: '鸣潮工具箱，一个适合所有鸣潮玩家的排轴、拉表、配装、计算一体化工具。',
            content:
                '覆盖完整伤害公式（攻击 × 增伤 × 加深 × 暴击 × 防御 × 抗性 × 免伤等乘区），支持效应伤害、谐度破坏/响应伤害。工作可分步执行，分步导入导出。'
        },
        {
            name: '工作流程（五阶段）',
            description: '每个阶段完成后可以锁定，防止误修改。只有前一个阶段锁定后才能编辑后一个阶段。',
            content:
                '① 队伍配置：选择角色并装备武器、首位声骸、选择声骸套装搭配。\n② 排轴：在时间轴上放置操作块和时间参考线，绑定伤害倍率。支持多角色轨道、变奏入场/切回标记。\n③ 拉表：直伤类型配置、Buff 配置。配置某 Buff 乘区时支持追加/覆盖、支持绝对值和引用值。\n④ 词条/环境：主副词条配置、敌人属性配置。词条和全局 Buff 的效果将显示在本页的角色面板总览中。\n⑤ 结果：伤害表、计算明细、DPS、声骸副词条贡献分析。支持对某条直伤凹暴击。'
        },
        {
            name: '结果页与侧边栏',
            description: '结果页与侧边栏的更多功能。',
            content:
                '结果页可切换多角色数据，展开每段伤害查看完整乘区明细。副词条贡献分析提供三种算法（单条损失、Shapley 值、偏导数提升值），配合期望/凹暴双数据集评估词条价值。DPS 分析通过时间记点计算分段秒伤。\n\n侧边栏管理多个项目：新建、重命名、复制、删除项目，支持项目导出/导入。长按主题图标可调出主题定制面板。'
        }
    ]

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
    class="flex items-center gap-1 border-b px-3"
    style="background: var(--theme-tabs-bg); color: var(--theme-tabs-text); border-color: var(--theme-divider-border)"
>
    {#each tabs as tab}
        {@const isActive = !showResult && active === tab.key}
        <button
            onclick={() => !tab.disabled && onchange(tab.key)}
            disabled={tab.disabled}
            title={tab.disabled ? tab.disabledReason : ''}
            class={[
                'relative flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-sm transition-all',
                isActive
                    ? 'bg-(--theme-accent-bg)/10 text-(--theme-accent-text) font-medium'
                    : tab.disabled
                      ? 'opacity-30 cursor-not-allowed'
                      : 'text-(--theme-tabs-text)/60 hover:bg-(--theme-tabs-text)/5 hover:text-(--theme-tabs-text)',
                !tab.disabled && 'hover:opacity-100'
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
                    <Icon icon="mdi:lock" class="size-3.5 text-(--theme-accent-text)" />
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
        </button>
    {/each}
    <button
        onclick={onresult}
        disabled={!resultEnabled}
        class={[
            'relative flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-sm transition-all',
            showResult
                ? 'bg-(--theme-accent-bg)/10 text-(--theme-accent-text) font-medium'
                : resultEnabled
                  ? 'text-(--theme-tabs-text)/60 hover:bg-(--theme-tabs-text)/5 hover:text-(--theme-tabs-text) hover:opacity-100'
                  : 'opacity-30 cursor-not-allowed'
        ].join(' ')}
        title={resultEnabled ? '' : '请先锁定队伍配置'}
    >
        <Icon icon="mdi:chart-box-outline" class="size-4" />
        结果
    </button>
    <div class="flex-1"></div>
    <button
        onclick={() => openHelp('使用帮助', workflowHelpItems)}
        class="flex items-center justify-center rounded-full size-7 text-sm transition-colors hover:bg-(--theme-tabs-text)/10"
        style="color: var(--theme-accent-text);"
        title="使用帮助"
    >
        <Icon icon="mdi:help-circle-outline" class="size-4" />
    </button>
</div>
