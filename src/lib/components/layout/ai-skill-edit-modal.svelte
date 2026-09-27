<script lang="ts">
    /** @desc 技能编辑弹窗（新建 / 编辑）：名称、描述、正文、类型（主动 / 被动）、启停，
     *  右侧复用 ToolPicker 在正文光标处插入工具名（与提示词编辑同款）。 */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import ToolPicker from '$lib/components/layout/tool-picker.svelte'
    import { addSkill, updateSkill, type AiSkill, type SkillMode } from '$lib/data/ai-skills.svelte'
    import { SKILL_MODE_HINTS, SKILL_MODE_LABELS } from '$lib/ai/skills'
    import { insertTextAt } from '$lib/utils/text-insert'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props extends ComponentsProps {
        open: boolean
        /** @desc 编辑目标（null / 省略 = 新建） */
        skill?: AiSkill | null
        onclose?: () => void
        onsaved?: (skill: AiSkill) => void
    }

    let { open, skill = null, onclose, onsaved, class: className, style: styleProp }: Props = $props()

    const MODE_OPTIONS: SkillMode[] = ['active', 'passive']

    let draft = $state({ name: '', description: '', body: '', enabled: true, mode: 'active' as SkillMode })
    let bodyEl = $state<HTMLTextAreaElement | null>(null)

    const isNew = $derived(!skill)
    const isBuiltin = $derived(!!skill?.builtin)
    const titleText = $derived(isNew ? '新建技能' : `编辑技能「${skill?.name ?? ''}」`)

    $effect(() => {
        if (!open) return
        draft = skill
            ? {
                  name: skill.name,
                  description: skill.description,
                  body: skill.body,
                  enabled: skill.enabled,
                  mode: skill.mode
              }
            : { name: '', description: '', body: '', enabled: true, mode: 'active' }
    })

    /** @desc 把工具名插入正文光标处（与提示词编辑同一套 insertTextAt） */
    const insertTool = (name: string) => {
        const ta = bodyEl
        const next = insertTextAt(draft.body, name, ta?.selectionStart, ta?.selectionEnd)
        draft.body = next.text
        requestAnimationFrame(() => {
            ta?.focus()
            ta?.setSelectionRange(next.cursor, next.cursor)
        })
    }

    const handleSave = async () => {
        const name = draft.name.trim()
        if (!name) {
            addToast('请填写技能名', 'info')
            return
        }
        if (skill) {
            const ok = await updateSkill(skill.id, { ...draft, name })
            if (!ok) {
                addToast('技能名重复或为空', 'error')
                return
            }
            addToast('技能已更新', 'success')
            onsaved?.({ ...skill, ...draft, name })
        } else {
            const created = await addSkill({ ...draft, name })
            if (!created) {
                addToast('技能名重复或为空', 'error')
                return
            }
            addToast('技能已创建', 'success')
            onsaved?.(created)
        }
        onclose?.()
    }
</script>

<Modal {open} {onclose} backdropClose={false} class={className} style="width: min(96vw, 1180px); {styleProp || ''}">
    {#snippet title()}
        <Icon icon="mdi:lightning-bolt-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span class="font-black tracking-tight">{titleText}</span>
        {#if isBuiltin}
            <span class="rounded-none bg-(--theme-accent-bg)/15 px-1.5 py-px text-[10px] text-(--theme-accent-text)"
                >内置</span
            >
        {/if}
    {/snippet}

    {#snippet footer()}
        <div
            class="flex items-center justify-between gap-2 border-t pt-3"
            style="border-color: var(--theme-divider-border);"
        >
            <span class="text-[10px] text-(--theme-modal-text)/40">
                {isBuiltin ? '内置技能不可删除，可改描述 / 正文 / 类型与启停' : '技能名唯一，用于助手激活'}
            </span>
            <div class="flex items-center gap-2">
                <button
                    onclick={onclose}
                    class="inline-flex h-7 items-center rounded-none border px-2.5 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                    style="border-color: var(--theme-divider-border);"
                >
                    取消
                </button>
                <button
                    onclick={handleSave}
                    class="inline-flex h-7 items-center gap-1.5 rounded-none px-2.5 text-[10px] font-medium transition-all hover:brightness-110"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                >
                    <Icon icon="mdi:content-save-outline" class="size-3" />
                    保存
                </button>
            </div>
        </div>
    {/snippet}

    <div class="flex gap-3">
        <div class="flex min-w-0 flex-1 flex-col gap-2">
            <div class="flex gap-2">
                <label class="flex min-w-0 flex-1 flex-col gap-1">
                    <span class="text-[10px] font-black tracking-tight text-(--theme-modal-text)/60">技能名</span>
                    <input
                        bind:value={draft.name}
                        placeholder="技能名（唯一）"
                        class="w-full rounded-none border px-2.5 py-1.5 text-xs outline-none transition-colors"
                        style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                    />
                </label>
                <div class="flex shrink-0 flex-col gap-1">
                    <span class="text-[10px] font-black tracking-tight text-(--theme-modal-text)/60">类型</span>
                    <div
                        class="flex gap-1 rounded-none border p-0.5"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        {#each MODE_OPTIONS as mode (mode)}
                            <button
                                onclick={() => (draft.mode = mode)}
                                class="rounded-none px-2.5 py-1 text-[11px] font-medium transition-colors"
                                style={draft.mode === mode
                                    ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);'
                                    : 'color: color-mix(in srgb, var(--theme-modal-text) 60%, transparent);'}
                                title={SKILL_MODE_HINTS[mode]}
                            >
                                {SKILL_MODE_LABELS[mode]}
                            </button>
                        {/each}
                    </div>
                </div>
                <div class="flex shrink-0 flex-col gap-1">
                    <span class="text-[10px] font-black tracking-tight text-(--theme-modal-text)/60">启用</span>
                    <button
                        onclick={() => (draft.enabled = !draft.enabled)}
                        class="flex h-8 items-center gap-1.5 rounded-none border px-2.5 text-[11px] transition-colors"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg); color: {draft.enabled
                            ? 'var(--theme-accent-text)'
                            : 'color-mix(in srgb, var(--theme-modal-text) 45%, transparent)'};"
                        title={draft.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
                    >
                        <Icon
                            icon={draft.enabled ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off-outline'}
                            class="size-4 shrink-0"
                        />
                        {draft.enabled ? '已启用' : '已禁用'}
                    </button>
                </div>
            </div>

            <label class="flex flex-col gap-1">
                <span class="text-[10px] font-black tracking-tight text-(--theme-modal-text)/60">
                    一句话描述{draft.mode === 'passive' ? '（被动技能不参与清单，仅作备注）' : ''}
                </span>
                <input
                    bind:value={draft.description}
                    placeholder={draft.mode === 'passive'
                        ? '备注：这张卡是什么口径'
                        : '一句话描述（助手据此判断何时激活）'}
                    class="w-full rounded-none border px-2.5 py-1.5 text-xs outline-none transition-colors"
                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                />
            </label>

            <label class="flex min-h-0 flex-1 flex-col gap-1">
                <span class="text-[10px] font-black tracking-tight text-(--theme-modal-text)/60">
                    技能正文{draft.mode === 'passive' ? '（每轮直接注入 system，常驻生效）' : '（被激活后注入 system）'}
                </span>
                <textarea
                    bind:this={bodyEl}
                    bind:value={draft.body}
                    rows="22"
                    placeholder="技能正文（可点击右侧工具名插入）"
                    class="theme-scrollbar w-full flex-1 resize-y rounded-none border px-2.5 py-1.5 text-xs leading-relaxed outline-none transition-colors"
                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                ></textarea>
            </label>

            <p class="text-[10px] text-(--theme-modal-text)/40">{SKILL_MODE_HINTS[draft.mode]}</p>
        </div>

        <!-- 工具名快速输入（与提示词编辑共用 ToolPicker） -->
        <ToolPicker onpick={insertTool} />
    </div>
</Modal>
