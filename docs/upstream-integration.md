# 上游数据源接入

应用对上游的唯一抽象是 `DataProvider`（[`src/lib/api/provider/types.ts`](../src/lib/api/provider/types.ts)）。新增上游实现该接口并注册，路由 / 组件 / AI 工具只依赖接口，不感知具体上游。

当前生产上游：**nanoka**（[`src/lib/api/provider/nanoka/`](../src/lib/api/provider/nanoka)）。

## 接口方法

| 方法                                                                                | 返回                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------- |
| `getLatestVersion()` / `getAvailableVersions()`                                     | 版本信息                                |
| `getCharacterList()` / `getWeaponList()` / `getEchoList()` / `getEchoSetList()`     | 列表                                    |
| `getCharacterIcons()` / `getWeaponIcons()` / `getEchoIcons()` / `getEchoSetIcons()` | 名称 → 可渲染图片 URL                   |
| `getCharacterInfo(name, opts?)`                                                     | 角色详情（`opts.rich=true` 保留富文本） |
| `getWeaponInfo(name)` / `getEchoInfo(name)` / `getEchoSetInfo(name)`                | 其他详情                                |

## 接入步骤

| 步  | 落点                                                                              | 内容                                               |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | `src/lib/api/provider/{id}/`                                                      | 建适配器目录，文件分工见下表                       |
| 2   | [`src/lib/api/provider/index.ts`](../src/lib/api/provider/index.ts) 的 `REGISTRY` | 追加 `{ id, label, create }`                       |
| 3   | `test/src/lib/api/provider/{id}/`                                                 | 编写测试，见「测试」                               |
| 4   | 命令行                                                                            | `pnpm test` → `pnpm run format` → `pnpm run check` |

适配器目录文件分工：

| 文件              | 职责                                                 |
| ----------------- | ---------------------------------------------------- |
| `types.ts`        | 上游原始数据类型（仅适配器内部）                     |
| `fetch.ts`        | 抓取与版本解析                                       |
| `utils.ts`        | 原始数据 → 规范化契约的纯转换函数（**必须可单测**）  |
| `index.ts`        | 实现 `DataProvider` 的适配器对象                     |
| `__fixtures__.ts` | **真实结构**样本（从上游真实响应摘取，不得编造字段） |

## 测试

测试镜像源码路径放仓库根 `test/`（见 AGENTS §4 / §5.2），无需登记：[`test/run-tests.ts`](../test/run-tests.ts) 自动发现 `test/**/*.test.ts`。

| 文件                                              | 覆盖                                                     |
| ------------------------------------------------- | -------------------------------------------------------- |
| `test/src/lib/api/provider/{id}/utils.test.ts`    | 纯转换函数                                               |
| `test/src/lib/api/provider/{id}.provider.test.ts` | mock fetch 驱动适配器方法 + `runContractTests(provider)` |

共享契约夹具：[`test/src/lib/api/provider/contract-test.ts`](../test/src/lib/api/provider/contract-test.ts)。目标路径用 [`test/paths.ts`](../test/paths.ts) 的 `testPathOf()` 推导。

## 数据质量验收

结果对等性测试是**接入门槛**。UI（速查弹窗、直伤倍率表）消费的字段必须与 nanoka 逐字段一致：

| 步  | 做法                                                                   |
| --- | ---------------------------------------------------------------------- |
| 1   | 抓取新上游与 nanoka 的**同一份真实原始数据**（同一角色 / 武器 / 声骸） |
| 2   | 各自跑转换函数，断言 UI 核心字段深等（只比对 UI 消费字段）             |
| 3   | 文案差异报告但不判失败；数据字段差异判失败                             |

### 已拒上游实例：wuther.in（2025 年评估后移除）

| 检查项                                            | 结果                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| 角色核心数据（倍率/元素/能量/偏谐）与 nanoka 一致 | 一致                                                              |
| 声骸技能描述数值插值                              | 一致                                                              |
| 声骸套装件数（`sets[].pieces`）                   | 不合格：3.3.0 起被上游清空，需从 FetterType 推导且存在 1 件套特例 |
| 声骸套装效果文本（`SetEffects` / `Group[].Set`）  | 不合格：全量扫描 223 个声骸详情全部为空                           |
| 角色描述文本一致性                                | 差异（如「施放普攻·克敌」vs「施放普攻第6段」）                    |

### 接入前核对清单

| #   | 核对项                                                                                                    | 判定                                       |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | 角色技能树原始数据含逐 hit 的 `Damage` 字典（元素/倍率/能量/偏谐），能否推出与 nanoka 完全一致的 `values` | 不通过：不得进入生产                       |
| 2   | 声骸详情含 `Param`（每级一行）且描述占位符可插值                                                          | 不通过：不得进入生产                       |
| 3   | 声骸套装下发件数 `pieces` 与效果文本 `SetEffects`/`Set`                                                   | 不通过：数据质量不合格，不允许靠推导规则补 |
| 4   | 图标 URL 可直接渲染（真实网络验证 200 + 正确 Content-Type）                                               | 不通过：不得进入生产                       |
| 5   | 版本解析稳定（主页/清单可解析出版本号）                                                                   | 不通过：不得进入生产                       |

任一项不通过，该上游不得进入生产 `REGISTRY`。
