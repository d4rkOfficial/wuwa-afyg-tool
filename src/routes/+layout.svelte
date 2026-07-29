<script lang="ts">
    import { browser } from '$app/environment'
    import { clearCache } from '$lib/data/api'
    import { onMount } from 'svelte'
    import './layout.css'
    import favicon from '$lib/assets/favicon.svg'
    import Toast from '$lib/components/layout/toast.svelte'
    import { loadThemes } from '$lib/theme'
    import { registerIcons } from '$lib/utils/icons'

    registerIcons()

    let { children } = $props()

    if (browser) {
        const hash = globalThis.location.hash
        if (hash === '#reset-cache') {
            clearCache()
            globalThis.history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search)
            globalThis.location.reload()
        }
    }

    onMount(() => {
        loadThemes()
    })
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
<Toast />
