<script lang="ts">
    /**
     * @desc 设置 → 按键图标（Phase 5.1 第二增量：自 `settings-modal.svelte` 原样抽出，标记与行为未改）。
     * 条目数据来自全局 store `$lib/data/keymap.svelte`（`keymapEntries` 只是它的 $derived 视图）；
     * 跨组件共用的选中态与条目读写（`keyPickerFor` / `uiBtnIconList` / `updateEntry`）以及栏目跳转
     * （`tab`）落在 `settings-ui.svelte.ts`，由外壳根部的「选择按键与手柄键位」弹窗与侧栏导航共用。
     */
    import Icon from '@iconify/svelte'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import SettingRow from '$lib/components/ui/setting-row.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import { GAMEPAD_BUTTONS } from '$lib/calc/timeline.consts'
    import { getKeyMapEntries, physicalLabel, resetKeyMap } from '$lib/data/keymap.svelte'
    import { getUiBtnIconList, setKeyPickerFor, setTab, updateEntry } from '../settings-ui.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import { ACTION_BTN, ACTION_BTN_ACCENT } from '../utils'

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
    <p class="mb-3 text-[10px] leading-4 text-(--theme-modal-text)/40">设置排轴时操作块显示的按键图标（键盘或手柄）</p>
    <div class="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-4">
        {#each keymapEntries as entry (entry.id)}
            <SettingRow>
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
                    class="min-w-0 flex-1 bg-transparent text-xs text-(--theme-modal-text) outline-none placeholder:text-(--theme-modal-text)/30 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-(--theme-accent-bg)"
                />
                <span
                    class="sf-radius shrink-0 rounded-none border px-1.5 py-0.5 font-mono text-[10px] text-(--theme-modal-text)/60"
                    style="border-color: var(--theme-divider-border);"
                    title="快捷键"
                >
                    {physicalLabel(entry.physical)}
                </span>
                <Button
                    variant="text"
                    size="none"
                    bare
                    onclick={() => setKeyPickerFor(entry.id)}
                    backgroundImage="var(--theme-accent-bg)"
                    textColor="var(--theme-accent-text-on-bg)"
                    class={ACTION_BTN_ACCENT}
                >
                    选择自定义 key
                </Button>
            </SettingRow>
        {/each}
    </div>
    <div class="mt-3 flex items-center gap-2">
        <Button
            variant="icon-text"
            size="none"
            bare
            onclick={() => setTab('shortcuts')}
            backgroundImage="color-mix(in srgb, var(--theme-accent-bg) 12%, transparent)"
            textColor="var(--theme-accent-text)"
            class={ACTION_BTN}
            title="跳转到「快捷键位」页配置界面快捷键"
        >
            <Icon icon="mdi:keyboard-settings-outline" class="size-3.5" />
            界面快捷键设置
            <Icon icon="mdi:arrow-right" class="size-3" />
        </Button>
        <Button variant="icon-text" size="none" bare onclick={() => resetKeyMap()} class={ACTION_BTN}>
            <Icon icon="mdi:restore" class="size-3.5" />
            恢复默认
        </Button>
    </div>
</div>
