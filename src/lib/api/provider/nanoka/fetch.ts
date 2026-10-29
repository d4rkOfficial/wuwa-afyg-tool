// ── nanoka 抓取 ───────────────────────────────────────────────────────────
// fetchData：拉取随版本变化的 `ww/{version}/` 下文件（列表、sonata 等）。
// fetchZhData：拉取中文详情 `ww/{version}/zh/...`。
// fetchDetailPair：中文详情（计算基准）+ 目标语言详情（翻译数据），语言不存在时回退中文。

import { getDataBase, getWWVersion, ZH_DATA_BASE, ensureVersion } from './consts'

const fetchJson = async <T>(url: string): Promise<T> => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
}

export const fetchData = async <T>(path: string): Promise<T> => {
    await ensureVersion()
    return fetchJson<T>(getDataBase() + path)
}

export const fetchZhData = async <T>(path: string, version: string): Promise<T> =>
    fetchJson<T>(`${ZH_DATA_BASE}/${version}/zh${path}`)

export interface DetailPair<T> {
    /** 中文详情：所有数值与结构计算都以它为准 */
    base: T
    /** 目标语言详情：仅用于覆盖展示文本；回退中文时与 base 相同 */
    localized: T
    /** 实际生效的语言（目标语言不可用时为 zh） */
    lang: string
}

export const fetchDetailPair = async <T>(path: string, lang?: string): Promise<DetailPair<T>> => {
    await ensureVersion()
    const version = getWWVersion()
    const target = lang && lang !== 'zh' ? lang : 'zh'
    const [base, localized] = await Promise.all([
        fetchZhData<T>(path, version),
        target === 'zh'
            ? Promise.resolve<T | null>(null)
            : fetchJson<T>(`${ZH_DATA_BASE}/${version}/${target}${path}`).catch(() => null)
    ])
    /* 上游无此语言（目录/文件 404）→ 回退中文 */
    return localized ? { base, localized, lang: target } : { base, localized: base, lang: 'zh' }
}
