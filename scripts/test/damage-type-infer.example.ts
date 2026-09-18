// ── 伤害类型推导用例：空白模板 ─────────────────────────────────────────────
// 复制本文件为你的用例脚本（如 scripts/test/damage-type-infer.cases.ts），把「角色 + 倍率行名
// + 期望伤害类型」填进 CASES，然后运行：
//
//   node --import ./scripts/test/preload.mjs scripts/test/damage-type-infer.example.ts
//   （或复制后改上面这条路径 / 用 pnpm run test:infer）
//
// TDD 顺序：先写期望值 → 跑（红）→ 改推导算法（src/lib/calc/skill-infer.ts）→ 再跑（绿）。
// 绝不要为了让用例变绿而改期望值；期望值只能来自游戏内伤害类型判定或文案明写。
// 完整算法与流程见 docs/damage-type-inference.md。

import { assertCorrectDamageTypeInfer, assertDamageTypeEnum, reportDamageTypeInfer } from './damage-type-infer'
import type { InferCase } from './damage-type-infer'

// 局部枚举：左边是写用例用的短名，右边是权威伤害类型清单（src/lib/consts/game-terms.ts）里的值。
const DAMAGE_TYPES = {
    普攻: '普攻伤害',
    重击: '重击伤害',
    共鸣技能: '共鸣技能伤害',
    共鸣解放: '共鸣解放伤害',
    声骸技能: '声骸技能伤害',
    变奏技能: '变奏技能伤害',
    延奏技能: '延奏技能伤害',
    协同攻击: '协同攻击伤害',
    效应: '效应伤害',
    其它: '其它类型伤害'
} as const

// ── 用例表（空白）────────────────────────────────────────────────────────
// 每条：characterName（角色名）、ratioName（倍率行名，写法必须与面板一致）、
//       expectedDamageType（期望类型）、可选 skillType（行名重名时定位）、
//       可选 isEffect（效应结算条目）、可选 note（依据，失败报告里会打印）。
const CASES: InferCase[] = [
    // 示例（取消注释并改成你的用例）：
    // { characterName: '长离', ratioName: '重击', expectedDamageType: DAMAGE_TYPES.重击, note: '常态攻击的重击按重击结算' },
    // {
    //     characterName: '长离',
    //     ratioName: '共鸣解放伤害',
    //     expectedDamageType: DAMAGE_TYPES.共鸣解放,
    //     skillType: '共鸣解放',
    //     note: '上游把「技能伤害」按技能类型改写成「共鸣解放伤害」，行名要用面板写法'
    // }
]

// 枚举自检：确认左边的短名没写错（值必须落在权威清单里）
assertDamageTypeEnum(DAMAGE_TYPES)

// 夹具自检：确认上游可达、推导链路可用（不需要可整段删除）
await assertCorrectDamageTypeInfer('长离', '重击', DAMAGE_TYPES.重击, {
    note: '夹具自检：常态攻击的重击不应被共鸣回路文案带跑'
})
console.log('夹具自检通过：长离「重击」→ 重击伤害')

// 批量跑用例（用例为空时只打印提示，不会失败）
await reportDamageTypeInfer(CASES)
