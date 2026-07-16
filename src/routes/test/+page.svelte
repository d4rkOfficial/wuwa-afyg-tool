<script lang="ts">
    import Icon from '@iconify/svelte'

    interface LinkGroup {
        label: string
        links: { href: string; title: string; desc: string; icon: string }[]
    }

    const groups: LinkGroup[] = [
        {
            label: '接口调试',
            links: [
                { href: '/test/api', title: 'API 接口', desc: 'v1 接口测试面板', icon: 'mdi:api' },
                {
                    href: '/test/api-nanoka',
                    title: 'nanoka 数据',
                    desc: 'nanoka 原始数据调试',
                    icon: 'mdi:database-search'
                }
            ]
        },
        {
            label: '数据浏览',
            links: [
                {
                    href: '/test/list/characters',
                    title: '角色列表',
                    desc: '查看所有角色及技能详情',
                    icon: 'mdi:account-group'
                },
                { href: '/test/list/weapons', title: '武器列表', desc: '查看所有武器及详情', icon: 'mdi:sword-cross' },
                { href: '/test/list/echos', title: '声骸列表', desc: '查看所有声骸及详情', icon: 'mdi:ghost' }
            ]
        },
        {
            label: '工具',
            links: [
                { href: '/test/team-config', title: '配队配置', desc: '编辑队伍配置', icon: 'mdi:account-cog' },
                {
                    href: '/test/key-press',
                    title: '按键测试',
                    desc: '键盘鼠标图标录入测试',
                    icon: 'mdi:keyboard-variant'
                },
                { href: '/test/timeline', title: '时间线', desc: '自定义参考线时间轴演示', icon: 'mdi:timeline' }
            ]
        }
    ]
</script>

<div class="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
    <header class="h-12 flex items-center gap-2.5 px-5 border-b border-zinc-800/50 bg-zinc-950 shrink-0">
        <Icon icon="mdi:flask-outline" class="size-5 text-zinc-400" />
        <h1 class="text-sm font-semibold tracking-tight">Test 页面</h1>
    </header>

    <div class="flex-1 overflow-y-auto p-6 sm:p-8">
        <div class="mx-auto max-w-3xl space-y-8">
            {#each groups as group}
                <section>
                    <div class="flex items-center gap-3 mb-3">
                        <span class="text-[11px] font-semibold uppercase tracking-widest text-zinc-600"
                            >{group.label}</span
                        >
                        <div class="h-px flex-1 bg-zinc-800/50"></div>
                    </div>
                    <div class="grid gap-3 sm:grid-cols-2">
                        {#each group.links as { href, title, desc, icon }}
                            <a
                                {href}
                                class="group relative flex items-center gap-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-5 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-600/80 hover:bg-zinc-800/50 hover:shadow-lg hover:shadow-black/20"
                            >
                                <div
                                    class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800/60 transition-colors group-hover:bg-blue-500/15"
                                >
                                    <Icon
                                        {icon}
                                        class="size-5 text-zinc-400 transition-colors group-hover:text-blue-400"
                                    />
                                </div>
                                <div class="min-w-0 flex-1">
                                    <div
                                        class="text-sm font-semibold text-zinc-200 transition-colors group-hover:text-blue-300"
                                    >
                                        {title}
                                    </div>
                                    <div class="mt-0.5 text-xs text-zinc-500">{desc}</div>
                                </div>
                                <Icon
                                    icon="mdi:chevron-right"
                                    class="size-4 shrink-0 text-zinc-700 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-400"
                                />
                            </a>
                        {/each}
                    </div>
                </section>
            {/each}
        </div>
    </div>
</div>
