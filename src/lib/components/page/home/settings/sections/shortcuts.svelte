<script lang="ts">
    /**
     * @desc 设置 → 快捷键位（Phase 5.1 第二增量：自 `settings-modal.svelte` 原样抽出，标记与行为未改）。
     * 快捷键数据来自全局 store `$lib/data/shortcuts.svelte`；待录制 id `shortcutCapture` 托管在
     * `settings-ui.svelte.ts`，因为按下新键的捕获监听（含 Esc 取消）留在外壳的 window keydown 中。
     */
    import Icon from '@iconify/svelte'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import {
        SHORTCUT_GROUPS,
        getShortcutKey,
        getShortcuts,
        resetShortcuts,
        shortcutLabel
    } from '$lib/data/shortcuts.svelte'
    import { getShortcutCapture, setShortcutCapture } from '../settings-ui.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    const shortcutCapture = $derived(getShortcutCapture())
</script>

<div class={mergeClass(['flex flex-col', className])} style={styleProp}>
    <div class="mt-5">
        <SectionTitle>
            <Icon
                icon="mdi:keyboard-settings-outline"
                class="size-4 shrink-0"
                style="color: var(--theme-accent-text);"
            />
            界面快捷键
        </SectionTitle>
        <p class="mb-3 text-[10px] leading-4 text-(--theme-modal-text)/40">
            点击「记录」后按下新键即时绑定（ESC 取消）；同组冲突会被拒绝。弹窗关闭与 Ctrl+A/Z/Y 等固定不可改
        </p>
        {#each SHORTCUT_GROUPS as g (g.key)}
            <div class="mt-3">
                <span class="text-[11px] font-medium text-(--theme-modal-text)/45">{g.label}</span>
                <div class="mt-1 grid grid-cols-1 gap-1.5 xl:grid-cols-2 xl:gap-x-4">
                    {#each getShortcuts().filter((s) => s.group === g.key) as s (s.id)}
                        <div
                            class="flex items-center gap-2 rounded-none border px-2.5 py-1.5"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <div class="min-w-0 flex-1">
                                <span class="block text-xs text-(--theme-modal-text)">{s.label}</span>
                                <span
                                    class="block truncate text-[10px] leading-4 text-(--theme-modal-text)/35"
                                    title={s.desc}>{s.desc}</span
                                >
                            </div>
                            <span
                                class="shrink-0 rounded-none border px-1.5 py-0.5 font-mono text-[10px] text-(--theme-modal-text)/70"
                                style="border-color: var(--theme-divider-border);"
                                >{shortcutLabel(getShortcutKey(s.id))}</span
                            >
                            <button
                                onclick={() => setShortcutCapture(shortcutCapture === s.id ? null : s.id)}
                                class="shrink-0 rounded-none px-2 py-0.5 text-[10px] font-medium transition-all"
                                style={shortcutCapture === s.id
                                    ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                    : 'background: var(--theme-modal-text)/8; color: var(--theme-modal-text)/70;'}
                                >{shortcutCapture === s.id
                                    ? s.lockedMods?.length
                                        ? `按下新键…（${s.lockedMods.map(shortcutLabel).join('+')} 固定）`
                                        : '按下新键…'
                                    : '记录'}</button
                            >
                        </div>
                    {/each}
                </div>
            </div>
        {/each}
        <div class="mt-3 flex items-center gap-2">
            <button
                onclick={() => resetShortcuts()}
                class="flex items-center gap-1 rounded-none border px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                style="border-color: var(--theme-divider-border);"
            >
                <Icon icon="mdi:restore" class="size-3.5" />
                恢复默认
            </button>
        </div>
    </div>
</div>
