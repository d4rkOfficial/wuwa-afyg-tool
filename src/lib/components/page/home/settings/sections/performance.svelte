<script lang="ts">
    /**
     * @desc 设置 → 性能相关（Phase 5.1 第一增量：自 `settings-modal.svelte` 原样抽出，标记与行为未改）。
     * 三个开关直连全局 store `$lib/data/render-prefs.svelte`（与外壳无共享状态，故无需 settings-ui store 中转）。
     *
     * T15：三个 `ui/switch` 换成 `ui/tabs` 的两段文字 tab。两个分段各自写**该状态下的实际行为**
     * （「重载｜重算」而不是「开｜关」），因为这三项关闭后并非「功能失效」，而是走另一条更轻的路径。
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

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    /** @desc 两段布尔项：入参是 on / off 两个分段各自的文案 */
    const pair = (on: string, off: string) => [
        { value: 'on', label: on },
        { value: 'off', label: off }
    ]

    /** @desc boolean ⇄ 分段值的唯一换算处（`ui/tabs` 的 value 是 string） */
    const segValue = (on: boolean): string => (on ? 'on' : 'off')
    const segBool = (value: string): boolean => value === 'on'

    /**
     * @desc 设置行内文字 tab 的定宽：`w-44` 让**轨道**宽度确定，`flex-1` 的两段必然等分，
     * 滑动指示块无需 DOM 测量即可对齐（与两段文案字数无关，见 `ui/tabs` 顶部注释）；
     * `shrink-0` 保证窄屏时被压缩的是左侧文案列（它有 `min-w-0`）而不是控件本身。
     */
    const ROW_TABS = 'w-44 shrink-0'

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
    <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">控制交互渲染方式与刷新结果时的数据加载行为</p>
    <!-- 渲染加速（GPU）：拖拽/动画走合成层 -->
    <SettingRow>
        <div class="min-w-0">
            <FieldLabel
                label="渲染加速（GPU）"
                hint="开启后排轴拖拽/框选/悬浮窗使用 GPU 合成（transform 定位），帧率更高；关闭回退传统布局定位"
            />
        </div>
        <Tabs
            items={GPU_ACCEL_TABS}
            value={segValue(getGpuAccel())}
            onchange={(v) => setGpuAccel(segBool(v))}
            compact
            class={ROW_TABS}
            backgroundImage="var(--theme-accent-bg)"
            textColor="var(--theme-accent-text-on-bg)"
        />
    </SettingRow>
    <!-- 刷新结果重载数据：开启后刷新结果时重新加载本工程全部阶段数据 -->
    <SettingRow class="mt-2">
        <div class="min-w-0">
            <FieldLabel
                label="刷新结果重载数据"
                hint="开启后点击「刷新结果」会重新加载本工程全部阶段数据及角色/声骸信息（更准确，耗时更长）；关闭仅重算结果（更快）"
            />
        </div>
        <Tabs
            items={RELOAD_ON_RESULT_TABS}
            value={segValue(getReloadOnResultRefresh())}
            onchange={(v) => setReloadOnResultRefresh(segBool(v))}
            compact
            class={ROW_TABS}
            backgroundImage="var(--theme-accent-bg)"
            textColor="var(--theme-accent-text-on-bg)"
        />
    </SettingRow>
    <!-- 链/阶变动重载数据：开启后调整共鸣链/精炼档位时自动重载本工程全部阶段数据 -->
    <SettingRow class="mt-2">
        <div class="min-w-0">
            <FieldLabel
                label="链/阶变动重载数据"
                hint="开启后调整角色共鸣链/武器精炼档位时，自动重载本工程全部阶段数据并重新锁定（更准确，耗时更长）；关闭仅更新档位配置"
            />
        </div>
        <Tabs
            items={RELOAD_ON_PROFILE_TABS}
            value={segValue(getReloadOnProfileChange())}
            onchange={(v) => setReloadOnProfileChange(segBool(v))}
            compact
            class={ROW_TABS}
            backgroundImage="var(--theme-accent-bg)"
            textColor="var(--theme-accent-text-on-bg)"
        />
    </SettingRow>
</div>
