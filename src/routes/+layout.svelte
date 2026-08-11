<script lang="ts">
    import { browser } from '$app/environment'
    import { clearCache } from '$lib/data/api'
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
    import { loadThemes } from '$lib/theme'
    import { registerIcons } from '$lib/utils/icons'

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
            disconnectWs()
        }
    })
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
<Toast />
<HelpPanel />
