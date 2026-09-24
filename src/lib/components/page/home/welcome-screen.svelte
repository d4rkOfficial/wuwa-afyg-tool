<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import { getActiveId, getOverrides } from '$lib/theme/theme.svelte'

    interface Props extends ComponentsProps {
        onWorkshopFrame: () => void
        onBuffLibrary: () => void
        onSubstatLibrary: () => void
        onSettings: () => void
        /** @desc 新建工程 */
        oncreate: () => void
        /** @desc 从本地导入工程文件 */
        onimport: () => void
        /** @desc 从工坊下载社区工程 */
        onworkshop: () => void
    }
    let {
        onWorkshopFrame,
        onBuffLibrary,
        onSubstatLibrary,
        onSettings,
        oncreate,
        onimport,
        onworkshop,
        class: className,
        style: styleProp
    }: Props = $props()

    const isDark = $derived(getActiveId() !== 'light')
    const isMono = $derived(getOverrides().accentHue === 'mono')

    /** @desc 杂志式排版用的标题描边（跟随主题明暗） */
    const strokeStyle = $derived(`-webkit-text-stroke: 2px ${isDark ? '#000' : '#fff'}; paint-order: stroke fill;`)

    interface Entry {
        /** @desc 卡片背景水印（装饰性超大水印，非小标） */
        watermark: string
        title: string
        desc: string
        icon: string
        action: () => void
        /** @desc 版式：大格（跨两列） */
        wide?: boolean
    }

    const entries = $derived<Entry[]>([
        {
            watermark: 'WORKSHOP',
            title: '工坊',
            desc: '把自己的工程上传到工坊，生成带有效期的分享链接；也能浏览社区公开的工程，看看别人怎么排轴、怎么拉表。',
            icon: 'mdi:storefront-outline',
            action: onWorkshopFrame,
            wide: true
        },
        {
            watermark: 'BUFF',
            title: 'Buff 集',
            desc: '按角色 / 武器 / 声骸 / 套装维护增益条目，拉表时勾选生效；可从工坊同步社区维护的 Buff 预设。',
            icon: 'mdi:view-dashboard-outline',
            action: onBuffLibrary
        },
        {
            watermark: 'STAT',
            title: '词条集',
            desc: '标准 14 词条与自定义声骸词条方案，可一键套用到队伍角色；支持从库街区导入账号下角色的当前声骸。',
            icon: 'mdi:clipboard-text-outline',
            action: onSubstatLibrary
        },
        {
            watermark: 'COCONUT',
            title: '设置',
            desc: '外观（主题、背景图、表面质感）、交互（二次确认、提示位置、水印、侧栏动作、关闭按钮位置）、按键图标与快捷键、性能与重载；数据（上游数据源、工坊实例、库街区账号、缓存清理、归档管理）；AI 助手（接入配置、权限与人设提示词）。',
            icon: 'mdi:cog-outline',
            action: onSettings,
            wide: true
        }
    ])
</script>

<div data-sf="content" class="theme-scrollbar min-h-0 flex-1 overflow-y-auto {className}" style={styleProp}>
    <div class="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-5 px-6 py-7 md:px-8">
        <!-- 刊头 -->
        <header class="flex shrink-0 flex-col gap-3">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
                <span
                    class="flex items-center gap-2 text-[10px] font-medium tracking-[0.42em] text-(--theme-accent-text)"
                    style="opacity: 0.85;"
                >
                    <Icon icon="mdi:star-four-points-outline" class="size-3 shrink-0" />
                    Wuthering Waves Coconut Toolbox
                </span>
                <span class="text-[10px] uppercase tracking-[0.28em] text-(--theme-muted-text)">
                    {isMono ? 'Mono Edition' : 'Vol. 1 — 排轴 / 拉表 / 配装 / 计算'}
                </span>
            </div>

            <div
                class="flex flex-col gap-2 border-y border-(--theme-card-border) py-4 md:flex-row md:items-end md:gap-8"
            >
                <h1 class="flex flex-col leading-[0.94]">
                    <span
                        class="text-4xl font-black tracking-tight text-(--theme-card-text) md:text-5xl lg:text-6xl"
                        style={strokeStyle}>椰果工具箱</span
                    >
                    <span
                        class="text-2xl font-black tracking-tight text-(--theme-accent-text) md:text-3xl lg:text-4xl"
                        style={strokeStyle}>让排轴与伤害计算更简单</span
                    >
                </h1>
                <!-- 主要动作：新建 / 本地导入 / 工坊下载（取代原刊头右侧说明文字） -->
                <div class="flex flex-wrap items-center gap-2 md:ml-auto md:justify-end">
                    <button
                        onclick={oncreate}
                        class="inline-flex items-center gap-1.5 rounded-none border px-3.5 py-2 text-xs font-black tracking-tight transition-all hover:brightness-110"
                        style="border-color: var(--theme-accent-bg); background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                        title="新建一个空白工程"
                    >
                        <Icon icon="mdi:plus" class="size-4 shrink-0" />
                        新建工程
                    </button>
                    <button
                        onclick={onimport}
                        class="inline-flex items-center gap-1.5 rounded-none border px-3.5 py-2 text-xs font-black tracking-tight text-(--theme-card-text) transition-colors hover:border-(--theme-accent-bg)"
                        style="border-color: var(--theme-card-border); background: color-mix(in srgb, var(--theme-card-bg) 70%, transparent);"
                        title="从本地选择工程文件导入"
                    >
                        <Icon icon="mdi:file-import-outline" class="size-4 shrink-0" />
                        从本地导入
                    </button>
                    <button
                        onclick={onworkshop}
                        class="inline-flex items-center gap-1.5 rounded-none border px-3.5 py-2 text-xs font-black tracking-tight text-(--theme-card-text) transition-colors hover:border-(--theme-accent-bg)"
                        style="border-color: var(--theme-card-border); background: color-mix(in srgb, var(--theme-card-bg) 70%, transparent);"
                        title="浏览椰果工坊的社区工程并下载导入"
                    >
                        <Icon icon="mdi:storefront-outline" class="size-4 shrink-0" />
                        从工坊下载
                    </button>
                </div>
            </div>
        </header>

        <!-- 功能版块：杂志式不等宽网格（大格填满剩余高度，尽量避免纵向滚动） -->
        <section class="grid grid-cols-1 gap-3.5 md:min-h-0 md:flex-1 md:grid-cols-3">
            {#each entries as entry (entry.title)}
                <button
                    onclick={entry.action}
                    data-sf="card"
                    class={[
                        'card-pop-in group relative flex flex-col justify-between gap-4 overflow-hidden border border-(--theme-card-border) p-5 text-left theme-glass-surface shadow-(--theme-card-shadow) transition-all hover:-translate-y-0.5 hover:bg-(--theme-card-bg-focused)',
                        'min-h-[9.5rem] md:h-full md:min-h-[11rem]',
                        entry.wide ? 'md:col-span-2' : ''
                    ].join(' ')}
                >
                    <span
                        class="pointer-events-none absolute -right-1 -top-3 select-none whitespace-nowrap text-[4.5rem] font-black uppercase leading-none tracking-tighter text-(--theme-accent-text) opacity-[0.07] md:text-[5.5rem]"
                        >{entry.watermark}</span
                    >
                    <div class="relative flex items-start justify-between gap-4">
                        <span class="flex flex-col gap-1">
                            <span
                                class="text-xl font-black tracking-tight text-(--theme-card-text) [text-shadow:0_0_3px_var(--theme-halo-color)] md:text-2xl"
                                >{entry.title}</span
                            >
                        </span>
                        <Icon
                            icon={entry.icon}
                            class="icon-pop size-7 shrink-0 text-(--theme-accent-text) drop-shadow-[0_0_3px_var(--theme-halo-color)]"
                        />
                    </div>
                    <p class="relative max-w-2xl text-[13px] leading-relaxed text-(--theme-muted-text)">
                        {entry.desc}
                    </p>
                    <span
                        class="relative flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.22em] text-(--theme-accent-text) opacity-80 transition-opacity group-hover:opacity-100"
                    >
                        进入 <Icon
                            icon="mdi:arrow-right"
                            class="size-3.5 transition-transform group-hover:translate-x-0.5"
                        />
                    </span>
                </button>
            {/each}
        </section>

        <footer
            class="shrink-0 border-t border-(--theme-card-border) pt-3 text-[10px] uppercase tracking-[0.24em] text-(--theme-muted-text)"
        >
            鸣潮社区公益工具
        </footer>
    </div>
</div>

<style>
    /* 首页版块入场：错峰上浮淡入 */
    .card-pop-in {
        animation: card-pop-in 0.42s cubic-bezier(0.2, 0, 0, 1) backwards;
    }
    @keyframes card-pop-in {
        0% {
            opacity: 0;
            transform: translateY(18px);
        }
        100% {
            opacity: 1;
            transform: translateY(0);
        }
    }
    :global(.icon-pop) {
        animation: icon-pop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
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
