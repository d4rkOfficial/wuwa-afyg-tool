import { getCharacterInfo, getCharacterList } from '$lib/api/data-cache'
import { STATIC_CHAR_ELEMENTS } from '$lib/consts/char-elements-static'

/**
 * @desc 角色元素图（唯一数据源）。
 * 首帧 = 静态表 + 本地缓存，保证任何角色（含工坊预览、导入工程里不在配队中的角色）立刻有颜色；
 * 运行期再用名录/详情接口的结果覆盖更新。
 */
let _charElementMap = $state<Record<string, string>>({ ...STATIC_CHAR_ELEMENTS, ...loadCache() })

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

/**
 * @desc 用「角色名录」一次性补全缺失角色的元素（名录走 data-cache 长期缓存，整表只需一次请求）。
 * 用于展示**不在当前工程配队**里的角色（如工坊社区工程预览、导入的外部工程），
 * 这类角色没被排轴页预热过，逐条查详情既慢又可能失败。
 */
export async function fillCharElementsFromList(names: string[]): Promise<void> {
    const missing = [...new Set(names.filter((n) => n && !_charElementMap[n]))]
    if (missing.length === 0) return
    try {
        const list = await getCharacterList()
        const byName = new Map(list.map((c) => [c.name, c.element]))
        const entries: Record<string, string> = {}
        for (const name of missing) {
            const element = byName.get(name)
            if (element) entries[name] = element
        }
        if (Object.keys(entries).length > 0) setCharElements(entries)
    } catch {
        /* 名录拉取失败：保持灰色兜底，不阻塞渲染 */
    }
}

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
    // 详情接口拿不到（或角色不在当前工程预热范围内）时，用名录兜底补全，避免角标退化灰色
    await fillCharElementsFromList(names)
}
