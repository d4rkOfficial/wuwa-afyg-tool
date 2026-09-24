<script lang="ts">
    /**
     * @desc 库街区同步预览/确认弹窗：先看清楚「将写入哪些角色、跳过什么、哪些词条名没认出来」，
     *  勾选要写入的角色 + 可改方案名，确认后才落盘（同名方案覆盖）。
     *  默认**不勾选**；声骸不齐的角色照样列出（空槽位没有主词条 badge），只跳过完全没声骸的；
     *  上游只给「漂泊者」这类不带形态的名字时，由这里下拉指定属性。
     */
    import Icon from '@iconify/svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import type { ComponentsProps } from '$lib/types'
    import { abbrevMainStat } from '$lib/utils/substat-abbrev'
    import { KURO_PLAN_NAME, type KuroPlanPick, type KuroSyncPreview } from '$lib/kuro-app/kuro-sync.svelte'

    interface Props extends ComponentsProps {
        open: boolean
        preview: KuroSyncPreview | null
        /** @desc 写入中：禁用确认按钮 */
        busy?: boolean
        onconfirm: (opts: { planName: string; picks: KuroPlanPick[] }) => void
        onclose: () => void
    }

    let { open, preview, busy = false, onconfirm, onclose, class: className, style: styleProp }: Props = $props()

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

    const isPicked = (upstreamName: string) => picked.includes(upstreamName)
    const toggle = (upstreamName: string) => {
        picked = isPicked(upstreamName) ? picked.filter((k) => k !== upstreamName) : [...picked, upstreamName]
    }

    /** @desc 该角色最终写入用的名字：需要指定形态时取下拉选中值 */
    const characterOf = (plan: KuroSyncPreview['plans'][number]) =>
        plan.options?.length ? (forms[plan.upstreamName] ?? '') : plan.character

    /** @desc 确认时把「上游名 → 写入角色名」一起带上，避免漂泊者写错属性 */
    const collectPicks = (): KuroPlanPick[] =>
        (preview?.plans ?? [])
            .filter((plan) => isPicked(plan.upstreamName))
            .map((plan) => ({ upstreamName: plan.upstreamName, character: characterOf(plan) }))
            .filter((pick) => !!pick.character)

    /** @desc 主词条 badge：[4C|暴击]（简写口径与词条集一致）；没有主词条的槽位不显示 */
    const slotBadge = (slot: { cost: number; mainStat: { type: string } | null }) =>
        slot.mainStat ? `[${slot.cost}C|${abbrevMainStat(slot.mainStat.type)}]` : ''
</script>

<Modal {open} {onclose} class={className} style={styleProp}>
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon icon="mdi:account-sync-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <span class="text-sm font-black tracking-tight text-(--theme-modal-text)">从库街区同步</span>
            {#if preview}
                <span class="text-[10px] text-(--theme-modal-text)/40">来源角色：{preview.roleName}</span>
            {/if}
        </span>
    {/snippet}

    <div class="w-[min(92vw,44rem)] space-y-3">
        <label class="block">
            <span class="mb-1 block text-[10px] text-(--theme-modal-text)/40">方案名（同名方案会被覆盖）</span>
            <input
                bind:value={planName}
                class="w-full rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            />
        </label>

        {#if preview}
            <div class="flex items-center gap-2 text-[10px] text-(--theme-modal-text)/40">
                <span>
                    将写入 <b class="text-(--theme-accent-text)">{picked.length}</b> / {preview.plans.length} 个角色{#if preview.skipped.length > 0}，跳过
                        {preview.skipped.length} 个{/if}
                </span>
                <button
                    onclick={() =>
                        (picked =
                            picked.length === preview.plans.length ? [] : preview.plans.map((p) => p.upstreamName))}
                    class="rounded-none border px-1.5 py-0.5 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                    style="border-color: var(--theme-divider-border);"
                >
                    {picked.length === preview.plans.length ? '全不选' : '全选'}
                </button>
            </div>

            <div class="theme-scrollbar max-h-64 space-y-1 overflow-y-auto">
                {#each preview.plans as plan (plan.upstreamName)}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class={[
                            'flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-none border px-2.5 py-1.5 text-[11px] transition-colors',
                            isPicked(plan.upstreamName)
                                ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10'
                                : 'border-(--theme-divider-border) bg-(--theme-input-bg) hover:bg-(--theme-modal-text)/5'
                        ].join(' ')}
                        onclick={() => toggle(plan.upstreamName)}
                    >
                        <Icon
                            icon={isPicked(plan.upstreamName) ? 'mdi:checkbox-marked' : 'mdi:checkbox-blank-outline'}
                            class="size-4 shrink-0 text-(--theme-accent-text)"
                        />
                        {#if plan.options?.length}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <select
                                bind:value={forms[plan.upstreamName]}
                                onclick={(e) => e.stopPropagation()}
                                class="shrink-0 rounded-none border px-1 py-0.5 text-[11px] font-black text-(--theme-modal-text) outline-none"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                title="上游只给了「{plan.upstreamName}」，请指定要写入哪个形态"
                            >
                                {#each plan.options as opt (opt)}
                                    <option value={opt}>{opt}</option>
                                {/each}
                            </select>
                            <span class="shrink-0 text-[10px] text-(--theme-modal-text)/40"
                                >上游名：{plan.upstreamName}</span
                            >
                        {:else}
                            <span class="shrink-0 max-w-[10rem] truncate font-black text-(--theme-modal-text)"
                                >{plan.character}</span
                            >
                            {#if !plan.matched}
                                <span
                                    class="shrink-0 rounded-none bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] text-(--theme-accent-text)"
                                    title="工具箱角色名录里没有找到该名字，将按上游名字写入"
                                    >上游名：{plan.upstreamName}</span
                                >
                            {/if}
                        {/if}

                        <span class="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                            {#each plan.slots as slot, i (i)}
                                {#if slotBadge(slot)}
                                    <span
                                        class="shrink-0 rounded-none px-1 py-0.5 text-[10px] font-black tabular-nums text-(--theme-modal-text)/80"
                                        style="background: color-mix(in srgb, var(--theme-modal-text) 8%, transparent);"
                                        title={slot.mainStat
                                            ? `${slot.mainStat.type}${slot.mainStat.value}${slot.mainStat.unit}`
                                            : ''}>{slotBadge(slot)}</span
                                    >
                                {/if}
                            {/each}
                        </span>

                        <span class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/40"
                            >声骸 {plan.echoCount}/5</span
                        >
                    </div>
                {/each}
            </div>

            {#if preview.skipped.length > 0}
                <div
                    class="rounded-none border px-2.5 py-2 text-[10px]"
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
                <div class="text-[10px] text-red-400">
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
