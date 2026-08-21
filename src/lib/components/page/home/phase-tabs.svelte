<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { Project, PhaseKey } from '$lib/types/project'
    import { canEditPhase, getPhaseOrder } from '$lib/data/project.svelte'
    import { openHelp } from '$lib/data/help.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import {
        getWsTarget,
        getWsStatus,
        getWsUrl,
        getWsLastError,
        getWsToolCount,
        getWsRecentTools,
        disconnectWs,
        connectWs,
        pushState
    } from '$lib/ws-remote/ws-remote.svelte'
    import { getPanelsState } from '$lib/ai/panels.svelte'

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
                '① 队伍配置：选角色、武器、首位声骸、套装。\n② 排轴：时间轴放置操作块与参考线，绑定伤害倍率。\n③ 拉表：直伤与 Buff 配置，Buff 支持追加/覆盖、绝对值/引用值；可设生效条件（角色共鸣链/武器精炼阶数）并选参考角色，工坊拉取自带。速查显示倍率的共鸣能量与偏谐值。\n④ 词条/环境：主副词条、敌人属性，效果见角色面板总览。\n⑤ 结果：伤害表、计算明细、DPS、副词条贡献分析、凹暴击；「共鸣链/精炼」可调各角色链与精炼档位。'
        },
        {
            name: '结果页',
            description: '结果页的更多功能。',
            content:
                '结果页可切换多角色数据，展开每段伤害查看完整乘区明细。副词条贡献分析提供三种算法（单条损失、Shapley 值、偏导数提升值），配合期望/凹暴双数据集评估词条价值。DPS 分析通过时间记点计算分段秒伤。'
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

    interface Props extends ComponentsProps {
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
        onlock,
        class: className,
        style: styleProp
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

    // ── WS 远程接管：状态读取 + 状态推送 ──
    let wsTarget = $derived(getWsTarget())
    let wsStatus = $derived(getWsStatus())
    let wsUrl = $derived(getWsUrl())
    let wsLastError = $derived(getWsLastError())
    let wsToolCount = $derived(getWsToolCount())
    let wsRecentTools = $derived(getWsRecentTools())
    let wsModal = $state(false)

    const WS_ICON = {
        idle: 'mdi:access-point-off',
        connecting: 'mdi:lan-connect',
        connected: 'mdi:access-point',
        error: 'mdi:lan-disconnect'
    } as const

    const WS_LABEL = {
        idle: '未连接',
        connecting: '连接中',
        connected: '已连接',
        error: '连接失败'
    } as const

    /** @desc 工程/视图/锁定/弹窗变化时向 WS 服务器推送最新状态（顶栏常驻期间实时同步） */
    $effect(() => {
        if (getWsStatus() !== 'connected') return
        project.id
        project.phases.team?.locked
        project.phases.timeline?.locked
        project.phases.calculation?.locked
        project.phases.config?.locked
        active
        showResult
        getPanelsState()
        pushState()
    })
</script>

<div
    class="theme-glass-surface flex items-center gap-1 border-b px-3 {className}"
    style="background: var(--theme-tabs-bg); color: var(--theme-tabs-text); border-color: var(--theme-divider-border); {styleProp ||
        ''}"
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
    {#if wsTarget}
        <!-- WS 远程接管：顶替帮助按钮，点击打开状态弹窗 -->
        <button
            onclick={() => (wsModal = true)}
            class="flex size-7 items-center justify-center rounded-full text-sm transition-colors hover:bg-(--theme-tabs-text)/10"
            style="color: {wsStatus === 'connected'
                ? 'var(--theme-accent-text)'
                : wsStatus === 'error'
                  ? '#ef4444'
                  : 'var(--theme-tabs-text)/40'};"
            title="WS 远程接管（{wsStatus === 'connected' ? wsUrl : wsLastError || WS_LABEL[wsStatus]}）"
        >
            <Icon icon={WS_ICON[wsStatus]} class="size-4" />
        </button>
    {:else}
        <button
            onclick={() => openHelp('使用帮助', workflowHelpItems)}
            class="flex size-7 items-center justify-center rounded-full text-sm transition-colors hover:bg-(--theme-tabs-text)/10"
            style="color: var(--theme-accent-text);"
            title="使用帮助"
        >
            <Icon icon="mdi:help-circle-outline" class="size-4" />
        </button>
    {/if}
</div>

<Modal open={wsModal} onclose={() => (wsModal = false)} style="max-width: min(92vw, 440px);">
    {#snippet title()}
        <div class="flex items-center justify-between gap-3 pr-4">
            <span class="flex items-center gap-2">
                <Icon
                    icon={WS_ICON[wsStatus]}
                    class="size-4.5"
                    style="color: {wsStatus === 'connected'
                        ? 'var(--theme-accent-text)'
                        : wsStatus === 'error'
                          ? '#ef4444'
                          : 'var(--theme-modal-text)/40'};"
                />
                WS 远程接管
            </span>
            <span
                class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-normal"
                style="background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent); color: {wsStatus ===
                'connected'
                    ? 'var(--theme-accent-text)'
                    : wsStatus === 'error'
                      ? '#ef4444'
                      : 'var(--theme-modal-text)/60'};"
            >
                <span
                    class="size-1.5 rounded-full"
                    style="background: {wsStatus === 'connected'
                        ? 'var(--theme-accent-bg)'
                        : wsStatus === 'error'
                          ? '#ef4444'
                          : 'var(--theme-modal-text)/40'};"
                ></span>
                {WS_LABEL[wsStatus]}
            </span>
        </div>
    {/snippet}

    <!-- 连接信息 -->
    <div
        class="space-y-2.5 rounded-xl border p-3.5 text-xs"
        style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-text) 3%, transparent);"
    >
        <div class="flex items-center justify-between gap-3">
            <span class="shrink-0 text-(--theme-modal-text)/50">地址</span>
            <span class="truncate tabular-nums text-(--theme-modal-text)/80">{wsUrl || wsTarget}</span>
        </div>
        <div class="flex items-center justify-between gap-3">
            <span class="shrink-0 text-(--theme-modal-text)/50">已执行工具</span>
            <span class="tabular-nums text-(--theme-modal-text)/80">{wsToolCount} 次</span>
        </div>
        {#if wsLastError && wsStatus !== 'connected'}
            <div class="wrap-break-word text-red-400">⚠ {wsLastError}</div>
        {/if}
    </div>

    <!-- 最近工具调用 -->
    {#if wsRecentTools.length > 0}
        <div class="mt-4">
            <div class="mb-2 flex items-center justify-between">
                <span class="text-[10px] font-medium tracking-wider text-(--theme-modal-text)/40">最近工具调用</span>
                <span class="text-[10px] text-(--theme-modal-text)/30"
                    >最近 {Math.min(wsRecentTools.length, 10)} 条</span
                >
            </div>
            <div class="rounded-xl border px-1" style="border-color: var(--theme-divider-border);">
                {#each wsRecentTools.slice(0, 10) as t}
                    <div class="flex items-center justify-between gap-3 px-2.5 py-1.5 text-[11px]">
                        <span
                            class="truncate font-mono"
                            style="color: {t.ok ? 'var(--theme-accent-text)' : '#ef4444'};"
                        >
                            {t.ok ? '✓' : '✗'}
                            {t.tool}
                        </span>
                        <span class="shrink-0 tabular-nums text-(--theme-modal-text)/40">
                            {new Date(t.time).toLocaleTimeString('zh-CN', { hour12: false })}
                        </span>
                    </div>
                {/each}
            </div>
        </div>
    {/if}

    {#snippet footer()}
        <div class="flex gap-2.5 pt-4">
            <button
                onclick={() => disconnectWs()}
                class="flex-1 rounded-lg border px-3 py-2 text-xs transition-colors hover:brightness-110"
                style="border-color: var(--theme-divider-border); color: var(--theme-modal-text)/70;"
            >
                断开连接
            </button>
            <button
                onclick={() => connectWs(wsTarget)}
                class="flex-1 rounded-lg px-3 py-2 text-xs transition-colors hover:brightness-110"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
            >
                重新连接
            </button>
        </div>
    {/snippet}
</Modal>
