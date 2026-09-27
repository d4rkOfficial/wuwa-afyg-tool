# AI 助手：Agent Harness

本文档描述 AI 助手的回合结构、上下文组成（含上下文面板与分段禁用）、变化队列、自定义 Skill、
token / 缓存命中统计与实时运行情况。

> 相关源码
>
> | 文件                                                      | 职责                                                                  |
> | --------------------------------------------------------- | --------------------------------------------------------------------- |
> | `src/lib/ai/session.ts`                                   | 回合循环、事件分发（双协议：Responses / Chat Completions）            |
> | `src/lib/ai/turn-context.ts`                              | 上下文**分段**结构与消息装配顺序（纯逻辑，装配与面板共用真源）        |
> | `src/lib/ai/token-usage.ts`                               | usage 解析（DeepSeek / OpenAI / Responses）+ 本地 token 估算 + 格式化 |
> | `src/lib/ai/turn-state.svelte.ts`                         | 会话级临时状态：分段快照 / 分段禁用 / 实时运行情况 / 用量累计         |
> | `src/lib/ai/persona.ts`                                   | 默认人设提示词                                                        |
> | `src/lib/ai/change-queue.svelte.ts`                       | 工程变化队列（静默，界面不显示；面板可查看待上报条数并清空）          |
> | `src/lib/ai/skills.ts`                                    | 技能卡纯逻辑（类型 / 兼容归一化 / 内置合并 / 注入文本渲染）           |
> | `src/lib/data/ai-skills.svelte.ts`                        | 自定义 Skill（技能卡）存储（IndexedDB）                               |
> | `src/lib/ai/tools/skills.ts`                              | `list_skills` / `use_skill` 工具                                      |
> | `src/lib/components/layout/ai-assistant.svelte`           | 助手界面（对话 / 工具时间线 / 危险确认 / 实时状态条）                 |
> | `src/lib/components/layout/ai-context-panel.svelte`       | 上下文面板（分段禁用 / 用量与缓存命中 / 实时运行情况 / 清空）         |
> | `src/lib/components/layout/settings/skill-section.svelte` | 设置里的技能管理（启用 / 新建 / 编辑 / 删除 / 导入导出）              |
> | `src/lib/components/layout/ai-skill-edit-modal.svelte`    | 技能编辑弹窗（名称 / 描述 / 正文 / 类型 / 启停 + 工具名快速输入）     |
> | `src/lib/components/layout/tool-picker.svelte`            | 可调用工具清单面板（与提示词编辑共用）                                |

## 1. 回合结构

一轮对话 = 一次 `runAiTurn()`，内部最多 `MAX_TOOL_ROUNDS = 8` 个工具轮次：

```
user 消息
  └─ for round in 0..8:
       调用模型（流式）→ 记录 usage（无则本地估算回退）
       ├─ 有工具调用 → 逐个 executeTool() → 结果回灌为 tool 消息 → 继续下一轮
       └─ 无工具调用 → 结束本轮
事件流（onEvent）：ai / reasoning / tool / confirm / error / done
实时状态（turn-state）：阶段 / 耗时 / 工具调用列表 / 用量累计
```

`buildTools()` 返回全部已注册工具（见 [tools.md](./tools.md)）；危险工具在 `executeTool` 前经
`onConfirm` 走确认卡片，确认策略由设置里的 `dangerMode` 决定：

| 模式          | 行为                                   |
| ------------- | -------------------------------------- |
| `ask`（默认） | 每次危险操作都询问                     |
| `ask_once`    | 一次指令回合内只询问一次，之后自动放行 |
| `trust`       | 无条件信任，直接执行                   |

## 2. 上下文装配顺序

`runAiTurn` 先由 `buildTurnSegments()` 渲染出**分段**结构，再用 `segmentsToMessages()` 装配为消息序列
（`src/lib/ai/turn-context.ts`）。顺序固定：

1. `system` 人设提示词（用户自定义优先，清空回落默认）
2. `system` **被动技能正文** —— 启用中的被动技能每轮直接注入，常驻生效
3. `system` **主动技能清单** —— 只含「名称 + 一句话描述」，正文按需激活（省 token）
4. `system` **当前状态** —— 工程名/id、当前视图、四环节锁定态、打开的弹窗
5. `system` **变化队列** —— 自上次对话以来的工程改动
6. `history` 历史消息（含此前的工具调用与结果）
7. `user` 本轮用户消息

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

## 2.3 实时运行情况

`session.ts` 在回合流程里写 `turn-state.svelte.ts`，界面只读：

- 阶段：`思考中` → `收到流式文本` → `正在调用工具「名称」` → `等待工具结果（等用户确认 / 生成进度）`
- 耗时：`beginTurn()` 起内部时钟每 200ms 推进，状态条与面板实时刷新（秒）
- 本轮工具调用列表：名称、耗时、成功 / 失败（解析工具返回的 `ok` 字段）、结果梗概
  （失败给错误信息，成功给结果字符数；服务端 `web_search` 记为一次调用）
- 回合结束（含失败 / 中止）保留一行汇总直到下一轮开始：
  `本轮：4.2s · 3 次工具调用 · prompt 8.1k / completion 0.6k · 缓存命中 74%`

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
- 工具：`list_skills`（列出，标注主动/被动）、`use_skill(name)`（激活主动技能正文；对被动技能返回
  「已常驻生效，无需激活」并附正文；未找到/被禁用时回传可用名称）
- 内置技能两张（类型均可在设置里改）：
    - **数据自愈**（主动）—— 查询类工具返回空/异常时，按 team → timeline → calculation → config 重载后重试
    - **条件与链阶**（被动）—— 条件挂在乘区（伤害类型/属性）、链阶是整块硬性条件且互斥、链阶真源是角色槽位
- 界面：**设置 → AI助手 → 权限 / 提示词 → 技能**（列表 + 编辑弹窗）。编辑弹窗可改名称 / 描述 / 正文 / 类型 / 启停，
  右侧「可调用工具」面板点击即把工具名插入正文光标处；导入导出格式为 `{ kind: 'wuwa-afyg-skills', skills: [...] }`，
  导入时同名跳过。助手悬浮窗本身不再有技能入口（头部 ⚡ 面板与输入框上方快捷 chip 已移除）。

## 5. 界面结构

助手是一个可拖拽悬浮窗（收起圆钮 / 小卡片 / 全尺寸三态）：

| 区域       | 内容                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------- |
| 头部       | 当前模型与提供方、上下文面板入口、清空对话、尺寸切换                                     |
| 状态条     | 运行中：当前阶段 + 已耗时；空闲：最近一次回合汇总（耗时 / 工具数 / token / 缓存命中）    |
| 上下文面板 | 可折叠（默认收起）：分段禁用 + 用量与缓存命中 + 实时运行情况 + 清空历史 / 变化队列       |
| 消息区     | 每条助手消息按「聊天 / 思考 / 工具」分 tab；工具调用以时间线列出（名称、参数、结果长度） |
| 输入区     | 文本域（Enter 发送 / Shift+Enter 换行；生成中变停止按钮）                                |
| 危险确认   | 内联卡片（不遮罩），显示工具名与参数摘要，允许 / 拒绝                                    |

技能管理在设置里（悬浮窗无入口）；工程变化队列平时不出现，只在上下文面板里可查看待上报条数 / 清空。
