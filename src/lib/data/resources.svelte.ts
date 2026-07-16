import { get, set, clear as clearDB } from './db'

const ASSET_BASE_URL = 'https://static.nanoka.cc/assets/ww'
const LIST_TTL = 24 * 60 * 60 * 1000

function toCDN(path: string): string {
    if (!path) return ''
    if (path.startsWith('http')) return path
    const stripped = path.replace('/Game/Aki/UI', '')
    const name = stripped.split('.')[0]
    return `${ASSET_BASE_URL}${name}.webp`
}

class ResourceManager {
    loading = $state<Record<string, boolean>>({})
    icons = $state<Record<string, string>>({})
    errors = $state<Record<string, string>>({})

    async getList<T = any>(type: string): Promise<T[]> {
        const key = `list:${type}`
        this.loading[key] = true

        try {
            const cached = await get<{ data: T[]; ts: number }>(key)
            if (cached && Date.now() - cached.ts < LIST_TTL) return cached.data

            const res = await fetch(`/api/v1/${type}-list`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data: T[] = await res.json()
            await set(key, { data, ts: Date.now() })
            return data
        } catch (e) {
            this.errors[key] = String(e)
            const stale = await get<{ data: T[]; ts: number }>(key)
            return stale?.data ?? []
        } finally {
            this.loading[key] = false
        }
    }

    async getIconMap(type: string): Promise<Record<string, string>> {
        const key = `icon-map:${type}`
        const cached = await get<{ data: Record<string, string>; ts: number }>(key)
        if (cached && Date.now() - cached.ts < LIST_TTL) return cached.data

        try {
            const res = await fetch(`/api/v1/${type}-icons`)
            if (!res.ok) return {}
            const pairs: [string, string][] = await res.json()
            const map: Record<string, string> = Object.fromEntries(pairs)
            await set(key, { data: map, ts: Date.now() })
            return map
        } catch {
            const stale = await get<{ data: Record<string, string>; ts: number }>(key)
            return stale?.data ?? {}
        }
    }

    async getIcon(rawPath: string): Promise<string> {
        if (!rawPath) return ''
        if (this.icons[rawPath]) return this.icons[rawPath]

        const cdnUrl = toCDN(rawPath)
        if (!cdnUrl) return ''

        const cacheKey = `img:${rawPath}`
        const cached = await get<string>(cacheKey)
        if (cached) {
            this.icons[rawPath] = cached
            return cached
        }

        try {
            const res = await fetch(cdnUrl)
            if (!res.ok) return ''
            const blob = await res.blob()
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onloadend = () => resolve(reader.result as string)
                reader.onerror = reject
                reader.readAsDataURL(blob)
            })
            await set(cacheKey, base64)
            this.icons[rawPath] = base64
            return base64
        } catch {
            return ''
        }
    }

    async getIconForName(type: string, name: string): Promise<string> {
        const map = await this.getIconMap(type)
        const path = map[name]
        if (!path) return ''
        return this.getIcon(path)
    }

    async loadIcons(paths: string[]): Promise<void> {
        const unique = [...new Set(paths.filter(Boolean))]
        await Promise.all(unique.map((p) => this.getIcon(p)))
    }

    async clearCache(): Promise<void> {
        await clearDB()
    }
}

export const resources = new ResourceManager()
