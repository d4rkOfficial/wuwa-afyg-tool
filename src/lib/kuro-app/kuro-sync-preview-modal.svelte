<script lang="ts">
    /**
     * @desc 库街区同步预览/确认弹窗：先看清楚「将写入哪些角色、跳过什么、哪些词条名没认出来」，
     *  勾选要写入的角色 + 可改方案名，确认后才落盘（同名方案覆盖）。
     *  - 默认**不勾选**；声骸不齐的角色照样列出（只显示已有的 cost），只跳过完全没声骸的
     *  - 上游只给「漂泊者」这类不带形态的名字时，用属性单选 tabs 指定；漂泊者永远排在最前
     *  - 其余角色按六属性分组（组内五星在前、再按名字排），双列展示，带角色头像
     */
    import Icon from '@iconify/svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import { ELEMENT_COLORS, ELEMENT_ORDER } from '$lib/consts/game-terms'
    import type { Character } from '$lib/api/types'
    import type { ComponentsProps } from '$lib/types'
    import { KURO_PLAN_NAME, type KuroPlanPick, type KuroSyncPreview } from '$lib/kuro-app/kuro-sync.svelte'
    import type { KuroPlanDraft } from '$lib/kuro-app/kuro-plan'

    interface Props extends ComponentsProps {
        open: boolean
        preview: KuroSyncPreview | null
        /** @desc 工具箱角色名录（取星级 / 属性，用于分组排序） */
        characters?: Character[]
        /** @desc 角色头像表（角色名 → 图像地址） */
        icons?: Record<string, string>
        /** @desc 写入中：禁用确认按钮 */
        busy?: boolean
        onconfirm: (opts: { planName: string; picks: KuroPlanPick[] }) => void
        onclose: () => void
    }

    let {
        open,
        preview,
        characters = [],
        icons = {},
        busy = false,
        onconfirm,
        onclose,
        class: className,
        style: styleProp
    }: Props = $props()

    let planName = $state(KURO_PLAN_NAME)
    /** @desc 勾选要写入的角色（按上游名定位；默认不勾选） */
    let picked = $state<string[]>([])
    /** @desc 需要指定形态的角色：上游名 → 选中的工具箱角色名（如漂泊者的属性） */
    let forms = $state<Record<string, string>>({})
    /** @desc 上一份预览：只在预览对象变化时重置勾选，避免用户手动取消后被重新勾上 */
    let lastPreview: KuroSyncPreview | null = null

    $effect(() => {
        const p = preview
        if (!p || p === lastPreview) return
        lastPreview = p
        picked = []
        forms = Object.fromEntries(
            p.plans.filter((plan) => plan.options?.length).map((plan) => [plan.upstreamName, plan.options?.[0] ?? ''])
        )
        planName = KURO_PLAN_NAME
    })

    /** @desc 角色名 → 名录条目（星级 / 属性） */
    const charByName = $derived(new Map(characters.map((c) => [c.name, c])))
    const elementOf = (name: string) => charByName.get(name)?.element ?? ''
    const starOf = (name: string) => charByName.get(name)?.star ?? 0

    const isPicked = (upstreamName: string) => picked.includes(upstreamName)
    const toggle = (upstreamName: string) => {
        picked = isPicked(upstreamName) ? picked.filter((k) => k !== upstreamName) : [...picked, upstreamName]
    }

    /** @desc 该角色最终写入用的名字：需要指定形态时取 tabs 选中值 */
    const characterOf = (plan: KuroPlanDraft) =>
        plan.options?.length ? (forms[plan.upstreamName] ?? '') : plan.character

    /** @desc 确认时把「上游名 → 写入角色名」一起带上，避免漂泊者写错属性 */
    const collectPicks = (): KuroPlanPick[] =>
        (preview?.plans ?? [])
            .filter((plan) => isPicked(plan.upstreamName))
            .map((plan) => ({ upstreamName: plan.upstreamName, character: characterOf(plan) }))
            .filter((pick) => !!pick.character)

    /** @desc 方案 cost 布局：43311 / 33111 / 44111（按 cost 从大到小） */
    const costString = (plan: KuroPlanDraft) =>
        plan.slots
            .map((s) => s.cost)
            .sort((a, b) => b - a)
            .join('')

    /** @desc 带形态（漂泊者）的角色排最前，其余按六属性分组，组内五星在前、再按名字排 */
    const groups = $derived.by(() => {
        const plans = preview?.plans ?? []
        const multi = plans.filter((p) => p.options?.length)
        const rest = plans.filter((p) => !p.options?.length)
        const byElement = new Map<string, KuroPlanDraft[]>()
        for (const plan of rest) {
            const key = elementOf(plan.character) || '其它'
            const bucket = byElement.get(key)
            if (bucket) bucket.push(plan)
            else byElement.set(key, [plan])
        }
        const order = [...ELEMENT_ORDER, '其它'] as string[]
        const sortPlans = (list: KuroPlanDraft[]) =>
            [...list].sort(
                (a, b) =>
                    starOf(b.character) - starOf(a.character) || a.character.localeCompare(b.character, 'zh-Hans-CN')
            )
        const out: { title: string; plans: KuroPlanDraft[] }[] = []
        if (multi.length > 0) out.push({ title: '', plans: sortPlans(multi) })
        for (const element of order) {
            const list = byElement.get(element)
            if (list?.length) out.push({ title: element, plans: sortPlans(list) })
        }
        return out
    })

    const allKeys = $derived((preview?.plans ?? []).map((p) => p.upstreamName))
    const allPicked = $derived(allKeys.length > 0 && picked.length === allKeys.length)
</script>

<Modal {open} {onclose} class={className} style={styleProp}>
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon icon="mdi:account-sync-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <span class="text-sm font-black tracking-tight text-(--theme-modal-text)">从库街区同步</span>
            {#if preview}
                <span class="text-[11px] text-(--theme-modal-text)/40">来源角色：{preview.roleName}</span>
            {/if}
        </span>
    {/snippet}

    <div class="w-[min(94vw,66rem)] space-y-3">
        <label class="block">
            <span class="mb-1 block text-[11px] text-(--theme-modal-text)/40">方案名（同名方案会被覆盖）</span>
            <input
                bind:value={planName}
                class="w-full rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            />
        </label>

        {#if preview}
            <div class="flex items-center gap-2 text-[11px] text-(--theme-modal-text)/40">
                <span>
                    将写入 <b class="text-(--theme-accent-text)">{picked.length}</b> / {preview.plans.length} 个角色{#if preview.skipped.length > 0}，跳过
                        {preview.skipped.length} 个{/if}
                </span>
                <button
                    onclick={() => (picked = allPicked ? [] : allKeys)}
                    class="rounded-none border px-2 py-0.5 text-[11px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                    style="border-color: var(--theme-divider-border);"
                >
                    {allPicked ? '全不选' : '全选'}
                </button>
            </div>

            <div class="theme-scrollbar max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {#each groups as group (group.title || 'multi')}
                    <div class="space-y-1.5">
                        {#if group.title}
                            <div class="flex items-center gap-2">
                                <span
                                    class="size-2 shrink-0"
                                    style="background: {ELEMENT_COLORS[group.title] ?? 'var(--theme-divider-border)'};"
                                ></span>
                                <span class="text-[11px] font-black text-(--theme-modal-text)/60">{group.title}</span>
                                <span class="text-[10px] text-(--theme-modal-text)/30">{group.plans.length}</span>
                                <span
                                    class="h-px flex-1"
                                    style="background: color-mix(in srgb, var(--theme-modal-text) 10%, transparent);"
                                ></span>
                            </div>
                        {/if}
                        <div class="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
                            {#each group.plans as plan (plan.upstreamName)}
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <div
                                    class={[
                                        'flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-none border px-2 py-1.5 text-xs transition-colors',
                                        isPicked(plan.upstreamName)
                                            ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10'
                                            : 'border-(--theme-divider-border) bg-(--theme-input-bg) hover:bg-(--theme-modal-text)/5'
                                    ].join(' ')}
                                    onclick={() => toggle(plan.upstreamName)}
                                >
                                    <Icon
                                        icon={isPicked(plan.upstreamName)
                                            ? 'mdi:checkbox-marked'
                                            : 'mdi:checkbox-blank-outline'}
                                        class="size-4 shrink-0 text-(--theme-accent-text)"
                                    />
                                    {#if icons[characterOf(plan) || plan.upstreamName]}
                                        <img
                                            src={icons[characterOf(plan) || plan.upstreamName]}
                                            alt=""
                                            class="size-8 shrink-0 object-cover"
                                            style="background: color-mix(in srgb, var(--theme-modal-text) 6%, transparent);"
                                        />
                                    {:else}
                                        <span
                                            class="flex size-8 shrink-0 items-center justify-center"
                                            style="background: color-mix(in srgb, var(--theme-modal-text) 6%, transparent);"
                                        >
                                            <Icon
                                                icon="mdi:account-outline"
                                                class="size-4 text-(--theme-modal-text)/30"
                                            />
                                        </span>
                                    {/if}

                                    {#if plan.options?.length}
                                        <span class="min-w-0 shrink-0 truncate font-black text-(--theme-modal-text)"
                                            >{plan.upstreamName}</span
                                        >
                                    {:else}
                                        <span
                                            class="min-w-0 flex-1 truncate font-black text-(--theme-modal-text)"
                                            title={plan.matched
                                                ? ''
                                                : `工具箱名录里没有「${plan.upstreamName}」，将按上游名写入`}
                                            >{plan.character}</span
                                        >
                                        {#if !plan.matched}
                                            <span class="shrink-0 text-[10px] text-(--theme-accent-text)/70"
                                                >{plan.upstreamName}</span
                                            >
                                        {/if}
                                    {/if}

                                    <span
                                        class="ml-auto shrink-0 text-[11px] font-black tabular-nums tracking-[0.18em] text-(--theme-modal-text)/50"
                                        title="声骸 cost 布局">{costString(plan)}</span
                                    >
                                    {#if plan.echoCount < 5}
                                        <span class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/40"
                                            >声骸 {plan.echoCount}/5</span
                                        >
                                    {/if}

                                    {#if plan.options?.length}
                                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                                        <div
                                            class="flex w-full flex-wrap items-center gap-1"
                                            onclick={(e) => e.stopPropagation()}
                                        >
                                            {#each plan.options as opt (opt)}
                                                {@const active = (forms[plan.upstreamName] ?? '') === opt}
                                                {@const color =
                                                    ELEMENT_COLORS[elementOf(opt)] ?? 'var(--theme-accent-bg)'}
                                                <button
                                                    onclick={() => (forms[plan.upstreamName] = opt)}
                                                    class="rounded-none border px-1.5 py-0.5 text-[10px] font-black transition-colors"
                                                    style="border-color: {active
                                                        ? color
                                                        : 'var(--theme-divider-border)'}; color: {active
                                                        ? color
                                                        : 'var(--theme-modal-text)'}; background: {active
                                                        ? `color-mix(in srgb, ${color} 16%, transparent)`
                                                        : 'var(--theme-input-bg)'};"
                                                    title="写入为 {opt}"
                                                >
                                                    {elementOf(opt) || opt}
                                                </button>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>

            {#if preview.skipped.length > 0}
                <div
                    class="rounded-none border px-2.5 py-2 text-[11px]"
                    style="border-color: var(--theme-divider-border);"
                >
                    <div class="mb-1 font-black text-(--theme-modal-text)/60">已跳过</div>
                    <div class="space-y-0.5 text-(--theme-modal-text)/40">
                        {#each preview.skipped as s (s.character)}
                            <div>· {s.character}：{s.reason}</div>
                        {/each}
                    </div>
                </div>
            {/if}

            {#if preview.unmatchedNames.length > 0}
                <div class="text-[11px] text-red-400">
                    未识别的词条名：{preview.unmatchedNames.join('、')}（这些词条不会写入方案）
                </div>
            {/if}
        {:else}
            <div class="py-6 text-center text-xs text-(--theme-modal-text)/40">没有可同步的数据</div>
        {/if}
    </div>

    {#snippet footer()}
        <div class="flex items-center justify-end gap-2">
            <button
                onclick={onclose}
                class="rounded-none border px-3 py-1.5 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                style="border-color: var(--theme-divider-border);"
            >
                取消
            </button>
            <button
                onclick={() => onconfirm({ planName, picks: collectPicks() })}
                disabled={busy || picked.length === 0}
                class="flex items-center gap-1.5 rounded-none px-3 py-1.5 text-xs font-black transition-all hover:brightness-125 disabled:opacity-40"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
            >
                <Icon
                    icon={busy ? 'mdi:loading' : 'mdi:download'}
                    class={busy ? 'size-3.5 animate-spin' : 'size-3.5'}
                />
                写入 {picked.length} 个方案
            </button>
        </div>
    {/snippet}
</Modal>
