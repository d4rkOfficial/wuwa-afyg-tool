# 上游数据源接入工作流程

本文档描述如何为 wuwa-afyg-tool 接入新的上游数据源（如 nanoka.cc 之外的其他鸣潮数据库），以及接入前必须满足的数据质量验收标准。

## 架构概览

应用对上游的唯一抽象是 `DataProvider` 接口（`src/lib/api/provider/types.ts`）。任何上游只需：

1. 实现 `DataProvider` 的全部方法；
2. 把自己的原始数据抓取并转换为语义一致的规范化契约类型（`$lib/api/types`）；
3. 在 `src/lib/api/provider/index.ts` 的 `REGISTRY` 中注册（`{ id, label, create }`）。

其余代码（路由、组件、AI 工具）只依赖该接口，不感知具体上游。

当前生产上游：**nanoka**（`src/lib/api/provider/nanoka/`）。接口方法见下：

| 方法                                                                                | 说明                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------- |
| `getLatestVersion()` / `getAvailableVersions()`                                     | 版本信息                                  |
| `getCharacterList()` / `getWeaponList()` / `getEchoList()` / `getEchoSetList()`     | 列表                                      |
| `getCharacterIcons()` / `getWeaponIcons()` / `getEchoIcons()` / `getEchoSetIcons()` | 名称 → 可渲染图片 URL                     |
| `getCharacterInfo(name, opts?)`                                                     | 角色详情（`opts.rich=true` 时保留富文本） |
| `getWeaponInfo(name)` / `getEchoInfo(name)` / `getEchoSetInfo(name)`                | 其他详情                                  |

## 接入步骤

1. **新建适配器目录** `src/lib/api/provider/{id}/`，包含：
    - `types.ts` — 上游原始数据类型（仅适配器内部使用）；
    - `fetch.ts` — 抓取与版本解析；
    - `utils.ts` — 原始数据 → 规范化契约的纯转换函数（必须可单测）；
    - `index.ts` — 实现 `DataProvider` 的适配器对象；
    - `__fixtures__.ts` — **真实结构**的样本数据（从上游真实响应摘取，不得编造字段）。

2. **实现并注册**：在 `src/lib/api/provider/index.ts` 的 `REGISTRY` 追加 `{ id, label, create }`。

3. **编写测试**：
    - `{id}/utils.test.ts` — 纯转换函数单测；
    - `{id}.provider.test.ts` — mock fetch 驱动适配器方法 + `runContractTests(provider)` 共享契约套件（`contract-test.ts`）；
    - 追加到 `scripts/test/run-provider-tests.ts` 聚合入口。

4. **运行检查**：`pnpm test`（node:test 单进程聚合）、`pnpm run format`、`pnpm run check`。

## 数据质量验收标准（重要）

**结果对等性测试是接入门槛，不是可选项。** 应用 UI（速查弹窗、直伤倍率表）消费的字段必须与 nanoka 逐字段一致。做法：

- 抓取新上游与 nanoka 的**同一份真实原始数据**（同一角色/武器/声骸）；
- 分别跑各自的转换函数，断言 UI 核心字段深等（`src/lib/api/provider/parity/` 曾存放此类测试，字段剔除规则见历史记录）；
- 上游文案存在文本差异时报告但不判失败，数据字段差异必须判失败。

**已有上游被拒的真实原因（wuther.in，2025 年评估后移除）：**

| 检查项                                            | 结果                                                            |
| ------------------------------------------------- | --------------------------------------------------------------- |
| 角色核心数据（倍率/元素/能量/偏谐）与 nanoka 一致 | ✅                                                              |
| 声骸技能描述数值插值                              | ✅                                                              |
| 声骸套装件数（`sets[].pieces`）                   | ❌ 3.3.0 起被上游清空，需从 FetterType 推导且存在特例（1 件套） |
| 声骸套装效果文本（`SetEffects` / `Group[].Set`）  | ❌ 全量扫描 223 个声骸详情全部为空                              |
| 角色描述文本一致性                                | ⚠️ 存在文本差异（如「施放普攻·克敌」vs「施放普攻第6段」）       |

**因此接入新上游前至少核对：**

1. 角色技能树原始数据是否含逐 hit 的 `Damage` 字典（元素/倍率/能量/偏谐），能否推出与 nanoka 完全一致的 `values`；
2. 声骸详情是否含 `Param`（每级一行）且描述占位符可插值；
3. 声骸套装是否下发件数（`pieces`）与效果文本（`SetEffects`/`Set`）——**缺失即视为数据质量不合格**，不允许靠推导规则补（推导规则无法覆盖 1 件套等特例）；
4. 图标 URL 是否可直接渲染（真实网络验证 200 + 正确 Content-Type）；
5. 版本解析是否稳定（主页/清单可解析出版本号）。

若上述任一项为 ❌，该上游不得进入生产 `REGISTRY`。
