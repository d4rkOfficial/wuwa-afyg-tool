<script lang="ts">
    import type { ComponentsProps } from '$lib/types/component-props'
    import {
        getShowDamageList,
        setShowDamageList,
        getDamageList
    } from '../../../../../routes/test/timeline/store.svelte'

    interface Props extends ComponentsProps {}
    let { class: _class = '', style = '' }: Props = $props()
</script>

{#if getShowDamageList()}
    <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
        role="button"
        tabindex="-1"
        onclick={(e) => {
            if ((e.target as HTMLElement) === e.currentTarget) setShowDamageList(false)
        }}
        onkeydown={(e) => e.key === 'Escape' && setShowDamageList(false)}
    >
        <div
            class="w-full max-h-[70vh] max-w-2xl rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl overflow-hidden flex flex-col"
            role="button"
            tabindex="-1"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
        >
            <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                <h2 class="text-sm font-semibold text-zinc-200">伤害列表</h2>
                <span class="text-xs text-zinc-500">{getDamageList().length} 条</span>
            </div>
            <div class="flex-1 overflow-y-auto p-3">
                {#if getDamageList().length === 0}
                    <div class="flex items-center justify-center py-8 text-xs text-zinc-500">暂无伤害数据</div>
                {:else}
                    <table class="w-full text-xs">
                        <thead>
                            <tr class="text-zinc-500 border-b border-zinc-800">
                                <th class="text-left font-medium py-1.5 pr-3">角色</th>
                                <th class="text-left font-medium py-1.5 pr-3">倍率名</th>
                                <th class="text-left font-medium py-1.5">倍率值</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each getDamageList() as entry}
                                <tr class="border-b border-zinc-800/50 last:border-0">
                                    <td class="py-1.5 pr-3 text-zinc-300">{entry.character}</td>
                                    <td class="py-1.5 pr-3 text-zinc-200">{entry.name}</td>
                                    <td class="py-1.5 text-zinc-400">{entry.value}</td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                {/if}
            </div>
            <div class="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-2.5">
                <button
                    class="h-7 rounded-md bg-zinc-800 px-3 text-xs text-zinc-400 transition-colors hover:bg-zinc-700"
                    onclick={() => setShowDamageList(false)}>关闭</button
                >
            </div>
        </div>
    </div>
{/if}
