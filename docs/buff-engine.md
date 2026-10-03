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

- **贡献键 = 乘区键**（`ZoneId`）：`atkPct` / `bonusDmg` / `defPen` / `finalDmg` / `specialFinal2` … 见 `ZONE_DEFS`。
- 装备（武器/声骸）与内置源也走同一套乘区键，经 `applyEntryStatToAccum` 归一化后写入同一个累加器。
- `ResultEntry` 与界面数据形状保持不变，结果页 / 乘区溯源 / 副词条分析无需感知引擎内部结构。

### 乘区算子（`ZONE_OPS`）

每个乘区只声明一次它的语义，三条写入路径共用：

| 写入       | 用途                                                   |
| ---------- | ------------------------------------------------------ |
| `add`      | 追加累加（`specialFinal2` 为连乘）                     |
| `override` | 覆盖当前合计值（`BuffZoneValue.override`，优先于一切） |

`applyZone(acc, zoneId, value, 'add' | 'override')` 是唯一出口；`recomputeTotals(acc)` 在面板类乘区变化后
重算攻/生/防三维，保证引用转模读到最新面板。

### 目标侧乘区（挂目标身上，全队一份）

`TARGET_SIDE_ZONE_IDS` 里的乘区**不写角色面板**：目前只有**集谐·干涉层数**（`tuneStrainLayer`）——
游戏里它挂在目标/怪物身上，由队伍施加，所以：

- 引擎用 `targetSideZonesOf(candidates, profile, zoneCtx)` 从「绑定到本条目的 Buff」直接聚合，
  **不做作用域过滤**：一条「作用域=角色1」的集谐 buff 照样给全队提供层数；
- 因为它不分角色，`CharacterComputed` 与 `ZONE_OPS` 里**都没有** `tuneStrainLayer` 字段
  （写进去也没人读，故意不留）；
- 它也不能配引用、不能作为引用来源（见 `ZONE_NO_REF_IDS`）；
- 集谐区 = `1 + 0.12% × 该角色谐度破坏增幅 × 目标侧层数`：增幅仍按角色读，层数全队共用一份；
- 溯源里集谐层数的来源用 `getTargetSideSourceBuffs()` 取（可能挂在别的角色身上）。

### 系数基类条目（处决 / 响应 / 效应）的双暴

处决 / 响应 / 效应 / 偏谐系数直伤走 `computeTuneEntry` / `computeEffectEntry`（判据 `usesCoefficientFormula`），
它们的**双暴基准是 0% / 100%**（`critBase(coeffEntry=true)`，即「额外暴击伤害 +0%」）：

- **面板双暴不计入**：基础 5% / 150%、声骸与武器副词条、以及转模引用到的面板双暴都不参与
  （本角色槽位与跨角色引用同一口径，`buildEntryPanel` 一并不带双暴）；
- **双暴只有「覆盖」写入生效**（`COEFF_OVERRIDE_ONLY_ZONE_IDS`）：追加与引用一律不生效 ——
  这些条目不参与面板式累加，想给它们定一个双暴值，必须写一条明确的**覆盖**乘区
  （带引用的「覆盖」按引用处理，同样不生效）。暴击区仍是 `1 + 暴击率 × (暴击伤害 - 1)`；
- **暴击率为 0 时** `canCrit=false`：结果页「暴击 / 不暴击」两列显示占位符、溯源不出「暴击区」段、
  期望 = 不暴击 —— 与引入该能力之前的数值逐项一致；
- **拉表同步挡勾**：可用性判定 `buffUsableByEntry`（铺开表 / 下拉表共用，见 `damage-table.utils.ts`）
  把「对该条目不生效的乘区」算作不可用，因此**追加型暴击率 / 暴击伤害 buff 在这些条目上不可勾**
  （覆盖型可勾）；`EFFECT/TUNE_RELEVANT_ZONES` 仍列出双暴，是否可勾由 `zoneAppliesToCoeffEntry` 终判。

### 同一个 Buff 里的「同名乘区」

`zones` 是**贡献条目列表**，不是「乘区种类的集合」：同一个乘区可以出现多次，每条是独立贡献单元
（数值 / 引用 / 覆盖 / **自己的生效条件**）。判定口径：

```
if (链阶硬门槛满足 && 作用域匹配) {
    同乘区各条目：各自 add if 自身条件满足      // 满足的全部相加
    覆盖条目：最后替换该乘区合计               // 覆盖优先于一切
}
```

- 例：`暴击率+20 条件=导电` + `暴击率+10 条件=普攻` → 导电普攻 +30、仅导电 +20、仅普攻 +10、都不是 +0。
- **覆盖唯一**：同一 Buff 内每个乘区只允许一个覆盖条目（编辑器设覆盖时会取消同乘区其它条目的覆盖）；
  跨 Buff 允许并存，引擎按 Buff 进入计算的顺序依次写入 —— **后进入者最终生效**。
- 乘区分组见 `ZONE_SECTIONS`（基本固定值 / 基本百分比 / 双暴 / 常见增伤拐 / 特殊增伤拐或倍率提升 /
  倍率追加或锚定 / 使目标 / 对目标 / 层数相关独立终伤）；旧 id `customFinalDmg` / `customFinalDmgMul`
  经 `LEGACY_ZONE_IDS` 重映射为 `specialFinal1` / `specialFinal2`（v3 → v4 迁移）。

左侧 Buff 列表的三级归类见 `src/lib/calc/buff-tree.ts`：一级全局 Buff；二级「角色名X链」与「角色名的武器名」
（链条件按门槛值升序、武器目录按**角色+武器**划分而**不按阶数**划分，同角色内链目录在前）；三级「前缀+数字+后缀」
相同的 ≥2 条自动归档并按键数字升序。拖拽 Buff/目录时列表自动收起所有文件夹。

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
    chains?: { charIdx: number; min: number }[]
    refinements?: { charIdx: number; min: number }[]
    elements?: string[]
    damageTypes?: string[]
}
```

### 组合口径（固定，无可选项）

**类内「或」、类间「与」**：

| 类别             | 内部                   | 类别之间                    |
| ---------------- | ---------------------- | --------------------------- |
| 伤害类型（多选） | 或（任一命中）         | 与                          |
| 伤害属性（多选） | 或（任一命中）         | 与                          |
| 链 / 阶门条件    | 与（同类子句全部满足） | 与（且与类型/属性同时满足） |

- 链条件与阶条件**二选一**（见下）；需要条目上下文的子句在角色级聚合（无条目上下文）时视为不满足。
- 乘区级条件不满足时只有该乘区不计入，同一条目其它乘区照常生效。
- **溯源同口径**：来源列表里的乘区标签会带上该乘区自己的条件前缀（`加成` → `冷凝加成` / `声骸加成` /
  `共技·冷凝加成`，文案与乘区徽标 `describeZoneConditionBadge` 完全一致，伤害类型简称在前、属性在后），
  且**条件不满足的乘区不列为来源** —— 判据与引擎共用 `zoneConditionMet`，保证「来源之和 = 该乘区数值」。
  系数基类条目（处决/响应/效应）的 `ResultEntry.damageTypes` 为空，溯源必须用 `resolveDamageTypes` 现解析后再判。

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

## 3. 引用转模与跨角色「影响源」

`ZoneRef` 让某个乘区引用角色面板（`atkPct += 攻击白值 × pct%`、离散取整、上下限 clamp 等）。

**口径：伤害是当下的，buff 也是当下的。**

- **本条目可见面板**：每个角色槽位的面板都只由**绑定到本条目**的 Buff 组成 ——
  本角色槽位用 `partialStats`，其它角色槽位由 `buildEntryPanel()` 按需现算（同一槽位带缓存）。
  因此：
    - 某角色在**它自己其它条目**上勾的 Buff **不会**泄漏到本段的转模读数；
    - 把「作用域指向被引用角色」的 Buff **勾到本段**上，它就会参与该角色在这一段的面板计算（勾了才生效，且不重复计算）。
- **影响源（界面）**：`getPaneEffectSources(entryId)` 给出「会改写本段所引用面板」的 Buff 列表
  （`buffId → { 被引用角色槽位, 被改写的面板乘区键 }`，映射表 `PANEL_TO_ZONES` 把面板属性映射到会改写它的乘区键）。
  它们作为**普通可勾选项**出现在拉表里 —— 平铺模式下是该角色组内的列（表头带 `mdi:transit-connection-variant` 标记），
  下拉模式下是该条目 BUFF 区里的 chip；引用配置弹窗里不再显示任何副作用列表。
- **溯源只给结果**：溯源里的引用乘区展示的是**解算后的数值**（`compute.resolveRefZoneValues` 按「本条目可见面板」
  算出，与逐条目结算走同一条链路），不再展示转模规则文案（`TracePart.note` 已整体移除）；面板 chip 里的引用
  也按结果逐条列出，残差占位只剩「覆盖等」这类确实无法逐条列出的写入。
- **v2 → v3 迁移（`migrateV2toV3`）**：旧语义下被引用角色的面板由该角色**全部条目**上绑定的 Buff 组成，
  改口径后只勾在被引用角色身上的副作用 Buff 会突然失效。迁移用 `bindPaneEffectSources()` 把它们
  补勾到引用这些面板的伤害段上（`entryOwnersFromTimeline()` 从时间线推导条目归属）：
  只加不减、幂等、跳过全局 Buff 与自引用，且**不按条件过滤**（与旧语义跨条件变化保持等价）。
  纯逻辑集中在 `src/lib/calc/pane-effects.ts`，store、界面与迁移共用同一口径。

## 4. 新增乘区的步骤

1. 在 `ZONE_DEFS`（`calculation.consts.ts`）加入 `{ id, label, unit }`
2. 在 `ZONE_SECTIONS`（同文件）把它归入某个分区；不归入会兜底落到「其它」
3. 在 `CharacterComputed`（`zone-ops.ts`）加字段，并**补齐两处初值**：`emptyAccum()` 与
   `emptyCharacterStats()`（都在 `compute.ts`，漏一处 `svelte-check` 会报缺字段）
4. 在 `ZONE_OPS` 注册 `add` / `override` 行为（不注册会被 `applyZone` 静默忽略）
5. 若要让它成为**引用来源**（`ZONE_REF_DEFS`）：在 `compute.ts` 的 `REF_STAT_MAP` 登记
   「来源 id → `CharacterComputed` 字段」（漏了这一步引用恒读 0，且不会报错），并补进
   `pane-effects.ts` 的 `PANEL_TO_ZONES`（让「会改这个值的 Buff」能被识别成影响源）；
   面板类属性还要补进 `recomputeTotals`
6. 若公式要用它，在 `compute.ts` 对应乘区函数里读取
7. **同步 share 端**：`wuwa-afyg-share/src/lib/consts/buff-zones.ts` 的 `BUFF_ZONES` 与
   `BUFF_ZONE_SECTIONS`（两端的 zoneId 白名单必须一致，否则工坊存下的数据工具箱认不全）
8. 若同步给 AI 使用，补 `docs/tools.md` 与 `src/lib/ai/tools/calculation.ts` 的 zoneId 清单
9. 运行 `pnpm run format && pnpm run lint:eslint && pnpm run check`

> **引用（转模）默认开放**：新乘区不必做任何事即可被引用。只有确实需要「只允许固定值」的乘区
> 才加进 `ZONE_NO_REF_IDS` —— 目前只有 `tuneStrainLayer`（集谐干涉层数）在名单里；同奏增益层数可引用。
