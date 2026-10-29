// ── nanoka 数据适配器 ─────────────────────────────────────────────────────
// 实现 DataProvider，封装 nanoka.cc 上游的抓取与转换。应用其它层通过
// $lib/api/provider 的 getProvider() 获得本实例，而不直接接触 nanoka。

import type {
    Character,
    CharacterInfo,
    Echo,
    EchoInfo,
    EchoSetInfo,
    EchoSetItem,
    Weapon,
    WeaponInfo
} from '$lib/api/types'
import type { DataProvider, InfoOptions, LangOptions } from '../types'
import { fetchData, fetchDetailPair, fetchZhData } from './fetch'
import {
    ASSET_BASE,
    getWWVersion,
    ensureVersion,
    fetchLatestVersion,
    fetchAvailableVersions,
    resetVersionPromise
} from './consts'
import {
    transformCharacterList,
    transformWeaponList,
    transformEchoList,
    transformEchoSetList,
    transformCharacterInfo,
    transformCharacterInfoRich,
    transformWeaponInfo,
    transformEchoInfo,
    transformEchoSetInfo,
    findEntryByName,
    findSonataListEntry,
    ueToCdn,
    iconKey,
    ECHO_PLACEHOLDER_NAMES,
    extractEchoNameFromSkill
} from './utils'
import {
    localizeCharacterInfo,
    localizeCharacterList,
    localizeEchoInfo,
    localizeEchoSetInfo,
    localizeWeaponInfo,
    localizeWeaponList
} from './i18n'
import type {
    NanokaCharacter,
    NanokaWeapon,
    NanokaEcho,
    NanokaSonata,
    ZhCharacterDetail,
    ZhWeaponDetail,
    ZhEchoDetail,
    ZhSonataDetail
} from './types'

let sonataCache: NanokaSonata | null = null
let tagIconsCache: Record<string, string> | null = null
let tagIconsPromise: Promise<Record<string, string>> | null = null

async function getSonata(): Promise<NanokaSonata> {
    if (sonataCache) return sonataCache
    sonataCache = await fetchData<NanokaSonata>('/sonata.json')
    return sonataCache
}

/**
 * @desc 扫描全部角色详情，汇总 tag 短标识 → 图标 URL。
 * 上游没有独立 tag 索引文件；tag 图标只存在于角色详情的 `tag[].icon` 路径里。
 * 结果按实例缓存，并用同一个 in-flight Promise 合并并发请求，版本切换时由 resetCaches 清空。
 */
async function getTagIcons(): Promise<Record<string, string>> {
    if (tagIconsCache) return tagIconsCache
    if (!tagIconsPromise) {
        tagIconsPromise = scanTagIcons()
            .then((map) => {
                tagIconsCache = map
                return map
            })
            .finally(() => {
                tagIconsPromise = null
            })
    }
    return tagIconsPromise
}

async function scanTagIcons(): Promise<Record<string, string>> {
    const list = await fetchData<Record<string, unknown>>('/character.json')
    await ensureVersion()
    const version = getWWVersion()
    const ids = Object.keys(list)
    const map: Record<string, string> = {}
    const batchSize = 32
    for (let start = 0; start < ids.length; start += batchSize) {
        const details = await Promise.all(
            ids
                .slice(start, start + batchSize)
                .map((id) => fetchZhData<ZhCharacterDetail>(`/character/${id}.json`, version).catch(() => null))
        )
        for (const detail of details) {
            for (const tag of Object.values(detail?.tag ?? {})) {
                const key = iconKey(tag.icon ?? '')
                if (key && !map[key]) map[key] = `${ASSET_BASE}/UIResources/Common/Atlas/RoleLabel/${key}.webp`
            }
        }
    }
    return map
}

function resetCaches() {
    sonataCache = null
    tagIconsCache = null
    tagIconsPromise = null
    resetVersionPromise()
}

async function buildIconMap<T extends { zh: string; icon: string }>(
    data: Record<string, T>
): Promise<Record<string, string>> {
    const map: Record<string, string> = {}
    for (const v of Object.values(data)) {
        if (v.zh && v.icon) map[v.zh] = ueToCdn(v.icon)
    }
    return map
}

/**
 * @desc 解析占位名声骸（如「敬请期待」）：拉取详情，从技能文案「召唤XXX」提取真实名称写回 zh。
 * 上游多个新声骸共用占位名，若不去重前解析会被 transformEchoList 按名称合并成一条。
 * 提取不到时回退为「占位名·id」以保证唯一。占位名与文案解析规则只适用于中文，
 * 其它语言直接返回原始数据（不做该修复）。
 */
async function withResolvedEchoNames(
    data: Record<string, NanokaEcho>,
    lang = 'zh'
): Promise<Record<string, NanokaEcho>> {
    if (lang !== 'zh') return data
    const placeholders = Object.entries(data).filter(([, e]) => e.zh && ECHO_PLACEHOLDER_NAMES.has(e.zh))
    if (placeholders.length === 0) return data
    await ensureVersion()
    const patched = { ...data }
    await Promise.all(
        placeholders.map(async ([id]) => {
            let name: string | null = null
            try {
                const detail = await fetchZhData<ZhEchoDetail>(`/echo/${id}.json`, getWWVersion())
                name = extractEchoNameFromSkill(detail.skill?.desc)
            } catch {
                /* 拉取失败 → 回退为 id 区分 */
            }
            patched[id] = { ...patched[id], zh: name ?? `${patched[id].zh}·${id}` }
        })
    )
    return patched
}

export const nanokaProvider: DataProvider = {
    id: 'nanoka',
    label: 'Nanoka (nanoka.cc)',

    // ── 版本 ──
    getLatestVersion: async () => fetchLatestVersion(),
    getAvailableVersions: async () => fetchAvailableVersions(),

    // ── 列表 ──
    getCharacterList: async (opts?: LangOptions): Promise<Character[]> => {
        const data = await fetchData<Record<string, NanokaCharacter>>('/character.json')
        return localizeCharacterList(transformCharacterList(data, opts?.lang), opts?.lang ?? 'zh')
    },
    getWeaponList: async (opts?: LangOptions): Promise<Weapon[]> => {
        const data = await fetchData<Record<string, NanokaWeapon>>('/weapon.json')
        return localizeWeaponList(transformWeaponList(data, opts?.lang), opts?.lang ?? 'zh')
    },
    getEchoList: async (opts?: LangOptions): Promise<Echo[]> => {
        const [echoData, sonata] = await Promise.all([fetchData<Record<string, NanokaEcho>>('/echo.json'), getSonata()])
        return transformEchoList(await withResolvedEchoNames(echoData, opts?.lang), sonata, opts?.lang)
    },
    getEchoSetList: async (opts?: LangOptions): Promise<EchoSetItem[]> =>
        transformEchoSetList(await getSonata(), opts?.lang),

    // ── 图标 ──
    getCharacterIcons: async () => buildIconMap(await fetchData<Record<string, NanokaCharacter>>('/character.json')),
    getWeaponIcons: async () => buildIconMap(await fetchData<Record<string, NanokaWeapon>>('/weapon.json')),
    getEchoIcons: async () =>
        buildIconMap(await withResolvedEchoNames(await fetchData<Record<string, NanokaEcho>>('/echo.json'))),
    getEchoSetIcons: async () => {
        const sonata = await getSonata()
        const map: Record<string, string> = {}
        for (const s of Object.values(sonata)) {
            if (s.name?.zh && s.icon) map[s.name.zh] = ueToCdn(s.icon)
        }
        return map
    },
    // 角色 tag 图标：扫描角色详情汇总短标识 → 上游图标 URL
    getTagIcons,

    // ── 详情 ──
    getCharacterInfo: async (name: string, opts?: InfoOptions): Promise<CharacterInfo> => {
        const list = await fetchData<Record<string, NanokaCharacter>>('/character.json')
        const found = findEntryByName(list, name, opts?.lang)
        if (!found) throw new Error('Character not found')
        // 中文详情负责计算，目标语言详情只覆盖展示文本
        const pair = await fetchDetailPair<ZhCharacterDetail>(`/character/${found[0]}.json`, opts?.lang)
        const info = opts?.rich ? transformCharacterInfoRich(pair.base) : transformCharacterInfo(pair.base)
        return localizeCharacterInfo(info, pair.base, pair.localized, pair.lang, opts?.rich ?? false)
    },
    getWeaponInfo: async (name: string, opts?: LangOptions): Promise<WeaponInfo> => {
        const list = await fetchData<Record<string, NanokaWeapon>>('/weapon.json')
        const found = findEntryByName(list, name, opts?.lang)
        if (!found) throw new Error('Weapon not found')
        const pair = await fetchDetailPair<ZhWeaponDetail>(`/weapon/${found[0]}.json`, opts?.lang)
        const info = transformWeaponInfo(pair.base)
        return localizeWeaponInfo(info, pair.localized, pair.lang)
    },
    getEchoInfo: async (name: string, opts?: LangOptions): Promise<EchoInfo> => {
        const list = await withResolvedEchoNames(await fetchData<Record<string, NanokaEcho>>('/echo.json'), opts?.lang)
        const found = findEntryByName(list, name, opts?.lang)
        if (!found) throw new Error('Echo not found')
        const pair = await fetchDetailPair<ZhEchoDetail>(`/echo/${found[0]}.json`, opts?.lang)
        const info = transformEchoInfo(pair.base, found[1].intensity)
        return localizeEchoInfo(info, pair.base, pair.localized, pair.lang)
    },
    getEchoSetInfo: async (name: string, opts?: LangOptions): Promise<EchoSetInfo> => {
        // 列表包含全部语言名，先用它把任一种语言的名字定位到套装 id，
        // 再用中文详情计算、目标语言详情覆盖文案。
        const list = await getSonata()
        const found = findSonataListEntry(list, name, opts?.lang)
        if (!found) throw new Error('Set not found')
        const pair = await fetchDetailPair<ZhSonataDetail>('/sonata.json', opts?.lang)
        const info = transformEchoSetInfo(pair.base, found[0])
        if (!info) throw new Error('Set not found')
        return localizeEchoSetInfo(info, found[0], pair.base, pair.localized, pair.lang)
    },

    // ── 推荐武器 ──
    getRecommendedWeapons: async (characterName: string): Promise<string[]> => {
        await ensureVersion()
        const version = getWWVersion()
        const charList = await fetchData<Record<string, NanokaCharacter>>('/character.json')
        const found = findEntryByName(charList, characterName)
        if (!found) throw new Error('Character not found')
        const charData = await fetchZhData<ZhCharacterDetail>(`/character/${found[0]}.json`, version)

        const weaponData = await fetchData<Record<string, NanokaWeapon>>('/weapon.json')
        const weaponIdToName: Record<number, string> = {}
        for (const [id, w] of Object.entries(weaponData)) {
            if (w.zh) weaponIdToName[Number(id)] = w.zh
        }

        const recommendedWeapons: string[] = []
        if (charData.recommend?.weapon) {
            for (const wid of charData.recommend.weapon) {
                const name = weaponIdToName[wid]
                if (name) recommendedWeapons.push(name)
            }
        }
        return recommendedWeapons
    }
}

// 暴露 reset 便于测试/换版本时清理内部缓存（应用层一般不需要直接调用）。
export { resetCaches as resetNanokaCaches }
