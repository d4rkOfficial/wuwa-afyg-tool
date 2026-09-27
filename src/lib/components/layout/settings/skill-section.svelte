<script lang="ts">
    /** @desc 设置 → AI助手 → 技能：技能卡管理（启用开关 / 新建 / 编辑 / 删除 / 导入导出 JSON）。
     *  由助手头部 ⚡ 面板迁移而来；主动/被动类型与工具名快速输入见编辑弹窗。 */
    import { onMount } from 'svelte'
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import SkillEditModal from '$lib/components/layout/ai-skill-edit-modal.svelte'
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

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    let skills = $derived(getSkills())
    let editing = $state<AiSkill | null>(null)
    let editorOpen = $state(false)
    let importInput: HTMLInputElement | undefined = $state()

    const enabledCount = $derived(skills.filter((s) => s.enabled).length)

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

<div class={['space-y-2', className].join(' ')} style={styleProp}>
    <div class="flex items-start gap-2">
        <Icon
            icon="mdi:lightning-bolt-outline"
            class="mt-0.5 size-4 shrink-0"
            style="color: var(--theme-accent-text);"
        />
        <div class="min-w-0 flex-1 text-xs leading-relaxed text-(--theme-modal-text)/60">
            <span class="font-black text-(--theme-modal-text)/80">技能</span>
            是预置的操作规范：<span class="text-(--theme-accent-text)">主动</span>技能只把名称与描述列给助手，
            匹配时由助手调用 <span class="font-mono">use_skill</span> 激活正文；
            <span class="text-(--theme-accent-text)">被动</span>技能每轮直接注入正文，常驻生效。
        </div>
    </div>

    <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-(--theme-modal-text)/40">
            {enabledCount}/{skills.length} 启用 · 内置技能不可删除，可改描述 / 正文 / 类型与启停
        </span>
        <div class="flex-1"></div>
        <button
            onclick={() => openEditor()}
            class="inline-flex shrink-0 items-center gap-1 rounded-none px-2.5 py-1 text-[10px] font-medium transition-all hover:brightness-110"
            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
        >
            <Icon icon="mdi:plus" class="size-3" />
            新建技能
        </button>
        <button
            onclick={exportSkills}
            class="inline-flex shrink-0 items-center gap-1 rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
            style="border-color: var(--theme-divider-border);"
            title="导出全部技能为 JSON"
        >
            <Icon icon="mdi:download-outline" class="size-3" />
            导出
        </button>
        <input
            type="file"
            accept=".json,application/json"
            class="hidden"
            bind:this={importInput}
            onchange={handleImport}
        />
        <button
            onclick={() => importInput?.click()}
            class="inline-flex shrink-0 items-center gap-1 rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
            style="border-color: var(--theme-divider-border);"
            title="从 JSON 导入技能（同名跳过）"
        >
            <Icon icon="mdi:upload-outline" class="size-3" />
            导入
        </button>
    </div>

    <div class="space-y-1.5">
        {#each skills as skill (skill.id)}
            <div
                class="flex items-center gap-2 border px-2.5 py-1.5"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                <button
                    onclick={() => toggleSkillEnabled(skill.id)}
                    class="shrink-0 rounded-none p-0.5 transition-colors {skill.enabled
                        ? 'text-(--theme-accent-text)'
                        : 'text-(--theme-modal-text)/25'}"
                    title={skill.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
                >
                    <Icon
                        icon={skill.enabled ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off-outline'}
                        class="size-4.5"
                    />
                </button>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                        <span class="truncate text-xs font-black tracking-tight">{skill.name}</span>
                        <span
                            class="shrink-0 rounded-none px-1 py-px text-[9px] {skill.mode === 'passive'
                                ? 'bg-(--theme-accent-bg)/20 text-(--theme-accent-text)'
                                : 'text-(--theme-modal-text)/45'}"
                            style={skill.mode === 'active'
                                ? 'background: color-mix(in srgb, var(--theme-modal-text) 10%, transparent);'
                                : ''}
                        >
                            {SKILL_MODE_LABELS[skill.mode]}
                        </span>
                        {#if skill.builtin}
                            <span class="shrink-0 text-[9px] text-(--theme-modal-text)/35">内置</span>
                        {/if}
                        {#if !skill.enabled}
                            <span class="shrink-0 text-[9px] text-(--theme-modal-text)/35">已禁用</span>
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
            <div
                class="border px-2.5 py-2 text-[11px] text-(--theme-modal-text)/35"
                style="border-color: var(--theme-divider-border);"
            >
                暂无技能卡，点「新建技能」添加
            </div>
        {/if}
    </div>

    <p class="text-[10px] text-(--theme-modal-text)/35">
        导出格式为 <span class="font-mono">{'{ kind: "wuwa-afyg-skills", skills: [...] }'}</span
        >，导入时同名技能自动跳过。
    </p>
</div>

{#if editorOpen}
    <SkillEditModal open skill={editing} onclose={closeEditor} onsaved={closeEditor} />
{/if}
