<script lang="ts">
    import { page } from '$app/stores'
    import { goto } from '$app/navigation'
    import Icon from '@iconify/svelte'
</script>

<div class="flex h-dvh flex-col items-center justify-center gap-6 bg-(--theme-layout-bg) text-(--theme-layout-text)">
    <div class="text-center">
        <div class="text-6xl font-bold text-(--theme-accent-text)/80">{$page.status}</div>
        <p class="mt-3 text-sm text-zinc-400">{$page.error?.message ?? '页面不存在或发生错误'}</p>
    </div>
    <button
        onclick={() => goto('/')}
        class="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff)"
    >
        <Icon icon="mdi:arrow-left" class="size-4" />
        返回首页
    </button>
</div>
