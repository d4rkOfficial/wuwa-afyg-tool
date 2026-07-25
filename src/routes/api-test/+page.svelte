<script lang="ts">
    import { browser } from '$app/environment'
    import { goto } from '$app/navigation'
    import { endpointGroups, v2EndpointGroups, typeMap, DEFAULTS, type Endpoint } from './api-data'
    import Icon from '@iconify/svelte'
    import Prism from 'prismjs'
    import 'prismjs/components/prism-json'
    import 'prismjs/components/prism-typescript'
    import 'prismjs/themes/prism-dark.css'

    let version = $state<'v1' | 'v2'>('v1')
    let sel = $state<Endpoint | null>(endpointGroups[0]?.endpoints[0] ?? null)
    let idVal = $state('')
    let res = $state('')
    let loading = $state(false)
    let err = $state('')
    let showType = $state(true)
    let urlCopied = $state(false)
    let typeCopied = $state(false)
    let dataCopied = $state(false)
    let stash = $state<Record<string, { res: string; err: string }>>({})
    let origin = $state('')

    let currentGroups = $derived(version === 'v1' ? endpointGroups : v2EndpointGroups)

    $effect(() => {
        if (browser) origin = location.origin
    })

    $effect(() => {
        idVal = sel ? (DEFAULTS[sel.path] ?? '') : ''
    })

    let currentType = $derived(sel ? (typeMap[sel.path] ?? null) : null)
    let inputPlaceholder = $derived(
        sel?.path.includes('{names}')
            ? 'names'
            : sel?.path.includes('{name}') || sel?.path.includes('{character}')
              ? '中文名'
              : ''
    )

    let sidebarWidth = $state(220)
    let dragging = $state(false)

    const onDragStart = (e: MouseEvent) => {
        e.preventDefault()
        dragging = true
    }

    $effect(() => {
        if (!dragging) return
        const onMove = (e: MouseEvent) => {
            sidebarWidth = Math.max(160, Math.min(400, e.clientX))
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

    function pick(e: Endpoint) {
        if (sel) stash[sel.path] = { res, err }
        sel = e
        idVal = DEFAULTS[e.path] ?? ''
        const saved = stash[e.path]
        res = saved?.res ?? ''
        err = saved?.err ?? ''
    }

    function switchVersion(v: 'v1' | 'v2') {
        if (v === version) return
        if (sel) stash[sel.path] = { res, err }
        version = v
        const groups = v === 'v1' ? endpointGroups : v2EndpointGroups
        sel = groups[0]?.endpoints[0] ?? null
        idVal = sel ? (DEFAULTS[sel.path] ?? '') : ''
        const saved = stash[sel?.path ?? '']
        res = saved?.res ?? ''
        err = saved?.err ?? ''
    }

    async function send() {
        if (!sel || !browser) return
        loading = true
        err = ''
        res = ''
        showType = false
        try {
            let p = sel.path
            if (idVal)
                p = p
                    .replace('{name}', idVal)
                    .replace('{id}', idVal)
                    .replace('{names}', idVal)
                    .replace('{seasonId}', idVal)
                    .replace('{character}', idVal)
            const r = await fetch(p)
            if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + r.statusText)
            res = JSON.stringify(await r.json(), null, 4)
            stash[sel.path] = { res, err: '' }
        } catch (e) {
            err = e instanceof Error ? e.message : String(e)
            stash[sel.path] = { res: '', err }
        } finally {
            loading = false
        }
    }

    function clearRes() {
        res = ''
        err = ''
        if (sel) stash[sel.path] = { res: '', err: '' }
    }

    async function copyUrl() {
        await navigator.clipboard.writeText(resolveUrl())
        urlCopied = true
        setTimeout(() => (urlCopied = false), 1500)
    }

    async function copyType() {
        if (!currentType) return
        await navigator.clipboard.writeText(currentType.code)
        typeCopied = true
        setTimeout(() => (typeCopied = false), 1500)
    }

    async function copyData() {
        if (!res) return
        await navigator.clipboard.writeText(res)
        dataCopied = true
        setTimeout(() => (dataCopied = false), 1500)
    }

    function resolveUrl(): string {
        if (!sel) return ''
        let p = sel.path
        if (idVal)
            p = p
                .replace('{name}', idVal)
                .replace('{id}', idVal)
                .replace('{names}', idVal)
                .replace('{seasonId}', idVal)
                .replace('{character}', idVal)
        return origin + p
    }

    let highlightedRes = $derived.by(() => {
        if (!res) return ''
        try {
            return Prism.highlight(res, Prism.languages.json, 'json')
        } catch {
            return res
        }
    })

    let highlightedType = $derived.by(() => {
        if (!currentType) return ''
        try {
            return Prism.highlight(currentType.code, Prism.languages.typescript, 'typescript')
        } catch {
            return currentType.code
        }
    })

    const hasIdParam = (p: string) =>
        p.includes('{name}') ||
        p.includes('{id}') ||
        p.includes('{names}') ||
        p.includes('{seasonId}') ||
        p.includes('{character}')
</script>

<svelte:head><title>椰果API</title></svelte:head>

<div class="flex h-dvh flex-col" style="background: var(--theme-layout-bg); color: var(--theme-layout-text)">
    <header
        class="shrink-0 flex items-center justify-between border-b border-[var(--theme-divider-border)] px-5 py-3"
        style="background: var(--theme-modal-bg)"
    >
        <h1 class="text-sm font-semibold">API 测试</h1>
        <button
            onclick={() => goto('/')}
            class="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--theme-modal-text)/50 transition-colors hover:bg-[var(--theme-card-bg-focused)]"
        >
            <Icon icon="mdi:arrow-left" class="size-3.5" />
            返回主页
        </button>
    </header>

    <div class="flex-1 min-h-0 flex">
        <!-- Sidebar -->
        <aside
            class="shrink-0 border-r border-[var(--theme-divider-border)] flex flex-col relative"
            style="width: {sidebarWidth}px; background: var(--theme-modal-bg)"
        >
            <div class="flex gap-1 px-3 pt-3 pb-2 border-b border-[var(--theme-divider-border)]">
                <button
                    onclick={() => switchVersion('v1')}
                    class="flex-1 h-7 rounded-md text-xs font-semibold transition-colors {version === 'v1'
                        ? 'bg-indigo-500/20 text-indigo-600'
                        : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/60 hover:bg-[var(--theme-card-bg-focused)]'}"
                >
                    v1
                </button>
                <button
                    onclick={() => switchVersion('v2')}
                    class="flex-1 h-7 rounded-md text-xs font-semibold transition-colors {version === 'v2'
                        ? 'bg-indigo-500/20 text-indigo-600'
                        : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/60 hover:bg-[var(--theme-card-bg-focused)]'}"
                >
                    v2
                </button>
            </div>
            <div class="flex-1 overflow-y-auto py-2 space-y-0.5">
                {#each currentGroups as group}
                    <div>
                        <div class="flex items-center justify-between px-4 py-2 mt-1">
                            <span
                                class="text-[11px] font-semibold uppercase tracking-widest text-(--theme-modal-text)/40"
                                >{group.label ?? group.name}</span
                            >
                            <span class="text-[10px] text-(--theme-modal-text)/20">{group.endpoints.length}</span>
                        </div>
                        {#each group.endpoints as ep}
                            <button
                                onclick={() => pick(ep)}
                                class="relative w-full flex items-center gap-2.5 pl-3 pr-4 py-2 text-left text-xs transition-colors {ep ===
                                sel
                                    ? 'bg-indigo-500/10 text-(--theme-modal-text)'
                                    : 'text-(--theme-modal-text)/50 hover:bg-[var(--theme-card-bg-focused)] hover:text-(--theme-modal-text)/80'}"
                            >
                                {#if ep === sel}
                                    <div
                                        class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-indigo-500"
                                    ></div>
                                {/if}
                                <span
                                    class="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-emerald-500/15 text-emerald-400"
                                    >GET</span
                                >
                                <span class="truncate">{ep.path}</span>
                            </button>
                        {/each}
                    </div>
                {/each}
            </div>
            <button
                aria-label="调整侧栏宽度"
                class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors hover:bg-indigo-500/50"
                onmousedown={onDragStart}
            ></button>
        </aside>

        <!-- Main -->
        <main class="flex-1 min-w-0 flex flex-col overflow-hidden" style="background: var(--theme-modal-bg)">
            <div class="flex-1 p-5 flex flex-col min-h-0 gap-4">
                {#if sel}
                    <div
                        class="shrink-0 rounded-xl border border-[var(--theme-card-border)] p-5"
                        style="background: var(--theme-modal-bg)"
                    >
                        <div class="flex items-start justify-between gap-4">
                            <div class="flex items-center gap-3 min-w-0">
                                <span
                                    class="font-mono text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0 bg-emerald-500/15 text-emerald-400"
                                    >GET</span
                                >
                                <div class="min-w-0">
                                    <span class="font-mono text-sm font-medium truncate block text-(--theme-modal-text)"
                                        >{sel.path}</span
                                    >
                                    {#if sel.summary}
                                        <span class="text-xs text-(--theme-modal-text)/50 truncate block mt-0.5"
                                            >{sel.summary}</span
                                        >
                                    {/if}
                                </div>
                            </div>
                            <button
                                onclick={copyUrl}
                                class="shrink-0 h-7 px-2.5 rounded-lg border border-[var(--theme-card-border)] text-[11px] text-(--theme-modal-text)/50 transition-colors hover:bg-[var(--theme-card-bg-focused)] inline-flex items-center gap-1.5"
                            >
                                <Icon icon={urlCopied ? 'mdi:check' : 'mdi:content-copy'} class="size-3.5" />
                                {urlCopied ? '已复制' : '复制'}
                            </button>
                        </div>

                        <div
                            class="flex items-center gap-2 mt-3 text-xs font-mono text-(--theme-modal-text)/40 bg-[var(--theme-input-bg)] rounded-lg px-3 py-2"
                        >
                            <Icon icon="mdi:link-variant" class="size-3.5 shrink-0" />
                            <span class="truncate">{resolveUrl()}</span>
                        </div>

                        <div class="flex items-end justify-end gap-3 mt-4">
                            <div class="mr-auto flex items-center gap-2">
                                {#if hasIdParam(sel.path)}
                                    <div class="min-w-24 max-w-36">
                                        <input
                                            value={idVal}
                                            oninput={(e) => (idVal = (e.target as HTMLInputElement).value)}
                                            placeholder={inputPlaceholder}
                                            class="h-9 w-full px-3 rounded-lg bg-[var(--theme-input-bg)] border-[var(--theme-input-border)] text-xs text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30 outline-none transition-colors focus:border-indigo-500/50"
                                        />
                                    </div>
                                {/if}
                            </div>
                            <button
                                onclick={send}
                                disabled={loading}
                                class="h-9 px-5 rounded-lg bg-indigo-600 text-xs font-semibold text-white transition-all hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-2"
                            >
                                {#if loading}
                                    <div
                                        class="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin"
                                    ></div>
                                    发送中…
                                {:else}
                                    <Icon icon="mdi:send" class="size-3.5" />
                                    发送
                                {/if}
                            </button>
                        </div>
                    </div>
                {/if}

                <!-- Response Panel -->
                <div class="flex-1 min-h-0 rounded-xl border border-[var(--theme-card-border)] flex flex-col">
                    <div
                        class="flex items-center justify-between shrink-0 px-5 border-b border-[var(--theme-divider-border)]"
                    >
                        <div class="flex gap-0">
                            <button
                                onclick={() => (showType = true)}
                                class="relative h-10 px-1 text-xs font-medium transition-colors mr-4 {showType
                                    ? 'text-indigo-400'
                                    : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/60'}"
                            >
                                <Icon icon="mdi:code-tags" class="size-3.5 inline mr-1.5 align-text-bottom" />
                                Type
                                {#if showType}<div
                                        class="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-indigo-500"
                                    ></div>{/if}
                            </button>
                            <button
                                onclick={() => (showType = false)}
                                class="relative h-10 px-1 text-xs font-medium transition-colors {!showType
                                    ? 'text-indigo-400'
                                    : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/60'}"
                            >
                                <Icon icon="mdi:database-outline" class="size-3.5 inline mr-1.5 align-text-bottom" />
                                Data
                                {#if !showType}<div
                                        class="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-indigo-500"
                                    ></div>{/if}
                            </button>
                        </div>
                        <div class="flex items-center gap-1.5">
                            {#if showType && currentType}
                                <button
                                    onclick={copyType}
                                    class="h-7 px-2.5 rounded-lg border border-[var(--theme-card-border)] text-[11px] text-(--theme-modal-text)/50 transition-colors hover:bg-[var(--theme-card-bg-focused)] inline-flex items-center gap-1.5"
                                >
                                    <Icon icon={typeCopied ? 'mdi:check' : 'mdi:content-copy'} class="size-3" />
                                    {typeCopied ? '已复制' : '复制'}
                                </button>
                            {:else if !showType && res}
                                <button
                                    onclick={copyData}
                                    class="h-7 px-2.5 rounded-lg border border-[var(--theme-card-border)] text-[11px] text-(--theme-modal-text)/50 transition-colors hover:bg-[var(--theme-card-bg-focused)] inline-flex items-center gap-1.5"
                                >
                                    <Icon icon={dataCopied ? 'mdi:check' : 'mdi:content-copy'} class="size-3" />
                                    {dataCopied ? '已复制' : '复制'}
                                </button>
                                <button
                                    onclick={clearRes}
                                    class="h-7 px-2.5 rounded-lg border border-[var(--theme-card-border)] text-[11px] text-(--theme-modal-text)/50 transition-colors hover:bg-[var(--theme-card-bg-focused)] inline-flex items-center gap-1.5"
                                >
                                    <Icon icon="mdi:close" class="size-3" />
                                    清除
                                </button>
                            {/if}
                        </div>
                    </div>

                    <div class="flex-1 min-h-0 overflow-y-auto">
                        {#if showType}
                            {#if currentType}
                                <div class="flex items-center gap-2 px-5 pt-3 pb-1">
                                    <Icon icon="mdi:code-tags" class="size-3.5 text-indigo-400/70" />
                                    <span class="text-xs font-semibold text-(--theme-modal-text)/60"
                                        >{currentType.name}</span
                                    >
                                </div>
                                <pre
                                    class="p-5 overflow-x-auto text-sm leading-relaxed font-mono bg-black text-white"><code
                                        >{@html highlightedType}</code
                                    ></pre>
                            {:else}
                                <div
                                    class="flex flex-col items-center justify-center py-14 text-(--theme-modal-text)/40"
                                >
                                    <Icon icon="mdi:file-document-outline" class="size-7 mb-2" />
                                    <span class="text-sm font-medium">无类型定义</span>
                                </div>
                            {/if}
                        {:else}
                            {#if err}
                                <div class="p-5">
                                    <div class="flex items-center gap-2 text-sm font-semibold text-red-400 mb-2">
                                        <span class="size-5 rounded-full bg-red-500/20 flex items-center justify-center"
                                            ><Icon icon="mdi:alert-circle-outline" class="size-3.5" /></span
                                        >
                                        Error
                                    </div>
                                    <p
                                        class="text-xs text-red-300/70 font-mono whitespace-pre-wrap bg-red-500/5 rounded-lg px-3 py-2 border border-red-500/10"
                                    >
                                        {err}
                                    </p>
                                </div>
                            {:else if res}
                                <pre
                                    class="p-5 overflow-x-auto text-sm leading-relaxed font-mono bg-black text-white"><code
                                        >{@html highlightedRes}</code
                                    ></pre>
                            {:else}
                                <div
                                    class="flex flex-col items-center justify-center py-14 text-(--theme-modal-text)/40"
                                >
                                    <Icon icon="mdi:send-circle-outline" class="size-8 mb-2" />
                                    <span class="text-sm font-medium">暂无响应</span>
                                    <span class="text-xs mt-1">选择一个端点并发送请求</span>
                                </div>
                            {/if}
                        {/if}
                    </div>
                </div>
            </div>
        </main>
    </div>
</div>
