<script lang="ts">
    import { browser } from '$app/environment'
    import { clearCache } from '$lib/api/data-cache'
    import { connectWs, disconnectWs } from '$lib/ws-remote/ws-remote.svelte'
    import {
        parseHashParams,
        registerHashAction,
        runHashActions,
        initHashActions
    } from '$lib/utils/hash-actions.svelte'
    import { onMount } from 'svelte'
    import './layout.css'
    import favicon from '$lib/assets/favicon.svg'
    import Toast from '$lib/components/layout/toast.svelte'
    import HelpPanel from '$lib/components/ui/help-panel.svelte'
    import MagneticPointer from '$lib/components/layout/magnetic-pointer.svelte'
    import { loadThemes } from '$lib/theme'
    import { registerIcons } from '$lib/utils/icons'
    import { initScrollbarAutoHide } from '$lib/utils/scrollbar-autohide'

    registerIcons()

    let { children } = $props()

    if (browser) {
        // 紧急 hash：必须在应用初始化前同步执行（清缓存后立即重载）
        if (parseHashParams(globalThis.location.hash).some((p) => p.key === 'reset-cache')) {
            clearCache()
            globalThis.history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search)
            globalThis.location.reload()
        }
    }

    onMount(() => {
        loadThemes()
        // 滚动条自动隐藏：一条 window 捕获阶段监听覆盖全站所有滚动容器（详见该模块文件头注释）。
        // 放在 +layout 而不是 +page：布局是整棵路由树的唯一外壳，弹窗/右键菜单等挂到 body 的
        // 滚动容器也在这里的 window 上被捕获，且只初始化一次（页面切换不会重复挂监听）。
        const disposeScrollbarAutoHide = initScrollbarAutoHide()
        let detachHash = () => {}
        if (browser) {
            // WS 远程接管：hash 携带目标则连接，移除则断开（由统一 hash 分发管理）
            registerHashAction({
                key: 'websocket',
                run: (value) => connectWs(value),
                cleanup: () => disconnectWs()
            })
            runHashActions()
            detachHash = initHashActions()
        }
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
        }
        return () => {
            detachHash()
            disposeScrollbarAutoHide()
            disconnectWs()
        }
    })
</script>

<svelte:head>
    <link rel="icon" href={favicon} />
</svelte:head>
{@render children()}
<Toast />
<HelpPanel />
<MagneticPointer />
