import { getDataBase, ZH_DATA_BASE, ensureVersion } from './consts'

export const fetchData = async <T>(path: string): Promise<T> => {
    await ensureVersion()
    const res = await fetch(getDataBase() + path)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.json()
}

export const fetchZhData = async <T>(path: string, version: string): Promise<T> => {
    const res = await fetch(`${ZH_DATA_BASE}/${version}/zh${path}`)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.json()
}

export const createJsonResponse = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...extraHeaders }
    })
