<script lang="ts">
    /**
     * @desc 「变量写入」弹窗：逐个倍率配置该段伤害执行时对工程变量的改写。
     * 变量本身在「变量管理」弹窗里维护（BUFF 配置 → 变量）；这里只做写入规则配置，不做同步。
     * 写入规则的选择一律用自绘下拉浮层，不使用系统原生 select。
     */
    import Icon from '@iconify/svelte'
    import { fade, slide } from 'svelte/transition'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import type { BuffOp, DamageEntry } from '$lib/calc/calculation.types'
    import {
        getDamageEntryOps,
        getAllDamageEntries,
        getUserVars,
        setDamageEntryOps
    } from '$lib/calc/calculation.store.svelte'
    import { getActiveProject } from '$lib/data/project.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import { getCharIconMap } from '$lib/calc/timeline.store.svelte'
    import { fallbackIcon } from '$lib/utils/icons'
    import type { CharSlot } from '$lib/types/project'

    interface Props extends ComponentsProps {
        open: boolean
        locked?: boolean
        onclose: () => void
        /** @desc 打开「变量管理」弹窗（新增/删除/改名都在那边做） */
        onopenvars?: () => void
    }
    let { open, locked = false, onclose, onopenvars, class: className, style: styleProp }: Props = $props()

    type ListedEntry = DamageEntry & { character: string }

    const damageEntries = $derived(getAllDamageEntries().filter((entry): entry is ListedEntry => !!entry.character))
    const team = $derived((getActiveProject()?.team ?? []) as unknown as [CharSlot, CharSlot, CharSlot])
    let vars = $derived(getUserVars())
    const numVars = $derived(vars.filter((v) => v.type === 'number'))
    const charIconMap = $derived(getCharIconMap())

    /** @desc 本地镜像：写入后立即反映到界面 */
    let opsMap = $state<Record<string, BuffOp[]>>({})
    let version = $state(0)

    $effect(() => {
        if (!open) return
        version
        opsMap = Object.fromEntries(damageEntries.map((e) => [e.id, getDamageEntryOps(e.id).map((o) => ({ ...o }))]))
    })

    let helpOpen = $state(false)
    const mergedStyle = $derived(styleProp || '')

    const charGroups = $derived.by(() => {
        const groups: Array<{ key: string; character: string; entries: ListedEntry[] }> = []
        for (const entry of damageEntries) {
            const last = groups[groups.length - 1]
            if (last && last.character === entry.character) last.entries.push(entry)
            else
                groups.push({
                    key: `${entry.character}#${groups.length}`,
                    character: entry.character,
                    entries: [entry]
                })
        }
        return groups
    })

    const entryKey = (entry: DamageEntry, index: number) => `${entry.id}#${index}`

    const ratioNameOf = (entry: DamageEntry) => {
        const suffix = `(${entry.skillType ?? ''})`
        if (suffix.length > 2 && entry.displayName.endsWith(suffix)) return entry.displayName.slice(0, -suffix.length)
        return entry.displayName.endsWith('()') ? entry.displayName.slice(0, -2) : entry.displayName
    }

    const ratioLabel = (entry: DamageEntry) => {
        if (entry.isEffect) return `${Math.round(entry.ratioValue)} 层`
        if (entry.ratioUnit === 'fixed') return `固定值 ${Math.round(entry.ratioValue)}`
        return `${Math.round(entry.ratioValue * 100) / 100}%`
    }

    const varTypeOf = (name: string) => vars.find((v) => v.name === name)?.type ?? 'number'

    /** @desc 写入规则的可读摘要 */
    const describeOp = (op: BuffOp): string => {
        const isBool = varTypeOf(op.var) === 'boolean'
        if (op.op === 'not') return `${op.var} 取反`
        const operand =
            op.value && 'const' in op.value
                ? String(op.value.const)
                : op.value && 'var' in op.value
                  ? op.value.var
                  : '0'
        if (isBool) return `${op.var} = ${operand === 'true' ? '真' : operand === 'false' ? '假' : operand}`
        if (op.op === 'add') return `${op.var} += ${operand}`
        if (op.op === 'mul') return `${op.var} ×= ${operand}`
        return `${op.var} = ${operand}`
    }

    const OP_LABELS: Record<BuffOp['op'], string> = { set: '设置为', not: '取反', add: '加', mul: '乘' }

    const persistEntry = (entryId: string, ops: BuffOp[]) => {
        if (locked) {
            addToast('本环节已锁定，请先解锁', 'info')
            return
        }
        setDamageEntryOps(entryId, ops)
        opsMap = { ...opsMap, [entryId]: ops }
    }

    // ── 自绘下拉：同一时刻只展开一个浮层（key = 条目 id + 规则下标 + 字段）──
    let openMenu = $state<string | null>(null)
    const toggleMenu = (key: string) => {
        openMenu = openMenu === key ? null : key
    }
    const pickMenu = (key: string, action: () => void) => {
        action()
        openMenu = null
    }

    const addOp = (entry: DamageEntry) => {
        if (locked) return
        const first = vars[0]
        if (!first) {
            addToast('请先在「变量管理」中创建工程变量', 'info')
            return
        }
        const current = opsMap[entry.id] ?? []
        const op: BuffOp =
            first.type === 'boolean'
                ? { var: first.name, op: 'not' }
                : { var: first.name, op: 'add', value: { const: 1 } }
        persistEntry(entry.id, [...current, op])
    }

    const updateOp = (entry: DamageEntry, i: number, part: Partial<BuffOp>) => {
        const current = opsMap[entry.id] ?? []
        persistEntry(
            entry.id,
            current.map((o, j) => (j === i ? { ...o, ...part } : o))
        )
    }

    const changeOpVar = (entry: DamageEntry, i: number, name: string) => {
        const type = varTypeOf(name)
        updateOp(entry, i, {
            var: name,
            op: type === 'boolean' ? 'not' : 'add',
            value: type === 'boolean' ? undefined : { const: 1 }
        })
    }

    const removeOp = (entry: DamageEntry, i: number) => {
        const current = opsMap[entry.id] ?? []
        persistEntry(
            entry.id,
            current.filter((_, j) => j !== i)
        )
    }

    const HELP_PARAGRAPHS = [
        '变量写入用来描述「这段伤害发生时，战局状态发生了什么变化」，例如：这段打完之后某个 buff 层数 +1、某个开关取反。',
        '变量是工程级的：布尔值初始为「假」，计数值初始为 0；一次计算从初始值开始，按排轴顺序逐段执行写入。',
        '判定不在这里：是否吃到某个 BUFF 的某个乘区，由该乘区自己的生效条件（伤害类型 / 伤害属性、变量判定）决定。',
        '新增、改名、删除变量请用本弹窗标题栏的「变量管理」；这里只配置每段伤害怎么改写它们。'
    ]
</script>

<Modal {open} {onclose} backdropClose class="w-[62rem] max-w-[94vw] {className}" style={mergedStyle}>
    {#snippet title()}
        <span class="flex items-center gap-2 pr-8">
            <Icon icon="mdi:variable" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <span class="font-black tracking-tight">变量写入</span>
            <button
                onclick={() => (helpOpen = !helpOpen)}
                class="rounded-none p-0.5 transition-colors {helpOpen
                    ? 'text-(--theme-accent-text)'
                    : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'}"
                title="这个弹窗怎么用？"
                aria-label="帮助"
            >
                <Icon icon="mdi:help-circle-outline" class="size-4" />
            </button>
            <button
                onclick={() => onopenvars?.()}
                class="flex items-center gap-1 border px-1.5 py-0.5 text-[11px] transition-colors hover:border-(--theme-accent-bg) hover:text-(--theme-accent-text)"
                style="border-color: var(--theme-divider-border); color: var(--theme-modal-text)/70;"
                title="打开变量管理：新增 / 改名 / 改初始值 / 删除变量"
            >
                <Icon icon="mdi:cog-outline" class="size-3.5" />变量管理
            </button>
        </span>
    {/snippet}

    <div class="flex flex-col gap-3">
        {#if helpOpen}
            <section
                in:slide={{ duration: 160 }}
                class="shrink-0 space-y-1.5 border px-3 py-2.5 text-xs leading-relaxed"
                style="border-color: color-mix(in srgb, var(--theme-accent-bg) 35%, transparent); background: color-mix(in srgb, var(--theme-accent-bg) 8%, transparent); color: var(--theme-modal-text)/85;"
            >
                <div class="flex items-center gap-1.5 text-xs font-black tracking-tight text-(--theme-accent-text)">
                    <Icon icon="mdi:lightbulb-on-outline" class="size-4 shrink-0" />
                    变量写入是什么
                </div>
                {#each HELP_PARAGRAPHS as paragraph (paragraph)}
                    <p>{paragraph}</p>
                {/each}
            </section>
        {/if}

        <!-- 变量一览（只读） -->
        <div
            class="flex shrink-0 flex-wrap items-center gap-2 border px-2 py-1.5"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <span class="text-[10px] text-(--theme-modal-text)/45">工程变量</span>
            {#if vars.length === 0}
                <span class="text-[10px] text-(--theme-modal-text)/35">暂无变量：请先在 BUFF 配置 →「变量」中创建</span>
            {:else}
                {#each vars as v (v.id)}
                    <span
                        class="px-1.5 py-0.5 text-[10px]"
                        style="background: var(--theme-card-bg); color: color-mix(in srgb, var(--theme-modal-text) 65%, transparent);"
                        >{v.name}<span class="opacity-50">（{v.type === 'boolean' ? '布尔' : '计数'}）</span></span
                    >
                {/each}
            {/if}
        </div>

        <!-- 列头 -->
        <div
            class="flex shrink-0 items-center gap-3 border-y px-1 py-1.5 text-[11px] font-black tracking-[0.12em] text-(--theme-modal-text)/50"
            style="border-color: var(--theme-divider-border);"
        >
            <span class="min-w-0 flex-1">倍率名</span>
            <span class="w-[34rem] shrink-0">该段执行时的变量写入</span>
        </div>

        <div class="theme-scrollbar {helpOpen ? 'h-[46vh]' : 'h-[60vh]'} space-y-3 overflow-y-auto pr-1">
            {#each charGroups as group (group.key)}
                <div class="space-y-1">
                    <div
                        class="flex items-center gap-2 px-1 text-xs font-black tracking-tight text-(--theme-modal-text)"
                    >
                        {#if charIconMap[group.character]}
                            <img
                                src={charIconMap[group.character]}
                                alt={group.character}
                                draggable="false"
                                use:fallbackIcon={'/icons/placeholder-character.svg'}
                                class="size-4 shrink-0 rounded-full object-cover ring-1 ring-(--theme-divider-border)"
                            />
                        {/if}
                        <span>{group.character}</span>
                    </div>
                    {#each group.entries as entry, entryIndex (entryKey(entry, entryIndex))}
                        {@const ops = opsMap[entry.id] ?? []}
                        <div
                            in:fade={{ duration: 100 }}
                            class="flex items-start gap-3 border px-2 py-1.5 transition-colors hover:border-(--theme-accent-bg)"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <div class="min-w-0 flex-1 pt-0.5">
                                <div
                                    class="truncate text-xs"
                                    style="color: var(--theme-element-{entry.damageElement}, #888);"
                                    title={ratioNameOf(entry)}
                                >
                                    {ratioNameOf(entry)}
                                </div>
                                <div class="flex items-center gap-1.5 text-[10px] text-(--theme-modal-text)/40">
                                    <span>{entry.skillType || '未分类'}</span>
                                    <span>{ratioLabel(entry)}</span>
                                    {#if entry.hits > 1}<span>×{entry.hits} hit</span>{/if}
                                </div>
                            </div>

                            <!-- 变量写入规则 -->
                            <div class="flex w-[34rem] shrink-0 flex-col gap-1">
                                {#each ops as op, i}
                                    {@const isBool = varTypeOf(op.var) === 'boolean'}
                                    {@const menuBase = `${entry.id}#${i}`}
                                    <div class="flex flex-wrap items-center gap-1">
                                        <!-- 变量（自绘下拉） -->
                                        <div class="relative min-w-0 flex-1">
                                            <button
                                                onclick={() => toggleMenu(`${menuBase}#var`)}
                                                disabled={locked}
                                                class="flex w-full items-center gap-1 border px-1.5 py-0.5 text-left text-[11px] transition-colors hover:border-(--theme-accent-bg) disabled:opacity-60"
                                                style="background: var(--theme-card-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                                            >
                                                <span class="min-w-0 flex-1 truncate"
                                                    >{op.var}<span class="opacity-50"
                                                        >（{isBool ? '布尔' : '计数'}）</span
                                                    ></span
                                                >
                                                <Icon icon="mdi:chevron-down" class="size-3 shrink-0 opacity-50" />
                                            </button>
                                            {#if openMenu === `${menuBase}#var`}
                                                <div
                                                    class="absolute left-0 top-full z-30 mt-0.5 max-h-48 w-full overflow-y-auto border shadow-lg"
                                                    style="border-color: var(--theme-divider-border); background: var(--theme-modal-bg);"
                                                >
                                                    {#each vars as v (v.id)}
                                                        <button
                                                            onclick={() =>
                                                                pickMenu(`${menuBase}#var`, () =>
                                                                    changeOpVar(entry, i, v.name)
                                                                )}
                                                            class="flex w-full items-center gap-1 px-2 py-1 text-left text-[11px] transition-colors hover:bg-(--theme-accent-bg)/15"
                                                            style={v.name === op.var
                                                                ? 'color: var(--theme-accent-text);'
                                                                : ''}
                                                        >
                                                            <span class="min-w-0 flex-1 truncate">{v.name}</span>
                                                            <span class="shrink-0 text-[9px] opacity-45"
                                                                >{v.type === 'boolean' ? '布尔' : '计数'}</span
                                                            >
                                                        </button>
                                                    {/each}
                                                </div>
                                            {/if}
                                        </div>

                                        <!-- 操作（自绘下拉） -->
                                        <div class="relative shrink-0">
                                            <button
                                                onclick={() => toggleMenu(`${menuBase}#op`)}
                                                disabled={locked}
                                                class="flex items-center gap-1 border px-1.5 py-0.5 text-[11px] transition-colors hover:border-(--theme-accent-bg) disabled:opacity-60"
                                                style="background: var(--theme-card-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                                            >
                                                {OP_LABELS[op.op]}
                                                <Icon icon="mdi:chevron-down" class="size-3 shrink-0 opacity-50" />
                                            </button>
                                            {#if openMenu === `${menuBase}#op`}
                                                <div
                                                    class="absolute left-0 top-full z-30 mt-0.5 w-24 border shadow-lg"
                                                    style="border-color: var(--theme-divider-border); background: var(--theme-modal-bg);"
                                                >
                                                    {#each isBool ? ['set', 'not'] : ['set', 'add', 'mul'] as kind (kind)}
                                                        <button
                                                            onclick={() =>
                                                                pickMenu(`${menuBase}#op`, () =>
                                                                    updateOp(entry, i, { op: kind as BuffOp['op'] })
                                                                )}
                                                            class="w-full px-2 py-1 text-left text-[11px] transition-colors hover:bg-(--theme-accent-bg)/15"
                                                            style={op.op === kind
                                                                ? 'color: var(--theme-accent-text);'
                                                                : ''}
                                                        >
                                                            {OP_LABELS[kind as BuffOp['op']]}
                                                        </button>
                                                    {/each}
                                                </div>
                                            {/if}
                                        </div>

                                        <!-- 值 -->
                                        {#if isBool && op.op === 'set'}
                                            <div class="relative shrink-0">
                                                <button
                                                    onclick={() => toggleMenu(`${menuBase}#val`)}
                                                    disabled={locked}
                                                    class="flex items-center gap-1 border px-1.5 py-0.5 text-[11px] transition-colors hover:border-(--theme-accent-bg) disabled:opacity-60"
                                                    style="background: var(--theme-card-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                                                >
                                                    {op.value && 'const' in op.value && op.value.const === true
                                                        ? '真'
                                                        : '假'}
                                                    <Icon icon="mdi:chevron-down" class="size-3 shrink-0 opacity-50" />
                                                </button>
                                                {#if openMenu === `${menuBase}#val`}
                                                    <div
                                                        class="absolute left-0 top-full z-30 mt-0.5 w-16 border shadow-lg"
                                                        style="border-color: var(--theme-divider-border); background: var(--theme-modal-bg);"
                                                    >
                                                        {#each [['true', '真'], ['false', '假']] as [val, label] (val)}
                                                            <button
                                                                onclick={() =>
                                                                    pickMenu(`${menuBase}#val`, () =>
                                                                        updateOp(entry, i, {
                                                                            value: { const: val === 'true' }
                                                                        })
                                                                    )}
                                                                class="w-full px-2 py-1 text-left text-[11px] transition-colors hover:bg-(--theme-accent-bg)/15"
                                                            >
                                                                {label}
                                                            </button>
                                                        {/each}
                                                    </div>
                                                {/if}
                                            </div>
                                        {:else if !isBool}
                                            {#if op.value && 'var' in op.value}
                                                <div class="relative shrink-0">
                                                    <button
                                                        onclick={() => toggleMenu(`${menuBase}#val`)}
                                                        disabled={locked}
                                                        class="flex items-center gap-1 border px-1.5 py-0.5 text-[11px] transition-colors hover:border-(--theme-accent-bg) disabled:opacity-60"
                                                        style="background: var(--theme-card-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                                                        title="引用另一个计数变量"
                                                    >
                                                        <Icon icon="mdi:variable" class="size-3 shrink-0 opacity-60" />
                                                        {op.value.var}
                                                        <Icon
                                                            icon="mdi:chevron-down"
                                                            class="size-3 shrink-0 opacity-50"
                                                        />
                                                    </button>
                                                    {#if openMenu === `${menuBase}#val`}
                                                        <div
                                                            class="absolute left-0 top-full z-30 mt-0.5 max-h-48 w-40 overflow-y-auto border shadow-lg"
                                                            style="border-color: var(--theme-divider-border); background: var(--theme-modal-bg);"
                                                        >
                                                            {#each numVars as nv (nv.id)}
                                                                <button
                                                                    onclick={() =>
                                                                        pickMenu(`${menuBase}#val`, () =>
                                                                            updateOp(entry, i, {
                                                                                value: { var: nv.name }
                                                                            })
                                                                        )}
                                                                    class="w-full px-2 py-1 text-left text-[11px] transition-colors hover:bg-(--theme-accent-bg)/15"
                                                                >
                                                                    {nv.name}
                                                                </button>
                                                            {/each}
                                                            <button
                                                                onclick={() =>
                                                                    pickMenu(`${menuBase}#val`, () =>
                                                                        updateOp(entry, i, { value: { const: 1 } })
                                                                    )}
                                                                class="w-full border-t px-2 py-1 text-left text-[11px] text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-accent-bg)/15"
                                                                style="border-color: var(--theme-divider-border);"
                                                            >
                                                                改用常量
                                                            </button>
                                                        </div>
                                                    {/if}
                                                </div>
                                            {:else}
                                                <input
                                                    type="number"
                                                    value={op.value && 'const' in op.value ? Number(op.value.const) : 1}
                                                    onchange={(e) =>
                                                        updateOp(entry, i, {
                                                            value: { const: Number(e.currentTarget.value) || 0 }
                                                        })}
                                                    disabled={locked}
                                                    class="w-16 shrink-0 border px-1 py-0.5 text-right text-[11px] tabular-nums outline-none disabled:opacity-60"
                                                    style="background: var(--theme-card-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                                                />
                                                {#if numVars.length > 0}
                                                    <button
                                                        onclick={() =>
                                                            updateOp(entry, i, { value: { var: numVars[0].name } })}
                                                        disabled={locked}
                                                        class="shrink-0 border border-transparent px-1 py-0.5 text-[10px] text-(--theme-modal-text)/45 transition-colors hover:border-(--theme-accent-bg) hover:text-(--theme-accent-text) disabled:opacity-40"
                                                        title="改为引用另一个计数变量"
                                                    >
                                                        变量
                                                    </button>
                                                {/if}
                                            {/if}
                                        {/if}

                                        <button
                                            onclick={() => removeOp(entry, i)}
                                            disabled={locked}
                                            class="shrink-0 p-0.5 text-(--theme-modal-text)/35 transition-colors hover:text-red-400 disabled:opacity-40"
                                            title="删除这条写入"
                                        >
                                            <Icon icon="mdi:close" class="size-3.5" />
                                        </button>
                                    </div>
                                {/each}

                                <div class="flex items-center gap-2">
                                    <button
                                        onclick={() => addOp(entry)}
                                        disabled={locked || vars.length === 0}
                                        class="flex items-center gap-1 border px-1.5 py-0.5 text-[10px] transition-colors hover:border-(--theme-accent-bg) disabled:opacity-30"
                                        style="border-color: var(--theme-divider-border); color: var(--theme-modal-text)/70;"
                                        title={vars.length === 0
                                            ? '请先在「变量管理」中创建变量'
                                            : '为该段新增一条变量写入'}
                                    >
                                        <Icon icon="mdi:plus" class="size-3" />新增写入
                                    </button>
                                    {#if ops.length === 0}
                                        <span class="text-[10px] text-(--theme-modal-text)/30">该段不改变任何变量</span>
                                    {:else}
                                        <span class="truncate text-[10px] text-(--theme-modal-text)/35"
                                            >{ops.map(describeOp).join('，')}</span
                                        >
                                    {/if}
                                </div>
                            </div>
                        </div>
                    {/each}
                </div>
            {/each}

            {#if damageEntries.length === 0}
                <div class="flex h-40 flex-col items-center justify-center gap-2 text-sm text-(--theme-modal-text)/40">
                    <Icon icon="mdi:table-question" class="size-9" />
                    当前没有可配置的伤害倍率：先在排轴页给角色放置伤害块
                </div>
            {/if}
        </div>
    </div>
</Modal>
