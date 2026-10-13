<script lang="ts">
    /**
     * @desc 设置 → 快捷键位（Phase 5.1 第二增量：自 `settings-modal.svelte` 原样抽出，标记与行为未改）。
     * 快捷键数据来自全局 store `$lib/data/shortcuts.svelte`；待录制 id `shortcutCapture` 托管在
     * `settings-ui.svelte.ts`，因为按下新键的捕获监听（含 Esc 取消）留在外壳的 window keydown 中。
     */
    import Icon from '@iconify/svelte'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import SettingRow from '$lib/components/ui/setting-row.svelte'
    import Button from '$lib/components/ui/button.svelte'
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
    import { ACTION_BTN } from '../utils'

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
            点「记录」后按下新键即可绑定，ESC 取消；与已有快捷键冲突时会被拒绝。部分全局快捷键不可修改
        </p>
        {#each SHORTCUT_GROUPS as g (g.key)}
            <div class="mt-3">
                <span class="text-[11px] font-medium text-(--theme-modal-text)/45">{g.label}</span>
                <div class="mt-1 grid grid-cols-1 gap-1.5 xl:grid-cols-2 xl:gap-x-4">
                    {#each getShortcuts().filter((s) => s.group === g.key) as s (s.id)}
                        <SettingRow>
                            <div class="min-w-0 flex-1">
                                <span class="block text-xs text-(--theme-modal-text)">{s.label}</span>
                                <span
                                    class="block truncate text-[10px] leading-4 text-(--theme-modal-text)/40"
                                    title={s.desc}>{s.desc}</span
                                >
                            </div>
                            <span
                                class="sf-radius shrink-0 rounded-none border px-1.5 py-0.5 font-mono text-[10px] text-(--theme-modal-text)/70"
                                style="border-color: var(--theme-divider-border);"
                                >{shortcutLabel(getShortcutKey(s.id))}</span
                            >
                            <Button
                                variant="text"
                                size="none"
                                bare
                                onclick={() => setShortcutCapture(shortcutCapture === s.id ? null : s.id)}
                                backgroundImage={shortcutCapture === s.id
                                    ? 'var(--theme-accent-bg)'
                                    : 'color-mix(in srgb, var(--theme-modal-text) 8%, transparent)'}
                                textColor={shortcutCapture === s.id
                                    ? 'var(--theme-accent-text-on-bg)'
                                    : 'color-mix(in srgb, var(--theme-modal-text) 70%, transparent)'}
                                class={ACTION_BTN}
                                >{shortcutCapture === s.id
                                    ? s.lockedMods?.length
                                        ? `按下新键…（${s.lockedMods.map(shortcutLabel).join('+')} 固定）`
                                        : '按下新键…'
                                    : '记录'}</Button
                            >
                        </SettingRow>
                    {/each}
                </div>
            </div>
        {/each}
        <div class="mt-3 flex items-center gap-2">
            <Button variant="icon-text" size="none" bare onclick={() => resetShortcuts()} class={ACTION_BTN}>
                <Icon icon="mdi:restore" class="size-3.5" />
                恢复默认
            </Button>
        </div>
    </div>
</div>
