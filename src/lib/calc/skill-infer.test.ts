// 伤害类型自动推导回归测试：文案取自 nanoka 上游（嘉贝莉娜 / 景燃），覆盖「一份 desc 多段/多技能混排」的分段锚定。
// 运行：node --import ./scripts/test/preload.mjs --test "src/lib/calc/skill-infer.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferDamageTypes } from './utils'
import type { DamageEntry } from './calculation.types'
import type { CharacterInfo } from '$lib/api/types'

interface RawSkill {
    type: string
    desc: string
    rows: string[]
}

/** @desc 用「技能类型 + 文案 + 倍率行名」拼出推导所需的最小上下文 */
const buildInfo = (skills: RawSkill[]): CharacterInfo =>
    ({
        skills: skills.map((s) => ({
            name: s.type,
            type: s.type,
            desc: s.desc,
            values: s.rows.map((row) => [row, '100%', '热熔'] as [string, string, string])
        }))
    }) as unknown as CharacterInfo

const buildEntry = (skillType: string, hitName: string): DamageEntry =>
    ({
        id: `${skillType}|${hitName}`,
        character: '测试角色',
        skillType,
        hitName,
        displayName: hitName,
        isEffect: false,
        isTuneBreak: false,
        isTuneResponse: false,
        ratioValue: 100,
        ratioUnit: '%',
        damageBaseType: '攻击',
        damageElement: '热熔',
        sourceTimelineBlockId: 'b1',
        hits: 1
    }) as DamageEntry

const typeOf = (skillType: string, hitName: string, skills: RawSkill[]) =>
    inferDamageTypes(buildEntry(skillType, hitName), buildInfo(skills))[0]

// ── 嘉贝莉娜（1208）──
const GABRIELINA_NA = `普攻进行最多4段的连续攻击，造成热熔伤害，普攻第1段、普攻第2段、普攻第3段伤害为重击伤害，普攻第4段伤害为声骸技能伤害。施放普攻第4段后一定时间内短按普攻，可施放普攻第2段。重击·燧发杀戮消耗耐力攻击目标，进行最多3段的连续攻击，造成热熔伤害，第3段伤害为声骸技能伤害。施放重击·燧发杀戮第1段后一定时间内短按普攻，可施放普攻第2段。施放重击·燧发杀戮第2、3段后一定时间内短按普攻，可施放普攻第3段。空中攻击·枪弹暴雨处于空中时，短按普攻消耗耐力进行空中下落攻击，造成热熔伤害，此次伤害为重击伤害。处于空中时，按住普攻可持续消耗耐力对正下方目标进行扫射，造成热熔伤害，此次伤害为重击伤害，技能被打断后若没有回到地面，无法再次施放。扫射期间松开普攻将施放空中下落攻击。空中下落攻击后，短按普攻可施放普攻第3段。闪避反击·血债将偿成功闪避后一定时间内短按普攻，将会攻击目标，造成热熔伤害，此次伤害为重击伤害。施放该技能后在一定时间内短按普攻，可施放普攻第4段。`
const GABRIELINA_NA_ROWS = [
    '普攻第一段伤害',
    '普攻第二段伤害',
    '普攻第三段伤害',
    '普攻第四段伤害',
    '闪避反击·血债将偿伤害',
    '空中攻击·枪弹暴雨下落攻击伤害',
    '空中攻击·枪弹暴雨持续扫射伤害',
    '重击·燧发杀戮第一段伤害',
    '重击·燧发杀戮第二段伤害',
    '重击·燧发杀戮第三段伤害',
    '空中攻击·枪弹暴雨持续扫射耐力消耗（每秒）',
    '空中攻击·枪弹暴雨耐力消耗',
    '重击·燧发杀戮第一段耐力消耗',
    '重击·燧发杀戮第二段耐力消耗',
    '重击·燧发杀戮第三段耐力消耗'
]
const GABRIELINA_SKILL = `共鸣技能·迫近向前冲刺并跃起，命中目标后向后跳跃，造成热熔伤害，此次伤害为重击伤害。共鸣技能·恶翼扬升【罪火】达到100点时，共鸣技能替换为共鸣技能·恶翼扬升。用羽翼斩击敌人，造成热熔伤害，此次伤害视为重击伤害。施放时：·嘉贝莉娜进入恶魔位格。·【罪火】转化为等值的【净炼火】。·可衔接普攻·炽天猎杀第2段。`
const GABRIELINA_LIBERATION = `攻击目标，造成热熔伤害，此次伤害为声骸技能伤害，并使恶魔位格期间，普攻·炽天猎杀、重击·炼羽裁决、空中攻击·火狱暴雨、闪避反击·罪业当涤的伤害倍率提升{0}，持续{1}秒。施放共鸣解放后，短按普攻，可施放普攻第2段，恶魔位格期间替换为施放普攻·炽天猎杀第2段。可在低空中施放。`

const GABRIELINA: RawSkill[] = [
    { type: '常态攻击', desc: GABRIELINA_NA, rows: GABRIELINA_NA_ROWS },
    {
        type: '共鸣技能',
        desc: GABRIELINA_SKILL,
        rows: ['共鸣技能·迫近伤害', '共鸣技能·恶翼扬升伤害', '共鸣技能·恶翼扬升回复协奏能量']
    },
    { type: '共鸣解放', desc: GABRIELINA_LIBERATION, rows: ['共鸣解放·炼净伤害', '共鸣解放·炼净消耗共鸣能量'] }
]

// ── 景燃（1212）──
const JINGRAN_NA = `普攻·摄召若景燃处于负阴状态，可进行最多4段连续攻击，造成热熔伤害。施放普攻·摄召第3段时可获得{0}点【炁】，且此伤害为重击伤害。施放普攻·摄召第4段时可获得{1}点【炁】，且此伤害为重击伤害。普攻·灭煞若景燃处于抱阳状态，可进行最多4段连续攻击，造成热熔伤害。施放普攻·灭煞第3段时可获得{2}点【炁】，且此伤害为重击伤害。施放普攻·灭煞第4段时可获得{3}点【炁】，且此伤害为重击伤害。空中攻击消耗耐力进行空中下落攻击，造成热熔伤害。若景燃处于负阴状态，施放该技能后的一定时间内，按下普攻将会施放普攻·摄召第2段。若景燃处于抱阳状态，施放该技能后的一定时间内，按下普攻将会施放普攻·灭煞第2段。闪避反击·探幽若景燃处于负阴状态，成功闪避后一定时间内按下普攻，将会攻击目标，造成热熔伤害。施放闪避反击·探幽时可获得{4}点【炁】，且此伤害为重击伤害。施放该技能后的一定时间内，按下普攻将会施放普攻·摄召第4段。闪避反击·守明若景燃处于抱阳状态，成功闪避后一定时间内按下普攻，将会攻击目标，造成热熔伤害。施放闪避反击·守明时可获得{5}点【炁】，且此伤害为重击伤害。施放该技能后的一定时间内，按下普攻将会施放普攻·灭煞第4段。潜影景燃处于战斗状态下，且在地面时，向前短按闪避可施放潜影，造成固定热熔伤害，此次伤害为普攻伤害，不受伤害加成影响，施放该技能一定时间内可以触发成功闪避。若景燃处于负阴状态，施放该技能后的一定时间内，按下普攻将会施放普攻·摄召第2段。若景燃处于抱阳状态，施放该技能后的一定时间内，按下普攻将会施放普攻·灭煞第2段。`
const JINGRAN_NA_ROWS = [
    '普攻·摄召第一段伤害',
    '普攻·摄召第二段伤害',
    '普攻·摄召第三段伤害',
    '普攻·摄召第四段伤害',
    '普攻·灭煞第一段伤害',
    '普攻·灭煞第二段伤害',
    '普攻·灭煞第三段伤害',
    '普攻·灭煞第四段伤害',
    '空中攻击伤害',
    '闪避反击·探幽伤害',
    '闪避反击·守明伤害',
    '潜影伤害'
]
const JINGRAN_SKILL = `共鸣技能·阴蚀骨若景燃处于负阴状态，可施放共鸣技能·阴蚀骨，攻击目标，造成热熔伤害。共鸣技能·阴蚀骨可在空中施放。共鸣技能·阳焚身若景燃处于抱阳状态，可施放共鸣技能·阳焚身，攻击目标，造成热熔伤害。共鸣技能·阳焚身可在空中施放。破秽施放共鸣技能·阴蚀骨或共鸣技能·阳焚身时，获得破秽，持续{0}秒，满足下述条件之一时，破秽提前结束。·切换至其他角色。·切换至负阴状态或抱阳状态时。·施放共鸣技能·黄泉渡或共鸣技能·往生送时。共鸣技能·黄泉渡若景燃处于负阴状态且持有破秽时，在空中按下普攻可施放共鸣技能·黄泉渡，攻击目标，造成热熔伤害，本次伤害为重击伤害。施放共鸣技能·黄泉渡时可获得{1}点【炁】。施放该技能后的一定时间内，按下普攻将会施放普攻·摄召第2段。共鸣技能·往生送若景燃处于抱阳状态且持有破秽时，在空中按下普攻可施放共鸣技能·往生送，攻击目标，造成热熔伤害，本次伤害为重击伤害。施放共鸣技能·往生送时可获得{2}点【炁】。施放该技能后的一定时间内，按下普攻将会施放普攻·灭煞第2段。`

const JINGRAN: RawSkill[] = [
    { type: '常态攻击', desc: JINGRAN_NA, rows: JINGRAN_NA_ROWS },
    { type: '共鸣技能', desc: JINGRAN_SKILL, rows: ['阴蚀骨伤害', '黄泉渡伤害', '阳焚身伤害', '往生送伤害'] }
]

test('嘉贝莉娜：普攻前 3 段为重击伤害、第 4 段为声骸技能伤害（分段锚定）', () => {
    assert.equal(typeOf('常态攻击', '普攻第一段伤害', GABRIELINA), '重击伤害')
    assert.equal(typeOf('常态攻击', '普攻第二段伤害', GABRIELINA), '重击伤害')
    assert.equal(typeOf('常态攻击', '普攻第三段伤害', GABRIELINA), '重击伤害')
    assert.equal(typeOf('常态攻击', '普攻第四段伤害', GABRIELINA), '声骸技能伤害')
})

test('嘉贝莉娜：重击·燧发杀戮只有第 3 段是声骸技能伤害', () => {
    assert.equal(typeOf('常态攻击', '重击·燧发杀戮第一段伤害', GABRIELINA), '重击伤害')
    assert.equal(typeOf('常态攻击', '重击·燧发杀戮第二段伤害', GABRIELINA), '重击伤害')
    assert.equal(typeOf('常态攻击', '重击·燧发杀戮第三段伤害', GABRIELINA), '声骸技能伤害')
})

test('嘉贝莉娜：空中攻击 / 闪避反击按文案写明的重击结算', () => {
    assert.equal(typeOf('常态攻击', '空中攻击·枪弹暴雨下落攻击伤害', GABRIELINA), '重击伤害')
    assert.equal(typeOf('常态攻击', '空中攻击·枪弹暴雨持续扫射伤害', GABRIELINA), '重击伤害')
    assert.equal(typeOf('常态攻击', '闪避反击·血债将偿伤害', GABRIELINA), '重击伤害')
})

test('嘉贝莉娜：共鸣技能/共鸣解放的「此次伤害为X」按各自段落生效', () => {
    assert.equal(typeOf('共鸣技能', '共鸣技能·迫近伤害', GABRIELINA), '重击伤害')
    assert.equal(typeOf('共鸣技能', '共鸣技能·恶翼扬升伤害', GABRIELINA), '重击伤害')
    assert.equal(typeOf('共鸣解放', '共鸣解放·炼净伤害', GABRIELINA), '声骸技能伤害')
})

test('景燃：阳焚身/阴蚀骨为共鸣技能伤害，往生送/黄泉渡为重击伤害（不被邻段结论污染）', () => {
    assert.equal(typeOf('共鸣技能', '阳焚身伤害', JINGRAN), '共鸣技能伤害')
    assert.equal(typeOf('共鸣技能', '阴蚀骨伤害', JINGRAN), '共鸣技能伤害')
    assert.equal(typeOf('共鸣技能', '往生送伤害', JINGRAN), '重击伤害')
    assert.equal(typeOf('共鸣技能', '黄泉渡伤害', JINGRAN), '重击伤害')
})

test('景燃：普攻·摄召/灭煞仅第 3、4 段为重击伤害，其余按普攻', () => {
    assert.equal(typeOf('常态攻击', '普攻·摄召第一段伤害', JINGRAN), '普攻伤害')
    assert.equal(typeOf('常态攻击', '普攻·摄召第二段伤害', JINGRAN), '普攻伤害')
    assert.equal(typeOf('常态攻击', '普攻·摄召第三段伤害', JINGRAN), '重击伤害')
    assert.equal(typeOf('常态攻击', '普攻·摄召第四段伤害', JINGRAN), '重击伤害')
    assert.equal(typeOf('常态攻击', '普攻·灭煞第一段伤害', JINGRAN), '普攻伤害')
    assert.equal(typeOf('常态攻击', '普攻·灭煞第三段伤害', JINGRAN), '重击伤害')
    assert.equal(typeOf('常态攻击', '普攻·灭煞第四段伤害', JINGRAN), '重击伤害')
})

test('景燃：闪避反击按文案写明的重击结算，空中攻击默认普攻，潜影为普攻', () => {
    assert.equal(typeOf('常态攻击', '闪避反击·探幽伤害', JINGRAN), '重击伤害')
    assert.equal(typeOf('常态攻击', '闪避反击·守明伤害', JINGRAN), '重击伤害')
    assert.equal(typeOf('常态攻击', '空中攻击伤害', JINGRAN), '普攻伤害')
    assert.equal(typeOf('常态攻击', '潜影伤害', JINGRAN), '普攻伤害')
})

test('富文本标签不会破坏「视为」匹配', () => {
    const skills: RawSkill[] = [
        {
            type: '共鸣技能',
            desc: '造成热熔伤害，<color=Highlight>此次伤害视为</color><te href=1>共鸣解放</te>伤害。',
            rows: ['共鸣技能·测试伤害']
        }
    ]
    assert.equal(typeOf('共鸣技能', '共鸣技能·测试伤害', skills), '共鸣解放伤害')
})

test('否定写法不作为依据（回退到技能类型推导）', () => {
    const skills: RawSkill[] = [
        { type: '共鸣技能', desc: '该伤害不作为声骸技能伤害结算。', rows: ['共鸣技能·测试伤害'] }
    ]
    assert.equal(typeOf('共鸣技能', '共鸣技能·测试伤害', skills), '共鸣技能伤害')
})

// ── 长离（1301）：倍率来自哪个技能，就只在该技能的文案里找结论 ──
const CHANGLI_NA = `<size=40><color=Title>普攻</color></size>进行最多4段的连续攻击，造成热熔伤害。<size=40><color=Title>重击</color></size>消耗耐力，长按普攻施放重击，造成热熔伤害。<size=40><color=Title>空中攻击</color></size>消耗耐力进行空中下落攻击，造成热熔伤害。<size=40><color=Title>闪避反击</color></size>成功闪避后一定时间内短按普攻，将会攻击目标，造成热熔伤害。`
const CHANGLI_HA = `<size=40><color=Title>重击·焚身以火</color></size>施放重击时，若处于【离火】状态，重击替换为重击·焚身以火，造成热熔伤害，此次伤害为共鸣技能伤害。`
const CHANGLI_LIB = `<size=40><color=Title>离火照丹心</color></size>攻击目标，造成热熔伤害，并使队伍中所有角色攻击提升。`
const CHANGLI_VARIATION = `攻击目标，造成热熔伤害，并为自身附加【离火】。`
const CHANGLI_SKILL = `<size=40><color=Title>共鸣技能·热熔</color></size>攻击目标，造成热熔伤害，此次伤害为共鸣技能伤害。`

const CHANGLI: RawSkill[] = [
    {
        type: '常态攻击',
        desc: CHANGLI_NA,
        rows: ['普攻第一段伤害', '普攻第二段伤害', '普攻第三段伤害', '普攻第四段伤害', '重击']
    },
    { type: '共鸣回路', desc: CHANGLI_HA, rows: ['重击·焚身以火伤害'] },
    { type: '共鸣解放', desc: CHANGLI_LIB, rows: ['技能伤害'] },
    { type: '变奏技能', desc: CHANGLI_VARIATION, rows: ['技能伤害'] },
    { type: '共鸣技能', desc: CHANGLI_SKILL, rows: ['共鸣技能·热熔伤害'] }
]

test('长离：常态攻击的「重击」不借用共鸣回路「施放重击时…为共鸣技能伤害」的结论', () => {
    assert.equal(typeOf('常态攻击', '重击', CHANGLI), '重击伤害')
    assert.equal(typeOf('共鸣回路', '重击·焚身以火伤害', CHANGLI), '共鸣技能伤害')
})

test('长离：共鸣解放/变奏技能的「技能伤害」不被子串「共鸣技能伤害」抢走', () => {
    assert.equal(typeOf('共鸣解放', '技能伤害', CHANGLI), '共鸣解放伤害')
    assert.equal(typeOf('变奏技能', '技能伤害', CHANGLI), '变奏技能伤害')
    assert.equal(typeOf('共鸣技能', '共鸣技能·热熔伤害', CHANGLI), '共鸣技能伤害')
})

// ── 大标题小节定位：同一份 desc 里结论只对本小节生效 ──
const SECTION_NA = `<size=40><color=Title>普攻·苍剑式</color></size>连续短按或按住普攻，进行最多4段的连续攻击，造成湮灭伤害。<size=40><color=Title>闪避反击·苍剑式</color></size>成功闪避后一定时间内短按普攻，攻击目标造成湮灭伤害。施放闪避反击·苍剑式时，视为普攻·苍剑式第2段连段。`

test('倍率定位到所属大标题小节：别的小节的「视为…连段」不改变本段类型', () => {
    const skills: RawSkill[] = [
        {
            type: '常态攻击',
            desc: SECTION_NA,
            rows: ['普攻·苍剑式第一段伤害', '普攻·苍剑式第二段伤害', '闪避反击·苍剑式伤害']
        }
    ]
    assert.equal(typeOf('常态攻击', '普攻·苍剑式第一段伤害', skills), '普攻伤害')
    assert.equal(typeOf('常态攻击', '闪避反击·苍剑式伤害', skills), '普攻伤害')
})

test('倍率所在小节没写结论时，改用「正文提到该倍率」的小节（炽霞·热压弹）', () => {
    const skills: RawSkill[] = [
        {
            type: '共鸣回路',
            desc: `<size=40><color=Title>共鸣技能·咔咔压制</color></size>长按共鸣技能进入咔咔压制状态，在该状态下：·持续消耗【热压弹】攻击目标，造成热熔伤害，此次伤害为共鸣技能伤害；·短按普攻，将会施放第4段普攻攻击目标，造成热熔伤害，此次伤害为普攻伤害。<size=40><color=Title>热压弹获取规则</color></size>【热压弹】容量上限{1}发。常态攻击命中目标时，可积攒【热压弹】。`,
            rows: ['热压弹伤害', '共鸣技能·咔咔压制伤害']
        }
    ]
    assert.equal(typeOf('共鸣回路', '热压弹伤害', skills), '共鸣技能伤害')
})

test('同一倍率的多个候选小节里，明写结论优先于名称徽标（今汐·凌霄·普攻）', () => {
    const skills: RawSkill[] = [
        {
            type: '共鸣回路',
            desc: `<size=40><color=Title>乘岁凌霄</color></size>·普攻替换为普攻凌霄·普攻，进行最多连续4段攻击，造成衍射伤害，此次伤害为共鸣技能伤害，此外，该连击段数不会被重置。<size=40><color=Title>共鸣技能·惊龙破空</color></size>施放普攻凌霄·普攻第4段后，将立刻结束乘岁凌霄状态，并获得效果游龙廻光。`,
            rows: ['凌霄·普攻第一段伤害', '凌霄·普攻第四段伤害', '凌霄·重击伤害']
        }
    ]
    assert.equal(typeOf('共鸣回路', '凌霄·普攻第四段伤害', skills), '共鸣技能伤害')
})

test('名称徽标：倍率名紧跟在「XX 技能【」之后时按该类型结算（秋水·雾化子弹）', () => {
    const skills: RawSkill[] = [
        {
            type: '共鸣回路',
            desc: `当秋水穿过【雾气】时，会进入迷雾潜行状态。<size=40><color=Title>迷雾潜行</color></size>·期间可持续消耗【雾滴】，每消耗{0}点【雾滴】，生成{1}颗共鸣技能【雾化子弹】。`,
            rows: ['雾化子弹伤害']
        },
        {
            type: '共鸣回路',
            desc: `当秋水穿过【雾气】时，会进入迷雾潜行状态。<size=40><color=Title>迷雾潜行</color></size>·移动速度提升；期间可持续消耗【雾滴】。`,
            rows: ['雾化子弹伤害']
        }
    ]
    assert.equal(typeOf('共鸣回路', '雾化子弹伤害', skills), '共鸣技能伤害')
    assert.equal(typeOf('共鸣回路', '雾化子弹伤害', [skills[1]!]), '其它类型伤害')
})

test('标题名与正文粘连时，标题里的类型词不算本行的徽标（琳奈·绮彩巡游）', () => {
    const skills: RawSkill[] = [
        {
            type: '常态攻击',
            desc: `<size=40><color=Title>绮彩巡游·地面重击</color></size>绮彩巡游状态期间，且处于地面时，按住普攻持续施放。琳奈持续消耗耐力攻击目标，造成衍射伤害，此次伤害为普攻伤害；松开普攻时，琳奈施放绮彩巡游·跃动集束，造成衍射伤害，此次伤害为普攻伤害。<size=40><color=Title>绮彩巡游·普攻</color></size>绮彩巡游状态期间，普攻替换为绮彩巡游·普攻。`,
            rows: ['绮彩巡游·普攻第一段伤害', '绮彩巡游·地面重击伤害', '绮彩巡游·闪避反击', '绮彩巡游·跃动集束伤害']
        }
    ]
    assert.equal(typeOf('常态攻击', '绮彩巡游·普攻第一段伤害', skills), '普攻伤害')
    assert.equal(typeOf('常态攻击', '绮彩巡游·闪避反击', skills), '普攻伤害')
    assert.equal(typeOf('常态攻击', '绮彩巡游·地面重击伤害', skills), '普攻伤害')
})

test('更短的同族行名套在本行名字里时，不抢走本行的结论（灯灯·强光穿射）', () => {
    const skills: RawSkill[] = [
        {
            type: '共鸣回路',
            desc: `<size=40><color=Title>强光穿射</color></size>灯灯施放延奏技能时，消耗当前模式的全部【光能】。消耗的【光能】大于等于{0}点时，可施放强光穿射，造成导电伤害，此次伤害为普攻伤害。每{0}点【光能】可使强光穿射的伤害段数加{1}，最多{2}段。`,
            rows: ['强光伤害', '强光穿射每段伤害']
        }
    ]
    assert.equal(typeOf('共鸣回路', '强光穿射每段伤害', skills), '普攻伤害')
})

test('小节标题本身就是倍率行名时，整节共用的一句结论归属本行（绯雪·普攻·预求身）', () => {
    const skills: RawSkill[] = [
        {
            type: '常态攻击',
            desc: `<size=40><color=Title>普攻·常世身</color></size>连续短按或按住普攻，进行最多3段的连续攻击，造成冷凝伤害。<size=40><color=Title>普攻·预求身</color></size>进行最多5段的连续攻击，造成冷凝伤害，此次伤害为共鸣解放伤害。`,
            rows: ['普攻·常世身第一段伤害', '普攻·预求身第一段伤害', '普攻·预求身第五段伤害']
        }
    ]
    assert.equal(typeOf('常态攻击', '普攻·预求身第一段伤害', skills), '共鸣解放伤害')
    assert.equal(typeOf('常态攻击', '普攻·预求身第五段伤害', skills), '共鸣解放伤害')
    assert.equal(typeOf('常态攻击', '普攻·常世身第一段伤害', skills), '普攻伤害')
})
