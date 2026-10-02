<script lang="ts">
    /** @desc 可调用工具列表（按分组、含描述），点击即把工具名交给宿主插入光标处。
     *  提示词编辑弹窗与技能编辑弹窗共用此面板，避免两份复制逻辑。 */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import { buildToolGroups } from '$lib/utils/tool-catalog'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        /** @desc 点击某个工具名（宿主负责插入到光标处） */
        onpick: (name: string) => void
        /** @desc 面板最大高度（Tailwind 类，默认与应用内提示词弹窗一致） */
        maxHeightClass?: string
        /** @desc 标题文案 */
        title?: string
        /** @desc 面板宽度类（Tailwind，默认 w-80） */
        widthClass?: string
    }

    let {
        onpick,
        maxHeightClass = 'max-h-[32rem]',
        title = '可调用工具（点击插入工具名）',
        widthClass = 'w-80',
        class: className,
        style: styleProp
    }: Props = $props()

    const toolGroups = buildToolGroups()
</script>

<div
    class={mergeClass([
        'theme-scrollbar shrink-0 overflow-y-auto rounded-none border p-2.5',
        widthClass,
        maxHeightClass,
        className
    ])}
    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg); {styleProp || ''}"
>
    <div class="mb-1.5 flex items-center gap-1.5 text-[10px] font-black tracking-tight text-(--theme-modal-text)/70">
        <Icon icon="mdi:toolbox-outline" class="size-3.5 shrink-0" style="color: var(--theme-accent-text);" />
        {title}
    </div>
    {#each toolGroups as group (group.label)}
        <div
            class="mb-1 mt-3 flex items-center gap-1.5 border-b pb-1 text-[10px] font-black tracking-[0.16em] text-(--theme-modal-text)/45"
            style="border-color: color-mix(in srgb, var(--theme-modal-text) 10%, transparent);"
        >
            <span>{group.label}</span>
            <span class="text-(--theme-modal-text)/25">{group.items.length}</span>
        </div>
        <div class="flex flex-col gap-0.5">
            {#each group.items as tool (tool.name)}
                <button
                    onclick={() => onpick(tool.name)}
                    title={tool.full}
                    class="rounded-none px-1.5 py-1 text-left transition-colors hover:bg-(--theme-accent-bg)/15"
                >
                    <span class="block truncate font-mono text-[11px] text-(--theme-modal-text)/80">{tool.name}</span>
                    <span class="mt-0.5 block text-[10px] leading-snug text-(--theme-modal-text)/40">{tool.desc}</span>
                </button>
            {/each}
        </div>
    {/each}
</div>
