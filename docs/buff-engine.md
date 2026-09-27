# 计算引擎：一切皆 Buff

本文档描述「一切皆 buff」重构后的伤害计算引擎：数据模型、乘区算子与条件系统。

> 相关源码
>
> | 文件                                   | 职责                                                   |
> | -------------------------------------- | ------------------------------------------------------ |
> | `src/lib/calc/calculation.types.ts`    | Buff / 乘区 / 条件的类型定义                           |
> | `src/lib/calc/zone-ops.ts`             | **乘区算子唯一维护点**（`ZONE_OPS`）                   |
> | `src/lib/calc/builtin-buff-sources.ts` | 内置 Buff 源清单（角色/武器/声骸/敌人 + 公式固有乘区） |
> | `src/lib/calc/condition.ts`            | 条件求值与分层裁剪                                     |
> | `src/lib/calc/compute.ts`              | 贡献聚合与逐条目计算                                   |
> | `src/lib/data/migration.ts`            | 历史数据迁移（含链阶互斥拆分）                         |

## 1. 统一模型

所有影响伤害计算的东西都是 **Buff 类实例**（`BuffInstance`）：角色面板、武器、声骸、敌人配置、
公式固有乘区，以及用户配置的 Buff。它们只通过**贡献（contribution）**进入引擎：

```
DamageEntry ──┐
              ├─→ boundBuffs(条目 × 角色 × 条件) ─→ 生效变体 ─→ 乘区写入 ─→ CharacterComputed ─→ ResultEntry
BuffInstance ─┘
```

- **贡献键 = 乘区键**（`ZoneId`）：`atkPct` / `bonusDmg` / `defPen` / `finalDmg` / `customFinalDmgMul` … 见 `ZONE_DEFS`。
- 装备（武器/声骸）与内置源也走同一套乘区键，经 `applyEntryStatToAccum` 归一化后写入同一个累加器。
- `ResultEntry` 与界面数据形状保持不变，结果页 / 乘区溯源 / 副词条分析无需感知引擎内部结构。

### 乘区算子（`ZONE_OPS`）

每个乘区只声明一次它的语义，三条写入路径共用：

| 写入       | 用途                                       |
| ---------- | ------------------------------------------ |
| `add`      | 追加累加（`customFinalDmgMul` 为连乘）     |
| `override` | 覆盖当前合计值（`BuffZoneValue.override`） |

`applyZone(acc, zoneId, value, 'add' | 'override')` 是唯一出口；`recomputeTotals(acc)` 在面板类乘区变化后
重算攻/生/防三维，保证引用转模读到最新面板。

### 内置 Buff 源

`BUILTIN_BUFF_SOURCES`（角色/武器/声骸/敌人/谐度）与 `FORMULA_ZONES`（倍率·暴击·防御·抗性·免伤·增伤·
加深·易伤·集谐·同奏·终伤·特殊·谐度增幅）在界面上不作为可编辑 Buff 出现，但在乘区溯源里以同一口径列出。

## 2. 条件系统

条件按**挂载位置**分层，能力不同：

| 层级        | 字段                      | 可配置条件                                       |
| ----------- | ------------------------- | ------------------------------------------------ |
| Buff 实例级 | `BuffInstance.condition`  | **链条件、阶条件（硬性，且二选一）** + 类型/属性 |
| 乘区级      | `BuffZoneValue.condition` | 伤害类型、伤害属性                               |

```ts
interface BuffCondition {
    logic?: 'and' | 'or' // 子句之间：全部满足 / 满足任一（默认 and）
    chains?: { charIdx: number; min: number }[]
    refinements?: { charIdx: number; min: number }[]
    elements?: string[]
    damageTypes?: string[]
}
```

### 分层裁剪

`normalizeConditionForScope(cond, scope)` 保证约束不被绕过：

- `scope='buff'`：链/阶保留
- `scope='zone'`：链/阶**强制剥离**（`normalizeCondition` + `isConditionEmpty` 清理空条件）

### 链 / 阶互斥

- **编辑器**：选中链条件会清空全部阶条件，反之亦然，另一个下拉置灰
- **迁移**：若历史数据的同一个 Buff 同时带链与阶，`splitDualGateBuffs()` 拆成两个 Buff
  （名字加 `（链N）` / `（阶N）` 后缀避免重名，同名再加 `·2` 序号），两条都继承原绑定，**幂等**
- **运行时**：`evaluateCondition` 再做一道护栏 —— 若数据被其它途径写成了链阶并存，只判定链条件

### 链 / 阶档位真源

角色共鸣链与武器精炼档位的**真源是角色槽位**（`CharSlot.chain` / `CharSlot.refinement`），由「角色详情配置」
编辑；`conditionProfileFromTeam(team)` 把它派生成条件系统读取的 `ConditionProfile`，不参与任何变量机制。

## 3. 引用转模与跨角色副作用

`ZoneRef` 让某个乘区引用角色面板（`atkPct += 攻击白值 × pct%`、离散取整、上下限 clamp 等）。

- **本条目可见面板**：本角色槽位用该条目的 `partialStats`（只含绑定到本条目的 Buff），
  其它角色槽位沿用角色级 full stats —— 避免单条目绑定的 Buff 泄漏到其它条目的转模。
- **跨角色副作用**：若 B 的 Buff 引用了 A 的面板属性 X，而 A 上有 Buff 会改写 X，则配置 B 时也需要能配置 A 的那些 Buff。
  引擎侧由 `getPanelDependencies()` / `getBuffsAffectingPanel()` 给出依赖关系（`PANEL_TO_ZONES` 把面板属性映射到
  会改写它的乘区键），界面在引用配置弹窗与拉表页提示条中列出，可一键跳过去编辑。

## 4. 新增乘区的步骤

1. 在 `ZONE_DEFS`（`calculation.consts.ts`）加入 `{ id, label, unit }`
2. 在 `CharacterComputed`（`zone-ops.ts`）加字段与初值
3. 在 `ZONE_OPS` 注册 `add` / `override` 行为
4. 若是面板类属性，同步补进 `recomputeTotals` 与 `PANEL_TO_ZONES`
5. 若公式要用它，在 `compute.ts` 对应乘区函数里读取
6. 运行 `pnpm run format && pnpm run lint:eslint && pnpm run check`
