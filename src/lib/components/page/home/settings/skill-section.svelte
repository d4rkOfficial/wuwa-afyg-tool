<script lang="ts">
    /** @desc 设置 → AI助手 → 技能：技能卡管理（启用开关 / 新建 / 编辑 / 删除 / 导入导出 JSON）。
     *  由助手头部 ⚡ 面板迁移而来；主动/被动类型与工具名快速输入见编辑弹窗。 */
    import { onMount } from 'svelte'
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import EmptyState from '$lib/components/ui/empty-state.svelte'
    import Chip from '$lib/components/ui/chip.svelte'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import SkillEditModal from './ai-skill-edit-modal.svelte'
    import {
        deleteSkill,
        getSkills,
        importSkills,
        loadSkills,
        toggleSkillEnabled,
        type AiSkill
    } from '$lib/data/ai-skills.svelte'
    import { SKILL_MODE_LABELS } from '$lib/ai/skills'
    import { addToast } from '$lib/data/toast.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import { ROW_TABS, TAB_ACCENT } from './utils'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    let skills = $derived(getSkills())
    let editing = $state<AiSkill | null>(null)
    let editorOpen = $state(false)
    let importInput: HTMLInputElement | undefined = $state()

    const enabledCount = $derived(skills.filter((s) => s.enabled).length)

    /**
     * @desc 逐行启停（T15）：原来是 `mdi:toggle-switch` 图标按钮，与编辑弹窗里那个手搓 toggle 按钮
     * 是**同一个概念的两套实现**，现统一为 `ui/tabs` 的两段文字 tab（启用｜禁用）。
     * 轨道宽度取设置内统一的 `ROW_TABS`（`./utils`），原先这里是 `w-28`。
     */
    const ENABLED_TABS = [
        { value: 'on', label: '启用' },
        { value: 'off', label: '禁用' }
    ]

    /** @desc 次要动作按钮的统一规格（导出 / 导入 这一族；`bare` 档的 `ui/Button` 不带焦点层，故自带 outline） */
    const ACTION_BTN =
        'h-7 shrink-0 gap-1 rounded-none border border-(--theme-divider-border) px-2.5 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text) focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-(--theme-accent-bg)'

    onMount(() => {
        void loadSkills()
    })

    const openEditor = (skill?: AiSkill) => {
        editing = skill ?? null
        editorOpen = true
    }

    const closeEditor = () => {
        editorOpen = false
        editing = null
    }

    const handleDelete = async (skill: AiSkill) => {
        if (skill.builtin) {
            addToast('内置技能不可删除，可改为禁用', 'info')
            return
        }
        if (await deleteSkill(skill.id)) addToast('技能已删除', 'info')
    }

    const exportSkills = () => {
        const payload = JSON.stringify({ kind: 'wuwa-afyg-skills', skills }, null, 2)
        const blob = new Blob([payload], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `椰果工具箱-技能-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
        addToast('技能已导出', 'success')
    }

    const handleImport = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        try {
            const raw = JSON.parse(await file.text()) as { skills?: AiSkill[] } | AiSkill[]
            const list = Array.isArray(raw) ? raw : Array.isArray(raw?.skills) ? raw.skills : []
            const count = await importSkills(list)
            addToast(
                count > 0 ? `已导入 ${count} 个技能` : '没有可导入的新技能（同名跳过）',
                count > 0 ? 'success' : 'info'
            )
        } catch {
            addToast('导入失败：文件不是合法的技能 JSON', 'error')
        }
        if (importInput) importInput.value = ''
    }
</script>

<div class={mergeClass(['flex flex-col gap-2', className])} style={styleProp}>
    <div class="flex items-start gap-2">
        <Icon
            icon="mdi:lightning-bolt-outline"
            class="mt-0.5 size-4 shrink-0"
            style="color: var(--theme-accent-text);"
        />
        <div class="min-w-0 flex-1 text-xs leading-5 text-(--theme-modal-text)/60">
            <span class="font-black text-(--theme-modal-text)/80">技能</span>
            是给助手的操作规范：<span class="text-(--theme-accent-text)">主动</span>技能由助手判断需要时启用，
            <span class="text-(--theme-accent-text)">被动</span
            >技能每轮都会生效。内置技能可改描述、正文与启停，但不能删除。
        </div>
    </div>

    <div class="flex items-center gap-1.5">
        <span class="text-[10px] tabular-nums text-(--theme-modal-text)/40">
            {enabledCount}/{skills.length} 启用
        </span>
        <div class="flex-1"></div>
        <Button
            variant="icon-text"
            size="none"
            bare
            onclick={() => openEditor()}
            backgroundImage="var(--theme-accent-bg)"
            textColor="var(--theme-accent-text-on-bg)"
            class="h-7 gap-1 px-2.5 text-xs font-medium transition-all hover:brightness-110"
        >
            <Icon icon="mdi:plus" class="size-3.5" />
            新建技能
        </Button>
        <Button
            variant="icon-text"
            size="none"
            bare
            onclick={exportSkills}
            class={ACTION_BTN}
            title="导出全部技能为 JSON"
        >
            <Icon icon="mdi:download-outline" class="size-3.5" />
            导出
        </Button>
        <input
            type="file"
            accept=".json,application/json"
            class="hidden"
            bind:this={importInput}
            onchange={handleImport}
        />
        <Button
            variant="icon-text"
            size="none"
            bare
            onclick={() => importInput?.click()}
            class={ACTION_BTN}
            title="从 JSON 导入技能（同名跳过）"
        >
            <Icon icon="mdi:upload-outline" class="size-3.5" />
            导入
        </Button>
    </div>

    <div class="space-y-1.5">
        {#each skills as skill (skill.id)}
            <div
                class="sf-radius flex items-center gap-2 border px-2.5 py-1.5"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                <Tabs
                    items={ENABLED_TABS}
                    value={skill.enabled ? 'on' : 'off'}
                    onchange={(v) => {
                        if ((v === 'on') !== skill.enabled) void toggleSkillEnabled(skill.id)
                    }}
                    compact
                    class={ROW_TABS}
                    backgroundImage="var(--theme-accent-bg)"
                    textColor="var(--theme-accent-text-on-bg)"
                />
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                        <span class="truncate text-xs font-black tracking-tight">{skill.name}</span>
                        <Chip
                            class={skill.mode === 'passive'
                                ? 'shrink-0 bg-(--theme-accent-bg)/20 text-(--theme-accent-text)'
                                : 'shrink-0 text-(--theme-modal-text)/50'}
                            style={skill.mode === 'active'
                                ? 'background: color-mix(in srgb, var(--theme-modal-text) 10%, transparent);'
                                : ''}
                        >
                            {SKILL_MODE_LABELS[skill.mode]}
                        </Chip>
                        {#if skill.builtin}
                            <span class="shrink-0 text-[10px] text-(--theme-modal-text)/40">内置</span>
                        {/if}
                        {#if !skill.enabled}
                            <span class="shrink-0 text-[10px] text-(--theme-modal-text)/40">已禁用</span>
                        {/if}
                    </div>
                    <div class="truncate text-[10px] text-(--theme-modal-text)/40">
                        {skill.description || '（无描述）'}
                    </div>
                </div>
                <button
                    onclick={() => openEditor(skill)}
                    class="shrink-0 rounded-none p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-accent-text)"
                    title="编辑（名称 / 描述 / 正文 / 类型 / 启停）"
                >
                    <Icon icon="mdi:pencil-outline" class="size-3.5" />
                </button>
                {#if !skill.builtin}
                    <button
                        onclick={() => handleDelete(skill)}
                        class="shrink-0 rounded-none p-1 text-(--theme-modal-text)/40 transition-colors hover:text-red-400"
                        title="删除"
                    >
                        <Icon icon="mdi:delete-outline" class="size-3.5" />
                    </button>
                {/if}
            </div>
        {/each}
        {#if skills.length === 0}
            <EmptyState size="sm">暂无技能卡，点「新建技能」添加</EmptyState>
        {/if}
    </div>

    <p class="text-[10px] leading-4 text-(--theme-modal-text)/35">
        导出格式为 <span class="font-mono">{'{ kind: "wuwa-afyg-skills", skills: [...] }'}</span
        >，导入时同名技能自动跳过。
    </p>
</div>

{#if editorOpen}
    <SkillEditModal open skill={editing} onclose={closeEditor} onsaved={closeEditor} />
{/if}
