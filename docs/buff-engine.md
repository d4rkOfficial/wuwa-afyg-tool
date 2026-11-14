# 计算引擎：一切皆 Buff

本文档描述「一切皆 buff」的伤害计算引擎：数据模型、乘区算子与条件系统。

> 相关源码
>
> | 文件                                   | 职责                                                                         |
> | -------------------------------------- | ---------------------------------------------------------------------------- |
> | `src/lib/calc/calculation.types.ts`    | Buff / 乘区 / 条件的类型定义                                                 |
> | `src/lib/calc/zone-ops.ts`             | **乘区算子唯一维护点**（`ZONE_OPS`）                                         |
> | `src/lib/calc/builtin-buff-sources.ts` | 内置 Buff 源清单（角色/武器/声骸/敌人 + 公式固有乘区）                       |
> | `src/lib/calc/condition.ts`            | 乘区级条件（属性 / 类型）求值与归一化                                        |
> | `src/lib/calc/rules.ts`                | Buff 级规则（求值 / 依赖 / 级联 / 文案）                                     |
> | `src/lib/calc/compute.ts`              | 贡献聚合与逐条目计算                                                         |
> | `src/migration/`                       | 历史数据迁移（版本链、拉表态、Buff 文件夹命名、v7 规则化 / v8 伤害名并正则） |

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
- `ResultEntry` 是结果页 / 乘区溯源 / 贡献分析唯一消费的数据形状：它们只读 `ResultEntry`，不感知引擎内部结构。
  贡献分析（副词条 / Buff）另走「改动入参 → `computeOneEntry` 重算 → 差值」这一条路径，与结果页同一实现。

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

### 集谐区与谐度区是两个独立乘区

同一个 `tuneBreakBoost`（谐度破坏增幅）在两个乘区里扮演不同角色，**不能合并展示**：

| 乘区   | 公式                                       | 吃它的条目                            |
| ------ | ------------------------------------------ | ------------------------------------- |
| 集谐区 | `1 + 0.12% × 谐度破坏增幅 × 集谐·干涉层数` | 直伤（`computeResultEntry`）          |
| 谐度区 | `1 + 谐度破坏增幅%`                        | 处决 / 偏谐响应（`computeTuneEntry`） |

`ResultEntry` 用两个 delta 字段分别承载（`finalTuneStrainMulti` / `finalTuneBreakZone`，互斥使用），
乘区溯源 `buildDamageSegments` 也据此产出**两段**（`tune` = 集谐区、`tuneBreak` = 谐度区）；
谐度破坏增幅的来源只在对应段落列出 —— 把处决/响应的 `1 + 增幅%` 并进集谐区是错的。

### 系数基类条目（处决 / 响应 / 效应）的双暴

处决 / 响应 / 效应 / 偏谐系数直伤走 `computeTuneEntry` / `computeEffectEntry`（判据 `usesCoefficientFormula`），
它们的**双暴基准是 0% / 100%**（`critBase(coeffEntry=true)`，即「额外暴击伤害 +0%」）：

- **面板双暴不计入**：基础 5% / 150%、声骸与武器副词条、以及转模引用到的面板双暴都不参与
  （本角色槽位与跨角色引用同一口径，`buildEntryPanel` 一并不带双暴）；
- **双暴只有「覆盖」写入生效**（`COEFF_OVERRIDE_ONLY_ZONE_IDS`）：追加与引用一律不生效 ——
  这些条目不参与面板式累加，想给它们定一个双暴值，必须写一条明确的**覆盖**乘区
  （带引用的「覆盖」按引用处理，同样不生效）。暴击区仍是 `1 + 暴击率 × (暴击伤害 - 1)`；
- **暴击率为 0 时** `canCrit=false`：结果页「暴击 / 不暴击」两列显示占位符、溯源不出「暴击区」段、
  期望 = 不暴击 —— 这些条目的数值不随面板双暴变化；
- **拉表同步挡勾**：可用性判定 `buffUsableByEntry`（分类/分段平铺共用，见 `damage-table.utils.ts`）
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
  倍率追加或锚定 / 使目标 / 对目标 / 层数相关独立终伤）；v3 的 `customFinalDmg` / `customFinalDmgMul`
  经 `LEGACY_ZONE_IDS` 重映射为 `specialFinal1` / `specialFinal2`（v3 → v4 迁移）。

左侧 Buff 列表与拉表列序都来自工程内**显式存储的树** `CalcState.buffTree`（`{ global, nonGlobal }` 两个根），
纯逻辑在 `src/lib/calc/buff-tree-state.ts`。树最多两级文件夹，Buff 可落在根 / 一级 / 二级；文件夹名可自定义，
图标由后代 Buff 派生（同角色纯链 → 头像 + 链范围、同角色纯阶 → 武器 + 阶范围、混合/跨角色 → generic、
纯效应 → `mdi:auto-fix`）。拖拽 Buff/目录时列表自动收起所有文件夹。

**全名是 Buff 归属的唯一真源**：`BuffInstance.name` 与工坊 `buff_sets.buff_name` 都持久化为
`文件夹A\文件夹B\buff名`（根 Buff 无分隔符）。`buffTree` / `buff_folders` 只负责文件夹节点、排序与空文件夹；
成员按名字的 `\` 前缀归属。文件夹改名 / 移动 / Buff 移动时级联重写后代全名；普通列表显示最后一段短名，
结果溯源显示全名。Buff 短名与文件夹名允许 `/`、禁止 `\`。

### 本地 Buff 库（工坊来源）

`src/lib/data/buff-library.svelte.ts` 的实体增加一级 `folders`（含空文件夹/排序），Buff 名同样是全名。
工坊来源实体的结构以工坊为准、本地只读；自定义实体可在本地建 / 改名 / 删除 / 移动文件夹。
从工坊同步按实体整份覆盖 Buff 与文件夹；导入工程时**丢弃工坊路径**，只取短名后按实体来源（角色本体 / 链 / 武器 / 声骸 / 套装）拼新全名。

### 内置 Buff 源

`BUILTIN_BUFF_SOURCES`（角色/武器/声骸/敌人/谐度）与 `FORMULA_ZONES`（倍率·暴击·防御·抗性·免伤·增伤·
加深·易伤·集谐·谐度·同奏·终伤·特殊）在界面上不作为可编辑 Buff 出现，但在乘区溯源里以同一口径列出。

## 2. 条件系统

条件按**挂载位置**分层，能力不同：

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

// Buff 级：discriminated union，一条 Buff 可挂多条，**规则之间全部 AND**
type BuffRule =
    | { kind: 'chain'; charIdx: number; min: number }
    | { kind: 'refinement'; charIdx: number; min: number }
    | { kind: 'damageNameRegex'; pattern: string } // 对条目 displayName 做正则**包含**匹配；全等用 ^…$
    | { kind: 'zoneCompare'; charIdx: number; zone: ZoneCompareId; op: ZoneCompareOp; value: number }
    | { kind: 'enemyType'; type: 'BOSS' | '精英怪' | '小怪' }
    | { kind: 'buffActive'; mode: 'all' | 'any'; buffIds: string[] }
```

- **链与阶可以并存**（v7 起两者都是 Buff 级规则，可同时挂；双条件 Buff 不需要拆成两条，已拆开的保持拆分、不自动回并）。
- `zoneCompare` 的 `charIdx = -1` 表示「伤害条目的角色」；数值单位与面板显示一致
  （攻/生/防/谐度增幅/同奏层数为整数，充能/偏谐效率/暴击率/暴伤为百分比）。
  读的是**「无条件部分」面板** = 装备 + 其它 Buff 的固定乘区，口径如下：
    - **计入**：作用域覆盖该角色；规则里**不含 `buffActive`**（那需要「哪些 Buff 生效」这个结论，与面板互递归）；
      除 `zoneCompare` 外的规则（链 / 阶 / 伤害名 / 敌人类型）在该条目上成立 —— 这些规则都不读面板，可安全判定。
      因此**带链门槛的产层源也算数**（同奏层数这类「由 Buff 产出的面板值」必须靠这一条才能被门槛看到）。
    - **排除**：带属性/类型条件的乘区条目、带引用的条目（引用要读别人的面板，可能再触发规则判定）。
    - **不含本 Buff 自身**：`statsOf(charIdx, excludeBuffId)` 会把该 Buff 的乘区从面板里减掉
      （普通加算直接减法；覆盖写入与 `specialFinal2` 连乘退回整表重算）。
      这是「每层 +1 层、至多 4 层」这类**自封顶**能成立的前提：判定时看到的是「其它源的层数」。
        > 自封顶是**逐源自判**的：产层源数量 ≤ 上限时结果正确（4 个源 × `lt 4` → 4 层）；
        > 数量超过上限（5 个源 × `lt 4`）时每个源都会看到「其它源已满」而**全部关闭**（层数归零）。
        > 真正的「按上限截断」需要引擎侧 clamp（数据模型目前没有），请按上限数量配置产层源。
        > 该面板只排除本 Buff 自身，不排除「所有带 rules 的 Buff」—— 同奏层数的每个产层源都带自封顶规则，
        > 若一并排除，门槛读到的层数会恒为 0（`ge` 永远不满足、`lt` 永远满足），一整类层数门槛全部失效。
- `buffActive` 按**最小不动点**求值（`resolveActiveBuffIds`）：从「全部未生效」出发反复激活，
  只有 AND 与正极性引用，所以最小不动点即唯一解；脏数据里的循环引用会稳定落在「都不生效」上。
  创建期禁止直接自引用与间接循环（`cyclePathOf`，界面 toast 拒绝）。
- 删除被依赖的 Buff：先用 `buffDeleteCascadeOf` 列出将级联删除的依赖方并二次确认，
  确认后递归删除；`all` 规则引用任一被删即级联，`any` 规则在引用集合仍有存活项时保留依赖方
  （并把已删项从 `buffIds` 里剪掉，`pruneRuleDependencies`）。

### 组合口径（固定，无可选项）

**类内「或」、类间「与」**（仅乘区级；Buff 级规则一律 AND）：

| 类别             | 内部           | 类别之间               |
| ---------------- | -------------- | ---------------------- |
| 伤害类型（多选） | 或（任一命中） | 与                     |
| 伤害属性（多选） | 或（任一命中） | 与                     |
| Buff 级规则      | —（每条独立）  | 与（全部规则同时满足） |

- 需要条目上下文的子句（伤害名 / 属性 / 类型）在角色级聚合（无条目上下文）时**不构成否定**；
  `buffActive` 缺 `activeOf` 时视为「不生效」（只有引擎会提供存活集合）。
- 乘区级条件不满足时只有该乘区不计入，同一条目其它乘区照常生效。
- **溯源同口径**：来源列表里的乘区标签会带上该乘区自己的条件前缀（`加成` → `冷凝加成` / `声骸加成` /
  `共技·冷凝加成`，文案与乘区徽标 `describeZoneConditionBadge` 完全一致，伤害类型简称在前、属性在后），
  且**条件不满足的乘区不列为来源** —— 判据与引擎共用 `zoneConditionMet`，保证「来源之和 = 该乘区数值」。
  系数基类条目（处决/响应/效应）的 `ResultEntry.damageTypes` 为空，溯源必须用 `resolveDamageTypes` 现解析后再判。
- **拉表「可用Buff」过滤同口径**：`buffMatchesEntry` 的上下文就是引擎的 `zoneCtx`（`element` + **解析后**的
  伤害类型），**非直伤条目一样要传**（效应 → `效应伤害`；处决/响应 → 推断类型，由 `buildDamageTypesByEntry` 提供）。
  只传空上下文会让「需要条目上下文的子句视为不满足」，把带属性/类型条件的乘区全判成不匹配 ——
  症状是效应条目上带「导电/效应」条件的加深 buff 挂不上（引擎其实吃它）。

### 分层裁剪

乘区级条件由 `normalizeCondition(cond)` 统一裁剪：**只保留 `elements` / `damageTypes`**，
其余条件字段（`chains` / `refinements` / `chain` / `refinement` / `logic`）一律丢弃。
Buff 级规则由 `normalizeRules()` 归一化（非法正则、空引用集合、越界槽位直接丢弃）。

### Buff 集的条件口径（`calc/buff-library-condition`）

Buff 集（主页「Buff 集」/ 工坊 `buff_sets`）存的是**模板**，条件按模板能表达的形态裁剪，
与工程侧共用同一套 `BuffRule` 形状，差别只有两点：- **5 种规则**：`chain` / `refinement` / `damageNameRegex` / `zoneCompare` / `enemyType`。
`buffActive` 不入库 —— 它引用工程内 `buff.id`（导入时现生成），库内没有这个 id 空间，
且「只勾几条」的精细导入会让依赖项缺失。

- **归属只有两档**：`0` = **本角色**（导入时按实体归属重指：角色=本人、武器/声骸/套装=装配者）、
  `-1` = **出伤者**（本次伤害所属角色，`zoneCompare` 与 `ref` 同一口径）。
  `chain` / `refinement` 在库里一律 `charIdx = 0`。

`zoneCompare` 的属性白名单排除 `unisonBoonLayer` / `tuneBreakBoost`：它们的「自封顶」依赖
跨 Buff 的面板聚合，模板里表达不出，配出来只会是「永远不生效」。
伤害名正则有条数上限（`LIBRARY_REGEX_MAX`）；空正则保留为草稿（与工程侧一致，导入后恒不满足）。

导入工程时 `rewriteOwnerInRules` 把「本角色」档重指到真实槽位，`-1` 档**与归属无关**、
实体不在配队时也保留；`rewriteOwnerInZones` 对 `characterIdx < 0` 的引用同样不重指。

工坊侧把 rules 放在 `buff_sets.condition.rules`（同一个 jsonb 里与 `chains` / `refinements` 并存，
读取时两套字段**合并**成一组规则）；引用归属用 `buff_set[].ref.refOwner`（`self` / `owner` = 本角色，
`active` = 出伤者）。契约细节见工坊仓库的 `docs/api.md`。

### 工程迁移（v7 / v8）

- 实例级 `condition.chains/refinements` 与单值 `chain/refinement`（配合 `conditionRefCharIdx`）
  在迁移里转成 `chain` / `refinement` 规则（`rulesFromLegacyCondition`）；转换后链阶并存、多条件 AND。
- 实例级 `elements` / `damageTypes` 属乘区级条件，**不转 rules**，迁移时由 `normalizeZones` 下放到乘区条目。
- `starred`、`condition`、`conditionRefCharIdx` 等不在模型白名单里的字段在迁移里抹除（`normalizeBuff` 只输出白名单字段）。
- v8 的 `damageNameRegex` 统一承载伤害名匹配：`damageNameEquals` 的值在迁移时转义正则元字符后写成 `^…$`
  （空值仍为空草稿），模型与界面只保留正则一种；`normalizeRule` 的兼容分支保证带 `damageNameEquals` 的导入 / 工坊文件也能落成正则。
- 工坊 share / 本地 Buff 库的导入源格式是实例级条件（`BuffLibraryGateCondition`），
  导入工程时由 `rulesFromLegacyCondition` 转成规则。

### 链 / 阶档位真源

角色共鸣链与武器精炼档位的**真源是角色槽位**（`CharSlot.chain` / `CharSlot.refinement`），由「角色详情配置」
编辑；`conditionProfileFromTeam(team)` 把它派生成条件系统读取的 `ConditionProfile`，不参与任何变量机制。

### 生效成员（作用域四态）

`BuffInstance.scope` 有四种语义（`classifyBuffScope` 归类，界面「生效成员」tab 编辑）。
**叫法全项目统一**：`'all'` 叫**通用**（三名角色 + 效应），`[0,1,2]` 叫**全队**（只有三名角色）——
两者不是同义词，别混：

| 取值      | 含义                        | 效应伤害 | 勾选的角色 |
| --------- | --------------------------- | -------- | ---------- |
| `'all'`   | **通用**（三名角色 + 效应） | ✅       | 全部       |
| `[0,1,2]` | **全队**（不含效应伤害）    | ❌       | 全部       |
| `[]`      | 仅效应                      | ✅       | 无         |
| 子集数组  | 指定角色                    | ❌       | 子集       |

状态迁移（`nextScopeAfterCharToggle` / `nextScopeAfterEffectToggle`）：勾效应 = 通用；
从通用取消效应 = 全队；仅效应取消效应 = **禁止**（至少保留一个成员）；
通用取消一个角色 = 取消效应 + 保留剩余；取消最后一个角色 = 仅效应。新建 Buff 默认 `'all'`（通用）。

Buff 库（本地 / 工坊）的作用域是**导入源语义**，由 `mapImportedScope` 落到上表：
`team` = 通用、`team_only` = 全队、`effect_only` = 仅效应、`self` / `self_except` = 角色子集。

## 3. 引用转模与跨角色「影响源」

`ZoneRef` 让某个乘区引用角色面板（`atkPct += 攻击白值 × pct%`、离散取整、上下限 clamp 等）。

**口径：伤害是当下的，buff 也是当下的。**

- **本条目可见面板**：每个角色槽位的面板都只由**绑定到本条目**的 Buff 组成 ——
  本角色槽位用 `partialStats`，其它角色槽位由 `buildEntryPanel()` 按需现算（同一槽位带缓存）。
  因此：
    - 某角色在**它自己其它条目**上勾的 Buff **不会**泄漏到本段的转模读数；
    - 把「作用域指向被引用角色」的 Buff **勾到本段**上，它就会参与该角色在这一段的面板计算（勾了才生效，且不重复计算）。
- **引用归属只有两种语义**（`ZoneRef.characterIdx`）：
    - `0..2` = 指定角色槽位（Buff 集里的「本角色」导入后落到实体归属槽位）；
    - `-1` = **出伤者**（本条目所属角色）：三处 `panelOf` 都把它归一到 `charIndex`，
      因此直接返回本条目的 `partialStats`，不额外建面板；`pane-effects` / `global-bindings` 对负值一律跳过
      （不作为跨角色「影响源」）。
- **全局 Buff 的自动绑定**：`rebindGlobalBuffs()` 不只把全局 Buff 绑到「作用域命中的条目」，
  还会绑到**引用了该作用域角色的条目**上（`global-bindings.ts`）。原因同上：转模只读本条目可见面板，
  若全局自作用域 Buff（如角色固有天赋）只绑在主人自己的条目，队友引用主人面板时就会少算。
  绑到别的角色条目不会给那个角色白加属性——作用域仍由 `activeBoundForChar` 在计算时过滤。
- **影响源（界面）**：`getPaneEffectSources(entryId)` 给出「会改写本段所引用面板」的 Buff 列表
  （`buffId → { 被引用角色槽位, 被改写的面板乘区键 }`，映射表 `PANEL_TO_ZONES` 把面板属性映射到会改写它的乘区键）。
  它们作为**普通可勾选项**出现在拉表里 —— 是该角色组内的列（表头带 `mdi:transit-connection-variant` 标记）；
  引用配置弹窗里不显示副作用列表。
- **溯源只给结果**：溯源里的引用乘区展示的是**解算后的数值**（`compute.resolveRefZoneValues` 按「本条目可见面板」
  算出，与逐条目结算走同一条链路），没有转模规则文案（`TracePart` 不带 `note` 字段）；面板 chip 里的引用
  也按结果逐条列出，残差占位只剩「覆盖等」这类确实无法逐条列出的写入。
- **v2 → v3 迁移（`migrateV2toV3`）**：v2 语义下被引用角色的面板由该角色**全部条目**上绑定的 Buff 组成；
  按当前口径（面板只由绑定到本条目的 Buff 组成），只勾在被引用角色身上的副作用 Buff 会失效，迁移用
  `bindPaneEffectSources()` 把它们补勾到引用这些面板的伤害段上（`entryOwnersFromTimeline()` 从时间线推导条目归属）：
  只加不减、幂等、跳过全局 Buff 与自引用，且**不按条件过滤**（与 v2 语义的跨条件变化保持等价）。
  纯逻辑集中在 `src/lib/calc/pane-effects.ts`，store、界面与迁移共用同一口径。

### Buff 树（工程内显式存储）

左侧 Buff 弹窗分 `全局` / `非全局` 两个页签，各自是一棵独立的树；`CalcState.buffTree` 随工程保存 / 导出 / 导入：

```ts
type BuffTreeNode =
    | { kind: 'folder'; id: string; name: string; children: BuffTreeNode[] }
    | { kind: 'buff'; id: string; buffId: string }
interface BuffTreeState {
    global: BuffTreeNode[]
    nonGlobal: BuffTreeNode[]
}
```

- **最多两级文件夹**，Buff 可落在根 / 一级 / 二级；文件夹名可自定义，图标由后代 Buff 派生。
- **全局树受保护**：其中的文件夹与 Buff 不可删除，只能改名、排序或移出全局（切到非全局页签）；
  非全局树可递归删除。
- **拖拽**：同一容器内排序走 `reorderBuffTreeChildren`；跨容器移动走 `moveBuffTreeNode`；
  拖到文件夹头上即移入。把 Buff 切到全局时，会把它在非全局树中的**完整文件夹路径**复制到全局树，
  只移动 Buff 本身，源文件夹保留。
- **平铺表**（分类平铺）：根上的 Buff 排在最左；全局 Buff **不占列、没有顶部条带**
  （全局生效的编辑统一在 BUFF 配置弹窗里做）。每列的表头按该列的
  一级 / 二级 / Buff 路径做**独立的纵向均分**（1 层居中、2 层各 50%、3 层各 1/3）。表头可切「简略」
  （隐藏首行/次行、只留列名行，全局偏好）。
- **不达门槛的 Buff 列**：设置-交互相关可切换显示/隐藏（全局偏好）。隐藏后只保留「至少一行真正达标」的列；
  显示时列照常保留，未达门槛的格子用圆点表示（**已勾选=主题色实心圆**、未勾选=灰色空心圆）。
- **单元格状态**（`CellData` + 渲染期门槛判定，分层是为了性能）：
    - 结构层（**与勾选无关**）：`enabled`（作用域/乘区/属性类型条件都满足才可勾）与 `hardOk`（硬门槛，决定列是否保留）；
    - 渲染层（**依赖勾选**）：Buff 级门槛 `rulesMetOf` —— 面板/生效集合随绑定变化，所以只在渲染可见格时现算并缓存。
- **分段平铺**：按时间记点（`analysis.timings` 里 seconds 非空、且有对应参考线）切段，每段一张表；
  行 = 全部伤害（按时间轴顺序），只有「选中来源」的行可勾 Buff，其它行只显示首列伤害信息（右侧绝对留白）；
  列 = 选中来源能吃到的 Buff 并集。没有记点时退化为单张「全部伤害」表。

### 数字前后缀迁移（仅工程迁移，不在导入时做）

工程迁移 `migrateLegacyBuffTree`（`buff-tree-state.ts`）会把 `前缀 + 数字 + 后缀` 形式的命名整理成数字文件夹：

- 只切分**最后一段**连续数字；`1层` / `2阶` 这类**空前缀**不建文件夹，名字也不改。
- 归并键是**前缀 + 后缀**：同一父容器内同键 ≥2 条才建文件夹；`锁3链 共鸣解放时…` 与 `锁3链 同奏…` 后缀不同，**不会**合并。
- 文件夹名用前缀；同前缀不同后缀两组都 ≥2 时，第二组起补 `（后缀）`，仍撞名再加 `#`。
- 子 Buff **真改名**为全名 `${条件文件夹}\${数字文件夹}\${数字}${后缀}`（如 `散华-千古洑流\千古洑流 共技时 攻击1层\1阶`）。
- 排序按数字升序、再按后缀；撞名（Buff 短名或文件夹名）追加 `#`，仍冲突继续追加。
- 数字文件夹的位置：条件文件夹是一级、数字文件夹是二级；无条件的数字文件夹直接落在一级。
- `BUFF_TREE_VERSION` 记录迁移版本；缺版本或版本为 0 的树会在载入时重新迁移。
- **导入 Buff 集不做数字迁移**：只取工坊全名的短名，再按实体来源拼新全名（角色本体 `角色名-本体`、链 `角色名-x链`、
  武器 `角色名-武器名`、首位声骸 `角色名-声骸名`、套装 `角色名-套装名-x件`；后三者的生效条件仍是角色本体门），撞名加 `#`。

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
   `BUFF_ZONE_SECTIONS`（两端的 zoneId 白名单必须一致，否则工坊存下的数据工具箱认不全）；
   若新乘区要参与 Buff 集侧的「面板数值」条件，还要补进 `calc/buff-library-condition` 的
   `LIBRARY_ZONE_COMPARE_IDS`
8. 若同步给 AI 使用，补 `docs/tools.md` 与 `src/lib/ai/tools/calculation.ts` 的 zoneId 清单
9. 运行 `pnpm run format && pnpm run lint:eslint && pnpm run check`

> **引用（转模）默认开放**：新乘区不必做任何事即可被引用。只有确实需要「只允许固定值」的乘区
> 才加进 `ZONE_NO_REF_IDS` —— 目前只有 `tuneStrainLayer`（集谐干涉层数）在名单里；同奏增益层数可引用。
