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
import type { DataProvider } from '../types'
import { fetchData, fetchZhData } from './fetch'
import { getWWVersion, ensureVersion, fetchLatestVersion, fetchAvailableVersions, resetVersionPromise } from './consts'
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
    findSonataSetEntry,
    ueToCdn
} from './utils'
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

async function getSonata(): Promise<NanokaSonata> {
    if (sonataCache) return sonataCache
    sonataCache = await fetchData<NanokaSonata>('/sonata.json')
    return sonataCache
}

function resetCaches() {
    sonataCache = null
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

export const nanokaProvider: DataProvider = {
    id: 'nanoka',
    label: 'Nanoka (nanoka.cc)',

    // ── 版本 ──
    getLatestVersion: async () => fetchLatestVersion(),
    getAvailableVersions: async () => fetchAvailableVersions(),

    // ── 列表 ──
    getCharacterList: async (): Promise<Character[]> =>
        transformCharacterList(await fetchData<Record<string, NanokaCharacter>>('/character.json')),
    getWeaponList: async (): Promise<Weapon[]> =>
        transformWeaponList(await fetchData<Record<string, NanokaWeapon>>('/weapon.json')),
    getEchoList: async (): Promise<Echo[]> => {
        const [echoData, sonata] = await Promise.all([fetchData<Record<string, NanokaEcho>>('/echo.json'), getSonata()])
        return transformEchoList(echoData, sonata)
    },
    getEchoSetList: async (): Promise<EchoSetItem[]> => transformEchoSetList(await getSonata()),

    // ── 图标 ──
    getCharacterIcons: async () => buildIconMap(await fetchData<Record<string, NanokaCharacter>>('/character.json')),
    getWeaponIcons: async () => buildIconMap(await fetchData<Record<string, NanokaWeapon>>('/weapon.json')),
    getEchoIcons: async () => buildIconMap(await fetchData<Record<string, NanokaEcho>>('/echo.json')),
    getEchoSetIcons: async () => {
        const sonata = await getSonata()
        const map: Record<string, string> = {}
        for (const s of Object.values(sonata)) {
            if (s.name?.zh && s.icon) map[s.name.zh] = ueToCdn(s.icon)
        }
        return map
    },

    // ── 详情 ──
    getCharacterInfo: async (name: string, opts?: { rich?: boolean }): Promise<CharacterInfo> => {
        const list = await fetchData<Record<string, NanokaCharacter>>('/character.json')
        const found = findEntryByName(list, name)
        if (!found) throw new Error('Character not found')
        await ensureVersion()
        const data = await fetchZhData<ZhCharacterDetail>(`/character/${found[0]}.json`, getWWVersion())
        return opts?.rich ? transformCharacterInfoRich(data) : transformCharacterInfo(data)
    },
    getWeaponInfo: async (name: string): Promise<WeaponInfo> => {
        const list = await fetchData<Record<string, NanokaWeapon>>('/weapon.json')
        const found = findEntryByName(list, name)
        if (!found) throw new Error('Weapon not found')
        await ensureVersion()
        const data = await fetchZhData<ZhWeaponDetail>(`/weapon/${found[0]}.json`, getWWVersion())
        return transformWeaponInfo(data)
    },
    getEchoInfo: async (name: string): Promise<EchoInfo> => {
        const list = await fetchData<Record<string, NanokaEcho>>('/echo.json')
        const found = findEntryByName(list, name)
        if (!found) throw new Error('Echo not found')
        await ensureVersion()
        const data = await fetchZhData<ZhEchoDetail>(`/echo/${found[0]}.json`, getWWVersion())
        return transformEchoInfo(data, found[1].intensity)
    },
    getEchoSetInfo: async (name: string): Promise<EchoSetInfo> => {
        await ensureVersion()
        const data = await fetchZhData<ZhSonataDetail>('/sonata.json', getWWVersion())
        const found = findSonataSetEntry(data, name)
        if (!found) throw new Error('Set not found')
        const result = transformEchoSetInfo(data, found[0])
        if (!result) throw new Error('Set not found')
        return result
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
