<script lang="ts">
    /** @desc 速查弹窗：遮罩 + 居中卡片，ESC 关闭（stopPropagation 不冒泡关上层），内容复用 QuickLookupContent */
    import type { CharSlot } from '$lib/types/project'
    import Icon from '@iconify/svelte'
    import { focusTrap } from '$lib/utils/focus-trap'
    import type { ComponentsProps } from '$lib/types'
    import QuickLookupContent from '$lib/components/layout/quick-lookup-content.svelte'

    interface Props extends ComponentsProps {
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        onCreateBuff?: (name: string) => void
        onCreateCustomHit?: (name: string) => void
        showBuffOption?: boolean
        showCustomHitOption?: boolean
        onclose: () => void
    }

    let {
        open,
        team,
        onCreateBuff,
        onCreateCustomHit,
        showBuffOption = true,
        showCustomHitOption = true,
        onclose,
        class: className,
        style: styleProp
    }: Props = $props()
</script>

<!-- @desc 速查弹窗根容器：遮罩 + 居中卡片，ESC 关闭（stopPropagation 不冒泡关上层） -->
{#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5)); {styleProp || ''}"
        class="animate-fade-in fixed inset-0 z-70 flex items-center justify-center select-text backdrop-blur-sm {className}"
        onkeydown={(e) => {
            if (e.key === 'Escape') {
                onclose()
                // 只关闭当前层，不继续冒泡关闭上层弹窗
                e.stopPropagation()
            }
        }}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            use:focusTrap
            tabindex="-1"
            class="animate-pop-in mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border text-(--theme-modal-text) shadow-2xl"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <!-- @desc 标题栏：标题 + 关闭按钮 -->
            <div
                class="flex shrink-0 items-center justify-between border-b px-5 py-3"
                style="background: color-mix(in srgb, var(--theme-modal-bg) 92%, transparent) !important; backdrop-filter: blur(12px) !important; -webkit-backdrop-filter: blur(12px) !important; border-color: var(--theme-divider-border);"
            >
                <h2 class="text-base font-semibold">速查</h2>
                <button
                    onclick={onclose}
                    class="flex size-7 items-center justify-center rounded-md text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/10 hover:text-(--theme-modal-text)"
                    ><Icon icon="mdi:close" class="size-4" /></button
                >
            </div>
            <!-- @desc 内容区（角色 tab + 滚动详情），主体与侧边栏速查共用 -->
            <div class="flex min-h-0 flex-1 flex-col">
                <QuickLookupContent
                    {team}
                    {onCreateBuff}
                    {onCreateCustomHit}
                    {showBuffOption}
                    {showCustomHitOption}
                    {onclose}
                />
            </div>
        </div>
    </div>
{/if}
