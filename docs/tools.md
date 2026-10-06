# 工具文档（AI 助手 / WS 远程接管共用）

> 本文档由 `scripts/generate-tools-doc.mjs` 从工具源码自动生成，共 **145** 个工具。
> 新增/修改工具后请重跑：`node scripts/generate-tools-doc.mjs`

AI 助手悬浮窗与 WS 远程接管（`#websocket=`）共用同一套工具注册表与执行引擎；危险工具在 AI 侧受「危险操作权限」策略约束，WS 侧直接放行。

**能力门控（AI 独享 / WS 不可调用）**：声明了 `requires` 的工具依赖**宿主能力**，能力缺失时既不会进发给对方的工具清单，直接 exec 也会被拒。当前有 `ask_user`（需要提问界面）与 `web_fetch`（需要宿主网络代理出网）：WS 远程接管不提供这两项能力，故在远程通道里不可见、也不可执行。

## 危险工具

- `generate_buff_set_entity_buffs`
- `generate_project_buff_confs`
- `sync_buff_set_from_share`
- `update_buff_set_entity_buffs`
- `delete_buff_set_entity`
- `clear_buff_set`
- `delete_buff_conf`
- `remove_buff_conf_zone`
- `remove_substat`
- `kuro_logout`
- `archive_project`
- `delete_project`
- `save_substat_plan`
- `delete_substat_plan`
- `reset_standard_substat_plan`
- `sync_substat_plans_from_share`
- `sync_substat_plans_from_kuro`
- `remove_op_block`
- `format_timeline`
- `remove_ref_line`

## AI 助手自身（上下文 / 用量 / 运行情况）

### `get_ai_context_state`

读取 AI 助手的**上下文管理器**状态：本轮装配进请求的各分段（人设 / 被动技能 / 主动技能 / 工程上下文 / 变更队列 / 历史 / 用户输入）的字符数、估算 token 与占用比例，以及哪些分段被临时禁用。首轮请求前快照为空（hasSnapshot=false）。返回的 id 可直接传给 set_ai_context_segment 临时禁用或恢复。

_无参数_

### `set_ai_context_segment`

临时启用 / 禁用 AI 上下文的某一个分段（只影响当前会话后续请求，不持久化，刷新即恢复）。segmentId 取自 get_ai_context_state 返回的 availableSegmentIds：persona（人设）/ passiveSkills（被动技能）/ activeSkills（主动技能清单）/ context（工程上下文）/ changes（变更队列）/ history（对话历史）/ user（用户输入）。enabled=false 即把该段从后续请求里剔除（用于压缩上下文、排障）；enabled=true 恢复注入。返回切换后的禁用清单。

| 参数        | 必填   | 类型    | 说明                                        |
| ----------- | ------ | ------- | ------------------------------------------- |
| `segmentId` | **是** | string  | 上下文分段 id（…）                          |
| `enabled`   | 否     | boolean | true=恢复注入，false=临时禁用（默认 false） |

### `reset_ai_context_segments`

恢复全部被临时禁用的 AI 上下文分段（把所有分段重新纳入后续请求）。只影响当前会话，不动持久化配置。

_无参数_

### `clear_ai_context_snapshot`

清空 AI 上下文的分段**快照**（下一次请求前上下文面板显示空态）。用于排障或强制下一轮重建上下文快照；不会清空对话历史（对话历史由界面上的「清空对话历史」按钮处理），也不动用量的会话累计。

_无参数_

### `get_ai_usage`

读取 AI 助手的 **token 与缓存命中用量**：本轮（turn）合计、本会话（session）累计，含 prompt / completion / total token、缓存命中与未命中 token、缓存命中率、请求数与其中「无服务商 usage、走本地估算回退」的请求数。字段缺失时返回 null（界面显示「—」，绝不臆造），estimatedRequests>0 说明有请求是本地估算值，不能当计费依据。

_无参数_

### `get_ai_turn_state`

读取 AI 助手的**实时运行情况**：是否正在请求、当前阶段（思考中 / 收到流式文本 / 正在调用工具 / 等待工具结果 / 空闲）、已耗时、当前工具名与补充说明，以及本轮已发生的工具调用列表（名称 / 参数 / 耗时 / 成败 / 结果梗概）。用于自检卡在哪一步或复盘本轮调用了哪些工具。

_无参数_

### `get_share_cooldown`

读取工程「分享」的 10 分钟频率限制状态：是否处于冷却中、剩余毫秒与 mm:ss 文案、冷却时长常量。分享本身是上传+本地导出动作，需用户在工程侧边栏右键发起（AI/WS 不代发），本工具只用于告知用户还要等多久。

_无参数_

## AI 助手 · 交互

### `ask_user`

向用户提出一个或多个结构化问题，并阻塞当前回合直到用户作答完毕。界面是**逐题问答**：每题可「上一题 / 下一题 / 忽略本题」，最后一题或任意时刻可「提交」；用户提交或放弃后你才会拿回控制权，期间不要假设用户已经看到或已经作答。 题型与结果里 values 的取值约定： - boolean（是否型）：界面显示「是 / 否」，values 为 ["yes"] 或 ["no"]，请不要给它 options。 - single（单选型）：values 为 [某个选项 value] 或 [用户自定义输入原文]；默认允许自定义输入。 - multi（多选型）：values 为 [选项 value, …]（可能为空），用户的自定义输入原文追加在末尾；默认允许自定义输入。 - 「其它」由界面保证只出现一次：你在 options 里已经写了「其它」（label 或 value 命中「其它 / 其他 / other / custom / 自定义」）时，界面**不会再补一行**，而是让那一项自己展开输入框（此时 answers[].values 里是用户输入的原文）；你没写时界面才补一行「其它」。 什么时候该用： - 缺少只有用户知道的关键信息（目标、偏好、业务含义、外部约束），且不打算为了猜而做无用功； - 存在多个都合理的实现方向，需要用户拍板（例如「要配置工程 Buff，还是管理主页 Buff 集」「用哪种出图口径」）； - 需求内部有冲突/歧义，必须先澄清再动手。 什么时候不该用： - 能自己查到的（工具清单/工程状态/文档里已有的），先自己查，不要把查询工作推给用户； - 不要拿它当「危险操作二次确认」——危险操作有专门的确认机制（工具的 dangerous 标记），用它只会无谓地打断用户一次。 结果约定： - answers 是逐题作答数组，含补全后的 id、type、skipped、values、custom（用户自定义输入原文）。 - 用户可以「忽略本题」（或提交时未答非必答题）：必须逐题检查 skipped，skipped=true 时 values 为空数组——不要臆造被跳过的答案，也不要把「没答」当成「默认值」。 - submitted=false 表示用户中途放弃、面板被关闭或本轮被取消：此时应当停止当前方案并直接询问用户下一步，不要自动重试同一个问题组。 - 额外字段 notes 记录了入参被改写过什么（补 id / 改写重复 id / 忽略 boolean 的 options / 截断超长文本），有内容时请据此修正下次调用。

| 参数          | 必填   | 类型   | 说明                                                                                                         |
| ------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------ |
| `title`       | 否     | string | 整组问题的标题（可选，显示在问答面板顶部），例如「需要你确认两件事」                                         |
| `description` | 否     | string | 为什么问这些（可选，显示在标题下方），简要说明背景即可                                                       |
| `questions`   | **是** | array  | 问题组，按顺序逐题提问，最多 20 题（与 Schema 的 maxItems 一致，便于模型预判规模）。每题一个对象，见 items。 |

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

获取当前的 Buff 命名规则（即内置技能卡「Buff 命名规则」的正文，用户可自行编辑）。返回空字符串表示该技能已禁用或正文被清空，生成前需要先询问用户。

_无参数_

### `set_naming_rule`

保存用户自定义的 Buff 命名规则：写入内置技能卡「Buff 命名规则」的正文（由用户从零定义，无预设风格，可能包含格式示例/简写习惯等）并启用它。保存后生成 Buff 会自动遵守。

| 参数   | 必填   | 类型   | 说明                       |
| ------ | ------ | ------ | -------------------------- |
| `rule` | **是** | string | 用户给出的完整命名规则描述 |

### `generate_buff_set_entity_buffs`

> ⚠️ **危险工具**：执行后不可轻易撤销

为本地 Buff 集中的指定实体（character/weapon/echo/1set-5set）生成 Buff 并写入主页的本地 Buff 集；仅在用户明确要求维护 Buff 集时使用，不用于给工程配 Buff（整体覆写该实体，来源变为自定义）。该工具会自动查询实体官方详情（角色技能/共鸣链/武器效果等）并提取 Buff，无需先调用其它查询工具；生成前若未定义命名规则会先询问用户。

| 参数         | 必填   | 类型   | 说明                                                            |
| ------------ | ------ | ------ | --------------------------------------------------------------- |
| `entityType` | **是** | string | 实体类型                                                        |
| `entityName` | **是** | string | 实体名称（中文）                                                |
| `namingRule` | 否     | string | 可选：用户新定义的命名规则（会写入内置技能卡「Buff 命名规则」） |

### `generate_project_buff_confs`

> ⚠️ **危险工具**：执行后不可轻易撤销

为当前工程队伍中的实体（角色/武器/首位声骸/触发套装）逐个生成工程 Buff 配置并导入当前工程拉表（含归属绑定）。该工具会自动查询各实体官方详情并提取 Buff，无需先调用其它查询工具。默认遍历全队，可用 slot（1-3）或 entityType 过滤。生成前若未定义命名规则会先询问用户。

| 参数         | 必填 | 类型   | 说明                                                            |
| ------------ | ---- | ------ | --------------------------------------------------------------- |
| `slot`       | 否   | number | 可选：只处理该槽位（1-3）                                       |
| `entityType` | 否   | string | 可选：只处理该实体类型                                          |
| `namingRule` | 否   | string | 可选：用户新定义的命名规则（会写入内置技能卡「Buff 命名规则」） |

## Buff 集

### `sync_buff_set_from_share`

> ⚠️ **危险工具**：执行后不可轻易撤销

从工坊同步最新 Buff 集到主页的本地 Buff 集。注意：会整体覆盖“来自工坊”的实体，且工坊中已下线的实体将被移除（自定义实体不受影响）。

_无参数_

### `list_buff_set_entities`

列出本地 Buff 集的实体（仅管理主页数据，不修改工程 Buff 配置；可按类型过滤）：实体名、类型、来源（share/custom）、Buff 数量。

| 参数         | 必填 | 类型   | 说明                                  |
| ------------ | ---- | ------ | ------------------------------------- |
| `entityType` | 否   | string | 可选：character/weapon/echo/1set-5set |

### `get_buff_set_entity_buffs`

查看本地 Buff 集中指定实体的全部 Buff 详情（不读取工程 Buff 配置；名称、作用范围、生效条件、乘区与数值、引用）。

| 参数         | 必填   | 类型   | 说明                                             |
| ------------ | ------ | ------ | ------------------------------------------------ |
| `entityType` | **是** | string | 实体类型：character/weapon/echo/1set-5set        |
| `entityName` | **是** | string | 实体名称（中文，用 list_buff_set_entities 定位） |

### `update_buff_set_entity_buffs`

> ⚠️ **危险工具**：执行后不可轻易撤销

整体覆写主页的本地 Buff 集中指定实体的 Buff 列表；仅在用户明确要求维护 Buff 集时使用，不用于给工程配 Buff（该实体来源变为 custom）。buffs 结构：[{"buffName":"名称","scope":"self\|self_except\|team\|effect_only","exclusive":false,"condition":{...可选},"zones":[{"zoneId":"乘区id","value":数值,"override":false,"ref":{...可选}}]}]。

| 参数         | 必填   | 类型   | 说明                                       |
| ------------ | ------ | ------ | ------------------------------------------ |
| `entityType` | **是** | string | 实体类型：character/weapon/echo/1set-5set  |
| `entityName` | **是** | string | 实体名称（中文）                           |
| `buffs`      | **是** | array  | 完整 Buff 列表（整体覆写，格式见工具描述） |

### `delete_buff_set_entity`

> ⚠️ **危险工具**：执行后不可轻易撤销

从本地 Buff 集删除指定实体（不可恢复）。

| 参数         | 必填   | 类型   | 说明                                      |
| ------------ | ------ | ------ | ----------------------------------------- |
| `entityType` | **是** | string | 实体类型：character/weapon/echo/1set-5set |
| `entityName` | **是** | string | 要删除的实体名称（中文）                  |

### `clear_buff_set`

> ⚠️ **危险工具**：执行后不可轻易撤销

清空整个本地 Buff 集（所有实体与 Buff，不可恢复）。

_无参数_

## 拉表

### `get_damage_entries`

获取当前工程的伤害条目（拉表）：**按条目在时间轴上的顺序**逐条给出「**序号** / 归属角色 / 名称 / 属性 / 伤害类型 / 已绑 Buff 名」。行首方括号里的数字就是序号，增删改（bind_buff_conf_to_entry / set_entry_damage_types / toggle_damage_type / get_damage_entry_buff_sources）填它。不含倍率与乘区数值——倍率用 get_timeline_damage_list，乘区与引用明细用 get_buff_conf_detail / get_damage_entry_buff_sources 按需查。

_无参数_

### `get_buff_confs`

获取工程 Buff 配置清单（一行一条）：行首方括号里的数字就是**序号**（create/rename/delete/绑定/乘区工具都填它）、名称、作用范围（self/self_except/team/effect_only/all）、是否全局默认、生效条件、乘区条数。**不含各乘区的数值/引用**——那部分用 get_buff_conf_detail 按需查；某条目绑了哪些 Buff 见 get_damage_entries。

_无参数_

### `create_buff_conf`

创建一条空的工程 Buff 配置。返回新配置的**序号**（清单里的第几条，见 get_buff_confs），后续操作用这个序号。

| 参数   | 必填   | 类型   | 说明               |
| ------ | ------ | ------ | ------------------ |
| `name` | **是** | string | 工程 Buff 配置名称 |

### `rename_buff_conf`

重命名指定工程 Buff 配置（按**序号**）。

| 参数       | 必填   | 类型   | 说明                                               |
| ---------- | ------ | ------ | -------------------------------------------------- |
| `buffConf` | **是** | number | 工程 Buff 配置序号（见 get_buff_confs 的「[NN]」） |
| `name`     | **是** | string | 新名称                                             |

### `duplicate_buff_conf`

复制指定工程 Buff 配置为一条新配置（按**序号**），可指定新名称（默认“原名 复制”）。返回新配置的序号。

| 参数         | 必填   | 类型   | 说明                        |
| ------------ | ------ | ------ | --------------------------- |
| `buffConf`   | **是** | number | 要复制的 工程 Buff 配置序号 |
| `customName` | 否     | string | 新集名称（可空）            |

### `delete_buff_conf`

> ⚠️ **危险工具**：执行后不可轻易撤销

删除指定工程 Buff 配置（按**序号**，同时清理它对所有条目的绑定）。

| 参数       | 必填   | 类型   | 说明               |
| ---------- | ------ | ------ | ------------------ |
| `buffConf` | **是** | number | 工程 Buff 配置序号 |

### `bind_buff_conf_to_entry`

把指定工程 Buff 配置绑定到指定伤害条目（该条目计算时生效）。两个参数都填**序号**：条目序号见 get_damage_entries，工程 Buff 配置序号见 get_buff_confs。

| 参数       | 必填   | 类型   | 说明                                               |
| ---------- | ------ | ------ | -------------------------------------------------- |
| `entry`    | **是** | number | 伤害条目序号（见 get_damage_entries 的「[NN]」）   |
| `buffConf` | **是** | number | 工程 Buff 配置序号（见 get_buff_confs 的「[NN]」） |

### `unbind_buff_conf_from_entry`

把指定工程 Buff 配置从指定伤害条目解除绑定（两个参数都填**序号**）。

| 参数       | 必填   | 类型   | 说明               |
| ---------- | ------ | ------ | ------------------ |
| `entry`    | **是** | number | 伤害条目序号       |
| `buffConf` | **是** | number | 工程 Buff 配置序号 |

### `set_entry_damage_types`

设置指定伤害条目的伤害类型列表（覆盖，按**序号**）。取值：普攻伤害/重击伤害/共鸣技能伤害/共鸣解放伤害/声骸技能伤害/变奏技能伤害/延奏技能伤害/协同攻击伤害/效应伤害/其它类型伤害。

| 参数          | 必填   | 类型   | 说明                                             |
| ------------- | ------ | ------ | ------------------------------------------------ |
| `entry`       | **是** | number | 伤害条目序号（见 get_damage_entries 的「[NN]」） |
| `damageTypes` | **是** | array  | 伤害类型列表（可空 = 清空）                      |

### `toggle_damage_type`

切换指定伤害条目的单个伤害类型（加上或移除，按**序号**）。已勾选的会被移除 —— 要「确保勾上」请先用 get_damage_entries 看当前类型。

| 参数         | 必填   | 类型   | 说明                                             |
| ------------ | ------ | ------ | ------------------------------------------------ |
| `entry`      | **是** | number | 伤害条目序号（见 get_damage_entries 的「[NN]」） |
| `damageType` | **是** | string | 伤害类型（如 共鸣技能伤害）                      |

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

| 参数    | 必填   | 类型   | 说明            |
| ------- | ------ | ------ | --------------- |
| `slot`  | **是** | number | 角色槽位（1-3） |
| `value` | **是** | number | 阶数 0-5        |

### `toggle_condition_mismatch_hide`

切换“可用Buff/全部Buff”过滤：开启时隐藏条件不匹配（链/阶低于配置、属性/类型对不上条目）的 Buff。

_无参数_

### `import_buff_set_entity_to_project`

把主页 Buff 集中指定实体（角色/武器/首位声骸/套装）的全部 Buff 导入当前工程 Buff 配置（保留实体归属，导入后可再绑定到伤害条目）。entityType 取值：character/weapon/echo/1set/2set/3set/4set/5set。

| 参数         | 必填   | 类型   | 说明     |
| ------------ | ------ | ------ | -------- |
| `entityType` | **是** | string | 实体类型 |
| `entityName` | **是** | string | 实体名称 |

### `get_buff_conf_detail`

获取指定工程 Buff 配置的完整详情：作用范围、是否全局、生效条件（链/阶硬门槛 + 属性/类型条件）、每个乘区条目（zoneId/数值/是否覆盖/引用/**各自的乘区级条件**）及其生效角色槽位。同一乘区可有多条，每条各自判定条件后相加；覆盖唯一（同一乘区仅一个覆盖条目）。

| 参数       | 必填   | 类型   | 说明                                               |
| ---------- | ------ | ------ | -------------------------------------------------- |
| `buffConf` | **是** | number | 工程 Buff 配置序号（见 get_buff_confs 的「[NN]」） |

### `set_buff_conf_zone`

设置工程 Buff 配置内指定乘区的数值（百分数乘区填数值，如 15 表示 15%）。zoneId 不存在时自动创建。zoneId 可选：atkFlat/atkPct/hpFlat/hpPct/defFlat/defPct/critRate/critDmg/recharge/tuneBreakBoost/offTuneBuildupRate/bonusDmg/deepenDmg/resPen/defPen/defDown/dmgRedPen/resDown/tuneStrainLayer/unisonBoonLayer/finalDmg/dmgTakenInc/specialFinal1/specialFinal2/extraRatio。其中 tuneStrainLayer（集谐干涉层数）与 unisonBoonLayer（同奏增益层数）是层数类 flat 乘区，填层数本身（如 +2 层 → value=2）；集谐干涉层数只允许固定层数、不可配引用/转模，也不能作为引用目标 —— 它挂在**目标/怪物**身上、全队共用一份，不存在「某角色的集谐干涉层数」；同奏增益层数属于角色，可以配引用/转模、也可以作为引用来源。旧 id customFinalDmg/customFinalDmgMul 会被自动重映射为 specialFinal1/specialFinal2（返回值里用 remappedFrom/remapNote 标注）。override 为 true 时该乘区覆盖其它 Buff 的同乘区（extraRatio 不支持覆盖）；同一 Buff 内每个乘区只允许一个覆盖条目，开启时落在该乘区第一条、其余条目自动取消覆盖。

| 参数       | 必填   | 类型    | 说明                                               |
| ---------- | ------ | ------- | -------------------------------------------------- |
| `buffConf` | **是** | number  | 工程 Buff 配置序号（见 get_buff_confs 的「[NN]」） |
| `zoneId`   | **是** | string  | 乘区 id（接受旧 id，会自动重映射）                 |
| `value`    | **是** | number  | 数值                                               |
| `override` | 否     | boolean | 可选，是否覆盖其它 Buff 的同乘区                   |

### `set_buff_conf_zone_ref`

设置工程 Buff 配置内指定乘区的引用（跟随某角色的属性按百分比折算），ref 为 null 时清除引用。ref 结构：{"targetZoneId":"引用目标","pct":百分比,"characterIdx":槽位 1-3,"threshold":阈值,"lower"/"upper"/"discrete"/"divisor"/"multiplier"可选}。targetZoneId 可选：baseAtk/totalAtk/baseHp/totalHp/baseDef/totalDef/recharge/tuneBreakBoost/offTuneBuildupRate/critRate/critDmg/unisonBoonLayer（最后一项是**按角色独立**的同奏增益层数：读该角色自己累计的层数，可用于「按层数折算」的转模；集谐干涉层数不属于角色，不能作为引用目标）。乘区 id 接受旧 id（customFinalDmg/customFinalDmgMul 会自动重映射）。**跨角色影响源**：引用他角色面板（characterIdx 与目标角色不同）后，作用域指向该角色的 Buff 必须用 bind_buff_conf_to_entry 勾到本段才会参与面板计算，可用 get_buff_conf_detail 或 get_damage_entry_buff_sources 查影响源清单。

| 参数       | 必填   | 类型   | 说明                               |
| ---------- | ------ | ------ | ---------------------------------- |
| `buffConf` | **是** | number | 工程 Buff 配置序号                 |
| `zoneId`   | **是** | string | 乘区 id（接受旧 id，会自动重映射） |
| `ref`      | 否     | object | 引用定义或 null 清除               |

### `remove_buff_conf_zone`

> ⚠️ **危险工具**：执行后不可轻易撤销

从工程 Buff 配置中删除指定乘区（不可恢复；同一乘区的多条贡献条目会全部删除）。乘区 id 接受旧 id（customFinalDmg/customFinalDmgMul 会自动重映射）。

| 参数       | 必填   | 类型   | 说明                               |
| ---------- | ------ | ------ | ---------------------------------- |
| `buffConf` | **是** | number | 工程 Buff 配置序号                 |
| `zoneId`   | **是** | string | 乘区 id（接受旧 id，会自动重映射） |

### `get_buff_conf_zone_condition`

读取某条工程 Buff 配置内指定乘区的**乘区级生效条件**（伤害属性 / 伤害类型；类内「或」）。只读取，不修改。同一乘区有多条贡献条目时返回第一条的条件，完整逐条清单请用 get_buff_conf_detail。

| 参数       | 必填   | 类型   | 说明                                               |
| ---------- | ------ | ------ | -------------------------------------------------- |
| `buffConf` | **是** | number | 工程 Buff 配置序号（见 get_buff_confs 的「[NN]」） |
| `zoneId`   | **是** | string | 乘区 id（接受旧 id，会自动重映射）                 |

### `set_buff_conf_zone_condition`

设置某条工程 Buff 配置内指定乘区的**乘区级生效条件**，传 null 清除。只接受 elements（伤害属性）与 damageTypes（伤害类型）两类，可只给其中一类；condition 对象形如 {"elements":["冷凝","热熔"],"damageTypes":["普攻伤害","重击伤害"]}。取值边界：属性取自 game-terms 的 ELEMENTS、伤害类型取自 DAMAGE_TYPES（见参数说明里的完整可选值）。判定口径为**类内「或」、类间「与」**——同类多选任一命中即满足，两类都给了则必须同时满足。链条件（chains）与阶条件（refinements）是整个 Buff 的硬门槛，不允许挂到乘区上（传了会被忽略并回传 strippedKeys），请用 set_buff_conf_condition 设置。生效效果：不满足时仅该乘区不计入，同一条目的其它乘区照常生效。

| 参数        | 必填   | 类型   | 说明                                                  |
| ----------- | ------ | ------ | ----------------------------------------------------- |
| `buffConf`  | **是** | number | 工程 Buff 配置序号（见 get_buff_confs 的「[NN]」）    |
| `zoneId`    | **是** | string | 乘区 id（接受旧 id，会自动重映射）                    |
| `condition` | 否     | object | 乘区级条件（只认 elements/damageTypes），或 null 清除 |

### `get_damage_entry_buff_sources`

查询某伤害条目的**跨角色影响源**（按**序号**）：本段引用了其它角色的面板（乘区 ref 里 characterIdx 指向他角色）时，作用域指向那个角色、且会改写被引用面板乘区的 Buff —— 这些 Buff 必须用 bind_buff_conf_to_entry 勾到本段才会参与该角色在这一段的面板计算（拉表里它们以「影响源」列/勾选项出现，不是自动生效的）。返回每条影响源的**工程 Buff 配置序号**与名称、被引用角色槽位、被改写的面板乘区。

| 参数    | 必填   | 类型   | 说明                                             |
| ------- | ------ | ------ | ------------------------------------------------ |
| `entry` | **是** | number | 伤害条目序号（见 get_damage_entries 的「[NN]」） |

### `set_buff_conf_scope`

设置工程 Buff 配置的作用范围：all（全队）或槽位数组（如 [1,3] 表示仅 1、3 号位）。全局工程 Buff 配置不可修改范围。

| 参数       | 必填   | 类型           | 说明                 |
| ---------- | ------ | -------------- | -------------------- |
| `buffConf` | **是** | number         | 工程 Buff 配置序号   |
| `scope`    | **是** | string / array | all 或槽位数组 [1-3] |

### `set_buff_conf_condition`

设置工程 Buff 配置生效条件（全部满足才生效），传 null 清除。condition 结构：{"chain":共鸣链要求 0-6,"refinement":精炼要求 1-5,"elements":["伤害属性..."],"damageTypes":["伤害类型..."]}。全局工程 Buff 配置不可设置链/阶条件。

| 参数        | 必填   | 类型   | 说明                 |
| ----------- | ------ | ------ | -------------------- |
| `buffConf`  | **是** | number | 工程 Buff 配置序号   |
| `condition` | 否     | object | 条件定义或 null 清除 |

### `get_table_history`

读取拉表（表格）撤销/重做历史状态：是否可撤销、是否可重做。拉表历史与排轴历史相互独立——本工具只看表格，排轴用 get_timeline_summary 配合 undo_timeline/redo_timeline。

_无参数_

### `undo_table`

撤销上一次**拉表（表格）**变更（工程 Buff 配置增删改、条目↔Buff 绑定、伤害类型勾选等）。只回退表格，不动排轴与词条；排轴请用 undo_timeline。没有可撤销的操作时 ok=false 并给出原因（不会静默成功）。

_无参数_

### `redo_table`

重做上一次被撤销的**拉表（表格）**变更。只影响表格，不动排轴与词条；排轴请用 redo_timeline。没有可重做的操作时 ok=false 并给出原因。

_无参数_

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
| `char`  | **是** | number | 角色槽位（1-3）                                        |
| `slot`  | **是** | number | 声骸槽位（1-5）                                        |
| `label` | **是** | string | 副词条名称                                             |
| `value` | 否     | number | 可选，覆盖中档默认值（百分数词条填数值，如 8 表示 8%） |

### `remove_substat`

> ⚠️ **危险工具**：执行后不可轻易撤销

移除指定角色槽位（1-3）第 N 个声骸（1-5）的第 idx 条副词条（从 0 开始）。

| 参数   | 必填   | 类型   | 说明                    |
| ------ | ------ | ------ | ----------------------- |
| `char` | **是** | number | 角色槽位（1-3）         |
| `slot` | **是** | number | 声骸槽位（1-5）         |
| `idx`  | **是** | number | 副词条下标（从 0 开始） |

### `update_substat_value`

修改指定角色槽位（1-3）第 N 个声骸（1-5）第 idx 条副词条（从 0 开始）的数值（百分数词条填数值，如 8 表示 8%）。

| 参数    | 必填   | 类型   | 说明                                     |
| ------- | ------ | ------ | ---------------------------------------- |
| `char`  | **是** | number | 角色槽位（1-3）                          |
| `slot`  | **是** | number | 声骸槽位（1-5）                          |
| `idx`   | **是** | number | 副词条下标（从 0 开始）                  |
| `value` | **是** | number | 新数值（百分数词条填数值，如 8 表示 8%） |

### `update_enemy`

修改敌人配置项：level（等级）、defense（防御）、dmgReduction（减伤，数值如 10 表示 10%）、type（BOSS/精英怪/小怪）。

| 参数    | 必填   | 类型                                            | 说明                                                                                             |
| ------- | ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `key`   | **是** | string（level / defense / dmgReduction / type） | 要修改的配置项                                                                                   |
| `value` | **是** | number / string                                 | 目标值：level/defense 为数值，dmgReduction 为百分比数值（10 表示 10%），type 为 BOSS/精英怪/小怪 |

### `update_resistance`

修改敌人某元素抗性（百分比数值，如 10 表示 10%）。元素：物理/冷凝/热熔/导电/气动/衍射/湮灭。

| 参数      | 必填   | 类型   | 说明                                       |
| --------- | ------ | ------ | ------------------------------------------ |
| `element` | **是** | string | 元素名：物理/冷凝/热熔/导电/气动/衍射/湮灭 |
| `value`   | **是** | number | 抗性百分比数值（如 10 表示 10%）           |

## 库街区

### `get_kuro_state`

查看库街区登录态与声骸数据暂存：是否登录、账号、绑定角色、登录有效性、本地暂存的数据时间与可刷新倒计时。

_无参数_

### `check_kuro_login`

让服务端向上游确认一次库街区登录是否仍有效（即设置里的「检验登录有效性」），返回有效性、原因、账号与绑定角色。

_无参数_

### `refresh_kuro_echo_data`

强制从库街区重新拉取当前绑定角色的声骸数据并写入本地暂存（同一份数据 5 分钟只能刷新一次，冷却期内会报错）。

_无参数_

### `open_kuro_sync_preview`

打开「词条集 → 从库街区同步」预览弹窗（会先打开词条集面板，然后载入当前暂存/上游数据），

_无参数_

### `kuro_logout`

> ⚠️ **危险工具**：执行后不可轻易撤销

退出库街区登录（同时清除本地声骸数据暂存）。用户要求退出或换账号时使用。

_无参数_

## 面板

### `get_panels_state`

查看当前所有弹窗面板的开关状态（工程 Buff 配置/速查/主页 Buff 集/设置/工坊/角色详情配置/从 Buff 集导入工程 Buff 配置等）。

_无参数_

### `open_panel`

打开或关闭指定弹窗面板：buff-set=主页 Buff 集（打开时先返回主页）；buff-conf=当前工程拉表的工程 Buff 配置；buff-conf-import=从 Buff 集导入工程 Buff 配置。两者是不同入口，用户说“打开 Buff 集”时用 buff-set，含义不清时先用 ask_user 确认。其它 panel 取 get_panels_state 返回的 name（quick-lookup/substat-library/settings/workshop/character-detail/damage-list 等）；open 默认 true。

| 参数    | 必填   | 类型    | 说明                                                                                                          |
| ------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| `panel` | **是** | string  | buff-set=主页 Buff 集；buff-conf=工程 Buff 配置；buff-conf-import=导入工程 Buff 配置；其它见 get_panels_state |
| `open`  | 否     | boolean | 打开(true)/关闭(false)，默认 true                                                                             |

## 工程

### `list_projects`

列出所有本地工程（含名称、是否当前活动、是否已归档）。AI 需要了解有哪些工程时调用。

_无参数_

### `get_project_state`

获取当前活动工程的状态：工程名、队伍（各槽位角色与武器）、各环节锁定情况。AI 动手前应调用以了解现状。要看某一个环节的**内容**，用按时间顺序渲染的摘要工具（比原始工程 JSON 紧凑）：排轴 get_timeline_summary、拉表 get_damage_entries、配装 get_config_summary。

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

| 参数   | 必填   | 类型   | 说明                                                   |
| ------ | ------ | ------ | ------------------------------------------------------ |
| `id`   | **是** | string | 工程 id（用 list_projects 获取）；空字符串表示返回主页 |
| `name` | **是** | string | 新名称                                                 |

### `set_active_project`

切换当前活动工程（后续操作都作用于该工程）；id 传空字符串返回主页，之后可打开主页的 Buff 集。

| 参数 | 必填   | 类型   | 说明                             |
| ---- | ------ | ------ | -------------------------------- |
| `id` | **是** | string | 工程 id（用 list_projects 获取） |

### `archive_project`

> ⚠️ **危险工具**：执行后不可轻易撤销

将指定工程归档（从侧边栏隐藏，可在设置-归档管理中恢复）。

| 参数 | 必填   | 类型   | 说明                             |
| ---- | ------ | ------ | -------------------------------- |
| `id` | **是** | string | 工程 id（用 list_projects 获取） |

### `unarchive_project`

将已归档工程恢复显示。

| 参数 | 必填   | 类型   | 说明                  |
| ---- | ------ | ------ | --------------------- |
| `id` | **是** | string | 要恢复的已归档工程 id |

### `delete_project`

> ⚠️ **危险工具**：执行后不可轻易撤销

永久删除指定工程（不可恢复）。

| 参数 | 必填   | 类型   | 说明                |
| ---- | ------ | ------ | ------------------- |
| `id` | **是** | string | 要永久删除的工程 id |

### `clone_project`

克隆指定工程（全部环节）为新工程，新工程名可指定。

| 参数      | 必填   | 类型   | 说明              |
| --------- | ------ | ------ | ----------------- |
| `id`      | **是** | string | 要克隆的源工程 id |
| `newName` | **是** | string | 新工程名称        |

### `lock_phase`

锁定当前活动工程的指定环节（team/timeline/calculation/config）。

| 参数    | 必填   | 类型                                             | 说明                               |
| ------- | ------ | ------------------------------------------------ | ---------------------------------- |
| `phase` | **是** | string（team / timeline / calculation / config） | 要锁定的环节（锁后其内容不可修改） |

### `unlock_phase`

解锁当前活动工程的指定环节及后续所有环节。

| 参数    | 必填   | 类型                                             | 说明                                 |
| ------- | ------ | ------------------------------------------------ | ------------------------------------ |
| `phase` | **是** | string（team / timeline / calculation / config） | 要解锁的环节（其后的环节会一并解锁） |

### `get_buff_set_summary`

获取主页的本地 Buff 集概览（不读取工程 Buff 配置）：实体数量、按类型分布、数据来源（工坊同步/自定义）。

_无参数_

## 结果

### `get_result_summary`

基于当前配装/Buff/条件配置计算并返回伤害结果摘要：每个伤害条目的期望伤害（含暴击）与全队总伤害。可用来回答“这套配置伤害多少”“哪个技能伤害最高”。

_无参数_

### `get_result_entry_breakdown`

查询单条伤害结果条目及其全部乘区溯源（每段的数值与来源：基础值/白值/绿值、增伤/加深/易伤/抗性/防御/免伤/集谐/同奏/终伤/特殊/暴击等乘区，各乘区的 buff 来源与折算贡献）。entryId 用 get_result_summary 获取。用于回答“这条伤害是怎么算出来的”“哪个 buff 贡献最大”“为什么这条伤害偏低”。

| 参数      | 必填   | 类型   | 说明                                   |
| --------- | ------ | ------ | -------------------------------------- |
| `entryId` | **是** | string | 伤害条目 id（get_result_summary 获取） |

### `get_data_analysis`

查询结果页「数据分析」弹窗的全部分析结果：全队总伤害与 DPS、队伍伤害占比（各角色）、各角色直伤类型占比（普攻/重击/共技/共解等）、三种词条贡献算法（single-loss 单减损 / shapley 夏普利 / partial-derivative 偏导）的副词条贡献明细。用于回答“队伍 DPS 多少”“各角色伤害占比”“该优先升什么词条”“三算法结论是否一致”。

_无参数_

## 设置

### `get_settings_state`

读取当前设置状态——覆盖「设置」弹窗全部可配置项：外观主题、按键图标、交互（含锁定水印）、性能、工坊、连接配置（数据源）、缓存、助手设置。具体子项可用专用工具查询（get_keymap/get_shortcuts/get_ai_profiles/get_cache_counts）。

_无参数_

### `set_setting`

修改允许 AI 控制的设置。key 白名单：theme_mode(dark/light)、theme_accent_hue(default=青色/orange=橘红/orangeyellow=橙黄/magenta=品红/cyan=青色别名/indigo=靛蓝/green=墨绿/mono=黑白 或 0-360 整数)、theme_background_image(http(s)/data:image 地址或空串清除；白天/黑夜各一张，写法为地址或 {mode:"light"\|"dark", url}，缺省写当前主题那张)、theme_bg_image_effect(对象 {blur?:0-32, mask?:-200全黑~~0原图~~200极白, mode?:"light"\|"dark"}，按昼夜分别保存)、appearance_reset(值可空，或 "light"/"dark"/"白天"/"黑夜" 指定昼夜；恢复该昼夜的区域质感与背景图效果默认值)、surface_style(对象 {surface:"card\|modal\|sidebar\|content\|toolbar\|widget", opacity?:0-100（不透明度）, blur?:0-32, depth?:0-100(昼更白/夜更黑), reset?:true, mode?:"light"\|"dark"}，按昼夜分别保存；card=卡片（卡片类容器：声骸/套装/方案卡、结果页伤害行、下拉拉表与平铺拉表的行与单元格）；modal=弹窗（所有弹窗外壳（设置、工坊、各类 picker、确认框）的面板本体）；sidebar=侧边栏（工程列表侧边栏，含其顶部标题栏与列表项）；content=主内容区（欢迎页、队伍配置、排轴、拉表、词条/环境配置、结果页各自的主内容区底色）；toolbar=工具栏（顶部工具栏、底部工具栏、底部悬浮工具栏、阶段页签栏）；widget=小部件（小控件，可出现在任意容器内部（故与上面五项正交）：卡片式小块及其行/格、图标按钮、picker 卡、声骸槽卡、词条卡、操作块、属性/抗性输入框等。成片逐行/逐格元素请叠加 data-sf-flat，避免每个元素都重算一次背景模糊。注：开关与滑块用语义色、下拉与菜单项走 --theme-context-menu-* 组件命名空间，均不归本区域）)、calc_view(dropdown/spread)、simplify_toolbar、simplify_context_menu、magnetic_pointer、confirm_deletes(删除前二次确认)、sidebar_actions(侧边栏新建/导入按钮开关)、modal_close_position(top-left/top-right 弹窗关闭按钮位置)、toast_position(top-right/none/top-left/top-center/bottom-center/bottom-left/bottom-right)、multi_entry_expand(结果页是否允许同时展开多个伤害条目，默认 false=同时只展开一个)、lock_watermark(排轴锁定水印开关)、lock_watermark_text(水印文本，最长 24 字，空串=回落「已锁定」)、gpu_accel、reload_on_result_refresh、reload_on_profile_change、data_provider(数据源 id 或 default=重置)、clear_cache(list/info/image/all)、ai_enabled(布尔)、ai_danger_mode(ask/ask_once/trust)、ai_persona_prompt(文本或空串=恢复默认)。按键图标/快捷键位/AI 配置文件/工坊实例请用专用工具 set_keymap_entry/set_shortcut/manage_ai_profile/manage_workshop，归档管理用 archive_project/unarchive_project/delete_project；Buff 命名规则与黑话词典是内置技能卡，正文用技能工具（list_skills / use_skill）查看、由用户在设置里编辑。

| 参数    | 必填   | 类型                      | 说明                           |
| ------- | ------ | ------------------------- | ------------------------------ |
| `key`   | **是** | string                    | 设置项 key（见描述中的白名单） |
| `value` | **是** | string / number / boolean | 目标值                         |

### `manage_workshop`

管理工坊实例：switch=切换到指定实例（传 id）、add=添加实例（传 url）、remove=删除实例（传 id，至少保留 1 个）、reset=恢复默认实例列表。返回当前实例列表与选中 id。

| 参数     | 必填   | 类型                                    | 说明                        |
| -------- | ------ | --------------------------------------- | --------------------------- |
| `action` | **是** | string（switch / add / remove / reset） | 操作类型                    |
| `id`     | 否     | string                                  | 实例 id（switch/remove 用） |
| `url`    | 否     | string                                  | 实例地址（add 用）          |

### `get_keymap`

读取按键图标映射（每个操作动作 → 显示的键盘/鼠标图标 key）。返回所有按键映射条目。

_无参数_

### `set_keymap_entry`

修改单个按键图标映射。id 为操作动作 id（如 attack/dodge/q/e/r/f/t/space 等）；blockKey 为显示的图标 key（如 MouseLeft/MouseRight/Q/E/R/F/T/SpaceBar）；physical 为物理按键（单个小写字母 a-z 或空格 " "）。传 reset=true 可恢复全部按键图标为默认（此时忽略 id 等其它参数）。

| 参数       | 必填 | 类型    | 说明                                    |
| ---------- | ---- | ------- | --------------------------------------- |
| `id`       | 否   | string  | 操作动作 id（见 get_keymap 返回）       |
| `blockKey` | 否   | string  | 图标 key（如 MouseLeft/Q/SpaceBar）     |
| `physical` | 否   | string  | 物理按键（单个小写字母 a-z 或空格 " "） |
| `reset`    | 否   | boolean | true = 恢复默认按键图标映射             |

### `get_shortcuts`

读取界面快捷键映射（排轴/拉表各操作的快捷键）。返回所有快捷键定义及其当前绑定键。

_无参数_

### `set_shortcut`

修改单个界面快捷键绑定。id 为快捷键定义 id（见 get_shortcuts 返回）；key 为新的快捷键组合（如 "ctrl+s"、"shift+enter"、"a"）。修饰键（Ctrl/Shift/Alt）用 + 连接，主键小写。若与同组其他快捷键冲突将报错。传 reset=true 可恢复全部快捷键为默认（此时忽略 id/key）。

| 参数    | 必填 | 类型    | 说明                                      |
| ------- | ---- | ------- | ----------------------------------------- |
| `id`    | 否   | string  | 快捷键定义 id                             |
| `key`   | 否   | string  | 新快捷键组合（如 ctrl+s、a、shift+enter） |
| `reset` | 否   | boolean | true = 恢复默认快捷键绑定                 |

### `get_ai_profiles`

读取 AI 配置文件列表（每个含服务地址/模型/思考强度，apiKey 仅返回是否已设置不暴露明文）及当前激活的配置 id。

_无参数_

### `manage_ai_profile`

管理 AI 配置文件：add=新建（传 label，可选 baseUrl/model/apiKey/reasoningEffort）、switch=切换激活（传 id）、update=修改（传 id + 可选字段）、delete=删除（传 id，至少保留 1 个）。reasoningEffort 须为 low/medium/high。返回操作结果（apiKey 永远不回显明文）。

| 参数              | 必填   | 类型                                     | 说明                                                     |
| ----------------- | ------ | ---------------------------------------- | -------------------------------------------------------- |
| `action`          | **是** | string（add / switch / update / delete） | 操作类型                                                 |
| `id`              | 否     | string                                   | 配置 id（switch/update/delete 用）                       |
| `label`           | 否     | string                                   | 配置名称（add 用，update 可选）                          |
| `baseUrl`         | 否     | string                                   | 服务地址（add/update 可选，如 https://api.deepseek.com） |
| `model`           | 否     | string                                   | 模型名（add/update 可选）                                |
| `apiKey`          | 否     | string                                   | API Key（add/update 可选；空串=清除）                    |
| `reasoningEffort` | 否     | string（low / medium / high）            | 思考强度（add/update 可选）                              |

### `get_cache_counts`

读取各类缓存条目数（列表/详情/图像）。可用 set_setting key=clear_cache 清理（值 list/info/image/all）。

_无参数_

## 技能卡

### `list_skills`

列出用户的技能卡（名称 + 类型 + 一句话描述 + 是否启用）。主动技能在任务匹配时用 use_skill 激活其正文；被动技能已常驻生效，正文已在系统提示中，无需激活。

_无参数_

### `use_skill`

激活一张**主动**技能卡：返回该技能的完整正文，之后请严格按正文中的规范继续处理当前任务。名称必须来自技能清单（被动技能无需激活，其正文已常驻生效）。

| 参数   | 必填   | 类型   | 说明                               |
| ------ | ------ | ------ | ---------------------------------- |
| `name` | **是** | string | 技能名（来自技能清单，需完全一致） |

## 词条集（方案）

### `list_substat_plans`

列出词条集（快速词条方案）里的声骸词条方案。传 character 时列出该角色全部方案（第一项固定为「标准14词条」，其余为自定义）；不传时列出本地库里有方案的角色及数量。

| 参数        | 必填 | 类型   | 说明                       |
| ----------- | ---- | ------ | -------------------------- |
| `character` | 否   | string | 可选：角色名（如「绯雪」） |

### `get_substat_plan`

查看某个声骸词条方案的完整 5 槽位明细（cost、主词条、第二主词条、副词条）。不传 name 时返回该角色的标准14词条（自动生成/工坊/本地修改都算）。

| 参数        | 必填   | 类型    | 说明                          |
| ----------- | ------ | ------- | ----------------------------- |
| `character` | **是** | string  | 角色名                        |
| `name`      | 否     | string  | 方案名；省略则取标准14词条    |
| `standard`  | 否     | boolean | true 表示取该角色的标准14词条 |

### `save_substat_plan`

> ⚠️ **危险工具**：执行后不可轻易撤销

新建或覆盖一条声骸词条方案（覆盖会先弹确认框）。standard=true 时写的是该角色的标准14词条，要求副词条恰好 14 条；自定义方案要求 5 个槽位、cost 取值 1/3/4 且合计 ≤12、每槽副词条 ≤5 且不重复。slots 里主词条可写字符串（如 "暴击率"，数值自动取满级），副词条可写 "暴击率" 或 {type:"暴击率",value:7.5}（数值自动吸附到合法档位）。

| 参数        | 必填   | 类型    | 说明                                                 |
| ----------- | ------ | ------- | ---------------------------------------------------- |
| `character` | **是** | string  | 角色名                                               |
| `name`      | 否     | string  | 方案名（standard=true 时忽略，固定为「标准14词条」） |
| `standard`  | 否     | boolean | 可选：true 表示写标准14词条                          |
| `slots`     | **是** | array   | 5 个声骸槽位                                         |

### `rename_substat_plan`

重命名一条自定义方案（标准14词条不能改名）。

| 参数        | 必填   | 类型   | 说明       |
| ----------- | ------ | ------ | ---------- |
| `character` | **是** | string | 角色名     |
| `name`      | **是** | string | 当前方案名 |
| `newName`   | **是** | string | 新方案名   |

### `delete_substat_plan`

> ⚠️ **危险工具**：执行后不可轻易撤销

删除一条自定义声骸词条方案（不可恢复；标准14词条不能删除，需要清掉改动请用 reset_standard_substat_plan）。

| 参数        | 必填   | 类型   | 说明   |
| ----------- | ------ | ------ | ------ |
| `character` | **是** | string | 角色名 |
| `name`      | **是** | string | 方案名 |

### `apply_substat_plan`

把某条声骸词条方案套用到当前配队里的该角色（替换其 5 个声骸词条）。不传 name 时套用标准14词条；该角色不在配队中会报错。

| 参数        | 必填   | 类型    | 说明                          |
| ----------- | ------ | ------- | ----------------------------- |
| `character` | **是** | string  | 角色名                        |
| `name`      | 否     | string  | 方案名；省略则套用标准14词条  |
| `standard`  | 否     | boolean | 可选：true 表示套用标准14词条 |

### `reset_standard_substat_plan`

> ⚠️ **危险工具**：执行后不可轻易撤销

重置某角色的标准14词条：清掉本地修改/工坊同步的版本，回落到「工坊同步」或按角色数据自动生成。

| 参数        | 必填   | 类型   | 说明   |
| ----------- | ------ | ------ | ------ |
| `character` | **是** | string | 角色名 |

### `sync_substat_plans_from_share`

> ⚠️ **危险工具**：执行后不可轻易撤销

从工坊同步全部角色的标准14词条集（只覆盖工坊来源的方案，本地修改与自定义方案不受影响；工坊已下线的会移除）。

_无参数_

### `sync_substat_plans_from_kuro`

> ⚠️ **危险工具**：执行后不可轻易撤销

从库街区同步当前账号下鸣潮角色「正在装配的声骸」，写成本地自定义词条方案（方案名「库街区同步」，同名覆盖、可重复同步）。

_无参数_

## 队伍

### `get_team_catalog`

获取可用的队伍配置数据：角色（元素/武器类型）、武器（类型/星级）、声骸（cost/所属套装）、套装（支持件数）。设置队伍前先调用以获取准确名称。

_无参数_

### `get_recommended_weapons`

获取某角色的推荐武器（官方推荐顺序，首项通常为最优）。为队伍角色挑武器、或需要了解某角色常用武器时调用；返回的武器名可直接传给 set_team_weapon。

| 参数            | 必填   | 类型   | 说明                                         |
| --------------- | ------ | ------ | -------------------------------------------- |
| `characterName` | **是** | string | 角色名称（中文，可用 get_team_catalog 查询） |

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

| 参数   | 必填   | 类型   | 说明                                    |
| ------ | ------ | ------ | --------------------------------------- |
| `slot` | **是** | number | 槽位 1-3                                |
| `sets` | **是** | array  | 触发套装列表（整体覆盖），总有效件数 ≤5 |

## 排轴

### `get_timeline_summary`

获取当前排轴：**按时间（pos）顺序**列出所有操作块、参考线与已绑定的伤害。每行给出秒数、轨道与角色、操作内容、id，其下缩进列出该块绑定的伤害命中（只给命中名，**不含倍率**——倍率用 get_timeline_damage_list 按需查）。AI 需要看排轴结构时调用（比原始 JSON 更紧凑、顺序更清楚）。

_无参数_

### `get_timeline_damage_list`

**按需**查询排轴里每个已绑定伤害的**倍率明细**（命中名、倍率、属性、系数类型；含效应/处决/响应的折算结果），按时间顺序每行一条。只想看排轴结构（哪些块、绑了什么）请用 get_timeline_summary —— 那里不含倍率，避免无谓的 token 开销。

_无参数_

### `add_op_block`

在当前排轴指定轨道（1-3）追加一个操作块，位置为三行最右空白位置（按顺序排轴：新块总是落在所有操作块之后）。key 支持：普攻/重击/闪避/跳跃/共鸣技能/共鸣解放/声骸技能/谐度破坏，或 Q/E/R/F/T 等字母。desc 为描述文本（如“重击”“变奏入场”）。返回新块的**序号**（时间轴上的第几个操作块）。

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

| 参数    | 必填   | 类型   | 说明                                                                  |
| ------- | ------ | ------ | --------------------------------------------------------------------- |
| `block` | **是** | number | 操作块**序号**（时间轴上第几个，见 get_timeline_summary 的「[块N]」） |
| `hits`  | **是** | array  | 要绑定到该操作块的伤害条目列表                                        |

### `remove_op_block`

> ⚠️ **危险工具**：执行后不可轻易撤销

删除指定操作块（按**序号**）。删除后其余块的序号会前移，后续操作请重新读 get_timeline_summary。

| 参数    | 必填   | 类型   | 说明                                              |
| ------- | ------ | ------ | ------------------------------------------------- |
| `block` | **是** | number | 操作块序号（见 get_timeline_summary 的「[块N]」） |

### `set_block_key`

修改指定操作块的按键（按**序号**）。key 可用：普攻/重击/闪避/跳跃/共鸣技能/共鸣解放/声骸技能/谐度破坏 或字母。

| 参数    | 必填   | 类型   | 说明       |
| ------- | ------ | ------ | ---------- |
| `block` | **是** | number | 操作块序号 |
| `key`   | **是** | string | 新按键名   |

### `set_block_special`

设置指定操作块的变奏标记（按**序号**）：intro=变奏入场、switchback=切回、none=取消。

| 参数    | 必填   | 类型                                | 说明                                                   |
| ------- | ------ | ----------------------------------- | ------------------------------------------------------ |
| `block` | **是** | number                              | 操作块序号                                             |
| `kind`  | **是** | string（none / intro / switchback） | 特殊标记：none=无，intro=变奏（入场），switchback=切回 |

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

| 参数    | 必填   | 类型   | 说明                |
| ------- | ------ | ------ | ------------------- |
| `track` | **是** | number | 要重排的轨道（1-3） |

### `move_op_block`

把已有操作块移动到指定位置（按**序号**）：position 为 {time: 秒}（绝对时间 0 至当前结束线）或 {anchor: 块序号, side: before/after（默认 after）, offset?: 秒}（相对某块）。移动后自动消除同轨道重叠。

| 参数       | 必填   | 类型   | 说明                                                                                                           |
| ---------- | ------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| `block`    | **是** | number | 要移动的操作块序号                                                                                             |
| `position` | **是** | object | 把操作块移动到哪个时间位置：{time: 秒}（绝对时间 0 至当前结束线）或 {anchor: 块序号, side, offset}（相对某块） |

### `move_ref_line`

把已有参考线移动到指定位置（按**序号**）：position 为 {time: 秒}（绝对时间 0 至当前结束线）或 {anchor: 块序号, side: before/after, offset?: 秒}（相对某块）。与相邻参考线保持最小间距，过近会报错。

| 参数       | 必填   | 类型   | 说明                                                                                                           |
| ---------- | ------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| `line`     | **是** | number | 参考线序号（见 get_timeline_summary 的「[线N]」）                                                              |
| `position` | **是** | object | 把参考线移动到哪个时间位置：{time: 秒}（绝对时间 0 至当前结束线）或 {anchor: 块序号, side, offset}（相对某块） |

### `add_ref_line`

在当前排轴最右空白位置添加参考线（按顺序排轴：参考线落在所有操作块之后），用于标记时间节点（如启动轴/循环轴）。返回新参考线的**序号**。

_无参数_

### `remove_ref_line`

> ⚠️ **危险工具**：执行后不可轻易撤销

删除指定参考线（按**序号**）。删除后其余参考线的序号会前移，后续操作请重新读 get_timeline_summary。

| 参数   | 必填   | 类型   | 说明       |
| ------ | ------ | ------ | ---------- |
| `line` | **是** | number | 参考线序号 |

### `get_non_direct_options`

获取可绑定到操作块的非直伤选项：谐度破坏（处决，可带触发角色）、震谐响应/骇破响应（偏谐响应，必须带触发角色）、各类效应（层数 1-上限、元素），以及电磁爆发（须先绑电磁效应）。

_无参数_

### `bind_non_direct_to_block`

把非直伤绑定到指定操作块（可覆盖原有绑定）：entries 为 [{name, layers?, responders?}]，名称用 get_non_direct_options 获取。谐度破坏/震谐响应/骇破响应 可带 responders（触发角色名数组，响应必须有）；效应必须带 layers（1-上限）。

| 参数      | 必填   | 类型   | 说明                                                  |
| --------- | ------ | ------ | ----------------------------------------------------- |
| `block`   | **是** | number | 操作块**序号**（见 get_timeline_summary 的「[块N]」） |
| `entries` | **是** | array  | 非直伤条目列表（整体覆盖该块）：处决/响应/效应        |

### `get_ref_line_timings`

查询时间参考线记点状态：哪些参考线已启用为时间记点、各自的秒数（null=未填写/未解析，不参与 DPS 分段）。秒数来源：自动推导（从参考线命名解析）或自定义覆盖。结果按参考线在时间轴上的位置排序，并给出**序号**。

_无参数_

### `enable_ref_line_timing`

启用某条参考线作为时间记点（按**序号**）。启用时秒数自动推导：按参考线命名解析时间片段（如 "1m30s"→90、"起手"→null 未解析）；结束线（最后一条）默认 120s。若该参考线已启用则幂等返回当前状态。

| 参数   | 必填   | 类型   | 说明                                              |
| ------ | ------ | ------ | ------------------------------------------------- |
| `line` | **是** | number | 参考线序号（见 get_timeline_summary 的「[线N]」） |

### `disable_ref_line_timing`

禁用某条参考线的时间记点（按**序号**，从 timings 移除，不再参与 DPS 分段）。若该参考线未启用则幂等返回。

| 参数   | 必填   | 类型   | 说明       |
| ------ | ------ | ------ | ---------- |
| `line` | **是** | number | 参考线序号 |

### `set_ref_line_timing_seconds`

设置已启用记点的秒数（按**序号**）。mode=auto：按参考线命名自动推导（清空自定义覆盖，回到自动解析值；命名无时间片段则秒数为 null「未填写」）；mode=custom：手动填秒数（须 ≥ 0，负数/空串视为清除→null「未填写」）。若该参考线尚未启用，会先自动启用再设秒数。

| 参数      | 必填   | 类型                    | 说明                                                         |
| --------- | ------ | ----------------------- | ------------------------------------------------------------ |
| `line`    | **是** | number                  | 参考线序号                                                   |
| `mode`    | **是** | string（auto / custom） | auto=自动推导（从命名解析），custom=自定义秒数               |
| `seconds` | 否     | number                  | 秒数（mode=custom 时必填，≥0；留空/负数→清除为 null 未填写） |

## 视图

### `switch_view`

切换当前视图（阶段）：team=队伍配置、timeline=排轴、calculation=拉表、config=配装、result=结果页。切换后用户会看到相应界面。

| 参数   | 必填   | 类型                                                      | 说明     |
| ------ | ------ | --------------------------------------------------------- | -------- |
| `view` | **是** | string（team / timeline / calculation / config / result） | 目标视图 |

## AI 助手 · 联网

### `web_fetch`

抓取一个**已知** http(s) 地址的网页正文（HTML → 纯文本或轻量 Markdown），返回标题、最终地址、HTTP 状态与正文。 怎么用： - 必须先有确切链接。本工具**不做搜索**（没有搜索引擎能力）：不知道 URL 时先用服务商自带的 web_search，或直接问用户要链接。 - 适合读文档 / 更新日志 / 攻略页 / API 说明的正文；不适合抓需要登录、需要 JS 渲染的页面（拿到的是服务端首屏 HTML，可能缺少动态内容）。 - 自动跟随重定向（最多 5 跳）、剥离脚本/样式/导航/页脚，默认只取正文区域；正文里的链接会按页面地址补成绝对地址。 结果怎么读： - content 是提取后的正文；truncated=true 表示正文只给到 maxChars 处、**后面还有内容但没有抓取** —— 不要臆造后续，必要时用更精确的 maxChars 或换个更具体的页面再抓一次。 - title 是页面标题（可能缺失）；url 是跟随重定向后的最终地址；status 是 HTTP 状态码。 - 非网页文本（PDF / 图片 / 二进制）不会返回正文，只在 note 里说明；这类内容请直接让用户提供文本。 - 抓取失败（超时 / 目标 4xx-5xx / 内网地址被拦）会返回明确错误，不要重复重试同一个地址。 限制：部署环境下只放行 https 公网地址（内网 / 回环 / 保留地址与云元数据地址由服务端拦截，防 SSRF）；单次抓取超时 15 秒、响应体上限 2MB、正文上限 40000 字符。 能力归属：本工具**仅内置 AI 助手**可用（需要宿主提供抓取能力），WS 远程接管通道无法调用。

| 参数       | 必填   | 类型                      | 说明                                                                                                    |
| ---------- | ------ | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `url`      | **是** | string                    | 要抓取的 http(s) 链接；缺协议时按 https 补全                                                            |
| `format`   | 否     | string（text / markdown） | 正文格式：text=去标签纯文本（默认，省 token）；markdown=保留标题/链接/列表/代码（需要看清页面结构时用） |
| `maxChars` | 否     | number                    | 正文最大字符数（默认 8000，硬顶 40000）；长文档建议先小后大，truncated=true 时再按需追加                |
| `mainOnly` | 否     | boolean                   | 只取正文区域并剥离导航/页眉/页脚（默认 true）；false = 连侧栏与页脚一起返回                             |

## Buff 生成辅助

### `list_entities`

列出某个实体类型的全部实体名称（角色/武器/声骸/声骸套装）。返回实体名数组。

| 参数         | 必填   | 类型                                                                   | 说明     |
| ------------ | ------ | ---------------------------------------------------------------------- | -------- |
| `entityType` | **是** | string（character / weapon / echo / 1set / 2set / 3set / 4set / 5set） | 实体类型 |

### `search_entities`

按关键词模糊搜索实体名称（支持角色/武器/声骸/套装任意类型）。实体很多时用它定位准确名称，再调用 get_entity_info。

| 参数         | 必填   | 类型                                                                   | 说明                               |
| ------------ | ------ | ---------------------------------------------------------------------- | ---------------------------------- |
| `query`      | **是** | string                                                                 | 搜索关键词（中文片段）             |
| `entityType` | 否     | string（character / weapon / echo / 1set / 2set / 3set / 4set / 5set） | 实体类型（可选，不填则搜全部类型） |

### `get_entity_info`

获取单个实体的官方信息（角色技能/武器效果/声骸技能/套装加成等），用于提取增益 Buff。返回精简后的 JSON。

| 参数         | 必填   | 类型                                                                   | 说明                                                      |
| ------------ | ------ | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `entityType` | **是** | string（character / weapon / echo / 1set / 2set / 3set / 4set / 5set） | 实体类型                                                  |
| `entityName` | **是** | string                                                                 | 实体名称（中文，用 list_entities / search_entities 定位） |

### `get_character_terms`

按需获取某角色的结构化术语速查：效果名【】、触发关键词（Highlight）、术语链接，以及每条技能/共鸣链（俗称命座）/固有去标签后的纯文本摘要。用于识别 buff 名称的触发来源与归属、以及判定元素/效果。

| 参数         | 必填   | 类型   | 说明             |
| ------------ | ------ | ------ | ---------------- |
| `entityName` | **是** | string | 角色名称（中文） |

### `get_existing_buffs`

查询当前生成目标中的已有 Buff；目标为主页 Buff 集或工程 Buff 配置，由数据源确定，返回 target 标明位置。可按实体类型/实体名精确过滤，或用 query 模糊搜索实体名或 buff 名。返回现有 buff 的 buffName/scope/exclusive/乘区数值，用于对比、去重或核对。

| 参数         | 必填 | 类型                                                                   | 说明                       |
| ------------ | ---- | ---------------------------------------------------------------------- | -------------------------- |
| `entityType` | 否   | string（character / weapon / echo / 1set / 2set / 3set / 4set / 5set） | 实体类型（可选）           |
| `entityName` | 否   | string                                                                 | 实体名称（可选，精确匹配） |
| `query`      | 否   | string                                                                 | 模糊搜索关键词（可选）     |

### `get_editing_context`

获取当前正在生成的实体：实体类型、实体名，以及该实体已收录的全部 Buff（用于了解现状、避免重复）。

_无参数_

### `diff_buffs`

将你拟定的 buff 列表与已收录的 buff 做差异对比，返回「新增/需修改/重复/可删除」清单。用于精准增改、避免与已有内容冲突。

| 参数         | 必填   | 类型                                                                   | 说明                           |
| ------------ | ------ | ---------------------------------------------------------------------- | ------------------------------ |
| `entityType` | 否     | string（character / weapon / echo / 1set / 2set / 3set / 4set / 5set） | 实体类型（可选，默认当前实体） |
| `entityName` | 否     | string                                                                 | 实体名称（可选，默认当前实体） |
| `buffs`      | **是** | array                                                                  | 拟定的 buff 列表               |

### `get_zone`

获取某个乘区（zoneId）的说明（含义/单位/判定提示），用于确认该增益应归入哪个乘区。

| 参数     | 必填   | 类型   | 说明                      |
| -------- | ------ | ------ | ------------------------- |
| `zoneId` | **是** | string | 乘区 id（乘区或引用乘区） |

### `get_effects`

获取游戏内六种"效应"的说明（光噪/霜渐/聚爆/电磁/风蚀/虚湮），以及效应专属 buff 的映射规则。

_无参数_

### `get_scope_rules`

获取受影响者（scope）的取值与判定细则（self/self_except/team/effect_only）。

_无参数_

### `get_condition_rules`

获取 Buff 生效条件（condition）的取值与判定细则（角色共鸣链 chain / 武器精炼 refinement / 伤害属性 elements / 伤害类型 damageTypes，多字段可并存）。当某增益确实存在共鸣链/精炼门槛或属性/类型限定时调用。

_无参数_

### `get_ref_rules`

获取引用乘区（ref）的转模字段规则（threshold 阈值 / 线性 pct / 离散 discrete+divisor+multiplier / lower、upper 上下限 / refOwner）。当增益数值按"某属性百分比"、"每 X 转 Y"、"超过 X 的部分"、"最高/至少"等规则换算时调用。

_无参数_

### `get_slang_dict`

获取黑话词典（官方/生僻叫法 → 玩家黑话），用于 buff 命名优化。

_无参数_

### `get_naming_rules`

获取当前 Buff 命名规则（用户自定义规则或默认要求，含叠层/精炼拆分硬性要求）。开始命名前调用。

_无参数_

### `get_examples`

获取 few-shot 示例（声骸套装/武器叠层/角色引用属性的输入输出对照），用于理解格式与判定。

_无参数_

## 附录：AI 不可修改的设置

以下设置不允许 AI/WS 修改（调用 `set_setting` 会报错并提示手动调整）：

- 自定义主题的创建 / 删除（设置 → 外观主题；仅支持明暗切换与主色调）
- 背景图本地文件上传（AI 仅可设置远程 URL / data:image 数据 / 清除）
- 磁力光标的跟手性 / 灵敏度 / 旋转 / 描边 / 晃动参数（已固定，调用静默忽略）

以下设置虽不可直接用 `set_setting`，但有专用工具，**可以**由 AI/WS 修改：

- 按键图标 → `get_keymap` / `set_keymap_entry`
- 界面快捷键 → `get_shortcuts` / `set_shortcut`
- 归档管理 → `archive_project` / `unarchive_project` / `delete_project`
- 缓存清理 → `set_setting` key=`clear_cache`（或 `get_cache_counts` 只读）
- 助手设置（启用开关 / 危险操作权限 / 人设提示词）→ `set_setting`
- AI 配置文件 → `get_ai_profiles` / `manage_ai_profile`
- 工坊实例 → `get_settings_state` / `manage_workshop`
- AI 上下文分段 / 用量 / 运行情况 → `get_ai_context_state` / `set_ai_context_segment` 等

> 完整 key 白名单以 `set_setting` 的工具描述为准（`get_settings_state` 会回传 `modifiableKeys` 实时清单）。
