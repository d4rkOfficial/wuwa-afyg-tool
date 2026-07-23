<script lang="ts">
    import Icon from '@iconify/svelte'
    import ContextMenu from '$lib/components/layout/context-menu.svelte'
    import type { Project, PhaseKey } from '$lib/data/types'
    import { setActiveTheme, getActiveId as getActiveThemeId, getThemes } from '$lib/theme'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props {
        projects: Project[]
        activeId: string
        width?: number
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
            label: '导出项目',
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
</script>

<aside
    class="flex h-full shrink-0 flex-col border-r"
    style="width: {width}px; background: var(--theme-sidebar-bg); color: var(--theme-sidebar-text); border-color: var(--theme-divider-border, rgba(255,255,255,0.1))"
>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="flex items-center gap-2 border-b px-4 py-3 cursor-pointer transition-colors hover:bg-[var(--theme-sidebar-text)]/5"
        style="border-color: var(--theme-divider-border);"
        onclick={onhome}
    >
        <svg viewBox="0 0 1024 1024" class="size-5 text-[var(--theme-sidebar-text)]" fill="currentColor">
            <path
                d="M769 887.9c-245.9 154.5-571.7 80-726.1-165.9C10.3 670.1 0.8 613.4 14.6 553.6 55.1 378.1 287.7 226 333.8 197l1.1-0.6 1.4-0.9c1-0.6 1.9-1.3 2.9-1.9 68.3-42.9 288.3-169 456.2-131 59.9 13.6 106.9 47 139.7 99.2 154.4 246 79.8 571.7-166.1 726.1z m-424-667C295 252.4 77.6 397 40 559.5 27.8 612.2 36.3 662.2 65 708c146.8 233.7 456.3 304.4 690 157.7 233.7-146.8 304.6-456.3 157.8-690-28.9-46.1-70.5-75.5-123.3-87.5C624.9 50.9 395 189.7 350.3 217.7l-1.4 0.9-1.1 0.8c-1 0.5-1.9 1-2.8 1.5z"
            />
            <path
                d="M923.9 168.8C1074.7 409 1002.4 726 762 876.8 521.7 1027.7 204.8 955.3 54 715-96.8 474.7 325.5 217.7 341.7 207.4c20.2-12.4 431.4-278.8 582.2-38.6z"
            />
            <path
                d="M86.6 619c32.3 51.4 132.3 54.9 262.5 9 130.1-45.8 270.5-134 368.4-231.3 97.8-97.3 138.2-188.9 105.9-240.3-32.3-51.4-132.4-54.9-262.5-9-130.1 45.8-270.5 134-368.4 231.3C94.6 476 54.3 567.6 86.6 619z"
            />
        </svg>
        <span class="text-sm font-semibold tracking-tight">椰果工具箱</span>
        <div class="flex-1"></div>
        <button
            onclick={async () => {
                const next = currentTheme === 'dark' ? 'light' : 'dark'
                await setActiveTheme(next)
                const t = getThemes().find((th) => th.id === next)
                addToast(`已切换至「${t?.name ?? next}」`, 'success')
            }}
            class="rounded p-1 text-[var(--theme-sidebar-text)]/40 transition-colors hover:text-[var(--theme-sidebar-text)]/70 hover:bg-white/5"
            title="切换主题"
        >
            <Icon icon="mdi:theme-light-dark" class="size-4" />
        </button>
    </div>

    <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {#each projects as project (project.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                onclick={() => selectProject(project.id)}
                oncontextmenu={(e) => handleContextMenu(e, project.id)}
                class={[
                    'flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                    project.id === activeId
                        ? 'bg-[var(--theme-accent-bg)]/10 text-[var(--theme-accent-text)]'
                        : 'text-[var(--theme-sidebar-text)]/60 hover:bg-[var(--theme-sidebar-text)]/5 hover:text-[var(--theme-sidebar-text)]/90'
                ].join(' ')}
            >
                <Icon icon="mdi:file-document-outline" class="size-4 shrink-0 opacity-60" />
                <span class="truncate flex-1">{project.name}</span>
            </div>
        {/each}

        <div class="px-1 pt-1 space-y-0.5">
            <button
                onclick={oncreate}
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--theme-sidebar-text)]/60 transition-colors hover:bg-[var(--theme-sidebar-text)]/5 hover:text-[var(--theme-sidebar-text)]/90"
            >
                <Icon icon="mdi:plus" class="size-4 shrink-0" />
                <span>新建项目</span>
            </button>
            <button
                onclick={onimport}
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--theme-sidebar-text)]/60 transition-colors hover:bg-[var(--theme-sidebar-text)]/5 hover:text-[var(--theme-sidebar-text)]/90"
            >
                <Icon icon="mdi:file-import-outline" class="size-4 shrink-0" />
                <span>导入项目</span>
            </button>
        </div>
    </div>
</aside>

<ContextMenu x={ctxX} y={ctxY} items={ctxMenuItems} open={ctxMenuOpen} onclose={() => (ctxMenuOpen = false)} />
