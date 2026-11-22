# WS 远程接管

连接用户指定的 WebSocket 服务器，由服务端**接管操作**：AI 助手能做什么、能查什么，WS 服务器就能做什么、查什么（共用同一套工具注册表与执行引擎，清单见 tools.md）。

连接目标两个来源，**hash 优先**：

| 来源                   | 位置                          | 生命周期                               |
| ---------------------- | ----------------------------- | -------------------------------------- |
| 设置开关 + 服务地址    | 设置 → 连接配置 → WS 远程接管 | 持久（本机保存，刷新 / 重进自动重连）  |
| URL hash `#websocket=` | 地址栏                        | 临时（当次访问有效，移除 hash 即断开） |

## 快速开始

```bash
# 1. 启动示例服务端（零依赖）
node scripts/ws-demo-server.mjs 8765

# 2. 二选一连接
#    ① 设置 → 连接配置 → WS 远程接管：填 127.0.0.1:8765 并打开开关
#    ② 带 hash 打开（dev 环境为 http）：
#       http://localhost:5173/#websocket=127.0.0.1:8765
```

连接成功后：

| 观察点         | 现象                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| 顶栏右上角     | WS 状态按钮：绿=已连接 / 红=失败 / 灰=连接中；点击打开状态弹窗（地址、状态、已执行工具数、最近 8 次调用、断开/重连） |
| 示例服务端终端 | 打印 `hello`（工具清单与状态）及后续 `state` / `result` 推送                                                         |
| 下发指令       | 终端输入 `exec <tool> <json>`                                                                                        |

```text
exec list_projects {}
exec get_project_state {}
exec set_chain {"slot":1,"value":3}
exec set_team_character {"slot":1,"character":"散华"}
```

## URL 格式

```text
#websocket=<目标>
```

`<目标>` 两种写法：

| 写法        | 示例                             | 说明                                                               |
| ----------- | -------------------------------- | ------------------------------------------------------------------ |
| `host:port` | `#websocket=127.0.0.1:8765`      | 自动补协议：`https` 页面补 `wss://`，否则 `ws://`                  |
| 完整 URL    | `#websocket=ws://127.0.0.1:8765` | 显式协议（明文 ws 用于 http 页面；https 部署下明文会被浏览器拦截） |

规则：

| 项        | 说明                                                                             |
| --------- | -------------------------------------------------------------------------------- |
| 协议      | https 部署必须 wss（浏览器禁止混合内容）；内网自签证书需在客户端信任             |
| hash 变化 | 实时生效，移除即断开并保持断开，需手动重连                                       |
| 自动重连  | 断开后 3 秒重连（手动「断开连接」或关开关除外）                                  |
| 优先级    | hash 与设置开关并存时 hash 优先，且不覆盖保存的地址；无 hash 才回落到开关 + 地址 |
| 非法地址  | 设置里地址非法或开关关闭时不连接、不报错（点「应用」才落盘）                     |

## 权限模型

| 项       | 说明                                                                        |
| -------- | --------------------------------------------------------------------------- |
| 授权     | 开关打开（持久）或带 hash 访问（临时）即授权，直接连接、无确认弹窗          |
| 危险工具 | 无条件放行（删除工程、归档、清空 Buff 集等），与 AI 危险操作权限设置无关    |
| 工具范围 | 服务端可调用全部工具（改工程 / 排轴 / 拉表 / 配装数据、切视图）             |
| 断开     | 关掉设置开关（同时停自动重连）/ 状态弹窗「断开连接」（当次会话）/ 移除 hash |

## 消息协议

双方均为 UTF-8 文本帧，单条消息为一个 JSON 对象。

### 客户端 → 服务器

| type       | 说明                         | 载荷                                                                                                 |
| ---------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `hello`    | 连接建立后立即发送一次       | `app`（固定 `wuwa-afyg`）、`version`、`tools`（`buildTools()` 全量 schema）、`state`（状态快照）     |
| `state`    | 状态变化实时推送             | `state`：`{ project: {id,name}\|null, view, locked:{team,timeline,calculation,config}, panels:{…} }` |
| `result`   | 工具执行结果回传             | `id`（对应 exec）、`ok`、`data`（成功）或 `error`（失败）                                            |
| `progress` | 长任务进度（如 Buff 集生成） | `text`                                                                                               |
| `pong`     | 对服务器 `ping` 的响应       | —                                                                                                    |

`hello`：

```json
{
    "type": "hello",
    "app": "wuwa-afyg",
    "version": "1786445004881",
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "list_projects",
                "description": "列出全部工程…",
                "parameters": { "type": "object", "properties": {} }
            }
        }
    ],
    "state": {
        "project": { "id": "08c89457-…", "name": "转模问题example" },
        "view": "calculation",
        "locked": { "team": true, "timeline": true, "calculation": false, "config": false },
        "panels": { "buff-conf": false, "damage-list": false, "settings": false }
    }
}
```

`result`：

```json
{ "type": "result", "id": "1728012345678", "ok": true, "data": { "projects": [] } }
{ "type": "result", "id": "1728012345679", "ok": false, "error": "工程 id 不存在" }
```

### 服务器 → 客户端

| type   | 说明                                             | 载荷                                                           |
| ------ | ------------------------------------------------ | -------------------------------------------------------------- |
| `exec` | 下发工具调用（可并发下发，客户端 FIFO 串行执行） | `id`（任意串，原样回传）、`tool`（工具名）、`args`（参数对象） |
| `ping` | 存活探测                                         | —                                                              |

```json
{ "type": "exec", "id": "1728012345678", "tool": "list_projects", "args": {} }
{ "type": "exec", "id": "1728012345679", "tool": "set_chain", "args": { "slot": 1, "value": 3 } }
```

## 工具清单

工具与 AI 助手完全一致，按领域分组（运行 `node scripts/ws-demo-server.mjs` 后输入 `tools` 看完整清单，或看 `src/lib/ai/tools/`）。

| 领域          | 工具（节选）                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 工程          | `list_projects` `get_project_state` `get_team` `create_project` `rename_project` `set_active_project` `archive_project` `delete_project` `clone_project` `lock_phase` `unlock_phase` |
| 队伍          | `get_team_catalog` `get_recommended_weapons` `set_team_character` `set_team_weapon` `set_team_first_echo` `set_team_trigger_sets`                                                    |
| 排轴          | `get_timeline_summary` `get_char_skills` `add_op_block` `bind_damage_to_block` `remove_op_block` `move_op_block` `add_ref_line` `format_timeline` `undo_timeline` 等                 |
| 拉表          | `get_damage_entries` `get_buff_confs` `create_buff_conf` `set_buff_conf_zone` `set_chain` `set_refinement` `get_condition_profile` 等                                                |
| 配装          | `get_config_summary` `set_echo_cost` `set_main_stat` `add_substat` `update_substat_value` `update_enemy` `update_resistance`                                                         |
| 结果          | `get_result_summary` `get_result_entry_breakdown` `get_data_analysis`                                                                                                                |
| 设置          | `get_settings_state` `set_setting` `manage_workshop` `get_keymap` `set_keymap_entry` `get_ai_profiles` `manage_ai_profile` 等                                                        |
| 视图 / 弹窗   | `switch_view` `get_panels_state` `open_panel`                                                                                                                                        |
| Buff 集与生成 | `list_buff_set_entities` `get_buff_set_entity_buffs` `update_buff_set_entity_buffs` `generate_buff_set_entity_buffs` 等                                                              |

## 示例服务端

`scripts/ws-demo-server.mjs`：零依赖，Node 原生 `http` upgrade + 手写最小 WebSocket 帧编解码（仅文本帧、无分片，演示用途）。

```bash
node scripts/ws-demo-server.mjs [port]   # 默认 8765
```

交互命令：

| 命令                 | 说明                                                |
| -------------------- | --------------------------------------------------- |
| `exec <tool> <json>` | 向所有已连接客户端下发工具调用，打印返回的 `result` |
| `tools`              | 打印客户端上报的工具清单（名称）                    |
| `hello`              | 打印客户端握手信息（工具 / 初始状态）               |
| `state`              | 查看最近收到的状态推送                              |
| `exit`               | 退出                                                |

## 实现说明

| 部件         | 文件 / 说明                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 客户端       | `src/lib/ws-remote/ws-remote.svelte.ts`（连接/重连/协议/串行队列/状态推送），挂于 `+layout.svelte`（hash 解析 + 自动连接）与 `+page.svelte`（宿主桥）                   |
| 连接偏好     | `src/lib/data/ws-prefs.svelte.ts`（localStorage 持久）；设置输入草稿在 `settings-ui.svelte.ts`，UI 在 `settings/sections/connection.svelte`，统一走 `setWsConnection()` |
| 状态胶囊     | `components/page/home/ws-status-chip.svelte`，与顶栏弹窗共用                                                                                                            |
| 执行入口     | `executeTool(ctx, name, args)`（`src/lib/ai/tools/registry.ts`），与 AI 会话共用注册表，能力天然同步                                                                    |
| 状态推送     | 顶栏 `phase-tabs.svelte` 内 `$effect` 观察工程/视图/锁定/弹窗变化后调 `pushState()`                                                                                     |
| 危险操作放行 | `ToolContext.onConfirm` 恒为 `true`；收紧改 `buildCtx()`                                                                                                                |
