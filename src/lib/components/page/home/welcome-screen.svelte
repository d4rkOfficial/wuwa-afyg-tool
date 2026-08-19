<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import { getWWVersion } from '$lib/api/client-version'
    import { getEggMode, setEggMode } from '$lib/data/egg-prefs.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import favicon from '$lib/assets/favicon.svg'
    import type { ToyProfile } from '$lib/bilibili-toy/profile.svelte'

    interface Props extends ComponentsProps {
        profile: ToyProfile | null
        onCreate: () => void
        onWorkshopFrame: () => void
        onBuffLibrary: () => void
        onSettings: () => void
    }
    let {
        profile,
        onCreate,
        onWorkshopFrame,
        onBuffLibrary,
        onSettings,
        class: className,
        style: styleProp
    }: Props = $props()

    // ── 彩蛋：短时间内连续点击版本号 badge 5 次 → 切换萌萌人工具箱 ──
    const EGG_CLICK_WINDOW_MS = 2000
    const EGG_CLICK_COUNT = 5
    let eggClicks: number[] = []
    function handleEggBadgeClick() {
        const now = Date.now()
        eggClicks = eggClicks.filter((t) => now - t <= EGG_CLICK_WINDOW_MS)
        eggClicks.push(now)
        if (eggClicks.length >= EGG_CLICK_COUNT) {
            eggClicks = []
            setEggMode(true)
            addToast('彩蛋已解锁：萌萌人工具箱！', 'success')
        }
    }
</script>

<div class="flex flex-1 flex-col items-center justify-center gap-8 px-8 {className}" style={styleProp}>
    <div class="flex flex-col items-center text-center">
        <div class="relative mb-4">
            <div class="absolute inset-0 rounded-full bg-(--theme-accent-bg)/25 blur-2xl" aria-hidden="true"></div>
            <img
                src={getEggMode() ? '/icons/egg/yaya.png' : favicon}
                alt={getEggMode() ? '萌萌人工具箱' : '椰果工具箱'}
                class="relative size-20 rounded-2xl object-contain drop-shadow-[0_0_10px_var(--theme-halo-color)]"
            />
        </div>
        <h2
            class="mb-2 text-3xl font-bold tracking-tight text-(--theme-card-text) [text-shadow:_0_0_8px_var(--theme-halo-color)]"
        >
            {getEggMode() ? '萌萌人工具箱' : '椰果工具箱'}
        </h2>
        <div class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            {#if profile}
                <span
                    class="flex items-center gap-1.5 text-sm text-(--theme-card-text) [text-shadow:_0_0_2px_var(--theme-halo-color)]"
                >
                    <img
                        src={profile.avatar}
                        alt={profile.nickname}
                        class="size-5 rounded-full object-cover"
                        referrerpolicy="no-referrer"
                    />
                    你好，{profile.nickname}
                </span>
            {:else}
                <span class="text-sm text-(--theme-card-text) [text-shadow:_0_0_2px_var(--theme-halo-color)]">
                    鸣潮社区公益工具
                </span>
            {/if}
            <button
                type="button"
                class="cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] font-medium text-(--theme-accent-text)"
                style="background: color-mix(in srgb, var(--theme-accent-bg) 14%, transparent);"
                title="数据版本"
                onclick={handleEggBadgeClick}
            >
                数据版本 {getWWVersion()}
            </button>
        </div>
    </div>
    <div class="grid w-full max-w-5xl grid-cols-4 gap-4">
        <button
            onclick={onCreate}
            class="card-pop-in group flex flex-col items-start gap-3 rounded-2xl border border-(--theme-card-border) bg-(--theme-card-bg) p-6 text-left theme-glass-surface shadow-[var(--theme-card-shadow)] transition-all hover:-translate-y-0.5 hover:bg-(--theme-card-bg-focused)"
            style="animation-delay: 0ms"
        >
            <Icon
                icon="mdi:plus"
                class="icon-pop size-9 text-(--theme-accent-text) drop-shadow-[0_0_3px_var(--theme-halo-color)]"
                style="animation-delay: 90ms"
            />
            <div class="flex flex-col gap-1">
                <span
                    class="text-lg font-semibold text-(--theme-card-text) [text-shadow:_0_0_3px_var(--theme-halo-color)]"
                    >创建工程</span
                >
                <span class="text-[15px] text-(--theme-muted-text) [text-shadow:_0_0_2px_var(--theme-halo-color)]"
                    >从空白开始，配置配队、排轴与伤害计算</span
                >
            </div>
        </button>
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
                    >椰果工坊</span
                >
                <span class="text-[15px] text-(--theme-muted-text) [text-shadow:_0_0_2px_var(--theme-halo-color)]"
                    >前往社区站点浏览、分享与下载工程</span
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
                    >管理本地增益，拉表时一键导入</span
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
                    >主题、按键图标与工坊设置</span
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
