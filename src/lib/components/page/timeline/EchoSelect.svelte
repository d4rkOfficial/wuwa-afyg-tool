<script lang="ts">
    import type { ComponentsProps } from '$lib/types/component-props'
    import {
        getShowEchoSelect,
        setShowEchoSelect,
        getEchoSelectCharIndex,
        setEchoSelectCharIndex,
        getSelectedCharNames,
        getSelectedCharEchos,
        getEchoIconMap,
        getEchoInfoMap,
        getEchoSetGroups,
        getEchoSetIconMap,
        getEchoList,
        getEchoLoading,
        getEchoSelectedSet,
        setEchoSelectedSet,
        imgUrl
    } from '$lib/timeline/store.svelte'
    import { hideImg } from '$lib/timeline/utils'

    interface Props extends ComponentsProps {}
    let { class: _class = '', style = '' }: Props = $props()
</script>

{#if getShowEchoSelect()}
    <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" role="dialog">
        <div class="mx-4 flex w-full max-w-lg flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div class="flex items-center justify-between shrink-0 px-5 py-3 border-b border-zinc-800/50">
                <h2 class="text-sm font-semibold text-zinc-100">配置声骸技能</h2>
            </div>
            <div class="p-4 space-y-4">
                {#if getEchoLoading()}
                    <div class="flex items-center justify-center py-8 text-xs text-zinc-500">加载声骸数据...</div>
                {:else}
                    {#each getSelectedCharNames() as name, i}
                        <div class="flex items-center gap-3">
                            <div
                                class="size-9 shrink-0 rounded-md bg-zinc-800/40 flex items-center justify-center overflow-hidden"
                            >
                                {#if imgUrl(name)}
                                    <img src={imgUrl(name)} alt={name} class="size-full object-contain" />
                                {:else}
                                    <span class="text-[10px] font-medium text-zinc-400">{name[0]}</span>
                                {/if}
                            </div>
                            <span class="text-xs font-medium text-zinc-200 min-w-0 shrink-0">{name}</span>
                            <div class="flex-1 flex justify-end">
                                {#if getSelectedCharEchos()[i]}
                                    {@const echo = getSelectedCharEchos()[i]!}
                                    {@const info = getEchoInfoMap()[echo]}
                                    <div
                                        class="flex items-center gap-2 bg-zinc-800/60 rounded-md px-2.5 py-1.5 border border-zinc-700/50 cursor-pointer hover:bg-zinc-800 transition-colors"
                                        onclick={() => {
                                            setEchoSelectCharIndex(i)
                                            setEchoSelectedSet(getEchoSetGroups()[0]?.label ?? null)
                                        }}
                                        role="button"
                                        tabindex="0"
                                        onkeydown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault()
                                                setEchoSelectCharIndex(i)
                                                setEchoSelectedSet(getEchoSetGroups()[0]?.label ?? null)
                                            }
                                        }}
                                    >
                                        {#if getEchoIconMap()[echo]}
                                            <img
                                                src={getEchoIconMap()[echo]}
                                                alt={echo}
                                                class="size-6 rounded object-contain"
                                            />
                                        {/if}
                                        <div class="text-[10px] leading-tight">
                                            <div class="text-zinc-200 font-medium">{echo}</div>
                                            <div class="text-zinc-500">
                                                COST {info?.cost ?? '?'}
                                                {info?.sets[0] ?? ''}
                                            </div>
                                        </div>
                                        <button
                                            aria-label="删除声骸"
                                            class="size-5 flex items-center justify-center rounded hover:bg-zinc-700 transition-colors shrink-0 text-zinc-500 hover:text-zinc-300"
                                            onclick={(e) => {
                                                e.stopPropagation() /* handled inline below */
                                            }}
                                        >
                                            <svg
                                                viewBox="0 0 16 16"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="1.5"
                                                class="size-3.5"><path d="M4 4l8 8M12 4l-8 8" /></svg
                                            >
                                        </button>
                                    </div>
                                {:else}
                                    <button
                                        class="text-[11px] text-zinc-500 bg-zinc-800/40 hover:bg-zinc-800 rounded-md px-3 py-1.5 transition-colors border border-dashed border-zinc-700/50"
                                        onclick={() => {
                                            setEchoSelectCharIndex(i)
                                            setEchoSelectedSet(getEchoSetGroups()[0]?.label ?? null)
                                        }}>选择声骸</button
                                    >
                                {/if}
                            </div>
                        </div>
                    {/each}
                {/if}
            </div>
            <div class="flex items-center justify-end gap-2 shrink-0 border-t border-zinc-800/50 px-5 py-3">
                <button
                    class="rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
                    onclick={() => {
                        setShowEchoSelect(false)
                    }}>确认</button
                >
            </div>
        </div>
    </div>
{/if}

{#if getEchoSelectCharIndex() !== null}
    {@const eci = getEchoSelectCharIndex()!}
    <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" role="dialog" tabindex="-1">
        <div
            class="mx-4 flex w-full max-w-lg flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
            style="max-height: 65vh;"
        >
            <div class="flex items-center justify-between shrink-0 px-4 py-2.5 border-b border-zinc-800/50">
                <h2 class="text-sm font-semibold text-zinc-100">为 {getSelectedCharNames()[eci]} 选择声骸</h2>
            </div>
            <div class="flex flex-1 overflow-hidden">
                <nav
                    class="shrink-0 w-28 border-r border-zinc-800/50 bg-zinc-950/60 overflow-y-auto flex flex-col gap-0.5 py-3 pl-2 pr-1.5"
                >
                    {#each getEchoSetGroups() as group}
                        <button
                            onclick={() => {
                                setEchoSelectedSet(group.label)
                            }}
                            class="h-7 rounded-lg flex items-center gap-1.5 px-2 hover:bg-zinc-800/60 transition-colors shrink-0 text-left {getEchoSelectedSet() ===
                            group.label
                                ? 'bg-zinc-800/60'
                                : ''}"
                            title={group.label}
                        >
                            {#if group.icon}
                                <img src={group.icon} alt="" class="size-4 object-contain shrink-0" onerror={hideImg} />
                            {/if}
                            <span class="text-[10px] leading-none text-zinc-400 truncate">{group.label}</span>
                        </button>
                    {/each}
                </nav>
                <div class="flex-1 overflow-y-auto p-3">
                    {#each getEchoSetGroups().filter((g) => g.label === getEchoSelectedSet()) as group}
                        <div class="grid grid-cols-2 gap-2">
                            {#each group.items as echo (echo.name)}
                                <button
                                    class="rounded-lg overflow-hidden flex items-center gap-2 p-2.5 cursor-pointer text-left transition-all hover:-translate-y-0.5 bg-zinc-800/20 hover:bg-zinc-800/40"
                                    onclick={() => {
                                        const echoes = getSelectedCharEchos()
                                        echoes[eci] = echo.name
                                        setEchoSelectCharIndex(null)
                                    }}
                                >
                                    <div
                                        class="size-9 shrink-0 rounded-md bg-zinc-800/40 flex items-center justify-center overflow-hidden"
                                    >
                                        {#if getEchoIconMap()[echo.name]}
                                            <img
                                                src={getEchoIconMap()[echo.name]}
                                                alt={echo.name}
                                                class="size-full object-contain"
                                            />
                                        {/if}
                                    </div>
                                    <div class="min-w-0">
                                        <div class="text-[11px] font-semibold text-zinc-200 truncate">{echo.name}</div>
                                        <div class="text-[9px] text-zinc-500">COST {echo.cost}</div>
                                    </div>
                                </button>
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>
            <div class="flex items-center justify-end gap-2 shrink-0 border-t border-zinc-800/50 px-5 py-3">
                <button
                    class="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                    onclick={() => {
                        const echoes = getSelectedCharEchos()
                        echoes[eci] = null
                        setEchoSelectCharIndex(null)
                    }}>不选择</button
                >
                <button
                    class="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                    onclick={() => {
                        setEchoSelectCharIndex(null)
                    }}>取消</button
                >
            </div>
        </div>
    </div>
{/if}
