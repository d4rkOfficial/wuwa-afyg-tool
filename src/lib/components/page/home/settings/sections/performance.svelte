<script lang="ts">
    /**
     * @desc 设置 → 性能相关（Phase 5.1 第一增量：自 `settings-modal.svelte` 原样抽出，标记与行为未改）。
     * 三个开关直连全局 store `$lib/data/render-prefs.svelte`（与外壳无共享状态，故无需 settings-ui store 中转）。
     *
     * T15：三个 `ui/switch` 换成 `ui/tabs` 的两段文字 tab。两个分段各自写**该状态下的实际行为**
     * （「重载｜重算」而不是「开｜关」），因为这三项关闭后并非「功能失效」，而是走另一条更轻的路径。
     * 分段控件的宽度 / 配色 / 布尔换算统一走 `../utils`（原先每个 section 各定义一份，规格不一致）。
     */
    import Icon from '@iconify/svelte'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import FieldLabel from '$lib/components/ui/field-label.svelte'
    import SettingRow from '$lib/components/ui/setting-row.svelte'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import {
        getGpuAccel,
        setGpuAccel,
        getReloadOnResultRefresh,
        setReloadOnResultRefresh,
        getReloadOnProfileChange,
        setReloadOnProfileChange
    } from '$lib/data/render-prefs.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import { ROW_TABS, TAB_ACCENT, pair, segBool, segValue } from '../utils'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    const GPU_ACCEL_TABS = pair('GPU 合成', '传统布局')
    const RELOAD_ON_RESULT_TABS = pair('重载', '重算')
    const RELOAD_ON_PROFILE_TABS = pair('重载', '仅改档位')
</script>

<!-- 性能相关 -->
<div class={mergeClass([className])} style={styleProp}>
    <SectionTitle>
        <Icon icon="mdi:speedometer" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        性能设置
    </SectionTitle>
    <p class="mb-3 text-[10px] leading-4 text-(--theme-modal-text)/40">
        选择界面渲染方式，以及刷新结果时要不要重新读取工程数据
    </p>
    <!-- 渲染加速（GPU）：拖拽/动画走合成层 -->
    <SettingRow>
        <div class="min-w-0">
            <FieldLabel label="渲染加速" hint="让排轴页的拖拽、框选与悬浮窗更流畅；显示异常时可关闭" />
        </div>
        <Tabs
            items={GPU_ACCEL_TABS}
            value={segValue(getGpuAccel())}
            onchange={(v) => setGpuAccel(segBool(v))}
            compact
            class={ROW_TABS}
            {...TAB_ACCENT}
        />
    </SettingRow>
    <SettingRow class="mt-2">
        <div class="min-w-0">
            <FieldLabel
                label="刷新结果重载数据"
                hint="重新读取角色的阶段、武器与声骸信息，结果更准但更慢；关闭则直接重算"
            />
        </div>
        <Tabs
            items={RELOAD_ON_RESULT_TABS}
            value={segValue(getReloadOnResultRefresh())}
            onchange={(v) => setReloadOnResultRefresh(segBool(v))}
            compact
            class={ROW_TABS}
            {...TAB_ACCENT}
        />
    </SettingRow>
    <SettingRow class="mt-2">
        <div class="min-w-0">
            <FieldLabel label="链/阶变动重载数据" hint="调整共鸣链或武器精炼档位时是否同步重新读取工程数据" />
        </div>
        <Tabs
            items={RELOAD_ON_PROFILE_TABS}
            value={segValue(getReloadOnProfileChange())}
            onchange={(v) => setReloadOnProfileChange(segBool(v))}
            compact
            class={ROW_TABS}
            {...TAB_ACCENT}
        />
    </SettingRow>
</div>
