<script lang="ts">
    /**
     * @desc 导入 Buff 冲突解决弹窗：两种需要用户决策的情况
     * 1. **同名冲突**（与已有 buff 名字相同、内容不同）：逐条选「跳过 / 覆盖」，也可一键「剩余全部跳过 / 剩余全部覆盖」；
     * 2. **内容一致**（条件 + 乘区 + 乘区条件完全相同，只是名字不同）：询问是否把已有 buff 改成导入的名字。
     *    同一个名字下内容也一致的，视为无冲突（直接跳过、不打扰）。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import { slide } from 'svelte/transition'

    interface Props extends ComponentsProps {
        open: boolean
        /** @desc 同名冲突条目（名字 + 已有 buff 名） */
        conflicts: { index: number; name: string }[]
        /** @desc 内容一致但名字不同的条目（导入名 → 已有名） */
        identical: { index: number; name: string; existingName: string }[]
        /** @desc 本次导入总条数（用于展示"共 N 条，其中 M 条重名"） */
        total: number
        onclose: () => void
        onconfirm: (decisions: {
            sameName: 'skip' | 'overwrite'
            /** @desc 逐条决议（下标 → 跳过/覆盖）；未列出的走下同 sameName */
            perIndex: Record<number, 'skip' | 'overwrite'>
            renameIdentical: boolean
            renames: { index: number; name: string }[]
        }) => void
    }

    let { open, conflicts, identical, total, onclose, onconfirm, class: className, style: styleProp }: Props = $props()

    /** @desc 逐条决议；未显式选择的走批量决议（bulk） */
    let perIndex = $state<Record<number, 'skip' | 'overwrite'>>({})
    let bulk = $state<'skip' | 'overwrite'>('skip')
    /** @desc 是否把已有 buff 改名成导入的名字（默认开启，符合"对齐工坊命名"的诉求） */
    let doRename = $state(true)
    /** @desc 逐条取消重命名 */
    let renameSkipped = $state<Record<number, boolean>>({})

    /** @desc 弹窗（重新）打开时重置所有决议 */
    let prevOpen = $state(false)
    $effect(() => {
        if (open && !prevOpen) {
            perIndex = {}
            bulk = 'skip'
            doRename = true
            renameSkipped = {}
        }
        prevOpen = open
    })

    const decisionOf = (index: number): 'skip' | 'overwrite' => perIndex[index] ?? bulk

    const choose = (index: number, kind: 'skip' | 'overwrite') => {
        perIndex = { ...perIndex, [index]: kind }
    }

    /** @desc 把当前批量决议固化成逐条决议，这样后续改批量不影响已定的条目 */
    const freezeRemaining = (kind: 'skip' | 'overwrite') => {
        const next = { ...perIndex }
        for (const c of conflicts) if (next[c.index] === undefined) next[c.index] = kind
        perIndex = next
        bulk = kind
    }

    const activeRenames = $derived(identical.filter((it) => !renameSkipped[it.index]))

    const overwriteCount = $derived(conflicts.filter((c) => decisionOf(c.index) === 'overwrite').length)
    const skipCount = $derived(conflicts.length - overwriteCount)
    /** @desc 实际写入条数 = 总数 - 跳过的重名条数 */
    const willImport = $derived(Math.max(0, total - skipCount))

    const toggleRename = (index: number) => {
        renameSkipped = { ...renameSkipped, [index]: !renameSkipped[index] }
    }
</script>

<Modal
    {open}
    {onclose}
    backdropClose={false}
    class={className}
    style="width: min(94vw, 640px); max-height: 86vh; {styleProp || ''}"
>
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon icon="mdi:alert-decagram-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <span class="font-black tracking-tight">导入冲突</span>
        </span>
    {/snippet}

    <div class="flex min-h-0 flex-col gap-3">
        <!-- 同名冲突 -->
        {#if conflicts.length > 0}
            <div
                class="flex items-center gap-1.5 rounded-none border px-3 py-2"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                <Icon icon="mdi:content-duplicate" class="size-3.5 shrink-0 text-(--theme-modal-text)/50" />
                <span class="text-xs text-(--theme-modal-text)">
                    <span class="font-black text-(--theme-accent-text)">{conflicts.length}</span> 条 Buff 与已有条目重名
                </span>
                <span class="flex-1"></span>
                <button
                    onclick={() => freezeRemaining('skip')}
                    class="rounded-none border px-2 py-1 text-[10px] transition-colors hover:border-(--theme-accent-bg)"
                    style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                    title="其余未决定的都跳过，保留已有条目">剩余全部跳过</button
                >
                <button
                    onclick={() => freezeRemaining('overwrite')}
                    class="rounded-none border px-2 py-1 text-[10px] transition-colors hover:border-(--theme-accent-bg)"
                    style="border-color: var(--theme-divider-border); color: var(--theme-accent-text);"
                    title="其余未决定的都用导入内容覆盖已有条目">剩余全部覆盖</button
                >
            </div>

            <div class="theme-scrollbar min-h-0 max-h-64 space-y-1 overflow-y-auto">
                {#each conflicts as c (c.index)}
                    <div
                        transition:slide={{ duration: 120 }}
                        class="flex items-center gap-2 rounded-none border px-2.5 py-1.5"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <span class="min-w-0 flex-1 truncate text-xs text-(--theme-modal-text)">{c.name}</span>
                        <div
                            class="flex shrink-0 overflow-hidden rounded-none border"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <button
                                onclick={() => choose(c.index, 'skip')}
                                class={[
                                    'px-2 py-1 text-[10px] transition-colors',
                                    decisionOf(c.index) === 'skip'
                                        ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                        : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                ].join(' ')}
                                title="保留已有条目，不导入这一条">跳过</button
                            >
                            <button
                                onclick={() => choose(c.index, 'overwrite')}
                                class={[
                                    'px-2 py-1 text-[10px] transition-colors',
                                    decisionOf(c.index) === 'overwrite'
                                        ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                        : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                ].join(' ')}
                                title="删除已有的同名条目并写入导入内容">覆盖</button
                            >
                        </div>
                    </div>
                {/each}
            </div>
        {/if}

        <!-- 内容一致 → 询问重命名 -->
        {#if identical.length > 0}
            <div
                class="flex items-center gap-1.5 rounded-none border px-3 py-2"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                <Icon icon="mdi:approximately-equal" class="size-3.5 shrink-0 text-(--theme-modal-text)/50" />
                <span class="text-xs leading-relaxed text-(--theme-modal-text)">
                    <span class="font-black text-(--theme-accent-text)">{identical.length}</span>
                    条内容完全一致（条件 / 乘区 / 乘区条件都相同），只是名字不同 —— 是否把已有条目改成导入的名字？
                </span>
                <span class="flex-1"></span>
                <button
                    onclick={() => (doRename = !doRename)}
                    class={[
                        'rounded-none border px-2 py-1 text-[10px] transition-colors',
                        doRename
                            ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                            : 'text-(--theme-modal-text)/40'
                    ].join(' ')}
                    style={doRename ? '' : 'border-color: var(--theme-divider-border);'}
                >
                    {doRename ? '将重命名' : '保持原名'}
                </button>
            </div>

            {#if doRename}
                <div class="theme-scrollbar min-h-0 max-h-48 space-y-1 overflow-y-auto">
                    {#each identical as it (it.index)}
                        <div
                            class="flex items-center gap-2 rounded-none border px-2.5 py-1.5 text-[11px]"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <button
                                onclick={() => toggleRename(it.index)}
                                class="shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] transition-colors"
                                style={renameSkipped[it.index]
                                    ? 'border-color: var(--theme-divider-border); color: color-mix(in srgb, var(--theme-modal-text) 40%, transparent);'
                                    : 'border-color: var(--theme-accent-bg); color: var(--theme-accent-text);'}
                                title={renameSkipped[it.index] ? '点击改回重命名' : '点击跳过这一条的重命名'}
                                >{renameSkipped[it.index] ? '重命名' : '重命名 ✓'}</button
                            >
                            <span class="min-w-0 flex-1 truncate text-(--theme-modal-text)/50">{it.existingName}</span>
                            <Icon icon="mdi:arrow-right" class="size-3 shrink-0 text-(--theme-modal-text)/30" />
                            <span class="min-w-0 flex-1 truncate text-(--theme-modal-text)">{it.name}</span>
                        </div>
                    {/each}
                </div>
            {/if}
        {/if}

        <!-- 结算 -->
        <div
            class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-[11px] text-(--theme-modal-text)/50"
            style="border-color: var(--theme-divider-border);"
        >
            <span>共 <span class="font-black text-(--theme-modal-text)">{total}</span> 条</span>
            {#if conflicts.length > 0}
                <span>覆盖 <span class="font-black text-(--theme-accent-text)">{overwriteCount}</span></span>
                <span>跳过 <span class="font-black text-(--theme-modal-text)">{skipCount}</span></span>
            {/if}
            {#if doRename && activeRenames.length > 0}
                <span>重命名已有 <span class="font-black text-(--theme-accent-text)">{activeRenames.length}</span></span
                >
            {/if}
            <span class="flex-1"></span>
            <span>将写入 <span class="font-black text-(--theme-accent-text)">{willImport}</span> 条</span>
        </div>
    </div>

    {#snippet footer()}
        <div
            class="flex items-center justify-end gap-2 border-t pt-3"
            style="border-color: var(--theme-divider-border);"
        >
            <button
                onclick={onclose}
                class="h-7 rounded-none px-4 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                style="background: var(--theme-input-bg);">取消</button
            >
            <button
                onclick={() =>
                    onconfirm({
                        sameName: bulk,
                        perIndex: { ...perIndex },
                        renameIdentical: doRename,
                        renames: activeRenames.map((it) => ({ index: it.index, name: it.name }))
                    })}
                class="inline-flex h-7 items-center gap-1.5 rounded-none px-4 text-xs font-medium transition-all hover:brightness-125"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
            >
                <Icon icon="mdi:import" class="size-3.5" />
                按此导入
            </button>
        </div>
    {/snippet}
</Modal>
