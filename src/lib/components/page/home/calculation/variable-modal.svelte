<script lang="ts">
    /**
     * @desc 「变量」弹窗：管理工程级变量（布尔值 / 计数值）——新增、改名、改初始值、删除。
     * 变量只提供“状态”；判定写在 BUFF 乘区的生效条件里，改写写在「变量写入」弹窗里。
     */
    import Icon from '@iconify/svelte'
    import { slide } from 'svelte/transition'
    import type { ComponentsProps } from '$lib/types'
    import type { CounterVar } from '$lib/types/project'
    import Modal from '$lib/components/layout/modal.svelte'
    import { addVar, getUserVars, isVarNameAvailable, removeVar, updateVar } from '$lib/calc/calculation.store.svelte'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props extends ComponentsProps {
        open: boolean
        locked?: boolean
        onclose: () => void
        onpersist: () => void
    }
    let { open, locked = false, onclose, onpersist, class: className, style: styleProp }: Props = $props()

    let vars = $derived(getUserVars())
    let newName = $state('')
    let newType = $state<CounterVar['type']>('number')
    let newValue = $state('0')
    let editingId = $state<string | null>(null)
    let editName = $state('')

    const HELP_PARAGRAPHS = [
        '变量是工程级状态：布尔值初始为「假」，计数值初始为 0；一次计算从初始值开始，按排轴顺序逐段执行变量写入。',
        '判定用在 BUFF 里：打开 BUFF 配置，每个乘区都可以写自己的生效条件（伤害类型/属性 + 变量判定）。',
        '改写用在伤害上：拉表底部「变量写入」逐个倍率配置该段执行时把变量设为什么值、加多少、乘多少。',
        '角色共鸣链与武器精炼档位在「角色详情配置」里设置，不作为这里的变量出现。'
    ]
    let helpOpen = $state(false)

    const handleAdd = () => {
        if (locked) return
        const name = newName.trim()
        if (!name) {
            addToast('请输入变量名', 'info')
            return
        }
        if (!isVarNameAvailable(name)) {
            addToast('变量名与已有变量重复', 'info')
            return
        }
        const value = newType === 'boolean' ? newValue === 'true' : Number(newValue) || 0
        if (addVar(name, newType, value)) {
            newName = ''
            newValue = newType === 'boolean' ? 'false' : '0'
            onpersist()
            addToast(`变量「${name}」已创建`, 'success')
        }
    }

    const startEdit = (v: CounterVar) => {
        if (locked) return
        editingId = v.id
        editName = v.name
    }
    const commitEdit = (v: CounterVar) => {
        if (editingId !== v.id) return
        const name = editName.trim()
        editingId = null
        if (!name || name === v.name) return
        if (updateVar(v.id, { name })) onpersist()
    }
    const toggleType = (v: CounterVar) => {
        if (locked || v.builtin) return
        if (updateVar(v.id, { type: v.type === 'boolean' ? 'number' : 'boolean' })) onpersist()
    }
    const setValue = (v: CounterVar, value: boolean | number) => {
        if (locked) return
        if (updateVar(v.id, { value })) onpersist()
    }
    const drop = (v: CounterVar) => {
        if (removeVar(v.id)) onpersist()
    }
</script>

<Modal {open} {onclose} class="w-[46rem] max-w-[94vw] {className}" style={styleProp || ''}>
    {#snippet title()}
        <span class="flex items-center gap-2 pr-8">
            <Icon icon="mdi:variable" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <span class="font-black tracking-tight">变量</span>
            <button
                onclick={() => (helpOpen = !helpOpen)}
                class="rounded-none p-0.5 transition-colors {helpOpen
                    ? 'text-(--theme-accent-text)'
                    : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'}"
                title="变量怎么用？"
                aria-label="帮助"
            >
                <Icon icon="mdi:help-circle-outline" class="size-4" />
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
                    变量的用法
                </div>
                {#each HELP_PARAGRAPHS as paragraph (paragraph)}
                    <p>{paragraph}</p>
                {/each}
            </section>
        {/if}

        <!-- 新增 -->
        <div
            class="flex shrink-0 items-center gap-1.5 border px-2 py-2"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <input
                bind:value={newName}
                placeholder="新变量名"
                disabled={locked}
                onkeydown={(e) => e.key === 'Enter' && handleAdd()}
                class="min-w-0 flex-1 border px-2 py-1 text-xs outline-none placeholder:text-(--theme-modal-text)/30 disabled:opacity-60"
                style="border-color: var(--theme-divider-border); background: var(--theme-card-bg); color: var(--theme-modal-text);"
            />
            <button
                onclick={() => {
                    newType = newType === 'boolean' ? 'number' : 'boolean'
                    newValue = newType === 'boolean' ? 'false' : '0'
                }}
                disabled={locked}
                class="shrink-0 border px-2 py-1 text-[11px] font-black transition-colors disabled:opacity-60"
                style="background: var(--theme-card-bg); color: var(--theme-accent-text); border-color: var(--theme-divider-border);"
                title="切换类型"
            >
                {newType === 'boolean' ? '布尔值' : '计数值'}
            </button>
            {#if newType === 'boolean'}
                <button
                    onclick={() => (newValue = newValue === 'true' ? 'false' : 'true')}
                    disabled={locked}
                    class="shrink-0 border px-2 py-1 text-[11px] transition-colors disabled:opacity-60"
                    style="background: var(--theme-card-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                >
                    初始 {newValue === 'true' ? '真' : '假'}
                </button>
            {:else}
                <input
                    type="number"
                    bind:value={newValue}
                    disabled={locked}
                    class="w-20 shrink-0 border px-2 py-1 text-right text-[11px] tabular-nums outline-none disabled:opacity-60"
                    style="border-color: var(--theme-divider-border); background: var(--theme-card-bg); color: var(--theme-modal-text);"
                    title="初始值"
                />
            {/if}
            <button
                onclick={handleAdd}
                disabled={locked}
                class="shrink-0 px-3 py-1 text-[11px] font-black transition-all hover:brightness-110 disabled:opacity-40"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
            >
                新增变量
            </button>
        </div>

        <!-- 列表 -->
        <div class="theme-scrollbar max-h-[52vh] space-y-1 overflow-y-auto pr-1">
            {#each vars as v (v.id)}
                <div
                    class="flex items-center gap-2 border px-2 py-1.5"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <button
                        onclick={() => toggleType(v)}
                        disabled={locked || v.builtin}
                        class="shrink-0 border px-2 py-0.5 text-[10px] font-black transition-colors disabled:opacity-60"
                        style="background: var(--theme-card-bg); color: var(--theme-accent-text); border-color: var(--theme-divider-border);"
                        title={v.builtin ? '内置变量类型不可修改' : '点击切换布尔值 / 计数值'}
                    >
                        {v.type === 'boolean' ? '布尔' : '计数'}
                    </button>

                    {#if editingId === v.id}
                        <!-- svelte-ignore a11y_autofocus -->
                        <input
                            autofocus
                            bind:value={editName}
                            onblur={() => commitEdit(v)}
                            onkeydown={(e) => {
                                if (e.key === 'Enter') commitEdit(v)
                                if (e.key === 'Escape') editingId = null
                            }}
                            class="min-w-0 flex-1 border px-2 py-0.5 text-xs outline-none"
                            style="border-color: var(--theme-accent-bg); background: var(--theme-card-bg); color: var(--theme-modal-text);"
                        />
                    {:else}
                        <button
                            onclick={() => startEdit(v)}
                            disabled={locked}
                            class="min-w-0 flex-1 truncate text-left text-xs text-(--theme-modal-text)/85 transition-colors hover:text-(--theme-accent-text) disabled:opacity-60"
                            title={v.name}
                        >
                            {v.name}
                        </button>
                    {/if}

                    {#if v.type === 'boolean'}
                        <button
                            onclick={() => setValue(v, !v.value)}
                            disabled={locked}
                            class="shrink-0 border px-2 py-0.5 text-[10px] transition-colors disabled:opacity-60"
                            style={v.value
                                ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff); border-color: transparent;'
                                : 'background: var(--theme-card-bg); color: color-mix(in srgb, var(--theme-modal-text) 55%, transparent); border-color: var(--theme-divider-border);'}
                            title="初始值"
                        >
                            初始 {v.value ? '真' : '假'}
                        </button>
                    {:else}
                        <input
                            type="number"
                            value={typeof v.value === 'number' ? v.value : 0}
                            onchange={(e) => setValue(v, Number(e.currentTarget.value) || 0)}
                            disabled={locked}
                            class="w-20 shrink-0 border px-2 py-0.5 text-right text-[11px] tabular-nums outline-none disabled:opacity-60"
                            style="border-color: var(--theme-divider-border); background: var(--theme-card-bg); color: var(--theme-modal-text);"
                            title="初始值"
                        />
                    {/if}

                    {#if v.builtin}
                        <span class="shrink-0 text-(--theme-modal-text)/30" title="内置链/精炼变量，不可删除">
                            <Icon icon="mdi:lock-outline" class="size-3.5" />
                        </span>
                    {:else}
                        <button
                            onclick={() => drop(v)}
                            disabled={locked}
                            class="shrink-0 p-0.5 text-(--theme-modal-text)/35 transition-colors hover:text-red-400 disabled:opacity-40"
                            title="删除变量（同时移除引用它的条件与写入）"
                        >
                            <Icon icon="mdi:delete-outline" class="size-3.5" />
                        </button>
                    {/if}
                </div>
            {/each}

            {#if vars.length === 0}
                <div class="flex h-28 flex-col items-center justify-center gap-2 text-xs text-(--theme-modal-text)/40">
                    <Icon icon="mdi:variable" class="size-7" />
                    还没有变量：上面新增一个布尔值或计数值变量
                </div>
            {/if}
        </div>
    </div>
</Modal>
