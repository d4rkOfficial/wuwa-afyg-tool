// 「引擎里不许出现具体游戏实体名字」的棘轮闸门（决议 D5 / D11 / D15 / D35 / J1）。
//
// 用法：node scripts/check-no-hardcoded-ids.mjs
//
// 判据（一句话）：引擎代码不认识游戏里有哪些乘区、公式、属性；每加一条能力只往注册表加数据。
// 因此 `ENGINE` 列表里的文件**不允许出现实体名字符串字面量**（`'critRate'` / `'BOSS'` / `'冷凝'` …），
// 注册表文件（`REGISTRY`）与界面文件不受此约束。
//
// 设计（报告风格对齐 scripts/check-motion.mjs / check-components.mjs）：
//   - ① 实体清单自检是**硬断言**：ENTITY_IDS 里每项必须真的出现在注册源文件里，否则说明闸门名单过期。
//   - ② 逐文件字面量计数是**棘轮**：基线为实测站点，只许下降；新增即失败，减少则提示下调基线。
//   - 永久豁免放在 EXEMPT，逐条注明理由，不静默忽略。
//
// 为什么必须由机器保证：`compute.ts` 与 `damage-trace.ts` 里同一个乘区的标签、条件、来源收集器是
// 三份手抄本（本次调查实测已漂移：抽自 `docs` 的「防御区 / 免伤区」顺序两处不一致）。人肉同步挡不住。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const norm = (p) => p.replace(/\\/g, '/')

/** @desc 递归收集文件（本检查器只读，不改任何源文件） */
const walk = (dir, filter) => {
    const out = []
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) out.push(...walk(p, filter))
        else if (filter(name)) out.push(norm(p))
    }
    return out
}

// ────────────────────────────── 实体清单 ──────────────────────────────

/**
 * @desc 引擎不许硬编码的实体名。来源：`calc/calculation.consts.ts`（乘区 / 引用来源）、
 * `calc/rules.ts`（面板比较属性）、`consts/game-terms.ts`（属性 / 伤害类型 / 技能类型 / 敌人类型 / 基值类型）、
 * `consts/stat-data.ts`（词条 label）。
 *
 * 这份清单本身是**闸门的输入**，不是引擎的一部分 —— 它必须与注册表保持同步，由下面的 ① 自检兜住。
 */
const ENTITY_IDS = [
    // 乘区（BUFF_ACTIONS 的前身）
    'atkFlat',
    'atkPct',
    'hpFlat',
    'hpPct',
    'defFlat',
    'defPct',
    'tuneBreakBoost',
    'recharge',
    'offTuneBuildupRate',
    'critRate',
    'critDmg',
    'bonusDmg',
    'deepenDmg',
    'dmgTakenInc',
    'finalDmg',
    'specialFinal1',
    'specialFinal2',
    'extraRatio',
    'defDown',
    'resDown',
    'resPen',
    'defPen',
    'dmgRedPen',
    'tuneStrainLayer',
    'unisonBoonLayer',
    // 引用来源（与乘区重合，另有三维合计）
    'baseAtk',
    'totalAtk',
    'baseHp',
    'totalHp',
    'baseDef',
    'totalDef',
    // 面板比较属性
    'atk',
    'hp',
    'def',
    // 属性 / 元素
    '物理',
    '冷凝',
    '热熔',
    '导电',
    '气动',
    '衍射',
    '湮灭',
    // 伤害类型
    '普攻伤害',
    '重击伤害',
    '共鸣技能伤害',
    '共鸣解放伤害',
    '声骸技能伤害',
    '变奏技能伤害',
    '延奏技能伤害',
    '协同攻击伤害',
    '效应伤害',
    '其它类型伤害',
    // 伤害类型短名
    '普攻',
    '重击',
    '共鸣技能',
    '共鸣解放',
    '变奏技能',
    '延奏技能',
    '声骸技能',
    '协同',
    '效应',
    '其它',
    // 技能类型（`声骸技能` 已在上面的短名清单里）
    '常态攻击',
    '共鸣回路',
    '谐度破坏',
    '偏谐响应',
    '效应结算',
    // 敌人类型
    'BOSS',
    '精英怪',
    '小怪',
    // 基值类型
    '攻击',
    '生命',
    '防御',
    '偏谐系数',
    '效应系数',
    '固定',
    // 词条 label
    '攻击%',
    '生命%',
    '防御%',
    '共鸣效率',
    '治疗加成',
    '普攻伤害加成',
    '重击伤害加成',
    '共鸣技能伤害加成',
    '共鸣解放伤害加成'
]

/** @desc ① 自检的搜索范围：这些文件里必须能找到 ENTITY_IDS 的每一项 */
const REGISTRY_SOURCES = [
    'src/coconut-config/data.ts',
    'src/lib/calc/stat-writes.ts',
    'src/lib/calc/core-config.ts',
    'src/lib/calc/display-meta.ts',
    'src/lib/calc/calculation.consts.ts',
    'src/lib/calc/rules.ts',
    'src/lib/consts/game-terms.ts',
    'src/lib/consts/stat-data.ts'
]

// ────────────────────────────── 扫描范围与基线 ──────────────────────────────

/**
 * @desc 注册表文件：**允许**（且必须）出现实体名，不计入棘轮。
 * 后续阶段会收敛成 `src/lib/calc/registry/**` 下的若干注册域。
 */
const REGISTRY = new Set([
    'src/lib/calc/stat-writes.ts',
    'src/lib/calc/core-config.ts',
    'src/lib/calc/display-meta.ts',
    'src/lib/calc/calculation.consts.ts',
    'src/lib/calc/calculation.types.ts',
    'src/lib/calc/rules.ts'
])

/**
 * @desc 扫描目录：引擎与界面的全部 TS 源。
 *
 * `*.svelte.ts`（Runes store）不进扫描：它们属于界面/持久化层，职责是把注册表拼成工程状态，
 * 天然要按实体名分派（AGENTS §5.1 把 `*.svelte.ts` 划在 UI/store 层，不套函数式约束，同理）。
 */
const SCAN_DIRS = [
    'src/lib/calc',
    'src/lib/buff',
    'src/lib/timeline',
    'src/lib/project',
    'src/lib/result',
    'src/lib/substat',
    'src/lib/components/page/home/calculation',
    'src/lib/components/page/home/config'
]

/**
 * @desc 棘轮基线：文件 → 当前实测的字面量计数（阶段 3 完成后实测，合计 192 处）。
 *
 * **只许下降**：新增文件或计数上升立即失败；下降时脚本会提示把基线调到实测值。
 * 目标终态是整张表清零 —— 届时删掉 `BASELINE`，改为「非空即失败」。
 *
 * 分档说明：
 * - `damage-trace.ts` / `compute.ts` / `buff/library-condition.ts`
 *   → 阶段 2–3 继续由「系数暴击面板 + ResultEntry 结构化」清零；
 * - `skill-infer.ts` / `utils.ts` / `timeline/consts.ts` / `timeline/skill-segments.ts`
 *   → 阶段 2 由「中文词表注册」清零（决议 E6）；
 * - `config.types.ts` / `timeline.types.ts` 的 1 处是字面量联合类型 → 阶段 2 改为从注册表派生
 *   （`typeof ENEMY_TYPES[number]`）。
 */
const BASELINE = new Map(
    Object.entries({
        'src/lib/calc/damage-trace.ts': 53,
        'src/lib/calc/compute.ts': 26,
        'src/lib/calc/utils.ts': 38,
        'src/lib/components/page/home/calculation/damage-table.utils.ts': 0,
        'src/lib/components/page/home/config/character-detail-utils.ts': 23,
        'src/lib/calc/skill-infer.ts': 21,
        'src/lib/substat/standard.ts': 9,
        'src/lib/buff/library-condition.ts': 7,
        'src/lib/timeline/consts.ts': 4,
        'src/lib/timeline/skill-segments.ts': 3,
        'src/lib/buff/pane-effects.ts': 2,
        'src/lib/components/page/home/calculation/spread-table.utils.ts': 2,
        'src/lib/project/config.consts.ts': 1,
        'src/lib/calc/config.types.ts': 1,
        'src/lib/timeline/custom-hit.ts': 1,
        'src/lib/calc/timeline.types.ts': 1,
        // 物化层：`ResultEntry` 列 ↔ 作用 id 的映射表（内核零语料，这里只是界面契约的翻译）
        'src/lib/calc/compute-facade.ts': 18,
        // 已清零（登记为 0 表示「一旦出现即失败」）
        'src/lib/calc/condition.ts': 0,
        'src/lib/calc/zone-ops.ts': 0,
        'src/lib/calc/result.types.ts': 0,
        'src/lib/calc/calculation.consts.ts': 0,
        'src/lib/components/page/home/calculation/buff-modal.types.ts': 0
    })
)

/** @desc 永久豁免：`文件::实体` → 理由。用于确实必须按名字分派的地方（目前为空）。 */
const EXEMPT = new Map([])

// ────────────────────────────── ① 实体清单自检 ──────────────────────────────

const read = (p) => readFileSync(p, 'utf8')

const registryText = REGISTRY_SOURCES.map(read).join('\n')
const stale = ENTITY_IDS.filter((id) => !registryText.includes(`'${id}'`))
const dupes = ENTITY_IDS.filter((id, i) => ENTITY_IDS.indexOf(id) !== i)

console.log('── ① 实体清单自检（ENTITY_IDS 必须与注册表同步）')
console.log(`   实体 ${ENTITY_IDS.length} 项 / 注册源文件 ${REGISTRY_SOURCES.length} 个`)
let failed = 0
if (dupes.length) {
    failed += dupes.length
    console.log(`   ✗ 清单内有重复项：${[...new Set(dupes)].join(', ')}`)
}
if (stale.length) {
    failed += stale.length
    for (const id of stale) console.log(`   ✗ 清单项已不存在于注册源：'${id}'（注册表改名后需同步本脚本）`)
}
if (!dupes.length && !stale.length) console.log('   ✓ 清单项全部能在注册源里找到')

// ────────────────────────────── ② 逐文件字面量计数 ──────────────────────────────

const FILES = SCAN_DIRS.flatMap((dir) => walk(dir, (n) => extname(n) === '.ts' && !n.endsWith('.svelte.ts'))).sort()

const isRegistry = (file) => REGISTRY.has(file)

/** @desc 一行里是否出现实体名字面量（`'id'` 形式；双引号与模板串不算，本仓库统一单引号） */
const idLiteralRe = (id) => new RegExp(`'${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`)

const counts = new Map()
const sites = new Map()
for (const file of FILES) {
    if (isRegistry(file)) continue
    const src = read(file)
    const lines = src.split('\n')
    const perId = new Map()
    lines.forEach((line, i) => {
        for (const id of ENTITY_IDS) {
            if (!idLiteralRe(id).test(line)) continue
            perId.set(id, (perId.get(id) ?? 0) + 1)
            const key = `${file}::${id}`
            if (!sites.has(key)) sites.set(key, [])
            sites.get(key).push(i + 1)
            break
        }
    })
    const total = [...perId.values()].reduce((a, b) => a + b, 0)
    if (total > 0) counts.set(file, { total, perId })
}

const baselineFiles = new Set([...BASELINE.keys()].filter((f) => (BASELINE.get(f) ?? 0) > 0))
const measuredFiles = new Set(counts.keys())
const increasing = []
const fresh = []
const reclaimed = []

for (const file of new Set([...baselineFiles, ...measuredFiles])) {
    const base = BASELINE.get(file) ?? 0
    const measured = counts.get(file)?.total ?? 0
    if (measured > base) {
        if (base === 0) fresh.push({ file, base, measured })
        else increasing.push({ file, base, measured })
    } else if (measured < base) {
        reclaimed.push({ file, base, measured })
    }
}

console.log('\n── ② 引擎 / 界面文件里的实体名字面量（棘轮：只许下降）')
const baselineTotal = [...BASELINE.values()].reduce((a, b) => a + b, 0)
const measuredTotal = [...counts.values()].reduce((a, b) => a + b.total, 0)
console.log(
    `   基线 ${baselineTotal} 处 / 实测 ${measuredTotal} 处 / 扫描文件 ${FILES.length} 个（跳过注册表 ${REGISTRY.size} 个）`
)

console.log('   ── 实测清单（可直接照此下调基线）')
const sorted = [...counts.entries()].sort((a, b) => b[1].total - a[1].total)
for (const [file, { total, perId }] of sorted) {
    const base = BASELINE.get(file) ?? 0
    const mark = total > base ? '✗' : total < base ? '↺' : '·'
    console.log(`   ${mark} ${String(total).padStart(3)} 处  ${file}  (基线 ${base})`)
    const ids = [...perId.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id}×${n}`)
    console.log(`        ${ids.join('  ')}`)
}

if (fresh.length) {
    failed += fresh.length
    for (const x of fresh) console.log(`   ✗ 新增违规文件 ${x.file}：${x.measured} 处（基线未登记 → 视为 0）`)
}
if (increasing.length) {
    failed += increasing.length
    for (const x of increasing) console.log(`   ✗ 计数上升 ${x.file}：${x.base} → ${x.measured}`)
}
if (reclaimed.length) {
    for (const x of reclaimed) console.log(`   ↺ 可下调基线：${x.file} ${x.base} → ${x.measured}`)
}
if (!fresh.length && !increasing.length && !reclaimed.length) console.log('   ✓ 无新增违规，基线无冗余')

const exemptHits = [...EXEMPT.keys()].filter((key) => {
    const [file, id] = key.split('::')
    return Boolean(counts.get(file)?.perId.has(id))
})
for (const [key, reason] of EXEMPT) {
    const hit = exemptHits.includes(key)
    console.log(`   ⊘ 永久豁免${hit ? '' : '（已失效，可删除）'}: ${key}`)
    console.log(`     理由：${reason}`)
}

// ────────────────────────────── 汇总 ──────────────────────────────

console.log('\n══════════════════════════════════════')
console.log(`① 实体清单 ${ENTITY_IDS.length} 项，过期 ${stale.length}`)
console.log(`② 引擎/界面字面量 ${measuredTotal} 处（基线 ${baselineTotal}），新增 ${fresh.length + increasing.length}`)
console.log(failed === 0 ? '[check-no-hardcoded-ids] OK' : `[check-no-hardcoded-ids] ${failed} 处问题`)
process.exit(failed === 0 ? 0 : 1)
