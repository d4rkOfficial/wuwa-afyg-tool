# AI 助手：Agent Harness

本文档描述 AI 助手的回合结构、上下文组成、变化队列与自定义 Skill。

> 相关源码
>
> | 文件                                                      | 职责                                                              |
> | --------------------------------------------------------- | ----------------------------------------------------------------- |
> | `src/lib/ai/session.ts`                                   | 回合循环、事件分发（双协议：Responses / Chat Completions）        |
> | `src/lib/ai/turn-context.ts`                              | 上下文（system）消息装配顺序（纯逻辑）                            |
> | `src/lib/ai/persona.ts`                                   | 默认人设提示词                                                    |
> | `src/lib/ai/change-queue.svelte.ts`                       | 工程变化队列（静默，界面不显示）                                  |
> | `src/lib/ai/skills.ts`                                    | 技能卡纯逻辑（类型 / 兼容归一化 / 内置合并 / 注入文本渲染）       |
> | `src/lib/data/ai-skills.svelte.ts`                        | 自定义 Skill（技能卡）存储（IndexedDB）                           |
> | `src/lib/ai/tools/skills.ts`                              | `list_skills` / `use_skill` 工具                                  |
> | `src/lib/components/layout/ai-assistant.svelte`           | 助手界面（对话 / 工具时间线 / 危险确认）                          |
> | `src/lib/components/layout/settings/skill-section.svelte` | 设置里的技能管理（启用 / 新建 / 编辑 / 删除 / 导入导出）          |
> | `src/lib/components/layout/ai-skill-edit-modal.svelte`    | 技能编辑弹窗（名称 / 描述 / 正文 / 类型 / 启停 + 工具名快速输入） |
> | `src/lib/components/layout/tool-picker.svelte`            | 可调用工具清单面板（与提示词编辑共用）                            |

## 1. 回合结构

一轮对话 = 一次 `runAiTurn()`，内部最多 `MAX_TOOL_ROUNDS = 8` 个工具轮次：

```
user 消息
  └─ for round in 0..8:
       调用模型（流式）
       ├─ 有工具调用 → 逐个 executeTool() → 结果回灌为 tool 消息 → 继续下一轮
       └─ 无工具调用 → 结束本轮
事件流（onEvent）：ai / reasoning / tool / confirm / error / done
```

`buildTools()` 返回全部已注册工具（见 [tools.md](./tools.md)）；危险工具在 `executeTool` 前经
`onConfirm` 走确认卡片，确认策略由设置里的 `dangerMode` 决定：

| 模式          | 行为                                   |
| ------------- | -------------------------------------- |
| `ask`（默认） | 每次危险操作都询问                     |
| `ask_once`    | 一次指令回合内只询问一次，之后自动放行 |
| `trust`       | 无条件信任，直接执行                   |

## 2. 上下文装配顺序

`runAiTurn` 把各段文本交给 `buildTurnMessages()`（`src/lib/ai/turn-context.ts`）装配，顺序固定：

1. `system` 人设提示词（用户自定义优先，清空回落默认）
2. `system` **被动技能正文** —— 启用中的被动技能每轮直接注入，常驻生效
3. `system` **主动技能清单** —— 只含「名称 + 一句话描述」，正文按需激活（省 token）
4. `system` **当前状态** —— 工程名/id、当前视图、四环节锁定态、打开的弹窗
5. `system` **变化队列** —— 自上次对话以来的工程改动
6. `history` 历史消息（含此前的工具调用与结果）
7. `user` 本轮用户消息

> 状态与变化都是「以本条为准」的强声明：模型被明确要求在与记忆冲突时以最新事实为准，需要细节时用工具重查。
> 各段为空时自动跳过，不会留下空的 system 消息。

## 3. 变化队列

`change-queue.svelte.ts` 把「切换工程」与「当前工程四阶段数据的任何变化」记录下来，在**下一轮**对话开头
以系统消息上报，避免用户改完状态后助手仍按旧记忆作答。

- 入队：`pushProjectSwitch()` / `pushPhaseChange(phase, detail)` / `pushTeamChange()`
- 合并：同 `kind` 且 1.5s 窗口内的连续变化合并为一条并累加 `×N`（连续拖拽数值不会刷屏）
- 上限：环形队列 50 条，超出丢弃最旧
- 消费：`drainChanges()` 在回合开始时取出并清空，同一条变化不会重复上报
- 界面：**完全静默** —— 助手界面上不显示条数，也没有「忽略」按钮；队列只对 AI 生效

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

| 区域     | 内容                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| 头部     | 当前模型与提供方、清空对话、尺寸切换                                                     |
| 消息区   | 每条助手消息按「聊天 / 思考 / 工具」分 tab；工具调用以时间线列出（名称、参数、结果长度） |
| 输入区   | 文本域（Enter 发送 / Shift+Enter 换行；生成中变停止按钮）                                |
| 危险确认 | 内联卡片（不遮罩），显示工具名与参数摘要，允许 / 拒绝                                    |

技能管理与工程变化队列都不在悬浮窗里出现（前者在设置里，后者纯后台）。
