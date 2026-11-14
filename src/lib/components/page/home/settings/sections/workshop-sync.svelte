<script lang="ts">
    /**
     * @desc 设置 → 工坊同步（归在「数据」分组，紧跟「连接配置」）。
     *
     * 为什么单开一栏而不是塞进「连接配置」的工坊实例块：那里已经有实例列表 + 添加框 + 恢复默认，
     * 再加两开关 + 时机 + 上次同步时间会挤成一片；而自动同步是「数据获取策略」，与「实例地址」不是同一件事。
     *
     * 状态直连 `$lib/data/workshop-sync.svelte`（与 `performance` / `interaction` 同形：不读不写外壳的
     * `$state`，故 `settings-ui.svelte.ts` 不持有任何状态）。
     * 文案常量（时机标签 / 分段标题）只服务本栏，随组件留下。
     */
    import Icon from '@iconify/svelte'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import FieldLabel from '$lib/components/ui/field-label.svelte'
    import SettingRow from '$lib/components/ui/setting-row.svelte'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import {
        getAutoSyncBuff,
        getAutoSyncSubstat,
        getLastSync,
        getSyncBusy,
        getSyncTiming,
        setAutoSyncBuff,
        setAutoSyncSubstat,
        setSyncTiming,
        syncWorkshopNow
    } from '$lib/data/workshop-sync.svelte'
    import { formatSyncAge, WORKSHOP_SYNC_TIMINGS, type WorkshopSyncTiming } from '$lib/data/workshop-sync.utils'
    import { getActiveWorkshopUrl } from '$lib/data/workshop.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import { ACTION_BTN_ACCENT, ROW_TABS, TAB_ACCENT, pair, segBool, segValue } from '../utils'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    /** @desc 两段布尔项写「该状态下的实际行为」（同 `interaction` / `performance` 的既定口径） */
    const AUTO_SYNC_TABS = pair('自动同步', '仅手动')

    /** @desc 时机标签：四段等长（3~4 字），满宽分段不会折行 */
    const TIMING_LABELS: Record<WorkshopSyncTiming, string> = {
        enter: '每次进入',
        daily: '每天一次',
        weekly: '每周一次',
        version: '上游新版本'
    }

    /** @desc 时机的逐项说明（分段 `title` 悬浮提示 + 下方提示行共用同一份文案） */
    const TIMING_HINTS: Record<WorkshopSyncTiming, string> = {
        enter: '每次打开应用都向工坊请求一次（最及时，请求也最频繁）',
        daily: '距上次成功同步满 24 小时才请求',
        weekly: '距上次成功同步满 7 天才请求',
        version: '检测到上游数据版本（角色/武器/声骸）变化后才请求'
    }

    const TIMING_TABS = WORKSHOP_SYNC_TIMINGS.map((value) => ({
        value,
        label: TIMING_LABELS[value],
        title: TIMING_HINTS[value]
    }))

    const buffAge = $derived(formatSyncAge(getLastSync('buff').at, Date.now()))
    const substatAge = $derived(formatSyncAge(getLastSync('substat').at, Date.now()))
    const syncing = $derived(getSyncBusy())
    const timing = $derived(getSyncTiming())

    /** @desc 只接受时机取值域内的值（`ui/tabs` 的 onchange 入参是 string） */
    const pickTiming = (value: string) => {
        if ((WORKSHOP_SYNC_TIMINGS as readonly string[]).includes(value)) setSyncTiming(value as WorkshopSyncTiming)
    }
</script>

<!-- 工坊同步 -->
<div class={mergeClass([className])} style={styleProp}>
    <SectionTitle>
        <Icon icon="mdi:cog-sync-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        工坊同步
    </SectionTitle>
    <p class="mb-3 text-[10px] leading-4 text-(--theme-modal-text)/40">
        开启后按设定时机自动向当前工坊实例请求社区维护的 Buff 集与标准 14 词条集；只在工坊来源的条目上生效，
        本地自己改过、或设为「不同步工坊」的内容不会被覆盖。
    </p>

    <SettingRow>
        <div class="min-w-0">
            <FieldLabel label="自动同步 Buff 集" hint="进入时拉取工坊的 Buff 预设（含文件夹结构）" />
        </div>
        <Tabs
            items={AUTO_SYNC_TABS}
            value={segValue(getAutoSyncBuff())}
            onchange={(v) => setAutoSyncBuff(segBool(v))}
            compact
            class={ROW_TABS}
            {...TAB_ACCENT}
        />
    </SettingRow>

    <SettingRow class="mt-2">
        <div class="min-w-0">
            <FieldLabel label="自动同步词条集" hint="进入时拉取各角色工坊维护的标准 14 词条方案" />
        </div>
        <Tabs
            items={AUTO_SYNC_TABS}
            value={segValue(getAutoSyncSubstat())}
            onchange={(v) => setAutoSyncSubstat(segBool(v))}
            compact
            class={ROW_TABS}
            {...TAB_ACCENT}
        />
    </SettingRow>

    <!-- 同步时机：满宽四段（行内 `w-44` 轨道放不下 4 段，`ui/tabs` 会折行） -->
    <div class="mt-4 mb-1">
        <FieldLabel label="同步时机" hint={TIMING_HINTS[timing]} />
    </div>
    <Tabs items={TIMING_TABS} value={timing} onchange={pickTiming} compact {...TAB_ACCENT} />

    <!-- 上次同步 + 立即同步 -->
    <div
        class="sf-radius mt-4 flex flex-wrap items-center gap-3 rounded-none border px-3 py-2"
        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
    >
        <div class="min-w-0 flex-1">
            <span class="block text-xs font-medium text-(--theme-modal-text)/70">上次成功同步</span>
            <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                Buff 集：{buffAge} · 词条集：{substatAge}
            </span>
            <span
                class="mt-0.5 block truncate text-[10px] leading-4 text-(--theme-modal-text)/30"
                title={getActiveWorkshopUrl()}
            >
                当前工坊：{getActiveWorkshopUrl()}
            </span>
        </div>
        <Button
            variant="icon-text"
            size="none"
            bare
            keepDisabled
            onclick={() => void syncWorkshopNow()}
            disabled={syncing}
            backgroundImage="var(--theme-accent-bg)"
            textColor="var(--theme-accent-text-on-bg)"
            class={ACTION_BTN_ACCENT}
            title="不等时机，立刻同步 Buff 集与词条集"
        >
            <Icon icon="mdi:sync" class={syncing ? 'size-3.5 animate-spin' : 'size-3.5'} />
            {syncing ? '同步中…' : '立即同步'}
        </Button>
    </div>
</div>
