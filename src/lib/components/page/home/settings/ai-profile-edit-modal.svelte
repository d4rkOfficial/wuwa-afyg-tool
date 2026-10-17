<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import FieldLabel from '$lib/components/ui/field-label.svelte'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import {
        addProfile,
        coerceContextWindow,
        coerceMaxOutputTokens,
        coerceMaxToolRounds,
        DEFAULT_CONTEXT_WINDOW,
        DEFAULT_MAX_OUTPUT_TOKENS,
        DEFAULT_MAX_TOOL_ROUNDS,
        updateProfile,
        type AiProfile
    } from '$lib/ai/config.svelte'
    import { THINKING_LABELS, THINKING_LEVELS, isThinkingLevel } from '$lib/ai/thinking'
    import { AI_PROVIDER_PRESETS, type AiProviderPreset } from '$lib/ai/ai-providers'
    import { addToast } from '$lib/data/toast.svelte'
    import { mergeComponentsStyle } from '$lib/utils/component-style'
    import { ROW_TABS, TAB_ACCENT, ACTION_BTN, ACTION_BTN_ACCENT } from './utils'

    interface Props extends ComponentsProps {
        open: boolean
        profile: AiProfile | null
        onclose?: () => void
        onsaved?: () => void
    }

    let {
        open,
        profile,
        onclose,
        onsaved,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp
    }: Props = $props()

    let mergedStyle = $derived(mergeComponentsStyle({ backgroundImage, textColor, style: styleProp }))

    /**
     * @desc 思考强度（T15：原来是 3 个手搓分段按钮，与「类型 / 状态」两个控件同一形态）
     * → `ui/tabs` 的文字 tab（轨道取设置内统一的 `ROW_TABS`，分段必然等分，指示块无需测量即可对齐）。
     *
     * 档位与助手弹窗的会话级覆盖**共用** `$lib/ai/thinking` 的 `THINKING_LEVELS`：
     * 新增 `off`（关）后这里由三段变四段，`.tmp/components.md` 无需改动（`ui/tabs` 按段数算指示块宽）。
     */
    const REASONING_TABS = THINKING_LEVELS.map((level) => ({ value: level, label: THINKING_LABELS[level] }))
    const pickReasoning = (value: string) => {
        if (isThinkingLevel(value)) setDraft({ reasoningEffort: value })
    }

    let draft = $state<AiProfile | null>(null)
    let providerPickerOpen = $state(false)
    let providerPickerAnchor = $state<HTMLElement | undefined>()
    /**
     * @desc 上下文窗口的**输入框文本**（不是 `draft.contextWindow` 那个数字）。
     * 为什么分开：`coerceContextWindow()` 对越界/非法值会回落默认，若在每次 `oninput` 就归一，
     * 用户删空再重打（`""` → 128000）时输入框会自己跳回去，根本没法编辑。
     * 故这里保留原始文本，只在**保存这一个写入点**归一。
     */
    let contextWindowText = $state('')
    /** @desc 单次最大输出的输入框文本（归一与落盘只在保存时做，理由同 `contextWindowText`） */
    let maxOutputText = $state('')
    /** @desc 工具轮次上限的输入框文本 */
    let maxToolRoundsText = $state('')

    $effect(() => {
        if (open && profile) {
            draft = { ...profile }
            // 新建草稿（id 为空）时留白：让占位符把默认值说清楚，而不是先替用户填一个具体数字
            contextWindowText = profile.id === '' ? '' : String(profile.contextWindow)
            maxOutputText = profile.id === '' ? '' : String(profile.maxOutputTokens)
            maxToolRoundsText = profile.id === '' ? '' : String(profile.maxToolRounds)
        }
    })

    /** @desc 请求路径：自动（本地/白名单 host 直连，其余走站点转发）/ 浏览器直连（永远不走转发） */
    const REQUEST_MODE_TABS = [
        { value: 'auto', label: '自动' },
        { value: 'direct', label: '浏览器直连' }
    ]
    const requestMode = $derived(draft?.directRequest ? 'direct' : 'auto')
    const pickRequestMode = (value: string) => setDraft({ directRequest: value === 'direct' })

    // 点击图标按钮以外的区域时收起提供商弹层
    $effect(() => {
        if (!providerPickerOpen) return
        const onDown = (e: PointerEvent) => {
            if (providerPickerAnchor && !providerPickerAnchor.contains(e.target as Node)) providerPickerOpen = false
        }
        window.addEventListener('pointerdown', onDown, true)
        return () => window.removeEventListener('pointerdown', onDown, true)
    })

    const canSave = $derived(Boolean(draft && draft.label.trim() && draft.baseUrl.trim() && draft.model.trim()))

    /** @desc 当前填写的服务地址命中的提供商预设（按 origin 匹配），用于快捷端点高亮与 API Key 指引 */
    const matchedPreset = $derived.by(() => {
        if (!draft?.baseUrl) return undefined
        try {
            const origin = new URL(draft.baseUrl).origin
            return AI_PROVIDER_PRESETS.find((p) => {
                try {
                    return new URL(p.baseUrl).origin === origin
                } catch {
                    return false
                }
            })
        } catch {
            return undefined
        }
    })

    function setDraft(patch: Partial<AiProfile>) {
        if (!draft) return
        draft = { ...draft, ...patch }
    }

    /** @desc 快捷选择主流提供商：自动填入服务地址与模型示例 */
    function applyPreset(preset: AiProviderPreset) {
        setDraft({ baseUrl: preset.baseUrl, model: preset.modelHint })
        providerPickerOpen = false
    }

    async function handleSave() {
        if (!draft) return
        // 上下文窗口在此**唯一写入点**归一：非法/越界回落默认（见 coerceContextWindow）
        const patch = {
            ...draft,
            contextWindow: coerceContextWindow(Number(contextWindowText)),
            maxOutputTokens: coerceMaxOutputTokens(Number(maxOutputText)),
            maxToolRounds: coerceMaxToolRounds(Number(maxToolRoundsText))
        }

        // `id` 为空 = 尚未创建的新配置：**此刻才真正新建**（弹窗打开时不落库，取消即无副作用）
        if (!draft.id) {
            await addProfile(patch.label, patch)
        } else if (!(await updateProfile(draft.id, patch))) {
            // 配置已不存在（被设置页 / AI 的 manage_ai_profile 工具删掉）——必须报错，
            // 不能像原先那样无条件弹「已保存」，那会让「保存不生效」看起来像静默失败
            addToast('保存失败：该配置已不存在，请关掉弹窗重新打开设置', 'error')
            return
        }

        addToast('配置文件已保存', 'success')
        onsaved?.()
        onclose?.()
    }
</script>

<Modal {open} {onclose} backdropClose={false} class={className} style="width: min(92vw, 480px); {mergedStyle}">
    {#snippet title()}
        <Icon icon="mdi:view-grid-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span class="font-black tracking-tight">编辑配置文件</span>
    {/snippet}

    {#snippet footer()}
        <div
            class="flex items-center justify-end gap-2 border-t pt-3"
            style="border-color: var(--theme-divider-border);"
        >
            <Button variant="text" size="none" bare onclick={onclose} class={ACTION_BTN}>取消</Button>
            <Button
                variant="icon-text"
                size="none"
                bare
                keepDisabled
                onclick={handleSave}
                disabled={!canSave}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg)"
                class={ACTION_BTN_ACCENT}
            >
                <Icon icon="mdi:content-save-outline" class="size-3.5" />
                保存
            </Button>
        </div>
    {/snippet}

    {#if draft}
        <div class="flex flex-col gap-3">
            <label class="block">
                <FieldLabel label="配置名" class="mb-1" />
                <input
                    type="text"
                    value={draft.label}
                    oninput={(e) => setDraft({ label: (e.currentTarget as HTMLInputElement).value })}
                    placeholder="如 本地 Ollama"
                    class="w-full rounded-none border px-2.5 py-1.5 text-xs outline-none transition-colors placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)/50"
                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                />
            </label>
            <label class="block">
                <FieldLabel label="AI 服务地址" class="mb-1" />
                <div class="relative flex items-stretch gap-1.5" bind:this={providerPickerAnchor}>
                    <input
                        type="url"
                        value={draft.baseUrl}
                        oninput={(e) => setDraft({ baseUrl: (e.currentTarget as HTMLInputElement).value })}
                        placeholder="https://api.example.com/v1"
                        class="min-w-0 flex-1 rounded-none border px-2.5 py-1.5 text-xs outline-none transition-colors placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)/50"
                        style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                    />
                    <button
                        type="button"
                        title="选择主流提供商预设"
                        onclick={() => (providerPickerOpen = !providerPickerOpen)}
                        class={[
                            'flex size-8 shrink-0 items-center justify-center rounded-none border transition-colors',
                            providerPickerOpen
                                ? 'text-(--theme-accent-text)'
                                : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                        ].join(' ')}
                        style="background: var(--theme-input-bg); border-color: {providerPickerOpen
                            ? 'color-mix(in srgb, var(--theme-accent-bg) 40%, transparent)'
                            : 'var(--theme-divider-border)'};"
                    >
                        <Icon icon="mdi:view-grid-outline" class="size-4" />
                    </button>
                    {#if providerPickerOpen}
                        <div
                            class="sf-radius animate-pop-in theme-scrollbar absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-none border py-1"
                            style="background: color-mix(in srgb, var(--theme-modal-bg) 94%, transparent); border-color: var(--theme-divider-border);"
                        >
                            <div class="px-2.5 py-1 text-[10px] text-(--theme-modal-text)/40">
                                主流提供商（点击自动填入服务地址与模型示例）
                            </div>
                            {#each AI_PROVIDER_PRESETS as preset (preset.id)}
                                <button
                                    type="button"
                                    onclick={() => applyPreset(preset)}
                                    title={preset.baseUrl}
                                    class={[
                                        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                                        matchedPreset?.id === preset.id
                                            ? 'bg-(--theme-accent-bg)/10 text-(--theme-accent-text)'
                                            : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5'
                                    ].join(' ')}
                                >
                                    <span class="min-w-0 flex-1 truncate text-xs">{preset.label}</span>
                                    <span class="max-w-[55%] truncate text-[10px] text-(--theme-modal-text)/35">
                                        {preset.baseUrl}
                                    </span>
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
                {#if matchedPreset?.guide}
                    <p class="mt-1 text-[10px] leading-relaxed text-(--theme-modal-text)/40">
                        {matchedPreset.guide}
                    </p>
                {/if}
            </label>
            <label class="block">
                <FieldLabel label="模型名" class="mb-1" />
                <input
                    type="text"
                    value={draft.model}
                    oninput={(e) => setDraft({ model: (e.currentTarget as HTMLInputElement).value })}
                    placeholder={matchedPreset?.modelHint ?? '模型名'}
                    class="w-full rounded-none border px-2.5 py-1.5 text-xs outline-none transition-colors placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)/50"
                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                />
            </label>
            <label class="block">
                <FieldLabel label="AI API Key" class="mb-1" />
                <input
                    type="password"
                    value={draft.apiKey}
                    oninput={(e) => setDraft({ apiKey: (e.currentTarget as HTMLInputElement).value })}
                    placeholder="sk-..."
                    class="w-full rounded-none border px-2.5 py-1.5 text-xs outline-none transition-colors placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)/50"
                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                />
                {#if matchedPreset}
                    <p class="mt-1 text-[10px] text-(--theme-modal-text)/40">
                        {#if matchedPreset.apiKeyHref}
                            API Key 在
                            <a
                                href={matchedPreset.apiKeyHref}
                                target="_blank"
                                rel="noreferrer"
                                class="text-(--theme-accent-text) hover:underline">{matchedPreset.apiKeyLabel}</a
                            >
                            获取
                        {:else}
                            {matchedPreset.apiKeyLabel}
                        {/if}
                    </p>
                {/if}
            </label>
            <div>
                <FieldLabel label="思考强度" class="mb-1" />
                <Tabs
                    items={REASONING_TABS}
                    value={draft.reasoningEffort ?? 'medium'}
                    onchange={pickReasoning}
                    compact
                    class={ROW_TABS}
                    {...TAB_ACCENT}
                />
            </div>
            <label class="block">
                <FieldLabel label="上下文窗口（token）" class="mb-1" />
                <input
                    type="text"
                    inputmode="numeric"
                    bind:value={contextWindowText}
                    placeholder={String(DEFAULT_CONTEXT_WINDOW)}
                    class="w-full rounded-none border px-2.5 py-1.5 text-xs outline-none transition-colors placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)/50"
                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                />
                <p class="mt-1 text-[10px] leading-relaxed text-(--theme-modal-text)/40">
                    助手输入区那个用量圈的分母。服务商不会下发窗口大小，故需按模型填写（默认
                    {DEFAULT_CONTEXT_WINDOW}）；留空或填非法值会回落默认。
                </p>
            </label>
            <label class="block">
                <FieldLabel label="单次最大输出（token）" class="mb-1" />
                <input
                    type="text"
                    inputmode="numeric"
                    bind:value={maxOutputText}
                    placeholder={String(DEFAULT_MAX_OUTPUT_TOKENS)}
                    class="w-full rounded-none border px-2.5 py-1.5 text-xs outline-none transition-colors placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)/50"
                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                />
                <p class="mt-1 text-[10px] leading-relaxed text-(--theme-modal-text)/40">
                    单次回复最多能写多少 token（含思考）。偏小时回复会在半句处截断（默认
                    {DEFAULT_MAX_OUTPUT_TOKENS}）；请按模型真实上限填写，超出上限服务商会直接报错。
                </p>
            </label>
            <label class="block">
                <FieldLabel label="工具轮次上限" class="mb-1" />
                <input
                    type="text"
                    inputmode="numeric"
                    bind:value={maxToolRoundsText}
                    placeholder={String(DEFAULT_MAX_TOOL_ROUNDS)}
                    class="w-full rounded-none border px-2.5 py-1.5 text-xs outline-none transition-colors placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)/50"
                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                />
                <p class="mt-1 text-[10px] leading-relaxed text-(--theme-modal-text)/40">
                    一个回合内最多「模型 → 工具 → 模型」循环多少次（默认 {DEFAULT_MAX_TOOL_ROUNDS}）。查数据 + 改配置 +
                    校验这类任务容易超过旧上限，到顶时助手会明确提示而不是静默停止。
                </p>
            </label>
            <div>
                <FieldLabel label="请求方式" class="mb-1" />
                <Tabs
                    items={REQUEST_MODE_TABS}
                    value={requestMode}
                    onchange={pickRequestMode}
                    compact
                    class={ROW_TABS}
                    {...TAB_ACCENT}
                />
                <p class="mt-1 text-[10px] leading-relaxed text-(--theme-modal-text)/40">
                    自动 = 本地服务与已知支持 CORS 的地址直连，其余经站点转发；浏览器直连 =
                    所有请求都由浏览器直接发出（不经过 Cloudflare / Vercel 转发，不受平台请求体与时长限制）。
                    直连要求端点自身放行 CORS（预检需允许 Authorization 头），否则浏览器会拦下请求。
                </p>
            </div>
        </div>
    {/if}
</Modal>
