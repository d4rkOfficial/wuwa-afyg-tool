<script lang="ts">
    /**
     * @desc 库街区同步预览/确认弹窗：先看清楚「将写入哪些角色、跳过什么、哪些词条名没认出来」，
     *  勾选要写入的角色 + 可改方案名，确认后才落盘（同名方案覆盖）。
     */
    import Icon from '@iconify/svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import type { ComponentsProps } from '$lib/types'
    import { KURO_PLAN_NAME, type KuroSyncPreview } from '$lib/kuro-app/kuro-sync.svelte'

    interface Props extends ComponentsProps {
        open: boolean
        preview: KuroSyncPreview | null
        /** @desc 写入中：禁用确认按钮 */
        busy?: boolean
        onconfirm: (opts: { planName: string; characters: string[] }) => void
        onclose: () => void
    }

    let { open, preview, busy = false, onconfirm, onclose, class: className, style: styleProp }: Props = $props()

    let planName = $state(KURO_PLAN_NAME)
    /** @desc 勾选要写入的角色（默认全选） */
    let picked = $state<string[]>([])
    /** @desc 上一份预览：只在预览对象变化时重置勾选，避免用户手动取消后被重新勾上 */
    let lastPreview: KuroSyncPreview | null = null

    $effect(() => {
        const p = preview
        if (!p || p === lastPreview) return
        lastPreview = p
        picked = p.plans.map((plan) => plan.character)
        planName = KURO_PLAN_NAME
    })

    const isPicked = (character: string) => picked.includes(character)
    const toggle = (character: string) => {
        picked = isPicked(character) ? picked.filter((c) => c !== character) : [...picked, character]
    }
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

    <div class="w-[min(92vw,40rem)] space-y-3">
        <label class="block">
            <span class="mb-1 block text-[10px] text-(--theme-modal-text)/40">方案名（同名方案会被覆盖）</span>
            <input
                bind:value={planName}
                class="w-full rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            />
        </label>

        {#if preview}
            <div class="text-[10px] text-(--theme-modal-text)/40">
                将写入 <b class="text-(--theme-accent-text)">{picked.length}</b> / {preview.plans.length} 个角色{#if preview.skipped.length > 0}，跳过
                    {preview.skipped.length} 个{/if}
            </div>

            <div class="theme-scrollbar max-h-64 space-y-1 overflow-y-auto">
                {#each preview.plans as plan (plan.upstreamName)}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class={[
                            'flex cursor-pointer items-center gap-2 rounded-none border px-2.5 py-1.5 text-[11px] transition-colors',
                            isPicked(plan.character)
                                ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10'
                                : 'border-(--theme-divider-border) bg-(--theme-input-bg) hover:bg-(--theme-modal-text)/5'
                        ].join(' ')}
                        onclick={() => toggle(plan.character)}
                    >
                        <Icon
                            icon={isPicked(plan.character) ? 'mdi:checkbox-marked' : 'mdi:checkbox-blank-outline'}
                            class="size-4 shrink-0 text-(--theme-accent-text)"
                        />
                        <span class="min-w-0 flex-1 truncate font-black text-(--theme-modal-text)"
                            >{plan.character}</span
                        >
                        {#if !plan.matched}
                            <span
                                class="shrink-0 rounded-none bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] text-(--theme-accent-text)"
                                title="工具箱角色名录里没有找到该名字，将按上游名字写入"
                                >上游名：{plan.upstreamName}</span
                            >
                        {/if}
                        <span class="shrink-0 text-[10px] text-(--theme-modal-text)/40"
                            >{plan.slots.map((s) => s.cost).join('')} · {plan.slots.reduce(
                                (n, s) => n + s.substats.length,
                                0
                            )} 条</span
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
                onclick={() => onconfirm({ planName, characters: picked })}
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
