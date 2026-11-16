# 计算核（`src/coconut-core/engine/core`）

计算核是伤害计算的**纯函数层**：给它一个请求对象，它返回逐条目的结算结果与溯源。
它不依赖 Svelte / 浏览器 / 上游 API，可以直接在 Node、Worker 或外部项目里 import。

```ts
import { computeProject } from '$lib/calc/core'

const entries = computeProject({
    entries, // DamageEntry[]
    buffs, // BuffInstance[]
    bindings, // Record<条目 id, Buff id[]>
    config, // ConfigState（角色声骸 + 敌人）
    team, // CharSlot[]（角色 / 武器 / 链 / 精炼）
    charInfo, // Record<角色名, CharacterInfo>
    weaponInfo // Record<武器名, WeaponInfo>
})
```

## 1. 入口

| 导出                                      | 用途                                               |
| ----------------------------------------- | -------------------------------------------------- |
| `computeProject(request)`                 | 结算全部条目（结果页 / 溯源 / 贡献分析的唯一入口） |
| `computeEntry(request, entry, charIndex)` | 只重算一条（贡献分析 / 单格刷新）                  |
| `buildDamageSegments(entry, ctx)`         | 单条目的乘区溯源（含来源列表）                     |
| `encodeValue` / `decodeValue`             | 交换格式的数值 ↔ 字符串                            |
| `encodeBuff` / `decodeBuff`               | Buff 实例 ↔ 交换形态                               |

`ComputeRequest` 的字段见 `src/coconut-core/engine/core/engine.ts`。缺省值：

- `damageTypes` 缺省 → 伤害类型按技能名 / 技能文案自动推导；
- `profile` 缺省 → 0 链 / 1 阶；
- `echoSkillText` 缺省 → 伤害类型推导规则 2（「视为 / 为 XX 伤害」）不参与，其余规则照常。

## 2. 调用方需要提供的数据契约

| 类型                                      | 含义                                               | 从哪来                    |
| ----------------------------------------- | -------------------------------------------------- | ------------------------- |
| `CharacterInfo`（`$lib/api/types`）       | 90 级白值（攻 / 生 / 防 / 谐度破坏增幅）+ 技能文案 | 上游角色接口              |
| `WeaponInfo`（`$lib/api/types`）          | 90 级基础攻击 + 副词条（`{ name, value }` 字符串） | 上游武器接口              |
| `CharSlot`（`$lib/types/project`）        | 角色名 / 武器名 / `chain` / `refinement`           | 工程队伍配置              |
| `ConfigState`（`$lib/calc/config.types`） | 五件声骸 + 敌人配置                                | 工程配置                  |
| `DamageEntry` / `BuffInstance`            | 条目与 Buff 实例                                   | 时间线派生 / 工程拉表配置 |

数值口径：`CharacterInfo.lv90BaseStats` 与 `WeaponInfo.lv90BaseAtk` 是**整数白值**；
`WeaponInfo.substat.value` 是上游原样的字符串（`攻击` 这类词条会被归一成 `攻击%`，
`0.3` 这类小数会被折算成 30）。

## 3. 结果形状

`ResultEntry` 的结构化真源是三项：

- `formula`：该条目走哪条公式（`direct` / `tune` / `effect` / `fixed`）；
- `panel`：面板摘要（三维白值 / 合计 / 作用落值）；
- `multiplierZones`：乘子链（`{ id, label, value, display }`）。

`baseAtk` / `totalAtk` / `atkPctSum` 这类平铺字段是 `panel` 的**派生兼容层**，新代码优先读 `panel`。
乘区的展示参数是结构化的（`MultiplierDisplay`），本地化文案由界面层
（`src/lib/result/styles.ts` 的 `formatMultiplierDisplay`）生成。

## 4. 自描述注册表

计算核把「有哪些作用 / 乘子 / 公式 / 引用来源」也作为数据导出，调用方不需要读文档猜：

| 导出                                              | 说明                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `BUFF_ACTIONS` / `ACTION_MAP`                     | Buff 能对计算做的每一件事（落点 / 合并语义 / 初值 / 可否覆盖 / 能否挂条件 / 能否引用） |
| `actionAllowsCondition(id)`                       | 该作用能否挂「伤害匹配」条件（热熔加成可以，热熔共鸣效率不行）                         |
| `MULTIPLIERS` / `MULTIPLIER_ORDER`                | 乘子（公式链上的乘法因子）与它们的规范顺序                                             |
| `FORMULAS` / `formulaOf` / `formulaActionClosure` | 四条公式的基值配方 + 有序乘子链，以及「这条公式读哪些作用」的闭包                      |
| `REF_SOURCES` / `REF_SOURCE_MAP`                  | 引用（转模）来源，区分角色侧与目标侧                                                   |

## 5. 纯度规则（机器强制）

`scripts/check-calc-core.mjs` 从 `core/index.ts` 出发走 import 闭包，**禁止**触达：

- `$app/*`（SvelteKit 运行时）
- `$lib/data/*`（数据层 store：Runes / localStorage / 上游 API 缓存）
- `*.svelte.ts`（Runes store）
- `$lib/components/*`、`$lib/theme/*`（界面层）
- `substat-algorithms`（副词条分析属于 app 功能）

该检查已接入 `pnpm run check`（也可单独跑 `pnpm run check:core`）。目前闭包 **25 个文件**，
全部是类型、常量、注册表、引擎与溯源。

## 6. 构建

```bash
pnpm run build:calc-lib
```

产物：`dist/calc-core/index.js`（单文件 ESM，零外部依赖，Node 直接 `import` 可用）。

类型不额外生成 `.d.ts`：生成产物会把 `$lib/*` 别名写进去、对消费方不可用；TS 消费方
（如工坊仓库）直接引用 `src/coconut-core/engine/core/index.ts` 取类型。

## 7. 交换格式（字符串值只在边界出现）

引擎内部一律「数值 + 显式单位」；字符串只出现在导入导出边界：

```ts
encodeValue(25, '%') // '25%'
decodeValue('25%') // { value: 25, unit: '%' }
encodeEffect({ zoneId: 'atkPct', value: 30 }) // { key: 'atkPct', value: '30%' }
decodeBuff(encodedBuff) // 未知作用 id / 未知引用来源整条丢弃
```

把字符串当内部模型会让每处运算都要 parse，并且单位真源分裂成两份（注册表的 `unit` 与
字符串里的 `%`）。编解码只服务表格 / JSON 交换这一侧。

## 8. 不在计算核里的东西

- 副词条贡献分析（`substat-algorithms/*`）—— 依赖 Worker / store，属于 app 功能；
- 时间线 → 伤害条目的派生（`calculation.store.svelte.ts`）—— Runes store；
- 工程持久化与迁移（`src/migration/*`）—— 属于数据层；
- 界面与本地化文案 —— 结果结构只给数值与结构化展示参数。
