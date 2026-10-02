<script lang="ts">
    /**
     * @desc 内置 AI 助手的「向用户提问」卡片（`ask_user` 工具的交互界面）：一次显示一题的问题组，
     *  支持是否型 / 单选型（带自定义输入）/ 多选型（带自定义输入），四个动作：上一题 / 下一题 / 忽略本题 / 提交。
     *
     * 为什么是**内联卡片**而不是弹窗（AGENTS §3 的弹窗约束）：它和 `confirmCard` 一样长在消息列表末尾 ——
     *  用户在读 AI 上下文的同一处顺手作答，不该抢焦点、不该锁滚动，故刻意不用 `layout/modal.svelte`。
     *
     * 为什么单选/多选不用 `ui/tabs`：tabs 的每一段只能放一段文字，而候选项要能带 `description` 次行说明；
     *  且多选在语义上不是分段控件。故这两类走原生 radio / checkbox 行（`accent-color` 走主题色）。
     *
     * 收尾契约（**唯一权威**，父组件再用 `settleOnce` 兜一层）：
     *  - 提交 → `onresolve({ submitted: true, answers })`；
     *  - 卸载（面板收起 / 清空对话 / 父组件换卡） → `onresolve({ submitted: false, answers: [] })`；
     *  - 二者都只可能发生一次：本组件 `settled` 守卫 + 父组件「每张卡独立 resolve + `settleOnce`」。
     *  - 实例与一次提问一一对应：父组件用 `{#key}` 强制重挂，故卸载回调里的 `onresolve` 一定是**本卡**的收尾函数。
     */
    import { onDestroy } from 'svelte'
    import Icon from '@iconify/svelte'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import { mergeClass, joinStyle } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import type { AskUserRequest, AskUserResult } from '$lib/ai/tools/ask-user.types'
    import {
        BOOLEAN_TABS,
        CUSTOM_LABEL,
        EMPTY_QUESTION,
        blockerText,
        cancelResult,
        canGoNext,
        canGoPrev,
        canSkip,
        clampIndex,
        draftOf,
        indexAfterSkip,
        isCustomOn,
        isPicked,
        normalizeGroup,
        pickRadio,
        progressText,
        questionBadges,
        questionStatus,
        setCustomPick,
        setCustomText,
        skipQuestion,
        stepIndex,
        submitBlockers,
        toResult,
        toggleCheck,
        type AskCardOption,
        type AskDraft,
        type AskQuestionStatus
    } from './ask-user-card.utils'

    interface Props extends ComponentsProps {
        /** @desc 一次提问（问题组）；归一由 `ask-user-card.utils.ts` 负责 */
        request: AskUserRequest
        /** @desc 收尾回调：提交 / 放弃都走它（单词型事件 prop 全小写，AGENTS §3） */
        onresolve: (result: AskUserResult) => void
    }

    let { request, onresolve, class: className, style: styleProp }: Props = $props()

    /** @desc 本实例的 id 前缀（`aria-labelledby` 关联用；同页多张卡也不会撞 id） */
    const uid = $props.id()
    const titleId = `${uid}-title`
    const questionLabelId = `${uid}-question`

    // 归一后的问题组：跟着 `request` 走（父组件换卡时 `{#key}` 会重挂，这里也能自己反映变化）
    const group = $derived(normalizeGroup(request))
    const questions = $derived(group.questions)
    const total = $derived(questions.length)

    /** @desc 当前题下标（上一题 / 下一题 / 点题号都只改它，越界由纯函数钳制） */
    let index = $state(0)
    /** @desc 用户改过的草稿；`null` = 尚未改动，直接用归一后的初始草稿（避免从 `$derived` 初始化 `$state`） */
    let edits = $state<AskDraft | null>(null)
    const draft = $derived(edits ?? group.draft)

    const current = $derived(questions[clampIndex(index, total)] ?? EMPTY_QUESTION)
    const item = $derived(draftOf(draft, current.id))
    const blockers = $derived(submitBlockers(questions, draft))
    const submittable = $derived(blockers.length === 0)
    const skipAllowed = $derived(canSkip(current))
    const pickable = $derived(current.type === 'single')
    const radioName = $derived(`${uid}-${current.id}`)

    /** @desc 题型状态文案（题号点的 aria-label 用） */
    const STATUS_LABEL: Record<AskQuestionStatus, string> = {
        answered: '已作答',
        skipped: '已忽略',
        unanswered: '未作答'
    }

    const FOOT_BTN =
        'rounded-none border border-(--theme-divider-border) px-2.5 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text) disabled:pointer-events-none disabled:opacity-30'
    const STEP_BTN =
        'flex size-5 shrink-0 items-center justify-center rounded-none border text-[10px] tabular-nums transition-colors'
    const STEP_BTN_TONE: Record<AskQuestionStatus, string> = {
        answered: 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/20 font-black text-(--theme-accent-text)',
        skipped: 'border-(--theme-divider-border) text-(--theme-modal-text)/35 line-through',
        unanswered: 'border-(--theme-divider-border) text-(--theme-modal-text)/50 hover:text-(--theme-modal-text)'
    }

    /** @desc 已收尾守卫（非响应式：只用于「最多收尾一次」，不参与渲染） */
    let settled = false

    /**
     * @desc 收尾：提交与卸载共用。`settled` 保证 `onresolve` 最多被调用一次 ——
     *  提交后父组件会清掉卡片状态，卡片随即卸载并再触发一次卸载收尾，第二次直接被这里挡掉。
     */
    const settle = (result: AskUserResult) => {
        if (settled) return
        settled = true
        onresolve(result)
    }

    const submit = () => {
        if (!submittable) return
        settle(toResult(questions, draft))
    }

    const ignoreCurrent = () => {
        if (!skipAllowed) return
        edits = skipQuestion(draft, current)
        index = indexAfterSkip(index, total)
    }

    const goPrev = () => (index = stepIndex(index, total, -1))
    const goNext = () => (index = stepIndex(index, total, 1))
    const jumpTo = (no: number) => (index = clampIndex(no - 1, total))

    // 卸载（父组件收起面板 / 清空对话 / 换卡 / 整卡被销毁）一律按「用户放弃」收尾，绝不留悬挂的 Promise
    onDestroy(() => settle(cancelResult()))
</script>

<div
    role="group"
    aria-labelledby={titleId}
    class={mergeClass(['rounded-none border px-3 py-2.5', className])}
    style={joinStyle([
        'border-color: color-mix(in srgb, var(--theme-accent-bg) 45%, transparent);',
        'background: color-mix(in srgb, var(--theme-input-bg) 80%, transparent);',
        styleProp
    ])}
>
    <!-- 头部：AI 为什么问、这组问题的标题 -->
    <div class="flex items-start gap-2">
        <Icon icon="mdi:help-circle-outline" class="mt-px size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <div class="min-w-0 flex-1 leading-tight">
            <div id={titleId} class="text-xs font-black tracking-tight">{group.title || '需要你的确认'}</div>
            {#if group.description}
                <div class="mt-0.5 text-[10px] leading-relaxed text-(--theme-modal-text)/55">
                    {group.description}
                </div>
            {/if}
        </div>
    </div>

    <!-- 进度：第 N / M 题 + 题号点（点即跳题；底色/划线区分 已答/已忽略/未答） -->
    <div class="mt-2 flex items-center gap-2 border-t pt-2" style="border-color: var(--theme-divider-border);">
        <span class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/45">{progressText(index, total)}</span>
        <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {#each questions as q (q.id)}
                {@const status = questionStatus(q, draftOf(draft, q.id))}
                <button
                    type="button"
                    onclick={() => jumpTo(q.no)}
                    aria-label={`第 ${q.no} 题（${STATUS_LABEL[status]}）`}
                    aria-current={q.id === current.id ? 'step' : undefined}
                    class={mergeClass([STEP_BTN, STEP_BTN_TONE[status]])}
                    style={q.id === current.id ? 'box-shadow: 0 0 0 1px var(--theme-accent-bg);' : ''}
                >
                    {q.no}
                </button>
            {/each}
        </div>
    </div>

    <!-- 当前题：题号 + 题型标记 + 正文 + 说明 -->
    <div class="mt-2 flex flex-wrap items-center gap-1.5">
        <span id={questionLabelId} class="text-xs leading-snug font-black">{current.question}</span>
        {#each questionBadges(current) as badge (badge)}
            <span
                class="rounded-none border border-(--theme-divider-border) px-1 py-px text-[9px] text-(--theme-modal-text)/45"
                >{badge}</span
            >
        {/each}
    </div>
    {#if current.description}
        <div class="mt-0.5 text-[10px] leading-relaxed text-(--theme-modal-text)/50">{current.description}</div>
    {/if}

    <!-- 作答区：是否型 = 两段等宽文字 tab；单选/多选 = 原生控件行（可带次行说明） -->
    {#snippet optionRow(opt: AskCardOption, control: 'radio' | 'checkbox')}
        <label
            class="flex cursor-pointer items-start gap-2 rounded-none border px-2.5 py-2 transition-colors hover:border-(--theme-accent-bg)"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <input
                type={control}
                name={radioName}
                class="mt-0.5 size-3.5 shrink-0"
                style="accent-color: var(--theme-accent-bg, #6366f1);"
                checked={isPicked(draft, current.id, opt.value)}
                onchange={() =>
                    (edits = pickable
                        ? pickRadio(draft, current.id, opt.value)
                        : toggleCheck(draft, current.id, opt.value))}
            />
            <span class="min-w-0 flex-1">
                <span class="block text-xs leading-snug">{opt.label}</span>
                {#if opt.description}
                    <span class="mt-0.5 block text-[10px] leading-relaxed text-(--theme-modal-text)/45">
                        {opt.description}
                    </span>
                {/if}
            </span>
        </label>
    {/snippet}

    {#if current.type === 'boolean'}
        <div class="mt-2">
            <Tabs
                items={BOOLEAN_TABS}
                value={item.picked[0] ?? ''}
                onchange={(v) => (edits = pickRadio(draft, current.id, v))}
                class="w-full"
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg)"
            />
        </div>
    {:else}
        <div
            role={pickable ? 'radiogroup' : 'group'}
            aria-labelledby={questionLabelId}
            class="mt-2 flex flex-col gap-1"
        >
            {#each current.options as opt (opt.value)}
                {@render optionRow(opt, pickable ? 'radio' : 'checkbox')}
            {/each}

            {#if current.allowCustom}
                <!-- 「其它」是**选项本身**：单选型里是一个 radio，多选型里是一个 checkbox；选中才展开输入框 -->
                <div
                    class="rounded-none border"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <label class="flex cursor-pointer items-start gap-2 px-2.5 py-2">
                        <input
                            type={pickable ? 'radio' : 'checkbox'}
                            name={radioName}
                            class="mt-0.5 size-3.5 shrink-0"
                            style="accent-color: var(--theme-accent-bg, #6366f1);"
                            checked={isCustomOn(draft, current.id)}
                            onchange={() => (edits = setCustomPick(draft, current, !isCustomOn(draft, current.id)))}
                        />
                        <span class="min-w-0 flex-1">
                            <span class="block text-xs leading-snug">{CUSTOM_LABEL}</span>
                        </span>
                    </label>
                    {#if item.customOn}
                        <div class="border-t px-2.5 py-2" style="border-color: var(--theme-divider-border);">
                            <input
                                type="text"
                                value={item.customText}
                                placeholder={current.customPlaceholder}
                                aria-label={`${CUSTOM_LABEL}输入`}
                                oninput={(e) => (edits = setCustomText(draft, current, e.currentTarget.value))}
                                onkeydown={(e) => {
                                    if (e.key !== 'Enter') return
                                    e.preventDefault()
                                    submit()
                                }}
                                class="w-full rounded-none border px-2 py-1 text-xs outline-none transition-colors"
                                style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                            />
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}

    <!-- 四个动作：上一题 / 忽略本题 / 下一题 / 提交（必答未作答时提交禁用并指出是第几题） -->
    <div class="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
            type="button"
            variant="text"
            size="none"
            bare
            keepDisabled
            onclick={goPrev}
            disabled={!canGoPrev(index)}
            backgroundImage="transparent"
            class={FOOT_BTN}
            title="回到上一题">上一题</Button
        >
        <Button
            type="button"
            variant="text"
            size="none"
            bare
            keepDisabled
            onclick={ignoreCurrent}
            disabled={!skipAllowed}
            backgroundImage="transparent"
            class={FOOT_BTN}
            title={skipAllowed ? '把本题标记为「忽略」，不计入作答' : '必答题不能忽略'}>忽略本题</Button
        >
        <span class="min-w-0 flex-1"></span>
        <Button
            type="button"
            variant="text"
            size="none"
            bare
            keepDisabled
            onclick={goNext}
            disabled={!canGoNext(index, total)}
            backgroundImage="transparent"
            class={FOOT_BTN}
            title="继续下一题">下一题</Button
        >
        <Button
            type="button"
            variant="text"
            size="none"
            bare
            keepDisabled
            onclick={submit}
            disabled={!submittable}
            backgroundImage="var(--theme-accent-bg)"
            textColor="var(--theme-accent-text-on-bg, #fff)"
            class="px-2.5 py-1 text-[10px] font-black transition-all hover:brightness-110"
            title={submittable ? '提交这一组作答' : blockerText(blockers)}>提交</Button
        >
    </div>
    {#if blockers.length > 0}
        <div class="mt-1.5 flex items-start gap-1 text-[10px] leading-relaxed text-amber-400/90">
            <Icon icon="mdi:alert-circle-outline" class="mt-px size-3 shrink-0" />
            <span>{blockerText(blockers)}</span>
        </div>
    {/if}
</div>
