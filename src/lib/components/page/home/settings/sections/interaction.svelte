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

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

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
    <SectionTitle>
        <Icon icon="mdi:table-large" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        拉表视图
    </SectionTitle>
    <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
        选择拉表页面的 Buff 编辑方式；后续拉表/排轴等快捷键设置也将集中在此区域
    </p>
    <Tabs
        items={CALC_VIEW_TABS}
        value={getCalcViewMode()}
        onchange={pickCalcViewMode}
        compact
        backgroundImage="var(--theme-accent-bg)"
        textColor="var(--theme-accent-text-on-bg)"
    />

    <div class="mt-5">
        <SectionTitle>
            <Icon icon="mdi:widgets-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            界面显示
        </SectionTitle>
        <SettingRow>
            <div class="min-w-0">
                <FieldLabel
                    label="简化底部工具栏"
                    hint="开启后底部工具栏变为可拖动的圆角胶囊（仅图标按钮），拖动时可吸附到侧栏右侧或屏幕右缘"
                />
            </div>
            <Tabs
                items={SIMPLIFY_TOOLBAR_TABS}
                value={segValue(getSimplifyToolbar())}
                onchange={(v) => setSimplifyToolbar(segBool(v))}
                compact
                class={ROW_TABS}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg)"
            />
        </SettingRow>
        <SettingRow class="mt-2">
            <div class="min-w-0">
                <FieldLabel
                    label="侧边栏显示新建 / 导入按钮"
                    hint="在侧边栏底部显示「新建工程 / 从本地导入 / 从工坊下载」操作区；默认关闭（关闭后仍可从欢迎页使用）"
                />
            </div>
            <Tabs
                items={SIDEBAR_ACTIONS_TABS}
                value={segValue(getSidebarActions())}
                onchange={(v) => setSidebarActions(segBool(v))}
                compact
                class={ROW_TABS}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg)"
            />
        </SettingRow>
        <SettingRow class="mt-2">
            <div class="min-w-0">
                <FieldLabel
                    label="允许结果页同时展开多个伤害条目"
                    hint="开启后结果页的伤害条目可各自独立展开 / 收起；关闭（默认）时同时只展开一个，展开新条目会收起上一个"
                />
            </div>
            <Tabs
                items={MULTI_ENTRY_TABS}
                value={segValue(getMultiEntryExpand())}
                onchange={(v) => setMultiEntryExpand(segBool(v))}
                compact
                class={ROW_TABS}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg)"
            />
        </SettingRow>
        <SettingRow class="mt-2">
            <span class="min-w-0 text-xs font-medium text-(--theme-modal-text)/70">弹窗关闭按钮位置</span>
            <Tabs
                items={CLOSE_POSITION_TABS}
                value={getModalClosePosition()}
                onchange={pickClosePosition}
                compact
                class={ROW_TABS}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg)"
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
                <FieldLabel
                    label="磁力光标"
                    hint="开启后鼠标移至按钮/链接等可点击元素上时，光标变形框住元素并带磁力吸附"
                />
            </div>
            <Tabs
                items={MAGNETIC_POINTER_TABS}
                value={segValue(getMagneticPointer())}
                onchange={(v) => setMagneticPointer(segBool(v))}
                compact
                class={ROW_TABS}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg)"
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
                <FieldLabel
                    label="删除前二次确认"
                    hint="关闭后删除工程、Buff、排轴等对象时跳过二次确认弹窗，直接删除；默认开启"
                />
            </div>
            <Tabs
                items={CONFIRM_DELETES_TABS}
                value={segValue(getConfirmDeletes())}
                onchange={(v) => setConfirmDeletes(segBool(v))}
                compact
                class={ROW_TABS}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg)"
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
                <FieldLabel
                    label="简化右键菜单"
                    hint="开启后排轴页的操作块/参考线右键菜单仅保留重命名、伤害绑定与删除；多选菜单不受影响。默认开启"
                />
            </div>
            <Tabs
                items={SIMPLIFY_CONTEXT_MENU_TABS}
                value={segValue(getSimplifyContextMenu())}
                onchange={(v) => setSimplifyContextMenu(segBool(v))}
                compact
                class={ROW_TABS}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg)"
            />
        </SettingRow>
    </div>

    <div class="mt-5">
        <SectionTitle>
            <Icon icon="mdi:bell-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            消息提示位置
        </SectionTitle>
        <Tabs
            items={TOAST_POSITION_TABS}
            value={getToastPosition()}
            onchange={pickToastPosition}
            compact
            backgroundImage="var(--theme-accent-bg)"
            textColor="var(--theme-accent-text-on-bg)"
        />
        <span class="mt-1.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
            操作反馈（Toast）的弹出位置，默认右上角；选「不弹出」后所有操作反馈都不再显示
        </span>
    </div>

    <div class="mt-5">
        <SectionTitle>
            <Icon icon="mdi:watermark" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            锁定水印
        </SectionTitle>
        <SettingRow>
            <div class="min-w-0">
                <FieldLabel label="显示锁定水印" hint="排轴页阶段锁定时，在画面上平铺显示自定义文字；默认开启" />
            </div>
            <Tabs
                items={LOCK_WATERMARK_TABS}
                value={segValue(getLockWatermark())}
                onchange={(v) => setLockWatermark(segBool(v))}
                compact
                class={ROW_TABS}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg)"
            />
        </SettingRow>
        <div class="mt-2 flex items-center gap-2">
            <input
                value={getLockWatermarkText()}
                oninput={(e) => setLockWatermarkText(e.currentTarget.value)}
                maxlength={LOCK_WATERMARK_TEXT_MAX}
                placeholder={DEFAULT_LOCK_WATERMARK_TEXT}
                class="min-w-0 flex-1 rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none transition-colors placeholder:text-(--theme-modal-text)/35 focus:border-(--theme-accent-bg)/50"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                title="锁定水印文本"
            />
            <span class="shrink-0 text-[10px] tracking-[0.18em] text-(--theme-modal-text)/40">
                {getLockWatermarkText().length}/{LOCK_WATERMARK_TEXT_MAX}
            </span>
        </div>
        <span class="mt-1.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
            留空则使用「{DEFAULT_LOCK_WATERMARK_TEXT}」
        </span>
    </div>
</div>
