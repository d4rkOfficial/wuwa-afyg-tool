<script lang="ts">
    /**
     * @desc 设置 → AI 助手「权限 / 提示词」+「启用 / 接入配置」（Phase 5.1 第三增量：自 `settings-modal.svelte`
     * 原样抽出，标记与行为未改）。
     * 外壳里 `ai` 与 `ai-conn` 两个栏目键共用同一个分支与同一个根节点（内部再按 `tab` 细分），
     * 按「一个 tab 一个组件」的口径，这两个键就是一份，故合并为本组件；`tab` 由外壳以 prop 传入
     * （理由见 `Props.tab` 的注释：避免与外壳的分支判断形成两个真相源）。
     * 三个次级弹窗（AI 配置编辑 / 提示词编辑 / 删除确认）必须留在外壳 —— 它们是 `fixed` 覆盖层，放进设置面板
     * 内容区会被毛玻璃 / 动画的包含块困住；因此它们要用的状态与共用的删除动作落在 `settings-ui.svelte.ts`，
     * 外壳与本组件读写同一份（不复制状态）：
     *   - `aiEditTarget` / `promptEditOpen` / `aiDeleteTarget`：本组件写（「编辑」/「编辑提示词」/「删除」），
     *     外壳的弹窗读并回写 null / false。
     *   - `doDeleteAiProfile`：外壳确认弹窗的 onconfirm 与本组件「关闭二次确认时直接删除」路径共用，只保留一份。
     *
     * T15：「启用 AI 助手」的 `ui/switch` 换成 `ui/tabs` 的两段文字 tab（启用｜禁用）。
     * 「危险操作权限」**刻意保留**单选卡片列表：三个取值各带一句说明（用户要看着三条说明才能选），
     * 换成两行分段 tab 会把说明折叠掉，属于信息损失，不是一致性收益。
     */
    import Icon from '@iconify/svelte'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import FieldLabel from '$lib/components/ui/field-label.svelte'
    import SettingRow from '$lib/components/ui/setting-row.svelte'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        getGenPrefs,
        getAiSessionDisabled,
        isAiEnabled,
        updateGenPrefs,
        type DangerMode
    } from '$lib/data/ai-prefs.svelte'
    import {
        addProfile,
        getActiveProfileId,
        getAiProfiles,
        setActiveProfile,
        type AiProfile
    } from '$lib/ai/config.svelte'
    import { getConfirmDeletes } from '$lib/data/interaction-prefs.svelte'
    import {
        doDeleteAiProfile,
        setAiDeleteTarget,
        setAiEditTarget,
        setPromptEditOpen,
        type SettingsTab
    } from '../settings-ui.svelte'
    import SkillSection from '../skill-section.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import { ROW_TABS, TAB_ACCENT } from '../utils'

    interface Props extends ComponentsProps {
        /**
         * @desc 当前栏目键（`ai` / `ai-conn`）。**必须由外壳传入，不能在本组件里再读 `getTab()`**：
         * 外壳已经用同一个值决定「渲染本组件」这件事（`{:else if tab === 'ai' || tab === 'ai-conn'}`），
         * 本组件若自己回读 store，就有了两个真相源 —— 只要 `settings-ui.svelte.ts` 出现过第二个模块实例
         * （dev 下 Vite 对被失效模块在导入 URL 上追加 `?t=<时间戳>`，带查询串的 URL 是独立实例，状态各自初始化），
         * 外壳与 section 就会拿到不同的 `tab`：外壳落在 AI 分支、section 读到初始值 `theme`，
         * 于是标题走 `tab === 'ai-conn' ? … : …` 的兜底分支（永远显示「权限 / 提示词」）且两个内容分支全为假
         * →「标题在、下面一片空白」。传 prop 后 section 只跟随外壳那一个值，二者不可能再分歧。
         * 这也正是抽组件前的语义：原外壳内联标记读的就是外壳自己的 `tab`。
         */
        tab: SettingsTab
    }
    let { tab, class: className, style: styleProp }: Props = $props()

    const aiProfiles = $derived(getAiProfiles())
    const aiActiveId = $derived(getActiveProfileId())
    /** @desc 开关的显示态取**实际**启用态（Toy 宿主会话内被抑制时为 off，但偏好本身没被改动） */
    const aiEnabled = $derived(isAiEnabled())

    async function toggleAiEnabled() {
        // 会话级抑制（Toy 宿主）期间不改动持久化偏好：只提示，不写盘 —— 否则用户存下的开关会被静默改掉
        if (getAiSessionDisabled()) {
            addToast('当前为 B 站 Toy 环境，本次会话内不可用 AI 助手；你的开关偏好已保留', 'info')
            return
        }
        await updateGenPrefs({ enabled: !getGenPrefs().enabled })
        addToast(getGenPrefs().enabled ? 'AI 助手已启用' : 'AI 助手已禁用', 'success')
    }

    const DANGER_MODE_OPTIONS: { value: DangerMode; label: string; desc: string }[] = [
        { value: 'ask', label: '每次都询问', desc: '每个危险操作都弹确认' },
        { value: 'ask_once', label: '批量只询问一次', desc: '一次指令内只确认一次，后续直接放行' },
        { value: 'trust', label: '无条件信任', desc: '危险操作直接执行，不再确认' }
    ]

    // ── 文字 tab（T15）──
    /**
     * @desc 「启用 AI 助手」是功能总开关，没有比「启用 / 禁用」更具体的语义轴
     * （关闭 = 悬浮窗隐藏且所有 AI 功能不可用），故两个分段取「启用 / 禁用」而非「开 / 关」。
     */
    const AI_ENABLED_TABS = [
        { value: 'on', label: '启用' },
        { value: 'off', label: '禁用' }
    ]

    async function setDangerMode(mode: DangerMode) {
        await updateGenPrefs({ dangerMode: mode })
        addToast(
            mode === 'ask'
                ? '已设为：危险操作每次都询问'
                : mode === 'ask_once'
                  ? '已设为：批量只询问一次'
                  : '已设为：无条件信任（请谨慎使用）',
            'success'
        )
    }

    async function handleSelectAiProfile(id: string) {
        const ok = await setActiveProfile(id)
        if (ok) {
            const label = getAiProfiles().find((p) => p.id === id)?.label ?? ''
            addToast(`已切换到「${label}」`, 'success')
        }
    }

    async function handleAddAiProfile() {
        const profile = await addProfile('新配置')
        setAiEditTarget(profile)
        addToast('已新建配置文件，请填写 API Key 后保存', 'success')
    }

    /** @desc 删除入口：二次确认关闭时直接删除（删除实现由 store 提供，与外壳的确认弹窗共用同一份） */
    function handleDeleteAiProfile(profile: AiProfile) {
        setAiDeleteTarget(profile)
        if (!getConfirmDeletes()) void doDeleteAiProfile()
    }
</script>

<!-- AI 助手设置（权限 / 提示词 与 接入配置 分页） -->
<div class={mergeClass([className])} style={styleProp}>
    <SectionTitle>
        <Icon
            icon={tab === 'ai-conn' ? 'mdi:connection' : 'mdi:shield-account-outline'}
            class="size-4 shrink-0"
            style="color: var(--theme-accent-text);"
        />
        {tab === 'ai-conn' ? '启用 / 接入配置' : '权限 / 提示词'}
    </SectionTitle>
    <p class="mb-3 text-[10px] leading-4 text-(--theme-modal-text)/40">
        {tab === 'ai-conn'
            ? '开关 AI 助手悬浮窗，并管理多组「提供商 / 模型 / API Key」，点击配置即可切换；API Key 只保存在本机'
            : '设置 AI 助手执行危险操作前的确认方式，以及它的角色人设'}
    </p>
    <div class="flex flex-col gap-2">
        {#if tab === 'ai-conn'}
            <!-- 启用 AI 助手（独立开关，立即保存） -->
            <SettingRow>
                <div class="min-w-0">
                    <FieldLabel label="启用 AI 助手" hint="关闭后隐藏悬浮窗，AI 功能一并停用" />
                    {#if getAiSessionDisabled()}
                        <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                            当前为 B 站 Toy 环境，本次会话内不可用；你保存的开关偏好未改动
                        </span>
                    {/if}
                </div>
                <Tabs
                    items={AI_ENABLED_TABS}
                    value={aiEnabled ? 'on' : 'off'}
                    onchange={(v) => {
                        if ((v === 'on') !== aiEnabled) void toggleAiEnabled()
                    }}
                    compact
                    class={ROW_TABS}
                    {...TAB_ACCENT}
                />
            </SettingRow>
        {/if}
        <div class="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-4">
            {#if tab === 'ai'}
                <!-- 危险操作权限（独立设置，立即保存） -->
                <div
                    class="sf-radius rounded-none border px-3 py-2.5"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <FieldLabel label="危险操作权限" hint="AI 删除工程、清空数据等操作前的确认方式" />
                    <div class="mt-2 flex flex-col gap-1">
                        {#each DANGER_MODE_OPTIONS as opt (opt.value)}
                            {@const active = getGenPrefs().dangerMode === opt.value}
                            <button
                                onclick={() => setDangerMode(opt.value)}
                                class={[
                                    'flex items-center gap-2 rounded-none border px-2.5 py-1.5 text-left transition-colors',
                                    active ? 'border-(--theme-accent-bg)' : 'hover:bg-(--theme-modal-text)/5'
                                ].join(' ')}
                                style={active
                                    ? 'background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent);'
                                    : 'border-color: var(--theme-divider-border);'}
                            >
                                <Icon
                                    icon={active ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}
                                    class={active
                                        ? 'size-3.5 shrink-0 text-(--theme-accent-text)'
                                        : 'size-3.5 shrink-0 text-(--theme-modal-text)/30'}
                                />
                                <span class="min-w-0 flex-1">
                                    <span class="block text-xs font-medium text-(--theme-modal-text)/80"
                                        >{opt.label}</span
                                    >
                                    <span class="block text-[10px] text-(--theme-modal-text)/40">{opt.desc}</span>
                                </span>
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}
            {#if tab === 'ai-conn'}
                <!-- AI配置文件设置：独占整行，内部列表双列 -->
                <div
                    class="sf-radius rounded-none border px-3 py-2.5 xl:col-span-2"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <div class="mb-2 flex items-center justify-between">
                        <FieldLabel label="AI 配置文件" class="mb-0" />
                        <button
                            onclick={handleAddAiProfile}
                            class="inline-flex items-center gap-1 rounded-none px-2.5 py-1 text-[10px] font-medium transition-all hover:brightness-110"
                            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                        >
                            <Icon icon="mdi:plus" class="size-3" />
                            新建
                        </button>
                    </div>
                    <p class="mb-2 text-[10px] leading-4 text-(--theme-modal-text)/40">
                        点击配置即可切换；右侧按钮用于编辑与删除
                    </p>
                    <div class="mb-1.5 grid grid-cols-1 gap-1 xl:grid-cols-2 xl:gap-x-4">
                        {#each aiProfiles as p (p.id)}
                            {@const isActive = p.id === aiActiveId}
                            <div
                                class="sf-radius flex items-center gap-2 rounded-none border px-2.5 py-1.5 transition-colors"
                                style="border-color: {isActive
                                    ? 'color-mix(in srgb, var(--theme-accent-bg) 45%, transparent)'
                                    : 'var(--theme-divider-border)'}; background: color-mix(in srgb, var(--theme-accent-bg) {isActive
                                    ? '10%'
                                    : '0%'}, transparent);"
                            >
                                <button
                                    onclick={() => handleSelectAiProfile(p.id)}
                                    class="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                                    title="切换到该配置"
                                >
                                    <span
                                        class="flex w-full items-center gap-1.5 text-xs font-medium text-(--theme-modal-text)"
                                    >
                                        <Icon
                                            icon={isActive ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}
                                            class={isActive
                                                ? 'size-3.5 shrink-0 text-(--theme-accent-text)'
                                                : 'size-3.5 shrink-0 text-(--theme-modal-text)/30'}
                                        />
                                        <span class="truncate">{p.label}</span>
                                        {#if isActive}
                                            <span
                                                class="shrink-0 rounded-none bg-(--theme-accent-bg)/20 px-1 py-px text-[9px] text-(--theme-accent-text)"
                                                >当前</span
                                            >
                                        {/if}
                                    </span>
                                    <span class="w-full truncate pl-5 text-[10px] text-(--theme-modal-text)/40">
                                        {p.model} · {p.baseUrl}
                                    </span>
                                </button>
                                <div class="flex shrink-0 items-center gap-0.5">
                                    <button
                                        onclick={() => setAiEditTarget(p)}
                                        class="rounded-none p-1 text-(--theme-modal-text)/35 transition-colors hover:text-(--theme-accent-text)"
                                        title="编辑此配置"
                                    >
                                        <Icon icon="mdi:pencil-outline" class="size-3.5" />
                                    </button>
                                    <button
                                        onclick={() => handleDeleteAiProfile(p)}
                                        class="rounded-none p-1 text-(--theme-modal-text)/35 transition-colors hover:text-red-400"
                                        title="删除此配置"
                                    >
                                        <Icon icon="mdi:trash-can-outline" class="size-3.5" />
                                    </button>
                                </div>
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}
            {#if tab === 'ai'}
                <!-- 提示词设置 -->
                <div
                    class="sf-radius rounded-none border px-3 py-2.5"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <FieldLabel
                        label="提示词设置"
                        hint="人设提示词与模型配置分开保存；Buff 命名规则与黑话词典是内置技能"
                    />
                    <div class="mt-2 flex flex-col gap-1">
                        <div
                            class="sf-radius flex items-center gap-2 rounded-none border px-2.5 py-1.5"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <div class="min-w-0 flex-1">
                                <FieldLabel label="人设提示词" hint="AI 助手的角色与行为规则" />
                            </div>
                            <button
                                onclick={() => setPromptEditOpen(true)}
                                class="inline-flex shrink-0 items-center gap-1 rounded-none px-2.5 py-1 text-[10px] font-medium transition-all hover:brightness-110"
                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                            >
                                <Icon icon="mdi:pencil-outline" class="size-3" />
                                编辑
                            </button>
                        </div>
                    </div>
                </div>
            {/if}
        </div>

        <!-- 技能卡管理（主动 / 被动）：从助手头部 ⚡ 面板迁移至此 -->
        {#if tab === 'ai'}
            <div
                class="sf-radius mt-2 rounded-none border px-3 py-2.5"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                <SkillSection />
            </div>
        {/if}
    </div>
</div>
