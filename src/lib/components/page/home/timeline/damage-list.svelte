<script lang="ts">
    import { getShowDamageList, setShowDamageList, getDamageList } from './timeline.store.svelte'
</script>

{#if getShowDamageList()}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm"
        onclick={(e) => {
            if ((e.target as HTMLElement) === e.currentTarget) setShowDamageList(false)
        }}
        onkeydown={(e) => e.key === 'Escape' && setShowDamageList(false)}
    >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="w-full max-h-[70vh] max-w-2xl rounded-lg border text-[var(--theme-modal-text)] shadow-xl overflow-hidden flex flex-col"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
        >
            <div
                class="flex items-center justify-between px-4 py-3 border-b"
                style="border-color: var(--theme-divider-border);"
            >
                <h2 class="text-sm font-semibold">伤害列表</h2>
                <span class="text-xs text-[var(--theme-modal-text)]/50">{getDamageList().length} 条</span>
            </div>
            <div class="flex-1 overflow-y-auto p-3">
                {#if getDamageList().length === 0}
                    <div class="flex items-center justify-center py-8 text-xs text-[var(--theme-modal-text)]/50">
                        暂无伤害数据
                    </div>
                {:else}
                    <table class="w-full text-xs">
                        <thead>
                            <tr
                                class="text-[var(--theme-modal-text)]/50 border-b"
                                style="border-color: var(--theme-divider-border);"
                            >
                                <th class="text-left font-medium py-1.5 pr-3">角色</th>
                                <th class="text-left font-medium py-1.5 pr-3">倍率名</th>
                                <th class="text-left font-medium py-1.5 pr-3">倍率基础</th>
                                <th class="text-left font-medium py-1.5 pr-3">属性</th>
                                <th class="text-left font-medium py-1.5">倍率值</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each getDamageList() as entry}
                                <tr class="border-b last:border-0" style="border-color: var(--theme-divider-border);">
                                    <td class="py-1.5 pr-3 text-[var(--theme-modal-text)]">{entry.character}</td>
                                    <td
                                        class="py-1.5 pr-3 text-[var(--theme-modal-text)] max-w-48 truncate"
                                        title={entry.name}>{entry.name}</td
                                    >
                                    <td class="py-1.5 pr-3 text-[var(--theme-modal-text)]/60">{entry.baseType}</td>
                                    <td class="py-1.5 pr-3" style="color: var(--theme-element-{entry.element}, #888)"
                                        >{entry.element || '物理'}</td
                                    >
                                    <td
                                        class="py-1.5 text-[var(--theme-modal-text)]/60 max-w-36 truncate"
                                        title={entry.value}>{entry.value}</td
                                    >
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                {/if}
            </div>
            <div
                class="flex items-center justify-end gap-2 border-t px-4 py-2.5"
                style="border-color: var(--theme-divider-border);"
            >
                <button
                    class="h-7 rounded-md px-3 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-[var(--theme-modal-text)]/[0.1]"
                    style="background: var(--theme-input-bg);"
                    onclick={() => setShowDamageList(false)}>关闭</button
                >
            </div>
        </div>
    </div>
{/if}
