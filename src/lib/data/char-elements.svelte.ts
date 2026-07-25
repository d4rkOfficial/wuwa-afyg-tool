import { getCharacterInfo } from './api'

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
