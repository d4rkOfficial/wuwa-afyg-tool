<script lang="ts">
    import type { ComponentsProps } from '$lib/types/component-props'
    import {
        getSkillPickerBlockId,
        setSkillPickerBlockId,
        getSkillPickerLoading,
        getSkillPickerCharacter,
        getSkillPickerGroups,
        getSkillPickerSelected,
        setSkillPickerSelected,
        getSkillPickerOrder,
        getSkillPickerIsRef,
        setSkillPickerIsRef,
        getRefSkillPickerCache,
        getSkillPickerHitHits,
        setSkillPickerHitHits,
        getSelectedCharNames,
        echoNameForChar,
        imgUrl,
        applySkillHits,
        switchRefSkillPickerTab
    } from '$lib/timeline/store.svelte'

    interface Props extends ComponentsProps {}
    let { class: _class = '', style = '' }: Props = $props()
</script>

{#if getSkillPickerBlockId() !== null}
    <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
        role="button"
        tabindex="-1"
        onclick={(e) => {
            if ((e.target as HTMLElement) === e.currentTarget) {
                setSkillPickerBlockId(null)
                setSkillPickerIsRef(false)
            }
        }}
        onkeydown={(e) => {
            if (e.key === 'Escape') {
                setSkillPickerBlockId(null)
                setSkillPickerIsRef(false)
            }
        }}
    >
        <div
            class="w-full max-h-[70vh] max-w-xl rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl overflow-hidden flex flex-col"
            role="button"
            tabindex="-1"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
        >
            <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                <h2 class="text-sm font-semibold text-zinc-200">配置直伤倍率</h2>
                {#if getSkillPickerIsRef()}
                    <div class="flex items-center gap-1.5">
                        {#each getSelectedCharNames() as name}
                            <button
                                class="size-7 rounded-full overflow-hidden {getSkillPickerCharacter() === name
                                    ? 'ring-2 ring-blue-500'
                                    : 'ring-1 ring-zinc-600'}"
                                onclick={() => switchRefSkillPickerTab(name)}
                            >
                                {#if imgUrl(name)}
                                    <img src={imgUrl(name)} alt={name} class="size-full object-contain" />
                                {:else}
                                    <span class="text-[10px] font-medium text-zinc-400">{name[0]}</span>
                                {/if}
                            </button>
                        {/each}
                    </div>
                {:else}
                    <span class="text-xs text-zinc-500">{getSkillPickerCharacter()}</span>
                {/if}
            </div>
            <div class="flex-1 overflow-y-auto p-2">
                {#if getSkillPickerLoading()}
                    <div class="flex items-center justify-center py-8">
                        <span class="text-xs text-zinc-500">加载中…</span>
                    </div>
                {:else if getSkillPickerGroups().length === 0}
                    <div class="flex items-center justify-center py-8">
                        <span class="text-xs text-zinc-500">无可用倍率数据</span>
                    </div>
                {:else}
                    <div class="space-y-1">
                        {#each getSkillPickerGroups() as group}
                            <div
                                class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider px-2 pt-2 pb-1"
                            >
                                {group.type} ({group.hits.length})
                            </div>
                            {#each group.hits as hit}
                                {@const key = getSkillPickerCharacter() + '|' + group.type + '|' + hit.name}
                                {@const order = getSkillPickerSelected().has(key)
                                    ? getSkillPickerOrder().indexOf(key) + 1
                                    : 0}
                                <button
                                    class="w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-left hover:bg-zinc-800 transition-colors {getSkillPickerSelected().has(
                                        key
                                    )
                                        ? 'bg-zinc-800/80 text-zinc-200'
                                        : 'text-zinc-400'}"
                                    onclick={() => {
                                        const next = new Set(getSkillPickerSelected())
                                        if (next.has(key)) next.delete(key)
                                        else next.add(key)
                                        setSkillPickerSelected(next)
                                    }}
                                >
                                    <div
                                        class="size-5 shrink-0 rounded-full flex items-center justify-center {order > 0
                                            ? 'bg-blue-500 text-white'
                                            : 'border border-zinc-600'}"
                                    >
                                        {#if order > 0}
                                            <span class="text-[10px] font-bold">{order}</span>
                                        {/if}
                                    </div>
                                    <span class="flex-1 truncate">{hit.name}</span>
                                    <span class="text-zinc-500"
                                        >{hit.ratio}{#if hit.element}
                                            <span class="text-zinc-600"> {hit.element}</span>{/if}</span
                                    >
                                    {#if group.type === '声骸技能' && getSkillPickerSelected().has(key)}
                                        <span
                                            class="flex items-center gap-1 ml-2"
                                            onclick={(e) => e.stopPropagation()}
                                            role="presentation"
                                        >
                                            <span class="text-[9px] text-zinc-500">段</span>
                                            <input
                                                type="number"
                                                min="0"
                                                max="20"
                                                value={getSkillPickerHitHits()[key] ?? 1}
                                                oninput={(e) => {
                                                    const v = parseInt((e.target as HTMLInputElement).value)
                                                    setSkillPickerHitHits({
                                                        ...getSkillPickerHitHits(),
                                                        [key]: Math.min(20, Math.max(0, isNaN(v) ? 1 : v))
                                                    })
                                                }}
                                                class="w-10 h-6 bg-zinc-700 text-xs text-zinc-200 text-center rounded outline-none border border-zinc-600 tabular-nums"
                                            />
                                        </span>
                                    {/if}
                                </button>
                            {/each}
                        {/each}
                    </div>
                {/if}
            </div>
            <div class="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-2.5">
                <button
                    class="h-7 rounded-md bg-zinc-800 px-3 text-xs text-zinc-400 transition-colors hover:bg-zinc-700"
                    onclick={() => {
                        setSkillPickerBlockId(null)
                        setSkillPickerIsRef(false)
                    }}>取消</button
                >
                <button
                    class="h-7 rounded-md bg-blue-600 px-3 text-xs text-white transition-colors hover:bg-blue-500"
                    onclick={applySkillHits}>确认</button
                >
            </div>
        </div>
    </div>
{/if}
