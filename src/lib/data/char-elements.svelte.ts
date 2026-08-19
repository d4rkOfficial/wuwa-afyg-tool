import { getCharacterInfo } from '$lib/api/data-cache'

let _charElementMap = $state<Record<string, string>>(loadCache())

function loadCache(): Record<string, string> {
    try {
        return JSON.parse(localStorage.getItem('wuwa-char-elements') ?? '{}')
    } catch {
        return {}
    }
}

function saveCache(map: Record<string, string>) {
    try {
        localStorage.setItem('wuwa-char-elements', JSON.stringify(map))
    } catch {}
}

export function getCharElementMap(): Record<string, string> {
    return _charElementMap
}

export function setCharElements(entries: Record<string, string>) {
    _charElementMap = { ..._charElementMap, ...entries }
    saveCache(_charElementMap)
}

export async function preloadCharElements(names: string[]) {
    const missing = names.filter((n) => n && !_charElementMap[n])
    if (missing.length === 0) return
    const results = await Promise.allSettled(missing.map((n) => getCharacterInfo(n)))
    const entries: Record<string, string> = {}
    for (let i = 0; i < missing.length; i++) {
        const r = results[i]
        if (r.status === 'fulfilled') {
            entries[missing[i]] = r.value.element
        }
    }
    if (Object.keys(entries).length > 0) {
        setCharElements(entries)
    }
}

let _pendingEnsure: Promise<void> | null = null

/** @desc 确保指定角色已写入元素图（缺失则经 data-cache 抓取，data-cache 内部按 URL 去重在途请求）；返回时元素图已尽力包含这些角色的元素 */
export async function ensureCharElements(names: string[]): Promise<void> {
    for (let round = 0; round < 2; round++) {
        const missing = names.filter((n) => n && !_charElementMap[n])
        if (missing.length === 0) return
        // 首轮先搭上同队/同批在途抓取（与排轴页 loadCharElements 共用同一 data-cache 请求）
        if (round === 0 && _pendingEnsure) {
            await _pendingEnsure.catch(() => {})
            continue
        }
        const targets = [...new Set(missing)]
        _pendingEnsure = (async () => {
            const results = await Promise.allSettled(targets.map((n) => getCharacterInfo(n)))
            const entries: Record<string, string> = {}
            for (let i = 0; i < targets.length; i++) {
                const r = results[i]
                if (r.status === 'fulfilled') entries[targets[i]] = r.value.element
            }
            if (Object.keys(entries).length > 0) setCharElements(entries)
        })()
        try {
            await _pendingEnsure
        } finally {
            _pendingEnsure = null
        }
    }
}
