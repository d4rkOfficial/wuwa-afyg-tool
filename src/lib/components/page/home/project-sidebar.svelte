<script lang="ts">
    import { untrack } from 'svelte'
    import Icon from '@iconify/svelte'
    import ContextMenu from '$lib/components/layout/context-menu.svelte'
    import type { Project, PhaseKey } from '$lib/data/types'
    import { setActiveTheme, getActiveId as getActiveThemeId, getThemes } from '$lib/theme'
    import { addToast } from '$lib/data/toast.svelte'
    import { getCharElementMap } from '$lib/data/char-elements.svelte'
    import { shortName } from '$lib/utils/character'
    import { slide } from 'svelte/transition'
    import favicon from '$lib/assets/favicon.svg'

    interface Props {
        projects: Project[]
        activeId: string
        width?: number
        dragging?: boolean
        oncreate: () => void
        onimport: () => void
        onhome: () => void
        onrename: (id: string) => void
        onclone: (id: string) => void
        onexport: (id: string) => void
        ondelete: (id: string) => void
        onselect: (id: string) => void
    }

    let {
        projects,
        activeId,
        width = 240,
        dragging = false,
        oncreate,
        onimport,
        onhome,
        onrename,
        onclone,
        onexport,
        ondelete,
        onselect
    }: Props = $props()

    let ctxMenuOpen = $state(false)
    let ctxX = $state(0)
    let ctxY = $state(0)
    let ctxTargetId = $state<string | null>(null)
    let expandedKeys = $state<Set<string>>(new Set())
    let hoveredHeaderKey = $state<string | null>(null)

    let compact = $derived(width <= 144)

    function handleContextMenu(e: MouseEvent, id: string) {
        e.preventDefault()
        ctxTargetId = id
        ctxX = e.clientX
        ctxY = e.clientY
        ctxMenuOpen = true
    }

    let ctxMenuItems = $derived([
        {
            label: '重命名',
            icon: 'mdi:rename-outline',
            action: () => {
                if (ctxTargetId) onrename(ctxTargetId)
            }
        },
        {
            label: '复制',
            icon: 'mdi:content-copy',
            action: () => {
                if (ctxTargetId) onclone(ctxTargetId)
            }
        },
        {
            label: '导出',
            icon: 'mdi:file-export',
            action: () => {
                if (ctxTargetId) onexport(ctxTargetId)
            }
        },
        {
            label: '删除',
            icon: 'mdi:delete-outline',
            action: () => {
                if (ctxTargetId) ondelete(ctxTargetId)
            }
        }
    ])

    let currentTheme = $derived(getActiveThemeId())

    function selectProject(id: string) {
        onselect(id)
    }

    let charElementMap = $derived(getCharElementMap())

    let activeGroupKey = $derived.by(() => {
        const p = projects.find((p) => p.id === activeId)
        return p?.lockedTeamKey ?? null
    })

    function charColor(name: string): string {
        const el = charElementMap[name]
        return el ? `var(--theme-element-${el})` : '#888'
    }

    interface TeamGroup {
        key: string
        displayNames: string[]
        projects: Project[]
    }

    let grouped = $derived.by(() => {
        const map = new Map<string, TeamGroup>()
        const raw: Project[] = []

        for (const p of projects) {
            if (p.lockedTeamKey) {
                if (!map.has(p.lockedTeamKey)) {
                    map.set(p.lockedTeamKey, {
                        key: p.lockedTeamKey,
                        displayNames: p.lockedTeamNames ?? [],
                        projects: []
                    })
                }
                map.get(p.lockedTeamKey)!.projects.push(p)
            } else {
                raw.push(p)
            }
        }

        const sortedGroups = [...map.values()].sort((a, b) => b.projects[0].createdAt - a.projects[0].createdAt)
        raw.sort((a, b) => b.createdAt - a.createdAt)

        return { groups: sortedGroups, ungrouped: raw }
    })

    let prevActiveId = $state(activeId)

    $effect(() => {
        const current = activeId
        if (current !== prevActiveId) {
            prevActiveId = current
            const activeProject = untrack(() => projects.find((p) => p.id === current))
            const key = activeProject?.lockedTeamKey
            if (key) {
                untrack(() => {
                    const next = new Set(expandedKeys)
                    if (!next.has(key)) {
                        next.add(key)
                        expandedKeys = next
                    }
                })
            }
        }
    })

    function toggleGroup(key: string) {
        const next = new Set(expandedKeys)
        if (next.has(key)) {
            next.delete(key)
        } else {
            next.add(key)
        }
        expandedKeys = next
    }
</script>

<aside
    class="flex h-full shrink-0 flex-col border-r"
    style="width: {width}px;{dragging
        ? ''
        : ' transition: width 0.15s ease;'} background: var(--theme-sidebar-bg); color: var(--theme-sidebar-text); border-color: var(--theme-divider-border, rgba(255,255,255,0.1))"
    oncontextmenu={(e) => e.preventDefault()}
>
    <div
        class="flex items-center gap-2 border-b px-4 py-3 cursor-pointer transition-colors hover:bg-(--theme-sidebar-text)/5"
        style="border-color: var(--theme-divider-border);"
        onclick={onhome}
    >
        <img src={favicon} alt="椰果工具箱" class="size-5 shrink-0" />
        {#if !compact}<span class="text-sm font-semibold tracking-tight">椰果工具箱</span>{/if}
        <div class="flex-1"></div>
        {#if !compact}
            <button
                onclick={async (e: MouseEvent) => {
                    e.stopPropagation()
                    const next = currentTheme === 'dark' ? 'light' : 'dark'
                    await setActiveTheme(next)
                    const t = getThemes().find((th) => th.id === next)
                    addToast(`已切换至「${t?.name ?? next}」`, 'success')
                }}
                class="rounded p-1 text-(--theme-sidebar-text)/40 transition-colors hover:text-(--theme-sidebar-text)/70 hover:bg-white/5"
                title="切换主题"
            >
                <Icon icon="mdi:theme-light-dark" class="size-4" />
            </button>
        {/if}
    </div>

    <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pt-2">
        {#each grouped.groups as group (group.key)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class={[
                    'overflow-hidden rounded-lg transition-colors',
                    hoveredHeaderKey === group.key ? 'bg-(--theme-sidebar-text)/5' : ''
                ].join(' ')}
            >
                <div
                    class={[
                        'flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-sm transition-colors',
                        group.key === activeGroupKey
                            ? 'text-(--theme-sidebar-text)/90'
                            : 'text-(--theme-sidebar-text)/60 hover:text-(--theme-sidebar-text)/90'
                    ].join(' ')}
                    onclick={() => toggleGroup(group.key)}
                    onmouseenter={() => (hoveredHeaderKey = group.key)}
                    onmouseleave={() => (hoveredHeaderKey = null)}
                >
                    <svg viewBox="0 0 42 16" class="size-[18px] shrink-0">
                        {#each [0, 1, 2] as i}
                            {@const name = group.displayNames[i] ?? ''}
                            <rect
                                x={i * 14 + 1}
                                y="0"
                                width="10"
                                height="16"
                                rx="2.5"
                                fill={name ? charColor(name) : '#555'}
                            />
                        {/each}
                    </svg>
                    {#if !compact}
                        <span class="flex flex-1 items-center gap-0 truncate">
                            {#each group.displayNames as name, i}
                                {#if i > 0}<span class="text-(--theme-sidebar-text)/40 shrink-0">/</span>{/if}
                                <span class="shrink-0">{shortName(name)}</span>
                            {/each}
                        </span>
                        <Icon
                            icon={expandedKeys.has(group.key) ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                            class="size-4 shrink-0 text-(--theme-sidebar-text)/40"
                        />
                    {/if}
                </div>
                {#if expandedKeys.has(group.key)}
                    <div transition:slide|local={{ duration: 200 }} class="space-y-0.5 pb-1">
                        {#each group.projects as project (project.id)}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                onclick={() => selectProject(project.id)}
                                oncontextmenu={(e) => handleContextMenu(e, project.id)}
                                class={[
                                    'flex w-full cursor-pointer items-center text-sm transition-colors rounded-lg',
                                    compact ? 'justify-center py-1' : 'gap-2 px-2 py-1.5 pl-6',
                                    project.id === activeId
                                        ? 'bg-(--theme-accent-bg)/10 text-(--theme-accent-text)'
                                        : 'text-(--theme-sidebar-text)/60 hover:bg-(--theme-sidebar-text)/5 hover:text-(--theme-sidebar-text)/90'
                                ].join(' ')}
                            >
                                {#if compact}
                                    <span
                                        class="flex size-6 items-center justify-center rounded-md bg-(--theme-sidebar-text)/10 text-xs"
                                        >{project.name[0]}</span
                                    >
                                {:else}
                                    <span class="truncate flex-1">{project.name}</span>
                                {/if}
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/each}

        {#if grouped.ungrouped.length > 0}
            <div class="space-y-0.5">
                <div
                    class="flex w-full cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-(--theme-sidebar-text)/60"
                >
                    <svg viewBox="0 0 42 16" class="size-[18px] shrink-0">
                        {#each [0, 1, 2] as i}
                            <rect x={i * 14 + 1} y="0" width="10" height="16" rx="2.5" fill="#555" />
                        {/each}
                    </svg>
                    {#if !compact}
                        <span class="truncate flex-1">未锁定配队</span>
                    {/if}
                </div>
                {#each grouped.ungrouped as project (project.id)}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        onclick={() => selectProject(project.id)}
                        oncontextmenu={(e) => handleContextMenu(e, project.id)}
                        class={[
                            'flex w-full cursor-pointer items-center text-sm transition-colors rounded-lg',
                            compact ? 'justify-center py-1' : 'gap-2 px-2 py-1.5 pl-6',
                            project.id === activeId
                                ? 'bg-(--theme-accent-bg)/10 text-(--theme-accent-text)'
                                : 'text-(--theme-sidebar-text)/60 hover:bg-(--theme-sidebar-text)/5 hover:text-(--theme-sidebar-text)/90'
                        ].join(' ')}
                    >
                        {#if compact}
                            <span
                                class="flex size-6 items-center justify-center rounded-md bg-(--theme-sidebar-text)/10 text-xs"
                                >{project.name[0]}</span
                            >
                        {:else}
                            <span class="truncate flex-1">{project.name}</span>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    <div
        class="shrink-0 border-t px-2 pt-2 pb-3 space-y-0.5"
        style="box-shadow: 0 -4px 12px -2px var(--theme-sidebar-bg); border-color: var(--theme-divider-border)"
    >
        <button
            onclick={oncreate}
            class={[
                'flex w-full items-center rounded-lg text-sm text-(--theme-sidebar-text)/60 transition-colors hover:bg-(--theme-sidebar-text)/5 hover:text-(--theme-sidebar-text)/90',
                compact ? 'justify-center py-1' : 'gap-2 px-3 py-2'
            ].join(' ')}
            title="新建项目"
        >
            <Icon icon="mdi:plus" class="size-4 shrink-0" />
            {#if !compact}<span>新建项目</span>{/if}
        </button>
        <button
            onclick={onimport}
            class={[
                'flex w-full items-center rounded-lg text-sm text-(--theme-sidebar-text)/60 transition-colors hover:bg-(--theme-sidebar-text)/5 hover:text-(--theme-sidebar-text)/90',
                compact ? 'justify-center py-1' : 'gap-2 px-3 py-2'
            ].join(' ')}
            title="导入项目"
        >
            <Icon icon="mdi:file-import-outline" class="size-4 shrink-0" />
            {#if !compact}<span>导入项目</span>{/if}
        </button>
    </div>
</aside>

<ContextMenu x={ctxX} y={ctxY} items={ctxMenuItems} open={ctxMenuOpen} onclose={() => (ctxMenuOpen = false)} />
