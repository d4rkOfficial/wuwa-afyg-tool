// ── nanoka 抓取 ───────────────────────────────────────────────────────────
// fetchData：拉取随版本变化的 `ww/{version}/` 下文件（列表、sonata 等）。
// fetchZhData：拉取中文详情 `ww/{version}/zh/...`。

import { getDataBase, ZH_DATA_BASE, ensureVersion } from './consts'

export const fetchData = async <T>(path: string): Promise<T> => {
    await ensureVersion()
    const res = await fetch(getDataBase() + path)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
}

export const fetchZhData = async <T>(path: string, version: string): Promise<T> => {
    const res = await fetch(`${ZH_DATA_BASE}/${version}/zh${path}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
}
