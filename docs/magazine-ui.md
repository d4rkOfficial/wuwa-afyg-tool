# 杂志风 UI 规范（全项目界面重写依据）

> 状态：进行中。目标是把**所有弹窗（含组件内子弹窗）与所有卡片**统一为杂志风：直角、衬线重音标题、图标代替英文小标、细分割线、超大浅水印。
> 本文件是执行契约：改动任何 UI 组件前先读它，改完必须符合「验收」一节。

## 1. 三条硬规则

1. **一律去圆角**：只用 `rounded-none`。
    - 唯一例外：**功能性圆形**保留 `rounded-full`——头像、开关滑块/轨道、状态点、单选圈（`radiobox-*`）、进度环、`size-*` 小圆点。
    - 不使用任何阴影做层次（`shadow-sm/md/lg` 等一律去掉），弹窗整体 `shadow-2xl` 例外。层次靠 `border` + `bg` 明暗。
2. **衬线重音**：全局字体已是衬线（FangXinShu）。标题靠**字重 + 字距 + 描边光晕**体现杂志感，**不换字体**：
    - 大标题/刊头：`font-black tracking-tight`，需要强调时加 `[text-shadow:0_0_3px_var(--theme-halo-color)]`
    - 分区标题：`text-base font-black tracking-tight`（小分区 `text-xs`/`text-sm`）
    - 关键数字：`font-black`（可 `text-base`/`text-lg`）+ 光晕；日期/编号 `tracking-[0.22em]`
    - 说明文字：`text-[10px] text-(--theme-modal-text)/40`
    - **禁止** `font-semibold` 当标题（改 `font-black`）
3. **图标代替英文小标**：不写 `VOL.1` / `SETTINGS` / `BUFF LIBRARY` 之类英文 kicker；改成标题左侧 `<Icon>`（`size-4`，`style="color: var(--theme-accent-text);"`）。

## 2. 标准配方（照抄即可）

```svelte
<!-- 分区标题（整宽单行；参考 components/layout/magazine/magazine-section.svelte） -->
<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t pt-4" style="border-color: var(--theme-divider-border);">
    <Icon icon="mdi:palette-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
    <h3 class="text-base font-black tracking-tight text-(--theme-modal-text)">分区名</h3>
    <div class="ml-auto flex items-center gap-2">{/* 操作按钮 */}</div>
</div>

<!-- 卡片（直角 + 边框 + 输入底色；不要阴影） -->
<div class="rounded-none border p-3" style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);">

<!-- 卡片水印（右下水印；参考 magazine-card.svelte） -->
<Icon icon="mdi:chart-line" class="pointer-events-none absolute -bottom-2 -right-2 size-14 opacity-[0.06]" />

<!-- 分割线 -->
<div class="border-t" style="border-color: var(--theme-divider-border);"></div>

<!-- 主操作按钮 -->
<button class="inline-flex items-center gap-1 rounded-none px-2.5 py-1 text-[10px] font-medium transition-all hover:brightness-110"
        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);">
    <Icon icon="mdi:plus" class="size-3" /> 新建
</button>

<!-- 次操作按钮 -->
<button class="inline-flex items-center gap-1 rounded-none border px-2 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
        style="border-color: var(--theme-divider-border);">
    <Icon icon="mdi:export" class="size-3" /> 导出
</button>

<!-- 危险操作 -->
<button class="... border ... text-(--theme-modal-text)/40 hover:border-red-500/50 hover:text-red-500">…</button>
```

### 布局约定

- 优先 flex；分区标题**整宽单行**，双列只作用于**分区内部的列表容器**：
  `class="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-4"`
- 弹窗内容区沿用 `p-6`，多分区之间用 `border-t pt-4` 分隔（不要用大间距堆叠）
- 长列表用 `theme-scrollbar` + `overflow-y-auto` + `max-h-*`，不要撑爆弹窗
- 移动/窄屏仍要可读：双列只在 `xl:` 断点启用

## 3. 主题 token（只用这些，不要硬编码颜色）

| 用途          | token                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| 弹窗文字      | `text-(--theme-modal-text)`，次级用 `/70`、`/40`、`/35`                                |
| 分割线/边框   | `var(--theme-divider-border)`                                                          |
| 卡片/输入底色 | `var(--theme-input-bg)`                                                                |
| 强调色        | `var(--theme-accent-bg)`、`var(--theme-accent-text)`、`var(--theme-accent-text-on-bg)` |
| 光晕          | `var(--theme-halo-color)`                                                              |
| 元素色        | `var(--theme-element-{物理/冷凝/热熔/导电/气动/衍射/湮灭})`                            |
| 危险          | Tailwind `red-500`（`hover:border-red-500/50 hover:text-red-500`）                     |

## 4. 动效

- 弹窗容器：`animate-pop-in`（配合 `out:fade` / `out:popOut`），遮罩 `animate-fade-in`
- 列表项可用 `animate-fade-in` 或 `card-pop-in`（若已定义）；不要新增 JS 动画

## 5. 验收

每个文件改完必须：

1. `npx prettier --write <files>`
2. 全部改完后由主流程跑 `npx eslint .` 与 `npx svelte-check --tsconfig ./tsconfig.json`，必须 **0 error**
3. 不改变任何交互逻辑、文案语义、props 签名、`svelte-ignore` 注释；只动表现层
4. 不引入新的图标字符串，除非同时把它们加入本地图标集（`pnpm collect-icons`）；优先复用已有 `mdi:*`

## 6. 参考实现

- `src/lib/components/layout/magazine/magazine-section.svelte` — 分区标题配方
- `src/lib/components/layout/magazine/magazine-card.svelte` — 直角卡片 + 水印
- `src/lib/components/layout/settings-modal.svelte` — 侧边栏分区 + 双列列表 + 归档卡片（大胆版）
- `src/lib/components/page/home/welcome-screen.svelte` — 刊头/水印基调（注意：不要照搬英文 kicker）
