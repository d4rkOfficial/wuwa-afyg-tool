# 工具文档（AI 助手 / WS 远程接管共用）

> 本文档由 `scripts/generate-tools-doc.mjs` 从工具源码自动生成，共 **86** 个工具。
> 新增/修改工具后请重跑：`node scripts/generate-tools-doc.mjs`

AI 助手悬浮窗与 WS 远程接管（`#websocket=`）共用同一套工具注册表与执行引擎；危险工具在 AI 侧受「危险操作权限」策略约束，WS 侧直接放行。

## 危险工具

- `generate_entity_buffs`
- `generate_project_buffs`
- `sync_buff_library_from_share`
- `update_entity_buffs`
- `delete_buff_entity`
- `clear_buff_library`
- `delete_buff_set`
- `remove_buff_zone`
- `remove_substat`
- `archive_project`
- `delete_project`
- `remove_op_block`
- `format_timeline`
- `remove_ref_line`

## Buff 生成

### `list_entities`

列出某类游戏实体的全部名称（character=角色 / weapon=武器 / echo=声骸 / 1set-5set=声骸套装件数）。用于定位实体名，供 get_entity_info 查询详情或生成 Buff。

| 参数         | 必填   | 类型   | 说明     |
| ------------ | ------ | ------ | -------- |
| `entityType` | **是** | string | 实体类型 |

### `search_entities`

按关键词模糊搜索游戏实体名称（角色/武器/声骸/套装任意类型），用于定位准确名称后再查详情。

| 参数         | 必填   | 类型   | 说明                   |
| ------------ | ------ | ------ | ---------------------- |
| `query`      | **是** | string | 搜索关键词（中文片段） |
| `entityType` | 否     | string | 可选：只搜该类型       |

### `get_entity_info`

查询实体的官方游戏数据详情：角色（技能/共鸣链（俗称命座）/固有属性）、武器（效果）、声骸（技能）、套装（各件数加成）。用于向用户说明实体机制、核对生成内容，或判断该实体适合生成哪些 Buff。

| 参数         | 必填   | 类型   | 说明                                                      |
| ------------ | ------ | ------ | --------------------------------------------------------- |
| `entityType` | **是** | string | 实体类型                                                  |
| `entityName` | **是** | string | 实体名称（中文，用 list_entities / search_entities 定位） |

### `get_naming_rule`

获取当前已保存的 Buff 命名规则（用户自定义）。返回空字符串表示尚未定义，生成前需要先询问用户。

_无参数_

### `set_naming_rule`

保存用户自定义的 Buff 命名规则（由用户从零定义，无预设风格，可能包含格式示例/简写习惯等）。保存后生成 Buff 会自动遵守。

| 参数   | 必填   | 类型   | 说明                       |
| ------ | ------ | ------ | -------------------------- |
| `rule` | **是** | string | 用户给出的完整命名规则描述 |

### `generate_entity_buffs`

> ⚠️ **危险工具**：执行后不可轻易撤销

为本地 Buff 库中的指定实体（character/weapon/echo/1set-5set）生成 Buff 集并写入本地库（整体覆写该实体，来源变为自定义）。该工具会自动查询实体官方详情（角色技能/共鸣链/武器效果等）并提取 Buff，无需先调用其它查询工具；生成前若未定义命名规则会先询问用户。

| 参数         | 必填   | 类型   | 说明                                 |
| ------------ | ------ | ------ | ------------------------------------ |
| `entityType` | **是** | string | 实体类型                             |
| `entityName` | **是** | string | 实体名称（中文）                     |
| `namingRule` | 否     | string | 可选：用户新定义的命名规则（会记住） |

### `generate_project_buffs`

> ⚠️ **危险工具**：执行后不可轻易撤销

为当前工程队伍中的实体（角色/武器/首位声骸/触发套装）逐个生成 Buff 集并导入当前工程拉表（含归属绑定）。该工具会自动查询各实体官方详情并提取 Buff，无需先调用其它查询工具。默认遍历全队，可用 slot（1-3）或 entityType 过滤。生成前若未定义命名规则会先询问用户。

| 参数         | 必填 | 类型   | 说明                                 |
| ------------ | ---- | ------ | ------------------------------------ |
| `slot`       | 否   | number | 可选：只处理该槽位（1-3）            |
| `entityType` | 否   | string | 可选：只处理该实体类型               |
| `namingRule` | 否   | string | 可选：用户新定义的命名规则（会记住） |

## Buff 库

### `sync_buff_library_from_share`

> ⚠️ **危险工具**：执行后不可轻易撤销

从工坊同步最新 Buff 集到本地库。注意：会整体覆盖“来自工坊”的实体，且工坊中已下线的实体将被移除（自定义实体不受影响）。

_无参数_

### `list_buff_entities`

列出本地 Buff 库的实体（可按类型过滤）：实体名、类型、来源（share/custom）、Buff 数量。

| 参数         | 必填 | 类型   | 说明                                  |
| ------------ | ---- | ------ | ------------------------------------- |
| `entityType` | 否   | string | 可选：character/weapon/echo/1set-5set |

### `get_entity_buffs`

查看本地 Buff 库中指定实体的全部 Buff 详情（名称、作用范围、生效条件、乘区与数值、引用）。

| 参数         | 必填   | 类型   | 说明 |
| ------------ | ------ | ------ | ---- |
| `entityType` | **是** | string |      |
| `entityName` | **是** | string |      |

### `update_entity_buffs`

> ⚠️ **危险工具**：执行后不可轻易撤销

整体覆写本地 Buff 库中指定实体的 Buff 列表（该实体来源变为 custom）。buffs 结构：[{"buffName":"名称","scope":"self\|self_except\|team\|effect_only","exclusive":false,"condition":{...可选},"zones":[{"zoneId":"乘区id","value":数值,"override":false,"ref":{...可选}}]}]。

| 参数         | 必填   | 类型   | 说明 |
| ------------ | ------ | ------ | ---- |
| `entityType` | **是** | string |      |
| `entityName` | **是** | string |      |
| `buffs`      | **是** | array  |      |

### `delete_buff_entity`

> ⚠️ **危险工具**：执行后不可轻易撤销

从本地 Buff 库删除指定实体（不可恢复）。

| 参数         | 必填   | 类型   | 说明 |
| ------------ | ------ | ------ | ---- |
| `entityType` | **是** | string |      |
| `entityName` | **是** | string |      |

### `clear_buff_library`

> ⚠️ **危险工具**：执行后不可轻易撤销

清空整个本地 Buff 库（所有实体与 Buff，不可恢复）。

_无参数_

## 拉表

### `get_damage_entries`

获取当前工程的所有伤害条目（拉表）：条目 id、归属角色、名称、伤害属性、是否效应等。

_无参数_

### `get_buff_sets`

获取当前工程的所有 Buff 集：id、名称、作用范围（self/self_except/team/effect_only/all）、是否全局默认、生效条件、绑定到哪些伤害条目。

_无参数_

### `create_buff_set`

在当前工程创建一个新的空 Buff 集。

| 参数   | 必填   | 类型   | 说明        |
| ------ | ------ | ------ | ----------- |
| `name` | **是** | string | Buff 集名称 |

### `rename_buff_set`

重命名指定 Buff 集。

| 参数   | 必填   | 类型   | 说明 |
| ------ | ------ | ------ | ---- |
| `id`   | **是** | string |      |
| `name` | **是** | string |      |

### `duplicate_buff_set`

复制指定 Buff 集为一个新集，可指定新名称（默认“原名 复制”）。

| 参数         | 必填   | 类型   | 说明 |
| ------------ | ------ | ------ | ---- |
| `id`         | **是** | string |      |
| `customName` | 否     | string |      |

### `delete_buff_set`

> ⚠️ **危险工具**：执行后不可轻易撤销

删除指定 Buff 集（同时清理其对所有条目的绑定）。

| 参数 | 必填   | 类型   | 说明 |
| ---- | ------ | ------ | ---- |
| `id` | **是** | string |      |

### `bind_buff_to_entry`

把指定 Buff 集绑定到指定伤害条目（该条目计算时生效）。

| 参数        | 必填   | 类型   | 说明                                   |
| ----------- | ------ | ------ | -------------------------------------- |
| `entryId`   | **是** | string | 伤害条目 id（get_damage_entries 获取） |
| `buffSetId` | **是** | string | Buff 集 id（get_buff_sets 获取）       |

### `unbind_buff_from_entry`

把指定 Buff 集从指定伤害条目解除绑定。

| 参数        | 必填   | 类型   | 说明 |
| ----------- | ------ | ------ | ---- |
| `entryId`   | **是** | string |      |
| `buffSetId` | **是** | string |      |

### `set_entry_damage_types`

设置指定伤害条目的伤害类型列表（覆盖）。取值：普攻伤害/重击伤害/共鸣技能伤害/共鸣解放伤害/声骸技能伤害/变奏技能伤害/延奏技能伤害/协同攻击伤害/效应伤害/其它类型伤害。

| 参数          | 必填   | 类型   | 说明 |
| ------------- | ------ | ------ | ---- |
| `entryId`     | **是** | string |      |
| `damageTypes` | **是** | array  |      |

### `toggle_damage_type`

切换指定伤害条目的单个伤害类型（加上或移除）。

| 参数         | 必填   | 类型   | 说明 |
| ------------ | ------ | ------ | ---- |
| `entryId`    | **是** | string |      |
| `damageType` | **是** | string |      |

### `get_condition_profile`

获取当前链/阶配置（每个角色的共鸣链 0-6 与武器精炼 0-5，0=未精炼）及“可用Buff”过滤开关状态。

_无参数_

### `set_chain`

设置指定角色槽位（1-3）的共鸣链数（0-6）。

| 参数    | 必填   | 类型   | 说明         |
| ------- | ------ | ------ | ------------ |
| `slot`  | **是** | number | 角色槽位 1-3 |
| `value` | **是** | number | 链数 0-6     |

### `set_refinement`

设置指定角色槽位（1-3）的武器精炼阶数（0-5，0=未精炼、不触发专武 1-5 阶 buff）。

| 参数    | 必填   | 类型   | 说明     |
| ------- | ------ | ------ | -------- |
| `slot`  | **是** | number |          |
| `value` | **是** | number | 阶数 0-5 |

### `toggle_condition_mismatch_hide`

切换“可用Buff/全部Buff”过滤：开启时隐藏条件不匹配（链/阶低于配置、属性/类型对不上条目）的 Buff。

_无参数_

### `import_entity_buffs`

把本地 Buff 库中指定实体（角色/武器/首位声骸/套装）的全部 Buff 导入当前工程（导入后可再绑定到条目）。entityType 取值：character/weapon/echo/1set/2set/3set/4set/5set。

| 参数         | 必填   | 类型   | 说明     |
| ------------ | ------ | ------ | -------- |
| `entityType` | **是** | string | 实体类型 |
| `entityName` | **是** | string | 实体名称 |

### `get_buff_set_detail`

获取指定 Buff 集的完整详情：作用范围、是否全局、生效条件、每个乘区（zoneId/数值/是否覆盖/引用）及其生效角色槽位。

| 参数 | 必填   | 类型   | 说明                             |
| ---- | ------ | ------ | -------------------------------- |
| `id` | **是** | string | Buff 集 id（get_buff_sets 获取） |

### `set_buff_zone`

设置 Buff 集内指定乘区的数值（百分数乘区填数值，如 15 表示 15%）。zoneId 不存在时自动创建。zoneId 可选：atkFlat/atkPct/hpFlat/hpPct/defFlat/defPct/critRate/critDmg/recharge/tuneBreakBoost/offTuneBuildupRate/bonusDmg/deepenDmg/resPen/defPen/defDown/dmgRedPen/resDown/tuneStrainLayer/finalDmg/dmgTakenInc/customFinalDmg/extraRatio。override 为 true 时该乘区覆盖其它 Buff 的同乘区（extraRatio 不支持覆盖）。

| 参数       | 必填   | 类型    | 说明                             |
| ---------- | ------ | ------- | -------------------------------- |
| `setId`    | **是** | string  | Buff 集 id                       |
| `zoneId`   | **是** | string  | 乘区 id                          |
| `value`    | **是** | number  | 数值                             |
| `override` | 否     | boolean | 可选，是否覆盖其它 Buff 的同乘区 |

### `set_buff_zone_ref`

设置 Buff 集内指定乘区的引用（跟随某角色的属性按百分比折算），ref 为 null 时清除引用。ref 结构：{"targetZoneId":"引用目标","pct":百分比,"characterIdx":槽位 1-3,"threshold":阈值,"lower"/"upper"/"discrete"/"divisor"/"multiplier"可选}。targetZoneId 可选：baseAtk/totalAtk/baseHp/totalHp/baseDef/totalDef/recharge/tuneBreakBoost/offTuneBuildupRate/critRate/critDmg。

| 参数     | 必填   | 类型   | 说明                 |
| -------- | ------ | ------ | -------------------- |
| `setId`  | **是** | string |                      |
| `zoneId` | **是** | string | 乘区 id              |
| `ref`    | 否     | object | 引用定义或 null 清除 |

### `remove_buff_zone`

> ⚠️ **危险工具**：执行后不可轻易撤销

从 Buff 集中删除指定乘区（不可恢复）。

| 参数     | 必填   | 类型   | 说明 |
| -------- | ------ | ------ | ---- |
| `setId`  | **是** | string |      |
| `zoneId` | **是** | string |      |

### `set_buff_scope`

设置 Buff 集的作用范围：all（全队）或槽位数组（如 [1,3] 表示仅 1、3 号位）。全局 Buff 集不可修改范围。

| 参数    | 必填   | 类型     | 说明                 |
| ------- | ------ | -------- | -------------------- |
| `setId` | **是** | string   |                      |
| `scope` | **是** | ['string | all 或槽位数组 [1-3] |

### `set_buff_condition`

设置 Buff 集生效条件（全部满足才生效），传 null 清除。condition 结构：{"chain":共鸣链要求 0-6,"refinement":精炼要求 1-5,"elements":["伤害属性..."],"damageTypes":["伤害类型..."]}。全局 Buff 集不可设置链/阶条件。

| 参数        | 必填   | 类型   | 说明                 |
| ----------- | ------ | ------ | -------------------- |
| `setId`     | **是** | string |                      |
| `condition` | 否     | object | 条件定义或 null 清除 |

## 配装

### `get_config_summary`

获取当前配装配置摘要：每个角色的 5 个声骸（cost、主词条、副词条）与敌人配置（类型/等级/防御/减伤/各抗性）。

_无参数_

### `set_echo_cost`

设置指定角色槽位（1-3）第 N 个声骸（1-5）的 cost（3/4/5；改 cost 会重置主词条）。

| 参数   | 必填   | 类型   | 说明         |
| ------ | ------ | ------ | ------------ |
| `char` | **是** | number | 角色槽位 1-3 |
| `slot` | **是** | number | 声骸位 1-5   |
| `cost` | **是** | number | cost：3/4/5  |

### `set_main_stat`

设置指定角色槽位（1-3）第 N 个声骸（1-5）的主词条。label 须为该声骸 cost 支持的主词条（可选列表与 cost 相关，先 set_echo_cost 或 get_config_summary 查看），传空字符串清空。不传 value 时使用该词条满级默认值。

| 参数    | 必填   | 类型   | 说明                     |
| ------- | ------ | ------ | ------------------------ |
| `char`  | **是** | number | 角色槽位 1-3             |
| `slot`  | **是** | number | 声骸位 1-5               |
| `label` | 否     | string | 主词条名称，空字符串清空 |
| `value` | 否     | number | 可选，覆盖默认满级值     |

### `add_substat`

给指定角色槽位（1-3）第 N 个声骸（1-5）追加一条副词条。label 取值：攻击/生命/防御/暴击率/暴击伤害/共鸣效率/治疗加成/攻击%/生命%/防御%（攻击% 等百分比词条）。不传 value 时使用中档默认值。

| 参数    | 必填   | 类型   | 说明                                                   |
| ------- | ------ | ------ | ------------------------------------------------------ |
| `char`  | **是** | number |                                                        |
| `slot`  | **是** | number |                                                        |
| `label` | **是** | string | 副词条名称                                             |
| `value` | 否     | number | 可选，覆盖中档默认值（百分数词条填数值，如 8 表示 8%） |

### `remove_substat`

> ⚠️ **危险工具**：执行后不可轻易撤销

移除指定角色槽位（1-3）第 N 个声骸（1-5）的第 idx 条副词条（从 0 开始）。

| 参数   | 必填   | 类型   | 说明 |
| ------ | ------ | ------ | ---- |
| `char` | **是** | number |      |
| `slot` | **是** | number |      |
| `idx`  | **是** | number |      |

### `update_substat_value`

修改指定角色槽位（1-3）第 N 个声骸（1-5）第 idx 条副词条（从 0 开始）的数值（百分数词条填数值，如 8 表示 8%）。

| 参数    | 必填   | 类型   | 说明 |
| ------- | ------ | ------ | ---- |
| `char`  | **是** | number |      |
| `slot`  | **是** | number |      |
| `idx`   | **是** | number |      |
| `value` | **是** | number |      |

### `update_enemy`

修改敌人配置项：level（等级）、defense（防御）、dmgReduction（减伤，数值如 10 表示 10%）、type（BOSS/精英怪/小怪）。

| 参数    | 必填   | 类型                                            | 说明 |
| ------- | ------ | ----------------------------------------------- | ---- |
| `key`   | **是** | string（level / defense / dmgReduction / type） |      |
| `value` | **是** | ['number                                        |      |

### `update_resistance`

修改敌人某元素抗性（百分比数值，如 10 表示 10%）。元素：物理/冷凝/热熔/导电/气动/衍射/湮灭。

| 参数      | 必填   | 类型   | 说明 |
| --------- | ------ | ------ | ---- |
| `element` | **是** | string |      |
| `value`   | **是** | number |      |

## 面板

### `get_panels_state`

查看当前所有弹窗面板的开关状态（BUFF配置/速查/Buff 库/设置/工坊/角色详情配置/导入 Buff 集等）。

_无参数_

### `open_panel`

打开或关闭指定弹窗面板。panel 取 get_panels_state 返回的 name（如 buff-config/quick-lookup/buff-library/settings/workshop/character-detail/buff-import/damage-list 等）；open 默认 true。

| 参数    | 必填   | 类型    | 说明                              |
| ------- | ------ | ------- | --------------------------------- |
| `panel` | **是** | string  | 面板名                            |
| `open`  | 否     | boolean | 打开(true)/关闭(false)，默认 true |

## 工程

### `list_projects`

列出所有本地工程（含名称、是否当前活动、是否已归档）。AI 需要了解有哪些工程时调用。

_无参数_

### `get_project_state`

获取当前活动工程的状态：工程名、队伍（各槽位角色与武器）、各环节锁定情况。AI 动手前应调用以了解现状。

_无参数_

### `get_team`

获取当前活动工程队伍配置摘要（每个槽位的角色与武器）。

_无参数_

### `create_project`

新建一个工程并切换为当前活动工程。

| 参数   | 必填   | 类型   | 说明     |
| ------ | ------ | ------ | -------- |
| `name` | **是** | string | 工程名称 |

### `rename_project`

重命名指定工程。

| 参数   | 必填   | 类型   | 说明 |
| ------ | ------ | ------ | ---- |
| `id`   | **是** | string |      |
| `name` | **是** | string |      |

### `set_active_project`

切换当前活动工程（后续操作都作用于该工程）。

| 参数 | 必填   | 类型   | 说明                             |
| ---- | ------ | ------ | -------------------------------- |
| `id` | **是** | string | 工程 id（用 list_projects 获取） |

### `archive_project`

> ⚠️ **危险工具**：执行后不可轻易撤销

将指定工程归档（从侧边栏隐藏，可在设置-归档管理中恢复）。

| 参数 | 必填   | 类型   | 说明 |
| ---- | ------ | ------ | ---- |
| `id` | **是** | string |      |

### `unarchive_project`

将已归档工程恢复显示。

| 参数 | 必填   | 类型   | 说明 |
| ---- | ------ | ------ | ---- |
| `id` | **是** | string |      |

### `delete_project`

> ⚠️ **危险工具**：执行后不可轻易撤销

永久删除指定工程（不可恢复）。

| 参数 | 必填   | 类型   | 说明 |
| ---- | ------ | ------ | ---- |
| `id` | **是** | string |      |

### `clone_project`

克隆指定工程（全部环节）为新工程，新工程名可指定。

| 参数      | 必填   | 类型   | 说明 |
| --------- | ------ | ------ | ---- |
| `id`      | **是** | string |      |
| `newName` | **是** | string |      |

### `lock_phase`

锁定当前活动工程的指定环节（team/timeline/calculation/config）。

| 参数    | 必填   | 类型   | 说明 |
| ------- | ------ | ------ | ---- |
| `phase` | **是** | string |      |

### `unlock_phase`

解锁当前活动工程的指定环节及后续所有环节。

| 参数    | 必填   | 类型   | 说明 |
| ------- | ------ | ------ | ---- |
| `phase` | **是** | string |      |

### `get_buff_library_summary`

获取本地 Buff 库概览：实体数量、按类型分布、数据来源（工坊同步/自定义）。

_无参数_

## 结果

### `get_result_summary`

基于当前配装/Buff/条件配置计算并返回伤害结果摘要：每个伤害条目的期望伤害（含暴击）与全队总伤害。可用来回答“这套配置伤害多少”“哪个技能伤害最高”。

_无参数_

## 设置

### `get_settings_state`

读取当前允许 AI 修改的设置状态（外观主题/交互-拉表视图与工具栏/工坊实例/性能相关）。其余设置（按键图标、界面快捷键、归档、缓存、助手设置等）不允许 AI 修改，需用户手动打开「设置」面板调整。

_无参数_

### `set_setting`

修改允许 AI 控制的设置。key 白名单：theme_mode(dark/light)、theme_accent_hue(default=青色/orange=橘红/orangeyellow=橙黄/magenta=品红/cyan=青色别名/indigo=靛蓝/green=墨绿/mono=黑白 或 0-360 整数)、theme_background_image(http(s)/data:image 地址或空串清除)、theme_bg_opacity(30-100)、theme_bg_blur(0-32)、theme_bg_dim(0-100)、theme_bg_image_blur(0-32)、theme_bg_image_mask(0-100)、calc_view(dropdown/spread)、simplify_toolbar、magnetic_pointer、gpu_accel、reload_on_result_refresh、reload_on_profile_change。其它设置一律拒绝。

| 参数    | 必填   | 类型     | 说明                           |
| ------- | ------ | -------- | ------------------------------ |
| `key`   | **是** | string   | 设置项 key（见描述中的白名单） |
| `value` | **是** | ['string | 目标值                         |

### `manage_workshop`

管理工坊实例：switch=切换到指定实例（传 id）、add=添加实例（传 url）、remove=删除实例（传 id，至少保留 1 个）、reset=恢复默认实例列表。返回当前实例列表与选中 id。

| 参数     | 必填   | 类型                                    | 说明                        |
| -------- | ------ | --------------------------------------- | --------------------------- |
| `action` | **是** | string（switch / add / remove / reset） | 操作类型                    |
| `id`     | 否     | string                                  | 实例 id（switch/remove 用） |
| `url`    | 否     | string                                  | 实例地址（add 用）          |

## 队伍

### `get_team_catalog`

获取可用的队伍配置数据：角色（元素/武器类型）、武器（类型/星级）、声骸（cost/所属套装）、套装（支持件数）。设置队伍前先调用以获取准确名称。

_无参数_

### `set_team_character`

设置指定槽位（1-3）的角色，或传空字符串清空该槽位（同时清空武器、首位声骸与触发套装）。角色名用 get_team_catalog 查询，不能与其它槽位重复；已有武器类型不匹配时自动清空武器。

| 参数        | 必填   | 类型   | 说明                 |
| ----------- | ------ | ------ | -------------------- |
| `slot`      | **是** | number | 槽位 1-3             |
| `character` | 否     | string | 角色名，空字符串清空 |

### `set_team_weapon`

设置指定槽位（1-3）的武器，或传空字符串清空。武器名用 get_team_catalog 查询，武器类型须与该槽位角色匹配。

| 参数     | 必填   | 类型   | 说明                 |
| -------- | ------ | ------ | -------------------- |
| `slot`   | **是** | number | 槽位 1-3             |
| `weapon` | 否     | string | 武器名，空字符串清空 |

### `set_team_first_echo`

设置指定槽位（1-3）的首位声骸，或传空字符串清空（同时清空触发套装）。声骸名用 get_team_catalog 查询；若触发套装已满 5 件且声骸不属于任何已选套装（赫卡忒除外），会清空触发套装。

| 参数   | 必填   | 类型   | 说明                 |
| ------ | ------ | ------ | -------------------- |
| `slot` | **是** | number | 槽位 1-3             |
| `echo` | 否     | string | 声骸名，空字符串清空 |

### `set_team_trigger_sets`

设置指定槽位（1-3）的触发套装（整体覆盖）。sets 为 [{name, pieces}]，套装名与支持件数用 get_team_catalog 查询，总有效件数 ≤5；满 5 件且首位声骸不属于任何已选套装（赫卡忒除外）时清空首位声骸。

| 参数   | 必填   | 类型   | 说明     |
| ------ | ------ | ------ | -------- |
| `slot` | **是** | number | 槽位 1-3 |
| `sets` | **是** | array  |          |

## 排轴

### `get_timeline_summary`

获取当前排轴摘要：每轨（角色）的操作块（id、按键、描述、是否变奏入场/切回）、参考线、伤害条目数、环节是否锁定。

_无参数_

### `get_timeline_damage_list`

获取排轴中的伤害条目清单（供了解哪些操作被标记为伤害）。

_无参数_

### `add_op_block`

在当前排轴指定轨道（1-3）追加一个操作块，位置为三行最右空白位置（按顺序排轴：新块总是落在所有操作块之后）。key 支持：普攻/重击/闪避/跳跃/共鸣技能/共鸣解放/声骸技能/谐度破坏，或 Q/E/R/F/T 等字母。desc 为描述文本（如“重击”“变奏入场”）。

| 参数    | 必填   | 类型   | 说明                                                                      |
| ------- | ------ | ------ | ------------------------------------------------------------------------- |
| `track` | **是** | number | 轨道 1-3                                                                  |
| `key`   | **是** | string | 按键名（普攻/重击/闪避/跳跃/共鸣技能/共鸣解放/声骸技能/谐度破坏 或 字母） |
| `desc`  | 否     | string | 描述（可空）                                                              |

### `get_char_skills`

获取指定角色可绑定的伤害命中列表（技能类型、命中名、倍率、元素），含：角色技能、装备声骸技能、用户自定义直伤（技能类型分别为声骸技能/自定义）。用于把伤害倍率绑定到操作块。

| 参数        | 必填   | 类型   | 说明   |
| ----------- | ------ | ------ | ------ |
| `character` | **是** | string | 角色名 |

### `bind_damage_to_block`

把伤害倍率绑定到指定操作块：hits 为 [{character, hitName, hits?}]，hitName 用 get_char_skills 查询到的命中名（含角色技能、声骸技能、自定义直伤）；hits 为该命中次数（默认 1）。可一次绑定多条。

| 参数      | 必填 | 类型   | 说明                                   |
| --------- | ---- | ------ | -------------------------------------- |
| `blockId` | 否   | string | 操作块 id（get_timeline_summary 获取） |
| `hits`    | 否   | array  |                                        |

### `remove_op_block`

> ⚠️ **危险工具**：执行后不可轻易撤销

删除指定操作块（按 id）。

| 参数 | 必填   | 类型   | 说明                                   |
| ---- | ------ | ------ | -------------------------------------- |
| `id` | **是** | string | 操作块 id（get_timeline_summary 获取） |

### `set_block_key`

修改指定操作块的按键。

| 参数  | 必填   | 类型   | 说明 |
| ----- | ------ | ------ | ---- |
| `id`  | **是** | string |      |
| `key` | **是** | string |      |

### `set_block_special`

设置指定操作块的变奏标记：intro=变奏入场、switchback=切回、none=取消。

| 参数   | 必填   | 类型                                | 说明 |
| ------ | ------ | ----------------------------------- | ---- |
| `id`   | **是** | string                              |      |
| `kind` | **是** | string（none / intro / switchback） |      |

### `undo_timeline`

撤销上一次排轴操作。

_无参数_

### `redo_timeline`

重做上一次撤销的排轴操作。

_无参数_

### `format_timeline`

> ⚠️ **危险工具**：执行后不可轻易撤销

自动格式化排轴：各操作块右边界对齐下一个块（可跨角色）的左边界，参考线跟随其左右块。

_无参数_

### `reflow_track`

重新排布指定轨道（1-3）的操作块，消除重叠。

| 参数    | 必填   | 类型   | 说明 |
| ------- | ------ | ------ | ---- |
| `track` | **是** | number |      |

### `move_op_block`

把已有操作块移动到指定位置：position 为 {time: 秒}（绝对时间 0 至当前结束线）或 {anchor: 块 id, side: before/after（默认 after）, offset?: 秒}（相对某块）。移动后自动消除同轨道重叠。

| 参数       | 必填   | 类型                     | 说明                                   |
| ---------- | ------ | ------------------------ | -------------------------------------- |
| `blockId`  | **是** | string                   | 操作块 id（get_timeline_summary 获取） |
| `position` | **是** | object（before / after） | 绝对时间（秒，0 至当前结束线）         |

### `move_ref_line`

把已有参考线移动到指定位置：position 为 {time: 秒}（绝对时间 0 至当前结束线）或 {anchor: 块 id, side: before/after, offset?: 秒}（相对某块）。与相邻参考线保持最小间距，过近会报错。

| 参数       | 必填   | 类型                     | 说明                                   |
| ---------- | ------ | ------------------------ | -------------------------------------- |
| `id`       | **是** | string                   | 参考线 id（get_timeline_summary 获取） |
| `position` | **是** | object（before / after） | 绝对时间（秒，0 至当前结束线）         |

### `add_ref_line`

在当前排轴最右空白位置添加参考线（按顺序排轴：参考线落在所有操作块之后），用于标记时间节点（如启动轴/循环轴）。

_无参数_

### `remove_ref_line`

> ⚠️ **危险工具**：执行后不可轻易撤销

删除指定参考线（按 id）。

| 参数 | 必填   | 类型   | 说明                                   |
| ---- | ------ | ------ | -------------------------------------- |
| `id` | **是** | string | 参考线 id（get_timeline_summary 获取） |

### `get_non_direct_options`

获取可绑定到操作块的非直伤选项：谐度破坏（处决，可带触发角色）、震谐响应/骇破响应（偏谐响应，必须带触发角色）、各类效应（层数 1-上限、元素），以及电磁爆发（须先绑电磁效应）。

_无参数_

### `bind_non_direct_to_block`

把非直伤绑定到指定操作块（可覆盖原有绑定）：entries 为 [{name, layers?, responders?}]，名称用 get_non_direct_options 获取。谐度破坏/震谐响应/骇破响应 可带 responders（触发角色名数组，响应必须有）；效应必须带 layers（1-上限）。

| 参数      | 必填 | 类型   | 说明                                   |
| --------- | ---- | ------ | -------------------------------------- |
| `blockId` | 否   | string | 操作块 id（get_timeline_summary 获取） |
| `entries` | 否   | array  |                                        |

## 视图

### `switch_view`

切换当前视图（阶段）：team=队伍配置、timeline=排轴、calculation=拉表、config=配装、result=结果页。切换后用户会看到相应界面。

| 参数   | 必填   | 类型   | 说明     |
| ------ | ------ | ------ | -------- |
| `view` | **是** | string | 目标视图 |

## Buff 生成辅助

### `list_entities`

列出某个实体类型的全部实体名称（角色/武器/声骸/声骸套装）。返回实体名数组。

| 参数         | 必填   | 类型   | 说明     |
| ------------ | ------ | ------ | -------- |
| `entityType` | **是** | string | 实体类型 |

## 附录：AI 不可修改的设置

以下设置不允许 AI/WS 修改（调用 `set_setting` 会报错并提示手动调整）：

- 按键图标（设置 → 按键图标）
- 界面快捷键（设置 → 交互相关 → 界面快捷键）
- 归档管理（设置 → 归档管理）
- 缓存清理（设置 → 缓存清理）
- 助手设置（启用开关、危险操作权限、AI 配置文件、提示词、黑话词典）
- 自定义主题的创建/删除（设置 → 外观主题，仅支持明暗切换/主色调/背景与质感参数）
- 背景图本地文件上传（AI 仅可设置远程 URL / data:image 数据 / 清除）

### `set_setting` 白名单一览

| key                        | 说明              | 取值                                                                                                                                       |
| -------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `theme_mode`               | 明暗模式          | dark / light                                                                                                                               |
| `theme_accent_hue`         | 主色调            | default(青色) / orange(橘红) / orangeyellow(橘黄) / magenta(品红) / cyan(青色别名) / indigo(靛蓝) / green(墨绿) / mono(黑白) 或 0-360 整数 |
| `theme_background_image`   | 背景图            | http(s):// 地址 / data:image 数据 / 空串清除                                                                                               |
| `theme_bg_opacity`         | 卡片透明度        | 30-100                                                                                                                                     |
| `theme_bg_blur`            | 毛玻璃强度        | 0-32                                                                                                                                       |
| `theme_bg_dim`             | 背景暗度          | 0-100                                                                                                                                      |
| `theme_bg_image_blur`      | 背景图模糊        | 0-32                                                                                                                                       |
| `theme_bg_image_mask`      | 背景图遮罩        | 0-100                                                                                                                                      |
| `calc_view`                | 拉表视图          | dropdown / spread                                                                                                                          |
| `simplify_toolbar`         | 简化底部工具栏    | true / false                                                                                                                               |
| `magnetic_pointer`         | 磁力光标          | true / false                                                                                                                               |
| `gpu_accel`                | 渲染加速（GPU）   | true / false                                                                                                                               |
| `reload_on_result_refresh` | 刷新结果重载数据  | true / false                                                                                                                               |
| `reload_on_profile_change` | 链/阶变动重载数据 | true / false                                                                                                                               |

工坊实例管理请使用 `manage_workshop`（action：switch / add / remove / reset）。
