<script lang="ts">
    /**
     * @desc 「编辑伤害类型」弹窗：逐个倍率确认伤害类型（拉表第一步）
     * 三列结构：倍率名 / 伤害类型多选 / 同步到所有同名伤害；顶部标题右侧为帮助按钮
     */
    import Icon from '@iconify/svelte'
    import { fade, slide } from 'svelte/transition'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import { DAMAGE_TYPES, DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'
    import {
        countSameNameEntries,
        setDamageTypesForEntry,
        syncDamageTypesToSameName
    } from '$lib/calc/calculation.store.svelte'
    import { inferDamageTypes } from '$lib/calc/utils'
    import { buildEchoDescByEntry } from '$lib/calc/skill-infer'
    import { ensureCharInfo, ensureEchoSkillText, getCharInfoMap, getEchoSkillText } from '$lib/data/char-info.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import type { DamageEntry } from '$lib/calc/calculation.types'
    import type { CharSlot } from '$lib/types/project'

    interface Props extends ComponentsProps {
        open: boolean
        damageEntries: DamageEntry[]
        team: [CharSlot, CharSlot, CharSlot]
        entryDamageTypeMap: Record<string, string[]>
        locked?: boolean
        onclose: () => void
        /** @desc 每次改动后回写工程（与表格内的切换保持一致） */
        onpersist: () => void
    }

    let {
        open,
        damageEntries,
        team,
        entryDamageTypeMap,
        locked = false,
        onclose,
        onpersist,
        class: className,
        style: styleProp
    }: Props = $props()

    let helpOpen = $state(false)

    let mergedStyle = $derived(styleProp || '')

    /** @desc 自动推导结果：未手填时按条目特征推断（与表格内展示一致） */
    let charInfoMap = $derived(getCharInfoMap())
    let echoSkillText = $derived(getEchoSkillText())
    let echoDescByEntry = $derived(buildEchoDescByEntry(damageEntries, team, echoSkillText))
    $effect(() => {
        for (const slot of team) {
            if (slot.character) void ensureCharInfo(slot.character)
            const echoName = slot.echoes?.[0]?.name
            if (echoName) void ensureEchoSkillText(echoName)
        }
    })
    let inferredTypeMap = $derived<Record<string, string[]>>(
        Object.fromEntries(
            damageEntries.map((e) => [
                e.id,
                inferDamageTypes(e, e.character ? charInfoMap[e.character] : undefined, echoDescByEntry[e.id])
            ])
        )
    )

    /** @desc 按角色分段（保持时间线顺序），段内逐条列出倍率 */
    let charGroups = $derived.by(() => {
        const groups: Array<{ character: string; entries: DamageEntry[] }> = []
        for (const entry of damageEntries) {
            const key = entry.character ?? '未指定角色'
            const last = groups[groups.length - 1]
            if (last && last.character === key) last.entries.push(entry)
            else groups.push({ character: key, entries: [entry] })
        }
        return groups
    })

    /** @desc 效应 / 谐度类条目伤害类型由结算方式决定，不参与编辑 */
    const isEditable = (entry: DamageEntry) => !entry.isEffect && !entry.isTuneBreak && !entry.isTuneResponse

    let editableCount = $derived(damageEntries.filter((e) => isEditable(e)).length)

    const shortTypes = (types: string[]) => types.map((t) => DAMAGE_TYPE_SHORT[t] ?? t).join('/')

    /** @desc 第一列副标题里的倍率摘要：百分比 / 固定值 / 效应层数 */
    const ratioLabel = (entry: DamageEntry) => {
        if (entry.isEffect) return `${Math.round(entry.ratioValue)} 层`
        if (entry.ratioUnit === 'fixed') return `固定值 ${Math.round(entry.ratioValue)}`
        return `${Math.round(entry.ratioValue * 100) / 100}%`
    }

    function toggleType(entry: DamageEntry, damageType: string) {
        if (locked) {
            addToast('本环节已锁定，请先解锁', 'info')
            return
        }
        const current = entryDamageTypeMap[entry.id] ?? []
        const next = current.includes(damageType) ? current.filter((t) => t !== damageType) : [...current, damageType]
        setDamageTypesForEntry(entry.id, next)
        onpersist()
    }

    function syncToSameName(entry: DamageEntry) {
        const types = entryDamageTypeMap[entry.id] ?? []
        const count = syncDamageTypesToSameName(entry.id)
        if (count <= 1) {
            addToast(`没有其它同名伤害（同名范围：同一角色 + 同一技能类型）`, 'info')
            return
        }
        onpersist()
        addToast(
            types.length === 0
                ? `已清空 ${count} 条同名伤害的手动设置（回到自动推导）`
                : `已把「${entry.displayName}」的伤害类型同步到 ${count} 条同名伤害`,
            'success'
        )
    }

    const HELP_PARAGRAPHS = [
        '鸣潮的角色技能伤害类型不一定和技能类型一致，有大量的倍率「为 XX 伤害」「视为 XX 伤害」，甚至一个倍率属于多种类型伤害都有可能。',
        '椰果工具箱通过技能文案进行了初步自动推导，但这不一定是准确的。为了方便复杂情况拉表，如取消 hit、工具箱解析不出来的倍率自行添加等，自定义出来的倍率，不支持自动推导，需要手动调整。',
        '本弹窗是拉表的第一步，只有确认伤害类型无误后，开始拉表才能不出错。',
        '本弹窗支持一键设置同名伤害为同种伤害类型，不过请小心使用，因为存在像达妮娅这样的角色，同倍率的伤害，不同条件下伤害类型是不同的——黑娅普攻，有回路能量时是解放伤害，否则是普攻伤害。'
    ]
</script>

<Modal {open} {onclose} backdropClose class="w-[68rem] max-w-[94vw] {className}" style={mergedStyle}>
    {#snippet title()}
        <span class="flex items-center gap-2 pr-8">
            <Icon icon="mdi:playlist-edit" class="size-4 shrink-0" />
            <span>编辑伤害类型</span>
            <button
                onclick={() => (helpOpen = !helpOpen)}
                class="rounded-full p-0.5 transition-colors {helpOpen
                    ? 'text-(--theme-accent-text)'
                    : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'}"
                title="这个弹窗怎么用？"
                aria-label="帮助"
            >
                <Icon icon="mdi:help-circle-outline" class="size-4" />
            </button>
        </span>
    {/snippet}

    <div class="flex flex-col gap-3">
        {#if helpOpen}
            <section
                in:slide={{ duration: 160 }}
                class="shrink-0 space-y-1.5 rounded-lg border px-3 py-2.5 text-xs leading-relaxed"
                style="border-color: color-mix(in srgb, var(--theme-accent-bg) 35%, transparent); background: color-mix(in srgb, var(--theme-accent-bg) 8%, transparent); color: var(--theme-modal-text)/85;"
            >
                <div class="flex items-center gap-1.5 font-semibold text-(--theme-accent-text)">
                    <Icon icon="mdi:lightbulb-on-outline" class="size-3.5 shrink-0" />
                    为什么要先确认伤害类型
                </div>
                {#each HELP_PARAGRAPHS as paragraph (paragraph)}
                    <p>{paragraph}</p>
                {/each}
            </section>
        {/if}

        <!-- 列头 -->
        <div
            class="flex shrink-0 items-center gap-3 border-b px-1 pb-1.5 text-[11px] font-semibold text-(--theme-modal-text)/50"
            style="border-color: var(--theme-divider-border);"
        >
            <span class="min-w-0 flex-1">倍率名</span>
            <span class="w-[34rem] shrink-0">伤害类型</span>
            <span class="w-24 shrink-0 text-center">同步</span>
        </div>

        <div class="theme-scrollbar {helpOpen ? 'h-[42vh]' : 'h-[58vh]'} space-y-3 overflow-y-auto pr-1">
            {#each charGroups as group (group.character)}
                <div class="space-y-1">
                    <div class="flex items-center gap-2 px-1 text-xs font-semibold text-(--theme-modal-text)">
                        <Icon icon="mdi:account-outline" class="size-3.5 shrink-0 text-(--theme-modal-text)/50" />
                        <span>{group.character}</span>
                        <span class="text-[10px] font-normal text-(--theme-modal-text)/40"
                            >{group.entries.length} 条倍率</span
                        >
                    </div>
                    {#each group.entries as entry (entry.id)}
                        {@const explicit = entryDamageTypeMap[entry.id] ?? []}
                        {@const inferred = inferredTypeMap[entry.id] ?? []}
                        {@const sameNameCount = countSameNameEntries(entry.id)}
                        {@const editable = isEditable(entry)}
                        <div
                            in:fade={{ duration: 100 }}
                            class="flex items-center gap-3 rounded-lg border px-2 py-1.5"
                            style="border-color: var(--theme-card-border); background: var(--theme-card-bg);"
                        >
                            <!-- 第一列：倍率名 -->
                            <div class="min-w-0 flex-1">
                                <div class="truncate text-xs text-(--theme-modal-text)" title={entry.displayName}>
                                    {entry.displayName}
                                </div>
                                <div class="flex items-center gap-1.5 text-[10px] text-(--theme-modal-text)/40">
                                    <span>{entry.skillType || '未分类'}</span>
                                    <span>{ratioLabel(entry)}</span>
                                    {#if entry.hits > 1}
                                        <span>×{entry.hits} hit</span>
                                    {/if}
                                </div>
                            </div>

                            <!-- 第二列：伤害类型 -->
                            <div class="flex w-[34rem] shrink-0 flex-wrap items-center gap-1">
                                {#if editable}
                                    {#each DAMAGE_TYPES as dt (dt)}
                                        {@const selected = explicit.includes(dt)}
                                        <button
                                            onclick={() => toggleType(entry, dt)}
                                            disabled={locked}
                                            title={dt}
                                            class="rounded border px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-40 {selected
                                                ? ''
                                                : 'text-(--theme-modal-text)/45 hover:bg-(--theme-modal-text)/10'}"
                                            style={selected
                                                ? 'background: color-mix(in srgb, var(--theme-accent-bg) 22%, transparent); color: var(--theme-accent-text); border-color: color-mix(in srgb, var(--theme-accent-bg) 45%, transparent);'
                                                : 'background: var(--theme-input-bg); border-color: var(--theme-divider-border);'}
                                        >
                                            {DAMAGE_TYPE_SHORT[dt] ?? dt}
                                        </button>
                                    {/each}
                                    {#if explicit.length === 0 && inferred.length > 0}
                                        <span class="ml-1 text-[10px] text-(--theme-modal-text)/35"
                                            >自动推导：{shortTypes(inferred)}</span
                                        >
                                    {/if}
                                {:else}
                                    <span class="text-[11px] text-(--theme-modal-text)/45"
                                        >{entry.isEffect ? '效应结算' : '谐度结算'}：伤害类型由结算方式决定</span
                                    >
                                    {#if inferred.length > 0}
                                        <span class="text-[11px] text-(--theme-modal-text)/60"
                                            >{shortTypes(inferred)}</span
                                        >
                                    {/if}
                                {/if}
                            </div>

                            <!-- 第三列：同步到所有同名伤害 -->
                            <div class="flex w-24 shrink-0 justify-center">
                                {#if editable}
                                    <button
                                        onclick={() => syncToSameName(entry)}
                                        disabled={locked || sameNameCount <= 1}
                                        class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-30"
                                        style="border-color: var(--theme-divider-border); color: var(--theme-modal-text)/70;"
                                        title={sameNameCount > 1
                                            ? `把当前伤害类型同步到 ${sameNameCount} 条同名伤害（同一角色 + 同一技能类型）`
                                            : '没有其它同名伤害'}
                                    >
                                        <Icon icon="mdi:sync" class="size-3.5 shrink-0" />
                                        同名{sameNameCount > 1 ? `×${sameNameCount}` : ''}
                                    </button>
                                {:else}
                                    <span class="text-[10px] text-(--theme-modal-text)/25">—</span>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
            {/each}

            {#if damageEntries.length === 0}
                <div class="flex h-40 flex-col items-center justify-center gap-2 text-sm text-(--theme-muted-text)">
                    <Icon icon="mdi:table-question" class="size-9" />
                    当前时间线还没有伤害倍率：先在排轴页放置伤害块
                </div>
            {/if}
        </div>

        <div
            class="shrink-0 border-t pt-2 text-[11px] text-(--theme-modal-text)/45"
            style="border-color: var(--theme-divider-border);"
        >
            共 {damageEntries.length} 条倍率（{editableCount} 条可编辑）。未手动设置的条目按技能文案自动推导；留空即回到自动推导。
        </div>
    </div>
</Modal>
