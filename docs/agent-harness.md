# AI 助手：Agent Harness

AI 助手的回合结构、会话覆盖层（模型/提供商/思考/权限的临时覆盖，不落盘）、上下文组成、变化队列、自定义 Skill、token / 缓存命中统计与实时运行情况。

| 文件                                                                                                                                | 职责                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`src/lib/ai/session.ts`](../src/lib/ai/session.ts)                                                                                 | 回合循环、事件分发（双协议：Responses / Chat Completions） |
| [`src/lib/ai/turn-context.ts`](../src/lib/ai/turn-context.ts)                                                                       | 上下文分段结构与消息装配顺序（纯逻辑，装配与面板共用真源） |
| [`src/lib/ai/token-usage.ts`](../src/lib/ai/token-usage.ts)                                                                         | usage 解析 + 本地 token 估算 + 格式化                      |
| [`src/lib/ai/turn-state.svelte.ts`](../src/lib/ai/turn-state.svelte.ts)                                                             | 会话级临时状态：分段快照/禁用、实时运行、用量累计          |
| [`src/lib/ai/persona.ts`](../src/lib/ai/persona.ts)                                                                                 | 默认人设提示词                                             |
| [`src/lib/ai/change-queue.svelte.ts`](../src/lib/ai/change-queue.svelte.ts)                                                         | 工程变化队列（静默；面板可看待上报条数并清空）             |
| [`src/lib/ai/skills.ts`](../src/lib/ai/skills.ts)                                                                                   | 技能卡纯逻辑（类型/归一化/内置合并/注入渲染）              |
| [`src/lib/data/ai-skills.svelte.ts`](../src/lib/data/ai-skills.svelte.ts)                                                           | 自定义 Skill 存储（IndexedDB）                             |
| [`src/lib/ai/tools/skills.ts`](../src/lib/ai/tools/skills.ts)                                                                       | 技能卡 CRUD + `use_skill` 工具                             |
| [`src/lib/ai/thinking.ts`](../src/lib/ai/thinking.ts)                                                                               | 思考强度档位与协议映射                                     |
| [`src/lib/ai/session-overrides.svelte.ts`](../src/lib/ai/session-overrides.svelte.ts)                                               | **会话覆盖层**：模型/提供商/思考/权限临时覆盖（内存态）    |
| [`src/lib/ai/compaction.ts`](../src/lib/ai/compaction.ts)                                                                           | 上下文压缩（切分点/摘要消息/摘要请求/token 统计）          |
| [`src/lib/ai/image-parts.ts`](../src/lib/ai/image-parts.ts)                                                                         | 图片附件 → 两协议 content parts（形状差异唯一真源）        |
| [`src/lib/ai/attachments.ts`](../src/lib/ai/attachments.ts)                                                                         | 图片附件准入校验与读取                                     |
| [`src/lib/components/page/home/settings/ai-assistant.svelte`](../src/lib/components/page/home/settings/ai-assistant.svelte)         | 助手界面                                                   |
| [`src/lib/components/page/home/settings/ai-composer.svelte`](../src/lib/components/page/home/settings/ai-composer.svelte)           | 输入区 composer                                            |
| [`src/lib/components/page/home/settings/ai-usage-ring.svelte`](../src/lib/components/page/home/settings/ai-usage-ring.svelte)       | 上下文用量圈                                               |
| [`src/lib/components/page/home/settings/ai-context-panel.svelte`](../src/lib/components/page/home/settings/ai-context-panel.svelte) | 上下文面板                                                 |
| [`src/lib/components/page/home/settings/skill-section.svelte`](../src/lib/components/page/home/settings/skill-section.svelte)       | 技能管理                                                   |

## 回合结构

一轮对话 = 一次 `runAiTurn()`，内部最多 `maxToolRounds` 个工具轮次（每个 AI 配置可单独设，默认 48；「查数据+改配置+校验」常需几十轮）。

```text
user 消息
  └─ for round in 0..maxToolRounds:
       调用模型（流式）→ 记录 usage（无则本地估算回退）
       ├─ 有工具调用 → 逐个 executeTool() → 结果回灌 tool 消息 → 下一轮
       └─ 无工具调用 → 结束本轮
事件流（onEvent）：ai / reasoning / tool / confirm / error / done
实时状态（turn-state）：阶段 / 耗时 / 工具调用列表 / 用量累计
```

| 项       | 说明                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| 输出上限 | `maxOutputTokens`（默认 65536）写进 `max_tokens`/`max_output_tokens`；触顶收敛成统一标记并提示调大该配置       |
| 流末尾   | 两协议 EOF 后 flush `TextDecoder` 与残余缓冲（少数实现最后一条 `data:` 不带换行，不 flush 会丢最后一个 chunk） |

### 长任务模式

一次回合在模型不产生工具调用时结束。长任务模式让 **AI 自己**声明任务边界：

| 动作                         | 行为                                                                        |
| ---------------------------- | --------------------------------------------------------------------------- |
| AI 调 `set_long_task(true)`  | 开启；`note` 记目标/进度（显示在状态行）                                    |
| 模型输出停止（无工具调用）   | 自动追加 assistant 历史 + 一条 **ephemeral**「继续推进」user 提示，回合继续 |
| AI 调 `set_long_task(false)` | 关闭；当前回复结束后收尾                                                    |
| 用户按停止                   | 立即 `abort()` + `resetLongTask()`                                          |
| 轮次预算耗尽                 | 停止并报告「长任务达到轮次上限」                                            |

| 项        | 说明                                                                         |
| --------- | ---------------------------------------------------------------------------- |
| 续写提示  | `long-task.ts` 的 `buildLongTaskContinuation()` 生成，点名关闭工具与目标     |
| ephemeral | 「继续推进」消息发给模型但不进历史，避免多轮后历史堆满「继续」               |
| 状态      | 在 `turn-state.svelte.ts`（会话级、不持久化），`beginTurn`/`finishTurn` 归零 |
| 范围      | 只注入内置助手（`ToolContext.longTask`），WS 远程接管不提供                  |

### AI 输出：活动流

界面不套聊天气泡，也没有「聊天/思考/工具」tab。每条 assistant 消息维护按发生顺序的**活动流**（`AssistantActivity`）：

| 类型                | 内容                                            |
| ------------------- | ----------------------------------------------- |
| `reasoning`         | 思考行（默认折两行，点击展开）                  |
| `tool`              | 工具行（类别·一行摘要·状态；点击展开请求/响应） |
| `text`              | 回复行（Markdown 渲染）                         |
| `notice`/`longTask` | 错误 / 提示 / 自动继续标记                      |

用户消息仍是右侧气泡。工具行类别映射在 `describeToolActivity()`，详情复用 `describeToolCard()`（`run_js` 显示脚本源码+返回值/日志，`web_fetch` 显示方法/头/体与响应）。

危险工具在 `executeTool` 前经 `onConfirm` 确认，策略取生效值 `getEffectiveDangerMode()`：

| 模式          | 行为                             |
| ------------- | -------------------------------- |
| `ask`（默认） | 每次危险操作询问                 |
| `ask_once`    | 一个指令回合内只问一次，之后放行 |
| `trust`       | 无条件信任，直接执行             |

## 会话覆盖层

助手 composer 工具条可在**不写回设置**下临时切换：

| 控件                   | 覆盖字段        | 可选值                                                       |
| ---------------------- | --------------- | ------------------------------------------------------------ |
| 权限（左）             | `dangerMode`    | 每次都问 / 批量只问一次 / 无条件信任（与设置页同文案）       |
| 提供商配置（右菜单）   | `profileId`     | 全部配置（**只切换**，增删改在设置页 / `manage_ai_profile`） |
| 思考强度（同菜单四档） | `thinkingLevel` | 关 / 低 / 中 / 高（`off` = **省略**思考参数）                |

| 项         | 说明                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| 真源       | `session-overrides.svelte.ts`，解析顺序：会话覆盖 → 持久化配置 → 内置默认                                                 |
| 调用点     | `session.ts` 发请求前 `resolveAiConfig()`，确认危险操作前 `getEffectiveDangerMode()`                                      |
| 不直连设置 | `ai-config` 已有两个写入者（设置页 UI、`manage_ai_profile` 工具），弹窗直连会永久改全局默认并可能显示不一致               |
| 内存态     | 只存在内存，刷新恢复；界面不暴露「覆盖」概念，按钮显示当前生效值                                                          |
| 接口       | `session-overrides` 刻意不导出「读取/清除覆盖、是否覆盖态」接口（无消费者）                                               |
| 配置被删   | `resolveAiConfig()` 静默回落到持久化当前配置，不抛错                                                                      |
| 请求参数   | 每份配置带 `contextWindow` / `maxOutputTokens` / `maxToolRounds` / `directRequest`（默认 false），缺字段 `coerce*` 补默认 |

## 历史回传与压缩

### 回传范围

回合结束只回传**属于对话本身**的两段 + 本轮新消息：

```text
history 段原文 + user 段原文 + 本轮新产生的 assistant / tool 消息
```

其余分段（人设/被动技能/主动技能清单/当前状态/变化队列）每轮由 `buildTurnSegments()` 重新注入，带走会逐轮堆积。

因此按 `PERSISTED_SEGMENT_IDS` 显式选取分段，不用 `messages.slice(1)`（只丢第一条 persona，其余四个 system 段会逐轮塞进历史）。刻意不按 `getDisabledSegments()` 过滤——临时禁用是「这一轮不注入」，不该因此丢掉已积累历史。

### 压缩

上下文面板「压缩历史」把较旧历史压成摘要，用「一条摘要 + 最近若干条原文」替换：

| 项       | 说明                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------- |
| 为何压缩 | 删单条破坏 `tool_call`/`tool_result` 配对；按轮整块删等于丢结论                                          |
| 切分点   | 只落在 user 消息（不会插在 assistant tool_calls 与结果之间）；可压部分不足 `COMPACTION_MIN_OLDER` 则拒绝 |
| 摘要     | 作为一条 `system` 消息（`SUMMARY_PREFIX` 起头），两协议原样传递                                          |
| 摘要请求 | 只走 Chat Completions、不带工具、不带思考强度                                                            |
| 失败     | 不动历史，只报错（本地裁剪会无声丢信息）                                                                 |
| 界面     | 保留完整气泡，只在对话流插一条可展开压缩标记；面板显示「已压掉 N 条 · ≈X → ≈Y token」                    |
| 持久化   | 不持久化（会话级），刷新从零                                                                             |

## 工作摘要

助手悬浮窗标题只有一行「当前工作摘要」，由 AI 自己维护；提供商/模型在输入区「模型·等级」按钮上。

| 项     | 说明                                                                             |
| ------ | -------------------------------------------------------------------------------- |
| 写入   | `set_work_summary` 工具 → `turn-state.svelte.ts` 的 `setWorkSummary()`           |
| 驱动   | system「工作摘要」段每轮无条件注入，要求 AI 回复前先更新；段内带上轮摘要以求稳定 |
| 独立段 | 不写进人设（人设可被用户清空覆盖，而每轮更新摘要是产品行为要求）                 |
| 状态   | 会话级、不持久化，清空对话归零；无摘要时显示占位「新对话」                       |
| 成本   | 每轮多一次工具往返；可用上下文面板临时禁用该段                                   |

摘要是**指令驱动**：模型偶尔可能不遵守，故只作展示信息，不参与计算或工具决策。

## run_js（沙箱执行脚本）

给模型一个工具，在一段脚本内做批量计算 + 连续调多个工具。两条路径的权限差别是安全边界，由上下文能力决定、不由工具参数决定：

| 调用方   | 运行器                        | 环境                                            | 工具注入                                       |
| -------- | ----------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| 内置助手 | `ctx.sandboxRun`（Worker）    | 假 `window`/`globalThis`，无 DOM/网络/存储/密钥 | 全部工具注入为全局函数（**除 `run_js` 自身**） |
| WS 远程  | `ctx.windowRun`（页面 realm） | **真 `window`**                                 | 不注入                                         |

抓网页直接用同名 `web_fetch({ url, method, headers, body, json })`，桥回宿主、走同源代理与 SSRF 校验（回环放行，内网与云元数据拦截）；不是浏览器真 fetch。选路看能力存在与否，**模型无法靠传参把自己提升到真 window 路径**，两者并存时优先沙箱。

| 项               | 说明                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 为何 Worker      | 同 realm 的 `new Function` 不是沙箱；Worker 本无 DOM/页面内存/密钥，执行前再删 `fetch`/`XHR`/`WebSocket`/`indexedDB`/`caches` 等，删不掉的用形参遮蔽。`indexedDB` 最要紧（AI 配置含 API Key） |
| 第二道闸         | 脚本里工具调用经 postMessage 桥回页面由真正 `executeTool` 执行，危险工具照样确认、`requires` 校验照样生效                                                                                     |
| 上限             | 50 次工具调用 / 2 分钟超时（到点 `worker.terminate()`）/ 返回 20000 字符 / 报错 4000 / 日志 200 条且 20000 字符                                                                               |
| 跨调用复用       | Worker 按队列串行复用，`globalThis` 上定义的函数/变量跨调用保留；超时强杀、异常或刷新才重置                                                                                                   |
| 原始数据         | 返回值在 `toSerializable()` 不预裁剪，完整处理后才按上限截断；日志同理                                                                                                                        |
| UI 输出          | 活动流拆三行：「代码」工具行放源码、单独「运行结果」行、失败时「运行报错」行                                                                                                                  |
| 渲染窗口         | 消息区默认渲染最近 30 条，单条 assistant 默认渲染最后 60 活动行，按页向前加载；Markdown FIFO 缓存 + 原地拼接                                                                                  |
| 残余风险（接受） | 动态 `import()` 删不掉，但加载的模块也运行在掏空的 realm 里                                                                                                                                   |
| WS 路径代价      | 真 window 能碰 DOM/storage，页面 realm 死循环无法中断（产品决定接受）                                                                                                                         |

## 自定义倍率

排轴里除角色技能倍率还可有用户自定义直伤倍率。四个工具管理：

| 工具                | 作用                                                   |
| ------------------- | ------------------------------------------------------ |
| `list_custom_hits`  | 按角色列名称/固定值/百分比/单位/属性/段数/渲染后倍率串 |
| `add_custom_hit`    | 新建（名称同角色内唯一；固定值与百分比至少一个 >0）    |
| `update_custom_hit` | 按当前名称定位修改（改名、改数值/单位/属性/段数）      |
| `remove_custom_hit` | 删除（已绑操作块的同名命中不自动解绑）                 |

倍率串格式化由 `$lib/timeline/custom-hit` 的 `customHitRatio()` 统一提供。创建后用 `get_char_skills` 确认，用 `bind_damage_to_block` 绑定。

## 跨工程只读

写工具只作用于当前活动工程。下列读取工具接受可选 `projectId`，直接读持久化数据、不切换活动工程：

| 领域           | 工具                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 工程/队伍/排轴 | `get_project_state` `get_team` `get_timeline_summary` `get_timeline_damage_list` `get_ref_line_timings` `get_char_skills` |
| 配装           | `get_config_summary`                                                                                                      |
| 拉表           | `get_damage_entries` `get_buff_confs` `get_buff_conf_detail` `get_condition_profile` 等                                   |
| 结果           | `get_result_summary` `get_result_entry_breakdown` `get_data_analysis`                                                     |
| 自定义倍率     | `list_custom_hits`                                                                                                        |

跨工程结果类工具用目标工程持久化时间线重新推导条目（`buildDamageEntriesFromTimeline()`），不读活动 store。

## 写工具守卫与伤害绑定

| 项          | 说明                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| 锁定守卫    | 改排轴/拉表/词条环境的写工具在 `executeTool()` 入口检查 `isPhaseReadonly`，锁定返回提示而非静默 `ok: true` |
| 伤害目标    | `bind_damage_to_block`/`bind_non_direct_to_block` 支持 `targetType: block\|refLine`                        |
| 稳定 hitKey | `get_damage_bindings` 按「角色+技能类型+命中名」派生（不含倍率/属性/段数），改数值后仍可用同一 key         |
| 解绑/清空   | `unbind_damage_hit` 解单条直伤；`remove_damage_from_target` 清空目标全部伤害但保留块/参考线                |
| 结果刷新    | 结果类工具读取前 `await tick()`，避免刚写完 Buff 读到上一帧                                                |

## 上下文装配顺序

`runAiTurn` 先由 `buildTurnSegments()` 渲染分段，再用 `segmentsToMessages()` 装配（`turn-context.ts`）。顺序固定：

| #   | 段                    | 内容                                      |
| --- | --------------------- | ----------------------------------------- |
| 1   | `system` 人设         | 用户自定义优先，清空回落默认              |
| 2   | `system` 被动技能正文 | 启用中的每轮直接注入，常驻                |
| 3   | `system` 主动技能清单 | 只含「名称+一句话描述」，正文按需激活     |
| 4   | `system` 当前状态     | 工程名/id、视图、四环节锁定态、打开的弹窗 |
| 5   | `system` 工作摘要     | 要求每轮先更新，**无条件注入**            |
| 6   | `system` 变化队列     | 自上次对话以来的工程改动                  |
| 7   | `history`             | 历史消息（含前几轮工具调用与结果）        |
| 8   | `user`                | 本轮消息（可带图片附件，只发图也合法）    |

状态与变化是「以本条为准」的强声明：冲突时以最新事实为准，细节用工具重查。空段自动跳过。分段是唯一真源：上下文面板的段名/字符数/token/占比都来自同一份 `buildTurnSegments()` 快照（回合开始写入 `turn-state`），面板与实际注入一致。每个 `TurnSegment` 带 `text`（展示/估算）、`messages`（注入）、`tokens`。

### 上下文面板

助手头部「分层」按钮展开（默认收起），按段列最近一轮**实际注入**内容：

| 项       | 说明                                                                                         |
| -------- | -------------------------------------------------------------------------------------------- |
| 每段     | 名称、字符数、估算 token、占启用段比例（含占比条）；空段「无内容」                           |
| 临时禁用 | 勾选后当轮不注入，可随时恢复；只写内存（`disabledSegments`），刷新恢复；灰显+删除线+红左边条 |
| 清空对话 | `clearConversation()`，同时清本会话用量累计与快照                                            |
| 清空变化 | `clearChanges()`（已注入的历史消息不回退）                                                   |
| 生效时机 | 禁用/恢复下一轮生效（面板快照始终是最近一轮已发出的内容）                                    |

### token 与缓存命中

服务商 usage 优先，缺失字段显示「—」：

| 服务商           | 字段                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| DeepSeek（Chat） | `prompt_tokens`/`completion_tokens`/`total_tokens`/`prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` |
| OpenAI 兼容      | `prompt_tokens`/`completion_tokens`/`total_tokens`/`prompt_tokens_details.cached_tokens`                |
| Responses API    | `input_tokens`/`output_tokens`/`total_tokens`/`input_tokens_details.cached_tokens`                      |

| 项         | 说明                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| 取法       | Chat 请求体带 `stream_options: { include_usage: true }`，末 chunk 取 `usage`；Responses 在 `response.completed` 取 |
| 命中率     | `hit/(hit+miss)`（DeepSeek）；只 `cached_tokens` 时 `hit/prompt`（OpenAI）；缺失显示「—」                          |
| 本地估算   | `estimateTokens()`（中文≈1 token/字、ASCII≈4 字符/token、每消息+4），仅在整次请求无 usage 时兜底并标注             |
| 占用比     | `contextUsageRatio()`：分子最近一次请求 prompt token（非本轮累计），分母配置 `contextWindow`；>1 钳到 1            |
| 图片不计   | `estimateTokens` 只看文本；服务商计费方式各异，附图回合估算偏低、用量圈只反映文本                                  |
| 图片压缩   | >512KB 缩到最长边 2048px 转 WebP（转发平台按整包限请求体，Vercel≈4.5MB）；GIF/小图原样，失败回落                   |
| 直连与图片 | `directRequest=true` 绕开转发平台限制，代价是端点须自己放行 CORS（预检允许 `Authorization`）                       |

### 实时运行情况

`session.ts` 写 `turn-state`，界面只读：

| 项       | 说明                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| 阶段     | 思考中 → 收到流式文本 → 正在调用工具「名称」 → 等待工具结果（确认/进度）                 |
| 耗时     | `beginTurn()` 起内部时钟每 200ms 推进                                                    |
| 工具列表 | 名称、耗时、成功/失败、结果梗概（失败给错误信息，成功给字符数）                          |
| 回合汇总 | 结束保留一行：`本轮：4.2s · 3 次工具调用 · prompt 8.1k / completion 0.6k · 缓存命中 74%` |
| 时间线   | 工具卡可展开：`run_js` 显示脚本源码+返回值/日志，`web_fetch` 显示请求参数与响应结果      |

## 变化队列

`change-queue.svelte.ts` 记录「切换工程」与「四阶段数据变化」，下一轮开头以系统消息上报。

| 项   | 说明                                                             |
| ---- | ---------------------------------------------------------------- |
| 入队 | `pushProjectSwitch()` / `pushPhaseChange()` / `pushTeamChange()` |
| 合并 | 同 `kind` 且 1.5s 内连续变化合并为一条并累加 `×N`                |
| 上限 | 环形队列 50 条，超出丢最旧                                       |
| 消费 | `drainChanges()` 回合开始取出并清空，同一条不重复上报            |
| 界面 | 对 AI 与界面都静默，只在上下文面板看待上报条数并手动清空         |

指纹来源：`+page.svelte` 对「工程 id + 队伍 + 四阶段数据」建 `$effect` 指纹，首次建基线不入队。

## 自定义 Skill

技能卡 = 用户预置的**操作规范**，解决「同一套要求每次重复交代」。

```ts
type SkillMode = 'active' | 'passive'
interface AiSkill {
    id: string
    name: string // 唯一，AI 通过它激活
    description: string // 一句话；主动进清单供 AI 判断，被动仅作备注
    body: string // 主动：激活后注入；被动：每轮直接注入
    enabled: boolean
    mode: SkillMode // active=按需 / passive=常驻（缺字段按 active）
    builtin?: boolean // 内置不可删，可改描述/正文/类型/启停
}
```

| 项       | 说明                                                                                         |
| -------- | -------------------------------------------------------------------------------------------- |
| 存储     | IndexedDB `ai-skills`；内置技能 `loadSkills()` 时与代码定义合并（保留用户修改）              |
| 主动     | 清单只进名称+描述，正文只在 `use_skill` 激活后进上下文（最主要的 token 优化）                |
| 被动     | 正文每轮进 system 常驻，不出现在清单                                                         |
| 工具     | `list_skills` / `get_skill` / `create_skill` / `update_skill` / `delete_skill` / `use_skill` |
| 内置     | 数据自愈（主动）、条件与链阶（被动）、Buff 命名规则（主动）、黑话词典（主动）                |
| 界面     | 设置 → AI助手 → 权限/提示词 → 技能；悬浮窗无入口                                             |
| 导入导出 | `{ kind: 'wuwa-afyg-skills', skills: [...] }`，同名跳过                                      |

## 界面结构

助手是可拖拽悬浮窗（收起圆钮 / 小卡片 / 全尺寸三态）：

| 区域       | 内容                                                                                   |
| ---------- | -------------------------------------------------------------------------------------- |
| 头部       | 当前工作摘要（大标题）、上下文面板入口、清空对话、尺寸切换                             |
| 上下文面板 | 可折叠（默认收起）：分段禁用 + 用量与缓存 + 运行情况 + 清空                            |
| 消息区     | 用户消息右侧气泡；AI 输出活动流（思考/工具/回复/提示按发生顺序，工具行可展开）         |
| composer   | 圆角卡片：输入框 + 工具条（左权限 / 右「模型·等级」/ 用量圈 / 发送）+ 右上「暂时收起」 |
| 状态行     | composer **下方**：左实时阶段或上轮汇总、长任务标记，右会话累计「N 轮·N 步」           |
| 待作答     | 危险确认卡与 `ask_user` 卡渲染在 composer 卡片内部，替掉输入行                         |

composer 四点约定：

| 项           | 说明                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| 收起         | 只对「待权限/待提问」阶段存在；聊天模式不提供（输入区始终可用）。待作答时折成一行问题（`pendingLabel`，宿主算好）     |
| pending 槽位 | 两卡片走 Svelte snippet（宿主传入），宿主持状态与幂等收尾，composer 只放进正确容器                                    |
| 用量圈       | 紧贴发送按钮，画最近一次请求 prompt token 占 `contextWindow` 比例；<70% 主题色 / 70~90% 琥珀 / ≥90% 红                |
| 图片附件     | 回形针按钮或粘贴；PNG/JPEG/WebP/GIF，最多 4 张、单张 ≤5MB；data URL 存 `ChatMessage.images`，发请求时转 content parts |

分母 `contextWindow` 来自配置文件（默认 256k；服务商不下发窗口大小，只能由用户声明）。技能管理在设置里；变化队列平时不出现，只在上下文面板可看待上报条数 / 清空。
