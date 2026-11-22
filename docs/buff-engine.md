# 计算引擎：一切皆 Buff

「一切皆 Buff」引擎的数据模型、乘区算子与条件系统。

| 文件                                                                        | 职责                                                                       |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`src/coconut-core/actions.ts`](../src/coconut-core/actions.ts)             | **Buff 作用注册表**（落点 / 合并语义 / 初值 / 可覆盖 / 可挂条件 / 可引用） |
| [`src/lib/calc/calculation.types.ts`](../src/lib/calc/calculation.types.ts) | Buff / 乘区 / 条件的类型定义                                               |
| [`src/coconut-core/panel.ts`](../src/coconut-core/panel.ts)                 | 面板结构与作用写入（`emptyPanel` / `applyZone` / `recomputeTotals`）       |
| [`src/lib/calc/condition.ts`](../src/lib/calc/condition.ts)                 | 乘区级条件求值与归一化                                                     |
| [`src/lib/calc/rules.ts`](../src/lib/calc/rules.ts)                         | Buff 级规则（求值 / 依赖 / 级联 / 文案）                                   |
| [`src/coconut-core/compute.ts`](../src/coconut-core/compute.ts)             | 贡献聚合与逐条目计算                                                       |
| [`src/migration/`](../src/migration)                                        | 历史数据迁移（版本链、拉表态、Buff 文件夹命名、v7 规则化 / v8 伤害名正则） |

## 统一模型

所有影响伤害的东西都是 **Buff 类实例**（`BuffInstance`）：角色面板、武器、声骸、敌人配置、公式固有乘区、用户 Buff。它们只通过**贡献**进入引擎：

```text
DamageEntry ──┐
              ├─→ boundBuffs(条目 × 角色 × 条件) ─→ 生效变体 ─→ 作用写入 ─→ CharacterPanel ─→ ResultEntry
BuffInstance ─┘
```

| 概念          | 说明                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 写入键        | 作用 id（`ActionId`，字符串或 symbol）：`atkPct`/`bonusDmg`/`defPen`/`finalDmg`/`specialFinal2`…                                   |
| 「乘区」      | 只指公式链上的乘子（增伤区/防御区/暴击区…）；Buff 能施加的东西叫**作用**                                                           |
| 注册表字段    | 只放内核读的（`side`/`combine`/`panel`/`overridable`/`init`/`initCoeff`/`targetField`）；展示名/分组/单位在 `calc/display-meta.ts` |
| 装备词条      | 经 `applyEntryStatToAccum` 归一化后写入同一面板                                                                                    |
| 面板          | `zones: Record<ActionId, number>` + `base`（白值）+ `total`（合计）；维度由 `PANEL_CONFIG.dims`（atk/hp/def）给                    |
| 目标面板      | `TARGET_FIELDS`：`defense`/`dmgReduction`/`coefficient` 标量、`type` 文本、`resistance` 按元素分组；内核按 `kind` 分派             |
| 元素/类型加成 | 工具箱做法：存 `AppPanel`，写进 `bonusDmg` 后内核只认那一个作用                                                                    |
| `ResultEntry` | 结果页/乘区溯源/贡献分析唯一消费的数据形状；只读它，不感知引擎内部结构                                                             |
| 结构化真源    | `formula`（哪条公式）、`panel`（三维白值/合计/作用落值）、`multiplierZones`（乘子链）；`baseAtk` 等平铺字段是兼容层                |
| 乘区展示      | 结构化 `MultiplierDisplay`（`delta`/`factor`/`deltaWhenActive`）；本地化文案由界面 `formatMultiplierDisplay` 生成                  |

贡献分析执行：

| 项   | 说明                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| 基线 | 结果页把自己的 `computeAll` 输出经 `baselineEntries` 传入；没拿到时才内部跑一次                             |
| 线程 | 在 Worker（`substat-algorithms/analysis.worker.ts`）算；不可用时回退主线程分片                              |
| 等价 | 两路径共用 `prepareContributionAnalysis` + `runContributionSteps`（`analysis-runner.test.ts` 钉住）         |
| 克隆 | `$state` 代理派发前用 `$state.snapshot` 转纯数据；Worker 无 `localStorage`，模块顶层读存储走 `safe-storage` |

### 作用写入 applyZone

`applyZone(panel, actionId, value, 'add' | 'override')` 是唯一出口；`recomputeTotals` 在面板类作用变化后重算三维。

| 声明                            | `add`                | `override`          |
| ------------------------------- | -------------------- | ------------------- |
| `combine: 'sum'`                | `v += value`         | `v = value`         |
| `combine: 'sum'` + 不可覆盖     | `v += value`         | 同 `add`（退让）    |
| `combine: 'multiply'`           | `v *= 1 + value/100` | `v = 1 + value/100` |
| 声明 `panel.total` 的三维固定值 | `v += value`         | 直接写三维合计      |

注册表两项能力位（界面与引擎共用，非引擎 gate）：

| 能力              | 含义                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `overridable`     | 界面是否给「覆盖」开关                                                                         |
| `damageMatchable` | 能否挂「伤害匹配」条件（属性/类型）。热熔加成/暴击率成立；热熔共鸣效率/集谐层数/同奏层数不成立 |

### 目标侧作用

`side: 'target'` 的作用不写角色面板，目前只有**集谐·干涉层数**（`tuneStrainLayer`，游戏里挂目标/怪物、由队伍施加）：

| 项         | 说明                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------ |
| 聚合       | `targetSideZonesOf` 从绑定到本条目的 Buff 直接聚合，**不做作用域过滤**（角色1 的 buff 也给全队） |
| 面板       | `CharacterPanel.zones` 里没有它（写进去也没人读）                                                |
| 引用       | 不能作为引用写入目标（`ZONE_NO_REF_IDS` 由 `side: 'target'` 派生）                               |
| 集谐区公式 | `1 + 0.12% × 该角色谐度破坏增幅 × 目标侧层数`：增幅按角色读，层数全队共用                        |
| 溯源       | 层数来源用 `getTargetSideSourceBuffs()` 取（可能挂别的角色身上）                                 |

### 集谐区与谐度区

同一个 `tuneBreakBoost`（谐度破坏增幅）在两个乘区里角色不同，**分开展示**：

| 乘区   | 公式                                       | 吃它的条目                                |
| ------ | ------------------------------------------ | ----------------------------------------- |
| 集谐区 | `1 + 0.12% × 谐度破坏增幅 × 集谐·干涉层数` | 直伤 / 处决 / 偏谐响应 / 效应（四条都带） |
| 谐度区 | `1 + 谐度破坏增幅%`                        | 处决 / 偏谐响应专属                       |

`ResultEntry` 用两个 delta 字段分别承载（`finalTuneStrainMulti` / `finalTuneBreakZone`），溯源 `buildDamageSegments` 产出两段（`tune`/`tuneBreak`）。

### 四条公式吃的乘区

公式链只在 `FORMULAS` 的 `chain` 声明一次，界面可用性（`formulaActionClosure`）与溯源段（`buildDamageSegments`）都从它派生：

| 公式                   | 覆盖                     | 不吃       | 额外   |
| ---------------------- | ------------------------ | ---------- | ------ |
| `direct` 直伤          | 除谐度区外的全部乘区     | 谐度区     | —      |
| `tune` 处决 / 偏谐响应 | 除**增伤区**外的全部乘区 | **增伤区** | 谐度区 |
| `effect` 效应          | 除**增伤区**外的全部乘区 | **增伤区** | —      |
| `fixed` 固定值         | 空链                     | 全部       | —      |

系数基类（处决 / 响应 / 效应）**只不吃增伤区**：加深区、易伤·免伤区、集谐区、终伤区、特殊区、双暴区（处决/响应另有谐度区）照常参与。增伤区排除是因为这几类条目的「加成」不属面板增伤。

### 系数基类条目的双暴

处决 / 响应 / 效应走 `computeTuneEntry` / `computeEffectEntry`（判据 `usesCoefficientFormula`），双暴基准 **0% / 100%**：

| 项           | 说明                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------- |
| 面板双暴     | 不计入：基础 5%/150%、声骸与武器副词条、转模引用的面板双暴都不参与                            |
| 只有覆盖生效 | `COEFF_OVERRIDE_ONLY_ZONE_IDS`：追加与引用一律不生效，要定双暴值必须写一条明确的**覆盖**乘区  |
| 暴击区       | 仍为 `1 + 暴击率 × (暴击伤害 - 1)`                                                            |
| 暴击率 0     | `canCrit=false`：结果页「暴击/不暴击」显示占位符、溯源不出暴击区段、期望=不暴击               |
| 拉表挡勾     | `buffUsableByEntry` 把不生效乘区算不可用：追加型暴击率/暴伤 buff 在这些条目不可勾，覆盖型可勾 |

### 等效暴击率

暴击区 = `1 + 等效暴击率 × (暴击伤害 - 1)`；`effectiveCritRate`（[`src/coconut-config/multipliers.ts`](../src/coconut-config/multipliers.ts)）把面板暴击率钳在 0–100：低于 0 必不暴（乘子 1），高于 100 必暴（乘子 = 暴伤比值）。

`zones.critRate` 原值**不裁剪**：负值与 >100 都保留，引用读的就是原值——「暴击超过 100 的部分转暴伤」靠 `StatRef` 读 `critRate` 再减 `baseLine: 100`。结果页 `critRate` 字段是等效值（0–1），原值从 `panel.zones.critRate` 取。

### 同名乘区

`zones` 是**贡献条目列表**，同一乘区可出现多次，每条带自己的数值 / 引用 / 覆盖 / 生效条件：

```ts
if (链阶硬门槛满足 && 作用域匹配) {
    同乘区各条目：各自 add if 自身条件满足      // 满足的全部相加
    覆盖条目：最后替换该乘区合计               // 覆盖优先于一切
}
```

| 项       | 说明                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| 示例     | `暴击率+20 条件=导电` + `暴击率+10 条件=普攻` → 导电普攻 +30、仅导电 +20、仅普攻 +10、都不是 +0                            |
| 覆盖唯一 | 同 Buff 内每乘区只允许一个覆盖条目；跨 Buff 并存时按进入计算顺序写入，**后进入者最终生效**                                 |
| 分组     | 注册表的 `group`：基本固定值/基本百分比/双暴/常见增伤拐/特殊增伤拐或倍率提升/倍率追加或锚定/使目标/对目标/层数相关独立终伤 |
| 旧 id    | v3 的 `customFinalDmg`/`customFinalDmgMul` 经 `LEGACY_ZONE_IDS` 重映射为 `specialFinal1`/`specialFinal2`                   |

### Buff 树与归属

左侧 Buff 弹窗分 `全局`/`非全局` 两个页签，各一棵树，`CalcState.buffTree` 随工程保存：

```ts
type BuffTreeNode =
    | { kind: 'folder'; id: string; name: string; children: BuffTreeNode[] }
    | { kind: 'buff'; id: string; buffId: string }
interface BuffTreeState {
    global: BuffTreeNode[]
    nonGlobal: BuffTreeNode[]
}
```

| 项        | 说明                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| 结构      | 最多两级文件夹；Buff 在根/一级/二级；文件夹名自定义，图标由后代 Buff 派生               |
| 全局树    | 受保护：文件夹与 Buff 不可删，只能改名/排序/移出；非全局树可递归删                      |
| 拖拽      | 同容器排序走 `reorderBuffTreeChildren`，跨容器走 `moveBuffTreeNode`，拖到文件夹头即移入 |
| 全名真源  | `BuffInstance.name` 与工坊 `buff_sets.buff_name` 持久化为 `文件夹A\文件夹B\buff名`      |
| 改名/移动 | 级联重写后代全名；普通列表显短名，结果溯源显全名；短名与文件夹名允许 `/`、禁止 `\`      |

平铺表细节：

| 项         | 说明                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 列序       | 根上 Buff 排最左；全局 Buff 不占列、无顶部条带                                                                |
| 表头       | 按一级/二级/Buff 路径独立纵向均分；可切「简略」隐藏首行/次行                                                  |
| 不达门槛列 | 设置可切显示/隐藏；隐藏后只留「至少一行达标」的列，显示时未达标格用圆点（已勾选=主题色实心、未勾选=灰色空心） |
| 单元格状态 | 结构层 `enabled`/`hardOk`（与勾选无关）；渲染层 `rulesMetOf`（依赖勾选，渲染可见格时现算并缓存）              |
| 分段平铺   | 按时间记点切段；只有「选中来源」行可勾 Buff；列 = 选中来源可吃到的 Buff 并集 ∪ 影响源并集                     |
| 行头副行   | 可编辑行显伤害类型（手填+自动推导灰字）；灰化行显伤害源                                                       |

### 本地 Buff 库与内置源

| 项       | 说明                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| 本地库   | `buff-library.svelte.ts` 实体增一级 `folders`；工坊来源只读，自定义实体本地建/改名/删/移                          |
| 工坊同步 | 按实体整份覆盖 Buff 与文件夹；导入工程丢弃工坊路径，取短名按实体来源拼新全名                                      |
| 内置源   | 角色白值/武器/声骸/敌人面板/公式固有乘区**不是**可编辑 Buff；角色侧由 `CharacterPanel` 承载，敌人侧由工程配置承载 |

## 条件系统

条件按**挂载位置**分层：

| 层级    | 字段                      | 可配置条件                                                         |
| ------- | ------------------------- | ------------------------------------------------------------------ |
| Buff 级 | `BuffInstance.rules`      | 链 / 阶 / 伤害名 / 角色面板 / 敌人类型 / Buff 依赖（**全部 AND**） |
| 乘区级  | `BuffZoneValue.condition` | 伤害类型、伤害属性                                                 |

```ts
// 乘区级：只有伤害属性 / 伤害类型（链/阶属 Buff 级规则）
interface BuffCondition {
    elements?: string[]
    damageTypes?: string[]
}

// Buff 级：discriminated union，一条 Buff 可挂多条，规则之间全部 AND
type BuffRule =
    | { kind: 'chain'; charIdx: number; min: number }
    | { kind: 'refinement'; charIdx: number; min: number }
    | { kind: 'damageNameRegex'; pattern: string } // 对 displayName 正则包含匹配；全等用 ^…$
    | { kind: 'zoneCompare'; charIdx: number; zone: ZoneCompareId; op: ZoneCompareOp; value: number }
    | { kind: 'enemyType'; type: 'BOSS' | '精英怪' | '小怪' }
    | { kind: 'buffActive'; mode: 'all' | 'any'; buffIds: string[] }
```

| 规则            | 说明                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| 链与阶并存      | v7 起两者都是 Buff 级规则，可同时挂                                                                          |
| `zoneCompare`   | `charIdx = -1` 指出伤角色；读**无条件部分**面板（装备+其它 Buff 固定乘区）                                   |
| 面板计入        | 作用域覆盖该角色、规则不含 `buffActive`、其它非面板规则（链/阶/伤害名/敌人类型）成立；带链门槛的产层源也算数 |
| 面板排除        | 带属性/类型条件的乘区条目、带引用的条目                                                                      |
| 不含本 Buff     | `statsOf(charIdx, excludeBuffId)` 减掉本 Buff 的乘区，是自封顶（每层+1、至多 4 层）成立的前提                |
| 自封顶逐源自判  | 产层源 ≤ 上限正确；超过上限时每个源看到「其它源已满」会全部关闭（层数归零）；按上限数量配置产层源            |
| `buffActive`    | 按最小不动点求值（`resolveActiveBuffIds`）；创建期禁止自引用与间接循环（`cyclePathOf`）                      |
| 删除被依赖 Buff | `buffDeleteCascadeOf` 列出级联依赖方并二次确认；`pruneRuleDependencies` 剪掉已删项                           |

### 组合规则

类内「或」、类间「与」（仅乘区级；Buff 级规则一律 AND）：

| 类别             | 内部           | 类别之间               |
| ---------------- | -------------- | ---------------------- |
| 伤害类型（多选） | 或（任一命中） | 与                     |
| 伤害属性（多选） | 或（任一命中） | 与                     |
| Buff 级规则      | —（每条独立）  | 与（全部规则同时满足） |

| 项           | 说明                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| 缺条目上下文 | 需条目上下文的子句（伤害名/属性/类型）在角色级聚合时不构成否定；`buffActive` 缺 `activeOf` 视为不生效       |
| 条件不满足   | 只有该乘区不计入，同条目其它乘区照常                                                                        |
| 溯源规则一致 | 来源标签带该乘区条件前缀（`describeZoneConditionBadge`），条件不满足的不列为来源（共用 `zoneConditionMet`） |
| 拉表过滤一致 | `buffMatchesEntry` 上下文是引擎 `zoneCtx`（element + 解析后伤害类型），非直伤条目也要传                     |

### 分层裁剪与迁移

| 项                   | 说明                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `normalizeCondition` | 乘区级只留 `elements`/`damageTypes`，其余字段丢弃                                                        |
| `normalizeRules`     | Buff 级归一化，非法正则/空引用/越界槽位丢弃                                                              |
| v7 迁移              | 实例级 `chains`/`refinements` 转成 `chain`/`refinement` 规则；实例级 `elements`/`damageTypes` 下放到乘区 |
| v8 迁移              | `damageNameEquals` 转义正则元字符后写成 `^…$`；模型与界面只留正则                                        |
| 链/阶真源            | 角色槽位 `CharSlot.chain`/`refinement`，由「角色详情配置」编辑，`conditionProfileFromTeam` 派生          |

### 生效成员（作用域四态）

`BuffInstance.scope` 四种语义（`classifyBuffScope` 归类）。叫法全项目统一：`'all'` 叫**通用**，`[0,1,2]` 叫**全队**，不是同义词：

| 取值      | 含义                        | 效应伤害 | 勾选的角色 |
| --------- | --------------------------- | -------- | ---------- |
| `'all'`   | **通用**（三名角色 + 效应） | 是       | 全部       |
| `[0,1,2]` | **全队**（不含效应）        | 否       | 全部       |
| `[]`      | 仅效应                      | 是       | 无         |
| 子集数组  | 指定角色                    | 否       | 子集       |

状态迁移：勾效应=通用；通用取消效应=全队；仅效应取消效应=禁止（至少留一个成员）；通用取消一个角色=取消效应+留剩余；取消最后一角=仅效应。新建默认 `'all'`。

Buff 库作用域是导入源语义，由 `mapImportedScope` 落表：`team`=通用、`team_only`=全队、`effect_only`=仅效应、`self`/`self_except`=角色子集。

### Buff 集模板条件

Buff 集（`buff/library-condition`）存模板，与工程共用 `BuffRule` 形状，两点差别：

| 项         | 说明                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| 规则       | 5 种：`chain`/`refinement`/`damageNameRegex`/`zoneCompare`/`enemyType`；`buffActive` 不入库                  |
| 归属       | `0`=本角色（导入按实体归属重指）、`-1`=出伤者；`chain`/`refinement` 在库里一律 `charIdx = 0`                 |
| 属性白名单 | 排除 `unisonBoonLayer`/`tuneBreakBoost`（自封顶依赖跨 Buff 聚合，模板表达不出）                              |
| 导入       | `rewriteOwnerInRules` 把「本角色」重指真实槽位，`-1` 与归属无关；工坊侧 rules 在 `buff_sets.condition.rules` |

## 引用转模与影响源

`ZoneRef` 让某乘区引用角色面板（`atkPct += 攻击白值 × pct%`、离散取整、上下限 clamp）。原则：**伤害是当下的，buff 也是当下的**。

| 项             | 说明                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| 本条目可见面板 | 每角色槽位面板只由**绑定到本条目**的 Buff 组成：本槽用 `partialStats`，其它槽 `buildEntryPanel()` 现算（带缓存） |
| 不泄漏         | 某角色在它自己其它条目勾的 Buff 不泄漏到本段转模读数                                                             |
| 影响源生效     | 把「作用域指向被引用角色」的 Buff 勾到本段，它才参与该角色这一段面板计算（勾了才生效、不重复）                   |
| 引用归属       | `0..2`=指定槽位；`-1`=出伤者（归一到 `charIndex`，直接返回本条目 `partialStats`，不作为影响源）                  |
| 全局自动绑定   | `rebindGlobalBuffs` 还绑到「引用该作用域角色的条目」，否则队友引用主人面板时少算                                 |
| 影响源界面     | `getPaneEffectSources` 给出改写本段所引用面板的 Buff，作为普通可勾选项出现在拉表（列名带连接图标）               |
| 溯源           | 引用乘区展示解算后数值（`resolveRefZoneValues`），无转模规则文案                                                 |
| v2→v3 迁移     | `bindPaneEffectSources` 把只勾在被引用角色的副作用 Buff 补勾到引用其面板的伤害段；只加不减、幂等、不按条件过滤   |

### 数字前后缀迁移

工程迁移 `migrateLegacyBuffTree` 把「前缀+数字+后缀」命名整理成数字文件夹：

| 规则         | 说明                                                                 |
| ------------ | -------------------------------------------------------------------- |
| 切分         | 只切**最后一段**连续数字；空前缀（`1层`/`2阶`）不建文件夹、名字不改  |
| 归并键       | 前缀+后缀；同父容器同键 ≥2 条才建文件夹                              |
| 文件夹名     | 用前缀；撞名第二组起补 `（后缀）`，仍撞名加 `#`                      |
| 子 Buff 改名 | 真改名为 `${条件文件夹}\${数字文件夹}\${数字}${后缀}`                |
| 排序         | 数字升序再后缀；撞名追加 `#`                                         |
| 位置         | 条件文件夹一级、数字文件夹二级；无条件的数字文件夹直接一级           |
| 导入不做     | 只取工坊短名按实体来源拼新全名（本体/链/武器/声骸/套装），撞名加 `#` |

## 新增「Buff 作用」步骤

| 步  | 操作                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `registry/actions.ts` 的 `BUFF_ACTIONS` 加一行：`id`/`label`/`unit`/`group`/`side`/`combine`/`panel?`/`overridable`/`damageMatchable`/`init`（系数基类另给 `initCoeff`）。此后界面右栏、分区、覆盖开关、条件显隐、面板写入、三维派生自动跟上 |
| 2   | 可被引用 → 加 `ref: { label }`；会被哪些作用改写由 `panel` 声明自动推导                                                                                                                                                                      |
| 3   | 公式要用 → `compute.ts` 乘子算式读 `stats.zones.<id>`                                                                                                                                                                                        |
| 4   | 同步 share 端 `wuwa-afyg-share/src/lib/consts/buff-zones.ts` 的 `BUFF_ZONES`/`BUFF_ZONE_SECTIONS`（两端白名单一致）                                                                                                                          |
| 5   | `pnpm run format && lint:eslint && check && pnpm test`（`check-no-hardcoded-ids` 拦实体名字面量）                                                                                                                                            |

引用（转模）默认开放：作用加 `ref` 即可被引用。目标侧作用由 `side: 'target'` 自动排除，不另设名单。
