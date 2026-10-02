<script lang="ts">
    /**
     * @desc 设置 → 按键图标（Phase 5.1 第二增量：自 `settings-modal.svelte` 原样抽出，标记与行为未改）。
     * 条目数据来自全局 store `$lib/data/keymap.svelte`（`keymapEntries` 只是它的 $derived 视图）；
     * 跨组件共用的选中态与条目读写（`keyPickerFor` / `uiBtnIconList` / `updateEntry`）以及栏目跳转
     * （`tab`）落在 `settings-ui.svelte.ts`，由外壳根部的「选择按键与手柄键位」弹窗与侧栏导航共用。
     */
    import Icon from '@iconify/svelte'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import { GAMEPAD_BUTTONS } from '$lib/calc/timeline.consts'
    import { getKeyMapEntries, physicalLabel, resetKeyMap } from '$lib/data/keymap.svelte'
    import { getUiBtnIconList, setKeyPickerFor, setTab, updateEntry } from '../settings-ui.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    const keymapEntries = $derived(getKeyMapEntries())
    const uiBtnIconList = $derived(getUiBtnIconList())

    const iconOf = (blockKey: string): string | undefined => uiBtnIconList.find(([n]) => n === blockKey)?.[1]

    const gamepadIconOf = (blockKey: string): string | undefined =>
        GAMEPAD_BUTTONS.find((b) => b.id === blockKey)?.icon ?? undefined
</script>

<!-- Key mapping -->
<div class={mergeClass([className])} style={styleProp}>
    <SectionTitle>
        <Icon icon="mdi:keyboard-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        按键图标
    </SectionTitle>
    <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
        每行决定排轴时操作块显示的按键图标（键盘或手柄）；快速排轴输入键与界面快捷键可在「交互相关」中配置
    </p>
    <div class="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-4">
        {#each keymapEntries as entry (entry.id)}
            <div
                class="flex items-center gap-2 rounded-none border px-2.5 py-2"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                <span class="flex size-9 shrink-0 items-center justify-center">
                    {#if iconOf(entry.blockKey)}
                        <img
                            src={iconOf(entry.blockKey)}
                            alt={entry.blockKey}
                            draggable="false"
                            class="size-8 object-contain"
                        />
                    {:else}
                        {@const gIcon = gamepadIconOf(entry.blockKey)}
                        {#if gIcon}
                            <img src={gIcon} alt={entry.blockKey} draggable="false" class="size-7 object-contain" />
                        {:else}
                            <span class="text-[10px] font-bold text-(--theme-modal-text)/60">{entry.blockKey}</span>
                        {/if}
                    {/if}
                </span>
                <input
                    value={entry.label}
                    onchange={(e) => updateEntry(entry.id, { label: (e.target as HTMLInputElement).value })}
                    class="min-w-0 flex-1 bg-transparent text-xs text-(--theme-modal-text) outline-none placeholder:text-(--theme-modal-text)/30"
                />
                <span
                    class="shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] text-(--theme-modal-text)/60"
                    style="border-color: var(--theme-divider-border);"
                    title="快捷键"
                >
                    {physicalLabel(entry.physical)}
                </span>
                <button
                    onclick={() => setKeyPickerFor(entry.id)}
                    class="shrink-0 rounded-none px-2 py-0.5 text-[10px] font-medium transition-all hover:brightness-125"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                >
                    选择自定义key
                </button>
            </div>
        {/each}
    </div>
    <div class="mt-3 flex items-center gap-2">
        <button
            onclick={() => setTab('shortcuts')}
            class="flex items-center gap-1 rounded-none border px-2.5 py-1 text-xs text-(--theme-accent-text) transition-colors hover:brightness-125"
            style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent);"
            title="跳转到「快捷键位」页配置界面快捷键"
        >
            <Icon icon="mdi:keyboard-settings-outline" class="size-3.5" />
            界面快捷键设置
            <Icon icon="mdi:arrow-right" class="size-3" />
        </button>
        <button
            onclick={() => resetKeyMap()}
            class="flex items-center gap-1 rounded-none border px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
            style="border-color: var(--theme-divider-border);"
        >
            <Icon icon="mdi:restore" class="size-3.5" />
            恢复默认
        </button>
    </div>
</div>
