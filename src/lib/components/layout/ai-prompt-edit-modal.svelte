<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import {
        defaultPrefsValue,
        getNamingRule,
        getSlangDict,
        getSystemPrompt,
        loadGenPrefs,
        updateGenPrefs
    } from '$lib/data/ai-prefs.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import { GENERATE_TOOLS } from '$lib/ai/generate/tools'
    import { buildTools } from '$lib/ai/tools'

    interface Props extends ComponentsProps {
        open: boolean
        kind: 'naming' | 'persona' | 'slang'
        onclose?: () => void
        onsaved?: () => void
    }

    let {
        open,
        kind,
        onclose,
        onsaved,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp
    }: Props = $props()

    let mergedStyle = $derived(
        [
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )

    let draft = $state('')
    let textareaEl = $state<HTMLTextAreaElement | null>(null)

    $effect(() => {
        if (open) {
            loadGenPrefs().then(() => {
                draft = kind === 'naming' ? getNamingRule() : kind === 'slang' ? getSlangDict() : getSystemPrompt()
            })
        }
    })

    const isNaming = $derived(kind === 'naming')
    const isSlang = $derived(kind === 'slang')

    const titleText = $derived(isNaming ? '编辑 Buff 命名规则' : isSlang ? '编辑黑话词典' : '编辑人设提示词')
    const hintText = $derived(
        isNaming
            ? '生成 Buff 时按此规则命名；清空则每次生成前由 AI 询问你'
            : isSlang
              ? '每行一条：原叫法=黑话（行尾可用 // 注释）；清空则使用默认词典'
              : 'AI 助手的角色与行为规则（system prompt）；清空则使用默认人设'
    )

    // 可调用工具列表（右侧面板，点击插入光标处）
    const toolGroups = $derived([
        {
            label: 'Buff 生成工具',
            items: GENERATE_TOOLS.map((t) => ({ name: t.function.name, desc: t.function.description }))
        },
        { label: '助手工具', items: buildTools().map((t) => ({ name: t.function.name, desc: t.function.description })) }
    ])

    async function handleSave() {
        if (isNaming) {
            await updateGenPrefs({ namingRule: draft })
        } else if (isSlang) {
            await updateGenPrefs({ slangDict: draft })
        } else {
            await updateGenPrefs({ systemPrompt: draft })
        }
        addToast('提示词设置已保存', 'success')
        onsaved?.()
        onclose?.()
    }

    function insertTool(name: string) {
        const ta = textareaEl
        const start = ta?.selectionStart ?? draft.length
        const end = ta?.selectionEnd ?? start
        draft = draft.slice(0, start) + name + draft.slice(end)
        requestAnimationFrame(() => {
            ta?.focus()
            ta?.setSelectionRange(start + name.length, start + name.length)
        })
    }
</script>

<Modal {open} {onclose} backdropClose={false} class={className} style="width: min(92vw, 820px); {mergedStyle}">
    {#snippet title()}
        {titleText}
    {/snippet}

    {#snippet footer()}
        <div
            class="flex items-center justify-between gap-2 border-t pt-3"
            style="border-color: var(--theme-divider-border);"
        >
            <button
                onclick={() => (draft = defaultPrefsValue(kind))}
                title="恢复为默认内容（保存后生效）"
                class="inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                style="background: var(--theme-input-bg);"
            >
                <Icon icon="mdi:restore" class="size-3.5" />
                恢复默认
            </button>
            <div class="flex items-center gap-2">
                <button
                    onclick={onclose}
                    class="h-7 rounded-md px-4 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                    style="background: var(--theme-input-bg);"
                >
                    取消
                </button>
                <button
                    onclick={handleSave}
                    class="inline-flex h-7 items-center gap-1.5 rounded-md px-4 text-xs font-medium transition-all hover:brightness-125"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                >
                    <Icon icon="mdi:content-save-outline" class="size-3.5" />
                    保存
                </button>
            </div>
        </div>
    {/snippet}

    <div class="flex gap-3">
        <div class="flex min-w-0 flex-1 flex-col gap-2">
            <textarea
                bind:this={textareaEl}
                value={draft}
                oninput={(e) => (draft = (e.currentTarget as HTMLTextAreaElement).value)}
                rows="14"
                placeholder={hintText}
                class="theme-scrollbar w-full flex-1 resize-y rounded-lg border px-2.5 py-1.5 text-xs leading-relaxed outline-none transition-colors"
                style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
            ></textarea>
            <p class="text-[10px] text-(--theme-modal-text)/40">{hintText}</p>
        </div>

        <!-- 可调用工具列表 -->
        <div
            class="theme-scrollbar w-40 shrink-0 overflow-y-auto rounded-lg border p-2 max-h-[320px]"
            style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 40%, transparent);"
        >
            <div class="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-(--theme-modal-text)/50">
                <Icon icon="mdi:toolbox-outline" class="size-3" />
                可调用工具
            </div>
            {#each toolGroups as group}
                <div class="mb-1 mt-2 text-[9px] font-semibold uppercase tracking-wider text-(--theme-modal-text)/35">
                    {group.label}
                </div>
                <div class="flex flex-col gap-0.5">
                    {#each group.items as tool}
                        <button
                            onclick={() => insertTool(tool.name)}
                            title={tool.desc}
                            class="truncate rounded px-1.5 py-0.5 text-left font-mono text-[10px] text-(--theme-modal-text)/70 transition-colors hover:bg-(--theme-accent-bg)/15 hover:text-(--theme-accent-text)"
                        >
                            {tool.name}
                        </button>
                    {/each}
                </div>
            {/each}
        </div>
    </div>
</Modal>
