<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import { fade } from 'svelte/transition'
    import { popOut } from '$lib/utils/motion'
    import { getShareBase } from '$lib/data/workshop.svelte'
    import { getToyProfile } from '$lib/bilibili-toy/profile.svelte'
    import { buildWorkshopFrameSrc } from '$lib/bilibili-toy/identity'
    import { setMagneticForcedOff } from '$lib/data/render-prefs.svelte'

    interface Props extends ComponentsProps {
        open: boolean
        onclose: () => void
        /** 工坊内路径（如 /share/xxx），留空则打开工坊首页 */
        path?: string
    }
    let { open, onclose, path, class: className, style: styleProp }: Props = $props()

    let workshopFrameKey = $state(0)

    /** @desc 工坊 iframe 地址：base + 目标路径（详情页等）+ #toy 身份 hash */
    let workshopFrameSrc = $derived(buildWorkshopFrameSrc(`${getShareBase()}${path ?? ''}`, getToyProfile().data))

    // 工坊 iframe 弹窗打开时强制恢复系统光标（磁力光标瞬时抑制）
    $effect(() => {
        setMagneticForcedOff(open)
    })
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm {className}"
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5)); {styleProp || ''}"
        onclick={(e) => {
            if (e.target === e.currentTarget) onclose()
        }}
        onkeydown={(e) => {
            if (e.key === 'Escape') onclose()
        }}
        out:fade={{ duration: 130 }}
    >
        <div
            class="animate-pop-in flex h-[90vh] w-[min(94vw,1100px)] flex-col overflow-hidden rounded-xl border shadow-2xl"
            style="background: var(--theme-modal-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
            role="dialog"
            aria-modal="true"
            out:popOut
        >
            <div class="flex min-h-0 flex-1">
                <!-- Left toolbar -->
                <div
                    class="flex w-12 shrink-0 flex-col items-center gap-1 border-r py-3"
                    style="border-color: var(--theme-divider-border);"
                >
                    <button
                        onclick={() => workshopFrameKey++}
                        class="rounded p-2 text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/10 hover:text-(--theme-modal-text)"
                        title="刷新"
                    >
                        <Icon icon="mdi:refresh" class="size-4.5" />
                    </button>
                    <a
                        href={`${getShareBase()}${path ?? ''}`}
                        target="_blank"
                        rel="noreferrer"
                        class="rounded p-2 text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/10 hover:text-(--theme-modal-text)"
                        title="在新标签页打开"
                    >
                        <Icon icon="mdi:open-in-new" class="size-4.5" />
                    </a>
                    <button
                        onclick={onclose}
                        class="rounded p-2 text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/10 hover:text-red-500"
                        title="关闭"
                    >
                        <Icon icon="mdi:close" class="size-4.5" />
                    </button>
                </div>
                {#key workshopFrameKey}
                    <iframe src={workshopFrameSrc} title="椰果工坊" class="min-h-0 w-full flex-1 border-0"></iframe>
                {/key}
            </div>
        </div>
    </div>
{/if}
