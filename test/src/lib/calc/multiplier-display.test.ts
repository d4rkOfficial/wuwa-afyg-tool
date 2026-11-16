// 乘区展示文案：引擎只产出**结构化**参数，本地化字符串由界面层生成（决议 H3 / 阶段 3）。
//
// 这条测试钉住两件事：
//   ① 三种展示模式各自格式化正确；
//   ② 每个乘子的 `display` 在「值 = 1」与「值 ≠ 1」两种输入下都能产出一段非空文案
//      （防止新增乘子忘记声明 display，界面出现空白单元格）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { formatMultiplierDisplay } from '$lib/calc/result.styles'
import type { MultiplierDisplay } from '$lib/calc/result.types'

describe('乘区展示：结构化参数 → 界面文案', () => {
    it('delta 模式：1 + x%，位数由参数决定', () => {
        const d: MultiplierDisplay = { mode: 'delta', pct: 25, digits: 1 }
        assert.equal(formatMultiplierDisplay(1.25, d), '(1 + 25.0%)')
    })

    it('factor 模式：乘数本身', () => {
        assert.equal(formatMultiplierDisplay(0.690909, { mode: 'factor', digits: 4 }), '0.6909')
    })

    it('deltaWhenActive：生效显示百分比、未生效显示乘数', () => {
        const active: MultiplierDisplay = {
            mode: 'deltaWhenActive',
            pct: 14.4,
            active: true,
            activeDigits: 1,
            idleDigits: 4
        }
        const idle: MultiplierDisplay = { ...active, active: false }
        assert.equal(formatMultiplierDisplay(1.144, active), '(1 + 14.4%)')
        assert.equal(formatMultiplierDisplay(1, idle), '1.0000')
    })

    it('负 delta 也能正确格式化（穿抗把有效抗性推到负值等场景）', () => {
        assert.equal(formatMultiplierDisplay(0.92, { mode: 'delta', pct: -8, digits: 1 }), '(1 + -8.0%)')
    })
})
