import { browser } from '$app/environment'

/** 分享服务基地址（独立于数据上游） */
export const SHARE_BASE = 'https://wuwa-afyg-share.200503.xyz'

export const CACHE_CONTROL = 'public, s-maxage=600, stale-while-revalidate=86400'

/** PWA 运行时缓存数据上游 CDN 图片/静态资源的 Cache Storage 名称 */
export const DATA_CDN_CACHE_NAME = 'data-cdn'

export { ELEMENT_MAP, WEAPON_TYPE_MAP, COST_MAP } from '$lib/consts/game-terms'

// 上游选择键（provider/index.ts 实际使用；此处不声明实现，避免与适配器模块耦合）
