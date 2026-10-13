<script lang="ts">
    /**
     * @desc 设置 → 交互相关（Phase 5.1 第三增量：自 `settings-modal.svelte` 原样抽出，标记与行为未改）。
     * 本 tab 无自有状态：所有开关直连各自的全局 store（`calc-view` / `toolbar-prefs` / `render-prefs` /
     * `context-menu-prefs` / `interaction-prefs`），外壳也不再读它们，故 `settings-ui.svelte.ts` 无需迁入任何状态
     * （与第一增量的 `performance` / `config` 同情形，不发明重复状态）。
     * `TOAST_POSITION_LABELS` / `TOAST_POSITION_HINTS` 只服务本 tab，随文案一并留下。
     *
     * T15：本 tab 的 7 个 `ui/switch` + 3 处手搓分段按钮组（拉表视图 / 关闭按钮位置 / 消息提示位置）
     * 全部换成 `ui/tabs` 的文字 tab（两段短语写「该状态下的实际行为」，多段保留原值域与文案）。
     * 分段控件的宽度 / 配色 / 布尔换算统一走 `../utils`。
     */
    import Icon from '@iconify/svelte'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import FieldLabel from '$lib/components/ui/field-label.svelte'
    import SettingRow from '$lib/components/ui/setting-row.svelte'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import { getCalcViewMode, setCalcViewMode } from '$lib/data/calc-view.svelte'
    import { getMagneticPointer, setMagneticPointer } from '$lib/data/render-prefs.svelte'
    import { getSimplifyToolbar, setSimplifyToolbar } from '$lib/data/toolbar-prefs.svelte'
    import { getSimplifyContextMenu, setSimplifyContextMenu } from '$lib/data/context-menu-prefs.svelte'
    import {
        DEFAULT_LOCK_WATERMARK_TEXT,
        LOCK_WATERMARK_TEXT_MAX,
        getConfirmDeletes,
        getLockWatermark,
        getLockWatermarkText,
        getModalClosePosition,
        getMultiEntryExpand,
        getSidebarActions,
        getToastPosition,
        setConfirmDeletes,
        setLockWatermark,
        setLockWatermarkText,
        setModalClosePosition,
        setMultiEntryExpand,
        setSidebarActions,
        setToastPosition,
        TOAST_POSITIONS,
        type ToastPosition
    } from '$lib/data/interaction-prefs.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import { ROW_TABS, TAB_ACCENT, pair, segBool, segValue } from '../utils'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    /** @desc 卡片表面（与 theme / config / cache 的卡片同规格） */
    const CARD_SURFACE = 'sf-radius rounded-none border'
    const CARD_STYLE = 'border-color: var(--theme-divider-border); background: var(--theme-input-bg);'

    /** @desc Toast 位置按钮文案与说明（顺序取自 TOAST_POSITIONS） */
    const TOAST_POSITION_LABELS: Record<ToastPosition, string> = {
        'top-right': '右上角（默认）',
        none: '不弹出',
        'top-left': '左上角',
        'top-center': '正上方',
        'bottom-center': '正下方',
        'bottom-left': '左下角',
        'bottom-right': '右下角'
    }

    const TOAST_POSITION_HINTS: Record<ToastPosition, string> = {
        'top-right': '默认位置：屏幕右上角向下堆叠',
        none: '不显示任何操作反馈提示',
        'top-left': '屏幕左上角向下堆叠',
        'top-center': '屏幕正上方居中',
        'bottom-center': '屏幕正下方居中',
        'bottom-left': '屏幕左下角向上堆叠',
        'bottom-right': '屏幕右下角向上堆叠'
    }

    function switchCalcViewMode(mode: 'dropdown' | 'spread') {
        setCalcViewMode(mode)
        addToast(mode === 'spread' ? '已切换为 buff 平铺模式' : '已切换为 buff 下拉模式', 'success')
    }

    // ── 分段文字 tab（`ui/tabs`，T15）──
    // 改造前本 tab 混用两种实现：`ui/switch`（布尔项）与手搓分段按钮组（互斥取值）。
    // 现在统一为「文字 tab + 单一滑动指示块」；布尔项的两个分段写**该状态下的实际行为**，
    // 而不是偷懒的「开｜关」（用户明确要求）。

    const SIMPLIFY_TOOLBAR_TABS = pair('简化', '完整')
    const SIDEBAR_ACTIONS_TABS = pair('显示', '隐藏')
    const MULTI_ENTRY_TABS = pair('多个', '单个')
    const MAGNETIC_POINTER_TABS = pair('磁吸', '原生')
    const CONFIRM_DELETES_TABS = pair('二次确认', '直接删除')
    const SIMPLIFY_CONTEXT_MENU_TABS = pair('精简', '完整')
    const LOCK_WATERMARK_TABS = pair('显示', '隐藏')

    /** @desc 弹窗关闭按钮位置（互斥取值，值域与 `ModalClosePosition` 一致，持久化键不变） */
    const CLOSE_POSITION_TABS = [
        { value: 'top-left', label: '左上角' },
        { value: 'top-right', label: '右上角' }
    ]

    /** @desc 拉表视图（互斥取值，值域与 `calc-view` 的 `CalcViewMode` 一致） */
    const CALC_VIEW_TABS = [
        { value: 'dropdown', label: 'buff 下拉模式' },
        { value: 'spread', label: 'buff 平铺模式' }
    ]

    /** @desc 消息提示位置：7 段，逐段 `title` 沿用原来的 `TOAST_POSITION_HINTS` 悬浮说明 */
    const TOAST_POSITION_TABS = TOAST_POSITIONS.map((p) => ({
        value: p,
        label: TOAST_POSITION_LABELS[p],
        title: TOAST_POSITION_HINTS[p]
    }))

    const pickCalcViewMode = (value: string) => {
        if (value === 'dropdown' || value === 'spread') switchCalcViewMode(value)
    }

    const pickClosePosition = (value: string) => {
        if (value === 'top-left' || value === 'top-right') setModalClosePosition(value)
    }

    const pickToastPosition = (value: string) => {
        if (TOAST_POSITIONS.includes(value as ToastPosition)) setToastPosition(value as ToastPosition)
    }
</script>

<div class={mergeClass(['flex flex-col', className])} style={styleProp}>
    <div>
        <SectionTitle>
            <Icon icon="mdi:widgets-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            界面显示
        </SectionTitle>
        <!-- 拉表视图：原先是独立分区（自己一个 SectionTitle + 一行卡片），
             按用户要求并入「界面显示」—— 它本来就是同一类「界面怎么显示」的开关，不是另一类设置。 -->
        <SettingRow>
            <div class="min-w-0">
                <FieldLabel label="拉表视图" hint="选择拉表页面编辑 Buff 的方式" />
            </div>
            <Tabs
                items={CALC_VIEW_TABS}
                value={getCalcViewMode()}
                onchange={pickCalcViewMode}
                compact
                class={ROW_TABS}
                {...TAB_ACCENT}
            />
        </SettingRow>
        <SettingRow class="mt-2">
            <div class="min-w-0">
                <FieldLabel label="简化底部工具栏" hint="把底部工具栏收成可拖动的图标条，可吸附到侧栏旁或屏幕右缘" />
            </div>
            <Tabs
                items={SIMPLIFY_TOOLBAR_TABS}
                value={segValue(getSimplifyToolbar())}
                onchange={(v) => setSimplifyToolbar(segBool(v))}
                compact
                class={ROW_TABS}
                {...TAB_ACCENT}
            />
        </SettingRow>
        <SettingRow class="mt-2">
            <div class="min-w-0">
                <FieldLabel
                    label="侧边栏显示新建 / 导入按钮"
                    hint="在侧边栏底部显示新建工程与导入入口；关闭后仍可从欢迎页使用"
                />
            </div>
            <Tabs
                items={SIDEBAR_ACTIONS_TABS}
                value={segValue(getSidebarActions())}
                onchange={(v) => setSidebarActions(segBool(v))}
                compact
                class={ROW_TABS}
                {...TAB_ACCENT}
            />
        </SettingRow>
        <SettingRow class="mt-2">
            <div class="min-w-0">
                <FieldLabel label="结果页展开多个条目" hint="关闭时同时只展开一个，展开新条目会自动收起上一个" />
            </div>
            <Tabs
                items={MULTI_ENTRY_TABS}
                value={segValue(getMultiEntryExpand())}
                onchange={(v) => setMultiEntryExpand(segBool(v))}
                compact
                class={ROW_TABS}
                {...TAB_ACCENT}
            />
        </SettingRow>
        <SettingRow class="mt-2">
            <div class="min-w-0">
                <FieldLabel label="弹窗关闭按钮位置" />
            </div>
            <Tabs
                items={CLOSE_POSITION_TABS}
                value={getModalClosePosition()}
                onchange={pickClosePosition}
                compact
                class={ROW_TABS}
                {...TAB_ACCENT}
            />
        </SettingRow>
    </div>

    <div class="mt-5">
        <SectionTitle>
            <Icon icon="mdi:gesture-tap" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            交互效果
        </SectionTitle>
        <SettingRow>
            <div class="min-w-0">
                <FieldLabel label="磁力光标" hint="鼠标移到按钮等可点击元素上时，光标会框住它并轻微吸附" />
            </div>
            <Tabs
                items={MAGNETIC_POINTER_TABS}
                value={segValue(getMagneticPointer())}
                onchange={(v) => setMagneticPointer(segBool(v))}
                compact
                class={ROW_TABS}
                {...TAB_ACCENT}
            />
        </SettingRow>
    </div>

    <div class="mt-5">
        <SectionTitle>
            <Icon icon="mdi:trash-can-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            删除行为
        </SectionTitle>
        <SettingRow>
            <div class="min-w-0">
                <FieldLabel label="删除前二次确认" hint="删除工程、Buff、排轴等对象前弹出确认框" />
            </div>
            <Tabs
                items={CONFIRM_DELETES_TABS}
                value={segValue(getConfirmDeletes())}
                onchange={(v) => setConfirmDeletes(segBool(v))}
                compact
                class={ROW_TABS}
                {...TAB_ACCENT}
            />
        </SettingRow>
    </div>

    <div class="mt-5">
        <SectionTitle>
            <Icon
                icon="mdi:cursor-default-click-outline"
                class="size-4 shrink-0"
                style="color: var(--theme-accent-text);"
            />
            右键菜单
        </SectionTitle>
        <SettingRow>
            <div class="min-w-0">
                <FieldLabel label="简化右键菜单" hint="操作块与参考线的右键菜单只保留常用项；多选菜单不受影响" />
            </div>
            <Tabs
                items={SIMPLIFY_CONTEXT_MENU_TABS}
                value={segValue(getSimplifyContextMenu())}
                onchange={(v) => setSimplifyContextMenu(segBool(v))}
                compact
                class={ROW_TABS}
                {...TAB_ACCENT}
            />
        </SettingRow>
    </div>

    <div class="mt-5">
        <SectionTitle>
            <Icon icon="mdi:bell-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            消息提示位置
        </SectionTitle>
        <!-- 说明进卡片：标签 + 分段 + 说明同处一块表面 -->
        <div class={mergeClass([CARD_SURFACE, 'px-3 py-2.5'])} style={CARD_STYLE}>
            <FieldLabel label="消息提示位置" hint="操作反馈的弹出位置；选「不弹出」后不再显示任何反馈" />
            <div class="mt-2">
                <Tabs
                    items={TOAST_POSITION_TABS}
                    value={getToastPosition()}
                    onchange={pickToastPosition}
                    compact
                    {...TAB_ACCENT}
                />
            </div>
        </div>
    </div>

    <div class="mt-5">
        <SectionTitle>
            <Icon icon="mdi:watermark" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            锁定水印
        </SectionTitle>
        <div class={CARD_SURFACE} style={CARD_STYLE}>
            <div class="flex items-center justify-between gap-3 px-3 py-2">
                <div class="min-w-0">
                    <FieldLabel label="显示锁定水印" hint="阶段锁定时在画面上平铺显示自定义文字" />
                </div>
                <Tabs
                    items={LOCK_WATERMARK_TABS}
                    value={segValue(getLockWatermark())}
                    onchange={(v) => setLockWatermark(segBool(v))}
                    compact
                    class={ROW_TABS}
                    {...TAB_ACCENT}
                />
            </div>
            <div class="border-t px-3 py-2" style="border-color: var(--theme-divider-border);">
                <div class="flex items-center gap-2">
                    <input
                        value={getLockWatermarkText()}
                        oninput={(e) => setLockWatermarkText(e.currentTarget.value)}
                        maxlength={LOCK_WATERMARK_TEXT_MAX}
                        placeholder={DEFAULT_LOCK_WATERMARK_TEXT}
                        class="min-w-0 flex-1 rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none transition-colors placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)/50"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        title="锁定水印文本"
                    />
                    <span class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/40">
                        {getLockWatermarkText().length}/{LOCK_WATERMARK_TEXT_MAX}
                    </span>
                </div>
                <span class="mt-1 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                    留空时使用「{DEFAULT_LOCK_WATERMARK_TEXT}」
                </span>
            </div>
        </div>
    </div>
</div>
