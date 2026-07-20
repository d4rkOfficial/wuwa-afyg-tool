<script lang="ts">
    import Icon from '@iconify/svelte'
    import CodeBlock from './CodeBlock.svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Endpoint {
        method: string
        path: string
        summary?: string
    }

    interface EndpointGroup {
        name: string
        endpoints: Endpoint[]
        label?: string
    }

    interface Props extends ComponentsProps {
        title: string
        endpointGroups: EndpointGroup[]
        onSelect: (endpoint: Endpoint) => void
        selected: Endpoint | null
        onSend: () => void
        onCopyUrl: () => void
        onCopyData: () => void
        onCopyType: () => void
        onClear: () => void
        url: string
        response: string
        error: string
        loading: boolean
        showType: boolean
        onToggleType: (show: boolean) => void
        urlCopied: boolean
        dataCopied: boolean
        typeCopied: boolean
        typeInfo: { name: string; code: string } | null
        hasIdParam: boolean
        idValue: string
        onIdChange: (value: string) => void
        idPlaceholder?: string
        hasVersionParam?: boolean
        versionValue?: string
        onVersionChange?: (value: string) => void
        versionPlaceholder?: string
    }

    let {
        title,
        endpointGroups,
        onSelect,
        selected,
        url,
        hasIdParam,
        idValue,
        loading,
        showType,
        typeInfo,
        response,
        error,
        onSend,
        onClear,
        onCopyUrl,
        urlCopied,
        onCopyType,
        typeCopied,
        onCopyData,
        dataCopied,
        onToggleType,
        onIdChange,
        idPlaceholder,
        hasVersionParam,
        versionValue = '',
        onVersionChange,
        versionPlaceholder,
        class: className,
        style
    }: Props = $props()

    let sidebarWidth = $state(240)
    let dragging = $state(false)

    const onDragStart = (e: MouseEvent) => {
        e.preventDefault()
        dragging = true
    }

    $effect(() => {
        if (!dragging) return
        const onMove = (e: MouseEvent) => {
            sidebarWidth = Math.max(160, Math.min(480, e.clientX))
        }
        const onUp = () => {
            dragging = false
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
    })

    const methodClass = (m: string): string => {
        const map: Record<string, string> = {
            get: 'bg-green-500/20 text-green-400',
            post: 'bg-blue-500/20 text-blue-400',
            put: 'bg-yellow-500/20 text-yellow-400',
            delete: 'bg-red-500/20 text-red-400'
        }
        return map[m.toLowerCase()] || 'bg-zinc-500/20 text-zinc-400'
    }
</script>

<div class="h-dvh flex flex-col bg-zinc-950 text-zinc-100 {className ?? ''}" {style}>
    <header class="shrink-0 h-12 flex items-center justify-between px-5 border-b border-zinc-800/50 bg-zinc-950">
        <h1 class="text-sm font-semibold tracking-tight text-zinc-100">{title}</h1>
    </header>

    <div class="flex-1 min-h-0 flex">
        <aside
            class="shrink-0 border-r border-zinc-800/50 bg-zinc-950 flex flex-col relative {dragging
                ? 'select-none'
                : ''}"
            style="width: {sidebarWidth}px"
        >
            <div class="flex-1 overflow-y-auto py-2 space-y-0.5">
                {#each endpointGroups as group}
                    <div>
                        <div class="flex items-center justify-between px-4 py-2 mt-1">
                            <span class="text-[11px] font-semibold uppercase tracking-widest text-zinc-500"
                                >{group.label ?? group.name}</span
                            >
                            <span class="text-[10px] text-zinc-600 tabular-nums font-medium"
                                >{group.endpoints.length}</span
                            >
                        </div>
                        {#each group.endpoints as ep}
                            <button
                                onclick={() => onSelect(ep)}
                                class="relative w-full flex items-center gap-2.5 pl-3 pr-4 py-2 text-left text-xs transition-all duration-150 cursor-pointer {ep ===
                                selected
                                    ? 'bg-blue-500/8 text-zinc-100'
                                    : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-300'}"
                            >
                                {#if ep === selected}
                                    <div
                                        class="absolute left-0 top-1.5 bottom-1.5 w-0.75 rounded-r-full bg-blue-400 shadow-sm shadow-blue-400/30"
                                    ></div>
                                {/if}
                                <span
                                    class="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 {methodClass(
                                        ep.method
                                    )}">{ep.method}</span
                                >
                                <span class="truncate">{ep.path}</span>
                            </button>
                        {/each}
                    </div>
                {/each}
            </div>
            <button
                aria-label="Resize sidebar"
                class="appearance-none bg-transparent border-none p-0 absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors hover:bg-blue-400/50"
                onmousedown={onDragStart}
            ></button>
        </aside>

        <main class="flex-1 min-w-0 bg-zinc-900 flex flex-col overflow-hidden">
            <div class="flex-1 p-5 flex flex-col min-h-0 gap-4">
                {#if selected}
                    <div class="shrink-0 rounded-xl card-bg border border-zinc-800/50">
                        <div class="p-5">
                            <div class="flex items-start justify-between gap-4">
                                <div class="flex items-center gap-3 min-w-0">
                                    <span
                                        class="font-mono text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0 {methodClass(
                                            selected.method
                                        )}">{selected.method}</span
                                    >
                                    <div class="min-w-0">
                                        <span class="font-mono text-sm text-zinc-200 font-medium truncate block"
                                            >{selected.path}</span
                                        >
                                        {#if selected.summary}
                                            <span class="text-xs text-zinc-500 truncate block mt-0.5"
                                                >{selected.summary}</span
                                            >
                                        {/if}
                                    </div>
                                </div>
                                <button
                                    onclick={onCopyUrl}
                                    class="shrink-0 h-7 px-2.5 rounded-lg border border-zinc-700/50 bg-zinc-800 text-[11px] text-zinc-400 cursor-pointer transition-colors hover:bg-zinc-700 hover:text-zinc-200 active:bg-zinc-600 inline-flex items-center gap-1.5"
                                >
                                    <Icon icon={urlCopied ? 'mdi:check' : 'mdi:content-copy'} class="size-3.5" />
                                    {urlCopied ? 'Copied!' : 'Copy'}
                                </button>
                            </div>

                            <div
                                class="flex items-center gap-2 mt-3 text-xs font-mono text-zinc-500 bg-zinc-800/30 rounded-lg px-3 py-2"
                            >
                                <Icon icon="mdi:link-variant" class="size-3.5 shrink-0 text-zinc-500" />
                                <span class="truncate">{url}</span>
                            </div>

                            <div class="flex items-end justify-end gap-3 mt-4">
                                <div class="mr-auto flex items-center gap-2">
                                    {#if hasVersionParam}
                                        <div class="min-w-24 max-w-36">
                                            <input
                                                value={versionValue}
                                                oninput={(e) => onVersionChange?.((e.target as HTMLInputElement).value)}
                                                placeholder={versionPlaceholder ?? '版本号'}
                                                class="h-9 w-full px-3 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none transition-colors focus:border-blue-500/50"
                                            />
                                        </div>
                                    {/if}
                                    {#if hasIdParam}
                                        <div class="min-w-24 max-w-36">
                                            <input
                                                value={idValue}
                                                oninput={(e) => onIdChange((e.target as HTMLInputElement).value)}
                                                placeholder={idPlaceholder ?? 'ID'}
                                                class="h-9 w-full px-3 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none transition-colors focus:border-blue-500/50"
                                            />
                                        </div>
                                    {/if}
                                </div>
                                <button
                                    onclick={onSend}
                                    disabled={loading}
                                    class="h-9 px-5 rounded-lg bg-blue-600 text-xs font-semibold text-white cursor-pointer transition-all hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
                                >
                                    {#if loading}
                                        <div
                                            class="size-3 border-2 border-zinc-600 border-t-white rounded-full animate-spin"
                                        ></div>
                                        Sending...
                                    {:else}
                                        <Icon icon="mdi:send" class="size-3.5" />
                                        Send
                                    {/if}
                                </button>
                            </div>
                        </div>
                    </div>
                {/if}

                <div class="flex-1 min-h-0 rounded-xl card-bg border border-zinc-800/50 flex flex-col">
                    <div class="flex items-center justify-between shrink-0 px-5 border-b border-zinc-800/30">
                        <div class="flex gap-0">
                            <button
                                onclick={() => onToggleType(true)}
                                class="relative h-10 px-1 text-xs font-medium transition-colors duration-150 cursor-pointer mr-4 {showType
                                    ? 'text-blue-400'
                                    : 'text-zinc-500 hover:text-zinc-300'}"
                            >
                                <Icon icon="mdi:code-tags" class="size-3.5 inline mr-1.5 align-text-bottom" />
                                Type
                                {#if showType}
                                    <div
                                        class="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-blue-400 shadow-sm shadow-blue-400/30"
                                    ></div>
                                {/if}
                            </button>
                            <button
                                onclick={() => onToggleType(false)}
                                class="relative h-10 px-1 text-xs font-medium transition-colors duration-150 cursor-pointer {!showType
                                    ? 'text-blue-400'
                                    : 'text-zinc-500 hover:text-zinc-300'}"
                            >
                                <Icon icon="mdi:database-outline" class="size-3.5 inline mr-1.5 align-text-bottom" />
                                Data
                                {#if !showType}
                                    <div
                                        class="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-blue-400 shadow-sm shadow-blue-400/30"
                                    ></div>
                                {/if}
                            </button>
                        </div>
                        <div class="flex items-center gap-1.5">
                            {#if showType}
                                {#if typeInfo}
                                    <button
                                        onclick={onCopyType}
                                        class="h-7 px-2.5 rounded-lg border border-zinc-700/50 bg-zinc-800 text-[11px] text-zinc-400 cursor-pointer transition-colors hover:bg-zinc-700 hover:text-zinc-200 active:bg-zinc-600 inline-flex items-center gap-1.5"
                                    >
                                        <Icon icon={typeCopied ? 'mdi:check' : 'mdi:content-copy'} class="size-3" />
                                        {typeCopied ? 'Copied!' : 'Copy'}
                                    </button>
                                {/if}
                            {:else}
                                {#if response}
                                    <button
                                        onclick={onCopyData}
                                        class="h-7 px-2.5 rounded-lg border border-zinc-700/50 bg-zinc-800 text-[11px] text-zinc-400 cursor-pointer transition-colors hover:bg-zinc-700 hover:text-zinc-200 active:bg-zinc-600 inline-flex items-center gap-1.5"
                                    >
                                        <Icon icon={dataCopied ? 'mdi:check' : 'mdi:content-copy'} class="size-3" />
                                        {dataCopied ? 'Copied!' : 'Copy'}
                                    </button>
                                    <button
                                        onclick={onClear}
                                        class="h-7 px-2.5 rounded-lg border border-zinc-700/50 bg-zinc-800 text-[11px] text-zinc-400 cursor-pointer transition-colors hover:bg-zinc-700 hover:text-zinc-200 active:bg-zinc-600 inline-flex items-center gap-1.5"
                                    >
                                        <Icon icon="mdi:close" class="size-3" />
                                        Clear
                                    </button>
                                {/if}
                            {/if}
                        </div>
                    </div>

                    <div class="flex-1 min-h-0 overflow-y-auto">
                        {#if showType}
                            {#if typeInfo}
                                <div class="flex items-center gap-2 px-5 pt-3 pb-1">
                                    <Icon icon="mdi:code-tags" class="size-3.5 text-blue-400/70" />
                                    <span class="text-xs font-semibold text-zinc-400">{typeInfo.name}</span>
                                </div>
                                <CodeBlock code={typeInfo.code} lang="typescript" class="pt-2" />
                            {:else}
                                <div class="flex flex-col items-center justify-center py-14 text-zinc-500">
                                    <Icon icon="mdi:file-document-outline" class="size-7 mb-2 text-zinc-600" />
                                    <span class="text-sm font-medium">No type definition</span>
                                    <span class="text-xs text-zinc-600 mt-1">
                                        This endpoint has no TypeScript type
                                    </span>
                                </div>
                            {/if}
                        {:else}
                            {#if error}
                                <div class="p-5">
                                    <div class="flex items-center gap-2 text-sm font-semibold text-red-400 mb-2">
                                        <span
                                            class="size-5 rounded-full bg-red-500/20 flex items-center justify-center"
                                        >
                                            <Icon icon="mdi:alert-circle-outline" class="size-3.5" />
                                        </span>
                                        Error
                                    </div>
                                    <p
                                        class="text-xs text-red-300/70 font-mono whitespace-pre-wrap bg-red-500/5 rounded-lg px-3 py-2 border border-red-500/10"
                                    >
                                        {error}
                                    </p>
                                </div>
                            {:else if response}
                                <CodeBlock code={response} lang="json" />
                            {:else}
                                <div class="flex flex-col items-center justify-center py-14 text-zinc-500">
                                    <Icon icon="mdi:send-circle-outline" class="size-8 mb-2 text-zinc-600" />
                                    <span class="text-sm font-medium">No response yet</span>
                                    <span class="text-xs text-zinc-600 mt-1">
                                        Select an endpoint and send a request
                                    </span>
                                </div>
                            {/if}
                        {/if}
                    </div>
                </div>
            </div>
        </main>
    </div>
</div>
