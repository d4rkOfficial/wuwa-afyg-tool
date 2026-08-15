// ── 共享 DataProvider 契约测试 ────────────────────────────────────────────
// 对所有上游适配器生效的结构校验：返回的规范化契约字段必须齐全、类型正确、
// 关键字符串非空。各 provider 的测试文件负责喂入各自的 mock fetch 样本，
// 再调用 runContractTests(provider) 跑同一套断言，保证换源不破坏规范契约。
//
// 注意：这里只做结构/类型/非空断言，不做具体取值断言（那些属于各 provider
// 自己的快照测试），因此对新上游同样适用。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { DataProvider } from '$lib/api/provider/types'

function isNonEmptyString(v: unknown): boolean {
    return typeof v === 'string' && v.length > 0
}

export function runContractTests(provider: DataProvider): void {
    describe('DataProvider contract: ' + provider.id, () => {
        it('exposes id and label', () => {
            assert.ok(isNonEmptyString(provider.id))
            assert.ok(isNonEmptyString(provider.label))
        })

        it('getCharacterList returns valid Character[]', async () => {
            const list = await provider.getCharacterList()
            assert.ok(Array.isArray(list) && list.length > 0)
            for (const c of list) {
                assert.ok(isNonEmptyString(c.name), 'character name')
                assert.equal(typeof c.star, 'number')
                assert.ok(isNonEmptyString(c.element), 'character element')
                assert.ok(isNonEmptyString(c.weaponType), 'character weaponType')
            }
        })

        it('getWeaponList returns valid Weapon[]', async () => {
            const list = await provider.getWeaponList()
            assert.ok(Array.isArray(list) && list.length > 0)
            for (const w of list) {
                assert.ok(isNonEmptyString(w.name), 'weapon name')
                assert.equal(typeof w.star, 'number')
                assert.ok(isNonEmptyString(w.weaponType), 'weapon weaponType')
            }
        })

        it('getEchoList returns valid Echo[]', async () => {
            const list = await provider.getEchoList()
            assert.ok(Array.isArray(list) && list.length > 0)
            for (const e of list) {
                assert.ok(isNonEmptyString(e.name), 'echo name')
                assert.ok(Array.isArray(e.sets), 'echo sets array')
                assert.equal(typeof e.cost, 'number')
            }
        })

        it('getEchoSetList returns valid EchoSetItem[]', async () => {
            const list = await provider.getEchoSetList()
            assert.ok(Array.isArray(list) && list.length > 0)
            for (const s of list) {
                assert.ok(isNonEmptyString(s.name), 'set name')
                // pieces 为数组即可（部分上游目录不提供件数明细，允许为空）
                assert.ok(Array.isArray(s.pieces), 'set pieces array')
            }
        })

        it('getCharacterInfo returns a complete CharacterInfo', async () => {
            const list = await provider.getCharacterList()
            const info = await provider.getCharacterInfo(list[0].name, { rich: true })
            assert.equal(typeof info.rarity, 'number')
            assert.ok(isNonEmptyString(info.element), 'info element')
            assert.ok(isNonEmptyString(info.weaponType), 'info weaponType')
            assert.equal(typeof info.lv90BaseStats.hp, 'number')
            assert.equal(typeof info.lv90BaseStats.atk, 'number')
            assert.equal(typeof info.lv90BaseStats.def, 'number')
            assert.ok(Array.isArray(info.skills), 'skills array')
            assert.ok(Array.isArray(info.statNodes), 'statNodes array')
            assert.ok(Array.isArray(info.chains), 'chains array')
            for (const s of info.skills) {
                assert.ok(isNonEmptyString(s.name), 'skill name')
                assert.ok(Array.isArray(s.values), 'skill values')
            }
        })

        it('getWeaponInfo returns a complete WeaponInfo', async () => {
            const list = await provider.getWeaponList()
            const info = await provider.getWeaponInfo(list[0].name)
            assert.equal(typeof info.rarity, 'number')
            assert.ok(isNonEmptyString(info.type), 'weapon type')
            assert.equal(typeof info.lv90BaseAtk, 'number')
            assert.ok(isNonEmptyString(info.substat.name), 'substat name')
            assert.ok(isNonEmptyString(info.substat.value), 'substat value')
            assert.ok(isNonEmptyString(info.effect.name), 'effect name')
        })

        it('getEchoInfo returns a complete EchoInfo', async () => {
            const list = await provider.getEchoList()
            const info = await provider.getEchoInfo(list[0].name)
            assert.equal(typeof info.cost, 'number')
            assert.ok(isNonEmptyString(info.skill.desc), 'echo skill desc')
            assert.ok(Array.isArray(info.skill.values), 'echo skill values')
            assert.ok(Array.isArray(info.groups), 'echo groups')
        })

        it('getEchoSetInfo returns bonuses for the first set', async () => {
            const list = await provider.getEchoSetList()
            const info = await provider.getEchoSetInfo(list[0].name)
            assert.ok(info && typeof info === 'object')
            for (const v of Object.values(info.bonuses)) {
                assert.ok(isNonEmptyString(v), 'set bonus desc')
            }
        })

        it('icon maps return name→URL', async () => {
            // character/weapon/echo 图标必须非空；套装图标为可选（部分上游无套装级图标）
            for (const fn of [provider.getCharacterIcons, provider.getWeaponIcons, provider.getEchoIcons] as const) {
                const map = await fn()
                assert.ok(Object.keys(map).length > 0, 'icon map non-empty')
                for (const [name, url] of Object.entries(map)) {
                    assert.ok(isNonEmptyString(name), 'icon name')
                    assert.ok(isNonEmptyString(url), 'icon url')
                    assert.ok(/^(https?:|\/)/.test(url), `icon url looks like a URL: ${url}`)
                }
            }
            const setIcons = await provider.getEchoSetIcons()
            if (Object.keys(setIcons).length > 0) {
                for (const [name, url] of Object.entries(setIcons)) {
                    assert.ok(isNonEmptyString(name), 'set icon name')
                    assert.ok(isNonEmptyString(url), 'set icon url')
                }
            }
        })

        it('getRecommendedWeapons returns an array of names', async () => {
            const list = await provider.getCharacterList()
            const recs = await provider.getRecommendedWeapons(list[0].name)
            assert.ok(Array.isArray(recs))
            for (const r of recs) assert.ok(isNonEmptyString(r))
        })

        it('getLatestVersion and getAvailableVersions return strings', async () => {
            const latest = await provider.getLatestVersion()
            assert.ok(isNonEmptyString(latest))
            const avail = await provider.getAvailableVersions()
            assert.ok(Array.isArray(avail) && avail.length > 0)
            assert.ok(avail.every(isNonEmptyString))
        })
    })
}
