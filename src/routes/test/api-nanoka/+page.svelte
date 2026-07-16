<script lang="ts">
    import TestApiLayout from '$lib/components/shared/TestApiLayout.svelte'
    import { browser } from '$app/environment'
    import { NANOKA_BASE } from './consts'

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

    // svelte-ignore state_referenced_locally
    let sel = $state<Endpoint | null>(data.endpointGroups[0]?.endpoints[0] ?? null)
    let version = $state('')
    let idVal = $state('')
    let res = $state('')
    let loading = $state(false)
    let err = $state('')
    let showType = $state(true)
    let urlCopied = $state(false)
    let copiedType = $state(false)
    let copiedData = $state(false)
    let stash = $state<Record<string, { res: string; err: string }>>({})

    let currentType = $derived(sel ? (data.typeMap[sel.path] ?? null) : null)

    let hasVersion = $derived(sel?.path.includes('{version}') ?? false)
    let hasId = $derived(sel?.path.includes('{id}') ?? false)

    const pick = (e: Endpoint) => {
        if (sel) stash[sel.path] = { res, err }
        sel = e
        idVal = ''
        const saved = stash[e.path]
        res = saved?.res ?? ''
        err = saved?.err ?? ''
    }

    const buildFullUrl = (): string => {
        if (!sel) return ''
        let p = sel.path
        if (version) p = p.replace(/\{version\}/g, version)
        if (idVal) p = p.replace(/\{id\}/g, idVal)
        return `${NANOKA_BASE}${p}`
    }

    const send = async () => {
        if (!sel || !browser) return
        loading = true
        err = ''
        res = ''
        showType = false
        try {
            const r = await fetch(buildFullUrl())
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
        await navigator.clipboard.writeText(buildFullUrl())
        urlCopied = true
        setTimeout(() => (urlCopied = false), 1500)
    }

    const resolveUrl = (): string => buildFullUrl()
</script>

<TestApiLayout
    title="nanoka.cc"
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
    hasVersionParam={hasVersion}
    versionValue={version}
    onVersionChange={(v) => (version = v)}
    hasIdParam={hasId}
    idValue={idVal}
    onIdChange={(v) => (idVal = v)}
/>
