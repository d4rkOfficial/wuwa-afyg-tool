# AI 助手：Agent Harness

本文档描述 AI 助手的回合结构、**会话覆盖层**（模型 / 提供商 / 思考 / 权限的临时覆盖，不落盘）、
上下文组成（含上下文面板与分段禁用）、变化队列、自定义 Skill、token / 缓存命中统计与实时运行情况。

> 相关源码
>
> | 文件                                                               | 职责                                                                        |
> | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
> | `src/lib/ai/session.ts`                                            | 回合循环、事件分发（双协议：Responses / Chat Completions）                  |
> | `src/lib/ai/turn-context.ts`                                       | 上下文**分段**结构与消息装配顺序（纯逻辑，装配与面板共用真源）              |
> | `src/lib/ai/token-usage.ts`                                        | usage 解析（DeepSeek / OpenAI / Responses）+ 本地 token 估算 + 格式化       |
> | `src/lib/ai/turn-state.svelte.ts`                                  | 会话级临时状态：分段快照 / 分段禁用 / 实时运行情况 / 用量累计               |
> | `src/lib/ai/persona.ts`                                            | 默认人设提示词                                                              |
> | `src/lib/ai/change-queue.svelte.ts`                                | 工程变化队列（静默，界面不显示；面板可查看待上报条数并清空）                |
> | `src/lib/ai/skills.ts`                                             | 技能卡纯逻辑（类型 / 兼容归一化 / 内置合并 / 注入文本渲染）                 |
> | `src/lib/data/ai-skills.svelte.ts`                                 | 自定义 Skill（技能卡）存储（IndexedDB）                                     |
> | `src/lib/ai/tools/skills.ts`                                       | 技能卡 CRUD + `use_skill` 工具（`list/get/create/update/delete_skill`）     |
> | `src/lib/ai/thinking.ts`                                           | 思考强度档位与协议映射（纯逻辑；设置与弹窗共用一份）                        |
> | `src/lib/ai/session-overrides.svelte.ts`                           | **会话覆盖层**：模型 / 提供商 / 思考 / 权限的临时覆盖（内存态）             |
> | `src/lib/ai/compaction.ts`                                         | 上下文压缩（切分点规划 / 摘要消息 / 摘要请求 / token 统计）                 |
> | `src/lib/ai/image-parts.ts`                                        | 图片附件 → 两条协议的 content parts（形状差异的唯一真源）                   |
> | `src/lib/ai/attachments.ts`                                        | 图片附件准入校验与读取（上限、白名单、`FileReader`）                        |
> | `src/lib/components/page/home/settings/ai-assistant.svelte`        | 助手界面（对话 / 工具时间线 / 危险确认 / 状态行）                           |
> | `src/lib/components/page/home/settings/ai-composer.svelte`         | 输入区 composer（权限 / 模型·等级 / 用量圈 / 发送 / 收起 / `pending` 槽位） |
> | `src/lib/components/page/home/settings/ai-usage-ring.svelte`       | 上下文用量圈（最近一次 prompt token ÷ 配置的上下文窗口）                    |
> | `src/lib/components/page/home/settings/ai-context-panel.svelte`    | 上下文面板（分段禁用 / 用量与缓存命中 / 运行情况 / 清空）                   |
> | `src/lib/components/page/home/settings/skill-section.svelte`       | 设置里的技能管理（启用 / 新建 / 编辑 / 删除 / 导入导出）                    |
> | `src/lib/components/page/home/settings/ai-skill-edit-modal.svelte` | 技能编辑弹窗（名称 / 描述 / 正文 / 类型 / 启停 + 工具名快速输入）           |
> | `src/lib/components/page/home/settings/tool-picker.svelte`         | 可调用工具清单面板（与提示词编辑共用）                                      |

## 1. 回合结构

一轮对话 = 一次 `runAiTurn()`，内部最多 `maxToolRounds` 个工具轮次（**每个 AI 配置可单独设置**，
默认 `DEFAULT_MAX_TOOL_ROUNDS = 48`；旧版硬编码 8 轮，查数据 + 改配置 + 校验很容易超）：

```
user 消息
  └─ for round in 0..maxToolRounds:
       调用模型（流式）→ 记录 usage（无则本地估算回退）
       ├─ 有工具调用 → 逐个 executeTool() → 结果回灌为 tool 消息 → 继续下一轮
       └─ 无工具调用 → 结束本轮
事件流（onEvent）：ai / reasoning / tool / confirm / error / done
实时状态（turn-state）：阶段 / 耗时 / 工具调用列表 / 用量累计
```

**输出上限与截断**：`maxOutputTokens`（默认 65536）写进请求体的 `max_tokens` / `max_output_tokens`。
流式协议触顶时只会给一个 `finish_reason=length`（Responses 是 `incomplete`），旧实现对此完全沉默，
看起来就是「回复莫名截断」。现在两种协议都会收敛成同一个标记，并在对话里明确提示去调大该配置；
工具轮次耗尽同样会报告，而不是假装正常结束。

**流的末尾**：两条协议都在 EOF 后 flush `TextDecoder` 与残余缓冲区 —— 少数实现最后一条
`data:` 不带换行，不 flush 会静默丢掉最后一个 chunk（正文或工具参数缺一截）。

### 1.0 长任务模式（`set_long_task`）

一次回合在模型不再调用工具时结束。对「查数据 → 改配置 → 校验」这类跨很多步的任务，
模型一次回复写完就停，用户得反复打字「继续」。长任务模式让 **AI 自己**声明任务边界：

| 动作                         | 行为                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| AI 调 `set_long_task(true)`  | 开启；`note` 记录目标 / 进度（显示在状态行）                                         |
| 模型输出停止（无工具调用）   | 自动追加上一条 assistant 历史 + 一条 **ephemeral** 的「继续推进」user 提示，回合继续 |
| AI 调 `set_long_task(false)` | 关闭；当前回复结束后正常收尾                                                         |
| 用户按停止按钮               | 立即 `abort()` + `resetLongTask()`，自动继续停止                                     |
| 轮次预算耗尽                 | 停止并明确报告「长任务达到轮次上限」，不会无限循环                                   |

- 续写提示由 `long-task.ts` 的 `buildLongTaskContinuation()` 生成，点名关闭工具与目标；
- 「继续推进」消息带 `ephemeral: true`：**发给模型，但不进历史**，避免多轮自动继续后历史里堆满「继续」；
- 状态在 `turn-state.svelte.ts`（会话级、不持久化）：`beginTurn` / `finishTurn` 都会归零；
- 长任务模式只注入给内置 AI 助手（`ToolContext.longTask`），WS 远程接管不提供该能力。

### 1.0.1 AI 输出：活动流而不是聊天气泡

界面不再给 AI 输出套气泡，也没有「聊天 / 思考 / 工具」tab。每条 assistant 消息维护一条
**按发生顺序排列的活动流**（`AssistantActivity`）：

- `reasoning`：思考行（默认折两行，点击展开）
- `tool`：工具行（类别 · 一行摘要 · 状态；点击展开请求参数 / 响应结果）
- `text`：回复行（Markdown 渲染）
- `notice` / `longTask`：错误 / 提示 / 自动继续标记

用户消息仍保留右侧气泡。工具行的类别映射在 `describeToolActivity()`，请求与响应详情复用
`describeToolCard()`（`run_js` 显示脚本源码 + 返回值 / 日志，`web_fetch` 显示方法 / 头 / 体与响应）。

`buildTools()` 返回全部已注册工具（见 [tools.md](./tools.md)）；危险工具在 `executeTool` 前经
`onConfirm` 走确认卡片，确认策略取**生效值** `getEffectiveDangerMode()`（会话覆盖层 → 设置里的
`dangerMode`，见 §1.1）：

| 模式          | 行为                                   |
| ------------- | -------------------------------------- |
| `ask`（默认） | 每次危险操作都询问                     |
| `ask_once`    | 一次指令回合内只询问一次，之后自动放行 |
| `trust`       | 无条件信任，直接执行                   |

## 1.1 会话覆盖层（模型 / 提供商 / 思考 / 权限）

助手输入区（composer）的工具条可以在**不写回设置**的前提下临时切换：

| 控件                       | 覆盖字段        | 可选值                                                             |
| -------------------------- | --------------- | ------------------------------------------------------------------ |
| 权限（工具条左侧）         | `dangerMode`    | 每次都询问 / 批量只询问一次 / 无条件信任（与设置页同一份文案）     |
| 提供商配置（右侧菜单）     | `profileId`     | 全部配置文件（**只切换**；增删改仍在设置页 / `manage_ai_profile`） |
| 思考强度（同一菜单，四档） | `thinkingLevel` | 关 / 低 / 中 / 高（`off` = **省略**思考参数，见 `thinking.ts`）    |

- 真源是 `src/lib/ai/session-overrides.svelte.ts`，解析顺序为**会话覆盖 → 持久化配置 → 内置默认**：
  `session.ts` 发请求前调 `resolveAiConfig()`，助手确认危险操作前调 `getEffectiveDangerMode()`。
- **为什么弹窗不直接写 `config.svelte.ts`**：`ai-config` 这条 IndexedDB 记录已有两个写入者（设置页 UI 与
  AI 自己的 `manage_ai_profile` 工具）。弹窗若直连就是第三个 —— 用户只想「这次换个模型」却会永久改掉全局
  默认；更糟的是 AI 可在用户操作期间换掉 `activeProfileId`，使弹窗显示与实际请求不一致。
- 覆盖项**只存在内存里，刷新即恢复**（与 §2.1 的分段临时禁用同一约定）。界面**不暴露「覆盖」这层概念**：
  没有「跟随设置」项、没有「临时」标记，按钮上显示的就是当前生效值（与 DSH 的权限、模型选择器一致）；
  想要设置里的默认值，从同一个列表里选回它即可。
- 因此 `session-overrides.svelte.ts` **刻意不导出**「读取覆盖项 / 清除覆盖 / 是否处于覆盖态」这类接口 ——
  没有消费者，接口就是死代码。
- 覆盖的配置若被设置页 / AI 工具删掉，`resolveAiConfig()` 静默回落到持久化的当前配置，不抛错。
- 提供商**只在弹窗里切换、不在弹窗里增删改**：CRUD 需要配置名 / 地址 / 模型名 / API Key / 思考强度的完整
  表单与删除确认，塞进悬浮窗等于在窗口里再养一个设置页。
- 每份配置还带三个**请求参数**（设置在「AI 配置文件」弹窗里）：`contextWindow`（用量圈分母）、
  `maxOutputTokens`（单次输出上限）、`maxToolRounds`（工具轮次上限），以及 `directRequest`
  （`true` = 浏览器直连，绕过站点转发；默认 `false` 沿用自动策略）。老数据缺字段时由
  `coerce*` 静默补默认值，不报错。

## 1.2 历史回传与上下文压缩

### 回传历史的范围（`onMessages`）

回合结束时只回传**属于对话本身**的两段 + 本轮新产生的消息：

```
history 段原文 + user 段原文 + 本轮新产生的 assistant / tool 消息
```

其余分段（人设 / 被动技能正文 / 主动技能清单 / 当前状态 / 变化队列）**不带走** —— 它们每轮都由
`buildTurnSegments()` 按当前设置重新注入，带走只会在历史上逐轮堆积、重复注入。

> 这是一处实测修正：原实现用 `messages.slice(1)`，只丢掉了第一条 persona，另外四个 system 段会被
> 每轮塞进历史，导致 prompt token 逐轮虚涨 —— 与 `RunTurnOptions.onMessages` 自己的契约注释
> 「回传本次完整消息序列（**不含 system**）」矛盾。修正后按 `PERSISTED_SEGMENT_IDS` 显式选取分段。
>
> 刻意**不**按 `getDisabledSegments()` 过滤这两段：临时禁用分段是「这一轮不注入」的开关，
> 不该因为它就把已积累的历史永久丢掉。

### 压缩（`compaction.ts`）

上下文面板的「压缩历史」把较旧的历史交给模型压成一份摘要，用「**一条摘要 + 最近若干条原文**」
替换它，从而降低占用。

- **为什么是压缩而不是删除**：删除单条消息会破坏 `tool_call` / `tool_result` 配对（协议要求每个
  tool_call 都有对应结果），按轮次整块删又等于把结论一起丢掉。DSH 同样**没有**单条删除功能，
  它只有压缩 / 分支。
- **切分点只落在用户消息上**：`user` 消息绝不会插在 assistant(`tool_calls`) 与它的 tool 结果之间，
  故落在 user 上的切点天然不拆散配对。找不到这样的切点（或可压部分不足 `COMPACTION_MIN_OLDER` 条）
  就**拒绝压缩**，而不是冒险切在别处。
- 摘要作为一条 **`system` 消息**放进历史（`SUMMARY_PREFIX` 起头）：既不会被误认成用户或助手说过的话，
  也能在 Chat Completions 与 Responses 两条协议上原样传递。
- 摘要请求只走 Chat Completions、不带工具、不带思考强度（所有预设提供商都支持，且避免把压缩
  变成一次昂贵的长思考）。
- **摘要失败就不动历史**：只报错，不做静默降级（本地裁剪会无声丢信息）。
- **界面保留完整对话气泡**，只在对话流里插一条可展开的压缩标记（DSH 同样如此）；
  上下文面板显示「已压掉 N 条 · 历史 ≈X → ≈Y token」。
- 压缩结果**不持久化**（会话级）：本应用的对话历史本身也不落盘，刷新即从零开始。

## 1.3 工作摘要（悬浮窗大标题）

助手悬浮窗的标题**只有一行**，内容是「当前工作摘要」—— 由 AI 自己维护，不再显示提供商 / 模型
（该信息在输入区右侧的「模型 · 等级」按钮上）。

- 写入：`set_work_summary` 工具（`tools/ai-session.ts`）→ `turn-state.svelte.ts` 的 `setWorkSummary()`。
- 驱动：system 的「工作摘要」分段（§2 第 5 项）**每轮无条件注入**，要求 AI **在回复开始前先更新摘要**；
  该段同时带上「你上一轮的摘要」，让模型沿用以求稳定、只在转向新任务时才改写。
- 为什么单独成段、而不写进人设：人设可被用户自定义覆盖（清空即回落默认），而「每轮更新摘要」是
  **产品行为要求**，不能因为用户改了人设就消失。
- 会话级、**不持久化**（与对话历史一致），清空对话时归零；还没有摘要时标题显示占位「新对话」。
- 成本：每轮多一次工具往返。可用上下文面板把该段**临时禁用**来关掉它（禁用后 AI 不再维护摘要）。

> 这是**指令驱动**而非强制：和任何 system 要求一样，模型偶尔可能不遵守。
> 因此摘要是「尽力而为」的展示信息，不参与任何计算或工具决策。

## 1.4 `run_js`（沙箱执行脚本）

给模型一个「一次脚本内做批量计算 + 连续调多个工具」的工具，省掉逐轮工具往返。

**两条路径的权限差别是安全边界，由上下文能力决定、不由工具参数决定：**

| 调用方      | 运行器                        | 环境                                                    | 工具注入                                                   |
| ----------- | ----------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| 内置 AI助手 | `ctx.sandboxRun`（Worker）    | 假 `window` / `globalThis`，无 DOM / 网络 / 存储 / 密钥 | 全部可用工具注入为全局函数（**除 `run_js` 自身**，防递归） |
| WS 远程接管 | `ctx.windowRun`（页面 realm） | **真 `window`**                                         | 不注入                                                     |

抓网页/调接口直接用**与工具同名**的 `web_fetch({ url, method, headers, body, json })`：
它与其它工具一样按原名注入沙箱全局，桥回宿主 `web_fetch` 工具、走同源代理与 SSRF 校验
（回环地址放行，内网与云元数据地址仍拦截）；返回值与活动工程里的 web_fetch 相同。
它**不是浏览器的真 fetch**；宿主没有 webFetch 能力时该工具不会出现在沙箱清单里。

因为选路看「哪个能力存在」而不是工具参数，**模型无法靠传参把自己提升到真 window 那条路径**；
两者同时存在时优先走沙箱（更严的那条）。

**为什么必须放 Worker**：同 realm 的 `new Function('window', …)` 不是沙箱 ——
`(function(){}).constructor('return globalThis')()` 就能拿回真全局，而页面内存里有解密后的 API Key。
沙箱的做法是**把逃逸的目标本身掏空**：Worker 本就没有 DOM / 页面内存 / 密钥，执行模型代码**之前**
再删掉 `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `importScripts` / `indexedDB` /
`caches` / `postMessage` / `addEventListener` 等能力；删不掉的（`navigator` / `location` 是只读 getter）
用**形参遮蔽**成 `undefined`。其中 **`indexedDB` 最要紧**：AI 配置（含 API Key）存在同源 IndexedDB，
而解密密钥由源码常量派生。

**越权的第二道闸**：脚本里的工具调用经 postMessage 桥回页面，由**真正的 `executeTool`** 执行 ——
危险工具照样弹确认、`requires` 能力校验照样生效，脚本绕不过去。

**上限**：50 次工具调用 / **2 分钟**超时（到点 `worker.terminate()` 强杀）/ 返回值 20000 字符 /
报错 4000 字符 / 日志 200 条且合计 20000 字符。每次执行后销毁 Worker，不留复用状态。
超时从 20s 放宽到 120s：单次 `web_fetch` 自身就可能用掉 15s，脚本连抓几页时旧上限会误杀正常脚本。

**原始数据不截断**：脚本返回值在 `toSerializable()` 阶段不再按「200 项 / 6 层深度」砍掉数组与嵌套对象，
完整处理后才在最终序列化字符串上按上述上限截断；日志也是单条不预截断、只受总字符预算约束。
这样「脚本里处理了 10000 条」不会在返回时被悄悄缩成 200 条。

**UI 顶层输出**：`run_js` 在活动流里拆成三行 ——「代码」工具行只放脚本源码（可展开查看完整代码），
返回值/日志单独成「运行结果」行，失败时单独成「运行报错」行；结果不再藏在代码卡片的展开结果栏里。

**已知残余风险（接受）**：动态 `import()` 是语法而非全局属性、删不掉；但它加载的模块同样运行在
**已被掏空**的 realm 里，没有网络与存储，不构成越权。

**WS 路径的代价**：真 window 意味着脚本能碰 DOM 与 storage，且页面 realm 里的死循环**无法中断**
（不能 `terminate()`）；这是按「WS 远程接管无条件信任」的产品决定接受的。

## 1.5 自定义倍率（自定义直伤）

排轴里除了角色技能倍率，还可以有用户自定义的直伤倍率。AI 通过四个工具管理：

| 工具                | 作用                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `list_custom_hits`  | 按角色列出名称 / 固定值 / 百分比 / 单位 / 属性 / 段数 / 渲染后的倍率串 |
| `add_custom_hit`    | 新建（名称同角色内唯一；固定值与百分比至少一个 >0）                    |
| `update_custom_hit` | 按当前名称定位并修改（可改名、改数值/单位/属性/段数）                  |
| `remove_custom_hit` | 删除（已绑定到操作块的同名命中不会自动解绑）                           |

倍率串格式化由 `$lib/calc/custom-hit` 的 `customHitRatio()` 统一提供，界面选择器与 AI 工具共用同一口径。
创建后再用 `get_char_skills` 确认，并用 `bind_damage_to_block` 绑定到操作块。

## 1.6 跨工程只读

所有**写工具**仍然只作用于当前活动工程（`set_active_project` 之后）。为避免「只想看一眼别的工程却被迫切换」，
下列读取工具接受可选的 `projectId`，直接读持久化工程数据、不切换活动工程：

- 工程 / 队伍 / 排轴：`get_project_state` / `get_team` / `get_timeline_summary` / `get_timeline_damage_list` / `get_ref_line_timings` / `get_char_skills`
- 配装：`get_config_summary`
- 拉表：`get_damage_entries` / `get_buff_confs` / `get_buff_conf_detail` / `get_buff_conf_zone_condition` / `get_damage_entry_buff_sources` / `get_condition_profile`
- 结果：`get_result_summary` / `get_result_entry_breakdown` / `get_data_analysis`
- 自定义倍率：`list_custom_hits`

跨工程结果类工具用目标工程的持久化时间线重新推导伤害条目（`buildDamageEntriesFromTimeline()`），
不读活动工程的全局 store。需要写入时先 `set_active_project`，完成后再切回并重读状态。

## 2. 上下文装配顺序

`runAiTurn` 先由 `buildTurnSegments()` 渲染出**分段**结构，再用 `segmentsToMessages()` 装配为消息序列
（`src/lib/ai/turn-context.ts`）。顺序固定：

1. `system` 人设提示词（用户自定义优先，清空回落默认）
2. `system` **被动技能正文** —— 启用中的被动技能每轮直接注入，常驻生效
3. `system` **主动技能清单** —— 只含「名称 + 一句话描述」，正文按需激活（省 token）
4. `system` **当前状态** —— 工程名/id、当前视图、四环节锁定态、打开的弹窗
5. `system` **工作摘要** —— 要求 AI 每轮先用 `set_work_summary` 更新一句话摘要；**该段无条件注入**
6. `system` **变化队列** —— 自上次对话以来的工程改动
7. `history` 历史消息（含此前的工具调用与结果）
8. `user` 本轮用户消息（可能带**图片附件** —— 只发图、不带文字也是一条合法消息）

> 状态与变化都是「以本条为准」的强声明：模型被明确要求在与记忆冲突时以最新事实为准，需要细节时用工具重查。
> 各段为空时自动跳过，不会留下空的 system 消息。
>
> 分段是**唯一真源**：上下文面板展示的段名、字符数、估算 token 与占比都来自同一份 `buildTurnSegments()`
> 结果（`session.ts` 在回合开始时把快照写入 `turn-state.svelte.ts`），因此面板与实际注入永远一致。
> 分段结构里每个 `TurnSegment` 同时带 `text`（展示与估算）、`messages`（实际注入）与 `tokens`。

## 2.1 上下文面板（可临时禁用分段）

助手头部「分层」按钮展开面板（默认收起），面板按段列出最近一轮**实际注入**的内容：

- 每段：名称、字符数、估算 token、占启用段合计的比例（含占比条）；空段显示「无内容」
- 每段可勾选**临时禁用**（当轮不注入，可随时恢复）：**只写在内存里**（`turn-state.svelte.ts` 的
  `disabledSegments`），不写 IndexedDB / localStorage，刷新即恢复；被禁用的段灰显 + 删除线 + 红色左边条
- 「清空对话历史」（回到 `ai-assistant.svelte` 的 `clearConversation()`，同时清本会话用量累计与快照）
- 「清空变化队列」（`clearChanges()`：丢弃待上报的工程变化，已注入的历史消息不回退）
- 禁用 / 恢复的生效时机是**下一轮请求**（面板展示的快照始终是最近一轮已发出的内容）

## 2.2 token 与缓存命中

数据来源见 `token-usage.ts`，**服务商 usage 优先，缺失字段显示「—」**，不臆造：

| 口径             | 字段                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| DeepSeek（Chat） | `prompt_tokens` / `completion_tokens` / `total_tokens` / `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` |
| OpenAI 兼容      | `prompt_tokens` / `completion_tokens` / `total_tokens` / `prompt_tokens_details.cached_tokens`                  |
| Responses API    | `input_tokens` / `output_tokens` / `total_tokens` / `input_tokens_details.cached_tokens`                        |

- 取法：Chat Completions 需要在请求体带 `stream_options: { include_usage: true }`（`client.ts` 已带），
  流式最后一个 chunk 上取 `usage`；Responses API 在 `response.completed` 事件的 `response.usage` 上取
  （`responses.ts`）。
- 命中率：`hit / (hit + miss)`（DeepSeek）；只有 `cached_tokens` 时用 `hit / prompt`（OpenAI 兼容）；
  字段缺失显示「—」。
- **本地估算回退**：`estimateTokens()`（中文 ≈1 token/字、ASCII ≈4 字符/token、每条消息 +4 角色开销）。
  只在**整次请求都没有 usage** 时兜底，面板/状态条会标注「含 N 次本地估算」；分段占比固定用估算值。
  局限见 `token-usage.ts` 文件头（不建模 BPE 切分与工具 schema 开销，不能当计费依据）。
- 展示：本轮 prompt / completion / 合计、缓存命中率（附 hit / miss）、以及本会话累计（轮数 / 请求数）。
- 另有一个**上下文占用比**（`contextUsageRatio()`）用于 composer 的用量圈：分子是**最近一次请求**的
  prompt token（不是本轮累计 —— 累计会随工具轮次叠加而虚高），分母是配置文件里声明的 `contextWindow`；
  分子缺失或分母非正时返回 `null`（画空环），比值超过 1 时**钳到 1**。
- **图片附件不计入任何估算**（`estimateTokens` 只看文本）：服务商对图片的计费口径各不相同
  （按张 / 按像素折算），本地无法建模，故附图的回合估算会偏低、用量圈也只反映文本部分。
  有服务商 usage 时以 usage 为准。
- **图片上传前压缩**（`attachments.ts`）：超过 512KB 的图片缩到最长边 2048px 并转 WebP。
  原因是转发平台按**整包**限制请求体（Vercel 约 4.5MB），5MB 原图 base64 后单张就可能超限，
  症状正是「界面带了图、模型收不到」。GIF 与小图保持原样；压缩失败自动回落原图。
- **直连与图片**：`directRequest=true` 时浏览器直接请求端点，完全绕开转发平台的请求体与时长限制；
  代价是端点必须自己放行 CORS（预检要允许 `Authorization` 头），否则浏览器会拦下请求。

## 2.3 实时运行情况

`session.ts` 在回合流程里写 `turn-state.svelte.ts`，界面只读：

- 阶段：`思考中` → `收到流式文本` → `正在调用工具「名称」` → `等待工具结果（等用户确认 / 生成进度）`
- 耗时：`beginTurn()` 起内部时钟每 200ms 推进，状态条与面板实时刷新（秒）
- 本轮工具调用列表：名称、耗时、成功 / 失败（解析工具返回的 `ok` 字段）、结果梗概
  （失败给错误信息，成功给结果字符数；服务端 `web_search` 记为一次调用）
- 回合结束（含失败 / 中止）保留一行汇总直到下一轮开始：
  `本轮：4.2s · 3 次工具调用 · prompt 8.1k / completion 0.6k · 缓存命中 74%`
- 聊天卡片的工具时间线可按工具展开：`run_js` 显示**脚本源码**与「返回值 + 脚本日志」，
  `web_fetch` 显示**请求参数**（method / headers / body）与**响应结果**（status / headers / content）；
  其余工具按统一 JSON 展示请求参数与结果。

## 3. 变化队列

`change-queue.svelte.ts` 把「切换工程」与「当前工程四阶段数据的任何变化」记录下来，在**下一轮**对话开头
以系统消息上报，避免用户改完状态后助手仍按旧记忆作答。

- 入队：`pushProjectSwitch()` / `pushPhaseChange(phase, detail)` / `pushTeamChange()`
- 合并：同 `kind` 且 1.5s 窗口内的连续变化合并为一条并累加 `×N`（连续拖拽数值不会刷屏）
- 上限：环形队列 50 条，超出丢弃最旧
- 消费：`drainChanges()` 在回合开始时取出并清空，同一条变化不会重复上报
- 界面：**对 AI 静默、对界面静默** —— 助手界面不主动提示条数；只有「上下文」面板里能看到待上报条数并手动清空
  （`getChangeCount()` / `clearChanges()`）

指纹来源：`+page.svelte` 中对 `工程 id + 队伍 + 四阶段数据` 建立 `$effect` 指纹，
首次建立基线时不入队（避免刚打开页面就产生噪声）。

## 4. 自定义 Skill

技能卡 = 用户预置的**操作规范**，解决「同一套要求每次都要重复交代」的问题。

```ts
type SkillMode = 'active' | 'passive'

interface AiSkill {
    id: string
    name: string // 唯一，AI 通过它激活
    description: string // 一句话；主动技能进清单供 AI 判断何时激活，被动技能仅作备注
    body: string // 主动：激活后注入；被动：每轮直接注入
    enabled: boolean
    mode: SkillMode // active=按需激活 / passive=常驻生效（旧数据缺省 active）
    builtin?: boolean // 内置技能不可删除，可改描述 / 正文 / 类型 / 启停
}
```

- 存储：IndexedDB `ai-skills`；内置技能在 `loadSkills()` 时与代码定义合并（保留用户对描述 / 正文 / 类型 / 启用的修改）。
  旧数据没有 `mode` 字段时按 `active` 读取（`coerceSkillMode`）。
- 语义分工：
    - **主动（active）**：清单只进名称与描述，正文只在被 `use_skill` 激活时进入上下文 —— 最主要的 token 优化
    - **被动（passive）**：正文每轮直接进 system 常驻生效，**不**出现在可用技能清单里（避免重复）
    - `enabled=false` 时两者都不注入
- 工具（通用 CRUD）：`list_skills`（列出，标注主动/被动/内置）、`get_skill(name)`（读取完整正文）、
  `create_skill`（新建自定义技能）、`update_skill`（改名称/描述/正文/类型/启停；内置技能不可改名）、
  `delete_skill`（只删自定义技能）、`use_skill(name)`（激活主动技能正文；对被动技能返回
  「已常驻生效，无需激活」并附正文；未找到/被禁用时回传可用名称）。
  旧的 `get_naming_rule` / `set_naming_rule` 已删除：命名规则改为通过 `update_skill` 维护内置技能「Buff 命名规则」。
- 内置技能四张（类型均可在设置里改）：
    - **数据自愈**（主动）—— 查询类工具返回空/异常时，按 team → timeline → calculation → config 重载后重试
    - **条件与链阶**（被动）—— 条件挂在乘区（伤害类型/属性）、链阶是整块硬性条件且互斥、链阶真源是角色槽位
    - **Buff 命名规则**（主动）—— 原「提示词设置 → Buff 命名规则」，正文即生成流程使用的命名规范（含叠层/精炼拆分硬性要求）；
      生成工具按此技能卡取正文，禁用或清空则回落内置宽松默认；AI 用 `update_skill` 维护它
    - **黑话词典**（主动）—— 原「提示词设置 → 黑话词典」，正文即官方/生僻叫法 → 玩家黑话对照表；生成流程的 `get_slang_dict` 返回其正文
- 界面：**设置 → AI助手 → 权限 / 提示词 → 技能**（列表 + 编辑弹窗）。编辑弹窗可改名称 / 描述 / 正文 / 类型 / 启停，
  右侧「可调用工具」面板点击即把工具名插入正文光标处；导入导出格式为 `{ kind: 'wuwa-afyg-skills', skills: [...] }`，
  导入时同名跳过。助手悬浮窗本身不再有技能入口（头部 ⚡ 面板与输入框上方快捷 chip 已移除）。

## 5. 界面结构

助手是一个可拖拽悬浮窗（收起圆钮 / 小卡片 / 全尺寸三态）：

| 区域       | 内容                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| 头部       | **当前工作摘要**（AI 每轮经 `set_work_summary` 更新的大标题）、上下文面板入口、清空对话、尺寸切换            |
| 上下文面板 | 可折叠（默认收起）：分段禁用 + 用量与缓存命中 + 实时运行情况 + 清空历史 / 变化队列                           |
| 消息区     | 用户消息是右侧气泡；AI 输出是**活动流列表**（思考 / 工具 / 回复 / 提示按发生顺序，工具行可展开看请求与响应） |
| composer   | 圆角卡片：输入框 + 工具条（左权限 / 右「模型 · 等级」/ 用量圈 / 发送）+ 右上角「暂时收起」                   |
| 状态行     | composer **下方**：左侧实时阶段或上一轮汇总、长任务模式标记，右侧会话累计「N 轮 · N 步」                     |
| 待作答     | 危险确认卡与 `ask_user` 卡渲染在 composer **卡片内部**，替掉输入行（回合正阻塞，输入框此时无用）             |

composer 的四点约定：

- **收起只对「待权限 / 待提问」阶段存在**：聊天模式**不提供收起**（输入区应始终可用）。
  待作答时右上角出现收起按钮，折成**一行 AI 的问题**（`pendingLabel`，由宿主算好传入 ——
  composer 拿不到 snippet 内部内容）；点整行即展开。`pending` 消失后自动恢复展开态，
  下一次提问不会继承上一次的收起状态。
- **两个卡片走 `pending` 槽位**（Svelte snippet，由 `ai-assistant.svelte` 传入）：宿主仍持有卡片状态与
  幂等收尾，composer 只负责放进正确的容器。`AskUserCard` 传 `embedded` 以去掉自带外框与底色。
- **用量圈**紧贴发送按钮，画的是**最近一次请求**的 prompt token 占该配置「上下文窗口」的比例
  （`turn-state.svelte.ts` 的 `getLastPromptTokens()`，刻意不在 `beginTurn()` 里清空，避免圈闪空）。
  分档配色 <70% 主题强调色 / 70~90% 琥珀 / ≥90% 红；算不出时画空环并在 title 里说明，不臆造分母。
  分母来自每个配置文件的 `contextWindow` 字段（设置 → 助手设置 里可改，默认 256k）——
  服务商不下发窗口大小，本应用也没有 `pi-ai` 那样的模型目录可查，故只能由用户声明。
- **图片附件**：工具条左侧回形针按钮（也支持直接粘贴图片）。只收 PNG / JPEG / WebP / GIF，
  最多 4 张、单张 ≤ 5 MB；被拒的逐条提示，不静默丢弃。草稿缩略图在输入框上方，右上角可移除。
  附件以 data URL 存在 `ChatMessage.images`，**只在发请求那一刻**转成协议要求的 content parts
  （形状差异的唯一真源是 `image-parts.ts`，两条协议都有单测钉住）；随历史一起保留，
  因此后续轮次仍能看到这张图。
- 权限 / 提供商配置 / 思考强度三者的写入语义见 §1.1。

技能管理在设置里（悬浮窗无入口）；工程变化队列平时不出现，只在上下文面板里可查看待上报条数 / 清空。
