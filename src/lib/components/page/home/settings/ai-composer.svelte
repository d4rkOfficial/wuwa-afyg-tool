<script lang="ts">
    /**
     * @desc 助手输入区（composer）：圆角卡片内的输入框 + 工具条 + 右上角收起按钮。
     *
     * 形态对齐 DSH 的 composer：输入框在上、工具条在下（左权限 / 右模型·等级 / 用量圈 / 发送），
     * 会话状态行由宿主渲染在卡片**下方**。
     *
     * ## 三件交互约定
     * 1. **右上角「暂时收起」**：只把输入区折成**一行**（左侧显示当前阶段 / 上一轮汇总），
     *    窗口与消息区都留着；点这一行即展开。刻意不做成「收起整个悬浮窗」—— 头部已有那个按钮。
     * 2. **`pending` 槽位替掉输入行**：危险操作确认卡与 `ask_user` 提问卡都渲染在**本卡片内部**
     *    （原先它们在消息列表末尾，与输入框分成两块）。此刻回合正阻塞在工具里等作答，
     *    发送任何文本都不会被处理，故直接让卡片顶替输入行，而不是并排留一个用不了的输入框。
     *    此状态下不提供收起 —— 收起会把待作答的问题藏起来。
     * 3. **用量圈**紧贴发送按钮，表示最近一次请求的 prompt token 占上下文窗口的比例。
     *
     * ## 三件写入语义
     * 权限 / 提供商配置 / 思考强度都写**会话覆盖层**，不写持久化设置：`ai-config` 那条 IndexedDB
     * 记录已有两个写入者（设置页、AI 自己的 `manage_ai_profile` 工具），弹窗直连就是第三个
     * （用户只想「这次换个模型」却会永久改掉全局默认）。详见 `$lib/ai/session-overrides.svelte`。
     *
     * 界面**刻意不暴露「覆盖」这层概念**（没有「跟随设置」项、没有「临时」标记，与 DSH 一致）：
     * 按钮上显示的就是当前生效值；想要设置里的默认值，从同一个列表里选回它即可。
     *
     * ## 为什么菜单向上展开、且不用 `ui/select`
     * - composer 贴在窗口底部，向下展开会被悬浮窗的 `overflow-hidden` 直接裁掉 → 一律 `bottom-full`。
     * - `ui/select` 的菜单把 `fixed inset-0` 当透明捕捉层；而悬浮窗在**拖动时带 `transform`**，
     *   那会让 `fixed` 改为相对窗口定位（外层还有 `overflow-hidden`），菜单会错位甚至被裁掉。
     *   故这里改为「监听 window 的 pointerdown 捕获阶段」关闭菜单，不铺任何覆盖层。
     */
    import type { Snippet } from 'svelte'
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import { getAiProfiles } from '$lib/ai/config.svelte'
    import { THINKING_LEVELS, thinkingLabel, type ThinkingLevel } from '$lib/ai/thinking'
    import {
        resolveAiConfig,
        setSessionDangerMode,
        setSessionProfile,
        setSessionThinkingLevel
    } from '$lib/ai/session-overrides.svelte'
    import { getLastPromptTokens, getTurnRuntime } from '$lib/ai/turn-state.svelte'
    import {
        ACCEPT_ATTR,
        MAX_ATTACHMENTS,
        MAX_ATTACHMENT_BYTES,
        formatBytes,
        planAttachments,
        readImageAsDataUrl
    } from '$lib/ai/attachments'
    import { addToast } from '$lib/data/toast.svelte'
    import AiUsageRing from './ai-usage-ring.svelte'
    import { DANGER_MODE_OPTIONS } from './utils'

    interface Props extends ComponentsProps {
        /** @desc 生成中：发送按钮变为停止，且不允许再发送 */
        busy: boolean
        /** @desc 发送：正文（可能为空串）+ 图片附件 data URL 列表（可能为空数组） */
        onsend: (text: string, images: string[]) => void
        onstop: () => void
        /**
         * @desc 待确认 / 待作答的内容（危险确认卡 / `ask_user` 卡），传了就**替掉输入行**。
         *  刻意用 snippet 而不是让 composer 自己持有卡片状态：卡片的 resolve 回调与幂等收尾
         *  都归宿主（`ai-assistant.svelte`），这里只负责把它放进正确的容器里。
         */
        pending?: Snippet
        /**
         * @desc 收起时那一行显示的文案 —— **也就是 AI 的问题**。由宿主计算：
         *  危险确认卡给「确认执行「工具名」」，提问卡给当前问题的正文。
         *  composer 拿不到 `pending` 里的内容（snippet 是不透明的），故必须由宿主传进来。
         */
        pendingLabel?: string
    }

    let { busy, onsend, onstop, pending, pendingLabel, class: className, style: styleProp }: Props = $props()

    let input = $state('')
    /** @desc 待发送的图片附件（data URL）；发送后清空 */
    let draftImages = $state<string[]>([])
    let fileInput: HTMLInputElement | undefined = $state()
    /** @desc 输入区是否折成一行（只影响本卡片，不动窗口与消息区） */
    let collapsed = $state(false)
    /** @desc 当前展开的菜单（同一时刻只可能有一个） */
    let openMenu = $state<'danger' | 'model' | null>(null)
    let dangerAnchor: HTMLElement | undefined = $state()
    let modelAnchor: HTMLElement | undefined = $state()

    const config = $derived(resolveAiConfig())
    const profiles = $derived(getAiProfiles())
    const lastPromptTokens = $derived(getLastPromptTokens())
    const runtime = $derived(getTurnRuntime())

    const dangerOption = $derived(DANGER_MODE_OPTIONS.find((o) => o.value === config.dangerMode))
    const dangerLabel = $derived(dangerOption?.label ?? '权限')
    /** @desc `trust` 是「危险操作直接执行」，工具条上用警示色，避免它看起来和另外两档一样温和 */
    const dangerIsRisky = $derived(config.dangerMode === 'trust')

    const canSend = $derived(!busy && (input.trim().length > 0 || draftImages.length > 0))

    /**
     * 收起只对「待权限 / 待提问」阶段有意义（聊天模式**不提供收起**）。
     * 故没有 pending 时强制展开：卡片作答完（pending 消失）后自动回到展开态，
     * 下一次提问不会继承上一次的收起状态。
     */
    $effect(() => {
        if (!pending) collapsed = false
    })

    /**
     * 点击菜单与所属锚点之外的任何位置即收起。
     * 用**捕获阶段**监听：菜单内按钮若自己也 stopPropagation，冒泡阶段就收不到这次点击。
     */
    $effect(() => {
        if (!openMenu) return
        const anchor = openMenu === 'danger' ? dangerAnchor : modelAnchor
        const onDown = (e: PointerEvent) => {
            if (anchor && !anchor.contains(e.target as Node)) openMenu = null
        }
        window.addEventListener('pointerdown', onDown, true)
        return () => window.removeEventListener('pointerdown', onDown, true)
    })

    const submit = () => {
        const text = input.trim()
        // 只发图片、不带文字也是合法消息（发图问「这是什么」）
        if ((!text && draftImages.length === 0) || busy) return
        const images = draftImages
        input = ''
        draftImages = []
        onsend(text, images)
    }

    /** @desc 追加附件：逐个校验，被拒的逐条提示（不静默丢弃） */
    const addFiles = async (files: readonly File[]) => {
        if (files.length === 0) return
        const plan = planAttachments(draftImages.length, files)
        for (const reason of plan.rejections) addToast(reason, 'error')
        for (const file of plan.accepted) {
            try {
                const url = await readImageAsDataUrl(file)
                draftImages = [...draftImages, url]
            } catch (e) {
                addToast(e instanceof Error ? e.message : '读取图片失败', 'error')
            }
        }
    }

    const onFilePick = (e: Event & { currentTarget: HTMLInputElement }) => {
        const picked = Array.from(e.currentTarget.files ?? [])
        // 立刻清空 value：否则连续两次选同一个文件不会再触发 change
        e.currentTarget.value = ''
        void addFiles(picked)
    }

    /** @desc 粘贴图片：剪贴板里有文件时接管（否则放行，保持正常的文本粘贴） */
    const onPaste = (e: ClipboardEvent) => {
        const files = Array.from(e.clipboardData?.items ?? [])
            .filter((item) => item.kind === 'file')
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null)
        if (files.length === 0) return
        e.preventDefault()
        void addFiles(files)
    }

    const removeImage = (index: number) => {
        draftImages = draftImages.filter((_, i) => i !== index)
    }

    const pickDanger = (value: string) => {
        const option = DANGER_MODE_OPTIONS.find((o) => o.value === value)
        if (option) setSessionDangerMode(option.value)
        openMenu = null
    }

    const pickProfile = (id: string) => {
        setSessionProfile(id)
        openMenu = null
    }

    const pickThinking = (level: ThinkingLevel) => {
        setSessionThinkingLevel(level)
        openMenu = null
    }
</script>

<!-- composer 卡片：底色走 data-sf 区域质感（widget，flat = 不叠第二层毛玻璃，外层窗口已经模糊过） -->
<div class="shrink-0 px-2.5 pt-1 pb-2.5 {className || ''}" style={styleProp}>
    <div
        data-sf="widget"
        data-sf-flat
        class="relative sf-radius rounded-none border shadow-lg"
        style="border-color: var(--theme-divider-border);"
    >
        {#if pending}
            {#if collapsed}
                <!-- 收起态：只留一行「AI 的问题」（点整行即展开，不需要精确命中箭头） -->
                <button
                    type="button"
                    onclick={() => (collapsed = false)}
                    title="展开作答区"
                    class="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:brightness-110"
                >
                    <span
                        class="inline-block size-1.5 shrink-0 rounded-full"
                        style="background: var(--theme-accent-bg); opacity: {runtime.running ? 1 : 0.3};"
                    ></span>
                    <span class="min-w-0 flex-1 truncate text-[10px] text-(--theme-modal-text)/75">
                        {pendingLabel || '等待你的作答'}
                    </span>
                    <Icon icon="mdi:chevron-up" class="size-3.5 shrink-0 opacity-50" />
                </button>
            {:else}
                <!-- 右上角：暂时收起（`pt-5` 是给它留的位置，避免压住内容首行） -->
                <button
                    type="button"
                    onclick={() => (collapsed = true)}
                    title="暂时收起，只看 AI 的问题（不影响作答）"
                    aria-label="暂时收起作答区"
                    class="absolute top-1 right-1 sf-radius rounded-none p-1 text-(--theme-modal-text)/35 transition-colors hover:text-(--theme-modal-text)"
                >
                    <Icon icon="mdi:chevron-down" class="size-3.5" />
                </button>

                <div class="px-2.5 pt-5 pb-2">
                    {@render pending()}
                </div>
            {/if}
        {:else}
            <!-- 聊天模式：**不提供收起** —— 收起只对「待权限 / 待提问」有意义 -->
            <div class="px-2.5 py-2">
                {#if draftImages.length > 0}
                    <!-- 附件预览条：单行横向、超出换行；每张右上角有移除按钮。
                             用**索引**作 key 而不是 data URL：同一张图可以被附两次，
                             值重复会让 key 撞车（Svelte 运行时报错），此处位置即身份。 -->
                    <div class="mb-1.5 flex flex-wrap gap-1.5">
                        {#each draftImages as url, i (i)}
                            <div class="relative">
                                <img
                                    src={url}
                                    alt={`附件 ${i + 1}`}
                                    class="size-12 sf-radius rounded-none border object-cover"
                                    style="border-color: var(--theme-divider-border);"
                                />
                                <button
                                    type="button"
                                    onclick={() => removeImage(i)}
                                    title="移除这张图片"
                                    aria-label={`移除附件 ${i + 1}`}
                                    class="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center sf-radius rounded-none bg-black/70 text-white transition-colors hover:bg-red-500"
                                >
                                    <Icon icon="mdi:close" class="size-3" />
                                </button>
                            </div>
                        {/each}
                    </div>
                {/if}

                <textarea
                    bind:value={input}
                    placeholder="发指令，或点右下角切换模型 / 权限…（可粘贴图片）"
                    rows="2"
                    onpaste={onPaste}
                    onkeydown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            submit()
                        }
                    }}
                    class="theme-scrollbar max-h-40 min-h-0 w-full resize-none border-0 bg-transparent px-0.5 py-0.5 text-xs leading-relaxed outline-none placeholder:text-(--theme-modal-text)/30"
                    style="color: var(--theme-modal-text);"></textarea>

                <div class="mt-1 flex items-center gap-1.5">
                    <!-- ── 附件 ── -->
                    <button
                        type="button"
                        onclick={() => fileInput?.click()}
                        title="添加图片（最多 {MAX_ATTACHMENTS} 张，单张 ≤ {formatBytes(MAX_ATTACHMENT_BYTES)}）"
                        aria-label="添加图片附件"
                        class="flex size-6 shrink-0 items-center justify-center sf-radius rounded-none border text-(--theme-modal-text)/50 transition-colors hover:text-(--theme-modal-text)"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <Icon icon="mdi:paperclip" class="size-3.5" />
                    </button>
                    <input
                        bind:this={fileInput}
                        type="file"
                        accept={ACCEPT_ATTR}
                        multiple
                        class="hidden"
                        onchange={onFilePick}
                    />

                    <!-- ── 左：危险操作权限 ── -->
                    <div class="relative shrink-0" bind:this={dangerAnchor}>
                        <button
                            type="button"
                            onclick={() => (openMenu = openMenu === 'danger' ? null : 'danger')}
                            title="危险操作权限"
                            class="flex items-center gap-1 sf-radius rounded-none border px-2 py-1 text-[10px] transition-colors hover:brightness-110 {dangerIsRisky
                                ? 'text-red-400'
                                : 'text-(--theme-modal-text)/60'}"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <Icon
                                icon={dangerIsRisky ? 'mdi:shield-alert-outline' : 'mdi:shield-check-outline'}
                                class="size-3.5 shrink-0"
                            />
                            <span class="font-black">{dangerLabel}</span>
                            <Icon
                                icon={openMenu === 'danger' ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                                class="size-3 shrink-0 opacity-60"
                            />
                        </button>

                        {#if openMenu === 'danger'}
                            <div
                                class="theme-scrollbar animate-pop-in absolute bottom-full left-0 z-(--z-modal) mb-1 max-h-64 w-56 overflow-y-auto sf-radius rounded-none border py-1 shadow-2xl"
                                style="background: color-mix(in srgb, var(--theme-modal-bg) 96%, transparent); border-color: var(--theme-divider-border);"
                            >
                                <div class="px-2.5 py-1 text-[10px] text-(--theme-modal-text)/40">危险操作策略</div>
                                {#each DANGER_MODE_OPTIONS as option (option.value)}
                                    {@const active = config.dangerMode === option.value}
                                    <button
                                        type="button"
                                        onclick={() => pickDanger(option.value)}
                                        class="flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-(--theme-modal-text)/5"
                                    >
                                        <Icon
                                            icon={active ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}
                                            class="mt-0.5 size-3.5 shrink-0 {active
                                                ? 'text-(--theme-accent-text)'
                                                : 'text-(--theme-modal-text)/25'}"
                                        />
                                        <span class="min-w-0 flex-1">
                                            <span
                                                class="block text-[11px] {option.value === 'trust'
                                                    ? 'text-red-400'
                                                    : 'text-(--theme-modal-text)/80'}">{option.label}</span
                                            >
                                            <span class="block text-[10px] leading-snug text-(--theme-modal-text)/40"
                                                >{option.desc}</span
                                            >
                                        </span>
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </div>

                    <span class="min-w-0 flex-1"></span>

                    <!-- ── 右：提供商配置 · 思考强度（两级信息一个按钮，对齐 DSH 的「模型 · 等级」） ── -->
                    <div class="relative shrink-0" bind:this={modelAnchor}>
                        <button
                            type="button"
                            onclick={() => (openMenu = openMenu === 'model' ? null : 'model')}
                            title="{config.label} · {config.baseUrl}"
                            class="flex max-w-52 items-center gap-1.5 sf-radius rounded-none border px-2 py-1 transition-colors hover:brightness-110"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <span class="truncate text-[11px] font-black" style="color: var(--theme-modal-text);"
                                >{config.model}</span
                            >
                            <span class="shrink-0 text-[10px] text-(--theme-modal-text)/40"
                                >{thinkingLabel(config.thinkingLevel)}</span
                            >
                            <Icon
                                icon={openMenu === 'model' ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                                class="size-3 shrink-0 opacity-60"
                            />
                        </button>

                        {#if openMenu === 'model'}
                            <div
                                class="theme-scrollbar animate-pop-in absolute right-0 bottom-full z-(--z-modal) mb-1 max-h-72 w-64 overflow-y-auto sf-radius rounded-none border py-1 shadow-2xl"
                                style="background: color-mix(in srgb, var(--theme-modal-bg) 96%, transparent); border-color: var(--theme-divider-border);"
                            >
                                <div class="px-2.5 py-1 text-[10px] text-(--theme-modal-text)/40">提供商配置</div>
                                {#each profiles as profile (profile.id)}
                                    {@const active = config.profileId === profile.id}
                                    <button
                                        type="button"
                                        onclick={() => pickProfile(profile.id)}
                                        title={profile.baseUrl}
                                        class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-(--theme-modal-text)/5"
                                    >
                                        <Icon
                                            icon={active ? 'mdi:check' : 'mdi:circle-small'}
                                            class="size-3.5 shrink-0 {active
                                                ? 'text-(--theme-accent-text)'
                                                : 'text-(--theme-modal-text)/25'}"
                                        />
                                        <span class="min-w-0 flex-1">
                                            <span class="block truncate text-[11px] text-(--theme-modal-text)/80"
                                                >{profile.label}</span
                                            >
                                            <span class="block truncate text-[10px] text-(--theme-modal-text)/35"
                                                >{profile.model}</span
                                            >
                                        </span>
                                    </button>
                                {/each}

                                <div
                                    class="mt-1 border-t px-2.5 pt-2 pb-1 text-[10px] text-(--theme-modal-text)/40"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    思考强度（关 = 不发送思考参数）
                                </div>
                                <div class="grid grid-cols-4 gap-1 px-2 pb-2">
                                    {#each THINKING_LEVELS as level (level)}
                                        {@const active = config.thinkingLevel === level}
                                        <button
                                            type="button"
                                            onclick={() => pickThinking(level)}
                                            class="sf-radius rounded-none border py-1 text-[10px] transition-colors {active
                                                ? 'font-black'
                                                : 'text-(--theme-modal-text)/55 hover:text-(--theme-modal-text)'}"
                                            style="border-color: {active
                                                ? 'color-mix(in srgb, var(--theme-accent-bg) 45%, transparent)'
                                                : 'var(--theme-divider-border)'}; {active
                                                ? 'background: color-mix(in srgb, var(--theme-accent-bg) 14%, transparent); color: var(--theme-accent-text);'
                                                : ''}"
                                        >
                                            {thinkingLabel(level)}
                                        </button>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>

                    <!-- ── 用量圈 ── -->
                    <AiUsageRing used={lastPromptTokens} total={config.contextWindow} />

                    <!-- ── 发送 / 停止 ── -->
                    <button
                        type="button"
                        onclick={() => (busy ? onstop() : submit())}
                        disabled={!busy && !canSend}
                        class="flex size-8 shrink-0 items-center justify-center sf-radius rounded-none transition-all hover:brightness-110 disabled:opacity-35"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                        title={busy ? '停止生成' : '发送（Enter）'}
                    >
                        <Icon icon={busy ? 'mdi:stop' : 'mdi:arrow-up'} class="size-4" />
                    </button>
                </div>
            </div>
        {/if}
    </div>
</div>
