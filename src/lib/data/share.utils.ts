/**
 * @desc 分享链接与分享快照的纯计算层：链接格式、有效期判定、倒计时文案、本地持久化结果的解析。
 *
 * 全部无副作用（不碰 `location` / `localStorage`），状态与持久化留在 `share.svelte.ts`，
 * 便于测试直接断言链接编码与过期口径。
 */

/** @desc 分享有效期（与分享频率限制同一时长：10 分钟） */
export const SHARE_TTL_MS = 10 * 60 * 1000

/** @desc 一次成功分享的结果快照（弹窗展示与「冷却期内重开」共用） */
export interface ShareSnapshot {
    /** @desc 发起分享的工程 id */
    projectId: string
    /** @desc 工坊下载地址：两条分享链接都由它派生 */
    downloadUrl: string
    /** @desc 工具箱导入链接（`<origin>#import_project=<downloadUrl>`），在地址栏打开即导入工程 */
    toolLink: string
    /** @desc fast-calc 简表链接（`<origin>/fast-calc?import_project=<downloadUrl>`） */
    fastCalcLink: string
    /** @desc 分享创建时间（ms） */
    createdAt: number
    /** @desc 过期时间（ms）= createdAt + 有效期 */
    expiresAt: number
}

/** @desc 工具箱导入链接：hash 路由 `import_project` 只认可直接 fetch 的下载地址 */
export const shareToolLinkOf = (origin: string, downloadUrl: string): string =>
    `${origin}#import_project=${encodeURIComponent(downloadUrl)}`

/** @desc fast-calc 简表链接：`import_project` 同为可直接 fetch 的下载地址 */
export const shareFastCalcLinkOf = (origin: string, downloadUrl: string): string =>
    `${origin}/fast-calc?import_project=${encodeURIComponent(downloadUrl)}`

/** @desc 由下载地址与创建时间组装快照（两条链接、过期时间一次算好） */
export const buildShareSnapshot = (args: {
    projectId: string
    downloadUrl: string
    origin: string
    createdAt: number
    ttlMs?: number
}): ShareSnapshot => {
    const ttl = args.ttlMs ?? SHARE_TTL_MS
    return {
        projectId: args.projectId,
        downloadUrl: args.downloadUrl,
        toolLink: shareToolLinkOf(args.origin, args.downloadUrl),
        fastCalcLink: shareFastCalcLinkOf(args.origin, args.downloadUrl),
        createdAt: args.createdAt,
        expiresAt: args.createdAt + ttl
    }
}

/** @desc 是否已过期（到点即过期，用于弹窗自动关闭与「冷却内重开」判定） */
export const isShareSnapshotExpired = (snapshot: ShareSnapshot, now = Date.now()): boolean => snapshot.expiresAt <= now

/** @desc 剩余时间的 mm:ss 文案（向上取整到秒；已过期归零） */
export const formatShareCountdown = (ms: number): string => {
    const total = Math.max(0, Math.ceil(ms / 1000))
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** @desc 反序列化本地保存的快照：字段缺失或类型不符一律视为没有快照 */
export const parseShareSnapshot = (raw: string | null): ShareSnapshot | null => {
    if (!raw) return null
    let value: unknown
    try {
        value = JSON.parse(raw)
    } catch {
        return null
    }
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const strings = ['projectId', 'downloadUrl', 'toolLink', 'fastCalcLink'] as const
    for (const key of strings) {
        if (typeof record[key] !== 'string' || !record[key]) return null
    }
    const numbers = ['createdAt', 'expiresAt'] as const
    for (const key of numbers) {
        if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) return null
    }
    return {
        projectId: record.projectId as string,
        downloadUrl: record.downloadUrl as string,
        toolLink: record.toolLink as string,
        fastCalcLink: record.fastCalcLink as string,
        createdAt: record.createdAt as number,
        expiresAt: record.expiresAt as number
    }
}
