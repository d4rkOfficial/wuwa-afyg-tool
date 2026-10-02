<script lang="ts">
    /**
     * @desc 设置 → 归档管理（Phase 5.1 第三增量：自 `settings-modal.svelte` 原样抽出，标记与行为未改）。
     * 迁移说明：
     *   - `archiveDeleteTarget`（原外壳的 `confirmDelete`）、`closeArchiveDelete`、`doArchiveDelete`
     *     落在 `settings-ui.svelte.ts`：永久删除确认弹窗必须留在外壳（`fixed` 覆盖层不能放进设置面板内容区），
     *     而「关闭二次确认时直接删除」的路径在本组件，两边共用同一份状态与同一个删除实现。
     *   - `weaponIcons` / `echoIcons` / `setIcons` 也落在 store：原外壳在**挂载时**（与是否打开设置无关）
     *     就预取这三张图标表，该预取 `$effect` 仍留在外壳以保持原时序；若把状态留在本组件，
     *     TabPanel 的 `{#key active}` 会让每次切回归档 tab 都重新预取一次，属行为变化。
     *   - `charIconMap` 只是全局 store `$lib/calc/timeline.store.svelte` 的 $derived 视图（非自有状态），随本组件留下。
     *   - `handleArchiveDelete` 在搬迁前就**已无人调用**（死代码）：归档专属，故原样带走，未删除、未改写。
     */
    import Icon from '@iconify/svelte'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import { getCharIconMap } from '$lib/calc/timeline.store.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        buildExportFile,
        deleteProject,
        getArchivedProjects,
        getPhaseOrder,
        unarchiveProject
    } from '$lib/data/project.svelte'
    import { getShareLink } from '$lib/data/share.svelte'
    import { getConfirmDeletes } from '$lib/data/interaction-prefs.svelte'
    import {
        doArchiveDelete,
        getArchiveEchoIcons,
        getArchiveEchoSetIcons,
        getArchiveWeaponIcons,
        setArchiveDeleteTarget
    } from '../settings-ui.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    const archivedProjects = $derived(getArchivedProjects())

    // ── 归档卡片工程信息（角色/武器/声骸/套装 图标）──
    const charIconMap = $derived(getCharIconMap())
    /** @desc 三张图标表由外壳挂载时预取（原时序不变），此处只读视图 */
    const weaponIcons = $derived(getArchiveWeaponIcons())
    const echoIcons = $derived(getArchiveEchoIcons())
    const setIcons = $derived(getArchiveEchoSetIcons())

    async function handleUnarchive(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        await unarchiveProject(id)
        addToast(`工程「${p.name}」已取消归档`, 'success')
    }

    function openArchiveDelete(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        setArchiveDeleteTarget({ id, name: p.name })
        if (!getConfirmDeletes()) void doArchiveDelete()
    }

    function handleArchiveExport(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        const file = buildExportFile(p, getPhaseOrder(), true)
        const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${p.name}.json`
        a.click()
        URL.revokeObjectURL(url)
        addToast(`工程「${p.name}」已导出`, 'success')
    }

    async function handleArchiveShare(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        addToast('正在生成分享链接...', 'info')
        const link = await getShareLink(p)
        if (!link) {
            addToast('分享失败', 'error')
            return
        }
        try {
            await navigator.clipboard.writeText(link)
            addToast('已分享(10分钟)，链接已复制到剪贴板', 'success')
        } catch {
            addToast('已分享(10分钟)，请在地址栏查看导入链接', 'success')
        }
    }

    async function handleArchiveDelete(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        await deleteProject(id)
        addToast(`工程「${p.name}」已永久删除`, 'info')
    }

    function formatArchiveDate(ts: number): string {
        return new Date(ts).toLocaleString()
    }
</script>

<!-- Archive management -->
<div class={mergeClass([className])} style={styleProp}>
    <SectionTitle>
        <Icon icon="mdi:archive-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        归档管理
    </SectionTitle>
    <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
        已归档的工程不会出现在侧边栏，可取消归档恢复、全量导出、分享或永久删除
    </p>
    {#if archivedProjects.length === 0}
        <div
            class="flex flex-col items-center justify-center gap-2 rounded-none border-2 border-dashed px-4 py-10"
            style="border-color: var(--theme-divider-border);"
        >
            <Icon icon="mdi:archive-outline" class="size-8 text-(--theme-modal-text)/20" />
            <span class="text-xs text-(--theme-modal-text)/40">暂无归档的工程</span>
        </div>
    {:else}
        <div class="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
            {#each archivedProjects as p (p.id)}
                {@const avatars = p.team.map((s) => (s.character ? charIconMap[s.character] : undefined))}
                <div
                    class="group relative overflow-hidden border-2 p-4 transition-colors hover:border-(--theme-accent-bg) hover:bg-(--theme-card-bg-focused)"
                    style="border-color: var(--theme-card-border); background: var(--theme-card-bg);"
                >
                    <!-- 角色头像叠底（右下：1号大→3号小，向右递减；半透明 + 边缘淡出） -->
                    {#if avatars[2]}
                        <div
                            class="pointer-events-none absolute -bottom-3 right-36 z-0 size-16 opacity-40"
                            style="-webkit-mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); -webkit-mask-composite: source-in; mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); mask-composite: intersect;"
                        >
                            <img src={avatars[2]} alt="" class="size-full object-cover" />
                        </div>
                    {/if}
                    {#if avatars[1]}
                        <div
                            class="pointer-events-none absolute -bottom-3 right-[4.5rem] z-0 size-24 opacity-40"
                            style="-webkit-mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); -webkit-mask-composite: source-in; mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); mask-composite: intersect;"
                        >
                            <img src={avatars[1]} alt="" class="size-full object-cover" />
                        </div>
                    {/if}
                    {#if avatars[0]}
                        <div
                            class="pointer-events-none absolute -bottom-3 right-0 z-0 size-32 opacity-40"
                            style="-webkit-mask-image: linear-gradient(to bottom, transparent, #000 40%); mask-image: linear-gradient(to bottom, transparent, #000 40%);"
                        >
                            <img src={avatars[0]} alt="" class="size-full object-cover" />
                        </div>
                    {/if}

                    <div class="relative z-10 flex items-baseline gap-2">
                        <h4
                            class="min-w-0 flex-1 truncate text-base font-black leading-tight tracking-tight text-(--theme-modal-text) [text-shadow:0_0_3px_var(--theme-halo-color)]"
                        >
                            {p.name}
                        </h4>
                        <span class="shrink-0 text-[10px] tracking-[0.22em] text-(--theme-muted-text)"
                            >{formatArchiveDate(p.createdAt)}</span
                        >
                    </div>

                    <!-- 工程信息：三角色配装（武器 / 首位声骸 / 套装 图标）-->
                    <div
                        class="relative z-10 mt-3 flex flex-col gap-1.5 border-t pt-3"
                        style="border-color: var(--theme-divider-border);"
                    >
                        {#each p.team as slot, si (si)}
                            {#if slot.character}
                                <div class="flex flex-wrap items-center gap-1.5 text-[10px]" title={slot.character}>
                                    {#if slot.weapon}
                                        <span
                                            class="inline-flex items-center gap-1 border px-1.5 py-0.5 text-(--theme-modal-text)/65"
                                            style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-text) 5%, transparent);"
                                        >
                                            {#if weaponIcons[slot.weapon]}
                                                <img
                                                    src={weaponIcons[slot.weapon]}
                                                    alt=""
                                                    class="size-3.5 object-contain"
                                                />
                                            {/if}
                                            {slot.weapon}
                                        </span>
                                    {/if}
                                    {#if slot.echoes?.[0]?.name}
                                        <span
                                            class="inline-flex items-center gap-1 border px-1.5 py-0.5 text-(--theme-modal-text)/65"
                                            style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-text) 5%, transparent);"
                                            title="首位声骸"
                                        >
                                            {#if echoIcons[slot.echoes[0].name]}
                                                <img
                                                    src={echoIcons[slot.echoes[0].name]}
                                                    alt=""
                                                    class="size-3.5 rounded-full object-cover"
                                                />
                                            {/if}
                                            {slot.echoes[0].name}
                                        </span>
                                    {/if}
                                    {#each slot.triggerSets as ts, ti (ti)}
                                        <span
                                            class="inline-flex items-center gap-1 border px-1.5 py-0.5 text-(--theme-modal-text)/65"
                                            style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-text) 5%, transparent);"
                                        >
                                            {#if setIcons[ts.name]}
                                                <img
                                                    src={setIcons[ts.name]}
                                                    alt=""
                                                    class="size-3.5 rounded-full object-cover"
                                                />
                                            {/if}
                                            {ts.pieces}件
                                        </span>
                                    {/each}
                                </div>
                            {/if}
                        {/each}
                    </div>

                    <div
                        class="relative z-10 mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2.5"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <button
                            onclick={() => handleUnarchive(p.id)}
                            class="flex items-center gap-1 rounded-none px-2 py-0.5 text-[10px] transition-colors text-(--theme-accent-text) hover:brightness-125"
                            style="background: color-mix(in srgb, var(--theme-accent-bg) 14%, transparent);"
                        >
                            <Icon icon="mdi:archive-arrow-up-outline" class="size-3" />
                            取消归档
                        </button>
                        <button
                            onclick={() => handleArchiveExport(p.id)}
                            class="flex items-center gap-1 rounded-none border px-2 py-0.5 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <Icon icon="mdi:file-export" class="size-3" />
                            导出
                        </button>
                        <button
                            onclick={() => handleArchiveShare(p.id)}
                            class="flex items-center gap-1 rounded-none border px-2 py-0.5 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <Icon icon="mdi:share-variant" class="size-3" />
                            分享(10分钟)
                        </button>
                        <button
                            onclick={() => openArchiveDelete(p.id)}
                            class="flex items-center gap-1 rounded-none border px-2 py-0.5 text-[10px] text-(--theme-modal-text)/40 transition-colors hover:border-red-500/50 hover:text-red-500"
                            style="border-color: var(--theme-divider-border);"
                            title="永久删除，不可恢复"
                        >
                            <Icon icon="mdi:delete-outline" class="size-3" />
                            永久删除
                        </button>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
