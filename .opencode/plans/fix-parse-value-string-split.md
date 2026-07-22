# Fix parseValueString + damage list display

## Problem

1. `parseValueString` uses `split(' + ')` — 对 `123%+456%+789%`（无空格）不生效，剩余部分被当作 baseType 后缀
2. `getDamageList()` 值列直接显示原始 `h.ratio`（如 `123%攻击`），没有去掉中文后缀

## Fix 1: `src/lib/consts/parse-value-string.ts` line 16

```diff
-   const parts = value.split(' + ')
+   const parts = value.split('+')
```

## Fix 2: `src/lib/components/page/home/timeline/timeline.store.svelte.ts` — `getDamageList()` 内

### 替换 (lines 1179-1181):

```js
const value = h.ratio + ((h.hits ?? 0) > 1 ? ' ×' + h.hits : '')
const comps = parseValueString(h.ratio)
const baseType = comps.length > 0 ? (comps[0].baseType ?? '') : ''
```

### 改为:

```js
const comps = parseValueString(h.ratio)
const valueParts = comps.map((c) => {
    if (c.flatValue !== undefined) return c.flatValue.toString()
    return c.ratioNum + '%'
})
const value = valueParts.join(' + ') + ((h.hits ?? 0) > 1 ? ' ×' + h.hits : '')
const baseTypes = [...new Set(comps.map((c) => c.baseType || '固定'))]
const baseType = baseTypes.join(' + ')
```

## Verification

| Input                | Value列              | BaseType列        |
| -------------------- | -------------------- | ----------------- |
| `123%+456%+789%`     | `123% + 456% + 789%` | `攻击力`          |
| `123% + 456% + 789%` | `123% + 456% + 789%` | `攻击力`          |
| `123%攻击+456%防御`  | `123% + 456%`        | `攻击力 + 防御力` |
| `123 + 456%`         | `123 + 456%`         | `固定 + 攻击力`   |
| `1880.75%偏谐系数`   | `1880.75%`           | `偏谐系数`        |
