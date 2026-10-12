<script lang="ts">
    /**
     * @desc BUFF 配置弹窗的**左栏列表**（自 `buff-modal.svelte` **原样抽出**，标记与行为未改）：
     * 叠层文件夹（可折叠 / 整体拖拽）+ 独立 buff 块（可拖拽 / 拖出删除），插入位置显示指示条；
     * 底部是多选工具栏与「新建 BUFF」栏。
     *
     * 职责边界（受控区，无自有数据状态）：
     * - 折叠集合 `collapsedFolders`、拖拽状态 `dragState`、选中项**全部归父组件所有**并双向绑定：
     *   父组件在「打开弹窗 / 关闭弹窗 / 拖拽取消 / 退出多选」等路径上都要重置它们（例如拖拽取消时要还原
     *   拖动前的折叠快照），状态留在父组件才能保持这些重置逐句不变。
     * - 树 `tree`、条目数 `buffCount`、队伍与派生查询由父组件注入；本组件**不回读**父组件状态，
     *   所有数据写入与菜单打开都经回调交回父组件（父组件是 store 的唯一调用方）。
     * - 五个 `{#snippet}`（`dropLine` / `scopeBadges` / `buffRow` / `buffContainer` / `gateFolderHead`）
     *   随本区域整体搬入：它们只被本区域的 markup 调用。
     * - 拖拽的**落点计算**仍在父组件（`onstartdrag` / `ondragmove` / `ondragend`）：本组件只负责识别
     *   `.drag-handle` 起手并把事件交回，父组件通过 `context` 注入容器/行序查询。
     */
    import Icon from '@iconify/svelte'
    import Button from '$lib/components/ui/button.svelte'
    import { onMount } from 'svelte'
    import { slide } from 'svelte/transition'
    import type { ComponentsProps } from '$lib/types'
    import type { CharSlot } from '$lib/types/project'
    import type { BuffConf } from '$lib/calc/calculation.types'
    import type { BuffTreeNode } from '$lib/calc/buff-tree'
    import type { GroupedBuffConfItem } from '$lib/calc/calculation.consts'
    import type { BuffDerived, BuffListContext, BuffTree } from './buff-modal.types'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
    import { registerDragCancel } from '$lib/utils/drag-guard'
    import {
        buffItemIcon,
        buffItemIconClass,
        folderIconClass,
        folderMembersOf,
        foldersOf,
        looseChildrenOf,
        layeredKeyOf,
        scopeBadgesOf,
        type DragState
    } from './buff-modal.utils'

    interface Props extends ComponentsProps {
        /** @desc 三级归类树（父组件的 `$derived(buildBuffTree(...))`，拖动时还要用它的 folderKeys） */
        tree: BuffTree
        /** @desc 全部 Buff 条目（空态判定用；树是派生的，空树也可能是「有条目但全在目录里」） */
        buffCount: number
        /** @desc 当前选中的 Buff 块 id（null = 未选中） */
        selectedBuffSetId: string | null
        /** @desc 左栏宽度（拖动调宽后由父组件持久） */
        leftWidth: number
        team: [CharSlot, CharSlot, CharSlot]
        charIconMap: Record<string, string>
        /** @desc 父组件注入的派生查询（全局判定 / 队伍图标 / 属性色） */
        derivedQueries: BuffDerived
        /** @desc 拖拽落点计算所需的 DOM 查询（父组件注入） */
        context: BuffListContext
        /** @desc 多选模式是否开启 */
        multiSelect: boolean
        /** @desc 多选已勾选的 Buff id 集合 */
        multiSelectedIds: Set<string>
        /** @desc 折叠的目录 key 集合（绑定自父组件） */
        collapsedFolders: Set<string>
        /** @desc 当前拖拽状态（绑定自父组件） */
        dragState: DragState | null
        /** @desc 左栏宽度调宽把手是否按下（与主页 sidebar 拖动条一致的三态高亮） */
        resizingSidebar: boolean
        /** @desc 左栏宽度调宽把手是否悬停 */
        sidebarDividerHover: boolean
        /** @desc 选中某个条目（非多选态） */
        onselect: (id: string) => void
        /** @desc 多选态切换单个条目勾选 */
        ontogglemultiid: (id: string) => void
        /** @desc 多选态切换整个目录勾选 */
        ontogglemultifolder: (members: BuffConf[]) => void
        /** @desc 折叠 / 展开目录 */
        ontogglefolder: (key: string) => void
        /** @desc 打开文件夹右键菜单 */
        onfoldermenu: (e: MouseEvent, folder: GroupedBuffConfItem) => void
        /** @desc 打开条目右键菜单 */
        onitemmenu: (e: MouseEvent, id: string) => void
        /** @desc 拖拽把手落下的瞬间（父组件负责指针捕获、收起目录、装配拖拽状态） */
        onstartdrag: (e: PointerEvent, id: string, parentKey: string, memberIds?: string[]) => void
        /** @desc 拖拽移动 */
        ondragmove: (e: PointerEvent) => void
        /** @desc 拖拽结束 */
        ondragend: (e: PointerEvent) => void
        /** @desc 拖拽进入禁区（AI 悬浮窗等）时取消本次拖拽 */
        ondragcancel: () => void
        /** @desc 左栏调宽把手按下 */
        onstartresize: (e: MouseEvent) => void
        /** @desc 调宽把手悬停态变更 */
        onhoverdivider: (hover: boolean) => void
        /** @desc 多选开关 */
        onToggleMultiSelect: () => void
        /** @desc 多选全选 / 取消全选 */
        onselectall: () => void
        /** @desc 已选项按名称排序 */
        onsortselected: () => void
        /** @desc 批量并入 / 移出全局 */
        onmultiglobal: (global: boolean) => void
        /** @desc 请求批量删除（按偏好决定是否二次确认） */
        onrequestmultidelete: () => void
        /** @desc 新建 BUFF 块 */
        oncreatebuff: () => void
        /** @desc 多选工具栏的可用性判定（父组件按同一集合算，避免各算一遍） */
        selection: {
            allSelected: boolean
            sortableCount: number
            allNonGlobal: boolean
            allGlobal: boolean
        }
    }

    let {
        tree,
        buffCount,
        selectedBuffSetId = $bindable(),
        leftWidth,
        team,
        charIconMap,
        derivedQueries,
        context,
        multiSelect,
        multiSelectedIds,
        collapsedFolders = $bindable(),
        dragState = $bindable(),
        resizingSidebar,
        sidebarDividerHover,
        onselect,
        ontogglemultiid,
        ontogglemultifolder,
        ontogglefolder,
        onfoldermenu,
        onitemmenu,
        onstartdrag,
        ondragmove,
        ondragend,
        ondragcancel,
        onstartresize,
        onhoverdivider,
        onToggleMultiSelect,
        onselectall,
        onsortselected,
        onmultiglobal,
        onrequestmultidelete,
        oncreatebuff,
        selection,
        class: className,
        style: styleProp
    }: Props = $props()

    const groupedBuffSets = $derived(tree.nodes)

    /** @desc 多选态下某条目是否不可勾选（内置默认全局块） */
    const isDisabled = (id: string): boolean => id.startsWith('global-')

    /** @desc 某目录是否全选（不可勾选的子项跳过） */
    const folderAllSelected = (children: BuffConf[]): boolean => {
        const ids = children.map((c) => c.id).filter((id) => !isDisabled(id))
        return ids.length > 0 && ids.every((id) => multiSelectedIds.has(id))
    }

    /** @desc 拖拽把手落下的统一入口：只认 `.drag-handle` 起手（输入框内的拖动不接管），再交回父组件 */
    const requestDrag = (e: PointerEvent, id: string, parentKey: string, memberIds?: string[]) => {
        if ((e.target as HTMLElement).closest('input')) return
        if (!(e.target as HTMLElement).closest('.drag-handle')) return
        onstartdrag(e, id, parentKey, memberIds)
    }

    onMount(() => registerDragCancel(ondragcancel))
</script>

<div
    class="shrink-0 border-r flex flex-col"
    style="width: {leftWidth}px; border-right: 1px solid var(--theme-divider-border);"
>
    <!-- @desc 左侧列表：叠层文件夹（可折叠/整体拖拽）+ 独立 buff
            块（可拖拽/拖出删除），插入位置显示指示条。
            容器不设 padding：sticky 头的 top-0 吸附位 = 容器顶，贴顶时无缝隙；
            四周留白由子元素（块 px-2 / item mx-2 / 首末 mt-2 mb-2）承担 -->
    <div
        class="theme-scrollbar flex-1 overflow-y-auto overflow-x-hidden space-y-1 buff-list-container [&>*:first-child]:mt-2 [&>*:last-child]:mb-2"
    >
        {#each groupedBuffSets as item (item.key)}
            {#if item.type === 'folder'}
                {@const isGlobalFolder = item.folderKind === 'global'}
                {@const isAutoFolder = item.folderKind === 'char-gate'}
                {@const folderMembers = folderMembersOf(item)}
                <!-- 展开的文件夹头在滚动时贴顶吸附（类似表格表头）：实底 + 铺满容器宽度；
                            吸附范围 = 整个文件夹块（头 + 子项），子项全部滚出后头随块释放。
                            data-folder-collapse-key：拖动时按目录链判断哪些目录要保持在展开态 -->
                <div class="px-2" data-folder-collapse-key={item.prefix}>
                    {#if isAutoFolder}
                        {@render gateFolderHead(item, 'top-0')}
                    {:else}
                        <div
                            class={[
                                'flex min-w-0 items-center gap-1',
                                !collapsedFolders.has(item.prefix!)
                                    ? 'sticky top-0 z-10 -mx-2 border-b border-(--theme-divider-border) px-2 py-1 bg-(--theme-modal-bg)'
                                    : ''
                            ].join(' ')}
                        >
                            <button
                                data-press="none"
                                onclick={() =>
                                    multiSelect ? ontogglemultifolder(folderMembers) : ontogglefolder(item.prefix!)}
                                oncontextmenu={multiSelect ? undefined : (e) => onfoldermenu(e, item)}
                                onpointerdown={isGlobalFolder || multiSelect
                                    ? undefined
                                    : (e) =>
                                          requestDrag(
                                              e,
                                              item.prefix!,
                                              item.parentKey,
                                              folderMembers.map((c) => c.id)
                                          )}
                                onpointermove={isGlobalFolder || multiSelect ? undefined : ondragmove}
                                onpointerup={isGlobalFolder || multiSelect ? undefined : ondragend}
                                class={[
                                    'flex min-w-0 flex-1 items-center gap-2 rounded-none px-3 py-2 text-xs text-left transition-all',
                                    multiSelect && !isGlobalFolder && folderAllSelected(folderMembers)
                                        ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                        : 'text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5',
                                    !isGlobalFolder &&
                                        !multiSelect &&
                                        dragState?.id === item.prefix &&
                                        !dragState!.outside &&
                                        'ring-2 ring-(--theme-accent-bg)',
                                    !isGlobalFolder &&
                                        !multiSelect &&
                                        dragState?.id === item.prefix &&
                                        dragState!.outside &&
                                        'ring-2 ring-red-500 opacity-50'
                                ].join(' ')}
                                transition:slide|local={slideParams(MOTION_MS.base)}
                            >
                                {#if multiSelect && !isGlobalFolder}
                                    <Icon
                                        icon={folderAllSelected(folderMembers)
                                            ? 'mdi:checkbox-marked'
                                            : 'mdi:checkbox-blank-outline'}
                                        class="size-4 shrink-0 text-(--theme-accent-text)"
                                    />
                                {:else if isGlobalFolder}
                                    <Icon icon="mdi:crown" class={folderIconClass(item, 'size-4 shrink-0')} />
                                {:else}
                                    <!-- 叠层（数字前后缀）目录：可整组拖动 -->
                                    <Icon
                                        icon={collapsedFolders.has(item.prefix!)
                                            ? 'mdi:folder-account-outline'
                                            : 'mdi:folder-account'}
                                        class={folderIconClass(
                                            item,
                                            'drag-handle touch-none select-none cursor-grab active:cursor-grabbing size-4 shrink-0'
                                        )}
                                    />
                                {/if}
                                <span class="truncate flex-1">{item.name}</span>
                            </button>
                            {#if !multiSelect}
                                <Button
                                    type="button"
                                    variant="text"
                                    bare
                                    pad="p-0.5"
                                    class="shrink-0 text-(--theme-modal-text)/40 transition-colors hover:bg-(--theme-modal-text)/10 hover:text-(--theme-modal-text)"
                                    title="文件夹操作"
                                    onclick={(e) => onfoldermenu(e, item)}
                                    oncontextmenu={(e) => onfoldermenu(e, item)}
                                >
                                    <Icon icon="mdi:dots-horizontal" class="size-4" />
                                </Button>
                            {/if}
                        </div>
                    {/if}
                    {#if !collapsedFolders.has(item.prefix!)}
                        <div
                            transition:slide|local={slideParams(MOTION_MS.base)}
                            class="ml-3 mt-1 space-y-1 border-l pl-2"
                            style="border-color: var(--theme-divider-border);"
                        >
                            {#if isGlobalFolder}
                                <!-- @desc 全局 Buff 目录内先按链/阶条件分二级目录（与顶层同一套规则），再在每个二级目录内做数字归并 -->
                                {#each item.gateChildren ?? [] as gate (gate.key)}
                                    <div class="space-y-1" data-folder-collapse-key={gate.prefix}>
                                        {@render gateFolderHead(gate, 'top-10')}
                                        {#if !collapsedFolders.has(gate.prefix!)}
                                            <div
                                                transition:slide|local={slideParams(MOTION_MS.base)}
                                                class="ml-2 space-y-1 border-l pl-2"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                {@render buffContainer(gate.children, gate.prefix!)}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                                <!-- 无链/阶条件的全局 buff 直接留在全局目录下（数字归并） -->
                                {@render buffContainer(item.children, item.prefix!)}
                            {:else if isAutoFolder}
                                <!-- @desc 非全局容器（角色链 / 武器目录）：先做一级数字前后缀归并（文件夹排在所有条目上方），再挨个列出散条目 -->
                                {@render buffContainer(item.children, item.prefix!)}
                            {:else}
                                <!-- @desc 叠层（数字前后缀）目录：children 本身就是同源条目，直接列出 -->
                                {#each item.children ?? [] as child (child.id)}
                                    {@render buffRow(child, item.prefix!, 'px-3 py-1.5')}
                                {/each}
                            {/if}
                        </div>
                    {/if}
                </div>
            {:else}
                {@const isGlobal = derivedQueries.isGlobalBuff(item.buffSet!.id)}
                {@render dropLine(item.buffSet!.id, 'before', 'mx-2')}
                <button
                    data-press="none"
                    data-buffset-id={item.buffSet!.id}
                    data-drag-parent={item.parentKey}
                    onclick={() => {
                        if (multiSelect) {
                            if (!isDisabled(item.buffSet!.id)) ontogglemultiid(item.buffSet!.id)
                        } else {
                            onselect(item.buffSet!.id)
                        }
                    }}
                    oncontextmenu={(e) => onitemmenu(e, item.buffSet!.id)}
                    onpointerdown={isGlobal || multiSelect
                        ? undefined
                        : (e) => requestDrag(e, item.buffSet!.id, item.parentKey)}
                    onpointermove={isGlobal || multiSelect ? undefined : ondragmove}
                    onpointerup={isGlobal || multiSelect ? undefined : ondragend}
                    class={[
                        'mx-2 flex w-full min-w-0 items-center gap-2 rounded-none px-3 py-2 text-xs text-left transition-all',
                        multiSelect && isDisabled(item.buffSet!.id)
                            ? 'text-(--theme-modal-text)/30 opacity-50'
                            : multiSelect
                              ? multiSelectedIds.has(item.buffSet!.id)
                                  ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                  : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5'
                              : selectedBuffSetId === item.buffSet!.id
                                ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5',
                        !isGlobal &&
                            !multiSelect &&
                            dragState?.id === item.buffSet!.id &&
                            !dragState.outside &&
                            'ring-2 ring-(--theme-accent-bg)',
                        !isGlobal &&
                            !multiSelect &&
                            dragState?.id === item.buffSet!.id &&
                            dragState.outside &&
                            'ring-2 ring-red-500 opacity-50'
                    ].join(' ')}
                    transition:slide|local={slideParams(MOTION_MS.base)}
                >
                    {#if multiSelect}
                        <Icon
                            icon={isDisabled(item.buffSet!.id)
                                ? 'mdi:checkbox-blank-off-outline'
                                : multiSelectedIds.has(item.buffSet!.id)
                                  ? 'mdi:checkbox-marked'
                                  : 'mdi:checkbox-blank-outline'}
                            class="size-4 shrink-0 text-(--theme-accent-text)"
                        />
                    {:else}
                        <Icon
                            icon={buffItemIcon(item.buffSet!.starred)}
                            class={buffItemIconClass(item.buffSet!.starred, !isGlobal)}
                        />
                    {/if}
                    <span class="truncate flex-1">{item.buffSet!.name}</span>
                    {@render scopeBadges(item.buffSet!)}
                </button>
                {@render dropLine(item.buffSet!.id, 'after', 'mx-2')}
            {/if}
        {/each}
        {#if buffCount === 0}
            <div class="text-xs text-(--theme-modal-text)/30 text-center py-4">暂无 BUFF 块</div>
        {/if}
    </div>
    <!-- @desc 底部操作栏：单排多选工具栏（多选开关 + 全选 + 批量操作），窄宽度时按钮文本压缩为仅图标；再往下是新建栏 -->
    <div class="shrink-0 border-t p-2 flex flex-col gap-1.5" style="border-top: 1px solid var(--theme-divider-border);">
        <div class="flex items-center gap-1">
            <button
                type="button"
                onclick={onToggleMultiSelect}
                class={[
                    'flex items-center gap-1 rounded-none px-2 py-1 text-[11px] font-medium transition-colors',
                    multiSelect
                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                        : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/5'
                ].join(' ')}
                title={multiSelect ? '退出多选' : '进入多选'}
            >
                <Icon
                    icon={multiSelect ? 'mdi:check-decagram' : 'mdi:checkbox-multiple-marked-outline'}
                    class="size-3.5"
                />
                {#if leftWidth >= 280}<span>多选</span>{/if}
            </button>
            {#if multiSelect}
                <button
                    type="button"
                    onclick={onselectall}
                    class="flex items-center gap-1 rounded-none px-2 py-1 text-[11px] text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/5"
                    title={selection.allSelected ? '取消全选' : '全选'}
                >
                    <Icon
                        icon={selection.allSelected ? 'mdi:checkbox-multiple-blank-outline' : 'mdi:select-all'}
                        class="size-3.5"
                    />
                    {#if leftWidth >= 280}
                        <span>{selection.allSelected ? '取消全选' : '全选'}</span>
                    {/if}
                </button>
                {#if multiSelectedIds.size > 0}
                    <button
                        type="button"
                        disabled={selection.sortableCount < 2}
                        onclick={onsortselected}
                        class={[
                            'flex items-center gap-1 rounded-none px-2 py-1 text-[11px] transition-colors',
                            selection.sortableCount >= 2
                                ? 'text-(--theme-accent-text) hover:bg-(--theme-accent-bg)/10'
                                : 'text-(--theme-modal-text)/25 cursor-not-allowed'
                        ].join(' ')}
                        title="按名称排序已选 BUFF（连续数字按数值大小，其它字符按 unicode；只重排已选项，位置不变）"
                    >
                        <Icon icon="mdi:sort-alphabetical-ascending" class="size-3.5" />
                        {#if leftWidth >= 360}<span>按名称排序</span>{/if}
                    </button>
                    <button
                        type="button"
                        disabled={!selection.allNonGlobal}
                        onclick={() => onmultiglobal(true)}
                        class={[
                            'flex items-center gap-1 rounded-none px-2 py-1 text-[11px] transition-colors',
                            selection.allNonGlobal
                                ? 'text-(--theme-accent-text) hover:bg-(--theme-accent-bg)/10'
                                : 'text-(--theme-modal-text)/25 cursor-not-allowed'
                        ].join(' ')}
                        title={selection.allNonGlobal ? '并入全局' : '仅选中非全局 BUFF 时可并入'}
                    >
                        <Icon icon="mdi:crown-outline" class="size-3.5" />
                        {#if leftWidth >= 360}<span>并入全局</span>{/if}
                    </button>
                    <button
                        type="button"
                        disabled={!selection.allGlobal}
                        onclick={() => onmultiglobal(false)}
                        class={[
                            'flex items-center gap-1 rounded-none px-2 py-1 text-[11px] transition-colors',
                            selection.allGlobal
                                ? 'text-(--theme-accent-text) hover:bg-(--theme-accent-bg)/10'
                                : 'text-(--theme-modal-text)/25 cursor-not-allowed'
                        ].join(' ')}
                        title={selection.allGlobal ? '移出全局' : '仅选中全局 BUFF 时可移出'}
                    >
                        <Icon icon="mdi:minus-circle-outline" class="size-3.5" />
                        {#if leftWidth >= 360}<span>移出全局</span>{/if}
                    </button>
                    <button
                        type="button"
                        onclick={onrequestmultidelete}
                        class="ml-auto flex items-center gap-1 rounded-none px-2 py-1 text-[11px] text-red-400 transition-colors hover:bg-red-500/10"
                        title="删除"
                    >
                        <Icon icon="mdi:delete-outline" class="size-3.5" />
                        {#if leftWidth >= 280}<span>删除</span>{/if}
                    </button>
                {/if}
            {/if}
        </div>
        <div class="flex">
            <button
                type="button"
                data-press="none"
                onclick={oncreatebuff}
                class="flex w-full items-center justify-center gap-1 rounded-none border px-2 py-1.5 text-xs font-medium transition-all hover:brightness-125"
                style="border-color: var(--theme-divider-border); background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                title="新建 BUFF 块"
            >
                <Icon icon="mdi:plus" class="size-3.5" />
                <span>新建 BUFF</span>
            </button>
        </div>
    </div>
</div>
<!-- @desc 左栏宽度调节把手（与主页 sidebar 拖动条一致的三态样式） -->
<div
    class="shrink-0 w-1 cursor-col-resize"
    style="background: {resizingSidebar
        ? 'var(--theme-accent-bg)'
        : sidebarDividerHover
          ? 'color-mix(in srgb, var(--theme-accent-bg) 45%, transparent)'
          : 'color-mix(in srgb, var(--theme-divider-border) 80%, transparent)'};{resizingSidebar
        ? ' box-shadow: 0 0 10px color-mix(in srgb, var(--theme-accent-bg) 55%, transparent);'
        : sidebarDividerHover
          ? ' box-shadow: 0 0 8px color-mix(in srgb, var(--theme-accent-bg) 30%, transparent);'
          : ''}"
    title="拖拽调整宽度"
    onmouseenter={() => onhoverdivider(true)}
    onmouseleave={() => onhoverdivider(false)}
    onmousedown={onstartresize}
></div>

<!-- @desc ── 列表复用部件：最低一层 buff 条目 / 容器内容（数字目录 + 散条目）/ 二级（链·武器）目录头 ── -->

<!-- @desc 拖拽插入指示条：只在当前落点锚点行的上/下方出现（锚点由 onDragMove 按同一父容器行序列算出） -->
{#snippet dropLine(anchorId: string, side: 'before' | 'after', pad: string)}
    {#if !dragState?.outside && (side === 'before' ? dragState?.dropBeforeId === anchorId : dragState?.dropAfterId === anchorId)}
        <div class="{pad} h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
    {/if}
{/snippet}

<!-- @desc 条目作用域徽标（名称右侧）：全队=主题色实心 / 效应专属=主题色空心 / 指定角色=角色属性色空心+半透明底 -->
{#snippet scopeBadges(bs: BuffConf)}
    {#each scopeBadgesOf(bs, team, derivedQueries.elementColor) as badge (badge.key)}
        <span
            class="shrink-0 whitespace-nowrap rounded-none border px-1 py-px text-[10px] leading-none tabular-nums"
            style={badge.style}
            title={`作用域：${badge.label}`}>{badge.label}</span
        >
    {/each}
{/snippet}

{#snippet buffRow(child: BuffConf, parentKey: string, rowPad: string)}
    {@const draggable = !multiSelect && !derivedQueries.isGlobalBuff(child.id)}
    {@render dropLine(child.id, 'before', 'mx-1')}
    <button
        data-press="none"
        data-buffset-id={child.id}
        data-drag-parent={parentKey}
        onclick={() => {
            if (multiSelect) !isDisabled(child.id) && ontogglemultiid(child.id)
            else onselect(child.id)
        }}
        oncontextmenu={(e) => onitemmenu(e, child.id)}
        onpointerdown={draggable ? (e) => requestDrag(e, child.id, parentKey) : undefined}
        onpointermove={draggable ? ondragmove : undefined}
        onpointerup={draggable ? ondragend : undefined}
        class={[
            `flex w-full min-w-0 items-center gap-2 rounded-none ${rowPad} text-left text-xs transition-all`,
            multiSelect && isDisabled(child.id)
                ? 'text-(--theme-modal-text)/30 opacity-50'
                : (multiSelect ? multiSelectedIds.has(child.id) : selectedBuffSetId === child.id)
                  ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                  : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5',
            draggable && dragState?.id === child.id && !dragState.outside && 'ring-2 ring-(--theme-accent-bg)',
            draggable && dragState?.id === child.id && dragState.outside && 'ring-2 ring-red-500 opacity-50'
        ].join(' ')}
    >
        {#if multiSelect}
            <Icon
                icon={isDisabled(child.id)
                    ? 'mdi:checkbox-blank-off-outline'
                    : multiSelectedIds.has(child.id)
                      ? 'mdi:checkbox-marked'
                      : 'mdi:checkbox-blank-outline'}
                class="size-4 shrink-0 text-(--theme-accent-text)"
            />
        {:else}
            <Icon icon={buffItemIcon(child.starred)} class={buffItemIconClass(child.starred, draggable)} />
        {/if}
        <span class="truncate flex-1">{child.name}</span>
        {@render scopeBadges(child)}
    </button>
    {@render dropLine(child.id, 'after', 'mx-1')}
{/snippet}

<!-- @desc 目录折叠时的子级行按钮。本 snippet 自身不带 `space-y-1`：展开态的行间距仍由调用点那层容器
     按**直接子级**给出（Tailwind space-y-* 只作用于直接子级），所以展开态 DOM 与整改前逐字一致。
     折叠用的 `{#if}` 一开一关即产生/销毁这些行，slide 过渡则挂在承载它们的容器上（180ms）。 -->
{#snippet collapseFolderChildren(children: BuffConf[] | undefined, containerKey: string)}
    {#each children ?? [] as child (child.id)}
        {@render buffRow(child, containerKey, 'px-3 py-1.5')}
    {/each}
{/snippet}

{#snippet buffContainer(children: BuffConf[] | undefined, containerKey: string)}
    {#each foldersOf(children) as sub (sub.key)}
        {@const subKey = layeredKeyOf(containerKey, sub.prefix)}
        {@const subMembers = (sub.children ?? []).map((c) => c.id)}
        {@const subDraggable = !multiSelect && subMembers.some((id) => !derivedQueries.isGlobalBuff(id))}
        <div class="space-y-1" data-folder-collapse-key={subKey}>
            <button
                data-press="none"
                class={[
                    'flex w-full min-w-0 items-center gap-2 rounded-none px-3 py-1.5 text-left text-xs transition-all',
                    multiSelect && folderAllSelected(sub.children ?? [])
                        ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                        : 'text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5',
                    subDraggable && dragState?.id === subKey && !dragState.outside && 'ring-2 ring-(--theme-accent-bg)',
                    subDraggable && dragState?.id === subKey && dragState.outside && 'ring-2 ring-red-500 opacity-50'
                ].join(' ')}
                onclick={() => (multiSelect ? ontogglemultifolder(sub.children ?? []) : ontogglefolder(subKey))}
                oncontextmenu={multiSelect ? undefined : (e) => onfoldermenu(e, sub)}
                onpointerdown={subDraggable ? (e) => requestDrag(e, subKey, containerKey, subMembers) : undefined}
                onpointermove={subDraggable ? ondragmove : undefined}
                onpointerup={subDraggable ? ondragend : undefined}
            >
                {#if multiSelect}
                    <Icon
                        icon={folderAllSelected(sub.children ?? [])
                            ? 'mdi:checkbox-marked'
                            : 'mdi:checkbox-blank-outline'}
                        class="size-3.5 shrink-0 text-(--theme-accent-text)"
                    />
                {:else}
                    <Icon
                        icon={collapsedFolders.has(subKey) ? 'mdi:folder' : 'mdi:folder-open'}
                        class={folderIconClass(
                            sub,
                            subDraggable
                                ? 'size-3.5 shrink-0 drag-handle touch-none select-none cursor-grab active:cursor-grabbing'
                                : 'size-3.5 shrink-0'
                        )}
                    />
                {/if}
                <span class="truncate flex-1">{sub.name}</span>
            </button>
            {#if !collapsedFolders.has(subKey)}
                <div
                    transition:slide|local={slideParams(MOTION_MS.base)}
                    class="ml-3 space-y-1 border-l pl-2"
                    style="border-color: var(--theme-divider-border);"
                >
                    {@render collapseFolderChildren(sub.children, subKey)}
                </div>
            {/if}
        </div>
    {/each}
    {#each looseChildrenOf(children) as child (child.id)}
        {@render buffRow(child, containerKey, 'px-3 py-2')}
    {/each}
{/snippet}

{#snippet gateFolderHead(node: BuffTreeNode, stickyTop: string)}
    {@const members = folderMembersOf(node)}
    <div
        class={[
            'flex min-w-0 items-center gap-1',
            !collapsedFolders.has(node.prefix!)
                ? `sticky ${stickyTop} z-10 -mx-2 border-b border-(--theme-divider-border) px-2 py-1 bg-(--theme-modal-bg)`
                : ''
        ].join(' ')}
    >
        <!-- @desc 二级目录（角色名X链 / 角色名的武器名）由链/阶硬性条件派生，改条件即换目录，因此**不可拖动** -->
        <button
            data-press="none"
            onclick={() => (multiSelect ? ontogglemultifolder(members) : ontogglefolder(node.prefix!))}
            oncontextmenu={multiSelect ? undefined : (e) => onfoldermenu(e, node)}
            class={[
                'flex min-w-0 flex-1 items-center gap-2 rounded-none px-3 py-2 text-xs text-left transition-all',
                multiSelect && folderAllSelected(members)
                    ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                    : 'text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5'
            ].join(' ')}
            transition:slide|local={slideParams(MOTION_MS.base)}
        >
            {#if multiSelect}
                <Icon
                    icon={folderAllSelected(members) ? 'mdi:checkbox-marked' : 'mdi:checkbox-blank-outline'}
                    class="size-4 shrink-0 text-(--theme-accent-text)"
                />
            {:else if node.charIdx !== undefined && derivedQueries.teamIconOf(node.charIdx)}
                <!-- @desc 二级目录：角色图标 + 角标（链目录=链门槛角标；武器目录=当前装配武器图标） -->
                <span class="relative shrink-0">
                    <img
                        src={derivedQueries.teamIconOf(node.charIdx)}
                        alt=""
                        draggable="false"
                        class="size-4 rounded-full object-cover"
                    />
                    {#if node.gateKind === 'weapon'}
                        {#if derivedQueries.weaponIconOf(node.charIdx)}
                            <img
                                src={derivedQueries.weaponIconOf(node.charIdx)}
                                alt=""
                                draggable="false"
                                class="absolute -bottom-0.5 -right-1 size-3 rounded-sm border object-cover"
                                style="border-color: var(--theme-modal-bg);"
                            />
                        {/if}
                    {:else}
                        <span
                            class="absolute -bottom-1 -right-1 flex h-3 min-w-3 items-center justify-center px-0.5 text-[8px] font-black leading-none"
                            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                            >{node.gateMin ?? 0}</span
                        >
                    {/if}
                </span>
            {:else}
                <Icon
                    icon={collapsedFolders.has(node.prefix!) ? 'mdi:folder-account-outline' : 'mdi:folder-account'}
                    class={folderIconClass(node, 'size-4 shrink-0')}
                />
            {/if}
            <span class="truncate flex-1">{node.name}</span>
        </button>
        {#if !multiSelect}
            <Button
                type="button"
                variant="text"
                bare
                pad="p-0.5"
                class="shrink-0 text-(--theme-modal-text)/40 transition-colors hover:bg-(--theme-modal-text)/10 hover:text-(--theme-modal-text)"
                title="文件夹操作"
                onclick={(e) => onfoldermenu(e, node)}
                oncontextmenu={(e) => onfoldermenu(e, node)}
            >
                <Icon icon="mdi:dots-horizontal" class="size-4" />
            </Button>
        {/if}
    </div>
{/snippet}
