// Buff 集侧的条件口径（`calc/buff-library-condition`）：规则裁剪 + 归属轴（本角色 / 出伤者）。
//
// 口径要点：
// - 库内只保留 5 种规则（`buffActive` 引用工程内 buff id，库里没有该 id 空间，一律丢弃）；
// - **同类条件只保留一条**（不会出现两条 zoneCompare / 两条 enemyType）；
// - `chain` / `refinement` 在库里没有槽位概念 → `charIdx` 固定 0，导入时按实体归属重指；
// - `zoneCompare` 的归属只有两档：0 = 本角色、-1 = 出伤者；属性白名单排除「由 Buff 产出的面板值」；
// - 引用归属 `active` = 出伤者 → 工程侧 `ZoneRef.characterIdx = -1`。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    LIBRARY_REF_OWNER_TABS,
    LIBRARY_REGEX_MAX,
    LIBRARY_RULE_KINDS,
    LIBRARY_ZONE_COMPARE_IDS,
    applyRefOwnerChoice,
    defaultRefOwnerOf,
    describeLibraryRules,
    isActiveRefOwner,
    libraryRefCharacterIdx,
    sanitizeLibraryRules,
    sanitizeRefOwner
} from '$lib/calc/buff-library-condition'

describe('库内规则裁剪：种类白名单', () => {
    it('buffActive 一律丢弃（引用工程内 buff id，库里没有该 id 空间）', () => {
        const out = sanitizeLibraryRules([{ kind: 'buffActive', mode: 'all', buffIds: ['a'] }])
        assert.equal(out, undefined, '空结果返回 undefined，不落空数组')
    })

    it('其余 5 种规则都保留', () => {
        const rules = [
            { kind: 'chain', charIdx: 0, min: 3 },
            { kind: 'refinement', charIdx: 0, min: 2 },
            { kind: 'damageNameRegex', pattern: '共鸣解放' },
            { kind: 'zoneCompare', charIdx: -1, zone: 'critRate', op: 'ge', value: 60 },
            { kind: 'enemyType', types: ['BOSS', '精英怪'] }
        ] as const
        const out = sanitizeLibraryRules(rules)
        assert.deepEqual(out, [...rules], '5 种规则原样保留')
        assert.equal(LIBRARY_RULE_KINDS.length, 5)
        assert.ok(!LIBRARY_RULE_KINDS.includes('buffActive'))
    })

    it('同类只保留第一条；非法 kind 直接丢掉', () => {
        assert.deepEqual(
            sanitizeLibraryRules([
                { kind: 'enemyType', types: ['BOSS'] },
                { kind: 'enemyType', types: ['小怪'] },
                { kind: 'nope' }
            ]),
            [{ kind: 'enemyType', types: ['BOSS'] }]
        )
    })

    it('敌人类型多选去重（旧单值 type 并入 types）', () => {
        assert.deepEqual(sanitizeLibraryRules([{ kind: 'enemyType', type: 'BOSS' }]), [
            { kind: 'enemyType', types: ['BOSS'] }
        ])
        assert.deepEqual(sanitizeLibraryRules([{ kind: 'enemyType', types: ['BOSS', 'BOSS'] }]), [
            { kind: 'enemyType', types: ['BOSS'] }
        ])
    })
})

describe('库内规则裁剪：归属轴收敛成两档', () => {
    it('chain / refinement 的 charIdx 固定为 0（导入时按实体归属重指）', () => {
        const out = sanitizeLibraryRules([
            { kind: 'chain', charIdx: 2, min: 6 },
            { kind: 'refinement', charIdx: 1, min: 5 }
        ])
        assert.deepEqual(out, [
            { kind: 'chain', charIdx: 0, min: 6 },
            { kind: 'refinement', charIdx: 0, min: 5 }
        ])
    })

    it('zoneCompare：出伤者保持 -1，其余槽位一律折成本角色 0', () => {
        assert.deepEqual(
            sanitizeLibraryRules([{ kind: 'zoneCompare', charIdx: -1, zone: 'atk', op: 'ge', value: 1000 }]),
            [{ kind: 'zoneCompare', charIdx: -1, zone: 'atk', op: 'ge', value: 1000 }]
        )
        assert.deepEqual(
            sanitizeLibraryRules([{ kind: 'zoneCompare', charIdx: 2, zone: 'atk', op: 'ge', value: 1000 }]),
            [{ kind: 'zoneCompare', charIdx: 0, zone: 'atk', op: 'ge', value: 1000 }]
        )
    })

    it('同类只保留一条（两条 zoneCompare 只留第一条）', () => {
        assert.deepEqual(
            sanitizeLibraryRules([
                { kind: 'zoneCompare', charIdx: -1, zone: 'critRate', op: 'ge', value: 60 },
                { kind: 'zoneCompare', charIdx: 0, zone: 'atk', op: 'gt', value: 1000 }
            ]),
            [{ kind: 'zoneCompare', charIdx: -1, zone: 'critRate', op: 'ge', value: 60 }]
        )
    })

    it('zoneCompare：属性不在模板白名单内（由 Buff 产出的面板值）整条丢弃', () => {
        assert.equal(
            sanitizeLibraryRules([{ kind: 'zoneCompare', charIdx: -1, zone: 'unisonBoonLayer', op: 'lt', value: 4 }]),
            undefined,
            '同奏层数这类自封顶玩法依赖跨 Buff 聚合，模板里表达不出'
        )
        assert.ok(!LIBRARY_ZONE_COMPARE_IDS.includes('unisonBoonLayer'))
        assert.ok(!LIBRARY_ZONE_COMPARE_IDS.includes('tuneBreakBoost'))
        assert.ok(LIBRARY_ZONE_COMPARE_IDS.includes('critRate'))
    })
})

describe('库内规则裁剪：伤害名正则', () => {
    it('空草稿保留（编辑器正在输入），超长丢弃', () => {
        assert.deepEqual(sanitizeLibraryRules([{ kind: 'damageNameRegex', pattern: '' }]), [
            { kind: 'damageNameRegex', pattern: '' }
        ])
        const tooLong = 'a'.repeat(LIBRARY_REGEX_MAX + 1)
        assert.equal(sanitizeLibraryRules([{ kind: 'damageNameRegex', pattern: tooLong }]), undefined)
    })
})

describe('库内规则文案：槽位说「本角色」，-1 说「出伤者」', () => {
    it('三种规则的中文摘要', () => {
        assert.equal(
            describeLibraryRules([{ kind: 'chain', charIdx: 0, min: 3 }]),
            '本角色 共鸣链 ≥ 3',
            '库里不出现槽位号'
        )
        assert.equal(
            describeLibraryRules([{ kind: 'zoneCompare', charIdx: -1, zone: 'critRate', op: 'ge', value: 60 }]),
            '出伤者 暴击率 ≥ 60%'
        )
        assert.equal(
            describeLibraryRules([
                { kind: 'chain', charIdx: 0, min: 0 },
                { kind: 'enemyType', types: ['BOSS', '精英怪'] }
            ]),
            '本角色 本体（0 链） 且 敌人类型 = BOSS / 精英怪',
            '多条规则之间是「且」'
        )
    })

    it('无条件返回空串（调用方据此不渲染）', () => {
        assert.equal(describeLibraryRules(undefined), '')
        assert.equal(describeLibraryRules([]), '')
    })
})

describe('引用归属：本角色 / 出伤者', () => {
    it('两选一的落库值：本角色按实体类型落 self / owner，出伤者落 active', () => {
        assert.equal(applyRefOwnerChoice('owner', 'character'), 'self')
        assert.equal(applyRefOwnerChoice('owner', 'weapon'), 'owner')
        assert.equal(applyRefOwnerChoice('owner', '2set'), 'owner')
        assert.equal(applyRefOwnerChoice('active', 'character'), 'active')
        assert.equal(defaultRefOwnerOf('character'), 'self')
        assert.equal(defaultRefOwnerOf(undefined), 'owner')
    })

    it('白名单只有三条；未知值丢弃', () => {
        assert.equal(sanitizeRefOwner('self'), 'self')
        assert.equal(sanitizeRefOwner('owner'), 'owner')
        assert.equal(sanitizeRefOwner('active'), 'active')
        assert.equal(sanitizeRefOwner('slots'), undefined)
        assert.equal(sanitizeRefOwner(undefined), undefined)
    })

    it('导入后 characterIdx：出伤者 = -1，本角色 = 实体归属槽位', () => {
        assert.equal(libraryRefCharacterIdx('active', 1), -1, '出伤者与归属槽位无关')
        assert.equal(libraryRefCharacterIdx('active', -1), -1)
        assert.equal(libraryRefCharacterIdx('self', 2), 2)
        assert.equal(libraryRefCharacterIdx('owner', 0), 0)
        assert.equal(libraryRefCharacterIdx(undefined, 1), 1, '缺省按本角色')
        assert.equal(isActiveRefOwner('active'), true)
        assert.equal(isActiveRefOwner('owner'), false)
        assert.equal(LIBRARY_REF_OWNER_TABS.length, 2, '界面只有两档')
    })
})
