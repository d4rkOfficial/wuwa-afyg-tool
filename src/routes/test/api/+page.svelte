<script lang="ts">
    import TestApiLayout from '$lib/components/shared/TestApiLayout.svelte'
    import { browser } from '$app/environment'

    interface Endpoint {
        method: string
        path: string
        summary?: string
    }

    interface Props {
        data: {
            endpointGroups: { name: string; endpoints: Endpoint[] }[]
            typeMap: Record<string, { name: string; code: string }>
        }
    }

    let { data }: Props = $props()

    const DEFAULTS: Record<string, string> = {
        '/api/v1/character-info/{name}': '散华',
        '/api/v1/weapon-info/{name}': '裁竹',
        '/api/v1/echo-info/{name}': '无常凶鹭',
        '/api/v1/echo-set-info/{name}': '轻云出月'
    }

    // svelte-ignore state_referenced_locally
    let sel = $state<Endpoint | null>(data.endpointGroups[0]?.endpoints[0] ?? null)
    // svelte-ignore state_referenced_locally
    let idVal = $state(sel ? (DEFAULTS[sel.path] ?? '') : '')
    let res = $state('')
    let loading = $state(false)
    let err = $state('')
    let showType = $state(true)
    let urlCopied = $state(false)
    let copiedType = $state(false)
    let copiedData = $state(false)
    let stash = $state<Record<string, { res: string; err: string }>>({})
    let origin = $state('')

    $effect(() => {
        if (browser) origin = location.origin
    })

    let currentType = $derived(sel ? (data.typeMap[sel.path] ?? null) : null)
    let inputPlaceholder = $derived(sel?.path.includes('{names}') ? 'names' : '中文名')

    const pick = (e: Endpoint) => {
        if (sel) stash[sel.path] = { res, err }
        sel = e
        idVal = DEFAULTS[e.path] ?? ''
        const saved = stash[e.path]
        res = saved?.res ?? ''
        err = saved?.err ?? ''
    }

    const handleId = (v: string) => {
        idVal = v
    }

    const send = async () => {
        if (!sel || !browser) return
        loading = true
        err = ''
        res = ''
        showType = false
        try {
            let p = sel.path
            if (idVal) {
                p = p
                    .replace('{seasonId}', idVal)
                    .replace('{id}', idVal)
                    .replace('{names}', idVal)
                    .replace('{name}', idVal)
            }
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

    const clearRes = () => {
        res = ''
        err = ''
        if (sel) stash[sel.path] = { res: '', err: '' }
    }

    const copyType = async () => {
        if (!currentType) return
        await navigator.clipboard.writeText(currentType.code)
        copiedType = true
        setTimeout(() => (copiedType = false), 1500)
    }

    const copyData = async () => {
        if (!res) return
        await navigator.clipboard.writeText(res)
        copiedData = true
        setTimeout(() => (copiedData = false), 1500)
    }

    const copyUrl = async () => {
        await navigator.clipboard.writeText(resolveUrl())
        urlCopied = true
        setTimeout(() => (urlCopied = false), 1500)
    }

    const resolveUrl = (): string => {
        if (!sel) return ''
        let p = sel.path
        if (idVal)
            p = p.replace('{seasonId}', idVal).replace('{id}', idVal).replace('{names}', idVal).replace('{name}', idVal)
        return origin + p
    }
</script>

<TestApiLayout
    title="鸣潮椰果工具箱 API"
    endpointGroups={data.endpointGroups}
    selected={sel}
    onSelect={pick}
    onSend={send}
    onCopyUrl={copyUrl}
    onCopyData={copyData}
    onCopyType={copyType}
    onClear={clearRes}
    url={resolveUrl()}
    response={res}
    error={err}
    {loading}
    {showType}
    onToggleType={(v) => (showType = v)}
    {urlCopied}
    dataCopied={copiedData}
    typeCopied={copiedType}
    typeInfo={currentType}
    hasIdParam={sel
        ? sel.path.includes('{seasonId}') ||
          sel.path.includes('{id}') ||
          sel.path.includes('{names}') ||
          sel.path.includes('{name}')
        : false}
    idValue={idVal}
    onIdChange={handleId}
    idPlaceholder={inputPlaceholder}
/>

<style>
    :global(.card-bg) {
        background-color: oklch(0.15 0 0);
    }
</style>
