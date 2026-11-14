<script lang="ts">
    /**
     * @desc 排轴页按键图标编辑（独立弹窗）：入口在「设置 → 交互相关 → 界面显示 → 排轴页按键图标」的「编辑」按钮。
     * 列表与「选择按键与手柄键位」弹窗放在同一个组件里：后者是前者的次级弹窗，
     * 共享 `keyPickerFor` 与图标表，不占用设置外壳的状态。
     */
    import Icon from '@iconify/svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import { getUiBtnIcons } from '$lib/api/data-cache'
    import { GAMEPAD_BUTTONS } from '$lib/calc/timeline.consts'
    import {
        getKeyMapEntries,
        physicalLabel,
        resetKeyMap,
        updateKeyMapEntry,
        type KeyMapEntry
    } from '$lib/data/keymap.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import { ACTION_BTN, ACTION_BTN_ACCENT } from './utils'

    interface Props extends ComponentsProps {
        open: boolean
        onclose: () => void
    }

    let { open, onclose, class: className, style: styleProp }: Props = $props()

    const keymapEntries = $derived(getKeyMapEntries())

    /** @desc 界面按键图标表（`blockKey` → 图标 URL），只在首次打开时拉取一次 */
    let uiBtnIconList = $state<[string, string][]>([])
    let iconsRequested = false
    $effect(() => {
        if (!open || iconsRequested) return
        iconsRequested = true
        void getUiBtnIcons().then((map) => {
            uiBtnIconList = Object.entries(map)
        })
    })

    /** @desc 正在选择图标的条目 id（null = 次级弹窗关闭） */
    let keyPickerFor = $state<string | null>(null)

    const iconOf = (blockKey: string): string | undefined => uiBtnIconList.find(([name]) => name === blockKey)?.[1]
    const gamepadIconOf = (blockKey: string): string | undefined =>
        GAMEPAD_BUTTONS.find((b) => b.id === blockKey)?.icon ?? undefined
    const entryById = (id: string): KeyMapEntry | undefined => keymapEntries.find((e) => e.id === id)

    const updateEntry = (id: string, patch: Partial<KeyMapEntry>) => {
        const entry = entryById(id)
        if (entry) void updateKeyMapEntry({ ...entry, ...patch })
    }

    const closePicker = () => {
        keyPickerFor = null
    }

    /** @desc 关闭编辑弹窗时一并收起次级弹窗，避免下次打开残留 */
    const closeAll = () => {
        closePicker()
        onclose()
    }

    /** @desc 由外部（如 AI 的 open_panel）直接关掉编辑弹窗时，也把次级弹窗收起来 */
    $effect(() => {
        if (!open) keyPickerFor = null
    })
</script>

<Modal
    {open}
    onclose={closeAll}
    layer="nested"
    noScroll
    flush
    class={mergeClass(['h-[min(82vh,660px)] w-[min(94vw,700px)]', className])}
    style={styleProp}
>
    {#snippet title()}
        <Icon icon="mdi:keyboard-outline" class="size-4.5" style="color: var(--theme-accent-text);" />
        <span>排轴页按键图标</span>
        <span class="shrink-0 text-[10px] font-normal text-(--theme-modal-text)/40">
            {keymapEntries.length} 个操作
        </span>
    {/snippet}

    <div class="theme-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <p class="mb-3 text-[10px] leading-4 text-(--theme-modal-text)/40">
            设置排轴时操作块显示的按键图标（键盘或手柄）；文字按 Enter 或失焦即保存。
        </p>
        <div class="flex flex-col gap-1.5">
            {#each keymapEntries as entry (entry.id)}
                <div
                    class="sf-radius flex items-center gap-2.5 rounded-none border px-2.5 py-2"
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
                        class="min-w-0 flex-1 bg-transparent text-xs text-(--theme-modal-text) outline-none placeholder:text-(--theme-modal-text)/30 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-(--theme-accent-bg)"
                        placeholder="显示名称"
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
                        keepDisabled
                        onclick={() => (keyPickerFor = entry.id)}
                        backgroundImage="var(--theme-accent-bg)"
                        textColor="var(--theme-accent-text-on-bg)"
                        class={ACTION_BTN_ACCENT}
                    >
                        选择图标
                    </Button>
                </div>
            {/each}
        </div>
    </div>

    {#snippet footer()}
        <div
            class="flex items-center justify-between gap-2 border-t px-6 py-3"
            style="border-color: var(--theme-divider-border);"
        >
            <Button variant="icon-text" size="none" bare onclick={() => resetKeyMap()} class={ACTION_BTN}>
                <Icon icon="mdi:restore" class="size-3.5" />
                恢复默认
            </Button>
            <Button variant="text" size="none" bare keepDisabled onclick={closeAll} class={ACTION_BTN}>完成</Button>
        </div>
    {/snippet}
</Modal>

<!-- 次级弹窗：选择按键与手柄键位（必须与编辑弹窗同级，不能放进它内部） -->
<Modal open={keyPickerFor !== null} onclose={closePicker} layer="deep" class="w-[min(92vw,32rem)]">
    {#snippet title()}
        <span>选择按键与手柄键位</span>
    {/snippet}
    {#if keyPickerFor}
        <div class="mb-2 flex items-center gap-2 text-[10px] font-medium text-(--theme-modal-text)/60">
            <Icon icon="mdi:keyboard-outline" class="size-3.5" />
            键盘
        </div>
        <div class="flex flex-wrap gap-1.5">
            {#each uiBtnIconList as [name, url] (name)}
                <button
                    onclick={() => {
                        updateEntry(keyPickerFor!, { blockKey: name })
                        closePicker()
                    }}
                    class="flex size-10 items-center justify-center rounded-none border transition-colors {entryById(
                        keyPickerFor
                    )?.blockKey === name
                        ? 'border-(--theme-accent-bg)'
                        : 'hover:bg-(--theme-modal-text)/10'}"
                    style="border-color: {entryById(keyPickerFor)?.blockKey === name
                        ? 'var(--theme-accent-bg)'
                        : 'var(--theme-divider-border)'};"
                    title={name}
                >
                    <img src={url} alt={name} draggable="false" class="size-6 object-contain pointer-events-none" />
                </button>
            {/each}
        </div>
        <div class="my-3 border-t" style="border-color: var(--theme-divider-border);"></div>
        <div class="mb-2 flex items-center gap-2 text-[10px] font-medium text-(--theme-modal-text)/60">
            <Icon icon="mdi:gamepad-variant-outline" class="size-3.5" />
            手柄图标
        </div>
        <div class="flex flex-wrap gap-1.5">
            {#each GAMEPAD_BUTTONS as btn (btn.id)}
                <button
                    onclick={() => {
                        updateEntry(keyPickerFor!, { blockKey: btn.id })
                        closePicker()
                    }}
                    class="flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-none border px-2 transition-colors {entryById(
                        keyPickerFor
                    )?.blockKey === btn.id
                        ? 'border-(--theme-accent-bg)'
                        : 'hover:bg-(--theme-modal-text)/10'}"
                    style="border-color: {entryById(keyPickerFor)?.blockKey === btn.id
                        ? 'var(--theme-accent-bg)'
                        : 'var(--theme-divider-border)'};"
                    title={btn.label}
                >
                    {#if btn.icon}
                        <img
                            src={btn.icon}
                            alt={btn.label}
                            draggable="false"
                            class="size-5 object-contain pointer-events-none"
                        />
                    {:else}
                        <span class="text-[10px] font-bold text-(--theme-modal-text)/80">{btn.label}</span>
                    {/if}
                </button>
            {/each}
        </div>
    {/if}
</Modal>
