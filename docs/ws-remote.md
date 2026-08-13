# WS 远程接管

椰果工具箱支持通过 URL hash 连接用户指定的 WebSocket 服务器，由服务器**接管操作**：AI 助手能做什么、能查什么，WS 服务器就能做什么、查什么（两者共用同一套工具注册表与执行引擎（完整清单见 docs/tools.md，共 86 个））。

## 快速开始

```bash
# 1. 启动示例服务端（零依赖）
node scripts/ws-demo-server.mjs 8765

# 2. 用带 hash 的地址打开应用（dev 环境为 http）
#    http://localhost:5173/#websocket=127.0.0.1:8765
```

连接成功后：

- 顶栏右上角原本的「帮助」按钮变为 WS 状态按钮（绿色接入点 = 已连接 / 红色断开 = 连接失败 / 灰色 = 连接中），点击打开状态弹窗（地址、状态、已执行工具数、最近 8 次工具调用、断开/重连）
- 示例服务端终端会打印 `hello`（工具清单与当前状态）与后续的 `state` / `result` 推送
- 在服务端终端输入命令即可下发指令：

```
exec list_projects {}
exec get_project_state {}
exec set_chain {"slot":1,"value":3}
exec set_team_character {"slot":1,"character":"散华"}
```

## URL 格式

```
#websocket=<目标>
```

`<目标>` 两种写法：

| 写法        | 示例                             | 说明                                                                   |
| ----------- | -------------------------------- | ---------------------------------------------------------------------- |
| `host:port` | `#websocket=127.0.0.1:8765`      | 自动补全协议：页面为 `https` 时补 `wss://`，否则补 `ws://`             |
| 完整 URL    | `#websocket=ws://127.0.0.1:8765` | 显式指定协议（明文 ws 用于 http 页面；https 部署下明文会被浏览器拦截） |

注意事项：

- **https 部署必须用 wss**（浏览器禁止 https 页面建立明文 `ws://` 混合内容连接）；内网自签证书的 wss 需要在客户端信任证书
- hash 变化实时生效：移除 hash 即断开连接，不再自动重连
- 连接断开后自动 3 秒重连（手动点击「断开连接」除外）

## 权限模型

- 带 hash 访问即视为授权，**直接连接、无确认弹窗**
- 危险工具（删除工程、归档、清空 Buff 库等）**无条件放行**，与 AI 助手的危险操作权限设置无关
- 服务端可调用全部工具，包括修改工程/排轴/拉表/配装数据与切换视图

## 消息协议

双方均为 UTF-8 文本帧，消息为单个 JSON 对象。

### 客户端 → 服务器

| type       | 说明                                   | 载荷                                                                                                                                  |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `hello`    | 连接建立后立即发送一次                 | `app`（固定 `wuwa-afyg`）、`version`、`tools`（`buildTools()` 全量工具 schema：name/description/parameters）、`state`（当前状态快照） |
| `state`    | 状态变化实时推送                       | `state`：`{ project: {id,name} \| null, view, locked: {team,timeline,calculation,config}, panels: {...} }`                            |
| `result`   | 工具执行结果回传                       | `id`（对应 exec 的 id）、`ok`、`data`（成功时）或 `error`（失败时）                                                                   |
| `progress` | 长时间生成任务的进度（如 Buff 集生成） | `text`                                                                                                                                |
| `pong`     | 对服务器 `ping` 的响应                 | —                                                                                                                                     |

`hello` 示例：

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
        "panels": { "buff-config": false, "damage-list": false, "settings": false }
    }
}
```

`result` 示例：

```json
{ "type": "result", "id": "1728012345678", "ok": true, "data": { "projects": [] } }
{ "type": "result", "id": "1728012345679", "ok": false, "error": "工程 id 不存在" }
```

### 服务器 → 客户端

| type   | 说明                                             | 载荷                                                               |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------ |
| `exec` | 下发工具调用（可并发下发，客户端 FIFO 串行执行） | `id`（任意字符串，原样回传）、`tool`（工具名）、`args`（参数对象） |
| `ping` | 存活探测                                         | —                                                                  |

`exec` 示例：

```json
{ "type": "exec", "id": "1728012345678", "tool": "list_projects", "args": {} }
{ "type": "exec", "id": "1728012345679", "tool": "set_chain", "args": { "slot": 1, "value": 3 } }
```

## 工具清单

86 个工具，与 AI 助手完全一致，按领域分组（可用 `node scripts/ws-demo-server.mjs` 后输入 `tools` 查看完整清单，或参考 `src/lib/ai/tools/`）：

| 领域         | 工具（节选）                                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工程         | `list_projects` `get_project_state` `get_team` `create_project` `rename_project` `set_active_project` `archive_project` `delete_project` `clone_project` `lock_phase` `unlock_phase`                        |
| 队伍         | `get_team_catalog` `set_team_character` `set_team_weapon` `set_team_first_echo` `set_team_trigger_sets`                                                                                                     |
| 排轴         | `get_timeline_summary` `get_char_skills` `add_op_block` `bind_damage_to_block` `bind_non_direct_to_block` `remove_op_block` `move_op_block` `add_ref_line` `format_timeline` `undo_timeline` 等             |
| 拉表         | `get_damage_entries` `get_buff_sets` `create_buff_set` `rename_buff_set` `delete_buff_set` `bind_buff_to_entry` `set_buff_zone` `set_buff_zone_ref` `set_chain` `set_refinement` `get_condition_profile` 等 |
| 配装         | `get_config_summary` `set_echo_cost` `set_main_stat` `add_substat` `remove_substat` `update_substat_value` `update_enemy` `update_resistance`                                                               |
| 结果         | `get_result_summary`                                                                                                                                                                                        |
| 视图/弹窗    | `switch_view` `get_panels_state` `open_panel`                                                                                                                                                               |
| Buff 库/生成 | `list_buff_entities` `get_entity_buffs` `update_entity_buffs` `list_entities` `search_entities` `generate_entity_buffs` `generate_project_buffs` 等                                                         |

## 示例服务端（scripts/ws-demo-server.mjs）

零依赖，Node 原生 `http` upgrade + 手写最小 WebSocket 帧编解码（仅文本帧、无分片，演示用途）。

```bash
node scripts/ws-demo-server.mjs [port]   # 默认 8765
```

交互命令：

| 命令                 | 说明                                                |
| -------------------- | --------------------------------------------------- |
| `exec <tool> <json>` | 向所有已连接客户端下发工具调用，打印返回的 `result` |
| `tools`              | 打印客户端上报的工具清单（名称）                    |
| `hello`              | 打印客户端握手信息（工具/初始状态）                 |
| `state`              | 查看最近收到的状态推送                              |
| `exit`               | 退出                                                |

## 实现说明（开发者）

- 客户端：`src/lib/ws-remote/ws-remote.svelte.ts`（连接/重连/协议/串行执行队列/状态推送），挂载于 `src/routes/+layout.svelte`（hash 解析）与 `src/routes/+page.svelte`（宿主桥：`requestView`/`view`）
- 执行入口：`executeTool(ctx, name, args)`（`src/lib/ai/tools/registry.ts`），与 AI 会话（`session.ts`）共用同一注册表，因此工具能力天然同步
- 状态推送：顶栏组件 `phase-tabs.svelte` 内 `$effect` 观察工程/视图/锁定/弹窗变化后调用 `pushState()`
- 危险操作放行：`ToolContext.onConfirm` 恒为 `true`；如需收紧，改 `buildCtx()` 即可
