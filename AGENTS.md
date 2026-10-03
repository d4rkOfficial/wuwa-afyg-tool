# AGENTS.md — AI 辅助开发规则

## 1. 代码风格

- 能拆成 snippet（复用部件） 和纯函数（复杂功能里的无副作用成分）的，必须拆
- 优先使用箭头函数（`const fn = () => { ... }`），非 `function` 声明
    - 例外：事件处理函数（`onWindowMouseDown` 等）、SvelteKit 要求的 `load`/`actions` 函数可以保留 `function` 声明
- 优先flex布局
- **CSS 注释里不要写 glob、不要出现 `*/`**：`**/*.svelte` 里的 `*/` 会**提前终止注释**，后半段变成 CSS 垃圾 token；
  prettier 只按自己的格式重排（不报错），`check-scrollbar`/`check-components` 等静态检查器也全都看不见（实测踩过：
  `layout.css` 从 700 行被"格式化"到 773 行）。改完 CSS 后建议用浏览器把整文件解析回来核对规则条数。
- 后端注释使用/** @desc [markdown] */形式，前端则不用遵守

## 2. 页面逻辑分离

- `let props: Props = $props(); interface Props {}` 而不是 `let props: {...} = $props()`
    - 允许直接解构形式 `let { class, style }: Props = $props()`，但必须扩展 `ComponentsProps`
- `+page.svelte` 内必须按此顺序：`<script>` → main HTML（`{#if}`/`{#each}`/`<div>` 等）→ `{#snippet}` → `<style>`
- `+page.svelte` 的路由类型、常量、工具函数、store 必须放在路由文件夹下的 `types.ts` `consts.ts` `utils.ts` `store.svelte.ts`，不能放在 `$lib/` 下
- 只有跨路由复用的类型、常量、工具函数才放到 `$lib/{模块名}/` 下
- localStorage持久状态放到`src/lib/data/{状态集名}.svelte.ts`处理

## 3. 组件约束

- 重复的页内内容 → `{#snippet}` 内联在 `+page.svelte` 中
- 大的布局结构 → 独立组件
- 所有独立组件的 props 必须使用 `interface Props extends ComponentsProps {}` 声明（`ComponentsProps` 在 `$lib/types`）
- 所有独立组件必须暴露 `style` 和 `class` prop，支持外部定制，参考`src/lib/types/component-props.ts`
    - **例外：store 驱动单例**。全局只实例化一次、可见性与位置全部来自 store、调用处一律不传 props 的组件（如 `MagneticPointer`、`EnemyPanel`、`timeline-menus`、`SkillPicker`、`NonDirectPicker`、`DamageList`），加 `class`/`style` 只会造出无人使用的死 API，故豁免。新增豁免须在 `scripts/check-components.mjs` 的 `EXEMPT.noProps` 登记并注明理由
- 事件 handler prop 的命名约定（实测：单词型全小写 98 处 vs camelCase 23 处）：
    - **单词 → 全小写**：`onclose`、`onchange`、`onpick`、`onsaved`、`refresh`→`onrefresh`
    - **多词 → camelCase**：`onCreateBuff`、`onCharDetail`、`onToggleSidebarWidth`
    - 即 `onclose` ✅ / `onClose` ❌、`onCreateBuff` ✅ / `oncreatebuff` ❌
    - 注：`src/lib/ai/**` 的 `RunTurnOptions` / `ToolContext`（`onEvent`/`onMessages`/`onConfirm`）是对齐 AI 会话接口的独立命名，不属组件 prop 约定
- 尽量使用 TailwindCSS 而不是 `<style>` 样式
- 不依赖外部 UI 库，所有控件使用原生 HTML + TailwindCSS 实现
    - 允许的例外：`@iconify/svelte`（图标渲染）
- Snippet 通过闭包访问**父作用域已有的**响应式状态（`$state`/`$derived`），不要为了省事把它们当参数传进去
    - **按循环项传入的参数是必要的，不在此列**：如 `{#snippet buffRow(child, parentKey, rowPad)}` 被 12 处用不同实参渲染，改成闭包只能把 snippet 复制到每个调用点（更差）。实测现有 13 个带类型参数的 snippet 全属此类，属正确写法
- 主题托管在 `$lib/theme`，通过 CSS 自定义属性（`--theme-{key}-{prop}`）驱动；组件中使用 Tailwind v4 简写形式 `bg-(--theme-{key}-bg)` / `text-(--theme-{key}-text)`，不要直接 import theme store
    - 注意**不要**写 `bg-[var(--theme-{key}-bg)]`：实测全项目 `(--theme-*)` 简写 3512 处、方括号形式仅 4 处，简写是既定约定
- 区域质感由 `data-sf` 驱动，不要手写表面底色/毛玻璃。给元素加 `data-sf="<key>"` 即在「设置-外观主题-背景质感」中可调：
    - `key` ∈ `card` / `modal` / `sidebar` / `content` / `toolbar` / `widget`（`SurfaceKey`，见 `$lib/theme/types`）
    - 叠加 `data-sf-flat` = 只取该区域底色、不做毛玻璃（用于大量逐行/逐格元素，避免每个元素重算一次背景模糊）
    - 叠加 `data-sf-under="<key>"` = 在本区域底色之下再垫一层其它区域底色
    - 需要指定基色时用内联 `style="--sf-base: var(--theme-xxx-bg)"` 覆盖
    - 规则与变量发射见 `src/routes/layout.css` 的 `[data-sf]` 段与 `theme.svelte.ts`；`pnpm run check:surfaces` 会校验取值合法性
- 优先复用 `src/lib/components/ui/` 的既有元件，不要手搓。新增重复控件前先检查该目录；`ui/` 缺失的元件应补在 `ui/` 而不是就地内联
- `class` / `style` 的合并统一走 `$lib/utils/component-style.ts`，不要各组件重写派生块：
    - 主题配色三件套 → `mergeComponentsStyle({ backgroundImage, textColor, style: styleProp })`
    - 需要自定义片段（如头像的 `background-image`）→ `joinStyle([...])`
    - 类名片段 → `mergeClass([...])`
    - 该文件在 `utils/` 下，与 `types/component-props.ts`（`ComponentsProps` 类型定义）**不是同一个文件**，勿混

- 弹窗一律用 `layout/modal.svelte`（唯一实现），不要手写 backdrop / `fixed inset-0` / Escape / 焦点陷阱 / 背景滚动锁定；层级用 `layer`（`modal` / `nested` / `deep` → `--z-*` token），不要写裸 `z-\d+`
    - `class` / `style` 落在**面板**上（不是 backdrop）。外壳提供毛玻璃底、内边距、圆角、阴影、进出场动画、关闭按钮与标题行样式；**内容驱动的尺寸上限**（如宽表格的 `max-w-2xl`）经 `class` 透传
    - 标题用 `{#snippet title()}`（只传图标 + 文案，样式交给外壳）；底部操作栏用 `{#snippet footer()}`
    - 宿主自行处理 Esc 时传 `escapable={false}`（如时间轴上「Esc = 保存并关闭」）；需要拦住宿主页面级快捷键（Ctrl+Z / Delete）时传 `blockPageShortcuts`
    - 外壳在**自己**处理 Esc 时会 `stopPropagation()`，避免同一次 Esc 又被页面级 `window` 监听当成一次「保存并关闭」
    - `scripts/check-components.mjs` ③ 已清零为**硬闸门**：新增手搓 backdrop 立即失败（检测同时覆盖 `class="…"` 与 `class={…}` 两种写法）
- z-index 只用 `layout.css` 中的 `--z-*` token 阶梯

## 4. 文件组织

- 组件遵循最小化原则，分类存放：
    - `src/lib/components/ui/` — 通用 UI 元件（按钮、输入框、头像、Tabs 等）
    - `src/lib/components/layout/` — 布局元件（弹窗、右键菜单、通知提示等）
    - `src/lib/components/page/{路由名}/` — 页面级组件
- 不要用一级以上相对路径，如果涉及多级相对路径的导入，那么重构代码，把路由级的类型、常量、工具函数移动到`lib/`下
- **测试文件一律放仓库根 `test/` 下，并镜像源码路径**：`src/lib/a.ts` → `test/src/lib/a.test.ts`（含夹具/测试替身，
  如 `src/lib/api/provider/x/__fixtures__.ts` → `test/src/lib/api/provider/x/__fixtures__.ts`）。
    - 路径映射口径只此一处：`test/paths.ts`（`testPathOf` / `sourcePathOf` / `discoverTestFiles` / `selectTestFiles`）
    - 测试**不留**在 `src/` 下：`src/` 只放会被打进产物的代码，测试与替身（`test/__mocks__/`）不进产物
    - 测试里 import 源码用 `$lib/...`（`src/lib`）或 `$src/...`（`src` 根，路由模块用）；别名两处必须同步改：
      `svelte.config.js` 的 `kit.alias`（喂 Vite 与 svelte-check）与 `test/preload.mjs` 的 `aliasMap`（喂 node:test）
    - 需要读源码做静态断言的测试，一律用**仓库根相对路径**（`readFileSync('src/lib/...')`；cwd 恒为仓库根）；
      **不要**用 `import.meta.url` 取同目录读「旁边的源码」—— 测试树与源码树已分家

## 5. 完成检查

每次任务结束必须依次运行：

1. `pnpm run format`
2. `pnpm run lint:eslint`（ESLint 必须零错误通过）
3. `pnpm run check`

测试不是必跑项，但**改动纯逻辑（`calc/` `utils/` `data/` 等）时应跑 `pnpm test`**：入口会自动发现全部测试，
无需登记（详见 §5.2）。

> **环境说明（本机既有，无法修复）**：`.vercel\output\functions\![-]\catchall.func\...` 在 OS 层被 ACL 拒绝（EPERM），
> 本机用户亦无权限删除它。应对方式已固化，**不要**为绕开它去改部署配置：
>
> - `pnpm run format` / `pnpm run lint` 已改成**显式路径**（`"src" "test" "docs" "scripts" "*.{js,mjs,cjs,ts,json,md}"`）。
>   根因：`prettier .` 会**先递归展开目录再套 ignore**，展开阶段就 `Unable to expand directory "."` 失败 ——
>   `.prettierignore` 里加 `.vercel/` **实测无效**。故**不要**把脚本改回 `prettier .`。
> - `pnpm run build` 在仓库根**必然失败**（adapter-vercel 的 `rimraf` 打不进被拒目录）。
>   构建验收改用 `.tmp/build-verify.ps1`：复制源码到无 `.vercel` 的隔离副本、junction 复用 `node_modules`、
>   构建后核对依赖文件数并对**产物 CSS** 做探针复核（专职抓「写了个不生成 CSS 的类名」这类静态检查器盲区）。
>   它已实测通过（`adapter-vercel ✔ done`、PWA precache 119、`node_modules` 17779 → 17779）。
> - **测试加载失败必须是响的**：聚合入口 `test/run-tests.ts` 对每个测试文件单独 `try/catch`，
>   加载期抛错会打印 `[test] ✖ 加载失败：<文件>` 并让退出码变 1（见 §5.2）。历史上两种「静默消失」：
>   ① 手写 import 清单漏登记（实测漏 3 个文件、41 条用例，`pnpm test` 毫无提示，现已改为自动发现）；
>   ② 文件在**模块加载阶段**抛错 ⇒ `describe/it` 一个都不注册，`node:test` 汇总里**看不到任何 fail**，
>   唯一症状是 `tests` 计数变少（实测踩过：266 → 262；根因是测试把编译产物写到 `.tmp/xxx/` 又在 `after()` 里
>   `rmSync`，sandbox 在目录被删后把它列入**永久拒绝**名单，下次 `mkdirSync` 同路径直接 EPERM）。
>   → **测试脚手架不要「建专用子目录 + 结束后删目录」**，改用 `.tmp/` 下的单文件覆盖写入；
>   → **改过测试脚手架后要对比 `tests` 计数**，别只看 `fail=0`；
>   → 另：不能用 `mem:` 这类自定义 scheme 走 module hook 做纯内存加载（Node 报 `Invalid URL`）。
> - **统计行数不要用 Windows PowerShell 的 `Get-Content`**：本仓库文件全是 CJK，
>   PS 5.1 的 `Get-Content` 会**少算行**（实测 `result.svelte` 报 743、真实 753；
>   `theme.svelte` 报 610、真实 631；`segment-dps.svelte` 报 330、真实 335）。
>   用 `node -e "…split('\n').length"`、read 工具或 ripgrep 统计；`Get-ChildItem | Measure-Object -Line` 同样不可信。
> - 同理，**判断 CJK 文件内容不要读 `Get-Content` / `Select-String` 的输出**（会乱码或漏行），用 read 工具。
> - **不只 `>` 会写 UTF-16LE**：PS 5.1 下 `>` / `Out-File` / `Tee-Object -FilePath` **默认都是 UTF-16LE**。
>   用它们落盘的「证据」文件里会隔字节插 `\0`，Node 读出来是乱码。落盘证据统一用 Node
>   `writeFileSync(p, s, 'utf8')`，或先用 PS 落盘、再用 Node 转码成 UTF-8。
> - **用工具（编辑器）改过 `.ps1` 之后必须重新加回 UTF-8 BOM**：PS 5.1 会把无 BOM 的脚本按 ANSI 解读，
>   脚本里的 CJK 注释被读坏后报 `MissingParameterExpressionAfterToken` / `MissingExpressionAfterToken`
>   （实测踩过两次）。加回方式：
>   `[System.IO.File]::WriteAllText($p, [System.IO.File]::ReadAllText($p, [System.Text.UTF8Encoding]::new($false)), [System.Text.UTF8Encoding]::new($true))`

### 5.1 ESLint 函数式约束

- 配置文件：`eslint.config.js`（flat config）
- **纯逻辑层**（`src/lib` 下 `calc/` `api/` `utils/` `consts/` `types/` `ai/generate/` `ai/tools/` 的 `.ts`，排除 `*.svelte.ts` / `*.test.ts`）强制函数式偏好：`prefer-const` `prefer-arrow-callback` `prefer-template` `object-shorthand` `arrow-body-style` `no-var` `no-param-reassign`
- **UI / store 层**（`*.svelte`、`*.svelte.ts`）仅基础解析 + 少量最佳实践规则，不做函数式约束（Runes 响应式状态保留可变性）
- 新增纯逻辑函数时遵守：入参不可重赋值（`no-param-reassign`）、优先 `const`、优先箭头函数
- Svelte 最佳实践采用**渐进棘轮**：不全量启用 `svelte/recommended`（会淹没函数式信号），只逐条引入能量化收敛的规则
    - `svelte/require-each-key` 已**清零并升为 `error`**（T9）：基线 **0 处**，无白名单。历史轨迹：Phase 0 实测 141 处 → 6.4 四批清到 50 → T9 清掉最后 47 处。此后新增无 key 的 `{#each}` 直接报 error
    - 补 key 时**必须**保证 key 唯一——重复 key 是 Svelte 运行时错误。值列表用值作 key（先确认无重复）；对象列表用稳定 id 字段；位置即身份（定长元组）用索引变量
        - **「看起来唯一」不等于唯一**：T9 实测踩到三处反例 —— ① `getSkillPickerGroups()` 的 `group.type` 来自逐 `skill_trees` 节点 push 的 `buildSkillGroups`，**同一 type 可出现多次**；② `slot.triggerSets` 的 `name` 会**刻意重复**（`set-picker` 选 5 件套时写入 `{name,5}` + `{name,2}` 两条，见 `togglePiece`）；③ 持久化的 `comparison` 配置可能来自旧版本/导入，无法证明组合不重复。这三处最终都改用索引（位置即身份），而不是硬塞值作 key
        - 判定顺序：先用一次性 Node 脚本对**真实数据源**采样去重（不是读代码猜），证不出唯一就用索引并在报告里写明理由
    - 组件一致性另由 `scripts/check-components.mjs` + `scripts/check-surfaces.mjs` 把关（已接入 `pnpm run check`）
        - `scripts/check-components.mjs` ⑧ 校验「`ui/` 元件必须被至少一个消费方引用」（防「假组件化」：文件存在 ≠ 已接线；判定覆盖 `$lib`/相对路径 import、`<X>` 渲染与 barrel re-export，**注释里的路径提及不算引用**）。设计系统里**暂时零引用**的元件作为债务登记在该脚本 `BASELINE.uiNoRef`，**只减不增、且不删除**（保留为通用控件，接线时直接复用）；新增零引用 `ui/` 元件立即失败，基线内已恢复引用则提示「可回收」但不失败
    - 动效三不变量由 `scripts/check-motion.mjs` 把关（同样接入 `pnpm run check`，可单独跑 `pnpm run check:motion`）：① `layout.css` 的 `--motion-*` 与 `motion.ts` 的 `MOTION_MS` **逐项相等**（Svelte 过渡只吃 JS 数字，靠脚本对齐而非记忆，不一致时报出不匹配的 key 与两侧数值）；② `transition:` / `in:` / `out:` / `animate:` **只能挂元素**，挂组件是编译期 `component_invalid_directive`（脚本按标签归属判定，不做整行文本匹配，避免误报）；③ 指令内联手写时长（`{{ duration: 200 }}`）走**棘轮**：基线已清零为 **0 处**（T17 把最后 14 处迁到 `slideParams(MOTION_MS.*)`），新增即失败；时长一律走 `$lib/utils/motion.ts` 的 `MOTION_MS` / `motionDuration` / `slideParams`。③ 已无永久豁免项（T26 把最后的 `layout/modal.svelte` 遮罩 130ms 改成 `motionDuration(130)`：正常模式仍是 130ms、reduce 下与面板同步归零；脚本 `EXEMPT` 现为空 Map，仍无条件打印清单以免后人误以为还有豁免）
    - `.tmp/components.md`（`ui/` 元件目录与 props 表）是**生成物**：改 `ui/` 组件后须运行 `pnpm run generate-components-doc` 重新生成；`pnpm run check` 会用 `--check` 比对，不同步即报错并指出首个差异行。该文件与整改计划同放 `.tmp/`（已被 `.gitignore` 忽略），不进 `docs/`——`docs/` 只放随仓库分发的项目文档

### 5.2 测试组织与运行

- **布局**：测试与测试替身全在仓库根 `test/` 下，镜像源码路径（`src/lib/a.ts` → `test/src/lib/a.test.ts`）；
  测试替身放 `test/__mocks__/`（如 `$app/environment` 的替身 `test/__mocks__/app/environment.ts`）。
  路径映射口径的唯一实现是 `test/paths.ts`（`testPathOf` / `sourcePathOf` / `discoverTestFiles` / `selectTestFiles`）——
  想知道「某模块的测试该放哪」就调 `testPathOf()`，不要再靠记忆或手写清单
- **入口**：`test/run-tests.ts` **自动发现** `test/**/*.test.ts` 并**逐个隔离 `import`**
  （本环境禁止子进程，故不能用 `node --test`）。新增测试只要按镜像规则放对位置就会被跑到
- **加载失败必须响**：入口对每个文件单独 `try/catch`，抛错会打 `[test] ✖ 加载失败：<文件>` 并让退出码为 1
  （历史坑：手写清单漏登记 ⇒ 用例永远不跑；加载期抛错 ⇒ 用例静默消失，只有 `tests` 计数变小）
- **命令**：`pnpm test`（全部）· `pnpm test:one calc`（只跑路径含 `calc` 的文件）· `pnpm test:list`（只列文件）·
  `pnpm test:watch` · 单文件 `node --import ./test/preload-runes.mjs --import ./test/preload.mjs <test 文件>`
- **别名**：`$lib` → `src/lib`（SvelteKit 自带）· `$src` → `src`（测试 import 路由模块用，避免 7 层相对路径）。
  `$src` 由 `svelte.config.js` 的 `kit.alias` 定义（喂 Vite 与 `.svelte-kit/tsconfig.json`），
  node:test 侧要在 `test/preload.mjs` 的 `aliasMap` 里同步登记 —— **两处必须一起改**
- **不进 `pnpm test` 的测试**：联网 / 依赖上游文案的用 `.ts` 命名（非 `*.test.ts`），例如
  `test/damage-type-infer.<角色>.ts`（跑 `pnpm test:infer`）；自动发现只认 `*.test.ts`，故它们不会被误跑
- **`test/` 也吃 `pnpm run format` / `lint:eslint` / `svelte-check`**：`.svelte-kit/tsconfig.json` 已包含 `../test/**/*.ts`，
  所以测试里的类型错误会像源码一样报出来
