# AGENTS.md — AI 辅助开发规则

## 1. 代码风格

| 项       | 规则                                                                      |
| -------- | ------------------------------------------------------------------------- |
| 拆分     | 能拆 snippet（复用部件）与纯函数（无副作用成分）的必拆                    |
| 函数     | 优先 `const fn = () => {}`；事件处理函数、SvelteKit `load`/`actions` 例外 |
| 布局     | 优先 flex                                                                 |
| CSS 注释 | 不写 glob / `*/`（提前终止注释）                                          |
| 注释     | 后端 `/** @desc [markdown] */`；前端不限                                  |

## 2. 页面逻辑分离

| 项    | 规则                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| props | `let props: Props = $props()` + `interface Props {}`；可解构 `let { class, style }: Props = $props()`，须扩展 `ComponentsProps` |
| 顺序  | `+page.svelte`：`<script>` → HTML → `{#snippet}` → `<style>`                                                                    |
| 归属  | 路由级类型/常量/工具/store → 路由文件夹 `types.ts`/`consts.ts`/`utils.ts`/`store.svelte.ts`；跨路由复用 → `$lib/{模块名}/`      |
| 状态  | localStorage → `src/lib/data/{状态集名}.svelte.ts`                                                                              |

## 3. 组件约束

| 项      | 规则                                                                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 结构    | 页内重复 → `{#snippet}`；大布局 → 独立组件                                                                                                     |
| Props   | `interface Props extends ComponentsProps {}`，暴露 `style`/`class`；store 驱动单例豁免，新增在 `check-components.mjs` 的 `EXEMPT.noProps` 登记 |
| 命名    | handler：单词 `onclose`，多词 `onCreateBuff`；AI 会话 `onEvent` 等例外                                                                         |
| 样式    | TailwindCSS；无外部 UI 库（`@iconify/svelte` 除外）                                                                                            |
| snippet | 闭包读父作用域响应式状态；循环项传参属必要                                                                                                     |
| 复用    | 先查 `ui/`；缺失补 `ui/`，不就地内联                                                                                                           |
| 合并    | `$lib/utils/component-style.ts`：`mergeComponentsStyle`/`joinStyle`/`mergeClass`；≠ `types/component-props.ts`                                 |

主题与表面：

| 项      | 规则                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 主题    | `$lib/theme`；`--theme-{key}-{prop}`；`bg-(--theme-x-bg)` 简写（非 `bg-[var(...)]`），禁直接 import store                                                                                  |
| 表面    | `data-sf="<key>"`（card/modal/sidebar/content/toolbar/widget）；`data-sf-flat` 仅底色；`data-sf-under="<key>"` 垫底；`th`/`td` 加 `data-sf-layer`；`--sf-base` 覆盖；`check:surfaces` 校验 |
| 降级    | 无 `backdrop-filter` → `data-blur="off"` + 抬不透明度（`theme.svelte.ts`），组件不重复探测                                                                                                 |
| z-index | 仅 `--z-*` 阶梯                                                                                                                                                                            |

弹窗：

| 项   | 规则                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------- |
| 实现 | 仅 `layout/modal.svelte`；`layer`（modal/nested/deep → `--z-*`），禁裸 `z-\d+`                    |
| 落点 | `class`/`style` 落面板；`{#snippet title()}`、`{#snippet footer()}`；尺寸经 `class` 透传          |
| 交互 | 自处 Esc → `escapable={false}`；拦页面快捷键 → `blockPageShortcuts`；外壳 Esc `stopPropagation()` |
| 闸门 | `check-components.mjs` ③ 拦截手搓 backdrop                                                        |

## 4. 文件组织

| 项   | 规则                                                  |
| ---- | ----------------------------------------------------- |
| 目录 | `ui/` 通用 · `layout/` 布局 · `page/{路由名}/` 页面级 |
| 路径 | 禁一级以上相对路径；多级就重构到 `lib/`               |
| 测试 | 见 §5.2                                               |

## 5. 完成检查

| 序  | 命令                             |
| --- | -------------------------------- |
| 1   | `pnpm run format`                |
| 2   | `pnpm run lint:eslint`（零错误） |
| 3   | `pnpm run check`                 |

纯逻辑改动（`calc/` `utils/` `data/` 等）跑 `pnpm test`。

环境：目录 ACL 受限（EPERM），不为此改部署配置。

| 场景        | 规则                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| format/lint | 显式路径 `"src" "test" "docs" "scripts" "*.{js,mjs,cjs,ts,json,md}"`，非 `prettier .`                                                                                            |
| build       | 仓库根失败 → `.tmp/build-verify.ps1`（隔离副本 + junction 复用 `node_modules` + 产物 CSS 探针）                                                                                  |
| CJK         | 行数用 Node/read/ripgrep，非 `Get-Content`；内容用 read，非 `Get-Content`/`Select-String`；落盘用 `writeFileSync(p,s,'utf8')`（PS `>` 默认 UTF-16LE）；`.ps1` 编辑后补 UTF-8 BOM |

### 5.1 ESLint

配置 `eslint.config.js`（flat config）。

| 层       | 范围                                                                                                                          | 规则                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 纯逻辑   | `src/lib` 下 `calc/` `api/` `utils/` `consts/` `types/` `ai/generate/` `ai/tools/` 的 `.ts`（排除 `*.svelte.ts`/`*.test.ts`） | `prefer-const` `prefer-arrow-callback` `prefer-template` `object-shorthand` `arrow-body-style` `no-var` `no-param-reassign` |
| UI/store | `*.svelte`、`*.svelte.ts`                                                                                                     | 基础解析，不加强制函数式                                                                                                    |

Svelte 棘轮：

| 项         | 规则                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `each` key | `require-each-key`=error，基线 0；key 唯一，证不出用索引（对真实数据采样去重）                                           |
| 一致性     | `check-components.mjs`+`check-surfaces.mjs` 入 `check`；`ui/` 元件须有消费方，零引用基线 `BASELINE.uiNoRef` 只减不增不删 |
| 动效       | `check-motion.mjs`：`--motion-*`=`MOTION_MS`；指令只挂元素；内联时长基线 0，走 `$lib/utils/motion.ts`                    |
| 组件文档   | `.tmp/components.md` 生成物，改 `ui/` 后 `pnpm run generate-components-doc`；`check --check` 比对；不入 `docs/`          |

### 5.2 测试

| 项     | 规则                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 布局   | `test/` 镜像 `src/`，替身 `test/__mocks__/`；`testPathOf()` 定位                                                                           |
| 入口   | `test/run-tests.ts` 自动发现 `*.test.ts`，逐文件隔离 `import`（禁子进程，不用 `node --test`）                                              |
| 失败   | 逐文件 `try/catch` → `[test] ✖ 加载失败：<文件>`，退出码 1                                                                                 |
| 脚手架 | `.tmp/` 单文件覆盖，不建子目录再删；改后对比 `tests` 计数；不用 `mem:` scheme                                                              |
| 命令   | `pnpm test` / `test calc` / `test:list` / `test:watch`；单文件 `node --import ./test/preload-runes.mjs --import ./test/preload.mjs <file>` |
| 别名   | `$lib`→`src/lib`、`$src`→`src`；`svelte.config.js` 与 `test/preload.mjs` 同步                                                              |
| 例外   | 联网/上游文案用 `.ts`（非 `*.test.ts`），如 `test/damage-type-infer.<角色>.ts`                                                             |
| 检查   | `test/` 吃 `format`/`lint:eslint`/`svelte-check`                                                                                           |

## 6. 文档与注释风格

写 `docs/`、`README.md`、注释、测试标题时严格遵循：

| 项   | 要求                                                            |
| ---- | --------------------------------------------------------------- |
| 段落 | 拆小段，每段一事，求精简                                        |
| 结构 | 表格优先于列表                                                  |
| 表达 | 多真实代码，少比喻                                              |
| 时态 | 只写当前状态；不写“不再/原先/旧版/已废弃/实测/已经”等提旧事的词 |
| 用词 | 少用“口径”，改“适用范围”；不写红线/踩坑叙述                     |
| 符号 | 禁用 emoji                                                      |
| 事实 | 代码、数字、结论取自源码，不编造                                |
