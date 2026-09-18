<script lang="ts">
    import Icon from '@iconify/svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { CharacterInfo } from '$lib/api/types'
    import type { EchoSlotConfig } from '$lib/calc/config.types'
    import { getCharacterInfo } from '$lib/api/data-cache'
    import { getConfig, setEchoSlots } from '$lib/calc/config.store.svelte'
    import {
        buildStandardSlots,
        cloneSlots,
        planSubstatTotal,
        STANDARD_PLAN_NAME,
        STANDARD_SUBSTAT_TOTAL
    } from '$lib/calc/standard-substats'
    import {
        deleteSubstatPlan,
        fetchSubstatPlansFromShare,
        getStoredStandardPlan,
        getSubstatLibraryLoading,
        listPlansFor,
        loadSubstatLibrary,
        renameSubstatPlan,
        resetStandardPlan,
        saveSubstatPlan,
        type SubstatPlan
    } from '$lib/data/substat-library.svelte'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props extends ComponentsProps {
        charIndex: number
        character: string
        locked?: boolean
        onclose: () => void
        onapplied: () => void
    }

    let {
        charIndex,
        character,
        locked = false,
        onclose,
        onapplied,
        class: className,
        style: styleProp
    }: Props = $props()

    let info = $state<CharacterInfo | null>(null)
    let infoError = $state<string | null>(null)
    let newPlanName = $state('')
    let renameId = $state<string | null>(null)
    let renameText = $state('')
    let syncing = $state(false)

    $effect(() => {
        void loadSubstatLibrary()
    })

    $effect(() => {
        let cancelled = false
        info = null
        infoError = null
        void getCharacterInfo(character)
            .then((res) => {
                if (!cancelled) info = res
            })
            .catch((e) => {
                if (!cancelled) infoError = e instanceof Error ? e.message : '角色数据加载失败'
            })
        return () => {
            cancelled = true
        }
    })

    /** @desc 标准方案：优先取工坊/本地已保存的 14 词条方案，否则按角色数据自动生成 */
    let standardSlots = $derived.by<EchoSlotConfig[] | null>(() => {
        const stored = getStoredStandardPlan(character)
        if (stored) return stored.slots
        if (!info) return null
        return buildStandardSlots({ element: info.element, statNodes: info.statNodes })
    })
    let standardOrigin = $derived(
        getStoredStandardPlan(character)
            ? getStoredStandardPlan(character)!.source === 'share'
                ? '工坊'
                : '本地自定义'
            : '自动生成'
    )
    let customPlans = $derived(listPlansFor(character).filter((p) => !p.standard))
    let currentSlots = $derived<EchoSlotConfig[]>(getConfig().characters[charIndex]?.echoes ?? [])
    let currentTotal = $derived(planSubstatTotal(currentSlots))
    let busy = $derived(getSubstatLibraryLoading() || syncing)

    const costString = (slots: EchoSlotConfig[]) =>
        slots
            .map((s) => s.cost)
            .sort((a, b) => b - a)
            .join('')

    const slotSummary = (slot: EchoSlotConfig) =>
        `${slot.substats.map((s) => `${s.type}${s.value}${s.unit}`).join(' / ') || '无副词条'}`

    const mainSummary = (slot: EchoSlotConfig) =>
        slot.mainStat ? `${slot.mainStat.type}${slot.mainStat.value}${slot.mainStat.unit}` : '未选主词条'

    function applyPlan(slots: EchoSlotConfig[], label: string) {
        if (locked) {
            addToast('本环节已锁定，请先解锁', 'info')
            return
        }
        if (!setEchoSlots(charIndex, cloneSlots(slots))) {
            addToast('套用失败：方案结构非法或声骸总 cost 超过 12', 'error')
            return
        }
        addToast(`已把「${character}」的声骸词条替换为「${label}」`, 'success')
        onapplied()
        onclose()
    }

    function applyStandard() {
        if (!standardSlots) {
            addToast('角色数据尚未加载完成，无法生成标准词条集', 'info')
            return
        }
        applyPlan(standardSlots, STANDARD_PLAN_NAME)
    }

    async function saveCurrentAsStandard() {
        if (currentTotal !== STANDARD_SUBSTAT_TOTAL) {
            addToast(`标准词条集要求副词条恰为 ${STANDARD_SUBSTAT_TOTAL} 条，当前为 ${currentTotal} 条`, 'error')
            return
        }
        const id = await saveSubstatPlan({
            character,
            name: STANDARD_PLAN_NAME,
            standard: true,
            slots: currentSlots
        })
        addToast(
            id ? `已把当前词条保存为「${character}」的标准词条集` : '保存失败：方案结构非法',
            id ? 'success' : 'error'
        )
    }

    async function saveCurrentAsPlan() {
        const name = newPlanName.trim() || `方案${customPlans.length + 1}`
        const id = await saveSubstatPlan({ character, name, slots: currentSlots })
        if (!id) {
            addToast('保存失败：方案结构非法', 'error')
            return
        }
        addToast(`已保存方案「${name}」`, 'success')
        newPlanName = ''
    }

    async function commitRename(plan: SubstatPlan) {
        const name = renameText.trim()
        if (!name || name === plan.name) {
            renameId = null
            return
        }
        const ok = await renameSubstatPlan(plan.id, name)
        addToast(ok ? `已重命名为「${name}」` : '重命名失败', ok ? 'success' : 'error')
        renameId = null
    }

    async function removePlan(plan: SubstatPlan) {
        const ok = await deleteSubstatPlan(plan.id)
        addToast(ok ? `已删除方案「${plan.name}」` : '标准词条集不可删除，可改用「重置」', ok ? 'success' : 'info')
    }

    async function resetStandard() {
        await resetStandardPlan(character)
        addToast('已重置标准词条集：将回落到工坊方案 / 自动生成', 'success')
    }

    async function syncFromShare() {
        syncing = true
        const result = await fetchSubstatPlansFromShare()
        syncing = false
        addToast(
            result.ok ? `已从工坊同步 ${result.added} 个角色的标准词条集` : `同步失败：${result.error ?? '未知错误'}`,
            result.ok ? 'success' : 'error'
        )
    }
</script>

<Modal open {onclose} backdropClose class={className} style={styleProp}>
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon icon="mdi:clipboard-text-outline" class="size-4" />
            <span>{character} · 声骸词条方案</span>
        </span>
    {/snippet}

    <div class="flex w-[36rem] max-w-[88vw] flex-col gap-3">
        <!-- 当前状态 -->
        <div
            class="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <span class="opacity-70">当前工程：{costString(currentSlots)} · 副词条 {currentTotal}/14</span>
            <button
                onclick={syncFromShare}
                disabled={busy}
                class="flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors disabled:opacity-40"
                style="border-color: var(--theme-divider-border);"
                title="从工坊拉取各角色的标准词条集（本地自定义方案不会被覆盖）"
            >
                <Icon icon="mdi:cloud-download-outline" class="size-3.5" />
                工坊同步
            </button>
        </div>

        <!-- 标准14词条 -->
        <section class="rounded-lg border" style="border-color: var(--theme-divider-border);">
            <header
                class="flex items-center justify-between border-b px-3 py-2"
                style="border-color: var(--theme-divider-border);"
            >
                <span class="flex items-center gap-2 text-xs font-semibold">
                    <Icon icon="mdi:star-four-points-outline" class="size-3.5" />
                    {STANDARD_PLAN_NAME}
                    <span
                        class="rounded px-1.5 py-0.5 text-[10px] opacity-70"
                        style="background: var(--theme-input-bg);">{standardOrigin}</span
                    >
                </span>
                <span class="flex items-center gap-1">
                    <button
                        onclick={applyStandard}
                        disabled={!standardSlots || locked}
                        class="flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors disabled:opacity-40"
                        style="border-color: var(--theme-accent-bg); color: var(--theme-accent-text);"
                    >
                        <Icon icon="mdi:check-bold" class="size-3.5" />一键套用
                    </button>
                    <button
                        onclick={saveCurrentAsStandard}
                        class="rounded border px-2 py-1 text-[11px] transition-colors"
                        style="border-color: var(--theme-divider-border);"
                        title="把当前工程的词条保存为该角色的标准词条集（14 条，本地自定义优先于工坊）"
                    >
                        用当前词条覆盖
                    </button>
                    {#if standardOrigin !== '自动生成'}
                        <button
                            onclick={resetStandard}
                            class="rounded border px-2 py-1 text-[11px] transition-colors"
                            style="border-color: var(--theme-divider-border);"
                            title="清掉本地/工坊保存的方案，回落到工坊同步或自动生成"
                        >
                            重置
                        </button>
                    {/if}
                </span>
            </header>
            <div class="space-y-1 px-3 py-2 text-[11px]">
                {#if infoError}
                    <div class="opacity-60">角色数据加载失败：{infoError}</div>
                {:else if !standardSlots}
                    <div class="opacity-60">正在加载角色数据…</div>
                {:else}
                    {#each standardSlots as slot, i}
                        <div class="flex gap-2">
                            <span class="w-14 shrink-0 opacity-60">{slot.cost}cost</span>
                            <span class="w-28 shrink-0 truncate opacity-80" title={mainSummary(slot)}
                                >{mainSummary(slot)}</span
                            >
                            <span class="min-w-0 flex-1 truncate" title={slotSummary(slot)}>{slotSummary(slot)}</span>
                        </div>
                    {/each}
                {/if}
            </div>
        </section>

        <!-- 自建方案 -->
        <section class="rounded-lg border" style="border-color: var(--theme-divider-border);">
            <header
                class="flex items-center justify-between border-b px-3 py-2"
                style="border-color: var(--theme-divider-border);"
            >
                <span class="text-xs font-semibold">自定义方案（{customPlans.length}）</span>
                <span class="flex items-center gap-1">
                    <input
                        bind:value={newPlanName}
                        placeholder="方案名"
                        class="h-6 w-28 rounded border bg-transparent px-1.5 text-[11px] outline-none"
                        style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                    />
                    <button
                        onclick={saveCurrentAsPlan}
                        class="rounded border px-2 py-1 text-[11px] transition-colors"
                        style="border-color: var(--theme-divider-border);"
                        title="把当前工程的 5 个声骸词条存成一套可复用的方案"
                    >
                        存为方案
                    </button>
                </span>
            </header>
            <div class="theme-scrollbar max-h-56 space-y-1 overflow-y-auto px-3 py-2">
                {#if customPlans.length === 0}
                    <div class="py-2 text-[11px] opacity-50">
                        暂无自定义方案：可把当前词条「存为方案」，之后在其它工程一键覆盖。
                    </div>
                {/if}
                {#each customPlans as plan (plan.id)}
                    <div class="flex items-center gap-2 text-[11px]">
                        {#if renameId === plan.id}
                            <input
                                bind:value={renameText}
                                class="h-6 min-w-0 flex-1 rounded border bg-transparent px-1.5 outline-none"
                                style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                            />
                            <button onclick={() => commitRename(plan)} class="opacity-70 hover:opacity-100">确定</button
                            >
                            <button onclick={() => (renameId = null)} class="opacity-50 hover:opacity-80">取消</button>
                        {:else}
                            <span class="min-w-0 flex-1 truncate" title={plan.slots.map(slotSummary).join(' | ')}
                                >{plan.name}
                                <span class="opacity-50"
                                    >({costString(plan.slots)} · {planSubstatTotal(plan.slots)} 条)</span
                                ></span
                            >
                            <button
                                onclick={() => applyPlan(plan.slots, plan.name)}
                                disabled={locked}
                                class="rounded border px-2 py-1 transition-colors disabled:opacity-40"
                                style="border-color: var(--theme-divider-border);">套用</button
                            >
                            <button
                                onclick={() => {
                                    renameId = plan.id
                                    renameText = plan.name
                                }}
                                class="opacity-60 hover:opacity-100"
                                title="重命名"
                            >
                                <Icon icon="mdi:pencil" class="size-3.5" />
                            </button>
                            <button onclick={() => removePlan(plan)} class="opacity-60 hover:text-red-500" title="删除">
                                <Icon icon="mdi:close" class="size-3.5" />
                            </button>
                        {/if}
                    </div>
                {/each}
            </div>
        </section>
    </div>

    {#snippet footer()}
        <button
            onclick={onclose}
            class="rounded-lg border px-3 py-1.5 text-xs transition-colors"
            style="border-color: var(--theme-divider-border);">关闭</button
        >
    {/snippet}
</Modal>
