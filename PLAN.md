# 重构计划：正式代码隔离 + ComponentsProps 扩展

## 目标

- `src/lib/` 只保留正式文件，所有测试组件移入 `src/lib/.test/`
- 扩展 `ComponentsProps` 增加 `backgroundImage`/`textColor`（正式组件用）
- 修复测试组件现有 class/style prop bug
- 更新所有导入路径，`pnpm run check` 通过

## Steps

### ☑ Step 1 — ComponentsProps 扩展

- **文件**: `src/lib/types/component-props.ts`
- **变更**: 添加 `backgroundImage?: string` 和 `textColor?: string`

### ☑ Step 2 — 全部组件移入 `src/lib/.test/`

| 当前路径                             | 新路径                                     |
| ------------------------------------ | ------------------------------------------ |
| `src/lib/components/shared/*`        | `src/lib/.test/components/shared/*`        |
| `src/lib/components/page/timeline/*` | `src/lib/.test/components/page/timeline/*` |

### ☑ Step 3 — 修复测试组件 bug

- 3 detail modals: `class`/`style` prop 合并到根元素，`_class` → `className`
- `CodeBlock`, `TestListLayout`: 加 `?? ''` 回退
- `SelectorModal`: `style` 移到根元素
- `CodeBlock`: Props 删除重复的 `class`/`style` 声明

### ☑ Step 4 — 更新测试路由导入路径

`$lib/components/...` → `$lib/.test/components/...`

涉及文件：

- `src/routes/test/timeline/+page.svelte`
- `src/routes/test/api/+page.svelte`
- `src/routes/test/api-nanoka/+page.svelte`
- `src/routes/test/list/characters/+page.svelte`
- `src/routes/test/list/echos/+page.svelte`
- `src/routes/test/list/weapons/+page.svelte`
- `src/routes/test/team-config/+page.svelte`

### ☑ Step 5 — 清理空目录

- 删除 `src/lib/components/`
- 删除 `src/lib/core/`
- 删除 `src/lib/utils/`

### ☑ Step 6 — 验证

```bash
pnpm run format && pnpm run check
```

## 后续任务

### ☑ Step 7 — 图标缓存从 localStorage 迁移到 IndexedDB

- **新增**: `src/lib/data/db.ts` — IndexedDB 封装（wuwa-v1 数据库，cache 对象仓库）
- **修改**: `src/lib/data/api.ts`
  - `fetchIcons()` 改用 `dbGet/dbSet` 替代 `getLocal/setLocal`
  - 自动迁移：首次加载时检测 localStorage 中的旧图标数据，迁移到 IndexedDB 后删除
  - `clearCache()` 同时清理 localStorage + IndexedDB
  - 简化 `setLocal()` 的 quota 处理（图标不再存 localStorage，小 JSON 不会超配额）
