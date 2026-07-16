<script lang="ts">
    import Icon from '@iconify/svelte'

    const links: { href: string; title: string; desc: string; icon: string }[] = [
        { href: '/test/api', title: 'API 接口', desc: 'v1 接口测试面板', icon: 'mdi:api' },
        { href: '/test/api-nanoka', title: 'nanoka 数据', desc: 'nanoka 原始数据调试', icon: 'mdi:database-search' },
        { href: '/test/list/characters', title: '角色列表', desc: '查看所有角色及技能详情', icon: 'mdi:account-group' },
        { href: '/test/list/weapons', title: '武器列表', desc: '查看所有武器及详情', icon: 'mdi:sword-cross' },
        { href: '/test/list/echos', title: '声骸列表', desc: '查看所有声骸及详情', icon: 'mdi:ghost' },
        { href: '/test/team-config', title: '配队配置', desc: '编辑队伍配置', icon: 'mdi:account-cog' }
    ]
</script>

<div class="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
    <header class="h-12 flex items-center gap-2.5 px-5 border-b border-zinc-800/50 bg-zinc-950 shrink-0">
        <Icon icon="mdi:test-tube" class="size-5 text-zinc-400" />
        <h1 class="text-sm font-semibold tracking-tight">Test 页面</h1>
    </header>
    <div class="flex-1 overflow-y-auto p-6">
        <div class="mx-auto grid max-w-2xl gap-3">
            {#each links as { href, title, desc, icon }}
                <a
                    {href}
                    class="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-5 py-4 transition-colors hover:border-zinc-600 hover:bg-zinc-800/60"
                >
                    <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800/60">
                        <Icon {icon} class="size-5 text-zinc-400" />
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="text-sm font-semibold text-zinc-200">{title}</div>
                        <div class="mt-0.5 text-xs text-zinc-500">{desc}</div>
                    </div>
                    <Icon icon="mdi:chevron-right" class="size-5 text-zinc-600 shrink-0" />
                </a>
            {/each}
        </div>
    </div>
</div>
