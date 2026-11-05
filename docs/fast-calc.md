# fast-calc 简表

`fast-calc` 是一个独立的快速计算页：导入一个椰果工程 JSON，直接查看逐时段伤害表，并在同一页修改链接 / 精炼、声骸主副词条和敌怪配置。

它不依赖工具箱主界面的排轴、拉表页面，适合：

- 从工坊 / 分享链接直接打开一个工程快速看伤害；
- 作为 iframe 嵌入报告页、对比页；
- 由宿主通过 `postMessage` 传入工程、修改配置、取回计算结果。

路由：

```text
/fast-calc
```

---

## 1. 打开方式

### 1.1 URL 导入工程

```text
https://<工具箱地址>/fast-calc?import_project=<工程 JSON 的 URL>
```

`import_project` 必须是可直接 `fetch` 的地址，返回值可以是：

- 工具箱导出的信封：`{ version, exportedAt, project }`
- 直接一个工程对象：`{ team, phases, ... }`

页面加载后会自动读取 `analysis.timings` 切分时段；工程没有记点时，按参考线名称自动解析。没有可切分时段时，会退化成一张「全部」总表。

### 1.2 iframe 宿主通过 postMessage 载入

如果工程已经在宿主内存里，可以不带 `import_project`，直接打开 `/fast-calc`，等页面发出 `fast-calc:ready` 后发送：

```js
frame.contentWindow.postMessage({ type: 'fast-calc:load', project }, '*')
```

`project` 可以是工程对象，也可以是 JSON 字符串。旧格式 `{ version, project }` 也兼容。

---

## 2. 数据来源

fast-calc 需要角色 / 武器 / 声骸基础数据，按以下顺序获取：

1. URL 参数 `?api_base=<地址>`，或宿主注入 `window.__FAST_CALC_API_BASE__`；
2. 同源探测 `/api/v1/version/latest`；
3. 探测失败时自动回退到 `https://wuwa-afyg-tool.200503.xyz`。

公开信息接口已允许跨域读取。如果宿主环境既没有同源 `/api`、也无法访问主站，页面会明确提示「角色数据加载失败」，而不是显示 0。

---

## 3. 界面使用

### 3.1 角色编辑

每个角色一组表格：

- **共鸣链**：0–6 单选，黑框 tab；
- **武器精炼**：0–5 单选；
- **声骸**：5 个槽位，宽屏两列排布；
    - 主词条：按声骸 cost 给出可选池；
    - 副主词条：按 cost 自动推导，只读；
    - 副词条：固定 5 个槽位。空槽选「未设置」，选择后写入；已有槽位可改类型、改数值、删除。

词条规则：

- 同一件声骸不能重复词条；
- 最多 5 条；
- 主词条必须属于该 cost 的合法池；
- 修改后立即重算，不刷新页面。

### 3.2 敌怪配置

- 类型：BOSS / 精英怪 / 小怪，单选；
- 属性：等级、防御、减伤%、七种元素抗性，同一行多个输入框；
- **防御随等级联动**：修改等级会按 `792 + 8 × 等级` 同步防御；防御也可以手动填写，但下一次改等级会被重新覆盖。

### 3.3 结果表

每个时段一张表，列顺序：

```text
来源 | 条目 | 倍率 | 命中 | 各乘区… | 期望伤害 | 暴击伤害 | 不暴击伤害 | 操作
```

- 条目列只显示条目名；技能类型、伤害类型在 UI 中隐藏，但可通过 `fast-calc:detail` 查询；
- 乘区列由引擎返回的 `multiplierZones` 动态生成，引擎新增乘区会自动出现；
- 乘区单元格可以直接输入乘数，修改后按「新值 / 原值」等比缩放本行：
    - 三个伤害列同步变化；
    - 所在时段总伤 / DPS 同步变化；
- 手工改过的乘区显示红字红框，三个伤害列也变红；
- 操作列：
    - 未改动：`溯源`
    - 本行有手工乘区：`复原`，点击清除本行全部手工乘区，恢复引擎原始结果。

乘区手工覆盖只存在于当前页面，不写回工程；切换链 / 阶或重新导入工程会保留覆盖，但「复原」之后才会显示新基数下的原始值。

### 3.4 溯源

点击 `溯源` 打开全屏 `<dialog>`，展示：

- 基础面板：白值 / 绿值 / 面板 / 倍率 / 段数 / 基础伤害；
- 每个乘区及来源（基础 / 武器 / 声骸 / Buff / 敌方 / 面板），包括来源贡献值；
- 复合倍率因子拆解（多因子时）。

---

## 4. postMessage 协议

### 4.1 页面 → 宿主

| type                        | 说明                                                      |
| --------------------------- | --------------------------------------------------------- |
| `fast-calc:ready`           | 页面已挂载，可以发送 `fast-calc:load`                     |
| `fast-calc:project-loaded`  | 工程载入完成，`{ name }`                                  |
| `fast-calc:project-updated` | 工程配置变化，`{ name, project }`，`project` 保持原始信封 |
| `fast-calc:result`          | 每次计算的汇总结果，字段见 §4.3                           |
| `fast-calc:update-ack`      | 编辑结果，`{ target, action, ok, error? }`                |
| `fast-calc:detail`          | 详细结果（表头 + 逐条目 + 溯源），由请求触发              |
| `fast-calc:state`           | 当前可编辑状态，由请求触发                                |

### 4.2 宿主 → 页面

#### 载入工程

```js
{
    type: ('fast-calc:load', project)
}
```

也接受纯字符串、`{ version, project }`。

#### 修改配置

统一使用：

```js
{ type: 'fast-calc:update', target, action, ... }
```

| target       | action                      | 额外字段                                                                                                                 |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `chain`      | 固定 `set`                  | `index`（角色序号，0 起）、`value`（0–6）                                                                                |
| `refinement` | 固定 `set`                  | `index`、`value`（0–5）                                                                                                  |
| `mainStat`   | `set` / `remove`            | `charIndex`、`slotIndex`、`set` 时 `label`；`remove` 可省略 label                                                        |
| `substat`    | `add` / `update` / `remove` | `charIndex`、`slotIndex`；`add` 可带 `label` / `value`；`update` 带 `index`、可选 `label` / `value`；`remove` 带 `index` |
| `enemy`      | 固定 `set`                  | `patch`：`type` / `level` / `defense` / `dmgReduction` / `resistances`                                                   |
| `timing`     | `add` / `update` / `remove` | `refLineId`，`add` / `update` 带 `seconds`（数字或 `null`）                                                              |

说明：

- 链 / 阶 / 敌怪类型没有增删，只有 set；
- 主词条只支持 set / remove；
- 副词条支持 add / update / remove，最多 5 条且同槽不重复；
- 参考线记点支持增删改，`refLineId` 必须已存在于工程参考线；
- `enemy.patch.level` 存在时，防御按等级公式强制同步。

示例：

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

#### 查询详细结果

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

`trace` 的完整字段：

- `baseUnit` / `baseLabel` / `isCoeff`
- `baseWhite` / `baseGreen` / `totalStat`
- `ratioPct` / `extraRatioPct` / `hits` / `baseValue`
- `baseParts`
- `segments[]`：`label` / `value` / `detail` / `parts[]`
- `parts[]`：`sourceType` / `source` / `label` / `value` / `unit` / `contribution`
- `canCrit` / `preCrit` / `crit` / `nonCrit` / `expected` / `perHit`
- `factors[]`：倍率因子占比与分摊伤害

#### 查询当前状态

```js
{ type: 'fast-calc:request-state', requestId: '任意关联 id' }
```

返回 `fast-calc:state`：

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

### 4.3 `fast-calc:result`

每次重算后发送，兼容 wuwacalc-conv 报告页：

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

同时会写入：

```js
window.__FAST_CALC_RESULT__ = payload
```

---

## 5. 行为与限制

- 页面只支持 `?import_project` 或 `fast-calc:load`，不支持手动选文件 / 拖拽工程（在线版）；
- 手工乘区覆盖只影响当前页面与 `fast-calc:result`，不写入 `project-updated`；
- 链 / 阶、词条、敌怪、记点的修改都会进入 `fast-calc:project-updated`；
- 页面不列出技能类型和伤害类型，需要时用 `fast-calc:request-detail` 取；
- 当前没有离线单文件版本：数据仍来自 `/api` 或主站回退；不过在「无服务端独立静态包」
  （`pnpm run package:standalone`，见 [deployment.md](deployment.md)）里，`/api/v1|v3/*`
  由浏览器就地解析（直接读上游），fast-calc 不需要 `api_base` 也能出数据；
- iframe 的 `sandbox` 必须允许脚本；若没有同源，数据接口会走绝对地址 + CORS。

---

## 6. 常见问题

**伤害全是 0**

页面会先尝试加载角色属性。若角色信息接口不可达，会直接显示「角色数据加载失败：角色名」，不会静默算 0。检查：

- 浏览器 / iframe 是否能访问 `/api/v3/info/character/<角色>`；
- 宿主是否把 fast-calc 放在没有 `/api` 的静态站；
- 必要时给 URL 加 `?api_base=https://wuwa-afyg-tool.200503.xyz`。

**表格没有数据**

工程没有可用的参考线计时。表头会退化成一张「全部」总表；如果连条目都没有，检查工程时间线里是否有伤害块。

**链 / 阶改了没有变化**

链 / 阶只影响带对应条件的 Buff。若工程里没有链 / 阶条件 Buff，数值不会变化，这是正常的。
