// ── nanoka provider 方法级 + 契约测试（node:test） ────────────────────────
// mock 全局 fetch 喂入 nanoka 样本，驱动 nanokaProvider 高层方法，并跑共享
// 契约套件。整体放入 describe 并用套件作用域内安装 fetch mock，避免与同进程
// 其它 provider 测试相互泄漏全局 fetch。

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { nanokaProvider } from '$lib/api/provider/nanoka/index'
import { runContractTests } from './contract-test.ts'
import {
    characterList,
    weaponList,
    echoList,
    sonata,
    characterDetail,
    characterDetailEn,
    weaponDetail,
    echoDetail,
    sonataDetail
} from './nanoka/__fixtures__.ts'

// ── fetch mock ──

const ROUTES: Array<[matcher: RegExp, factory: () => unknown]> = [
    [/manifest\.json$/, () => ({ ww: { latest: '3.5', available: ['3.5'] } })],
    // 语言详情路径优先于同名的列表路径（/ww/{v}/{lang}/… 才匹配）
    [/\/ww\/.+\/en\/character\/.+\.json$/, () => characterDetailEn],
    [/\/ww\/.+\/zh\/sonata\.json$/, () => sonataDetail],
    [/\/ww\/.+\/zh\/character\/.+\.json$/, () => characterDetail],
    [/\/ww\/.+\/zh\/weapon\/.+\.json$/, () => weaponDetail],
    [/\/ww\/.+\/zh\/echo\/.+\.json$/, () => echoDetail],
    [/\/ww\/.+\/character\.json$/, () => characterList],
    [/\/ww\/.+\/weapon\.json$/, () => weaponList],
    [/\/ww\/.+\/echo\.json$/, () => echoList],
    [/\/ww\/.+\/sonata\.json$/, () => sonata]
]

const realFetch = globalThis.fetch

describe('nanoka provider', () => {
    beforeEach(() => {
        globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
            const url = String(input)
            for (const [matcher, factory] of ROUTES) {
                if (matcher.test(url)) {
                    return new Response(JSON.stringify(factory()), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    })
                }
            }
            throw new Error('Unhandled fetch URL in test: ' + url)
        }
    })

    afterEach(() => {
        globalThis.fetch = realFetch
    })

    // 共享契约套件
    runContractTests(nanokaProvider)

    // ── 装配/图标具体断言 ──

    it('getCharacterIcons maps zh name → CDN webp URL', async () => {
        const icons = await nanokaProvider.getCharacterIcons()
        assert.equal(icons['漂泊者'], 'https://static.nanoka.cc/assets/ww/UI_Avatar/T1_DianZhu.webp')
        assert.equal(icons['忌炎'], 'https://static.nanoka.cc/assets/ww/UI_Avatar/T2_LiGe.webp')
    })

    it('getEchoList resolves sets and cost via sonata', async () => {
        const list = await nanokaProvider.getEchoList()
        assert.deepEqual(
            list.find((e) => e.name === '燎照之骑'),
            {
                name: '燎照之骑',
                sets: ['沉日劫明'],
                cost: 3
            }
        )
    })

    it('getCharacterInfo returns normalized data and recommend resolution works', async () => {
        const info = await nanokaProvider.getCharacterInfo('忌炎', { rich: true })
        assert.equal(info.element, '导电')
        assert.equal(info.weaponType, '迅刀')
        const recs = await nanokaProvider.getRecommendedWeapons('忌炎')
        // recommend.weapon=[2101] → weapon id 2101 = 往岁锚
        assert.deepEqual(recs, ['往岁锚'])
    })

    it('getEchoSetInfo interpolates bonus descriptions', async () => {
        const info = await nanokaProvider.getEchoSetInfo('沉日劫明')
        assert.deepEqual(info.bonuses, { 2: '气动伤害提升10%', 5: '湮灭伤害提升10%' })
    })

    it('getTagIcons scans character details into key → URL', async () => {
        const icons = await nanokaProvider.getTagIcons()
        assert.equal(
            icons['SP_RoleLabelI2'],
            'https://static.nanoka.cc/assets/ww/UIResources/Common/Atlas/RoleLabel/SP_RoleLabelI2.webp'
        )
        assert.ok(icons['SP_RoleLabelA2'])
    })

    it('reflects latest version from manifest', async () => {
        assert.equal(await nanokaProvider.getLatestVersion(), '3.5')
        assert.deepEqual(await nanokaProvider.getAvailableVersions(), ['3.5'])
    })

    it('throws "not found" for unknown entity names', async () => {
        await assert.rejects(() => nanokaProvider.getCharacterInfo('不存在的角色'), /not found/i)
        await assert.rejects(() => nanokaProvider.getWeaponInfo('不存在的武器'), /not found/i)
        await assert.rejects(() => nanokaProvider.getEchoInfo('不存在的声骸'), /not found/i)
    })

    it('serves list names and enums in the requested language', async () => {
        const list = await nanokaProvider.getCharacterList({ lang: 'en' })
        assert.deepEqual(
            list.map((c) => c.name),
            ['Rover', 'Jiyan']
        )
        assert.deepEqual(
            list.map((c) => c.element),
            ['Havoc', 'Electro']
        )
        assert.deepEqual(
            list.map((c) => c.weaponType),
            ['Broadblade', 'Sword']
        )
    })

    it('computes in Chinese then overlays the requested language text', async () => {
        const info = await nanokaProvider.getCharacterInfo('Jiyan', { lang: 'en' })
        assert.equal(info.element, 'Electro')
        assert.equal(info.weaponType, 'Sword')
        assert.equal(info.lv90BaseStats.tuneBreakBoost, 10)
        assert.equal(info.tags.find((t) => t.id === '33')?.name, 'Tune Rupture Response')
        assert.equal(info.skills.find((s) => s.name === 'Frosty Light')?.type, 'Normal Attack')
        assert.ok(info.skills.some((s) => s.name === 'Sea of Clouds'))
    })

    it('falls back to Chinese when the requested language is unavailable', async () => {
        const info = await nanokaProvider.getCharacterInfo('忌炎', { lang: 'fr' })
        assert.equal(info.skills[0].name, '轻云起')
        assert.equal(info.chains[0].name, '止戈')
    })
})
