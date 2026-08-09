# AGENTS.md — AI 辅助开发规则

## 1. 代码风格

- 能拆成 snippet（复用部件） 和纯函数（复杂功能里的无副作用成分）的，必须拆
- 优先使用箭头函数（`const fn = () => { ... }`），非 `function` 声明
    - 例外：事件处理函数（`onWindowMouseDown` 等）、SvelteKit 要求的 `load`/`actions` 函数可以保留 `function` 声明
- 优先flex布局
- 注释使用/** @desc [markdown] */形式

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
- 尽量使用 TailwindCSS 而不是 `<style>` 样式
- 不依赖外部 UI 库，所有控件使用原生 HTML + TailwindCSS 实现
    - 允许的例外：`@iconify/svelte`（图标渲染）、`prismjs`（代码高亮）
- Snippet 通过闭包访问父作用域的响应式状态（`$state`/`$derived`），避免使用带类型的 snippet 参数
- 主题托管在 `$lib/theme`，通过 CSS 自定义属性（`--theme-{key}-{prop}`）驱动；组件中使用 `bg-[var(--theme-{key}-bg)]` / `text-[var(--theme-{key}-text)]`，不要直接 import theme store

## 4. 文件组织

- 组件遵循最小化原则，分类存放：
    - `src/lib/components/ui/` — 通用 UI 元件（按钮、输入框、头像、Tabs 等）
    - `src/lib/components/layout/` — 布局元件（弹窗、右键菜单、通知提示等）
    - `src/lib/components/page/{路由名}/` — 页面级组件
- 不要用一级以上相对路径，如果涉及多级相对路径的导入，那么重构代码，把路由级的类型、常量、工具函数移动到`lib/`下

## 5. 完成检查

每次任务结束必须依次运行：

1. `pnpm run format`
2. `pnpm run check`
