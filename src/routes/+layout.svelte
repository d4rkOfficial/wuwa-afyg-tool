<script lang="ts">
    import './layout.css'
    import favicon from '$lib/assets/favicon.svg'
    import Toast from '$lib/components/layout/toast.svelte'
    import { registerIcons } from '$lib/icons'

    registerIcons()

    let { children } = $props()
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
<Toast />
