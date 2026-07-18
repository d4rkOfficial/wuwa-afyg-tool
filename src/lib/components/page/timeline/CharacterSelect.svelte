<script lang="ts">
    import type { ComponentsProps } from '$lib/types/component-props'
    import {
        getShowCharSelect,
        setShowCharSelect,
        getPickCharacters,
        getCharIconMap,
        getElementIconMap,
        getUiBtnIcons,
        getSelection,
        getPickLoading,
        getPickSearch,
        setPickSearch,
        getCharElementMap,
        getElementGroups,
        imgUrl,
        elementColor,
        togglePick,
        isSelected,
        confirmPick,
        scrollTo
    } from '$lib/timeline/store.svelte'
    import { starColor, hideImg } from '$lib/timeline/utils'
    import { ELEMENT_COLORS } from '$lib/timeline/consts'

    interface Props extends ComponentsProps {
        class?: string
        style?: string
    }
    let { class: _class = '', style = '' }: Props = $props()
</script>

{#if getShowCharSelect()}
    <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" role="dialog">
        <div class="mx-4 flex w-full max-w-2xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div class="flex items-center justify-between shrink-0 px-5 py-3 border-b border-zinc-800/50">
                <div class="flex items-center gap-3">
                    <h2 class="text-sm font-semibold text-zinc-100">选择三个角色</h2>
                    <span class="text-[11px] text-zinc-500 tabular-nums">{getSelection().length}/3</span>
                </div>
                <div class="max-w-48 w-full relative">
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-500"
                    >
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                    </svg>
                    <input
                        value={getPickSearch()}
                        oninput={(e) => setPickSearch((e.target as HTMLInputElement).value)}
                        placeholder="搜索..."
                        class="h-7 w-full pl-8 pr-2.5 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-[11px] text-zinc-200 placeholder:text-zinc-600 outline-none transition-colors focus:border-blue-500/50"
                    />
                </div>
            </div>
            <div class="flex flex-1 overflow-hidden" style="max-height: 65vh;">
                <nav
                    class="shrink-0 w-28 border-r border-zinc-800/50 bg-zinc-950/60 overflow-y-auto flex flex-col gap-0.5 py-3 pl-2 pr-1.5"
                >
                    {#each getElementGroups() as group}
                        <button
                            onclick={() => scrollTo(group.label)}
                            data-sidebar={group.label}
                            class="h-7 rounded-lg flex items-center gap-1.5 px-2 hover:bg-zinc-800/60 transition-colors shrink-0 text-left"
                            title={group.label}
                        >
                            {#if group.icon}
                                <img src={group.icon} alt="" class="size-4 object-contain shrink-0" onerror={hideImg} />
                            {/if}
                            <span class="text-[10px] leading-none text-zinc-400 truncate">{group.label}</span>
                        </button>
                    {/each}
                </nav>
                <div class="flex-1 overflow-y-auto p-4">
                    {#if getPickLoading()}
                        <div class="flex items-center justify-center py-12 text-xs text-zinc-500">加载角色列表...</div>
                    {:else}
                        {#each getElementGroups() as group}
                            <section id="p-{group.label}" class="mb-6 last:mb-0">
                                <div
                                    class="flex items-center gap-2 text-[11px] font-semibold text-zinc-400 mb-2 pb-1.5"
                                >
                                    {#if group.icon}
                                        <img
                                            src={group.icon}
                                            alt=""
                                            class="size-3.5 rounded object-contain"
                                            onerror={hideImg}
                                        />
                                    {/if}
                                    {group.label}
                                    <span class="text-zinc-600 font-medium">{group.items.length}</span>
                                </div>
                                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {#each group.items as char (char.name)}
                                        {@const c = starColor(char.star)}
                                        <button
                                            class="rounded-lg overflow-hidden flex items-center gap-2 p-2.5 cursor-pointer text-left transition-all hover:-translate-y-0.5 {isSelected(
                                                char.name
                                            )
                                                ? 'ring-2 ring-blue-500 ring-inset bg-blue-500/5'
                                                : ''}"
                                            style="background-image: linear-gradient(135deg, transparent 30%, {c}15 100%);"
                                            onclick={() => togglePick(char.name)}
                                        >
                                            <div
                                                class="size-9 shrink-0 rounded-md bg-zinc-800/40 flex items-center justify-center overflow-hidden relative"
                                            >
                                                {#if imgUrl(char.name)}
                                                    <img
                                                        src={imgUrl(char.name)}
                                                        alt={char.name}
                                                        class="size-full object-contain"
                                                    />
                                                {/if}
                                                {#if isSelected(char.name)}
                                                    <div
                                                        class="absolute -top-1 -right-1 size-4 rounded-full bg-blue-500 text-[9px] text-white font-bold flex items-center justify-center"
                                                    >
                                                        {getSelection().indexOf(char.name) + 1}
                                                    </div>
                                                {/if}
                                            </div>
                                            <span class="text-[11px] font-semibold text-zinc-200 truncate min-w-0"
                                                >{char.name}</span
                                            >
                                        </button>
                                    {/each}
                                </div>
                            </section>
                        {/each}
                        {#if getElementGroups().length === 0}
                            <div class="flex flex-col items-center justify-center py-16 text-zinc-500">
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.5"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    class="size-8 mb-2 text-zinc-600"
                                >
                                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                                </svg>
                                <span class="text-xs font-medium">没有匹配的角色</span>
                            </div>
                        {/if}
                    {/if}
                </div>
            </div>
            <div class="flex items-center justify-end gap-2 shrink-0 border-t border-zinc-800/50 px-5 py-3">
                <span class="text-[11px] text-zinc-600 mr-auto">已选 {getSelection().length} / 3</span>
                <button
                    class="rounded-lg px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
                    onclick={confirmPick}
                >
                    确认
                </button>
            </div>
        </div>
    </div>
{/if}
