<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import { getActiveId, getOverrides } from '$lib/theme/theme.svelte'

    interface Props extends ComponentsProps {
        onWorkshopFrame: () => void
        onBuffLibrary: () => void
        onSettings: () => void
    }
    let { onWorkshopFrame, onBuffLibrary, onSettings, class: className, style: styleProp }: Props = $props()

    const isDark = $derived(getActiveId() !== 'light')
    const isMono = $derived(getOverrides().accentHue === 'mono')
</script>

<div class="flex flex-1 flex-col items-center justify-center gap-8 px-8 {className}" style={styleProp}>
    <div class="flex flex-col items-center text-center">
        <h2
            class="mb-2 text-5xl font-extrabold tracking-tight"
            style="color: {isMono ? 'var(--theme-accent-text)' : 'var(--theme-card-text)'}; -webkit-text-stroke: {isDark
                ? '2px #000'
                : '2px #fff'}; paint-order: stroke fill;"
        >
            鸣潮社区公益工具
        </h2>
        <p
            class="text-3xl font-extrabold tracking-tight"
            style="color: var(--theme-accent-text); -webkit-text-stroke: {isDark
                ? '2px #000'
                : '2px #fff'}; paint-order: stroke fill;"
        >
            让排轴、拉表、配装对比、伤害计算更简单！
        </p>
    </div>
    <div class="grid w-full max-w-5xl grid-cols-3 gap-4">
        <button
            onclick={onWorkshopFrame}
            class="card-pop-in group flex flex-col items-start gap-3 rounded-2xl border border-(--theme-card-border) bg-(--theme-card-bg) p-6 text-left theme-glass-surface shadow-[var(--theme-card-shadow)] transition-all hover:-translate-y-0.5 hover:bg-(--theme-card-bg-focused)"
            style="animation-delay: 55ms"
        >
            <Icon
                icon="mdi:storefront-outline"
                class="icon-pop size-9 text-(--theme-accent-text) drop-shadow-[0_0_3px_var(--theme-halo-color)]"
                style="animation-delay: 145ms"
            />
            <div class="flex flex-col gap-1">
                <span
                    class="text-lg font-semibold text-(--theme-card-text) [text-shadow:_0_0_3px_var(--theme-halo-color)]"
                    >工坊</span
                >
                <span class="text-[15px] text-(--theme-muted-text) [text-shadow:_0_0_2px_var(--theme-halo-color)]"
                    >前往工坊，分享你的轴表工程</span
                >
            </div>
        </button>
        <button
            onclick={onBuffLibrary}
            class="card-pop-in group flex flex-col items-start gap-3 rounded-2xl border border-(--theme-card-border) bg-(--theme-card-bg) p-6 text-left theme-glass-surface shadow-[var(--theme-card-shadow)] transition-all hover:-translate-y-0.5 hover:bg-(--theme-card-bg-focused)"
            style="animation-delay: 110ms"
        >
            <Icon
                icon="mdi:view-dashboard-outline"
                class="icon-pop size-9 text-(--theme-accent-text) drop-shadow-[0_0_3px_var(--theme-halo-color)]"
                style="animation-delay: 200ms"
            />
            <div class="flex flex-col gap-1">
                <span
                    class="text-lg font-semibold text-(--theme-card-text) [text-shadow:_0_0_3px_var(--theme-halo-color)]"
                    >Buff 集</span
                >
                <span class="text-[15px] text-(--theme-muted-text) [text-shadow:_0_0_2px_var(--theme-halo-color)]"
                    >配置 Buff 集，拉表时一键导入</span
                >
            </div>
        </button>
        <button
            onclick={onSettings}
            class="card-pop-in group flex flex-col items-start gap-3 rounded-2xl border border-(--theme-card-border) bg-(--theme-card-bg) p-6 text-left theme-glass-surface shadow-[var(--theme-card-shadow)] transition-all hover:-translate-y-0.5 hover:bg-(--theme-card-bg-focused)"
            style="animation-delay: 165ms"
        >
            <Icon
                icon="mdi:cog-outline"
                class="icon-pop size-9 text-(--theme-accent-text) drop-shadow-[0_0_3px_var(--theme-halo-color)]"
                style="animation-delay: 255ms"
            />
            <div class="flex flex-col gap-1">
                <span
                    class="text-lg font-semibold text-(--theme-card-text) [text-shadow:_0_0_3px_var(--theme-halo-color)]"
                    >设置</span
                >
                <span class="text-[15px] text-(--theme-muted-text) [text-shadow:_0_0_2px_var(--theme-halo-color)]"
                    >主题、交互、AI助手等个性化设置</span
                >
            </div>
        </button>
    </div>
</div>

<style>
    /* 首页功能卡片入场：错峰上浮淡入 + 轻微缩放 */
    .card-pop-in {
        animation: card-pop-in 0.38s cubic-bezier(0.2, 0, 0, 1) backwards;
    }
    @keyframes card-pop-in {
        0% {
            opacity: 0;
            transform: translateY(16px) scale(0.98);
        }
        100% {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }
    /* 卡片图标：快速弹跳（:global，作用于 Icon 组件根元素） */
    :global(.icon-pop) {
        animation: icon-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
    }
    @keyframes icon-pop {
        0% {
            transform: scale(0);
        }
        70% {
            transform: scale(1.12);
        }
        100% {
            transform: scale(1);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .card-pop-in,
        :global(.icon-pop) {
            animation: none;
        }
    }
</style>
