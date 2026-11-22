# fast-calc 简表

独立快速计算页：导入一个椰果工程 JSON，直接看逐时段伤害表，并在同页改链 / 精炼、声骸主副词条和敌怪配置。不依赖主界面的排轴、拉表页。

| 场景                            | 说明                      |
| ------------------------------- | ------------------------- |
| 从工坊 / 分享链接打开工程看伤害 | URL 带 `?import_project=` |
| 嵌入报告页 / 对比页             | iframe 载入               |
| 宿主传工程、改配置、取回结果    | `postMessage` 协议        |

路由：`/fast-calc`

## 打开方式

### URL 导入工程

```text
https://<工具箱地址>/fast-calc?import_project=<工程 JSON 的 URL>
```

`import_project` 必须可直接 `fetch`，返回值两种：

| 格式                               | 说明             |
| ---------------------------------- | ---------------- |
| `{ version, exportedAt, project }` | 工具箱导出的信封 |
| `{ team, phases, ... }`            | 直接一个工程对象 |

页面加载后自动读 `analysis.timings` 切分时段；无记点时按参考线名称解析；无可切分时段退化为「全部」总表。

### iframe 通过 postMessage 载入

工程已在宿主内存时，不带 `import_project` 直接开 `/fast-calc`，等页面发 `fast-calc:ready` 后：

```js
frame.contentWindow.postMessage({ type: 'fast-calc:load', project }, '*')
```

`project` 可为工程对象、JSON 字符串，或信封 `{ version, project }`。

## 数据来源

角色 / 武器 / 声骸基础数据按序获取：

| 优先 | 来源                                                               |
| ---- | ------------------------------------------------------------------ |
| 1    | URL `?api_base=<地址>`，或宿主注入 `window.__FAST_CALC_API_BASE__` |
| 2    | 同源探测 `/api/v1/version/latest`                                  |
| 3    | 失败回退 `https://wuwa-afyg-tool.200503.xyz`                       |

公开信息接口已允许跨域。既无同源 `/api` 又访问不了主站时，页面明确提示「角色数据加载失败」，不显示 0。

## 界面使用

### 角色编辑

每角色一组表格：

| 项       | 规则                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| 共鸣链   | 0–6 单选，黑框 tab                                                                  |
| 武器精炼 | 0–5 单选                                                                            |
| 声骸     | 5 槽位，宽屏两列；主词条按 cost 给可选池、副主词条按 cost 推导只读、副词条固定 5 槽 |

副词条槽：空槽选「未设置」，选择后写入；已有槽可改类型、改数值、删除。

词条规则：

| 规则                   | 说明       |
| ---------------------- | ---------- |
| 同一件声骸不重复词条   | —          |
| 最多 5 条              | —          |
| 主词条属该 cost 合法池 | —          |
| 修改后立即重算         | 不刷新页面 |

### 敌怪配置

| 项       | 规则                                                                     |
| -------- | ------------------------------------------------------------------------ |
| 类型     | BOSS / 精英怪 / 小怪，单选                                               |
| 属性     | 等级、防御、减伤%、七种元素抗性，同一行多个输入框                        |
| 防御联动 | 改等级按 `792 + 8 × 等级` 同步防御；防御可手填，但下次改等级会被重新覆盖 |

### 结果表

每时段一张表，列顺序：

```text
来源 | 条目 | 倍率 | 命中 | 各乘区… | 期望伤害 | 暴击伤害 | 不暴击伤害 | 操作
```

| 项         | 说明                                                                           |
| ---------- | ------------------------------------------------------------------------------ |
| 条目列     | 只显示条目名；技能类型、伤害类型 UI 隐藏，可用 `fast-calc:detail` 查询         |
| 乘区列     | 由引擎 `multiplierZones` 动态生成，引擎新增乘区自动出现                        |
| 乘区单元格 | 可输入乘数；按「新值/原值」等比缩放本行：三个伤害列、所在时段总伤/DPS 同步变   |
| 手工改动   | 红字红框，三个伤害列也变红                                                     |
| 操作列     | 未改动显示`溯源`；有手工乘区显示`复原`（清本行全部手工乘区，恢复引擎原始结果） |

乘区手工覆盖只存在当前页面，不写回工程；切换链 / 阶或重新导入工程会保留覆盖，「复原」后才显示新基数下的原始值。

### 溯源

点 `溯源` 开全屏 `<dialog>`，展示：基础面板（白值 / 面板值 / 面板 / 倍率 / 段数 / 基础伤害）、每个乘区及来源（基础 / 武器 / 声骸 / Buff / 敌方 / 面板，含贡献值）、复合倍率因子拆解。

## postMessage 协议

### 页面 → 宿主

| type                        | 说明                                                  |
| --------------------------- | ----------------------------------------------------- |
| `fast-calc:ready`           | 页面已挂载，可发 `fast-calc:load`                     |
| `fast-calc:project-loaded`  | 工程载入完成，`{ name }`                              |
| `fast-calc:project-updated` | 配置变化，`{ name, project }`，`project` 保持原始信封 |
| `fast-calc:result`          | 每次计算的汇总结果，见「`fast-calc:result`」          |
| `fast-calc:update-ack`      | 编辑结果，`{ target, action, ok, error? }`            |
| `fast-calc:detail`          | 详细结果（表头 + 逐条目 + 溯源），由请求触发          |
| `fast-calc:state`           | 当前可编辑状态，由请求触发                            |

### 宿主 → 页面：载入工程

```js
{
    type: ('fast-calc:load', project)
}
```

也接受纯字符串、`{ version, project }`。

### 宿主 → 页面：修改配置

统一格式：

```js
{ type: 'fast-calc:update', target, action, ... }
```

| target       | action                      | 额外字段                                                                                                              |
| ------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `chain`      | 固定 `set`                  | `index`（角色序号 0 起）、`value`（0–6）                                                                              |
| `refinement` | 固定 `set`                  | `index`、`value`（0–5）                                                                                               |
| `mainStat`   | `set` / `remove`            | `charIndex`、`slotIndex`、`set` 时 `label`；`remove` 可省 label                                                       |
| `substat`    | `add` / `update` / `remove` | `charIndex`、`slotIndex`；`add` 可带 `label`/`value`；`update` 带 `index` + 可选 `label`/`value`；`remove` 带 `index` |
| `enemy`      | 固定 `set`                  | `patch`：`type`/`level`/`defense`/`dmgReduction`/`resistances`                                                        |
| `timing`     | `add` / `update` / `remove` | `refLineId`，`add`/`update` 带 `seconds`（数字或 `null`）                                                             |

约束：链 / 阶 / 敌怪类型只有 set；主词条 set / remove；副词条 add / update / remove（最多 5 条、同槽不重复）；记点增删改且 `refLineId` 必须已存在；`enemy.patch.level` 存在时防御按等级公式强制同步。

```js
frame.contentWindow.postMessage({ type: 'fast-calc:update', target: 'chain', index: 0, value: 6 }, '*')
frame.contentWindow.postMessage(
    {
        type: 'fast-calc:update',
        target: 'substat',
        charIndex: 0,
        slotIndex: 0,
        action: 'add',
        label: '暴击率',
        value: 8.1
    },
    '*'
)
frame.contentWindow.postMessage(
    { type: 'fast-calc:update', target: 'enemy', action: 'set', patch: { level: 100 } },
    '*'
)
```

### 宿主 → 页面：查询详细结果

```js
{ type: 'fast-calc:request-detail', requestId: '任意关联 id' }
```

返回 `fast-calc:detail`：

```json
{
    "type": "fast-calc:detail",
    "requestId": "任意关联 id",
    "ok": true,
    "project": { "name": "工程名" },
    "headers": {
        "base": ["来源", "条目", "倍率", "命中"],
        "zones": ["加深区", "增伤区"],
        "damage": ["期望伤害", "暴击伤害", "不暴击伤害"],
        "columns": ["来源", "条目", "倍率", "命中", "加深区", "增伤区", "期望伤害", "暴击伤害", "不暴击伤害"]
    },
    "total": 123456,
    "duration": 25,
    "computeMs": 3.2,
    "segments": [
        {
            "key": "end",
            "time": "0.0s — 25.0s",
            "start": 0,
            "end": 25,
            "total": 123456,
            "dps": 4938,
            "seconds": 25,
            "entries": [
                {
                    "id": "…",
                    "blockId": "…",
                    "character": "角色名",
                    "name": "条目名",
                    "skillType": "共鸣解放",
                    "damageTypes": ["共鸣解放伤害"],
                    "element": "衍射",
                    "ratio": 19.89,
                    "hits": 5,
                    "expected": 1234,
                    "crit": 2000,
                    "nonCrit": 1000,
                    "damage": 6170,
                    "fixed": false,
                    "zones": [{ "label": "增伤区", "value": 1.2, "detail": "(1 + 20.0%)" }],
                    "trace": {
                        "baseLabel": "攻击",
                        "baseWhite": 1000,
                        "baseGreen": 350,
                        "totalStat": 1350,
                        "ratioPct": 19.89,
                        "hits": 5,
                        "baseValue": 1342.575,
                        "segments": [
                            {
                                "label": "增伤区",
                                "value": 1.2,
                                "detail": "(1 + 20.0%)",
                                "parts": [
                                    {
                                        "sourceType": "buff",
                                        "source": "某个 Buff",
                                        "label": "增伤",
                                        "value": 20,
                                        "unit": "%",
                                        "contribution": 20
                                    }
                                ]
                            }
                        ],
                        "factors": []
                    }
                }
            ]
        }
    ]
}
```

`trace` 字段：

| 组   | 字段                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| 基值 | `baseUnit` / `baseLabel` / `isCoeff` / `baseWhite` / `baseGreen` / `totalStat`                                           |
| 倍率 | `ratioPct` / `extraRatioPct` / `hits` / `baseValue` / `baseParts`                                                        |
| 乘区 | `segments[]`：`label`/`value`/`detail`/`parts[]`；`parts[]`：`sourceType`/`source`/`label`/`value`/`unit`/`contribution` |
| 暴击 | `canCrit` / `preCrit` / `crit` / `nonCrit` / `expected` / `perHit`                                                       |
| 因子 | `factors[]`：倍率因子占比与分摊伤害                                                                                      |

### 宿主 → 页面：查询当前状态

```js
{ type: 'fast-calc:request-state', requestId: '任意关联 id' }
```

```json
{
    "type": "fast-calc:state",
    "ok": true,
    "project": { "name": "工程名" },
    "chains": [0, 0, 0],
    "refinements": [1, 1, 1],
    "config": { "characters": [], "enemy": {} },
    "timings": [{ "refLineId": "end", "label": "结束", "seconds": 25 }]
}
```

### `fast-calc:result`

每次重算后发送，兼容 wuwacalc-conv 报告页；同时写入 `window.__FAST_CALC_RESULT__ = payload`。

```json
{
    "type": "fast-calc:result",
    "total": 123456,
    "duration": 25,
    "computeMs": 3.2,
    "entries": [
        {
            "id": "…",
            "blockId": "…",
            "catalogId": "…",
            "character": "角色名",
            "name": "条目名",
            "damage": 6170,
            "hits": 5,
            "fixed": false,
            "zones": {
                "baseMult": 0.9945,
                "dmgBonus": 1.2,
                "deepen": 1.25,
                "vulnerability": 1,
                "resistance": 0.9,
                "defense": 0.5,
                "critRate": 80,
                "critDmg": 160,
                "critExpect": 1.48,
                "multBoost": 1,
                "multAdd": 0,
                "attack": 1350,
                "hp": 0,
                "def": 0
            }
        }
    ],
    "segments": []
}
```

## 行为与限制

| 项             | 说明                                                                            |
| -------------- | ------------------------------------------------------------------------------- |
| 工程来源       | 只支持 `?import_project` 或 `fast-calc:load`，不支持手动选文件 / 拖拽（在线版） |
| 手工乘区覆盖   | 只影响当前页面与 `fast-calc:result`，不写进 `project-updated`                   |
| 配置修改       | 链 / 阶、词条、敌怪、记点进入 `project-updated`                                 |
| 类型列         | 页面不列技能类型 / 伤害类型，需要时用 `fast-calc:request-detail`                |
| 离线单文件     | 无；数据仍来自 `/api` 或主站回退。独立静态包（`package:standalone`）里 `/api/v1 | v3/*`由浏览器就地解析，无需`api_base` |
| iframe sandbox | 必须允许脚本；无同源时数据接口走绝对地址 + CORS                                 |

## 常见问题

| 症状                | 原因 / 排查                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 伤害全是 0          | 角色信息接口不可达会提示「角色数据加载失败」，不静默算 0。查：浏览器/iframe 能否访问 `/api/v3/info/character/<角色>`；宿主是否把 fast-calc 放在无 `/api` 的静态站；必要时 URL 加 `?api_base=https://wuwa-afyg-tool.200503.xyz` |
| 表格没有数据        | 工程无可用参考线计时，表头退化为「全部」总表；连条目都没有则检查时间线是否有伤害块                                                                                                                                             |
| 链 / 阶改了没有变化 | 链 / 阶只影响带对应条件的 Buff；工程无链 / 阶条件 Buff 时数值不变，属正常                                                                                                                                                      |
